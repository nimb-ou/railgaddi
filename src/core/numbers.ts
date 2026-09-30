// Records from the timetable itself: the longest run, the most stops, the fastest train, the
// busiest station. Computed from the network the site shows, so they always agree with it.
import type { Network, Place, Train } from "./network";

export interface Record {
  label: string;
  value: string;
  detail: string;
  train?: { train: Train; from: number; to: number };
  place?: Place;
}

const km = (n: number) => `${Math.round(n).toLocaleString("en-IN")} km`;
const hrs = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.round((m % 1440) / 60)} h` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} m`);

export function records(net: Network): Record[] {
  const out: Record[] = [];
  const last = (t: Train) => t.st.length - 1;
  const run = (t: Train) => t.dist[last(t)] - t.dist[0];
  const time = (t: Train) => t.arr[last(t)] - t.dep[0];
  const ends = (t: Train) => `${net.stations[t.st[0]].name} to ${net.stations[t.st[last(t)]].name}`;
  const whole = (t: Train) => ({ train: t, from: 0, to: last(t) });
  // only trains whose distances look sound (a few older rows have none)
  const trains = net.trains.filter((t) => run(t) > 0 && time(t) > 0);
  const best = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));

  const longest = best(trains, run);
  out.push({ label: "Longest run", value: km(run(longest)), detail: `${longest.no} ${longest.name}, ${ends(longest)}, ${hrs(time(longest))}`, train: whole(longest) });

  const most = best(trains, (t) => t.st.length);
  out.push({ label: "Most stops", value: `${most.st.length} halts`, detail: `${most.no} ${most.name}, ${ends(most)}`, train: whole(most) });

  const speed = (t: Train) => run(t) / (time(t) / 60);
  // a record needs a believable distance: rails wind, but not to half as far again as the
  // straight lines between the stops (a route drawn the long way round would make a slow train
  // look like the country's fastest)
  const R = 6371, rad = Math.PI / 180;
  const crow = (a: number, b: number) => {
    const s = net.stations[a], z = net.stations[b];
    if (s.lat === null || s.lon === null || z.lat === null || z.lon === null) return NaN;
    const h = Math.sin(((z.lat - s.lat) * rad) / 2) ** 2 + Math.cos(s.lat * rad) * Math.cos(z.lat * rad) * Math.sin(((z.lon - s.lon) * rad) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const sound = (d: number, straight: number) => !(straight >= 0) || d <= 1.45 * straight + 30;
  const straightRun = (t: Train) => t.st.slice(1).reduce((sum, s, j) => sum + crow(t.st[j], s), 0);
  const long = trains.filter((t) => run(t) >= 200 && sound(run(t), straightRun(t)));
  const fastest = best(long, speed);
  out.push({ label: "Fastest end to end", value: `${Math.round(speed(fastest))} km/h`, detail: `average, ${fastest.no} ${fastest.name}, ${ends(fastest)}`, train: whole(fastest) });

  const slowest = best(trains.filter((t) => run(t) >= 20), (t) => -speed(t));
  out.push({ label: "Slowest", value: `${Math.round(speed(slowest) * 10) / 10} km/h`, detail: `average, ${slowest.no} ${slowest.name}, ${ends(slowest)}`, train: whole(slowest) });

  // the longest stretch without a stop
  let hop = { t: trains[0], j: 1, d: 0 };
  for (const t of trains) {
    for (let j = 1; j < t.st.length; j++) {
      const d = t.dist[j] - t.dist[j - 1];
      if (d > hop.d && d < 1500 && sound(d, crow(t.st[j - 1], t.st[j]))) hop = { t, j, d };
    }
  }
  out.push({
    label: "Longest non-stop",
    value: km(hop.d),
    detail: `${net.stations[hop.t.st[hop.j - 1]].name} to ${net.stations[hop.t.st[hop.j]].name}, ${hop.t.no} ${hop.t.name}, ${hrs(hop.t.arr[hop.j] - hop.t.dep[hop.j - 1])}`,
    train: { train: hop.t, from: hop.j - 1, to: hop.j },
  });

  // busiest: the place most trains stop at
  const busiest = best([...net.places.values()], (p) => p.halts);
  out.push({ label: "Busiest place", value: `${busiest.halts.toLocaleString("en-IN")} trains`, detail: `stop at ${busiest.name}'s ${busiest.stations.length} stations`, place: busiest });
  const station = best(net.stations, (s) => s.halts);
  const sp = net.placeOf[station.i];
  out.push({ label: "Busiest station", value: `${station.halts.toLocaleString("en-IN")} trains`, detail: `${station.name} (${station.code})`, place: sp });

  out.push({ label: "In the timetable", value: `${net.trains.length.toLocaleString("en-IN")} trains`, detail: `stopping at ${net.stations.filter((s) => s.halts).length.toLocaleString("en-IN")} stations` });
  return out;
}
