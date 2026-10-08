import { describe, expect, it } from "vitest";
import { daysLabel, shiftDays } from "../src/core/format";
import { arrivals, CHANGE_ACROSS_TOWN, CHANGE_SAME_STATION, connections, departures, legPasses, newerBetween, overnight, reachable, waitFor, weekend, ANY, type Leg } from "../src/core/trips";
import { net, place } from "./load";

describe("departures", () => {
  const from = place("bengaluru");
  const dests = departures(net, from);

  it("reaches Mysuru directly, in about two hours", () => {
    const d = dests.get(place("mysuru"))!;
    expect(d).toBeDefined();
    expect(d.fastest).toBeGreaterThan(90);
    expect(d.fastest).toBeLessThan(180);
  });

  it("never lists the origin, and every leg rides forward", () => {
    expect(dests.has(from)).toBe(false);
    for (const d of dests.values()) {
      expect(d.legs.length).toBeGreaterThan(0);
      for (const l of d.legs) {
        expect(l.to).toBeGreaterThan(l.from);
        expect(l.dur).toBeGreaterThan(0);
        expect(l.dep).toBeGreaterThanOrEqual(0);
        expect(l.dep).toBeLessThan(1440);
        expect(from.stations).toContain(l.train.st[l.from]);
        expect(d.place.stations).toContain(l.train.st[l.to]);
      }
      expect(d.fastest).toBe(Math.min(...d.legs.map((l) => l.dur)));
    }
  });

  it("filters by ride length and departure window", () => {
    const short = reachable(dests, { leave: "any", within: 120 }, 0);
    for (const legs of short.byPlace.values()) for (const l of legs) expect(l.dur).toBeLessThanOrEqual(120);
    expect(short.byPlace.size).toBeLessThan(reachable(dests, ANY, 0).byPlace.size);

    const daily = { days: 0, dep: Int32Array.of(23 * 60 + 30) } as unknown as Leg["train"];
    const leg = { train: daily, from: 0, dep: 23 * 60 + 30, dur: 60 } as Leg;
    const soon = { leave: "2h", within: Infinity } as const;
    expect(legPasses(leg, soon, 22 * 60 + 45)).toBe(true);
    expect(legPasses({ ...leg, dep: 30 }, soon, 23 * 60)).toBe(true); // past midnight
    expect(legPasses(leg, soon, 12 * 60)).toBe(false);
  });
});

describe("running days", () => {
  const MON = 0;
  const at = (day: number, h: number, m = 0) => day * 1440 + h * 60 + m;
  // leaves its origin Mondays and Thursdays at 22:00 and reaches our station at 02:00 the next day
  const train = { days: 0b0001001, dep: Int32Array.of(22 * 60, 26 * 60) } as unknown as Leg["train"];
  const fromOrigin = { train, from: 0, dep: 22 * 60, dur: 600 } as Leg;
  const onTheWay = { train, from: 1, dep: 2 * 60, dur: 300 } as Leg;

  it("waits for the next day the train actually runs", () => {
    expect(waitFor(fromOrigin, at(MON, 21))).toBe(60);
    expect(waitFor(fromOrigin, at(MON, 23))).toBe(3 * 1440 - 60); // Thursday 22:00
    expect(waitFor(fromOrigin, at(4, 12))).toBe(3 * 1440 + 600); // Friday noon -> Monday 22:00
  });

  it("shifts the days for a halt reached after midnight", () => {
    expect(waitFor(onTheWay, at(1, 1))).toBe(60); // Tuesday 02:00 (left Monday night)
    expect(waitFor(onTheWay, at(MON, 1))).toBe(1440 + 60); // nothing leaves here on Monday: Tuesday 02:00
    expect(waitFor(onTheWay, at(1, 3))).toBe(3 * 1440 - 60); // just missed it: Friday 02:00
  });

  it("treats unknown days as daily", () => {
    const unknown = { ...fromOrigin, train: { ...train, days: 0 } } as Leg;
    expect(waitFor(unknown, at(MON, 23))).toBe(1380);
  });

  it("names days the way people say them", () => {
    expect(daysLabel(127)).toBe("Daily");
    expect(daysLabel(127 & ~(1 << 2))).toBe("Except Wed");
    expect(daysLabel(0b1001)).toBe("Mon, Thu");
    expect(daysLabel(0)).toBe("");
    expect(shiftDays(0b1000000, 1)).toBe(0b0000001); // Sunday night -> Monday
  });
});

describe("newer trains", () => {
  it("are listed between the right places, in either direction", () => {
    const vb = net.newer.find((n) => n.name.includes("Vande Bharat"));
    expect(vb).toBeDefined();
    const a = net.placeOf[vb!.from];
    const b = net.placeOf[vb!.to];
    expect(newerBetween(net, a, b)).toContain(vb);
    expect(newerBetween(net, b, a)).toContain(vb);
    for (const n of net.newer) expect(net.trains.some((t) => n.numbers.split("/").includes(t.no))).toBe(false);
  });
});

describe("arrivals", () => {
  it("mirrors departures: every place with a train to Mysuru has Mysuru among its departures", () => {
    const mysuru = place("mysuru");
    const into = arrivals(net, mysuru);
    expect(into.size).toBeGreaterThan(20);
    expect(into.has(place("bengaluru"))).toBe(true);
    for (const [from, d] of into) {
      expect(from).not.toBe(mysuru);
      const out = departures(net, from).get(mysuru);
      expect(out, from.name).toBeDefined();
      expect(out!.fastest).toBe(d.fastest);
      for (const l of d.legs) {
        expect(mysuru.stations).toContain(l.train.st[l.to]);
        expect(from.stations).toContain(l.train.st[l.from]);
      }
    }
  });
});

describe("journeys with one change", () => {
  const from = place("bengaluru");
  const to = place("amritsar");
  const list = connections(departures(net, from), arrivals(net, to), from, to);

  it("finds ways from Bengaluru to Amritsar, which no train runs straight between", () => {
    expect(departures(net, from).has(to)).toBe(false);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0].total).toBeLessThan(60 * 60); // under 60 hours
  });

  it("changes at the place both trains serve, with time to change", () => {
    for (const c of list) {
      const [a, b] = c.legs;
      expect(c.via).not.toBe(from);
      expect(c.via).not.toBe(to);
      expect(from.stations).toContain(a.train.st[a.from]);
      expect(c.via.stations).toContain(a.train.st[a.to]);
      expect(c.via.stations).toContain(b.train.st[b.from]);
      expect(to.stations).toContain(b.train.st[b.to]);
      expect(a.train).not.toBe(b.train);
      expect(c.wait).toBeGreaterThanOrEqual(c.crossTown ? CHANGE_ACROSS_TOWN : CHANGE_SAME_STATION);
      expect(c.total).toBe(a.dur + c.wait + b.dur);
      expect(c.days).toBeGreaterThan(0);
    }
  });

  it("only boards the second train on a day it runs", () => {
    for (const c of list) {
      const [a, b] = c.legs;
      const d = [0, 1, 2, 3, 4, 5, 6].find((x) => (c.days >> x) & 1)!;
      const leaveVia = d * 1440 + a.dep + a.dur + c.wait; // week minute the second train leaves
      expect(leaveVia % 1440).toBe(b.dep);
      if (b.train.days) {
        const onTheWay = Math.floor(b.train.dep[b.from] / 1440);
        const weekday = Math.floor(leaveVia / 1440) % 7;
        expect((b.train.days >> ((((weekday - onTheWay) % 7) + 7) % 7)) & 1).toBe(1);
      }
    }
  });
});

describe("trips for a night, or a weekend", () => {
  // a train leaving its first station at `dep` on the days in `days` (Monday = bit 0)
  const leg = (dep: number, dur: number, days = 127) =>
    ({ train: { days, dep: Int32Array.of(dep) }, from: 0, dep: dep % 1440, dur } as unknown as Leg);

  it("overnight means waking up there in the morning", () => {
    expect(overnight(leg(22 * 60, 8 * 60))).toBe(true); // 22:00 -> 06:00
    expect(overnight(leg(21 * 60 + 20, 6 * 60))).toBe(false); // in at 03:20: not a night's sleep
    expect(overnight(leg(15 * 60, 15 * 60))).toBe(false); // leaves in the afternoon
    expect(overnight(leg(20 * 60, 20 * 60))).toBe(false); // a day and a night
  });

  it("a weekend leaves on Friday evening or Saturday morning", () => {
    const fri = 1 << 4, sat = 1 << 5;
    expect(weekend(leg(21 * 60, 9 * 60, fri))).toBe(true); // Friday night train, Saturday 06:00
    expect(weekend(leg(21 * 60, 9 * 60, sat))).toBe(false); // that train doesn't run on Fridays
    expect(weekend(leg(18 * 60, 3 * 60, fri))).toBe(true); // Friday evening, in by 21:00
    expect(weekend(leg(20 * 60, 6 * 60, fri))).toBe(false); // in at 02:00
    expect(weekend(leg(7 * 60, 4 * 60, sat))).toBe(true); // Saturday morning, four hours
    expect(weekend(leg(7 * 60, 9 * 60, sat))).toBe(false); // too long for two days
    // a train that left its first station the day before still counts the day it passes here
    const thu = { train: { days: 1 << 3, dep: Int32Array.of(1440 + 22 * 60) }, from: 0, dep: 22 * 60, dur: 8 * 60 } as unknown as Leg;
    expect(weekend(thu)).toBe(true);
  });
});
