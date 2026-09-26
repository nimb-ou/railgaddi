// Loads the prebuilt network (pipeline/build_network.py) and answers
// "where can I go from here?" questions. Nothing in here knows about the map.

export interface Station {
  i: number;
  code: string;
  name: string;
  lat: number | null;
  lon: number | null;
  state: string;
  hi: string;
  local: string;
  halts: number;
}

export interface Place {
  id: string; // city id ("bengaluru") or station code ("HPT")
  name: string;
  hi: string;
  local: string;
  state: string;
  aka: string[];
  stations: number[];
  anchor: number; // station index used to position the place
  lat: number | null;
  lon: number | null;
  isCity: boolean;
  halts: number;
}

export interface Train {
  i: number;
  no: string;
  name: string;
  type: string;
  typeLabel: string;
  st: Int32Array; // station index per point (halts and pass-through timing points)
  arr: Int32Array; // minutes from day-1 00:00, -1 if none
  dep: Int32Array;
  dist: Int32Array; // official distance from origin (halts only), -1 if unknown
  km: Float32Array; // cumulative great-circle km along the points (for drawing)
}

/** One way to ride from the origin to a destination. */
export interface Leg {
  train: Train;
  from: number; // point index of the boarding halt
  to: number; // point index of the alighting halt
  dep: number; // minutes, time of day at boarding (0..1439)
  dur: number; // minutes
  km: number; // rail distance, official where the timetable gives it
  halts: number; // intermediate halts
}

export interface Destination {
  place: Place;
  legs: Leg[];
  fastest: number;
  firstKm: number;
}

export interface Article {
  x: string;
  img?: string | null;
  see?: { n: string; d?: string }[];
  do?: { n: string; d?: string }[];
  alias?: string;
}

export interface Guides {
  meta: { source: string; fetched: string };
  articles: Record<string, Article>;
  stations: Record<string, [string | null, string[]]>;
  cities: Record<string, string>;
}

export interface Network {
  meta: { timetable: string; stations: string; snapshot: string };
  stations: Station[];
  trains: Train[];
  places: Map<string, Place>;
  placeOf: Place[]; // per station index
  trainsAt: number[][]; // per station index: trains that halt there
}

const hav = (a: Station, b: Station) => {
  const p = Math.PI / 180;
  const x =
    Math.sin(((b.lat! - a.lat!) * p) / 2) ** 2 +
    Math.cos(a.lat! * p) * Math.cos(b.lat! * p) * Math.sin(((b.lon! - a.lon!) * p) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
};

export async function loadNetwork(url: string): Promise<Network> {
  const raw = await (await fetch(url)).json();
  const S = raw.stations;
  const stations: Station[] = S.code.map((code: string, i: number) => ({
    i,
    code,
    name: S.name[i],
    lat: S.lat[i],
    lon: S.lon[i],
    state: raw.states[S.state[i]],
    hi: S.hi[i],
    local: S.local[i],
    halts: S.halts[i],
  }));

  const typeLabel = new Map<string, string>(raw.types.map((t: [string, string]) => t));
  const types: string[] = raw.types.map((t: [string, string]) => t[0]);
  const trainsAt: number[][] = stations.map(() => []);

  const trains: Train[] = raw.trains.map(([no, name, ti, flat]: [string, string, number, number[]], i: number) => {
    const n = flat.length / 4;
    const st = new Int32Array(n);
    const arr = new Int32Array(n);
    const dep = new Int32Array(n);
    const dist = new Int32Array(n);
    const km = new Float32Array(n);
    let prev: Station | null = null;
    let acc = 0;
    for (let j = 0; j < n; j++) {
      st[j] = flat[4 * j];
      arr[j] = flat[4 * j + 1];
      dep[j] = flat[4 * j + 2];
      dist[j] = flat[4 * j + 3];
      const s = stations[st[j]];
      if (s.lat !== null) {
        if (prev) acc += hav(prev, s);
        prev = s;
      }
      km[j] = acc;
      if (arr[j] >= 0 || dep[j] >= 0) trainsAt[st[j]].push(i);
    }
    return { i, no, name, type: types[ti], typeLabel: typeLabel.get(types[ti]) ?? types[ti], st, arr, dep, dist, km };
  });

  // Places: curated multi-station cities, then every other station on its own.
  const places = new Map<string, Place>();
  const placeOf: Place[] = new Array(stations.length);
  for (const c of raw.cities) {
    const members: number[] = c.stations;
    const anchor = members.find((m) => stations[m].lat !== null) ?? members[0];
    const p: Place = {
      id: c.id,
      name: c.name,
      hi: c.hi ?? "",
      local: c.local ?? "",
      state: c.state,
      aka: c.aka ?? [],
      stations: members,
      anchor,
      lat: stations[anchor].lat,
      lon: stations[anchor].lon,
      isCity: true,
      halts: members.reduce((a, m) => a + stations[m].halts, 0),
    };
    places.set(p.id, p);
    for (const m of members) placeOf[m] = p;
  }
  for (const s of stations) {
    if (placeOf[s.i]) continue;
    const p: Place = {
      id: s.code,
      name: s.name,
      hi: s.hi,
      local: s.local,
      state: s.state,
      aka: [],
      stations: [s.i],
      anchor: s.i,
      lat: s.lat,
      lon: s.lon,
      isCity: false,
      halts: s.halts,
    };
    places.set(p.id, p);
    placeOf[s.i] = p;
  }

  return { meta: raw.meta, stations, trains, places, placeOf, trainsAt };
}

export async function loadGuides(url: string): Promise<Guides | null> {
  try {
    return await (await fetch(url)).json();
  } catch {
    return null;
  }
}

export const isHalt = (t: Train, j: number) => t.arr[j] >= 0 || t.dep[j] >= 0;

/** All trains that leave `origin`, and every place they reach without a change. */
export function departures(net: Network, origin: Place) {
  const originSet = new Set(origin.stations);
  const boarding: { train: Train; from: number }[] = [];
  const seen = new Set<number>();
  for (const s of origin.stations) {
    for (const ti of net.trainsAt[s]) {
      if (seen.has(ti)) continue;
      seen.add(ti);
      const t = net.trains[ti];
      // board at the first origin station the train *departs* from
      let from = -1;
      for (let j = 0; j < t.st.length; j++) {
        if (originSet.has(t.st[j]) && t.dep[j] >= 0) {
          from = j;
          break;
        }
      }
      if (from < 0) continue;
      // only useful if it halts somewhere outside the origin afterwards
      let useful = false;
      for (let j = from + 1; j < t.st.length && !useful; j++) {
        useful = t.arr[j] >= 0 && !originSet.has(t.st[j]);
      }
      if (useful) boarding.push({ train: t, from });
    }
  }
  boarding.sort((a, b) => (a.train.dep[a.from] % 1440) - (b.train.dep[b.from] % 1440));

  const dests = new Map<Place, Destination>();
  for (const { train: t, from } of boarding) {
    const reached = new Set<Place>();
    let halts = 0;
    for (let j = from + 1; j < t.st.length; j++) {
      if (t.arr[j] < 0) continue;
      const place = net.placeOf[t.st[j]];
      if (place !== origin && !reached.has(place)) {
        reached.add(place);
        const leg: Leg = {
          train: t,
          from,
          to: j,
          dep: t.dep[from] % 1440,
          dur: t.arr[j] - t.dep[from],
          km: t.dist[j] >= 0 && t.dist[from] >= 0 ? t.dist[j] - t.dist[from] : t.km[j] - t.km[from],
          halts,
        };
        let d = dests.get(place);
        if (!d) dests.set(place, (d = { place, legs: [], fastest: Infinity, firstKm: leg.km }));
        d.legs.push(leg);
        if (leg.dur < d.fastest) d.fastest = leg.dur;
        d.firstKm = Math.min(d.firstKm, leg.km);
      }
      if (!originSet.has(t.st[j])) halts++; // only real halts reach this line
    }
  }
  return { boarding, dests };
}

export interface Filters {
  leave: "any" | "2h" | "6h" | "morning" | "night";
  within: number; // max journey minutes, Infinity = any
}

export function legPasses(leg: Leg, f: Filters, nowMin: number) {
  if (leg.dur > f.within) return false;
  const d = leg.dep;
  switch (f.leave) {
    case "any":
      return true;
    case "2h":
      return (d - nowMin + 1440) % 1440 <= 120;
    case "6h":
      return (d - nowMin + 1440) % 1440 <= 360;
    case "morning":
      return d >= 4 * 60 && d < 12 * 60;
    case "night":
      return d >= 19 * 60 || d < 2 * 60;
  }
}

export function searchPlaces(net: Network, q: string, limit = 8): Place[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const scored: [number, Place][] = [];
  for (const p of net.places.values()) {
    if (p.halts === 0) continue;
    let score = 0;
    const name = p.name.toLowerCase();
    const codes = p.stations.map((s) => net.stations[s].code.toLowerCase());
    if (codes.includes(query)) score = 5;
    else if (name.startsWith(query)) score = 4;
    else if (p.aka.some((a) => a.toLowerCase().startsWith(query))) score = 3.5;
    else if (name.split(/[\s(-]+/).some((w) => w.startsWith(query))) score = 3;
    else if (name.includes(query)) score = 2;
    if (!score) continue;
    scored.push([score * 1000 + Math.min(p.halts, 999) + (p.isCity ? 600 : 0), p]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((s) => s[1]);
}

export function guideFor(g: Guides | null, net: Network, place: Place): { title: string; art: Article; nearby: string[] } | null {
  if (!g) return null;
  let title: string | null = place.isCity ? g.cities[place.id] ?? null : null;
  let nearby: string[] = [];
  for (const s of place.stations) {
    const link = g.stations[net.stations[s].code];
    if (!link) continue;
    title ??= link[0];
    nearby = nearby.concat(link[1]);
  }
  const resolve = (t: string) => {
    const a = g.articles[t];
    return a?.alias ? g.articles[a.alias] && a.alias : a ? t : null;
  };
  const main = title ? resolve(title) : null;
  const near = [...new Set(nearby.map(resolve).filter((t): t is string => !!t && t !== main))].slice(0, 4);
  if (!main) return near.length ? { title: "", art: { x: "" }, nearby: near } : null;
  return { title: main, art: g.articles[main], nearby: near };
}
