// Every view has a real address, so it can be shared, bookmarked and indexed:
//   /                                  the landing page
//   /from/bengaluru/                   everywhere you can go from Bengaluru
//   /from/bengaluru/to/hampi/          one place, with the trains that go there
//   /from/bengaluru/to/mysuru/12007/   one train's stops
//   /from/bengaluru/to/amritsar/22691-22429/        a journey with one change
//   /from/bengaluru/to/amritsar/22691-22429/22691/  one of its trains
//   /to/hampi/                         a place, before you've said where you start
// Filters ride along in the query: ?within=360&leave=2h
import type { Filters, Leave } from "../core/trips";

export interface Route {
  origin?: string;
  place?: string;
  train?: string;
  journey?: string; // "22691-22429": the trains of a journey with a change
  within?: number;
  leave?: Leave;
}

const LEAVES: Leave[] = ["any", "2h", "6h", "overnight"];
const base = () => import.meta.env.BASE_URL.replace(/\/$/, "");

export function parse(url: URL = new URL(location.href)): Route {
  const path = url.pathname.slice(base().length).replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const r: Route = {};
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
  return r;
}

export function href(r: Route) {
  let path = "";
  if (r.origin) path += `/from/${encodeURIComponent(r.origin)}`;
  if (r.place) path += `/to/${encodeURIComponent(r.place)}${r.journey ? `/${r.journey}` : ""}${r.train ? `/${r.train}` : ""}`;
  const q = new URLSearchParams();
  if (r.within && r.within !== Infinity) q.set("within", String(r.within));
  if (r.leave && r.leave !== "any") q.set("leave", r.leave);
  const qs = q.toString();
  // trailing slash: every prerendered view is a folder with an index.html, which any static host serves
  return `${base()}${path}/${qs ? `?${qs}` : ""}`;
}

export const filtersOf = (r: Route): Filters => ({ leave: r.leave ?? "any", within: r.within ?? Infinity });

/** Record the current view in the address bar. New places push history; refinements replace it. */
export function go(r: Route, mode: "push" | "replace") {
  const next = href(r);
  if (next === location.pathname + location.search) return;
  if (mode === "push") history.pushState(null, "", next);
  else history.replaceState(null, "", next);
}
