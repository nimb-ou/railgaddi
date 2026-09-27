// Boot: fetch the core data in parallel, decode it, start the app, then stream in the
// detailed route geometry. Every data file is content-hashed by the build, so browsers and the
// CDN can keep it forever and only fetch what changed.
import "@fontsource-variable/archivo/wdth.css";
import "./ui/fonts.css";
import "./ui/style.css";
import type { Topology } from "topojson-specification";
import metaUrl from "../data/meta.json?url";
import pathsUrl from "../data/paths.bin?url";
import placesUrl from "../data/places/index.json?url";
import timetableUrl from "../data/timetable.bin?url";
import { App } from "./app/app";
import { parse } from "./app/router";
import { istNow } from "./core/format";
import { applyPaths, decodeNetwork, type MetaFile } from "./core/network";
import { PlaceDetails, buildGuideIndex, type PlacesIndex } from "./core/places";
import { buildSlugs } from "./core/slugs";
import indiaUrl from "./assets/geo/india.json?url";
import statesUrl from "./assets/geo/state-lines.json?url";
import { RailMap } from "./map/map";
import { applySavedTheme, setupChrome } from "./ui/chrome";
import { registerOffline } from "./ui/offline";

const shardUrls = import.meta.glob<string>("../data/places/[0-9][0-9].json", { query: "?url", import: "default", eager: true });

async function get(url: string, as: "json"): Promise<unknown>;
async function get(url: string, as: "buffer"): Promise<ArrayBuffer>;
async function get(url: string, as: "json" | "buffer") {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return as === "json" ? r.json() : r.arrayBuffer();
}

async function boot() {
  applySavedTheme();
  const [meta, timetable, places, india, states] = await Promise.all([
    get(metaUrl, "json") as Promise<MetaFile>,
    get(timetableUrl, "buffer"),
    get(placesUrl, "json") as Promise<PlacesIndex>,
    get(indiaUrl, "json") as Promise<Topology>,
    get(statesUrl, "json") as Promise<Topology>,
  ]);
  const net = decodeNetwork(meta, timetable);
  const guides = buildGuideIndex(places, net);
  const slugs = buildSlugs(net, guides);
  const urls = Object.keys(shardUrls)
    .sort()
    .map((k) => shardUrls[k]);
  const details = new PlaceDetails(urls, places.meta.shards);

  const map = new RailMap(document.getElementById("map") as HTMLCanvasElement, net, india, states);
  map.simMinute = istNow();
  const app = new App(net, guides, slugs, details, map);
  setupChrome(map, () => app.refreshColors());
  map.fitIndia(0);
  app.applyRoute(parse(), true);
  // canvas labels are measured in the web font: re-measure once it has arrived
  document.fonts?.ready.then(() => {
    map.readTheme();
    app.settle();
  });
  document.getElementById("loading")!.classList.add("done");
  if (import.meta.env.DEV) Object.assign(window, { __map: map, __net: net, __app: app });

  // lines along the track (not straight between halts) arrive a moment later
  get(pathsUrl, "buffer")
    .then((buf) => {
      applyPaths(net, buf);
      app.networkDetailed();
    })
    .catch((err) => console.warn("Route geometry unavailable; drawing straight lines between halts.", err));

  registerOffline(app);
}

boot().catch((err) => {
  console.error(err);
  const box = document.getElementById("loading")!;
  box.innerHTML = `<b>Railgaddi</b><p>Couldn't load the timetable. Check your connection and try again.</p><button type="button">Retry</button>`;
  box.querySelector("button")!.addEventListener("click", () => location.reload());
});
