// "Where can I go from here?" — every place reachable from an origin without changing trains,
// and which of those rides pass the filters. Pure functions over the Network.
import { shiftDays } from "./format";
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

export type Leave = "any" | "2h" | "6h" | "overnight" | "weekend";
/** Which trains: every one, the long-distance ones, the local ones (passenger, MEMU, DEMU), or the hill railways' toy trains. */
export type Kind = "all" | "long" | "local" | "toy";

export interface Filters {
  leave: Leave;
  within: number; // max journey minutes; Infinity = any
  kind?: Kind;
}

export const ANY: Filters = { leave: "any", within: Infinity, kind: "all" };

const LOCAL = new Set(["Pass", "MEMU", "DEMU"]);

/** What kind of train this is, for the "which trains" filter. */
export function kindOf(t: Train): Exclude<Kind, "all"> {
  return t.type === "Toy" ? "toy" : LOCAL.has(t.type) ? "local" : "long";
}

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
  if (f.kind && f.kind !== "all" && kindOf(leg.train) !== f.kind) return false;
  switch (f.leave) {
    case "any":
      return true;
    case "2h":
      return waitFor(leg, now) <= 120;
    case "6h":
      return waitFor(leg, now) <= 360;
    case "overnight":
      return overnight(leg);
    case "weekend":
      return weekend(leg);
  }
}

const MORNING = [4 * 60 + 30, 11 * 60 + 30]; // getting in between 04:30 and 11:30

/** Sleep on the train: board in the evening (or just after midnight), wake up there in the morning. */
export function overnight(leg: Leg) {
  const d = leg.dep;
  const at = (d + leg.dur) % 1440;
  return (d >= 17 * 60 || d < 60) && leg.dur >= 5 * 60 && leg.dur <= 16 * 60 && at >= MORNING[0] && at <= MORNING[1];
}

/**
 * Good for a weekend: it leaves on a Friday evening and gets you there that night or on Saturday
 * morning, or leaves on a Saturday morning and takes at most six hours. (Running days unknown:
 * given the benefit of the doubt.)
 */
export function weekend(leg: Leg) {
  const t = leg.train;
  const runs = t.days ? shiftDays(t.days, Math.floor(t.dep[leg.from] / 1440)) : 127; // Monday = bit 0
  const on = (day: number) => ((runs >> day) & 1) === 1;
  const d = leg.dep;
  const morning = (m: number) => m >= MORNING[0] && m <= MORNING[1];
  if (d >= 16 * 60 && on(4)) {
    const at = d + leg.dur; // minutes from Friday 00:00
    return at <= 23 * 60 + 30 || morning(at - 1440); // Friday evening: in by bedtime, or Saturday morning
  }
  if (d < 60 && on(5)) return morning(d + leg.dur); // just after midnight, Friday night
  return d >= 4 * 60 && d <= 12 * 60 && on(5) && leg.dur <= 6 * 60; // Saturday morning
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


// ---------------------------------------------------------------- journeys with one change

/** Two trains, changing at `via`. */
export interface Connection {
  via: Place;
  legs: [Leg, Leg];
  wait: number; // minutes between arriving at `via` and the second train leaving
  total: number; // minutes from the first train leaving to the second arriving
  /** Weekdays (bit 0 = Monday) the first train can leave on to make this connection; 127 = daily. */
  days: number;
  known: boolean; // both trains' running days are known (otherwise treated as daily)
  crossTown: boolean; // the second train leaves from another station of that city
  others: number; // more pairs of trains through `via` that make it within 3 hours of this one
}

/** Time to change trains: long-distance trains often run late, so err on the long side. */
export const CHANGE_SAME_STATION = 45;
export const CHANGE_ACROSS_TOWN = 120;

/** Does this ride leave its boarding halt on weekday `d` (0 = Monday)? Unknown days: yes. */
/** Does this ride board on weekday `d` (0 = Monday)? Unknown running days count as daily. */
export function runsOn(leg: Leg, d: number) {
  const days = leg.train.days;
  if (!days) return true;
  const onTheWay = Math.floor(leg.train.dep[leg.from] / 1440);
  return ((days >> ((((d - onTheWay) % 7) + 7) % 7)) & 1) === 1;
}

/**
 * The quickest ways from `origin` to `dest` changing trains once: every place both have a
 * direct train to, and for each the best pair of trains, honouring running days and leaving
 * time to change. `out` is departures(origin), `into` arrivals(dest). Best first.
 */
export function connections(out: Map<Place, Destination>, into: Map<Place, Destination>, origin: Place, dest: Place, limit = 6): Connection[] {
  const best: Connection[] = [];
  const quickest = (legs: Leg[]) => [...legs].sort((a, b) => a.dur - b.dur).slice(0, 24);
  // the places you could change at, likeliest first: the quickest two rides with the shortest change
  const vias: [Place, Destination, Destination, number][] = [];
  for (const [via, a] of out) {
    if (via === origin || via === dest) continue;
    const b = into.get(via);
    if (b) vias.push([via, a, b, a.fastest + CHANGE_SAME_STATION + b.fastest]);
  }
  vias.sort((x, y) => x[3] - y[3]);
  // quickest first, but a change across town, or a wait of more than six hours, counts against it
  const score = (c: Connection) => c.total + (c.crossTown ? 60 : 0) + Math.max(0, c.wait - 360) / 2;
  let bestScore = Infinity;
  for (const [via, a, b, atLeast] of vias) {
    // too slow to be shown whatever the timetable (nothing much slower than the best is, below)
    if (atLeast > bestScore * 1.6 + 240) break;
    let top: Connection | null = null;
    const totals: number[] = [];
    const seconds = quickest(b.legs);
    for (const l1 of quickest(a.legs)) {
      for (const l2 of seconds) {
        // rides sorted quickest first: once even the shortest change can't come within 3h of this
        // place's best, no later pair can either
        if (top && l1.dur + CHANGE_SAME_STATION + l2.dur > top.total + 180) break;
        if (l2.train === l1.train) continue; // the same train: that would be a direct ride
        const cross = l1.train.st[l1.to] !== l2.train.st[l2.from];
        const change = cross ? CHANGE_ACROSS_TOWN : CHANGE_SAME_STATION;
        const arrive = l1.dep + l1.dur; // minutes after midnight of the day you board
        let pairBest = Infinity;
        let pairWait = 0;
        let days = 0;
        for (let d = 0; d < 7; d++) {
          if (!runsOn(l1, d)) continue;
          const at = d * 1440 + arrive; // week minute you reach `via`
          const ready = at + change;
          let wait = -1;
          for (let k = 0; k < 9; k++) {
            const day = Math.floor(ready / 1440) + k;
            const leave = day * 1440 + l2.dep;
            if (leave < ready) continue;
            if (runsOn(l2, day % 7)) {
              wait = leave - at;
              break;
            }
          }
          if (wait < 0) continue;
          const total = l1.dur + wait + l2.dur;
          if (total < pairBest) {
            pairBest = total;
            pairWait = wait;
            days = 0;
          }
          if (total === pairBest) days |= 1 << d;
        }
        if (pairBest === Infinity) continue;
        totals.push(pairBest);
        if (!top || pairBest < top.total) {
          top = {
            via,
            legs: [l1, l2],
            wait: pairWait,
            total: pairBest,
            days, // the weekdays you board on
            known: !!l1.train.days && !!l2.train.days,
            crossTown: cross,
            others: 0,
          };
        }
      }
    }
    if (!top) continue;
    top.others = totals.filter((t) => t <= top!.total + 180).length - 1;
    bestScore = Math.min(bestScore, score(top));
    best.push(top);
  }
  best.sort((x, y) => score(x) - score(y) || y.via.halts - x.via.halts);
  // one per city is plenty; and nothing absurdly slower than the best
  const out2: Connection[] = [];
  for (const c of best) {
    if (out2.length >= limit) break;
    if (out2.length && c.total > out2[0].total * 1.6 + 240) continue;
    out2.push(c);
  }
  return out2;
}
