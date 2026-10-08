// What the panel shows before anything is picked, and the places you can reach once a start is:
// how long you'll ride (the lines on the map grow with it), a few lenses (quick getaways,
// overnight, weekends), and the places themselves, a handful at a time.
import { MONTH_NAMES, MOODS, type Mood } from "../core/climate";
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

const PLAN = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7 5h5.5a2.5 2.5 0 0 1 0 5h-5a2.5 2.5 0 0 0 0 5H13"/></svg>`;
const BACK = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 3v2.5h2.5"/></svg>`;
const SUN = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10" r="3.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>`;
const DICE = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="3.5" y="3.5" width="13" height="13" rx="3"/><circle cx="7.5" cy="7.5" r=".6"/><circle cx="12.5" cy="12.5" r=".6"/><circle cx="12.5" cy="7.5" r=".6"/><circle cx="7.5" cy="12.5" r=".6"/></svg>`;

/** Where most people start from. */
export const POPULAR = ["bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad"];
/** Hill towns people ask about, none with a station of its own. */
export const HILLS: [string, string][] = [["Munnar", "Kerala"], ["Manali", "Himachal Pradesh"], ["Kodaikanal", "Tamil Nadu"], ["Gangtok", "Sikkim"], ["Leh", "Ladakh"], ["Madikeri", "Karnataka"], ["Mussoorie", "Uttarakhand"], ["McLeod Ganj", "Himachal Pradesh"], ["Kasol", "Himachal Pradesh"], ["Tawang", "Arunachal Pradesh"]];
const IDEAS: [string, string][] = [["Hampi", "Boulders, ruins, sunsets"], ["Darjeeling", "Chai and the toy train"], ["Varanasi", "The ghats at dawn"], ["Udaipur", "Lakes and palaces"]];

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
    <button class="here" type="button" data-act="near"><i aria-hidden="true"></i><span>I'm right here: use where I am</span></button>
    <nav aria-label="Popular places to start from">
      <span class="lbl">Or hop on at</span>
      <div class="chips popular">
        ${v.last ? `<a class="pill last" href="${esc(v.last.href)}" data-act="from" data-id="${esc(v.last.id)}" title="Where you started last time">${BACK}${esc(v.last.name)}</a>` : ""}
        ${v.popular.map((p) => `<a class="pill" href="${esc(p.href)}" data-act="from" data-id="${esc(p.id)}">${face(p.photo)}${esc(p.name)}</a>`).join("")}
      </div>
    </nav>
    <button class="link-btn ask-to" type="button" data-act="ask-to">Already know where you're going? Search it →</button>

    <section class="hills" aria-labelledby="hills-h" style="margin:6px 0 0">
      <h2 id="hills-h">No station? Koi gal nahi.</h2>
      <p class="sub">The hills don't all have a station. We'll find the nearest one, and the road from there.</p>
      <nav class="chips" aria-label="Places without a station">${v.hills.map((h) => `<a href="${esc(h.href)}" data-act="goto" title="${esc(h.note)}">${esc(h.name)}</a>`).join("")}</nav>
    </section>

    ${v.ideas.length ? `<section aria-labelledby="ideas-h" style="margin:6px 0 0">
      <h2 id="ideas-h">Ideas, ekdum first class</h2>
      <p class="sub">Not sure yet? Start with one of these.</p>
      <div class="ideas">${v.ideas
        .map((i) => `<a class="idea" href="${esc(i.href)}" data-act="goto"><span class="arch">${i.photo ? img(i.photo, `${coverWidth(i.photo, 90, 108)}px`, 250, 500) : `<i class="ph">${esc(i.title.charAt(0))}</i>`}</span><b>${esc(i.title)}</b><small>${esc(i.note)}</small></a>`)
        .join("")}</div>
    </section>` : ""}

    <button class="cta" type="button" data-act="plan"><span class="cta-icon">${PLAN}</span><span><b>Plan a proper yatra</b><small>Several stops, the train that runs each day, and the weather when you're there.</small></span></button>
    ${v.fact ? `<p class="hero-fact"><span>Oye, did you know?</span>${esc(v.fact.text)} <a href="${esc(v.fact.href)}" data-act="discover">More stories →</a></p>` : ""}
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
  note?: string; // the train that fits the lens ("22:30 → 06:10 · Udyan Express")
  img?: string; // a photo's address, for a place without a station (its Wikipedia summary's)
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
  mood: Mood | null; // only places of this kind
  moodsOpen: boolean; // the moods' chips are showing
  good: boolean; // only places whose weather is good this month
  month: number; // this month, 0 = January
}

/** How long you'll ride: the steps, and what each one feels like. */
export const STEPS: [number, string, string][] = [
  [120, "2 h", "Back home in time for lunch"],
  [240, "4 h", "A quick getaway: there and back in a day"],
  [480, "8 h", "One good nap and you're there"],
  [720, "12 h", "A proper safar. Pack the parathas"],
  [1440, "A day", "Bring the pillow and the achaar"],
  [Infinity, "Any", "As far as the tracks go. Balle balle!"],
];
const SPAN: Record<number, string> = { 120: "2 hours", 240: "4 hours", 480: "8 hours", 720: "12 hours", 1440: "a day" };

export type Lens = "quick" | "overnight" | "weekend" | null;
/** The lens the filters amount to. */
export function lensOf(within: number, leave: Leave): Lens {
  if (leave === "overnight") return "overnight";
  if (leave === "weekend") return "weekend";
  if (within === 240 && leave === "any") return "quick";
  return null;
}

const KINDS: [Kind, string][] = [["all", "All trains"], ["long", "Express and mail"], ["local", "Local: passenger, MEMU, DEMU"], ["toy", "Toy trains"]];
const LEAVES: [Leave, string][] = [["any", "Leaving any time"], ["2h", "In the next 2 h"], ["6h", "In the next 6 h"], ["overnight", "Overnight"], ["weekend", "For a weekend"]];

const select = <T extends string | number>(name: string, label: string, value: T, options: [T, string][]) =>
  `<select data-f="${name}" aria-label="${esc(label)}" class="${value === options[0][0] ? "" : "on"}">${options
    .map(([v, t]) => `<option value="${esc(String(v))}"${v === value ? " selected" : ""}>${esc(t)}</option>`)
    .join("")}</select>`;

const NOUNS: Record<Mood, [string, string]> = {
  sea: ["place by the sea", "places by the sea"],
  hills: ["place up in the hills", "places up in the hills"],
  spirit: ["temple town or shrine", "temple towns and shrines"],
  heritage: ["place with forts and palaces", "places with forts and palaces"],
  wild: ["wild, green place", "wild, green places"],
  city: ["big city", "big cities"],
};

/** "<b>160</b> quick getaways, under 4 hours away", "<b>14</b> places by the sea within 8 hours, all good in October" */
function countLine(v: ExploreView, lens: Lens) {
  const n = v.items.length;
  const b = `<b>${n.toLocaleString("en-IN")}</b>`;
  const one = n === 1;
  const noun = v.mood ? NOUNS[v.mood][one ? 0 : 1] : !v.withGuides ? (one ? "stop" : "stops") : one ? "place" : "places";
  const good = v.good ? `, ${one ? "good" : "all good"} in ${MONTH_NAMES[v.month]}` : "";
  if (lens === "quick" && !v.mood) return `${b} quick ${one ? "getaway" : "getaways"}, under 4 hours away${good}`;
  if (lens === "quick") return `${b} ${noun} under 4 hours away${good}`;
  if (lens === "overnight") return `${b} ${noun} a night train gets you to by morning${good}. Board after dinner, wake up there`;
  if (lens === "weekend" && !v.mood) return `${b} weekend ${one ? "escape" : "escapes"}${good}: leave Friday night or Saturday morning`;
  if (lens === "weekend") return `${b} ${noun} for a weekend${good}: leave Friday night or Saturday morning`;
  if (v.mood === "hills") return `${b} ${noun}${v.within === Infinity ? "" : ` within ${SPAN[v.within] ?? fmtMins(v.within)} by train`}${good}: a direct train, then the road up where there's no station`;
  if (v.within === Infinity) return `${b} ${noun} by direct train, no changing${good}`;
  return `${b} ${noun} within ${SPAN[v.within] ?? fmtMins(v.within)}${good}`;
}

/** Everywhere you can go from here, nearest first, with how long you'll ride and the lenses. */
export function exploreHtml(v: ExploreView) {
  const shown = v.showAll ? v.items : v.items.slice(0, 6);
  const lens = lensOf(v.within, v.leave);
  const step = STEPS.find(([w]) => w === v.within && v.leave !== "overnight" && v.leave !== "weekend");
  const tuned = v.kind !== "all" || v.leave === "2h" || v.leave === "6h" || !v.withGuides || v.famous;
  const lensBtn = (l: Exclude<Lens, null>, label: string) => `<button type="button" data-act="lens" data-lens="${l}" aria-pressed="${lens === l}">${label}</button>`;
  return `<div class="panel-scroll"><div class="explore">
    <header class="ex-head">
      <h2 id="panel-title" tabindex="-1">From ${esc(v.from)}</h2>
      <p>${v.noneLeave ? "No trains leave from here in our timetable. Try a bigger station nearby?" : "Pick how long you'll ride, and watch the lines light up."}</p>
    </header>
    ${v.noneLeave ? "" : `<div class="ride">
      <span class="lbl" id="ride-l">How long will you ride?</span>
      <div class="seg" role="group" aria-labelledby="ride-l">${STEPS.map(([w, l]) => `<button type="button" data-act="within" data-v="${w}" aria-pressed="${step?.[0] === w}">${l}</button>`).join("")}</div>
      <p class="ride-cap" aria-live="polite">${step ? esc(step[2]) : lens === "overnight" ? "Sleep on the train, wake up somewhere new" : lens === "weekend" ? "Two days, one bag, zero tension" : ""}</p>
      <span class="key" aria-hidden="true">Sooner<i></i>Later</span>
    </div>
    <div class="chips lenses" role="group" aria-label="Kinds of trip">
      ${lensBtn("quick", "Quick getaways")}${lensBtn("overnight", "Overnight")}${lensBtn("weekend", "Weekends")}
      <button type="button" data-act="good" aria-pressed="${v.good}">${SUN}Good in ${MONTH_NAMES[v.month]}</button>
      <button type="button" data-act="moods" aria-expanded="${v.moodsOpen}" aria-pressed="${!!v.mood}">${v.mood ? esc(MOODS[v.mood].label) : "Moods"}<span aria-hidden="true">${v.moodsOpen ? "▴" : "▾"}</span></button>
      <button type="button" data-act="surprise">${DICE}Surprise me</button>
    </div>
    ${v.moodsOpen ? `<div class="moods-row" role="group" aria-label="Moods">${(Object.keys(MOODS) as Mood[])
      .map((m) => `<button type="button" class="chip" data-act="mood" data-mood="${m}" aria-pressed="${v.mood === m}">${esc(MOODS[m].label)}</button>`)
      .join("")}</div>` : ""}
    <p class="count-line">${countLine(v, lens)}</p>`}
    ${shown.length
      ? `<ol class="dest-list">${shown
          .map(
            (it) => `<li><a href="${esc(it.href)}" data-act="nav" data-id="${esc(it.id)}">
              ${it.img ? `<span class="arch sm"><img src="${esc(it.img)}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer" /></span>` : thumb(it.photo, it.title, it.guide)}
              <span class="dl-name"><b>${esc(it.title)}</b><small>${esc(it.note ?? it.state)}</small></span>
              <span class="dl-time"><b>${fmtMins(it.mins)}</b><small>${plural(it.trains, "train")}</small></span>
            </a></li>`,
          )
          .join("")}</ol>`
      : v.noneLeave ? "" : `<p class="empty">${v.mood || v.good ? "Oho, nothing like that within this ride. Try a longer ride, or another mood." : v.withGuides && v.places ? "Oho, none of these has a travel guide yet. Try “Every stop” below." : lens === "weekend" ? "No weekend trains from here, sadly. Try Overnight, or a longer ride." : "Oho, nothing this close. Try a longer ride."}</p>`}
    ${!v.showAll && v.items.length > shown.length ? `<button class="link-btn show-all" type="button" data-act="list-more">See all ${v.items.length.toLocaleString("en-IN")} →</button>` : ""}
    ${v.noneLeave ? "" : `<details class="fine"${tuned ? " open" : ""}>
      <summary>Fine-tune</summary>
      <div class="fine-body">
        <div class="filters" role="group" aria-label="Filters">
          ${select("kind", "Which trains", v.kind, KINDS)}
          ${select("leave", "When you leave", v.leave, LEAVES)}
          ${v.withGuides ? `<select class="sort" data-sort aria-label="Order"><option value="near"${v.famous ? "" : " selected"}>Nearest first</option><option value="famous"${v.famous ? " selected" : ""}>Most to see first</option></select>` : ""}
        </div>
        <div class="seg" role="group" aria-label="Show">
          <button type="button" data-act="list-guides" aria-pressed="${v.withGuides}">Places with guides</button>
          <button type="button" data-act="list-all" aria-pressed="${!v.withGuides}">Every stop</button>
        </div>
        ${v.kind !== "all" || v.within !== Infinity || v.leave !== "any" ? `<button class="link-btn" type="button" data-act="reset" style="justify-self:start">Clear it all, start fresh</button>` : ""}
      </div>
    </details>`}
  </div></div>`;
}
