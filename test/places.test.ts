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
    // a famous place outranks a small station that merely starts with the same letters
    const ham = searchPlaces(net, guides, "hamp"); // ("ham" is a station code: exact codes win)
    expect(guides.get(ham[0])?.title).toBe("Hampi");
    expect(searchPlaces(net, guides, "मैसूरु")).toContain(place("mysuru"));
  });

  it("forgives a slip, and knows a city by its stations", () => {
    expect(searchPlaces(net, guides, "banglore")[0]).toBe(place("bengaluru"));
    expect(searchPlaces(net, guides, "dehli")[0]).toBe(place("delhi"));
    expect(searchPlaces(net, guides, "varansi")[0]).toBe(place("varanasi"));
    expect(guides.get(searchPlaces(net, guides, "darjiling")[0])?.title).toBe("Darjeeling");
    expect(searchPlaces(net, guides, "hydrabad")[0]).toBe(place("hyderabad"));
    expect(searchPlaces(net, guides, "jaipur jn")[0]).toBe(place("jaipur"));
    expect(searchPlaces(net, guides, "mumbai central")[0]).toBe(place("mumbai"));
    expect(searchPlaces(net, guides, "chennai egmore")[0]).toBe(place("chennai"));
    // exact names still win, and a short name isn't bent into another
    expect(searchPlaces(net, guides, "pune")[0]).toBe(place("pune"));
    expect(searchPlaces(net, guides, "goa")[0]).toBe(place("goa"));
  });

  it("keeps renamed stations' guides, cities and old names", () => {
    const at = (code: string) => net.placeOf[net.stations.findIndex((s) => s.code === code)];
    expect(at("VGLJ").aka).toContain("Jhansi"); // Jhansi Jn -> Virangana Lakshmibai Jhansi (VGLJ)
    expect(guides.get(at("VGLJ"))?.title).toBe("Jhansi"); // its guide was matched under JHS
    expect(searchPlaces(net, guides, "jhansi")[0]).toBe(at("VGLJ"));
    expect(at("RKMP")).toBe(place("bhopal")); // Habibganj -> Rani Kamlapati, still Bhopal
    expect(searchPlaces(net, guides, "habibganj")[0]).toBe(place("bhopal"));
    const varanasi = place("varanasi").stations.map((s) => net.stations[s].code);
    expect(new Set(varanasi).size).toBe(varanasi.length); // Manduadih became BSBS, which it had
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
