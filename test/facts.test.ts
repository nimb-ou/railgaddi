// Facts the site states, checked against the data it ships: stations in the right state with
// their real names, train names spelt properly, real roads where we have them.
import { describe, expect, it } from "vitest";
import { onMainLine } from "../src/core/network";
import { sameTown } from "../src/core/rank";
import { nearestStations } from "../src/core/spots";
import { net, place, spots } from "./load";

const station = (code: string) => net.stations.find((s) => s.code === code)!;

describe("stations", () => {
  it("are in the state they're in, after Telangana and Ladakh", () => {
    expect(station("SC").state).toBe("Telangana"); // Secunderabad
    expect(station("HYB").state).toBe("Telangana");
    expect(station("DHN").state).toBe("Jharkhand"); // Dhanbad, not West Bengal
    expect(station("RC").state).toBe("Karnataka"); // Raichur, not Andhra Pradesh
    expect(station("BXR").state).toBe("Bihar"); // Buxar, not Uttar Pradesh
    expect(station("KLK").state).toBe("Haryana"); // Kalka stays in Haryana, by the border
    expect(station("BBS").state).toBe("Odisha"); // not "Orissa"
    expect(net.stations.some((s) => s.state === "Orissa" || s.state === "Delhi NCT")).toBe(false);
  });

  it("carry their own names, not a neighbour's or a bank's", () => {
    expect(station("TCR").name).toBe("Thrissur");
    expect(station("SCL").name).toBe("Silchar");
    expect(net.stations.some((s) => /\bstation$|^[a-z]/.test(s.name) && s.halts)).toBe(false);
  });
});

describe("train names", () => {
  it("are mended where the timetable wrapped or misspelt them", () => {
    const names = net.trains.map((t) => t.name);
    for (const bad of [/Vascode/, /Ahmed abad/, /Bengalu ru/, /\(push-Pull\)/, /\w\(/, /\bexp\b/i, /\bRb \d/, /Howarh|Secunderbad/])
      expect(names.filter((n) => bad.test(n)), String(bad)).toEqual([]);
  });
});

describe("places without a station", () => {
  it("use real roads where we have them: the ghat road to Palani is not the straight line", () => {
    const kodai = spots.find("kodaikanal")!;
    const palani = nearestStations(net, kodai, 6).find((c) => c.place.name === "Palani");
    expect(palani?.road.real).toBe(true);
    expect(palani!.road.km).toBeGreaterThan(50); // 25 km as the crow flies
    expect(palani!.road.mins).toBeGreaterThan(90);
  });

  it("send you to main-line stations, not a toy train's halts", () => {
    const kasol = spots.find("kasol")!;
    const ways = nearestStations(net, kasol, 4, (p) => onMainLine(net, p));
    expect(ways.length).toBeGreaterThan(1);
    expect(ways.every((w) => onMainLine(net, w.place))).toBe(true);
  });

  it("know an island has no road to a station", () => {
    const pb = spots.find("port-blair")!;
    expect(pb.roads).not.toBeNull();
    expect(nearestStations(net, pb, 4)).toEqual([]);
  });

  it("don't claim a district's population for its town", () => {
    const k = spots.list.find((s) => s.name === "Kallakurichi");
    if (k) expect(k.popShown).toBe(false);
  });
});

describe("where to go", () => {
  it("leaves your own city's neighbourhoods out", () => {
    const blr = place("bengaluru");
    const bellandur = [...net.places.values()].find((p) => p.id === "BLRR");
    if (bellandur) expect(sameTown(blr, bellandur)).toBe(true);
    expect(sameTown(blr, place("mysuru"))).toBe(false);
  });

  it("knows a big city's suburbs by its stations, not only its centre", () => {
    const mumbai = place("mumbai");
    const navi = [...net.places.values()].find((p) => p.name === "Kalamboli Goods" || p.id === "PNVL");
    if (navi && navi !== mumbai) expect(sameTown(mumbai, navi, net)).toBe(true);
    const chandannagar = [...net.places.values()].find((p) => p.name === "Chandannagar");
    if (chandannagar) expect(sameTown(place("kolkata"), chandannagar, net)).toBe(false);
    expect(sameTown(place("ahmedabad"), place("gandhinagar-capital"), net)).toBe(false);
  });
});
