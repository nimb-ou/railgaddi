// "Where can I go from here?" — every place reachable from an origin without changing trains,
// and which of those rides pass the filters. Pure functions over the Network.
import type { Network, NewerTrain, Place, Train } from "./network";

/** One way to ride from the origin to a destination. Indices are halt indices within the train. */
export interface Leg {
  train: Train;
  from: number;
  to: number;
  dep: number; // time of day at boarding, 0..1439
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

export type Leave = "any" | "2h" | "6h" | "overnight";

export interface Filters {
  leave: Leave;
  within: number; // max journey minutes; Infinity = any
}

export const ANY: Filters = { leave: "any", within: Infinity };

export function departures(net: Network, origin: Place): Map<Place, Destination> {
  const originSet = new Set(origin.stations);
  const seen = new Set<number>();
  const dests = new Map<Place, Destination>();
  for (const s of origin.stations) {
    for (const ti of net.trainsAt[s]) {
      if (seen.has(ti)) continue;
      seen.add(ti);
      const t = net.trains[ti];
      // board at the first origin station the train leaves from
      let from = -1;
      for (let j = 0; j < t.st.length; j++) {
        if (originSet.has(t.st[j]) && t.dep[j] >= 0) {
          from = j;
          break;
        }
      }
      if (from < 0) continue;
      const reached = new Set<Place>();
      let halts = 0;
      for (let j = from + 1; j < t.st.length; j++) {
        const place = net.placeOf[t.st[j]];
        if (place !== origin && !reached.has(place)) {
          reached.add(place);
          const leg: Leg = {
            train: t,
            from,
            to: j,
            dep: t.dep[from] % 1440,
            dur: t.arr[j] - t.dep[from],
            km: t.dist[j] - t.dist[from],
            halts,
          };
          let d = dests.get(place);
          if (!d) dests.set(place, (d = { place, legs: [], fastest: Infinity, firstKm: leg.km }));
          d.legs.push(leg);
          d.fastest = Math.min(d.fastest, leg.dur);
          d.firstKm = Math.min(d.firstKm, leg.km);
        }
        if (!originSet.has(t.st[j])) halts++;
      }
    }
  }
  return dests;
}

/**
 * Minutes from `now` (minutes into the week, Monday 00:00 in India = 0) until this ride next
 * leaves, honouring the train's running days where they're known.
 */
export function waitFor(leg: Leg, now: number) {
  const minute = now % 1440;
  const first = (leg.dep - minute + 1440) % 1440;
  const days = leg.train.days;
  if (!days || days === 127) return first;
  const onTheWay = Math.floor(leg.train.dep[leg.from] / 1440); // days since it left its origin
  const today = Math.floor(now / 1440);
  for (let n = 0; n < 8; n++) {
    const wait = first + n * 1440;
    const weekday = (today + Math.floor((minute + wait) / 1440)) % 7;
    if ((days >> ((((weekday - onTheWay) % 7) + 7) % 7)) & 1) return wait;
  }
  return first;
}

/**
 * Every place with a direct train *to* a destination: the mirror of departures(). A ride boards
 * at the first station of that place the train leaves from (as departures() does) and ends at
 * the first station of the destination it reaches.
 */
export function arrivals(net: Network, dest: Place): Map<Place, Destination> {
  const destSet = new Set(dest.stations);
  const seen = new Set<number>();
  const froms = new Map<Place, Destination>();
  for (const s of dest.stations) {
    for (const ti of net.trainsAt[s]) {
      if (seen.has(ti)) continue;
      seen.add(ti);
      const t = net.trains[ti];
      let to = -1;
      for (let j = 0; j < t.st.length; j++) {
        if (destSet.has(t.st[j]) && t.arr[j] >= 0) {
          to = j;
          break;
        }
      }
      if (to < 1) continue;
      const boarded = new Set<Place>();
      for (let j = 0; j < to; j++) {
        const place = net.placeOf[t.st[j]];
        if (place === dest || boarded.has(place) || t.dep[j] < 0) continue;
        boarded.add(place);
        let halts = 0;
        for (let k = j + 1; k < to; k++) if (net.placeOf[t.st[k]] !== place) halts++;
        const leg: Leg = { train: t, from: j, to, dep: t.dep[j] % 1440, dur: t.arr[to] - t.dep[j], km: t.dist[to] - t.dist[j], halts };
        let d = froms.get(place);
        if (!d) froms.set(place, (d = { place, legs: [], fastest: Infinity, firstKm: leg.km }));
        d.legs.push(leg);
        d.fastest = Math.min(d.fastest, leg.dur);
        d.firstKm = Math.min(d.firstKm, leg.km);
      }
    }
  }
  return froms;
}

export function legPasses(leg: Leg, f: Filters, now: number) {
  if (leg.dur > f.within) return false;
  switch (f.leave) {
    case "any":
      return true;
    case "2h":
      return waitFor(leg, now) <= 120;
    case "6h":
      return waitFor(leg, now) <= 360;
    case "overnight": {
      // sleep on the train: leave in the evening, wake up there
      const d = leg.dep;
      return (d >= 17 * 60 || d < 60) && leg.dur >= 6 * 60 && leg.dur <= 16 * 60;
    }
  }
}

/** Rides that pass the filters, grouped by place, and each train's furthest useful halt. */
export function reachable(dests: Map<Place, Destination>, f: Filters, now: number) {
  const trains = new Map<Train, { from: number; to: number }>();
  const byPlace = new Map<Place, Leg[]>();
  for (const d of dests.values()) {
    for (const l of d.legs) {
      if (!legPasses(l, f, now)) continue;
      const a = trains.get(l.train);
      if (!a) trains.set(l.train, { from: l.from, to: l.to });
      else {
        a.from = Math.min(a.from, l.from); // arrivals: boarding varies, the destination doesn't
        a.to = Math.max(a.to, l.to); // departures: the other way round
      }
      let legs = byPlace.get(d.place);
      if (!legs) byPlace.set(d.place, (legs = []));
      legs.push(l);
    }
  }
  return { trains, byPlace };
}

/** Soonest first, counting from now and skipping days a train doesn't run. */
export function bySoonest(legs: Leg[], now: number) {
  const wait = new Map(legs.map((l) => [l, waitFor(l, now)]));
  return [...legs].sort((a, b) => wait.get(a)! - wait.get(b)!);
}

export const fastest = (legs: Leg[]) => Math.min(...legs.map((l) => l.dur));

/** Trains we know run between two places (either way) but have no halts or times for yet. */
export function newerBetween(net: Network, a: Place, b: Place): NewerTrain[] {
  return net.newer.filter((n) => {
    const x = net.placeOf[n.from];
    const y = net.placeOf[n.to];
    return (x === a && y === b) || (x === b && y === a);
  });
}

