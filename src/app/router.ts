// Every view has a real address, so it can be shared, bookmarked and indexed:
//   /                                  the landing page
//   /from/bengaluru/                   everywhere you can go from Bengaluru
//   /from/bengaluru/to/hampi/          one place, with the trains that go there
//   /from/bengaluru/to/mysuru/12007/   one train's stops
//   /from/bengaluru/to/amritsar/22691-22429/        a journey with one change
//   /from/bengaluru/to/amritsar/22691-22429/22691/  one of its trains
//   /to/hampi/                         a place, before you've said where you start
//   /discover/                         journeys worth taking, facts, records
//   /discover/konkan-railway/          one journey's story
//   /to/kodaikanal/                    a place without a station: the stations to take a train to
//   /trip/?stops=bengaluru,hampi,goa&nights=0,2,3&date=2026-10-10   a trip with several stops
// Filters ride along in the query: ?within=360&leave=2h&trains=local&mood=hills&good=month
import { MOODS, type Mood } from "../core/climate";
import type { Filters, Kind, Leave } from "../core/trips";

export interface Route {
  origin?: string;
  place?: string;
  train?: string;
  journey?: string; // "22691-22429": the trains of a journey with a change
  discover?: string; // "" for Discover itself, or a story's slug
  within?: number;
  leave?: Leave;
  kind?: Kind;
  mood?: Mood; // only places of this kind (by the sea, in the hills, ...)
  good?: boolean; // only places whose weather is good this month
  at?: string; // "32.01,77.32": where a place found by the online search is (it isn't in our list)
  trip?: { stops: string[]; nights: number[]; date: string }; // a trip's stops (slugs), nights at each, first day
}

const LEAVES: Leave[] = ["any", "2h", "6h", "overnight", "weekend"];
const KINDS: Kind[] = ["all", "long", "local", "toy"];
const base = () => import.meta.env.BASE_URL.replace(/\/$/, "");

export function parse(url: URL = new URL(location.href)): Route {
  const path = url.pathname.slice(base().length).replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const r: Route = {};
  if (parts[0] === "discover") {
    r.discover = parts[1] && /^[a-z0-9-]+$/.test(parts[1]) ? parts[1] : "";
    return r;
  }
  if (parts[0] === "trip") {
    const stops = (url.searchParams.get("stops") ?? "").split(",").filter((x) => /^[a-z0-9-]+$/i.test(x)).slice(0, 12);
    const nights = (url.searchParams.get("nights") ?? "").split(",").map((n) => Math.max(0, Math.min(30, Number(n) || 0)));
    const date = url.searchParams.get("date") ?? "";
    r.trip = { stops, nights, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "" };
    return r;
  }
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "from" && parts[i + 1]) r.origin = parts[++i];
    else if (parts[i] === "to" && parts[i + 1]) {
      r.place = parts[++i];
      if (parts[i + 1] && /^\d{4,5}-\d{4,5}$/.test(parts[i + 1])) r.journey = parts[++i];
      if (parts[i + 1] && /^\d{4,5}$/.test(parts[i + 1])) r.train = parts[++i];
    }
  }
  const within = Number(url.searchParams.get("within"));
  if (within > 0) r.within = within;
  const leave = url.searchParams.get("leave") as Leave | null;
  if (leave && LEAVES.includes(leave)) r.leave = leave;
  const at = url.searchParams.get("at");
  if (at && /^\d{1,2}\.\d{1,4},\d{2,3}\.\d{1,4}$/.test(at)) r.at = at;
  const kind = url.searchParams.get("trains") as Kind | null;
  if (kind && KINDS.includes(kind)) r.kind = kind;
  const mood = url.searchParams.get("mood");
  if (mood && mood in MOODS) r.mood = mood as Mood;
  if (url.searchParams.get("good") === "month") r.good = true;
  return r;
}

export function href(r: Route) {
  if (r.discover !== undefined) return `${base()}/discover/${r.discover ? `${r.discover}/` : ""}`;
  if (r.trip) {
    const q = new URLSearchParams();
    if (r.trip.stops.length) q.set("stops", r.trip.stops.join(","));
    if (r.trip.nights.some((n) => n)) q.set("nights", r.trip.nights.join(","));
    if (r.trip.date) q.set("date", r.trip.date);
    const qs = q.toString().replace(/%2C/g, ",");
    return `${base()}/trip/${qs ? `?${qs}` : ""}`;
  }
  let path = "";
  if (r.origin) path += `/from/${encodeURIComponent(r.origin)}`;
  if (r.place) path += `/to/${encodeURIComponent(r.place)}${r.journey ? `/${r.journey}` : ""}${r.train ? `/${r.train}` : ""}`;
  const q = new URLSearchParams();
  if (r.within && r.within !== Infinity) q.set("within", String(r.within));
  if (r.leave && r.leave !== "any") q.set("leave", r.leave);
  if (r.kind && r.kind !== "all") q.set("trains", r.kind);
  if (r.mood) q.set("mood", r.mood);
  if (r.good) q.set("good", "month");
  if (r.at) q.set("at", r.at);
  const qs = q.toString();
  // trailing slash: every prerendered view is a folder with an index.html, which any static host serves
  return `${base()}${path}/${qs ? `?${qs.replace(/%2C/g, ",")}` : ""}`;
}

export const filtersOf = (r: Route): Filters => ({ leave: r.leave ?? "any", within: r.within ?? Infinity, kind: r.kind ?? "all" });

/** Record the current view in the address bar. New places push history; refinements replace it. */
export function go(r: Route, mode: "push" | "replace") {
  const next = href(r);
  if (next === location.pathname + location.search) return;
  if (mode === "push") history.pushState(null, "", next);
  else history.replaceState(null, "", next);
}
