import { describe, expect, it } from "vitest";
import { nearestStations, road } from "../src/core/spots";
import { planTrip, type TripStop } from "../src/core/tripplan";
import { arrivals, departures, kindOf } from "../src/core/trips";
import { describe as weatherWords } from "../src/core/weather";
import { validSave, tripKey } from "../src/core/saves";
import { href, parse } from "../src/app/router";
import { net, place, slugs, spots } from "./load";

const tools = { net, departuresFrom: (p: Parameters<typeof departures>[1]) => departures(net, p), arrivalsTo: (p: Parameters<typeof arrivals>[1]) => arrivals(net, p) };
const stop = (slug: string, nights = 0): TripStop => ({ stop: { kind: "place", place: place(slug) }, nights });

describe("places without a station", () => {
  it("finds hill towns by name, and by the names people use", () => {
    expect(spots.search("munnar")[0]?.name).toBe("Munnar");
    expect(spots.search("coorg")[0]?.name).toBe("Madikeri");
    expect(spots.search("kodaik")[0]?.name).toBe("Kodaikanal");
  });

  it("never takes a station's address", () => {
    for (const s of spots.list) expect(slugs.find(s.id), s.id).toBeUndefined();
  });

  it("sends you to a busy station, not the nearest halt", () => {
    const munnar = spots.find("munnar")!;
    const names = nearestStations(net, munnar, 3).map((c) => c.place.name);
    expect(names.some((n) => /Aluva|Ernakulam|Kochi/.test(n)), names.join(", ")).toBe(true);
    const kodai = nearestStations(net, spots.find("kodaikanal")!, 4).map((c) => c.place.name);
    expect(kodai.some((n) => /Kodaikanal Road|Dindigul|Palani|Madurai/.test(n)), kodai.join(", ")).toBe(true);
  });

  it("estimates roads as longer and slower than a straight line, more so in the hills", () => {
    const plains = road(100, false), hills = road(100, true);
    expect(plains.km).toBeGreaterThan(120);
    expect(hills.km).toBeGreaterThan(plains.km);
    expect(hills.mins).toBeGreaterThan(plains.mins);
  });
});

describe("trip planner", () => {
  it("picks a train for every stretch, and time only moves forward", () => {
    const plan = planTrip(tools, [stop("bengaluru"), stop("hampi", 2), stop("goa", 3)], 4); // a Friday
    expect(plan.legs).toHaveLength(2);
    for (const l of plan.legs) expect(l.ride).not.toBeNull();
    for (let i = 1; i < plan.arrivals.length; i++) expect(plan.arrivals[i]).toBeGreaterThan(plan.arrivals[i - 1]);
  });

  it("leaves a stop only after the nights you stay", () => {
    const short = planTrip(tools, [stop("bengaluru"), stop("mysuru", 0), stop("hassan")], 0);
    const long = planTrip(tools, [stop("bengaluru"), stop("mysuru", 3), stop("hassan")], 0);
    expect(long.legs[1].depart - short.legs[1].depart).toBeGreaterThanOrEqual(2 * 1440);
  });

  it("goes by road where no train links two nearby places", () => {
    const plan = planTrip(tools, [stop("mysuru"), stop("udhagamandalam")], 0);
    expect(plan.legs[0].roadOnly?.km).toBeGreaterThan(100);
  });

  it("takes a train to the station for a place without one, then the road", () => {
    const plan = planTrip(tools, [stop("bengaluru"), { stop: { kind: "spot", spot: spots.find("munnar")! }, nights: 0 }], 2);
    expect(plan.legs[0].ride).not.toBeNull();
    expect(plan.legs[0].roadAfter?.road.km).toBeGreaterThan(40);
  });

  it("follows a train you picked from the others", () => {
    const first = planTrip(tools, [stop("bengaluru"), stop("mysuru")], 2);
    if (first.legs[0].options.length < 2) return;
    const later = planTrip(tools, [stop("bengaluru"), stop("mysuru")], 2, 360, [1]);
    expect(later.legs[0].chosen).toBe(1);
    expect(later.arrivals[1]).toBeGreaterThanOrEqual(first.arrivals[1]);
  });
});

describe("toy trains, and local ones", () => {
  it("files the hill railways' trains as toy trains", () => {
    const toys = net.trains.filter((t) => t.type === "Toy");
    const ends = new Set(toys.flatMap((t) => [net.stations[t.st[0]].code, net.stations[t.st[t.st.length - 1]].code]));
    for (const c of ["SML", "DJ", "UAM"]) expect(ends.has(c), c).toBe(true);
    expect(kindOf(toys[0])).toBe("toy");
  });

  it("keeps MEMU, DEMU and passenger trains as local ones", () => {
    const memu = net.trains.find((t) => t.type === "MEMU")!;
    expect(kindOf(memu)).toBe("local");
  });
});

describe("addresses and saves for trips", () => {
  it("round-trips a trip's address", () => {
    const r = { trip: { stops: ["bengaluru", "hampi", "munnar"], nights: [0, 2, 3], date: "2026-10-09" } };
    expect(parse(new URL(`https://x${href(r)}`)).trip).toEqual(r.trip);
  });

  it("carries the kind of train and a searched place's position", () => {
    const r = parse(new URL("https://x/from/kalka/?trains=toy"));
    expect(r.kind).toBe("toy");
    expect(parse(new URL("https://x/to/kasol/?at=32.01,77.315")).at).toBe("32.01,77.315");
  });

  it("accepts a well-formed trip save and refuses a bad one", () => {
    const data = { title: "Bengaluru → Hampi", stops: ["bengaluru", "hampi"], nights: [0, 2], date: "2026-10-09" };
    expect(validSave({ key: tripKey(data), kind: "trip", data, at: 1 })).toBe(true);
    expect(validSave({ key: tripKey(data), kind: "trip", data: { ...data, stops: ["../etc"] }, at: 1 })).toBe(false);
  });
});

describe("weather words", () => {
  it("says what the codes mean", () => {
    expect(weatherWords(0).text).toBe("Clear");
    expect(weatherWords(63).icon).toBe("rain");
    expect(weatherWords(95).icon).toBe("storm");
  });
});
