// Places without a railway station of their own (Kodaikanal, Munnar, Manali): where they are,
// which stations to take a train to, and how far the road is from each. The list comes from
// data/spots.json (pipeline/build_spots.py); anything it doesn't know is looked up by name with
// Open-Meteo's place search (GeoNames), only when you search for it.
import type { Network, Place } from "./network";
import { slugify } from "./slugs";

export interface Spot {
  id: string; // slug: /to/kodaikanal/
  name: string;
  state: string;
  lat: number;
  lon: number;
  pop: number;
  aka: string[];
  fromSearch?: boolean; // found by the online place search, not in our list
}

export interface Airport {
  iata: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

interface SpotsFile {
  states: string[];
  spots: [string, number, number, number, number, string][];
  airports: [string, string, string, number, number][];
}

export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The road from a station to a place, estimated: roads wind about a third longer than the
 * straight line, and hill roads average around 35 km/h, plains roads nearer 45.
 */
export function road(straight: number, hills = false) {
  const kms = Math.round(straight * (hills ? 1.45 : 1.3) + 2);
  const mins = Math.round((kms / (hills ? 32 : 45)) * 60 / 5) * 5 + 10;
  return { km: kms, mins };
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export class Spots {
  readonly list: Spot[];
  readonly airports: Airport[];
  private bySlug = new Map<string, Spot>();
  private folded: { s: Spot; name: string; aka: string[] }[];

  constructor(data: SpotsFile, taken: (slug: string) => boolean) {
    this.list = data.spots.map(([name, st, lat, lon, pop, aka]) => ({ id: "", name, state: data.states[st], lat, lon, pop, aka: aka ? aka.split(", ") : [] }));
    // the busiest first get the plain names; a station of the same name keeps its own
    for (const s of [...this.list].sort((a, b) => b.pop - a.pop)) this.claim(s, taken);
    this.airports = data.airports.map(([iata, name, city, lat, lon]) => ({ iata, name, city, lat, lon }));
    this.folded = this.list.map((s) => ({ s, name: fold(s.name), aka: s.aka.map(fold) }));
  }

  private claim(s: Spot, taken: (slug: string) => boolean) {
    const base = slugify(s.name);
    let slug = taken(base) || this.bySlug.has(base) ? `${base}-${slugify(s.state)}` : base;
    if (taken(slug) || this.bySlug.has(slug)) slug = `${slug}-${Math.round(s.lat * 100)}`;
    s.id = slug;
    this.bySlug.set(slug, s);
  }

  find(slug: string) {
    return this.bySlug.get(slug);
  }

  /** A place from the online search: kept for this visit, so its address works. */
  adopt(s: Spot, taken: (slug: string) => boolean) {
    const same = this.list.find((x) => Math.abs(x.lat - s.lat) < 0.02 && Math.abs(x.lon - s.lon) < 0.02);
    if (same) return same;
    this.claim(s, taken);
    return s;
  }

  search(q: string, limit = 3): Spot[] {
    const query = fold(q.trim());
    if (query.length < 3) return [];
    const scored: [number, Spot][] = [];
    for (const { s, name, aka } of this.folded) {
      let score = 0;
      if (name === query || aka.includes(query)) score = 5;
      else if (name.startsWith(query) || aka.some((a) => a.startsWith(query))) score = 3;
      else if (query.length >= 5 && name.includes(query)) score = 1;
      if (score) scored.push([score + Math.log10(1 + s.pop) / 3 + (s.pop === 0 ? 1 : 0), s]); // the famous extras rank up
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
  }
}

/** Places by name from Open-Meteo's geocoder (GeoNames), in India. Only what you typed is sent. */
export async function searchOnline(q: string): Promise<Spot[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q.trim(), count: "6", language: "en", format: "json", countryCode: "IN" })}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const d = (await r.json()) as { results?: { name: string; admin1?: string; latitude: number; longitude: number; population?: number; feature_code?: string }[] };
  return (d.results ?? [])
    .filter((x) => !x.feature_code || /^(PPL|ADM|PRK|RSRT|VAL|LK|MT|PK|HLL|ISL|FLLS|BCH|AREA)/.test(x.feature_code))
    .map((x) => ({ id: "", name: x.name.normalize("NFKD").replace(/[̀-ͯ]/g, ""), state: x.admin1 ?? "", lat: x.latitude, lon: x.longitude, pop: x.population ?? 0, aka: [], fromSearch: true }));
}

export interface StationChoice {
  place: Place;
  straight: number; // km as the crow flies
  road: { km: number; mins: number };
}

/**
 * The stations worth taking a train to, for a place without one: the closest few, but a busy
 * junction a little further beats a halt two trains a day stop at.
 */
export function nearestStations(net: Network, at: { lat: number; lon: number }, n = 4): StationChoice[] {
  const hills = isHilly(at);
  const all: (StationChoice & { score: number })[] = [];
  for (const p of net.places.values()) {
    if (p.lat === null || p.lon === null || p.halts < 2) continue;
    const d = km(at, { lat: p.lat, lon: p.lon });
    if (d > 350) continue;
    const r = road(d, hills);
    // fewer trains cost you: a station with 4 trains a day is often not the one to aim for
    const score = r.mins + (p.halts < 6 ? 180 : p.halts < 20 ? 100 : p.halts < 60 ? 50 : p.halts < 120 ? 15 : 0);
    all.push({ place: p, straight: d, road: r, score });
  }
  all.sort((a, b) => a.score - b.score);
  // one station per town, and never more than twice as far as the best
  const out: StationChoice[] = [];
  for (const c of all) {
    if (out.length >= n) break;
    if (out.length && c.road.mins > out[0].road.mins * 2.2 + 60) break;
    if (out.some((o) => km({ lat: o.place.lat!, lon: o.place.lon! }, { lat: c.place.lat!, lon: c.place.lon! }) < 6)) continue;
    out.push(c);
  }
  return out;
}

export function nearestAirports(list: Airport[], at: { lat: number; lon: number }, n = 2) {
  return list
    .map((a) => ({ a, straight: km(at, a) }))
    .sort((x, y) => x.straight - y.straight)
    .slice(0, n)
    .map(({ a, straight }) => ({ airport: a, straight, road: road(straight, isHilly(at)) }));
}

/** The Himalaya, the Western Ghats and the north-east hills, roughly: slower roads. */
function isHilly({ lat, lon }: { lat: number; lon: number }) {
  if (lat > 29.8 && lon < 81.5) return true; // Himachal, Uttarakhand, Kashmir, Ladakh
  if (lat > 26.4 && lon > 88) return true; // Sikkim, Darjeeling, the north-east
  if (lat < 13 && lon > 75.4 && lon < 77.8 && lat > 9) return true; // Nilgiris, Palani hills, Munnar, Coorg
  return false;
}
