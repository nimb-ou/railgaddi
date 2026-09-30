// Find a city or station as you type: by name, old name, station code, local script,
// or the famous place next to it ("Hampi" finds Hosapete).
import type { Network, Place, Train } from "./network";
import type { GuideView } from "./places";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Entry {
  p: Place;
  name: string;
  words: string[];
  codes: string[];
  aka: string[];
  guide: string;
  gv: GuideView | undefined;
}

// names folded once per network and guide index, not on every keystroke
const entries = new WeakMap<Map<Place, GuideView>, Entry[]>();

function entriesOf(net: Network, guides: Map<Place, GuideView>): Entry[] {
  let list = entries.get(guides);
  if (!list) {
    list = [];
    for (const p of net.places.values()) {
      if (!p.halts) continue;
      const gv = guides.get(p);
      const name = fold(p.name);
      list.push({ p, name, words: name.split(/[\s(-]+/), codes: p.stations.map((s) => net.stations[s].code.toLowerCase()), aka: p.aka.map(fold), guide: gv ? fold(gv.title) : "", gv });
    }
    entries.set(guides, list);
  }
  return list;
}

export function searchPlaces(net: Network, guides: Map<Place, GuideView>, q: string, limit = 8): Place[] {
  const query = fold(q.trim());
  if (!query) return [];
  const raw = q.trim();
  const scored: [number, Place][] = [];
  for (const { p, name, words, codes, aka, guide, gv } of entriesOf(net, guides)) {
    let score = 0;
    if (codes.includes(query)) score = 5; // "sbc", "ndls" (but a place called "Goa" beats the station coded GOA)
    else if (name === query) score = 4.6;
    else if (guide === query && !gv!.featured) score = 4.5; // its own guide: "Katra" is Shri Mata Vaishno Devi Katra
    else if (aka.some((a) => a.startsWith(query))) score = 4.3; // Bangalore, Habibganj: the names people know
    else if (name.startsWith(query)) score = 4;
    else if (gv && guide.startsWith(query)) score = 3.2 + Math.min(1, gv.entry.appeal / 40); // "Hampi": famous places first
    else if (words.some((w) => w.startsWith(query))) score = 3;
    else if (p.hi.startsWith(raw) || p.local.startsWith(raw)) score = 3;
    else if (name.includes(query)) score = 2;
    if (!score) continue;
    // among equally good matches, the busier station and the city first
    scored.push([score + 0.3 * Math.log10(1 + p.halts) + (p.isCity ? 0.6 : 0), p]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((s) => s[1]);
}

const trainNames = new WeakMap<Network, string[]>();
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
  // "toy train": the hill railways' little trains
  if (/^toy(\s*trains?)?$/.test(query)) return net.trains.filter((t) => t.type === "Toy").sort((a, b) => a.st.length - b.st.length).slice(0, 8);
  if (query.length < 4 || /^(express|superfast|special|passenger|mail|train|junction)/.test(query)) return [];
  let names = trainNames.get(net);
  if (!names) trainNames.set(net, (names = net.trains.map((t) => fold(t.name))));
  const scored: [number, Train][] = [];
  for (const t of net.trains) {
    const name = names[t.i];
    const at = name.indexOf(query);
    if (at < 0) continue;
    // a word that starts with the query beats one that merely contains it; premium trains first
    const word = at === 0 || /[\s(–-]/.test(name[at - 1]) ? 2 : 0;
    scored.push([word + (PREMIUM.has(t.type) ? 1 : 0), t]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].no.localeCompare(b[1].no)).slice(0, limit).map((s) => s[1]);
}
