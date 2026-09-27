import { describe, expect, it } from "vitest";
import { daysLabel, shiftDays } from "../src/core/format";
import { departures, legPasses, newerBetween, reachable, waitFor, ANY, type Leg } from "../src/core/trips";
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
