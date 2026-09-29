// Signing in: check a Google ID token (from Google's sign-in button) and keep the visitor signed
// in with our own session token, an HMAC-signed cookie. Runs on the Worker; also tested in Node.

const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s)));

export interface GoogleUser {
  sub: string;
  name: string;
  picture: string;
}

/** Google's signing keys, by key id. Fetched from Google and kept for an hour. */
export type KeySource = (kid: string) => Promise<CryptoKey | null>;

const JWKS = "https://www.googleapis.com/oauth2/v3/certs";
let cached: { until: number; keys: Map<string, CryptoKey> } | null = null;

export const googleKeys: KeySource = async (kid) => {
  if (!cached || cached.until < Date.now() || !cached.keys.has(kid)) {
    const r = await fetch(JWKS);
    if (!r.ok) return null;
    const { keys } = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] };
    const map = new Map<string, CryptoKey>();
    for (const k of keys) map.set(k.kid, await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    cached = { until: Date.now() + 3600_000, keys: map };
  }
  return cached.keys.get(kid) ?? null;
};

/**
 * The account in a Google ID token, if the token is genuine: signed by Google (RS256), issued
 * by Google, for this site's client id, and not expired. Anything else: null.
 */
export async function verifyGoogle(token: string, clientId: string, keys: KeySource = googleKeys, now = Date.now()): Promise<GoogleUser | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !clientId) return null;
  try {
    const head = json(parts[0]);
    const body = json(parts[1]);
    if (head.alg !== "RS256" || typeof head.kid !== "string") return null;
    const key = await keys(head.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    if (body.iss !== "accounts.google.com" && body.iss !== "https://accounts.google.com") return null;
    if (body.aud !== clientId) return null;
    if (typeof body.exp !== "number" || body.exp * 1000 < now - 60_000) return null;
    if (typeof body.sub !== "string" || !body.sub) return null;
    return { sub: body.sub, name: String(body.given_name || body.name || "").slice(0, 80), picture: String(body.picture || "").slice(0, 300) };
  } catch {
    return null;
  }
}

const hmacKey = (secret: string) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** A session token for this account id, valid for `days`. */
export async function signSession(sub: string, secret: string, days = 180, now = Date.now()) {
  const payload = b64url(enc.encode(JSON.stringify({ sub, exp: now + days * 86400_000 })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/** The account id in a session token we issued, if it's intact and unexpired. */
export async function readSession(token: string | null | undefined, secret: string, now = Date.now()): Promise<string | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(sig), enc.encode(payload));
    if (!ok) return null;
    const { sub, exp } = json(payload);
    return typeof sub === "string" && typeof exp === "number" && exp > now ? sub : null;
  } catch {
    return null;
  }
}
