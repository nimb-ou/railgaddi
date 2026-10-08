import { describe, expect, it } from "vitest";
import { goodMonth, runs, spanWords, whenLine } from "../src/core/climate";

describe("when to go", () => {
  // Darjeeling, from the IMD's station table: cool, then the monsoon
  const darjeeling = "GGGGRWWWWGBG";
  // Udaipur: lovely winters, a hot May
  const udaipur = "BBGMHMRRGGBB";

  it("finds the runs of months, wrapping round the year", () => {
    expect(runs(darjeeling, (k) => k === "W")).toEqual([[5, 8]]);
    expect(runs(udaipur, (k) => k === "B" || k === "G")).toEqual([[8, 2]]);
    expect(runs("BBBBBBBBBBBB", (k) => k === "B")).toEqual([[0, 11]]);
    expect(runs("RRRRRRRRRRRR", (k) => k === "B")).toEqual([]);
  });

  it("says it in words", () => {
    expect(spanWords([9, 2])).toBe("October to March");
    expect(spanWords([4, 4])).toBe("May");
    expect(whenLine(darjeeling)).toBe("Best from October to April. June to September: the monsoon pours.");
    expect(whenLine(udaipur)).toBe("Best from September to March. May: garmi, very hot.");
    expect(whenLine("BBBBBBBBBBBB")).toBe("Good all year round, balle balle.");
  });

  it("knows a good month", () => {
    expect(goodMonth(udaipur, 0)).toBe(true);
    expect(goodMonth(udaipur, 4)).toBe(false); // too hot
    expect(goodMonth(udaipur, 6)).toBe(true); // a few showers
    expect(goodMonth("GGGGRWWWWGBG", 6)).toBe(false); // the monsoon's worst
    expect(goodMonth(undefined, 0)).toBe(false);
  });
});
