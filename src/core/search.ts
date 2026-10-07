// Find a city or station as you type: by name, old name, station code, local script, one of a
// city's own stations ("Mumbai Central"), the famous place next to it ("Hampi" finds Hosapete),
// and, when nothing matches as typed, with a slip or two forgiven ("banglore", "darjiling").
import { forgive, slips } from "./fuzzy";
import type { Network, Place, Train } from "./network";
import type { GuideView } from "./places";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** What people add that isn't the name: "jaipur jn", "pune station", "ndls railway station". */
const tidy = (q: string) =>
  fold(q.trim())
    .replace(/[.,]/g, " ")
    .replace(/\s+(jn|jct|junction|rly|railway|stn|station|railway station|rly stn)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface Entry {
  p: Place;
  name: string;
  words: string[];
  codes: string[];
  aka: string[];
  guide: string;
  gv: GuideView | undefined;
  members: string[]; // a city's own stations, by name ("mumbai central", "dadar")
}

// names folded once per network and guide index, not on every keystroke
const entries = new WeakMap<Map<Place, GuideView>, Entry[]>();
const bare = (s: string) => s.replace(/\s+(junction|jn\.?|terminus|terminal|\(t\))$/i, "");

function entriesOf(net: Network, guides: Map<Place, GuideView>): Entry[] {
  let list = entries.get(guides);
  if (!list) {
    list = [];
    for (const p of net.places.values()) {
      if (!p.halts) continue;
      const gv = guides.get(p);
      const name = fold(p.name);
      list.push({
        p,
        name,
        words: name.split(/[\s(-]+/),
        codes: p.stations.map((s) => net.stations[s].code.toLowerCase()),
        aka: p.aka.map(fold),
        guide: gv ? fold(gv.title) : "",
        gv,
        members: p.isCity ? p.stations.map((s) => fold(bare(net.stations[s].name))).filter((n) => n !== name) : [],
      });
    }
    entries.set(guides, list);
  }
  return list;
}

export interface PlaceHit {
  p: Place;
  score: number;
  /** Matched one of a city's stations ("Mumbai Central"), or a name with a slip ("Bangalore"). */
  via?: string;
  /** Reads as what you typed (the name, a known name, a city's station, or their start). */
  strong: boolean;
  /** Slips forgiven to match (0 when it reads as typed). */
  slip: number;
}

/** Places for a query, best first, with how well each matched (4 and up: what you typed, or its start). */
export function searchPlaceHits(net: Network, guides: Map<Place, GuideView>, q: string, limit = 8): PlaceHit[] {
  const query = tidy(q);
  if (!query) return [];
  const raw = q.trim();
  const hits: PlaceHit[] = [];
  const rank = (p: Place, score: number) => score + 0.3 * Math.log10(1 + p.halts) + (p.isCity ? 0.6 : 0); // the busier station and the city first
  const list = entriesOf(net, guides);
  for (const { p, name, words, codes, aka, guide, gv, members } of list) {
    let score = 0;
    let via: string | undefined;
    if (codes.includes(query)) score = 5; // "sbc", "ndls" (but a place called "Goa" beats the station coded GOA)
    else if (name === query) score = 4.6;
    else if (guide === query && !gv!.featured) score = 4.5; // its own guide: "Katra" is Shri Mata Vaishno Devi Katra
    else if (aka.some((a) => a.startsWith(query))) score = 4.3; // Bangalore, Habibganj: the names people know
    else if (members.includes(query)) [score, via] = [4.25, query]; // "mumbai central", "chennai egmore": the city
    else if (name.startsWith(query)) score = 4;
    else if (query.length >= 4 && members.some((m) => m.startsWith(query))) [score, via] = [3.6, members.find((m) => m.startsWith(query))];
    else if (gv && guide.startsWith(query)) score = 3.2 + Math.min(1, gv.entry.appeal / 40); // "Hampi": famous places first
    else if (words.some((w) => w.startsWith(query))) score = 3;
    else if (p.hi.startsWith(raw) || p.local.startsWith(raw)) score = 3;
    else if (name.includes(query)) score = 2;
    if (score) hits.push({ p, score: rank(p, score), via, strong: score >= 3.6, slip: 0 });
  }
  // nothing that reads as what you typed: forgive a slip ("banglore" is Bangalore, "dehli" Delhi)
  const strong = hits.filter((h) => h.score >= 3.3).length; // (scores here include the busy-station lift)
  if (strong < 3 && forgive(query)) {
    const seen = new Set(hits.map((h) => h.p));
    const byGuide = new Map<string, PlaceHit>(); // a guide's many stations: only its best (Delhi, not Sadar Bazar)
    for (const { p, name, aka, guide, gv } of list) {
      if (seen.has(p)) continue;
      let best = Infinity;
      let via: string | undefined;
      let viaGuide = false;
      for (const [n, label, g] of [[name, "", false], ...aka.map((a) => [a, a, false] as const), ...(gv && gv.entry.appeal >= 20 ? [[guide, guide, true] as const] : [])] as [string, string, boolean][]) {
        const d = slips(query, n);
        if (d < best) [best, via, viaGuide] = [d, label || undefined, g];
      }
      if (best === Infinity) continue;
      const hit = { p, score: rank(p, 2.4 - 0.5 * best), via, strong: false, slip: best };
      if (!viaGuide) hits.push(hit);
      else if ((byGuide.get(guide)?.score ?? -1) < hit.score) byGuide.set(guide, hit);
    }
    const named = new Set(hits.map((h) => (guides.get(h.p)?.title ?? "")));
    for (const [g, h] of byGuide) if (!named.has(guides.get(h.p)!.title) || g === "") hits.push(h);
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchPlaces(net: Network, guides: Map<Place, GuideView>, q: string, limit = 8): Place[] {
  return searchPlaceHits(net, guides, q, limit).map((h) => h.p);
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
