// Saved places (the bucket list) and routes. They live on this device first, so saving works
// without an account, offline, and on hosts without the API. Signed in with Google, they're
// merged with the account's copy (worker/) and follow you to other devices.
import { mergeSaves, prune, type Saved } from "../core/saves";

const KEY = "railgaddi.saves";
const API = `${import.meta.env.BASE_URL}api`;

export interface Account {
  name: string;
  picture: string;
}

interface GoogleId {
  accounts: {
    id: {
      initialize(o: Record<string, unknown>): void;
      renderButton(el: HTMLElement, o: Record<string, unknown>): void;
      disableAutoSelect(): void;
    };
  };
}

function load(): Saved[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, {
      method,
      credentials: "same-origin",
      headers: { "x-railgaddi": "1", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    return (await r.json()) as T;
  } catch {
    return null; // offline, or a host without the API
  }
}

export class Saves {
  items: Saved[] = load();
  account: Account | null = null;
  /** Google's client id when this site can sign people in; null on hosts without accounts. */
  clientId: string | null = null;
  private listeners = new Set<() => void>();
  private syncTimer = 0;
  private google: Promise<GoogleId | null> | null = null;

  constructor() {
    // another tab saved something: pick it up
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      this.items = load();
      this.emit();
    });
    window.addEventListener("online", () => this.account && this.sync());
  }

  on(fn: () => void) {
    this.listeners.add(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** What's saved (not removed), newest first. */
  live(kind?: Saved["kind"]) {
    return this.items.filter((s) => !s.deleted && (!kind || s.kind === kind));
  }

  has(key: string) {
    return this.items.some((s) => s.key === key && !s.deleted);
  }

  /** Save or unsave; returns whether it's saved now. */
  toggle(item: Omit<Saved, "at" | "deleted">): boolean {
    const on = !this.has(item.key);
    const next: Saved = { ...item, at: Date.now(), ...(on ? {} : { deleted: true }) };
    this.items = prune(mergeSaves(this.items, [next]));
    this.persist();
    return on;
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch {
      /* storage full or blocked: still saved for this visit */
    }
    this.emit();
    if (this.account) {
      clearTimeout(this.syncTimer);
      this.syncTimer = window.setTimeout(() => this.sync(), 800);
    }
  }

  /** Is there an account API here, and is someone signed in? Quiet if not. */
  async init() {
    if (location.hostname.endsWith(".github.io")) return; // static hosting only: no accounts there
    const cfg = await api<{ signIn: { google: string } | null }>("GET", "/config");
    this.clientId = cfg?.signIn?.google ?? null;
    if (!this.clientId) return;
    const me = await api<{ user: Account }>("GET", "/me");
    if (me?.user) {
      this.account = me.user;
      this.emit();
      await this.sync();
    }
  }

  /** Send this device's saves, take back the merged set. */
  async sync() {
    const r = await api<{ items: Saved[] }>("PUT", "/saves", { items: this.items });
    if (!r) return;
    this.items = prune(mergeSaves(this.items, r.items));
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch {
      /* fine */
    }
    this.emit();
  }

  /** Google's own sign-in button, in `el`. Loads Google's script the first time. */
  async renderSignIn(el: HTMLElement, dark: boolean, onError: (msg: string) => void) {
    if (!this.clientId) return;
    this.google ??= new Promise<GoogleId | null>((resolve) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => {
        const g = (window as unknown as { google?: GoogleId }).google ?? null;
        g?.accounts.id.initialize({
          client_id: this.clientId,
          callback: async (res: { credential?: string }) => {
            const r = res.credential ? await api<{ user: Account }>("POST", "/session", { credential: res.credential }) : null;
            if (!r?.user) return onError("Couldn't sign you in. Try again in a moment.");
            this.account = r.user;
            this.emit();
            await this.sync();
          },
          use_fedcm_for_prompt: true,
          itp_support: true,
        });
        resolve(g);
      };
      s.onerror = () => resolve(null);
      document.head.append(s);
    });
    const g = await this.google;
    if (!g) {
      this.google = null;
      return onError("Couldn't reach Google to sign in. Check your connection.");
    }
    if (!el.isConnected) return;
    el.innerHTML = "";
    g.accounts.id.renderButton(el, { theme: dark ? "filled_black" : "outline", size: "large", shape: "pill", text: "signin_with", logo_alignment: "left", width: 260 });
  }

  async signOut() {
    await api("POST", "/logout");
    (await this.google)?.accounts.id.disableAutoSelect();
    this.account = null;
    this.emit(); // saves stay on this device
  }

  /** Delete the account and everything saved in it (this device keeps its own copy). */
  async deleteAccount() {
    const r = await api<{ ok: boolean }>("DELETE", "/account");
    if (!r?.ok) return false;
    this.account = null;
    this.emit();
    return true;
  }
}
