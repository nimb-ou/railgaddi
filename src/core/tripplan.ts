// A trip with several stops: how long you stay at each, and for every stretch between them the
// train that runs that day and gets you there first (or the best way with one change), with the
// road to and from places that have no station. Dates are India dates; times are minutes.
import { onMainLine, type Network, type Place } from "./network";
import { km, nearestStations, road, type Spot, type StationChoice } from "./spots";
import { connections, runsOn, type Connection, type Destination, type Leg } from "./trips";

export type Stop = { kind: "place"; place: Place } | { kind: "spot"; spot: Spot };

export interface TripStop {
  stop: Stop;
  nights: number; // how long you stay (the last stop's is ignored)
}

export type Ride = { kind: "direct"; leg: Leg } | { kind: "change"; conn: Connection };

export interface PlannedLeg {
  from: Stop;
  to: Stop;
  rail: { a: Place; b: Place } | null; // null: by road (the two are close, or no train links them)
  roadOnly?: { km: number; mins: number }; // the whole way by road, when no train does it
  roadBefore: StationChoice | null; // from a place without a station to its station
  roadAfter: StationChoice | null;
  ride: Ride | null; // null: no train (within a week)
  options: Ride[]; // other trains that run that day, quickest arrival first
  times: { depart: number; arrive: number }[]; // each option's train times (minutes since day one 00:00)
  chosen: number; // which option the plan uses
  depart: number; // minutes since the trip's first day 00:00 (the train leaving, or the road)
  arrive: number;
  ready: number; // the earliest you'd set off (after your nights): a later train means a longer stay
  trainMins: number;
  km: number;
}

export interface Plan {
  legs: PlannedLeg[];
  arrivals: number[]; // when you reach each stop (minutes since day one 00:00); [0] = start
  leaves: number[];
  totalTrain: number;
  totalKm: number;
  days: number;
}

const DAY = 1440;

export function stopName(s: Stop, name: (p: Place) => string) {
  return s.kind === "place" ? name(s.place) : s.spot.name;
}

export function stopLatLon(s: Stop): { lat: number; lon: number } | null {
  if (s.kind === "spot") return { lat: s.spot.lat, lon: s.spot.lon };
  return s.place.lat !== null && s.place.lon !== null ? { lat: s.place.lat, lon: s.place.lon } : null;
}

export interface PlanTools {
  net: Network;
  departuresFrom: (p: Place) => Map<Place, Destination>;
  arrivalsTo: (p: Place) => Map<Place, Destination>;
}

/** The station to use for a stop: the place itself, or a place without a station's best station. */
function stationsFor(net: Network, s: Stop): StationChoice[] {
  if (s.kind === "place") return [{ place: s.place, straight: 0, road: { km: 0, mins: 0, real: true } }];
  const main = nearestStations(net, s.spot, 3, (p) => onMainLine(net, p));
  return main.length ? main : nearestStations(net, s.spot, 3);
}

/**
 * Plan it. `startDay` is the weekday (0 = Monday) of day one; you leave the first stop on day
 * one from `startMins` (default 06:00), and every later stop after its nights.
 */
export function planTrip(t: PlanTools, stops: TripStop[], startDay: number, startMins = 6 * 60, choice: number[] = []): Plan {
  const legs: PlannedLeg[] = [];
  const arrivals = [startMins];
  const leaves: number[] = [];
  let ready = startMins; // earliest you can set off from the current stop
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i].stop;
    const b = stops[i + 1].stop;
    if (i > 0) {
      // stay the nights, then set off from the morning of the day you leave
      const day = Math.floor(arrivals[i] / DAY) + Math.max(0, stops[i].nights);
      ready = Math.max(arrivals[i] + 60, day * DAY + 6 * 60);
    }
    const leg = { ...planLeg(t, a, b, ready, startDay), ready };
    // a train picked from the others that day: the rest of the trip follows from it
    const k = choice[i] ?? 0;
    if (k > 0 && leg.options[k]) {
      const before = leg.roadBefore ? leg.roadBefore.road.mins + 30 : 0;
      const after = leg.roadAfter ? leg.roadAfter.road.mins + 20 : 0;
      const tm = leg.times[k];
      leg.chosen = k;
      leg.ride = leg.options[k];
      leg.depart = tm.depart - before;
      leg.arrive = tm.arrive + after;
      leg.trainMins = tm.arrive - tm.depart;
    }
    legs.push(leg);
    leaves.push(leg.depart);
    arrivals.push(leg.arrive);
  }
  const last = arrivals[arrivals.length - 1] ?? startMins;
  return {
    legs,
    arrivals,
    leaves,
    totalTrain: legs.reduce((s, l) => s + l.trainMins, 0),
    totalKm: legs.reduce((s, l) => s + l.km, 0),
    days: Math.floor(last / DAY) + 1 + (stops.length ? Math.max(0, stops[stops.length - 1].nights) : 0),
  };
}

function planLeg(t: PlanTools, a: Stop, b: Stop, ready: number, startDay: number): PlannedLeg {
  const as = stationsFor(t.net, a);
  const bs = stationsFor(t.net, b);
  let best: PlannedLeg | null = null;
  for (const sa of as) {
    for (const sb of bs) {
      if (sa.place === sb.place) {
        // both ends share a station (a town and the hills above it): road only
        const mins = sa.road.mins + sb.road.mins;
        const leg: PlannedLeg = { from: a, to: b, rail: null, roadBefore: a.kind === "spot" ? sa : null, roadAfter: b.kind === "spot" ? sb : null, ride: null, options: [], times: [], chosen: 0, depart: ready, arrive: ready + mins, ready, trainMins: 0, km: 0 };
        if (!best || leg.arrive < best.arrive) best = leg;
        continue;
      }
      const setOff = ready + (a.kind === "spot" ? sa.road.mins + 30 : 0);
      const rides = ridesOn(t, sa.place, sb.place, setOff, startDay);
      const first = rides[0];
      const after = b.kind === "spot" ? sb.road.mins + 20 : 0;
      const leg: PlannedLeg = {
        from: a,
        to: b,
        rail: { a: sa.place, b: sb.place },
        roadBefore: a.kind === "spot" ? sa : null,
        roadAfter: b.kind === "spot" ? sb : null,
        ride: first?.ride ?? null,
        options: rides.map((r) => r.ride),
        times: rides.map((r) => ({ depart: r.depart, arrive: r.arrive })),
        chosen: 0,
        ready,
        depart: first ? first.depart - (a.kind === "spot" ? sa.road.mins + 30 : 0) : ready,
        // no train within a week: the plan carries on as if you got there by evening, and says so
        arrive: first ? first.arrive + after : ready + 12 * 60 + after,
        trainMins: first ? first.arrive - first.depart : 0,
        km: first ? (first.ride.kind === "direct" ? first.ride.leg.km : first.ride.conn.legs[0].km + first.ride.conn.legs[1].km) : 0,
      };
      if (!best || (!best.ride && leg.ride) || (!!best.ride === !!leg.ride && leg.arrive < best.arrive)) best = leg;
    }
  }
  // no train within a week, even with a change, but not far: most people would take the road
  // (Mysuru to Ooty is four hours by bus; by rail it's three trains)
  const from = stopLatLon(a), to = stopLatLon(b);
  if (best && !best.ride && best.rail && from && to) {
    const straight = km(from, to);
    if (straight < 320) {
      const r = road(straight, false);
      return { ...best, rail: null, roadBefore: null, roadAfter: null, roadOnly: r, depart: ready, arrive: ready + r.mins, trainMins: 0, km: 0 };
    }
  }
  return best!;
}

/** The rides from a to b that leave at or after `ready`, within a week, earliest arrival first. */
function ridesOn(t: PlanTools, a: Place, b: Place, ready: number, startDay: number) {
  const out: { ride: Ride; depart: number; arrive: number }[] = [];
  const direct = t.departuresFrom(a).get(b)?.legs ?? [];
  const pick = (depOf: (day: number) => number | null, dur: number, ride: Ride) => {
    for (let d = Math.floor(ready / DAY); d <= Math.floor(ready / DAY) + 7; d++) {
      const dep = depOf(d);
      if (dep === null || dep < ready) continue;
      out.push({ ride, depart: dep, arrive: dep + dur });
      return;
    }
  };
  for (const leg of direct) pick((d) => (runsOn(leg, (startDay + d) % 7) ? d * DAY + leg.dep : null), leg.dur, { kind: "direct", leg });
  if (!direct.length) {
    for (const conn of connections(t.departuresFrom(a), t.arrivalsTo(b), a, b, 4)) {
      pick((d) => ((conn.days >> ((startDay + d) % 7)) & 1 ? d * DAY + conn.legs[0].dep : null), conn.total, { kind: "change", conn });
    }
  }
  // the first to get you there; among equals, the shorter ride
  return out.sort((x, y) => x.arrive - y.arrive || x.arrive - x.depart - (y.arrive - y.depart)).slice(0, 6);
}
