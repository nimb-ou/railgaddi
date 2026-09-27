// "Where can I go from here?" — every place reachable from an origin without changing trains,
// and which of those rides pass the filters. Pure functions over the Network.
import type { Network, Place, Train } from "./network";

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
    case "overnight":
      // sleep on the train: leave in the evening, wake up there
      return (d >= 17 * 60 || d < 60) && leg.dur >= 6 * 60 && leg.dur <= 16 * 60;
  }
}

/** Rides that pass the filters, grouped by place, and each train's furthest useful halt. */
export function reachable(dests: Map<Place, Destination>, f: Filters, nowMin: number) {
  const trains = new Map<Train, { from: number; to: number }>();
  const byPlace = new Map<Place, Leg[]>();
  for (const d of dests.values()) {
    for (const l of d.legs) {
      if (!legPasses(l, f, nowMin)) continue;
      const a = trains.get(l.train);
      if (!a) trains.set(l.train, { from: l.from, to: l.to });
      else a.to = Math.max(a.to, l.to);
      let legs = byPlace.get(d.place);
      if (!legs) byPlace.set(d.place, (legs = []));
      legs.push(l);
    }
  }
  return { trains, byPlace };
}

/** Soonest first, counting from now (a train at 23:50 comes before one at 00:10 at 23:40). */
export function bySoonest(legs: Leg[], nowMin: number) {
  return [...legs].sort((a, b) => ((a.dep - nowMin + 1440) % 1440) - ((b.dep - nowMin + 1440) % 1440));
}

export const fastest = (legs: Leg[]) => Math.min(...legs.map((l) => l.dur));
