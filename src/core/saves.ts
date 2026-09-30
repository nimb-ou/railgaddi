// What someone saves: places for their bucket list, and routes (from -> to, optionally the
// journey's trains). Kept on the device; merged with the account's copy when signed in. Shared
// by the site and the Worker (worker/), so both merge and check items the same way.

export type SaveKind = "place" | "route" | "trip";

export interface PlaceSave {
  slug: string;
  title: string;
  state?: string;
}

export interface RouteSave {
  from: string; // place slugs
  to: string;
  fromTitle: string;
  toTitle: string;
  journey?: string; // "22691-12013": the trains of a journey with a change
}

/** A planned trip: its stops (place slugs), the nights at each, and the first day. */
export interface TripSave {
  title: string; // "Bengaluru → Hampi → Goa"
  stops: string[];
  nights: number[];
  date: string; // YYYY-MM-DD, or "" for "whenever"
}

export interface Saved {
  key: string; // "place:hampi", "route:bengaluru>hampi", "route:bengaluru>amritsar:22691-12013", "trip:bengaluru,hampi,goa"
  kind: SaveKind;
  data: PlaceSave | RouteSave | TripSave;
  at: number; // ms; when it was saved or removed: the latest wins
  deleted?: boolean; // removed (kept a while so the removal reaches other devices)
}

export const placeKey = (slug: string) => `place:${slug}`;
export const tripKey = (t: Pick<TripSave, "stops">) => `trip:${t.stops.join(",")}`;
export const routeKey = (r: Pick<RouteSave, "from" | "to" | "journey">) => `route:${r.from}>${r.to}${r.journey ? `:${r.journey}` : ""}`;

/** Two copies of someone's saves (this device, their account) become one: per item, the latest wins. */
export function mergeSaves(a: Saved[], b: Saved[]): Saved[] {
  const out = new Map<string, Saved>();
  for (const s of [...a, ...b]) {
    const prev = out.get(s.key);
    if (!prev || s.at > prev.at || (s.at === prev.at && s.deleted && !prev.deleted)) out.set(s.key, s);
  }
  return [...out.values()].sort((x, y) => y.at - x.at);
}

/** Removals older than this are forgotten: every device has had time to hear about them. */
export const FORGET_AFTER = 90 * 86400_000;

export function prune(items: Saved[], now = Date.now()) {
  return items.filter((s) => !s.deleted || now - s.at < FORGET_AFTER);
}

export const MAX_SAVES = 2000;
const SLUG = /^[a-z0-9-]{1,80}$/;
const TRAINS = /^\d{4,5}-\d{4,5}$/;
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;

/** Is this a well-formed save? (The Worker checks everything it's sent.) */
export function validSave(s: unknown): s is Saved {
  if (!s || typeof s !== "object") return false;
  const x = s as Saved;
  if (!text(x.key, 200) || typeof x.at !== "number" || !Number.isFinite(x.at) || x.at < 0) return false;
  if (x.deleted !== undefined && typeof x.deleted !== "boolean") return false;
  const d = x.data as unknown as Record<string, unknown>;
  if (!d || typeof d !== "object") return false;
  if (x.kind === "place") {
    return SLUG.test(String(d.slug)) && text(d.title, 120) && (d.state === undefined || text(d.state, 60)) && x.key === placeKey(String(d.slug));
  }
  if (x.kind === "route") {
    const journey = d.journey === undefined || TRAINS.test(String(d.journey));
    return SLUG.test(String(d.from)) && SLUG.test(String(d.to)) && text(d.fromTitle, 120) && text(d.toTitle, 120) && journey &&
      x.key === routeKey({ from: String(d.from), to: String(d.to), journey: d.journey as string | undefined });
  }
  if (x.kind === "trip") {
    const stops = d.stops as unknown;
    const nights = d.nights as unknown;
    return Array.isArray(stops) && stops.length >= 2 && stops.length <= 12 && stops.every((v) => SLUG.test(String(v))) &&
      Array.isArray(nights) && nights.length <= 12 && nights.every((n) => Number.isInteger(n) && n >= 0 && n <= 30) &&
      text(d.title, 300) && (d.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) && x.key === tripKey({ stops: stops as string[] });
  }
  return false;
}
