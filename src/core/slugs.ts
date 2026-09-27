// Stable, readable URL names for places: /from/bengaluru/to/hampi.
// The same function runs in the browser and in the prerender, so links always agree.
import type { Network, Place } from "./network";
import type { GuideView } from "./places";

export function slugify(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Short display name for a place: "Mysuru", "Hampi" (for Hosapete), "Kengeri". */
export function titleOf(p: Place, gv: GuideView | null | undefined) {
  if (gv?.featured) return gv.title;
  return p.name.replace(/\s+(Junction|Jn\.?)$/i, "").replace(/\s*\((.+)\)$/, "");
}

export interface Slugs {
  of(p: Place): string;
  find(slug: string): Place | undefined;
}

export function buildSlugs(net: Network, guides: Map<Place, GuideView>): Slugs {
  const bySlug = new Map<string, Place>();
  const byPlace = new Map<Place, string>();
  // cities keep their ids; then the busiest stations get the plainest names
  const order = [...net.places.values()].sort((a, b) => Number(b.isCity) - Number(a.isCity) || b.halts - a.halts || a.id.localeCompare(b.id));
  for (const p of order) {
    const base = p.isCity ? p.id : slugify(titleOf(p, guides.get(p))) || p.id.toLowerCase();
    let slug = base;
    if (bySlug.has(slug)) slug = `${base}-${p.id.toLowerCase()}`;
    bySlug.set(slug, p);
    byPlace.set(p, slug);
  }
  return {
    of: (p) => byPlace.get(p)!,
    find: (s) => bySlug.get(s.toLowerCase()) ?? net.places.get(s) ?? net.places.get(s.toUpperCase()),
  };
}
