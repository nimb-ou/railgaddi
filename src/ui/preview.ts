// What a shared link shows before the scripts have run: the view drawn into the page at build
// time (scripts/prerender.ts), in the same markup the app draws, so the photo and the name are
// there at once and the app takes over in place (keeping the photo) when the timetable arrives.
// Nothing here is live: no next train, no weather; those wait for the app.
import { fmtKm, fmtMins, plural } from "../core/format";
import type { Photo } from "../core/places";
import { esc } from "./esc";
import { archCover, thumb } from "./panel";

const TOOLS_SPACE = `<span class="top-tools" aria-hidden="true"><span class="round"></span><span class="round"></span></span>`;
const WAIT = `<p class="pre-wait" role="status"><i aria-hidden="true"></i>Finding the next train…</p>`;

/** A place with a station: its photo in the arch, its name, and (from a start) the ride's length. */
export function placePreview(o: {
  title: string;
  cover: Photo | null;
  script: string;
  where: string; // already escaped, may hold <b>
  intro: string;
  back: { href: string; label: string };
  ride?: { from: string; fastest: number; trains: number; km: number };
}) {
  const ticket = o.ride
    ? `<div class="ticket pre">
      <div class="tk tk-a">
        <div><span class="l">${esc(o.ride.from)} → ${esc(o.title)}</span><span class="n">${fmtMins(o.ride.fastest)}</span><span class="s">fastest of ${plural(o.ride.trains, "direct train")}</span></div>
        <div class="r"><span class="l">By rail</span><span class="n">${fmtKm(o.ride.km)}</span><span class="s">km</span></div>
      </div>
      <div class="tk">${WAIT}</div>
    </div>`
    : "";
  return `<div class="panel-scroll">
    <div class="top-bar"><a class="back" href="${esc(o.back.href)}">← ${esc(o.back.label)}</a>${TOOLS_SPACE}</div>
    ${archCover(o.cover, o.title)}
    <div class="pl-name">
      ${o.script ? `<span class="script">${esc(o.script)}</span>` : ""}
      <h1 class="name" id="panel-title" tabindex="-1">${esc(o.title)}</h1>
      <p class="where">${o.where}</p>
    </div>
    ${ticket}
    ${o.intro ? `<p class="intro">${esc(o.intro)}</p>` : ""}
  </div>`;
}

/** A place without a station: its name, and the stations to take a train to. */
export function spotPreview(o: { name: string; state: string; badge: string; home: string; ways: { name: string; href: string; km: number; mins: number }[] }) {
  return `<div class="panel-scroll">
    <div class="top-bar"><a class="back" href="${esc(o.home)}">← Home</a>${TOOLS_SPACE}</div>
    ${archCover(null, o.name)}
    <div class="pl-name">
      <h1 class="name" id="panel-title" tabindex="-1">${esc(o.name)}</h1>
      <p class="where">${esc(o.state)}</p>
      <span class="spot-badge">${esc(o.badge)}</span>
    </div>
    <section aria-labelledby="ways-h">
      <div class="section-head"><h2 id="ways-h">How to get here</h2></div>
      <ol class="ways">${o.ways
        .map(
          (w, i) => `<li class="way"><span class="way-n">${i + 1}</span><div><b>Via <a href="${esc(w.href)}">${esc(w.name)}</a></b><div class="way-steps"><span>Train to ${esc(w.name)}</span><span>then about ${fmtMins(w.mins)} by taxi or bus</span></div></div><span class="way-total">${w.km} km<small>by road</small></span></li>`,
        )
        .join("")}</ol>
    </section>
  </div>`;
}

/** Where a station's trains go: the first few places, nearest first. */
export function originPreview(o: { from: string; places: number; items: { title: string; state: string; mins: number; trains: number; href: string; photo: Photo | null; guide: boolean }[] }) {
  return `<div class="panel-scroll"><div class="explore">
    <header class="ex-head">
      <h1 id="panel-title" tabindex="-1">From ${esc(o.from)}</h1>
      <p>Pick how long you'll ride, and watch the lines light up.</p>
    </header>
    <p class="count-line"><b>${o.places.toLocaleString("en-IN")}</b> ${o.places === 1 ? "place" : "places"} by direct train, no changing</p>
    <ol class="dest-list">${o.items
      .map(
        (it) => `<li><a href="${esc(it.href)}">
          ${thumb(it.photo, it.title, it.guide)}
          <span class="dl-name"><b>${esc(it.title)}</b><small>${esc(it.state)}</small></span>
          <span class="dl-time"><b>${fmtMins(it.mins)}</b><small>${plural(it.trains, "train")}</small></span>
        </a></li>`,
      )
      .join("")}</ol>
  </div></div>`;
}
