// The trip planner: stops in order, the nights at each, and between them the train that runs
// that day (with the others to choose from), the road where a place has no station, the dates,
// and the weather on the day you're there when it's within the forecast.
import { fmtKm, fmtMins, fmtTime, plural } from "../core/format";
import type { PlannedLeg, Ride } from "../core/tripplan";
import { esc } from "./esc";

export interface TripStopView {
  name: string;
  note: string; // "Karnataka" or "no station · via Kodaikanal Road"
  nights: number;
  arrive: string | null; // "Sat 11 Oct, 07:10"
  leave: string | null;
  weather: string; // a line of weather for the days there, or ""
}

export interface TripView {
  date: string; // YYYY-MM-DD
  today: string;
  stops: TripStopView[];
  legs: PlannedLeg[];
  dayOf: (mins: number) => string; // "Sat 11 Oct"
  name: (p: import("../core/network").Place) => string;
  total: { days: number; trainMins: number; km: number } | null;
  saved: boolean;
  search: string; // the "add a stop" box
  ideas: { name: string; slug: string }[];
}

const ICON = {
  up: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 12V4M4.5 7.5 8 4l3.5 3.5"/></svg>`,
  down: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 4v8M4.5 8.5 8 12l3.5-3.5"/></svg>`,
  x: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
  save: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 3.5h8a.5.5 0 0 1 .5.5v12.5L10 13.4l-4.5 3.1V4a.5.5 0 0 1 .5-.5z"/></svg>`,
  share: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5M4 11v5h12v-5"/></svg>`,
};

function rideLine(r: Ride) {
  if (r.kind === "direct") {
    const l = r.leg;
    return `<b>${esc(l.train.no)} ${esc(l.train.name)}</b>`;
  }
  const [a, b] = r.conn.legs;
  return `<b>${esc(a.train.no)} then ${esc(b.train.no)}</b> <span>(change at ${esc(r.conn.via.name)})</span>`;
}

const rideMins = (r: Ride) => (r.kind === "direct" ? r.leg.dur : r.conn.total);
const rideDep = (r: Ride) => (r.kind === "direct" ? r.leg.dep : r.conn.legs[0].dep);

function hopHtml(v: TripView, leg: PlannedLeg, i: number) {
  if (leg.roadOnly) {
    return `<div class="hop none"><div class="hop-card"><b>By road, about ${fmtMins(leg.roadOnly.mins)}</b><div class="hop-when"><span>${v.dayOf(leg.depart)} · about ${leg.roadOnly.km} km by bus or taxi</span></div>
      <div class="road">No train links these within a week, even with one change. The road is the way most people go.</div></div></div>`;
  }
  if (!leg.rail) {
    const mins = (leg.roadBefore?.road.mins ?? 0) + (leg.roadAfter?.road.mins ?? 0);
    return `<div class="hop none"><div class="hop-card"><b>By road</b><div class="road">About ${fmtMins(mins)}, ${(leg.roadBefore?.road.km ?? 0) + (leg.roadAfter?.road.km ?? 0)} km. These two are close: no train needed.</div></div></div>`;
  }
  const road = [
    leg.roadBefore ? `Road to ${esc(v.name(leg.roadBefore.place))}: about ${fmtMins(leg.roadBefore.road.mins)} (${leg.roadBefore.road.km} km)` : "",
    leg.roadAfter ? `Then road from ${esc(v.name(leg.roadAfter.place))}: about ${fmtMins(leg.roadAfter.road.mins)} (${leg.roadAfter.road.km} km)` : "",
  ].filter(Boolean);
  if (!leg.ride) {
    return `<div class="hop none"><div class="hop-card"><b>No train from ${esc(v.name(leg.rail.a))} to ${esc(v.name(leg.rail.b))} within a week</b>
      <div class="road">Not even with one change in our timetable. Try a stop in between, or go by road.</div></div></div>`;
  }
  const chosen = leg.ride;
  const tm = leg.times[leg.chosen];
  const others = leg.options.length > 1
    ? `<details><summary>${plural(leg.options.length - 1, "other train")} that day</summary>${leg.options
        .map((r, k) => `<button class="alt" type="button" data-act="trip-alt" data-leg="${i}" data-k="${k}" aria-pressed="${r === chosen}">${fmtTime(rideDep(r))} · ${rideLine(r)} · ${fmtMins(rideMins(r))}</button>`)
        .join("")}</details>`
    : "";
  return `<div class="hop"><div class="hop-card">
    ${rideLine(chosen)}
    <div class="hop-when"><span>${v.dayOf(tm.depart)}, ${fmtTime(tm.depart % 1440)} → ${Math.floor(tm.arrive / 1440) > Math.floor(tm.depart / 1440) ? `${v.dayOf(tm.arrive)}, ` : ""}${fmtTime(tm.arrive % 1440)}</span><b>${fmtMins(tm.arrive - tm.depart)}</b></div>
    ${road.map((r) => `<div class="road">${r}</div>`).join("")}
    ${others}
    <button class="link-btn" type="button" data-act="trip-train" data-leg="${i}">See the stops →</button>
  </div></div>`;
}

export function tripHtml(v: TripView) {
  const n = v.stops.length;
  const stops = v.stops
    .map((s, i) => {
      const when = i === 0 ? (s.leave ? `Leave ${s.leave}` : "Start") : s.arrive ? `Arrive ${s.arrive}` : "";
      const card = `<li class="stop-card">
        <span class="stop-n">${i + 1}</span>
        <div>
          <b>${esc(s.name)}</b>
          <small>${esc(s.note)}${when ? ` · ${esc(when)}` : ""}</small>
          ${s.weather ? `<small>${s.weather}</small>` : ""}
          ${i > 0 && i < n - 1 ? `<span class="nights" role="group" aria-label="Nights at ${esc(s.name)}">
            <button type="button" data-act="trip-nights" data-i="${i}" data-d="-1" aria-label="One night fewer">−</button>
            <span>${s.nights === 0 ? "Passing through" : plural(s.nights, "night")}</span>
            <button type="button" data-act="trip-nights" data-i="${i}" data-d="1" aria-label="One night more">+</button>
          </span>` : ""}
        </div>
        <span class="stop-tools">
          ${i > 0 ? `<button type="button" data-act="trip-move" data-i="${i}" data-d="-1" aria-label="Move ${esc(s.name)} earlier" title="Earlier">${ICON.up}</button>` : ""}
          ${i < n - 1 ? `<button type="button" data-act="trip-move" data-i="${i}" data-d="1" aria-label="Move ${esc(s.name)} later" title="Later">${ICON.down}</button>` : ""}
          <button type="button" data-act="trip-remove" data-i="${i}" aria-label="Remove ${esc(s.name)}" title="Remove">${ICON.x}</button>
        </span>
      </li>`;
      return card + (i < v.legs.length ? `<li>${hopHtml(v, v.legs[i], i)}</li>` : "");
    })
    .join("");
  const empty = !n
    ? `<div class="trip-empty"><b>Add where you start</b>, then each place you want to go, in order. Places without a station work too: we'll find the station and the road.
        ${v.ideas.length ? `<div class="trip-ideas">${v.ideas.map((x) => `<button class="pill" type="button" data-act="trip-idea" data-slug="${esc(x.slug)}">${esc(x.name)}</button>`).join("")}</div>` : ""}</div>`
    : n === 1
      ? `<p class="trip-empty">Now add the first place you want to go.</p>`
      : "";
  return `<div class="panel-scroll"><div class="trip">
    <h2 id="panel-title" tabindex="-1">Plan a trip</h2>
    <p class="lede">Stops in order, nights at each: we pick the train that runs that day.</p>
    <label class="trip-date">Leaving on <input type="date" id="trip-date" value="${esc(v.date)}" min="${esc(v.today)}" /></label>
    <ol class="stops">${stops}</ol>
    ${empty}
    <div class="add-stop">${v.search}</div>
    ${v.total ? `<dl class="trip-sum">
      <div><dt>Days</dt><dd>${v.total.days}</dd></div>
      <div><dt>On trains</dt><dd>${fmtMins(v.total.trainMins)}</dd></div>
      <div><dt>Distance</dt><dd>${fmtKm(v.total.km)} km</dd></div>
    </dl>
    <div class="trip-actions">
      <button class="btn primary" type="button" data-act="trip-save" aria-pressed="${v.saved}">${ICON.save}${v.saved ? "Saved" : "Save trip"}</button>
      <button class="btn" type="button" data-act="share">${ICON.share}Share</button>
      <button class="btn" type="button" data-act="trip-clear">Start again</button>
    </div>
    <p class="note" style="margin-top:12px">Times from the timetable; running days where known, otherwise assumed daily. Check <a href="https://enquiry.indianrail.gov.in/mntes/" target="_blank" rel="noopener">NTES</a> and book on IRCTC.</p>` : ""}
  </div></div>`;
}
