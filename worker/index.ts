// The Cloudflare Worker in front of the site: static files as before, plus a small API for
// accounts under /api/ (sign in with Google, keep saved places and routes in sync). Without a
// database or a Google client id configured, the API says so and the site keeps saves on the
// device only. Setup: docs/accounts.md.
import { MAX_SAVES, mergeSaves, prune, validSave, type Saved } from "../src/core/saves";
import { googleKeys, readSession, signSession, verifyGoogle, type KeySource } from "./auth";

// ---------------------------------------------------------------- storage

export interface User {
  id: string;
  name: string;
  picture: string;
}

export interface Store {
  upsertUser(u: User, now: number): Promise<void>;
  user(id: string): Promise<User | null>;
  saves(user: string): Promise<Saved[]>;
  /** Merge these into the user's saves (per key, the latest wins) and return all of them. */
  merge(user: string, items: Saved[]): Promise<Saved[]>;
  deleteUser(id: string): Promise<void>;
}

/** The few D1 calls used here (typed locally: no dependency on Cloudflare's type package). */
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1 {
  prepare(sql: string): D1Stmt;
  batch(s: D1Stmt[]): Promise<unknown[]>;
}

type Row = { key: string; kind: Saved["kind"]; data: string; at: number; deleted: number };
const fromRow = (r: Row): Saved => ({ key: r.key, kind: r.kind, data: JSON.parse(r.data), at: r.at, ...(r.deleted ? { deleted: true } : {}) });

export function d1Store(db: D1): Store {
  return {
    async upsertUser(u, now) {
      await db
        .prepare("INSERT INTO users (id, name, picture, created, seen) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(id) DO UPDATE SET name = ?2, picture = ?3, seen = ?4")
        .bind(u.id, u.name, u.picture, now)
        .run();
    },
    async user(id) {
      return db.prepare("SELECT id, name, picture FROM users WHERE id = ?1").bind(id).first<User>();
    },
    async saves(user) {
      const { results } = await db.prepare("SELECT key, kind, data, at, deleted FROM saves WHERE user = ?1 ORDER BY at DESC").bind(user).all<Row>();
      return results.map(fromRow);
    },
    async merge(user, items) {
      const up = db.prepare(
        "INSERT INTO saves (user, key, kind, data, at, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
          "ON CONFLICT(user, key) DO UPDATE SET kind = excluded.kind, data = excluded.data, at = excluded.at, deleted = excluded.deleted " +
          "WHERE excluded.at > saves.at",
      );
      const forget = db.prepare("DELETE FROM saves WHERE user = ?1 AND deleted = 1 AND at < ?2").bind(user, Date.now() - 90 * 86400_000);
      if (items.length) await db.batch([...items.map((s) => up.bind(user, s.key, s.kind, JSON.stringify(s.data), s.at, s.deleted ? 1 : 0)), forget]);
      return this.saves(user);
    },
    async deleteUser(id) {
      await db.batch([db.prepare("DELETE FROM saves WHERE user = ?1").bind(id), db.prepare("DELETE FROM users WHERE id = ?1").bind(id)]);
    },
  };
}

/** For tests, and for trying the API without a database. */
export function memoryStore(): Store {
  const users = new Map<string, User>();
  const saves = new Map<string, Saved[]>();
  return {
    async upsertUser(u) {
      users.set(u.id, { ...u });
    },
    async user(id) {
      return users.get(id) ?? null;
    },
    async saves(user) {
      return saves.get(user) ?? [];
    },
    async merge(user, items) {
      const all = prune(mergeSaves(saves.get(user) ?? [], items));
      saves.set(user, all);
      return all;
    },
    async deleteUser(id) {
      users.delete(id);
      saves.delete(id);
    },
  };
}

// ---------------------------------------------------------------- the API

export interface Env {
  ASSETS?: { fetch(r: Request): Promise<Response> };
  DB?: D1;
  GOOGLE_CLIENT_ID?: string;
  SESSION_SECRET?: string;
}

const COOKIE = "rg_session";
const send = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const cookie = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function sessionCookie(req: Request) {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m?.[1] ?? null;
}

/**
 * Requests that change something must come from the site itself: a custom header (which a
 * cross-site form can't send, and which makes a cross-site fetch ask permission first) and, when
 * the browser says where it's from, the same origin.
 */
function fromSite(req: Request) {
  if (req.headers.get("x-railgaddi") !== "1") return false;
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

export async function handleApi(req: Request, env: Env, store: Store | null, keys: KeySource = googleKeys, now = Date.now()): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/^.*\/api\//, "/");
  const ready = !!(store && env.GOOGLE_CLIENT_ID && env.SESSION_SECRET);

  if (path === "/config" && req.method === "GET") {
    return send({ signIn: ready ? { google: env.GOOGLE_CLIENT_ID } : null });
  }
  if (!ready) return send({ error: "Accounts aren't set up on this site." }, 503);
  if (req.method !== "GET" && !fromSite(req)) return send({ error: "Not allowed." }, 403);

  if (path === "/session" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as { credential?: unknown } | null;
    const g = typeof body?.credential === "string" ? await verifyGoogle(body.credential, env.GOOGLE_CLIENT_ID!, keys, now) : null;
    if (!g) return send({ error: "Couldn't sign in with that." }, 401);
    const user = { id: g.sub, name: g.name, picture: g.picture };
    await store!.upsertUser(user, now);
    const token = await signSession(g.sub, env.SESSION_SECRET!, 180, now);
    return send({ user: { name: user.name, picture: user.picture } }, 200, { "set-cookie": cookie(token, 180 * 86400) });
  }
  if (path === "/logout" && req.method === "POST") {
    return send({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  const id = await readSession(sessionCookie(req), env.SESSION_SECRET!, now);
  const user = id ? await store!.user(id) : null;
  if (!user) return send({ error: "Not signed in." }, 401, id ? { "set-cookie": cookie("", 0) } : {});

  if (path === "/me" && req.method === "GET") return send({ user: { name: user.name, picture: user.picture } });
  if (path === "/saves" && req.method === "GET") return send({ items: await store!.saves(user.id) });
  if (path === "/saves" && req.method === "PUT") {
    if (Number(req.headers.get("content-length") ?? 0) > 512 * 1024) return send({ error: "Too much at once." }, 413);
    const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
    const items = Array.isArray(body?.items) ? body!.items : null;
    if (!items || items.length > MAX_SAVES || !items.every(validSave)) return send({ error: "Those saves don't look right." }, 400);
    const all = await store!.merge(user.id, items as Saved[]);
    if (all.filter((s) => !s.deleted).length > MAX_SAVES) return send({ error: "That's more than we can keep." }, 413);
    return send({ items: all });
  }
  if (path === "/account" && req.method === "DELETE") {
    await store!.deleteUser(user.id);
    return send({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  return send({ error: "Not found." }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/api/")) {
      return handleApi(req, env, env.DB ? d1Store(env.DB) : null).catch((err) => {
        console.error(err);
        return send({ error: "Something went wrong." }, 500);
      });
    }
    return env.ASSETS!.fetch(req);
  },
};
