// The same places as the map, as a list: quick to scan, and fully usable with a keyboard or a
// screen reader. Shown in the panel.
import { fmtMins, plural } from "../core/format";
import type { Photo } from "../core/places";
import { ledHtml } from "./boards";
import { esc, img } from "./panel";
import { coverWidth } from "./photos";

export interface ListItem {
  title: string;
  state: string;
  mins: number;
  trains: number;
  photo: Photo | null;
  href: string;
  id: string;
}

const CLOSE = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`;

export function listHtml(from: string, fromHi: string, items: ListItem[], showAll: boolean, withGuides: boolean) {
  const shown = showAll ? items : items.slice(0, 60);
  // a departures board: where you can go from here, nearest first
  return `<div class="panel-scroll">
    <header class="list-head">
      <h2 id="panel-title" class="vh" tabindex="-1">From ${esc(from)}: ${plural(items.length, "place")}, nearest first</h2>
      ${ledHtml("", `Departures · ${from}`, `${plural(items.length, "place")} · nearest first`, fromHi ? `${fromHi} से प्रस्थान` : "", `Departures from ${from}`)}
      <button class="round" type="button" data-act="close" aria-label="Close list">${CLOSE}</button>
    </header>
    <div class="seg list-filter" role="group" aria-label="Show">
      <button type="button" data-act="list-guides" aria-pressed="${withGuides}">With travel guides</button>
      <button type="button" data-act="list-all" aria-pressed="${!withGuides}">Every stop</button>
    </div>
    <ol class="dest-list">
      ${shown
        .map(
          (it) => `<li><a href="${esc(it.href)}" data-act="nav" data-id="${esc(it.id)}">
            ${it.photo ? img(it.photo, `${coverWidth(it.photo, 44, 44)}px`, 120, 500) : `<i class="stop-dot" aria-hidden="true"></i>`}
            <span class="dl-name"><b>${esc(it.title)}</b><small>${esc(it.state)}</small></span>
            <span class="dl-time"><b>${fmtMins(it.mins)}</b><small>${plural(it.trains, "train")}</small></span>
          </a></li>`,
        )
        .join("")}
    </ol>
    ${!showAll && items.length > shown.length ? `<button class="link-btn show-all" type="button" data-act="list-more">Show all ${items.length}</button>` : ""}
  </div>`;
}
