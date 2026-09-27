import { describe, expect, it } from "vitest";
import { fnv1a } from "../src/core/places";
import { searchPlaces } from "../src/core/search";
import { coverWidth, photoUrl } from "../src/ui/photos";
import { guides, index, net, place } from "./load";

describe("place guides", () => {
  it("hashes titles to shards exactly like the Python pipeline", () => {
    // values from pipeline/build_places.py fnv1a()
    expect(fnv1a("Mysore")).toBe(1871456744);
    expect(fnv1a("Hampi")).toBe(298557722);
    expect(fnv1a("Kolkata/East")).toBe(841528054);
    expect(fnv1a("Śrīraṅgapaṭṭaṇa")).toBe(3148583877);
    expect(fnv1a("मैसूरु")).toBe(1821753979);
    expect(fnv1a("")).toBe(2166136261);
  });

  it("puts Hampi's guide on Hosapete station", () => {
    const hpt = [...net.places.values()].find((p) => p.stations.some((s) => net.stations[s].code === "HPT"))!;
    expect(guides.get(hpt)?.title).toBe("Hampi");
    expect(guides.get(hpt)?.featured).toBe(true);
  });

  it("finds places by guide name, local script and without diacritics", () => {
    expect(guides.get(searchPlaces(net, guides, "hampi")[0])?.title).toBe("Hampi"); // via Hosapete
    expect(searchPlaces(net, guides, "mysuru")).toContain(place("mysuru"));
    expect(searchPlaces(net, guides, "मैसूरु")).toContain(place("mysuru"));
  });

  it("serves photos from resizable Commons thumbnails, never larger than the original", () => {
    for (const [key, raw] of Object.entries(index.photos).slice(0, 200)) {
      expect(raw.t.startsWith("http"), key).toBe(false); // prefix restored by the app
      expect(raw.t, key).toMatch(/\/\d+px-[^/]+$/);
    }
    const p = { t: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/330px-X.jpg", w: 800, h: 600, by: "", lic: "", page: "" };
    expect(photoUrl(p, 960)).toMatch(/\/500px-X\.jpg$/); // 800 wide: 500 is the largest step below it
    expect(photoUrl({ ...p, w: 4000 }, 900)).toMatch(/\/960px-X\.jpg$/);
    expect(coverWidth({ ...p, w: 7000, h: 1000 }, 420, 200)).toBe(1400); // a banner needs its height's worth
    expect(coverWidth(p, 420, 200)).toBe(420);
  });
});
