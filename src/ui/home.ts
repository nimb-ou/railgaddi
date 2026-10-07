// What the panel shows before anything is picked, and the places you can reach once a start is.
import { fmtMins, plural } from "../core/format";
import type { Network, Place } from "../core/network";
import type { GuideView, Photo } from "../core/places";
import type { Spot, Spots } from "../core/spots";
import type { Kind, Leave } from "../core/trips";
import { esc } from "./esc";
import { img, thumb } from "./panel";
import { coverWidth, photoUrl } from "./photos";

export interface HomeView {
  last: { id: string; name: string; href: string } | null; // where you started last time
  popular: { id: string; name: string; href: string; photo: Photo | null }[];
  hills: { name: string; href: string; note: string }[]; // places with no station of their own
  ideas: { title: string; note: string; href: string; photo: Photo | null }[];
  fact: { text: string; href: string } | null;
}

const PLAN = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7 5h5.5a2.5 2.5 0 0 1 0 5h-5a2.5 2.5 0 0 0 0 5H13"/></svg>`;
const BACK = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 3v2.5h2.5"/></svg>`;

/** Where most people start from. */
export const POPULAR = ["bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad"];
/** Hill towns people ask about, none with a station of its own. */
export const HILLS: [string, string][] = [["Munnar", "Kerala"], ["Manali", "Himachal Pradesh"], ["Kodaikanal", "Tamil Nadu"], ["Gangtok", "Sikkim"], ["Leh", "Ladakh"], ["Madikeri", "Karnataka"], ["Mussoorie", "Uttarakhand"], ["McLeod Ganj", "Himachal Pradesh"], ["Kasol", "Himachal Pradesh"], ["Tawang", "Arunachal Pradesh"]];
const IDEAS: [string, string][] = [["Hampi", "Boulders and temples"], ["Darjeeling", "Tea, and the toy train"], ["Varanasi", "The ghats at dawn"], ["Goa", "Beaches and old churches"]];

/**
 * The landing panel's content, the same in the app and in the page written at build time (which
 * shows it before the scripts have run, its links working without them).
 */
export function landingView(o: {
  net: Network;
  guides: Map<Place, GuideView>;
  slugOf: (p: Place) => string;
  spots: Spots;
  titlePlace: Map<string, Place>; // a guide's title -> its place
  link: (r: { origin?: string; place?: string; discover?: string }) => string;
  last: Place | null; // where you started last time (on this device)
  fact: string | null;
}): HomeView {
  const find = (name: string, state: string) => o.spots.list.find((s) => s.name === name && s.state === state);
  return {
    last: o.last ? { id: o.last.id, name: o.last.name, href: o.link({ origin: o.slugOf(o.last) }) } : null,
    popular: POPULAR.map((id) => o.net.places.get(id)).filter((p): p is Place => !!p && p !== o.last).map((p) => ({ id: p.id, name: p.name, href: o.link({ origin: o.slugOf(p) }), photo: o.guides.get(p)?.icon ?? null })),
    hills: HILLS.map(([n, st]) => find(n, st)).filter((s): s is Spot => !!s).map((s) => ({ name: s.name, href: o.link({ place: s.id }), note: `${s.name}, ${s.state}: no station, see how to get there` })),
    ideas: IDEAS.flatMap(([title, note]) => {
      const p = o.titlePlace.get(title);
      return p ? [{ title, note, href: o.link({ place: o.slugOf(p) }), photo: o.guides.get(p)?.icon ?? null }] : [];
    }),
    fact: o.fact ? { text: o.fact, href: o.link({ discover: "" }) } : null,
  };
}

export function homeHtml(v: HomeView) {
  const face = (p: Photo | null) => (p ? `<img src="${esc(photoUrl(p, 120))}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer" />` : `<i></i>`);
  return `<div class="panel-scroll"><div class="home">
    <h1 id="panel-title" tabindex="-1">Where can the train take you?</h1>
    <p class="lede">Pick your station to see every place you can reach. Or search for where you want to go, even hill towns with no station of their own.</p>
    <nav class="popular" aria-label="Popular places to start from">
      ${v.last ? `<a class="pill last" href="${esc(v.last.href)}" data-act="from" data-id="${esc(v.last.id)}" title="Where you started last time">${BACK}${esc(v.last.name)}</a>` : ""}
      ${v.popular.map((p) => `<a class="pill" href="${esc(p.href)}" data-act="from" data-id="${esc(p.id)}">${face(p.photo)}${esc(p.name)}</a>`).join("")}
    </nav>
    <button class="cta" type="button" data-act="plan"><span class="cta-icon">${PLAN}</span><span><b>Plan a trip</b><small>Several stops, the train that runs each day, and the weather when you're there.</small></span></button>

    <h2>No station? No problem</h2>
    <nav class="chips" aria-label="Places without a station">${v.hills.map((h) => `<a class="pill" href="${esc(h.href)}" data-act="goto" title="${esc(h.note)}">${esc(h.name)}</a>`).join("")}</nav>

    <h2>Ideas</h2>
    <div class="idea-grid">${v.ideas
      .map((i) => `<a class="idea" href="${esc(i.href)}" data-act="goto">${i.photo ? img(i.photo, `${coverWidth(i.photo, 180, 135)}px`, 250, 500) : ""}<span>${esc(i.title)}<small>${esc(i.note)}</small></span></a>`)
      .join("")}</div>
    ${v.fact ? `<p class="hero-fact"><span>Did you know?</span>${esc(v.fact.text)} <a href="${esc(v.fact.href)}" data-act="discover">More in Discover →</a></p>` : ""}
  </div></div>`;
}

export interface ExploreItem {
  id: string;
  title: string;
  state: string;
  mins: number;
  trains: number;
  photo: Photo | null;
  guide: boolean; // has a travel guide (a photo may still be missing)
  appeal: number; // how much there is to see
  href: string;
}

export interface ExploreView {
  from: string;
  places: number;
  trains: number;
  items: ExploreItem[];
  showAll: boolean;
  withGuides: boolean;
  famous: boolean; // most to see first, not nearest
  kind: Kind;
  within: number;
  leave: Leave;
  noneLeave: boolean; // nothing leaves from here at all
}

const WITHIN: [number, string][] = [[Infinity, "Any length"], [120, "Up to 2 h"], [240, "Up to 4 h"], [360, "Up to 6 h"], [600, "Up to 10 h"], [960, "Up to 16 h"], [1440, "Up to a day"]];
const KINDS: [Kind, string][] = [["all", "All trains"], ["long", "Express and mail"], ["local", "Local: passenger, MEMU, DEMU"], ["toy", "Toy trains"]];
const LEAVES: [Leave, string][] = [["any", "Leaving any time"], ["2h", "In the next 2 h"], ["6h", "In the next 6 h"], ["overnight", "Overnight"]];

const select = <T extends string | number>(name: string, label: string, value: T, options: [T, string][]) =>
  `<select data-f="${name}" aria-label="${esc(label)}" class="${value === options[0][0] ? "" : "on"}">${options
    .map(([v, t]) => `<option value="${esc(String(v))}"${v === value ? " selected" : ""}>${esc(t)}</option>`)
    .join("")}</select>`;

/** Everywhere you can go from here, nearest first, with the filters that narrow it. */
export function exploreHtml(v: ExploreView) {
  const shown = v.showAll ? v.items : v.items.slice(0, 60);
  const within = WITHIN.some(([w]) => w === v.within) ? v.within : Infinity;
  const filtered = v.kind !== "all" || within !== Infinity || v.leave !== "any";
  return `<div class="panel-scroll">
    <header class="explore-head">
      <div>
        <h2 id="panel-title" tabindex="-1">From ${esc(v.from)}</h2>
        <p>${v.noneLeave ? "No trains leave from here in the timetable" : `${plural(v.places, "place")} · ${plural(v.trains, "train")}`}</p>
      </div>
      <button class="btn" type="button" data-act="surprise">Surprise me</button>
    </header>
    <div class="filters" role="group" aria-label="Filters">
      ${select("kind", "Which trains", v.kind, KINDS)}
      ${select("within", "Longest ride", within, WITHIN)}
      ${select("leave", "When you leave", v.leave, LEAVES)}
    </div>
    <div class="explore-tools">
      <div class="seg" role="group" aria-label="Show">
        <button type="button" data-act="list-guides" aria-pressed="${v.withGuides}">With guides</button>
        <button type="button" data-act="list-all" aria-pressed="${!v.withGuides}">Every stop</button>
      </div>
      ${v.withGuides ? `<select class="sort" data-sort aria-label="Order"><option value="near"${v.famous ? "" : " selected"}>Nearest first</option><option value="famous"${v.famous ? " selected" : ""}>Most to see first</option></select>` : ""}
      ${filtered ? `<button class="link-btn" type="button" data-act="reset">Clear filters</button>` : ""}
    </div>
    ${shown.length
      ? `<ol class="dest-list">${shown
          .map(
            (it) => `<li><a href="${esc(it.href)}" data-act="nav" data-id="${esc(it.id)}">
              ${thumb(it.photo, it.title, it.guide)}
              <span class="dl-name"><b>${esc(it.title)}</b><small>${esc(it.state)}</small></span>
              <span class="dl-time"><b>${fmtMins(it.mins)}</b><small>${plural(it.trains, "train")}</small></span>
            </a></li>`,
          )
          .join("")}</ol>`
      : `<p class="empty" style="margin: 16px 18px">${v.noneLeave ? "Try a nearby bigger station." : v.withGuides && v.places ? "None of these places has a travel guide. Try “Every stop”." : "No train matches these filters."}</p>`}
    ${!v.showAll && v.items.length > shown.length ? `<button class="link-btn show-all" type="button" data-act="list-more">Show all ${v.items.length}</button>` : ""}
  </div>`;
}
