import { describe, expect, it } from "vitest";
import { href, parse } from "../src/app/router";
import { net, slugs } from "./load";

const url = (path: string) => new URL(path, "https://railgaddi.in");

describe("addresses", () => {
  it("round-trips every kind of view", () => {
    const routes = [
      {},
      { origin: "bengaluru" },
      { origin: "bengaluru", place: "mysuru" },
      { origin: "bengaluru", place: "mysuru", train: "12007" },
      { origin: "bengaluru", place: "amritsar", journey: "22691-12013" },
      { origin: "bengaluru", place: "amritsar", journey: "22691-12013", train: "12013" },
      { place: "hampi" },
      { discover: "" },
      { discover: "konkan-railway" },
      { origin: "delhi", within: 360, leave: "2h" as const },
    ];
    for (const r of routes) expect(parse(url(href(r)))).toEqual(r);
  });

  it("tolerates a missing trailing slash and ignores junk", () => {
    expect(parse(url("/from/bengaluru/to/mysuru"))).toEqual({ origin: "bengaluru", place: "mysuru" });
    expect(parse(url("/from/bengaluru/?leave=soon&within=-3"))).toEqual({ origin: "bengaluru" });
  });

  it("gives every place a unique address that leads back to it", () => {
    const seen = new Set<string>();
    for (const p of net.places.values()) {
      const s = slugs.of(p);
      expect(s).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(s), s).toBe(false);
      seen.add(s);
      expect(slugs.find(s)).toBe(p);
    }
  });
});
