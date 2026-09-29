// The accounts API (worker/): Google sign-in, sessions, and syncing saves, against an in-memory store.
import { describe, expect, it } from "vitest";
import { readSession, signSession, verifyGoogle } from "../worker/auth";
import { handleApi, memoryStore, type Env } from "../worker/index";
import { mergeSaves, placeKey, routeKey, validSave, type Saved } from "../src/core/saves";

const CLIENT = "123-abc.apps.googleusercontent.com";
const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const other = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const keys = async (kid: string) => (kid === "k1" ? pair.publicKey : null);

async function googleToken(claims: Record<string, unknown>, key = pair.privateKey, kid = "k1") {
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
const now = Date.UTC(2026, 8, 29);
const claims = { iss: "https://accounts.google.com", aud: CLIENT, sub: "10987654321", exp: now / 1000 + 3600, given_name: "Asha", picture: "https://lh3.googleusercontent.com/a/x" };

describe("Google sign-in", () => {
  it("accepts a genuine token for this site", async () => {
    expect(await verifyGoogle(await googleToken(claims), CLIENT, keys, now)).toEqual({ sub: "10987654321", name: "Asha", picture: claims.picture });
  });

  it("refuses tokens for another site, from someone else, expired, or tampered with", async () => {
    expect(await verifyGoogle(await googleToken({ ...claims, aud: "other" }), CLIENT, keys, now)).toBeNull();
    expect(await verifyGoogle(await googleToken({ ...claims, iss: "https://evil.example" }), CLIENT, keys, now)).toBeNull();
    expect(await verifyGoogle(await googleToken({ ...claims, exp: now / 1000 - 3600 }), CLIENT, keys, now)).toBeNull();
    expect(await verifyGoogle(await googleToken(claims, other.privateKey), CLIENT, keys, now)).toBeNull();
    expect(await verifyGoogle(await googleToken(claims, pair.privateKey, "unknown"), CLIENT, keys, now)).toBeNull();
    const [h, , s] = (await googleToken(claims)).split(".");
    const forged = b64url(enc.encode(JSON.stringify({ ...claims, sub: "someone-else" })));
    expect(await verifyGoogle(`${h}.${forged}.${s}`, CLIENT, keys, now)).toBeNull();
    expect(await verifyGoogle("not a token", CLIENT, keys, now)).toBeNull();
  });
});

describe("sessions", () => {
  it("round-trip, and refuse tampering and old ones", async () => {
    const t = await signSession("u1", "secret", 180, now);
    expect(await readSession(t, "secret", now)).toBe("u1");
    expect(await readSession(t, "another secret", now)).toBeNull();
    expect(await readSession(t, "secret", now + 181 * 86400_000)).toBeNull();
    const [, sig] = t.split(".");
    expect(await readSession(`${b64url(enc.encode(JSON.stringify({ sub: "u2", exp: now + 1e9 })))}.${sig}`, "secret", now)).toBeNull();
  });
});

const place = (slug: string, at: number, deleted = false): Saved => ({ key: placeKey(slug), kind: "place", data: { slug, title: slug }, at, ...(deleted ? { deleted } : {}) });

describe("saves", () => {
  it("merge two copies: per item, the latest change wins, removals included", () => {
    const phone = [place("hampi", 10), place("goa", 30, true)];
    const laptop = [place("goa", 20), place("ooty", 25)];
    const m = mergeSaves(phone, laptop);
    expect(m.find((s) => s.key === "place:goa")?.deleted).toBe(true);
    expect(m.map((s) => s.key).sort()).toEqual(["place:goa", "place:hampi", "place:ooty"]);
  });

  it("check what they're sent", () => {
    expect(validSave(place("hampi", 1))).toBe(true);
    const route: Saved = { key: routeKey({ from: "bengaluru", to: "amritsar", journey: "22691-12013" }), kind: "route", data: { from: "bengaluru", to: "amritsar", fromTitle: "Bengaluru", toTitle: "Amritsar", journey: "22691-12013" }, at: 1 };
    expect(validSave(route)).toBe(true);
    expect(validSave({ ...route, key: "route:elsewhere" })).toBe(false);
    expect(validSave({ ...place("hampi", 1), data: { slug: "<script>", title: "x" } })).toBe(false);
    expect(validSave({ ...place("hampi", 1), kind: "other" })).toBe(false);
  });
});

describe("the accounts API", () => {
  const env: Env = { GOOGLE_CLIENT_ID: CLIENT, SESSION_SECRET: "test secret" };
  const store = memoryStore();
  const call = (method: string, path: string, init: { body?: unknown; cookie?: string; site?: boolean; origin?: string } = {}) =>
    handleApi(
      new Request(`https://railgaddi.in/api${path}`, {
        method,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          ...(init.site !== false ? { "x-railgaddi": "1" } : {}),
          ...(init.cookie ? { cookie: init.cookie } : {}),
          ...(init.origin ? { origin: init.origin } : {}),
        },
      }),
      env,
      store,
      keys,
      now,
    );

  it("says when accounts aren't set up", async () => {
    const r = await handleApi(new Request("https://x/api/config"), {}, null, keys, now);
    expect(await r.json()).toEqual({ signIn: null });
    expect((await handleApi(new Request("https://x/api/me"), {}, null, keys, now)).status).toBe(503);
    expect(await (await call("GET", "/config")).json()).toEqual({ signIn: { google: CLIENT } });
  });

  it("signs in, syncs saves, and deletes the account on request", async () => {
    const credential = await googleToken(claims);
    expect((await call("POST", "/session", { body: { credential }, site: false })).status).toBe(403); // no site header
    expect((await call("POST", "/session", { body: { credential }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", "/session", { body: { credential: "junk" } })).status).toBe(401);
    const r = await call("POST", "/session", { body: { credential } });
    expect(r.status).toBe(200);
    const set = r.headers.get("set-cookie")!;
    expect(set).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const cookie = set.split(";")[0];

    expect(await (await call("GET", "/me", { cookie })).json()).toEqual({ user: { name: "Asha", picture: claims.picture } });
    expect((await call("GET", "/me")).status).toBe(401);

    const t = Date.now();
    const items = [place("hampi", t - 2000), place("goa", t - 1000)];
    const put = await call("PUT", "/saves", { cookie, body: { items } });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { items: Saved[] }).items).toHaveLength(2);
    expect((await call("PUT", "/saves", { cookie, body: { items: [{ key: "place:x", kind: "place", data: {}, at: 1 }] } })).status).toBe(400);
    // a removal from another device wins over the older save
    await call("PUT", "/saves", { cookie, body: { items: [place("goa", t, true)] } });
    const got = ((await (await call("GET", "/saves", { cookie })).json()) as { items: Saved[] }).items;
    expect(got.find((s) => s.key === "place:goa")?.deleted).toBe(true);

    expect((await call("DELETE", "/account", { cookie })).status).toBe(200);
    expect((await call("GET", "/saves", { cookie })).status).toBe(401);
    expect(await store.saves(claims.sub)).toEqual([]);
  });
});
