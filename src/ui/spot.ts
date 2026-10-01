// A place without a railway station of its own (Munnar, Manali, Kodaikanal): the stations to
// take a train to, the road from each, and, if you've said where you start, the whole way
// there, quickest first.
import { fmtMins, plural } from "../core/format";
import type { Spot } from "../core/spots";
import { esc } from "./esc";
import { HEART } from "./saved";

export interface WayView {
  station: string; // "Kodaikanal Road"
  code: string;
  placeId: string;
  href: string; // the station's own page (with where you start)
  roadKm: number;
  roadMins: number;
  train: { mins: number; trains: number; change?: string } | null; // from where you start, if picked
  total: number | null;
}

export interface SpotView {
  spot: Spot;
  from: string | null;
  ways: WayView[];
  airports: { code: string; name: string; km: number; mins: number }[];
  summary: { text: string; photo: string | null; page: string } | "loading" | null;
  weather: string;
  saved: boolean;
  fromChoices: string; // a search box to pick where you start, when none is
}

const ICON = {
  close: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`,
  share: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5M4 11v5h12v-5"/></svg>`,
  train: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="2" width="10" height="9" rx="2.5"/><path d="M3 7h10M5.5 14l1-3M10.5 14l-1-3"/></svg>`,
  car: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 10V8l1.5-3.5h7L13 8v2M2.5 10h11v2.5h-11zM4.5 12.5v1M11.5 12.5v1"/></svg>`,
  pin: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 14s-4.5-4.2-4.5-7.5a4.5 4.5 0 0 1 9 0C12.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/></svg>`,
};

/** The stations to take a train to, then the road: quickest first when you've said where you start. */
export function waysHtml(ways: WayView[], from: boolean) {
  return `<ol class="ways">${ways
    .map((w, i) => {
      const steps = [
        w.train
          ? `<span>${ICON.train}${w.train.change ? `${fmtMins(w.train.mins)} by train, changing at ${esc(w.train.change)}` : `${fmtMins(w.train.mins)} by train · ${plural(w.train.trains, "direct train")}`} to ${esc(w.station)}</span>`
          : `<span>${ICON.train}Train to ${esc(w.station)} (${esc(w.code)})</span>`,
        `<span>${ICON.car}then about ${fmtMins(w.roadMins)} by road, ${w.roadKm} km</span>`,
      ];
      return `<li class="way ${i === 0 && from ? "best" : ""}">
        <span class="way-n">${i + 1}</span>
        <div><b>Via ${esc(w.station)}</b><div class="way-steps">${steps.join("")}</div></div>
        <span class="way-total">${w.total !== null ? `${fmtMins(w.total)}<small>in all</small>` : `${w.roadKm} km<small>by road</small>`}</span>
        <a class="link-btn way-go" href="${esc(w.href)}" data-act="way" data-id="${esc(w.placeId)}">${from ? "See the trains" : "Trains to " + esc(w.station)} →</a>
      </li>`;
    })
    .join("")}</ol>`;
}

export function spotHtml(v: SpotView) {
  const s = v.spot;
  const nearest = v.ways.length ? Math.min(...v.ways.map((w) => w.roadKm)) : null;
  const real = !!s.roads; // road distances from OpenStreetMap, not estimated
  const island = !!s.roads && ![...s.roads.keys()].some((k) => !k.startsWith("@")); // roads to airports only: an island
  const people = s.popShown && s.pop >= 1000 ? ` · a ${s.pop >= 100000 ? "city" : "town"} of ${plural(s.pop >= 10000 ? Math.round(s.pop / 1000) * 1000 : s.pop, "people", "people")}` : "";
  const badge = s.local
    ? `Only local trains stop at ${esc(s.local)}${nearest !== null ? ` · long-distance trains about ${nearest} km away` : ""}`
    : island
      ? "No railway station, and no road to one"
      : `No railway station${nearest !== null ? ` · nearest about ${nearest} km by road` : ""}`;
  const cover = v.summary && v.summary !== "loading" && v.summary.photo
    ? `<figure class="cover"><div class="shot" data-key="${esc(v.summary.photo)}"><img src="${esc(v.summary.photo)}" alt="" fetchpriority="high" decoding="async" referrerpolicy="no-referrer" /></div>`
    : `<figure class="cover bare">`;
  const intro = v.summary === "loading"
    ? `<div class="skeleton"><span class="shimmer"></span></div>`
    : v.summary?.text
      ? `<p class="intro">${esc(v.summary.text)}</p>`
      : "";
  const ways = v.ways.length
    ? waysHtml(v.ways, !!v.from)
    : island
      ? `<p class="empty">No road reaches a railway station from here: fly, or take the ship.</p>`
      : `<p class="empty">No station with trains within 350 km. The way here is by road or by air.</p>`;
  return `<div class="panel-scroll">
    ${cover}
      <div class="panel-tools">
        <button class="round save-place" type="button" data-act="save-spot" aria-pressed="${v.saved}" aria-label="${v.saved ? `On your bucket list: remove ${esc(s.name)}` : `Add ${esc(s.name)} to your bucket list`}">${HEART}</button>
        <button class="round" type="button" data-act="share" aria-label="Share ${esc(s.name)}">${ICON.share}</button>
        <button class="round" type="button" data-act="close" aria-label="Close">${ICON.close}</button>
      </div>
      <div class="cover-text">
        <h2 class="name" id="panel-title" tabindex="-1">${esc(s.name)}</h2>
        <p class="where">${esc(s.state)}${people}</p>
        <span class="spot-badge">${ICON.pin}${badge}</span>
      </div>
    </figure>
    ${intro}
    ${v.weather}
    <section aria-labelledby="ways-h">
      <div class="section-head"><h3 id="ways-h">${v.from ? `Getting here from ${esc(v.from)}` : "Getting here"}</h3></div>
      ${v.from ? `<p class="gh-lede">Quickest first: the train, then the road from the station. ${real ? "Road times by taxi or bus are estimates." : "Road distances and times are estimates."}</p>` : `<p class="gh-lede">Take a train to one of these stations, then a taxi or bus. Say where you start to see the whole way.</p>${v.fromChoices}`}
      ${ways}
    </section>
    ${v.airports.length ? `<section aria-labelledby="air-h">
      <div class="section-head"><h3 id="air-h">By air</h3></div>
      <ul class="air">${v.airports.map((a) => `<li><span>${esc(a.name)} (${esc(a.code)})</span><small>${a.km} km · ${a.mins > a.km * 3 + 30 ? "by boat and road" : `about ${fmtMins(a.mins)} by road`}</small></li>`).join("")}</ul>
    </section>` : ""}
    <footer class="credits-foot">
      ${v.summary && v.summary !== "loading" && v.summary.text ? `Text: <a href="${esc(v.summary.page)}" target="_blank" rel="noopener">Wikipedia</a>, CC BY-SA 4.0. ` : ""}Place: <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a>. Airports: OurAirports. ${real ? `Roads: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, routed with <a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a>; times by road are estimates.` : "Road distances and times are estimates from the straight-line distance."}
    </footer>
  </div>`;
}
