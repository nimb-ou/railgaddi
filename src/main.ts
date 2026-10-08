// Boot: fetch the stations, guides and map in parallel and start the app; the timetable (the
// largest file) comes at a lower priority, and the landing page doesn't wait for it. Then stream
// in the detailed route geometry. Every data file is content-hashed by the build, so browsers and
// the CDN can keep it forever and only fetch what changed.
import "./ui/fonts.css"; // share posters load their own lettering when they're made
import "./ui/style.css";
import type { Topology } from "topojson-specification";
import metaUrl from "../data/meta.json?url";
import pathsUrl from "../data/paths.bin?url";
import pathsGzUrl from "../data/paths.bin.gz?url";
import placesUrl from "../data/places/index.json?url";
import spotsUrl from "../data/spots.json?url";
import roadsUrl from "../data/roads.json?url";
import timetableUrl from "../data/timetable.bin?url";
import trainsUrl from "../data/trains.json?url";
import timetableGzUrl from "../data/timetable.bin.gz?url";
import { App } from "./app/app";
import { parse } from "./app/router";
import { applyPathsSoftly, applyTimetableSoftly, decodeStations, type MetaFile, type TrainsFile } from "./core/network";
import { PlaceDetails, buildGuideIndex, type PlacesIndex } from "./core/places";
import { buildSlugs, titleOf } from "./core/slugs";
import { Spots } from "./core/spots";
import indiaUrl from "./assets/geo/india.json?url";
import statesUrl from "./assets/geo/state-lines.json?url";
import reliefUrl from "./assets/geo/relief.webp?url";
import { RailMap } from "./map/map";
import { applySavedTheme, setupChrome } from "./ui/chrome";
import { registerOffline } from "./ui/offline";

const shardUrls = import.meta.glob<string>("../data/places/[0-9][0-9].json", { query: "?url", import: "default", eager: true });

async function get(url: string, as: "json", priority?: RequestPriority): Promise<unknown>;
async function get(url: string, as: "buffer", priority?: RequestPriority): Promise<ArrayBuffer>;
async function get(url: string, as: "json" | "buffer", priority: RequestPriority = "auto") {
  const r = await fetch(url, { priority });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return as === "json" ? r.json() : r.arrayBuffer();
}

/** A binary data file: the gzipped copy, unpacked here (a third of the size on any host). */
async function binary(plain: string, gz: string, priority: RequestPriority = "auto"): Promise<ArrayBuffer> {
  if (!("DecompressionStream" in window)) return get(plain, "buffer", priority);
  const r = await fetch(gz, { priority });
  if (!r.ok) return get(plain, "buffer", priority);
  const buf = await r.arrayBuffer();
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf; // the host already unpacked it (Content-Encoding: gzip)
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

async function boot() {
  applySavedTheme();
  // An address with trains in it needs the timetable straight away; the landing page asks for it
  // once the map and search have arrived, so on a slow connection they come first.
  const first = parse();
  const needsTrains = !!(first.origin || first.place || first.trip || first.discover !== undefined);
  const trainsData = (priority: RequestPriority) =>
    Promise.all([binary(timetableUrl, timetableGzUrl, priority), get(trainsUrl, "json", priority) as Promise<TrainsFile>]);
  let timetable: Promise<[ArrayBuffer, TrainsFile]> | null = needsTrains ? trainsData("auto") : null;
  timetable?.catch(() => {}); // reported below, where it's awaited
  // real roads to places without a station: straight away for a link to a place, else later
  const roadsData = () => get(roadsUrl, "json", "low") as Promise<(string | null)[]>;
  const earlyRoads = first.place ? roadsData() : null;
  earlyRoads?.catch(() => {});
  const [meta, places, india, states, spotsData] = await Promise.all([
    get(metaUrl, "json") as Promise<MetaFile>,
    get(placesUrl, "json") as Promise<PlacesIndex>,
    get(indiaUrl, "json") as Promise<Topology>,
    get(statesUrl, "json") as Promise<Topology>,
    get(spotsUrl, "json") as Promise<ConstructorParameters<typeof Spots>[0]>,
  ]);
  const net = decodeStations(meta);
  const guides = buildGuideIndex(places, net);
  const slugs = buildSlugs(net, guides);
  const spots = new Spots(spotsData, (slug) => !!slugs.find(slug));
  if (earlyRoads) await earlyRoads.then((r) => spots.attachRoads(r)).catch(() => {});
  const urls = Object.keys(shardUrls)
    .sort()
    .map((k) => shardUrls[k]);
  const details = new PlaceDetails(urls, places.meta.shards);

  const map = new RailMap(document.getElementById("map") as HTMLCanvasElement, net, india, states);
  // names on the land when zoomed in: busy stations and cities, and towns without a station
  const towns: { lat: number; lon: number; name: string; rank: number }[] = [];
  for (const p of net.places.values()) {
    if (p.halts >= 8 && p.lat !== null && p.lon !== null) towns.push({ lat: p.lat, lon: p.lon, name: titleOf(p, null), rank: 1 + Math.log10(1 + p.halts) + (p.isCity ? 1 : 0) });
  }
  for (const s of spots.list) if (s.pop === 0 || s.pop >= 5000) towns.push({ lat: s.lat, lon: s.lon, name: s.name, rank: s.pop === 0 ? 3 : Math.log10(s.pop) / 1.5 });
  map.setTowns(towns);
  const app = new App(net, guides, slugs, details, map, spots);
  setupChrome(map, () => app.refreshColors());
  map.fitIndia(0);
  // the painted land (hills, plains, deserts) comes after the first paint: the lines don't wait for it
  requestAnimationFrame(() => {
    const relief = new Image();
    relief.decoding = "async";
    (relief as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "low";
    relief.onload = () => relief.decode().catch(() => {}).then(() => map.setRelief(relief));
    relief.src = reliefUrl;
  });
  if (import.meta.env.DEV) Object.assign(window, { __map: map, __net: net, __app: app });
  const loading = document.getElementById("loading")!;
  timetable ??= trainsData("low");
  const ready = timetable.then(async ([buf, names]) => {
    await applyTimetableSoftly(net, meta, buf, names); // a slice at a time: typing stays quick
    map.refreshNetwork();
    app.timetableReady();
  });
  // the landing page (and a place without a station, with nowhere to start from) needs only the
  // stations; anything with trains in it waits for the timetable
  if (first.origin || (first.place && !app.spotOnly(first)) || first.trip || first.discover !== undefined) await ready;
  app.applyRoute(first, true);
  loading.classList.add("done");
  // canvas labels are measured in the web font: re-measure once it has arrived
  document.fonts?.ready.then(() => {
    map.readTheme();
    app.settle();
  });
  ready.catch((err) => {
    console.error(err);
    app.toast("Oho, couldn't load the timetable. Check your connection and reload.", 60000);
  });
  await ready.catch(() => {});
  if (!net.ready) return;
  if (!spots.roadsLoaded) {
    roadsData()
      .then((r) => {
        spots.attachRoads(r);
        app.roadsReady();
      })
      .catch(() => {}); // the estimates stand in
  }

  // lines along the track (not straight between halts) arrive a moment later, once the place's
  // photo has had the connection to itself
  const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1200));
  const cover = document.querySelector<HTMLImageElement>(".shot img");
  await Promise.race([
    cover && !cover.complete ? new Promise((r) => cover.addEventListener("load", r, { once: true })) : Promise.resolve(),
    new Promise((r) => setTimeout(r, 8000)),
  ]);
  idle(
    () =>
      binary(pathsUrl, pathsGzUrl)
        .then(async (buf) => {
          await applyPathsSoftly(net, buf);
          app.networkDetailed();
        })
        .catch((err) => console.warn("Route geometry unavailable; drawing straight lines between halts.", err)),
    { timeout: 2500 },
  );

  registerOffline(app);
}

boot().catch((err) => {
  console.error(err);
  const box = document.getElementById("loading")!;
  box.innerHTML = `<b>Railgaddi</b><p>Oho, the gaddi got stuck: couldn't load the timetable. Check your connection and try again.</p><button type="button">Try again</button>`;
  box.querySelector("button")!.addEventListener("click", () => location.reload());
});
