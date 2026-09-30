// Small pieces of the timetable's look, kept plain: a time, a train's title, and the shimmer
// that stands in for something still loading. (They were split-flap tiles, an LED board and a
// passing landscape; the calmer versions read faster.)
import { esc } from "./esc";

/** A time ("22:05"), set in figures that line up. */
export function flapHtml(text: string, _settle = false) {
  return `<span class="clock-time">${esc(text)}</span>`;
}

/** Nothing moves any more; kept so callers needn't change. */
export function settleFlaps(_root: ParentNode) {}

/** A train's heading: its number, its name, where it runs (and in Hindi, where known). */
export function ledHtml(lead: string, name: string, route: string, routeHi = "", label = `Train ${lead}, ${name}, ${route}`) {
  return `<div class="tr-title" aria-label="${esc(label)}">
    ${lead ? `<span class="tr-no">${esc(lead)}</span>` : ""}
    <b>${esc(name)}</b>
    <small>${esc(route)}${routeHi ? ` · <span class="tr-hi" lang="hi">${esc(routeHi)}</span>` : ""}</small>
  </div>`;
}

/** Something is on its way. */
export function landscapeHtml(_cls = "") {
  return `<span class="shimmer" aria-hidden="true"></span>`;
}
