// Find a city or station as you type: by name, old name, station code, local script,
// or the famous place next to it ("Hampi" finds Hosapete).
import type { Network, Place, Train } from "./network";
import type { GuideView } from "./places";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function searchPlaces(net: Network, guides: Map<Place, GuideView>, q: string, limit = 8): Place[] {
  const query = fold(q.trim());
  if (!query) return [];
  const scored: [number, Place][] = [];
  for (const p of net.places.values()) {
    if (!p.halts) continue;
    const name = fold(p.name);
    const codes = p.stations.map((s) => net.stations[s].code.toLowerCase());
    const gv = guides.get(p);
    const guide = gv ? fold(gv.title) : "";
    let score = 0;
    if (codes.includes(query)) score = 5; // "sbc", "ndls" (but a place called "Goa" beats the station coded GOA)
    else if (name === query) score = 4.6;
    else if (guide === query && !gv!.featured) score = 4.5; // its own guide: "Katra" is Shri Mata Vaishno Devi Katra
    else if (p.aka.some((a) => fold(a).startsWith(query))) score = 4.3; // Bangalore, Habibganj: the names people know
    else if (name.startsWith(query)) score = 4;
    else if (gv && guide.startsWith(query)) score = 3.2 + Math.min(1, gv.entry.appeal / 40); // "Hampi": famous places first
    else if (name.split(/[\s(-]+/).some((w) => w.startsWith(query))) score = 3;
    else if (p.hi.startsWith(q.trim()) || p.local.startsWith(q.trim())) score = 3;
    else if (name.includes(query)) score = 2;
    if (!score) continue;
    // among equally good matches, the busier station and the city first
    scored.push([score + 0.3 * Math.log10(1 + p.halts) + (p.isCity ? 0.6 : 0), p]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((s) => s[1]);
}

const PREMIUM = new Set(["Raj", "Shtb", "Drnt", "VB", "JShtb", "GR", "AB"]);

/**
 * Trains by number ("126" -> 12601…, "12627" -> the Karnataka Express) or by name ("deccan"
 * -> the Deccan Queen). Names need four letters, so a place search isn't swamped by "express".
 */
export function searchTrains(net: Network, q: string, limit = 3): Train[] {
  const query = fold(q.trim());
  if (/^\d{3,5}$/.test(query)) {
    return net.trains.filter((t) => t.no.startsWith(query)).sort((a, b) => a.no.localeCompare(b.no)).slice(0, limit * 2);
  }
  if (query.length < 4 || /^(express|superfast|special|passenger|mail|train|junction)/.test(query)) return [];
  const scored: [number, Train][] = [];
  for (const t of net.trains) {
    const name = fold(t.name);
    const at = name.indexOf(query);
    if (at < 0) continue;
    // a word that starts with the query beats one that merely contains it; premium trains first
    const word = at === 0 || /[\s(–-]/.test(name[at - 1]) ? 2 : 0;
    scored.push([word + (PREMIUM.has(t.type) ? 1 : 0), t]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].no.localeCompare(b[1].no)).slice(0, limit).map((s) => s[1]);
}
