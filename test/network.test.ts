import { describe, expect, it } from "vitest";
import { meta, net } from "./load";

describe("timetable", () => {
  it("decodes every train in the file", () => {
    expect(net.trains.length).toBe(meta.trains.length);
    expect(net.trains.length).toBeGreaterThan(6000);
  });

  it("runs forward in time and distance at every halt", () => {
    for (const t of net.trains) {
      const n = t.st.length;
      expect(n, t.no).toBeGreaterThanOrEqual(2);
      expect(t.arr[0], t.no).toBe(-1); // nothing arrives at the origin
      expect(t.dep[n - 1], t.no).toBe(-1); // nothing leaves the terminus
      for (let j = 1; j < n; j++) {
        expect(t.arr[j], `${t.no} halt ${j}`).toBeGreaterThanOrEqual(t.dep[j - 1]);
        if (j < n - 1) expect(t.dep[j], `${t.no} halt ${j}`).toBeGreaterThanOrEqual(t.arr[j]);
        expect(t.dist[j], `${t.no} halt ${j}`).toBeGreaterThanOrEqual(t.dist[j - 1]);
      }
    }
  });

  it("lays every train along a drawable line", () => {
    for (const t of net.trains) {
      expect(t.km.length, t.no).toBe(t.st.length);
      for (let j = 1; j < t.km.length; j++) expect(t.km[j], t.no).toBeGreaterThanOrEqual(t.km[j - 1]);
    }
  });

  it("indexes trains by the stations they stop at", () => {
    const t = net.trains.find((x) => x.no === "12007")!; // Chennai–Mysuru Shatabdi
    expect(t).toBeDefined();
    for (const s of t.st) expect(net.trainsAt[s]).toContain(t.i);
  });
});

describe("running days", () => {
  it("come through for the trains the database has them for", () => {
    const withDays = net.trains.filter((t) => t.days);
    expect(withDays.length).toBeGreaterThan(500);
    for (const t of withDays) expect(t.days).toBeLessThan(128);
  });
});
