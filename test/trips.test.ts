import { describe, expect, it } from "vitest";
import { departures, legPasses, reachable, ANY } from "../src/core/trips";
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

    const leg = { dep: 23 * 60 + 30, dur: 60 } as Parameters<typeof legPasses>[0];
    expect(legPasses(leg, { leave: "2h", within: Infinity }, 22 * 60 + 45)).toBe(true);
    expect(legPasses({ ...leg, dep: 30 }, { leave: "2h", within: Infinity }, 23 * 60)).toBe(true); // past midnight
    expect(legPasses(leg, { leave: "2h", within: Infinity }, 12 * 60)).toBe(false);
  });
});
