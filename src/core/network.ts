// The railway network: stations, places and every train's halts, decoded from the compact files
// written by pipeline/build_network.py (layouts in ARCHITECTURE.md). No DOM in here.

export interface Station {
  i: number;
  code: string;
  name: string;
  lat: number | null;
  lon: number | null;
  state: string;
  hi: string;
  local: string;
  halts: number; // how many trains stop here
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

/** A polyline for drawing: stations with coordinates, in running order, with km along the line. */
export interface Geom {
  st: Int32Array;
  km: Float32Array;
}

export interface Train {
  i: number;
  no: string;
  name: string;
  type: string;
  typeLabel: string;
  /** One entry per halt. Times are minutes from 00:00 on day 1; -1 = none (origin arr, terminus dep). */
  st: Uint16Array;
  arr: Int32Array;
  dep: Int32Array;
  dist: Int32Array; // official km from the origin
  km: Float32Array; // km along the drawn line, at each halt
  geom: Geom;
  /** Days it leaves its origin: bit 0 = Monday … bit 6 = Sunday; 0 = not known. */
  days: number;
}

/** A train we know runs (from Wikipedia) but whose halts and times we don't have yet. */
export interface NewerTrain {
  numbers: string; // "20703/20704"
  name: string;
  type: string;
  from: number; // station index of one end
  to: number; // and the other
  days: number; // as Train.days, 0 = not known
  perWeek: number; // 0 = not known
  minutes: number; // end to end, 0 = not known
  km: number;
  stops: number; // intermediate stops, 0 = not known
  src: string;
}

export interface MetaFile {
  meta: { timetable: string; stations: string; snapshot: string };
  types: [string, string][];
  states: string[];
  stations: {
    code: string[];
    name: string[];
    lat: (number | null)[];
    lon: (number | null)[];
    state: number[];
    hi: string[];
    local: string[];
    halts: number[];
  };
  cities: { id: string; name: string; hi: string; local: string; aka: string[]; state: string; stations: number[] }[];
  trains: [string, string][];
  newer?: [string, string, string, number, number, number, number, number, number, number, string][];
}

export interface Network {
  meta: MetaFile["meta"];
  stations: Station[];
  trains: Train[];
  places: Map<string, Place>;
  placeOf: Place[]; // per station index
  trainsAt: number[][]; // per station index: trains that halt there
  newer: NewerTrain[];
  /** true once the route geometry (paths.bin) has been applied */
  detailed: boolean;
}

const NONE = 0xffff;

function checkMagic(buf: ArrayBuffer, magic: string, version: number) {
  const got = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  const ver = new DataView(buf).getUint32(4, true);
  if (got !== magic || ver !== version) throw new Error(`Unexpected data file ${got} v${ver}; wanted ${magic} v${version}`);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error("Big-endian platforms aren't supported");
}

function hav(a: Station, b: Station) {
  const p = Math.PI / 180;
  const x =
    Math.sin(((b.lat! - a.lat!) * p) / 2) ** 2 +
    Math.cos(a.lat! * p) * Math.cos(b.lat! * p) * Math.sin(((b.lon! - a.lon!) * p) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

/**
 * Lay a train's line through its halts and, when known, the stations it passes between them.
 * Also sets `train.km`: each halt's distance along that line, so drawing and timing agree.
 */
function layLine(stations: Station[], t: Train, passes?: (h: number) => ArrayLike<number>) {
  const st: number[] = [];
  const km: number[] = [];
  let prev: Station | null = null;
  let acc = 0;
  const visit = (s: Station) => {
    if (s.lat === null) return;
    if (prev) acc += hav(prev, s);
    prev = s;
    if (st[st.length - 1] === s.i) return;
    st.push(s.i);
    km.push(acc);
  };
  for (let j = 0; j < t.st.length; j++) {
    visit(stations[t.st[j]]);
    t.km[j] = acc;
    if (passes && j < t.st.length - 1) {
      const gap = passes(j);
      for (let k = 0; k < gap.length; k++) visit(stations[gap[k]]);
    }
  }
  t.geom = { st: Int32Array.from(st), km: Float32Array.from(km) };
}

export function decodeNetwork(meta: MetaFile, timetable: ArrayBuffer): Network {
  checkMagic(timetable, "RGTT", 3);
  const dv = new DataView(timetable);
  const nT = dv.getUint32(8, true);
  const nH = dv.getUint32(12, true);
  let o = 16;
  const start = new Uint32Array(timetable, o, nT + 1);
  o += 4 * (nT + 1);
  const hStation = new Uint16Array(timetable, o, nH);
  o += 2 * nH;
  const dArr = new Uint16Array(timetable, o, nH);
  o += 2 * nH;
  const dDep = new Uint16Array(timetable, o, nH);
  o += 2 * nH;
  const dDist = new Uint16Array(timetable, o, nH);
  o += 2 * nH;
  const tType = new Uint8Array(timetable, o, nT);
  o += nT;
  const tDays = new Uint8Array(timetable, o, nT);

  const S = meta.stations;
  const stations: Station[] = S.code.map((code, i) => ({
    i,
    code,
    name: S.name[i],
    lat: S.lat[i],
    lon: S.lon[i],
    state: meta.states[S.state[i]],
    hi: S.hi[i],
    local: S.local[i],
    halts: S.halts[i],
  }));

  // times and distances are stored as differences from the previous halt (mod 2^16)
  const ARR = new Int32Array(nH);
  const DEP = new Int32Array(nH);
  const DIST = new Int32Array(nH);
  const KM = new Float32Array(nH);
  const trainsAt: number[][] = stations.map(() => []);
  const trains: Train[] = new Array(nT);
  for (let t = 0; t < nT; t++) {
    const a0 = start[t];
    const a1 = start[t + 1];
    let dep = 0;
    let dist = 0;
    for (let h = a0; h < a1; h++) {
      const first = h === a0;
      const last = h === a1 - 1;
      const arr = first ? -1 : (dep + dArr[h]) & NONE;
      dep = last ? -1 : first ? dDep[h] : (arr + dDep[h]) & NONE;
      dist = (dist + dDist[h]) & NONE;
      ARR[h] = arr;
      DEP[h] = dep;
      DIST[h] = dist;
      trainsAt[hStation[h]].push(t);
    }
    const [code, label] = meta.types[tType[t]];
    const train: Train = {
      i: t,
      no: meta.trains[t][0],
      name: meta.trains[t][1],
      type: code,
      typeLabel: label,
      st: hStation.subarray(a0, a1),
      arr: ARR.subarray(a0, a1),
      dep: DEP.subarray(a0, a1),
      dist: DIST.subarray(a0, a1),
      km: KM.subarray(a0, a1),
      geom: { st: new Int32Array(0), km: new Float32Array(0) },
      days: tDays[t],
    };
    layLine(stations, train);
    trains[t] = train;
  }

  // places: curated multi-station cities, then every other station on its own
  const places = new Map<string, Place>();
  const placeOf: Place[] = new Array(stations.length);
  for (const c of meta.cities) {
    const anchor = c.stations.find((m) => stations[m].lat !== null) ?? c.stations[0];
    const p: Place = {
      id: c.id,
      name: c.name,
      hi: c.hi ?? "",
      local: c.local ?? "",
      state: c.state,
      aka: c.aka ?? [],
      stations: c.stations,
      anchor,
      lat: stations[anchor].lat,
      lon: stations[anchor].lon,
      isCity: true,
      halts: c.stations.reduce((a, m) => a + stations[m].halts, 0),
    };
    places.set(p.id, p);
    for (const m of c.stations) placeOf[m] = p;
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

  const newer: NewerTrain[] = (meta.newer ?? []).map(([numbers, name, type, from, to, days, perWeek, minutes, km, stops, src]) => ({
    numbers, name, type, from, to, days, perWeek, minutes, km, stops, src,
  }));
  return { meta: meta.meta, stations, trains, places, placeOf, trainsAt, newer, detailed: false };
}

/** Add the stations each train passes between halts, so lines follow the track instead of chords. */
export function applyPaths(net: Network, paths: ArrayBuffer) {
  checkMagic(paths, "RGTP", 1);
  const dv = new DataView(paths);
  const nH = dv.getUint32(8, true);
  const nP = dv.getUint32(12, true);
  const count = new Uint16Array(paths, 16, nH);
  const pass = new Uint16Array(paths, 16 + 2 * nH, nP);
  const offset = new Uint32Array(nH + 1);
  for (let h = 0; h < nH; h++) offset[h + 1] = offset[h] + count[h];
  let h0 = 0;
  for (const t of net.trains) {
    const base = h0;
    layLine(net.stations, t, (j) => pass.subarray(offset[base + j], offset[base + j + 1]));
    h0 += t.st.length;
  }
  if (h0 !== nH) throw new Error("Route geometry doesn't match the timetable");
  net.detailed = true;
}
