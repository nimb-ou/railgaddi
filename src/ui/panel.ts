// The side panel (bottom sheet on phones): a place, or one train's stops. Pure templates:
// the controller (app/app.ts) owns state and handles the [data-act] clicks.
import { dayWord, daysLabel, fmtKm, fmtMins, fmtTime, plural, shiftDays } from "../core/format";
import type { Network, NewerTrain, Place, Train } from "../core/network";
import type { ArticleDetail, GuideView, Photo } from "../core/places";
import { titleOf } from "../core/slugs";
import { bySoonest, waitFor, type Leg } from "../core/trips";
import { aspect, coverWidth, credit, photoSrcset, photoUrl } from "./photos";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const FAST = new Set(["Raj", "Shtb", "Drnt", "JShtb", "GR", "SF"]);
const ICON = {
  close: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`,
  share: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5M4 11v5h12v-5"/></svg>`,
};
const wv = (t: string) => `https://en.wikivoyage.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`;

/** Days a train leaves this halt (its origin's running days, moved on by the days it's been travelling). */
export function daysAt(t: Train, halt: number) {
  return daysLabel(shiftDays(t.days, Math.floor(t.dep[halt] / 1440)));
}

export function scriptLine(p: Place) {
  return [p.hi, p.local].filter((s, i, a) => s && a.indexOf(s) === i).join("  ·  ");
}

/** A photo that fades in when loaded, sized for the slot it sits in. */
export function img(p: Photo, sizes: string, min: number, max: number, alt = "", eager = false) {
  return `<img src="${esc(photoUrl(p, min))}" srcset="${esc(photoSrcset(p, min, max))}" sizes="${sizes}" alt="${esc(alt)}"
    ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer" />`;
}

/** The cover is 420×200 beside the map, full width × 170 on phones; wide banners crop to fit. */
function coverSizes(p: Photo) {
  const phone = 170 * aspect(p) > 430 ? `${Math.ceil(170 * aspect(p))}px` : "100vw";
  return `(max-width: 720px) ${phone}, ${coverWidth(p, 420, 200)}px`;
}

export interface PlaceView {
  net: Network;
  place: Place;
  gv: GuideView | null;
  detail: { detail: ArticleDetail; photos: Map<string, Photo> } | "loading" | null;
  origin: Place | null;
  legs: Leg[]; // every train from the origin to this place
  passes: (l: Leg) => boolean;
  now: number; // minutes into the week, India time
  showAllTrains: boolean;
  activeSight: number;
  nearby: { title: string; href: string | null; photo: Photo | null }[];
  newer: NewerTrain[]; // trains between origin and here that we know of but have no times for
  /** Where you can come from, when no start is picked or the picked one has no direct train. */
  getHere: GetHere | null;
}

export interface GetHereItem {
  id: string;
  title: string;
  state: string;
  mins: number;
  trains: number;
  href: string;
  photo: Photo | null;
}

export interface GetHere {
  items: GetHereItem[];
  total: number;
  showAll: boolean;
  blockedFrom: string | null; // the picked start, when it has no direct train here
  choosing: boolean; // asked to change the start, though it has direct trains
}

function getHereHtml(g: GetHere, title: string) {
  const head = g.choosing ? "Where do you start?" : g.blockedFrom ? `No direct train from ${esc(g.blockedFrom)}` : `Get to ${esc(title)} by train`;
  const lede = g.total
    ? g.choosing
      ? `Direct trains come here from ${plural(g.total, "place")}.`
      : `${g.blockedFrom ? "But direct trains" : "Direct trains"} come from ${plural(g.total, "place")}. Where do you start?`
    : "No direct train comes here in our timetable.";
  return `<section class="get-here" aria-labelledby="gh-h">
    <div class="section-head"><h3 id="gh-h">${head}</h3></div>
    <p class="gh-lede">${lede}</p>
    ${g.total ? `<div class="gh-search">
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4.5 4.5" /></svg>
      <input id="gh-input" type="search" enterkeyhint="go" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Your city or station" aria-label="Where do you start?" />
      <ul class="suggest" id="gh-list" aria-label="Where you could start" hidden></ul>
    </div>
    <ol class="dest-list gh-list">${g.items
      .map(
        (it) => `<li><a href="${esc(it.href)}" data-act="from" data-id="${esc(it.id)}">
          ${it.photo ? img(it.photo, `${coverWidth(it.photo, 44, 44)}px`, 120, 500) : `<i class="stop-dot" aria-hidden="true"></i>`}
          <span class="dl-name"><b>${esc(it.title)}</b><small>${esc(it.state)}</small></span>
          <span class="dl-time"><b>${fmtMins(it.mins)}</b><small>${plural(it.trains, "train")}</small></span>
        </a></li>`,
      )
      .join("")}</ol>
    ${!g.showAll && g.total > g.items.length ? `<button class="link-btn show-all" type="button" data-act="gh-all">Show all ${g.total}</button>` : ""}` : ""}
    ${g.blockedFrom && !g.choosing ? `<button class="link-btn gh-here" type="button" data-act="from-here">Or start from ${esc(title)} and see where it goes</button>` : ""}
  </section>`;
}

export function placeHtml(v: PlaceView) {
  const { net, place, gv, origin } = v;
  // the place's own photo when it's big enough; a Wikivoyage banner is a very wide strip and a
  // squarer crop of it can lose the subject (Goa's becomes a patch of blue)
  const cover = gv?.icon && (gv.icon.w ?? 0) >= 800 ? gv.icon : gv?.banner ?? gv?.icon ?? null;
  const used: Photo[] = cover ? [cover] : [];
  const codes = place.stations.map((s) => net.stations[s].code);
  const title = titleOf(place, gv);
  const where = gv?.featured
    ? `${esc(place.state || "")} · nearest station <b>${esc(titleOf(place, null))}</b> (${esc(codes[0])})`
    : `${esc(place.state || "")}${place.state ? " · " : ""}${esc(codes.slice(0, 4).join(" · "))}${codes.length > 4 ? " …" : ""}`;
  const script = gv?.featured ? "" : scriptLine(place);

  // ---- the ride, on a ticket
  let ticket = "";
  const legs = bySoonest(v.legs, v.now);
  if (origin && legs.length) {
    const fastest = Math.min(...legs.map((l) => l.dur));
    const km = Math.min(...legs.map((l) => l.km));
    const next = legs.find(v.passes) ?? legs[0];
    const when = dayWord(v.now, waitFor(next, v.now));
    ticket = `<div class="ticket">
      <div class="ticket-route"><span>${esc(titleOf(origin, null))}</span><i>→</i><span>${esc(title)}</span>
        <button class="tk-change" type="button" data-act="change-from">Change start</button></div>
      <dl class="ticket-facts">
        <div><dt>Fastest</dt><dd>${fmtMins(fastest)}</dd></div>
        <div><dt>Trains</dt><dd>${legs.length}</dd></div>
        <div><dt>Distance</dt><dd>${fmtKm(km)} km</dd></div>
      </dl>
      <button class="ticket-next" type="button" data-act="leg" data-i="${legs.indexOf(next)}">
        <i class="dot"></i><span>Next train <b>${when === "today" ? "" : `${when} `}${fmtTime(next.dep)}</b> · ${esc(next.train.name)}</span><span class="go" aria-hidden="true">→</span>
      </button>
    </div>`;
  }

  // ---- what it's like, what to see
  let intro = "";
  let sights = "";
  if (!gv) {
    intro = `<p class="intro muted">No travel guide for this stop yet. Small stations are often the best surprises.</p>`;
  } else if (v.detail === "loading") {
    intro = `<div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div>`;
  } else if (v.detail) {
    const { detail, photos } = v.detail;
    if (detail.x) intro = `<p class="intro">${esc(detail.x)}</p>`;
    const withImg = detail.sights.map((s, i) => ({ s, i, ph: s.img ? photos.get(s.img) : undefined })).filter((x) => x.ph);
    const rest = detail.sights.filter((s) => !(s.img && photos.get(s.img)));
    const onMap = detail.sights.filter((s) => s.ll).length;
    if (withImg.length || rest.length) {
      sights = `<section aria-labelledby="sights-h">
        <div class="section-head"><h3 id="sights-h">Places to visit</h3>${onMap >= 2 ? `<button class="link-btn" type="button" data-act="sights-map">See on map</button>` : ""}</div>
        ${withImg.length ? `<div class="sight-grid">${withImg
          .map(({ s, i, ph }) => {
            used.push(ph!);
            return `<button class="sight ${i === v.activeSight ? "active" : ""}" type="button" data-act="sight" data-i="${i}" id="sight-${i}" aria-pressed="${i === v.activeSight}">
              <span class="frame">${img(ph!, `${coverWidth(ph!, 184, 138)}px`, 250, 1280, s.n)}</span>
              <b>${esc(s.n)}${s.k === "do" ? `<i class="kind">Do</i>` : ""}</b>
              ${s.d ? `<span>${esc(s.d)}</span>` : ""}
            </button>`;
          })
          .join("")}</div>` : ""}
        ${rest.length ? `<p class="more-sights">${withImg.length ? "Also: " : ""}${rest.slice(0, 6).map((s) => `<b>${esc(s.n)}</b>`).join(", ")}</p>` : ""}
      </section>`;
    }
  }

  // ---- trains
  let trains = "";
  if (origin && legs.length) {
    const multi = origin.stations.length > 1;
    const matching = legs.filter(v.passes);
    const shown = v.showAllTrains ? legs : (matching.length ? matching : legs).slice(0, 4);
    trains = `<section class="trains" aria-labelledby="trains-h">
      <div class="section-head"><h3 id="trains-h">Trains from ${esc(titleOf(origin, null))}</h3></div>
      <div class="tt-head" aria-hidden="true"><span>Dep</span><span>Train</span><span>Arr</span></div>
      ${shown
        .map((l) => {
          const t = l.train;
          const plusDay = Math.floor((l.dep + l.dur) / 1440);
          return `<button class="row ${v.passes(l) ? "" : "off"}" type="button" data-act="leg" data-i="${legs.indexOf(l)}">
            <span class="dep">${fmtTime(l.dep)}</span>
            <span><span class="tname">${esc(t.name)}</span>
              <span class="sub">${esc(t.no)}<span class="tag ${FAST.has(t.type) ? "fast" : ""}">${esc(t.typeLabel)}</span>${multi ? ` · from ${net.stations[t.st[l.from]].code}` : ""}${t.days ? ` · <span class="days">${daysAt(t, l.from)}</span>` : ""}</span></span>
            <span class="arr">${fmtTime(t.arr[l.to])}${plusDay ? `<sup>+${plusDay}</sup>` : ""}<small>${fmtMins(l.dur)}</small></span>
          </button>`;
        })
        .join("")}
      ${!v.showAllTrains && shown.length < legs.length ? `<button class="link-btn show-all" type="button" data-act="all-trains">Show all ${legs.length} trains</button>` : ""}
    </section>`;
  }
  if (origin && v.newer.length) {
    trains += `<section class="newer" aria-labelledby="newer-h">
      <div class="section-head"><h3 id="newer-h">Newer trains</h3></div>
      <ul>${v.newer
        .map((n) => {
          const facts = [daysLabel(n.days) || (n.perWeek ? (n.perWeek === 7 ? "Daily" : `${n.perWeek} days a week`) : ""), n.minutes ? fmtMins(n.minutes) : "", n.km ? `${fmtKm(n.km)} km` : ""].filter(Boolean);
          const page = n.src.startsWith("wikipedia:") ? `https://en.wikipedia.org/wiki/${encodeURIComponent(n.src.slice(10).replace(/ /g, "_"))}` : null;
          const name = page ? `<a href="${esc(page)}" target="_blank" rel="noopener">${esc(n.name)}</a>` : esc(n.name);
          return `<li><b>${name}</b><span>${esc(n.numbers)}${facts.length ? ` · ${facts.join(" · ")}` : ""}</span></li>`;
        })
        .join("")}</ul>
      <p>Introduced after our timetable was published, so their stops and times aren't on the map yet. Check <a href="https://enquiry.indianrail.gov.in/mntes/" target="_blank" rel="noopener">NTES</a> for times. Details from Wikipedia (CC BY-SA 4.0).</p>
    </section>`;
  }

  const nearby = v.nearby.length
    ? `<section aria-labelledby="near-h"><div class="section-head"><h3 id="near-h">Nearby</h3></div><div class="nearby">${v.nearby
        .map((n) => {
          const face = n.photo ? img(n.photo, "24px", 120, 120) : "<i></i>";
          return n.href
            ? `<a class="pill" href="${esc(n.href)}" data-act="nav">${face}${esc(n.title)}</a>`
            : `<a class="pill" href="${wv(n.title)}" target="_blank" rel="noopener">${face}${esc(n.title)} ↗</a>`;
        })
        .join("")}</div></section>`
    : "";

  const heading = `<div class="cover-text">
      <div class="board-plate">${script ? `<span class="script">${esc(script)}</span>` : ""}<h2 class="name" id="panel-title" tabindex="-1">${esc(title)}</h2></div>
      <p class="where">${where}</p>
    </div>`;
  const tools = `<div class="panel-tools">
      <button class="round" type="button" data-act="share" aria-label="Share ${esc(title)}">${ICON.share}</button>
      <button class="round" type="button" data-act="close" aria-label="Close">${ICON.close}</button>
    </div>`;
  const coverHtml = cover
    ? `<figure class="cover"><div class="shot">${img(cover, coverSizes(cover), 500, 1920, title, true)}</div>${tools}${heading}</figure>`
    : `<figure class="cover bare">${tools}${heading}</figure>`;

  return `<div class="panel-scroll">
    ${coverHtml}
    ${ticket}
    ${v.getHere ? getHereHtml(v.getHere, title) : ""}
    ${intro}
    ${sights}
    ${trains}
    ${nearby}
    ${creditsHtml(gv, used)}
  </div>`;
}

function creditsHtml(gv: GuideView | null, used: Photo[]) {
  if (!gv) return "";
  const uniq = [...new Set(used)];
  const wd = `<a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a>`;
  const text =
    gv.entry.src === "wd"
      ? `Landmarks near the station from ${wd} (CC0).`
      : `Text: <a href="${wv(gv.title)}" target="_blank" rel="noopener">Wikivoyage</a>, CC BY-SA 4.0. Landmarks: ${wd} (CC0).`;
  return `<footer class="credits-foot">
    ${text}
    ${uniq.length ? `<details><summary>Photo credits (${uniq.length})</summary><ul>${uniq
      .map((p) => `<li><a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(credit(p))}</a></li>`)
      .join("")}</ul></details>` : ""}
  </footer>`;
}

/** A prefilled GitHub issue: corrections come in as reviewable reports, like OpenStreetMap notes. */
function reportUrl(t: Train) {
  const q = new URLSearchParams({ template: "correction.yml", title: `Train ${t.no}: `, train: `${t.no} ${t.name}` });
  return `https://github.com/nimb-ou/railgaddi/issues/new?${q}`;
}

export function trainHtml(net: Network, leg: Leg, destTitle: string) {
  const t = leg.train;
  const items: string[] = [];
  let lastDay = 0;
  for (let j = 0; j < t.st.length; j++) {
    const a = t.arr[j];
    const d = t.dep[j];
    const day = Math.floor((d >= 0 ? d : a) / 1440) + 1;
    if (day !== lastDay) {
      if (lastDay) items.push(`<li class="dayrow"><span class="day">Day ${day}</span></li>`);
      lastDay = day;
    }
    const s = net.stations[t.st[j]];
    const ride = j >= leg.from && j <= leg.to;
    const end = j === leg.from || j === leg.to;
    const cls = [ride ? "ride" : "", j === leg.from ? "board-at" : "", j === leg.to ? "alight-at" : ""].join(" ");
    items.push(`<li class="${cls}" ${j === leg.from ? 'id="boarding"' : ""}>
      <span class="t">${a >= 0 ? fmtTime(a) : "—"}</span><span class="t">${d >= 0 ? fmtTime(d) : "—"}</span>
      <span class="rail" aria-hidden="true"></span>
      <span class="nm">${end ? `<span>${esc(s.name)}</span>` : esc(s.name)}<code>${esc(s.code)}</code></span></li>`);
  }
  const from = net.stations[t.st[leg.from]];
  const to = net.stations[t.st[leg.to]];
  return `<div class="panel-scroll">
    <div class="train-top">
      <button class="back" type="button" data-act="back">← ${esc(destTitle)}</button>
      <button class="round" type="button" data-act="close" aria-label="Close">${ICON.close}</button>
    </div>
    <header class="tr-head">
      <span class="no">${esc(t.no)}</span><span class="tag ${FAST.has(t.type) ? "fast" : ""}">${esc(t.typeLabel)}</span>
      <h2 id="panel-title" tabindex="-1">${esc(t.name)}</h2>
      <p>${esc(from.name)} <b>${fmtTime(t.dep[leg.from])}</b> → ${esc(to.name)} <b>${fmtTime(t.arr[leg.to])}</b> · ${fmtMins(leg.dur)} · ${fmtKm(leg.km)} km · ${plural(leg.halts, "halt")} on the way.</p>
      <p class="runs">${t.days ? `Leaves ${esc(from.name)}: <b>${daysAt(t, leg.from)}</b>` : "Running days not known"}</p>
      <p>Times are from ${esc(t.source)} and may have changed: check <a href="https://enquiry.indianrail.gov.in/mntes/" target="_blank" rel="noopener">NTES</a> before you travel.
      <a href="${esc(reportUrl(t))}" target="_blank" rel="noopener">Report a mistake</a></p>
    </header>
    <div>
      <div class="stop-head" aria-hidden="true"><span>Arr</span><span>Dep</span><span></span><span>Halt</span></div>
      <ol class="stops">${items.join("")}</ol>
    </div>
  </div>`;
}
