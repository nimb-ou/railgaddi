// Find a city or station as you type: by name, old name, station code, local script,
// or the famous place next to it ("Hampi" finds Hosapete).
import type { Network, Place } from "./network";
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
    let score = 0;
    if (codes.includes(query)) score = 5;
    else if (name.startsWith(query)) score = 4;
    else if (p.aka.some((a) => fold(a).startsWith(query))) score = 4.3; // Bangalore, Habibganj: the names people know
    else if (gv && fold(gv.title).startsWith(query)) score = 3.2 + Math.min(1, gv.entry.appeal / 40); // "Hampi": famous places first
    else if (name.split(/[\s(-]+/).some((w) => w.startsWith(query))) score = 3;
    else if (p.hi.startsWith(q.trim()) || p.local.startsWith(q.trim())) score = 3;
    else if (name.includes(query)) score = 2;
    if (!score) continue;
    scored.push([score * 1000 + Math.min(p.halts, 999) + (p.isCity ? 600 : 0), p]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((s) => s[1]);
}
