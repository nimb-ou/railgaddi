// The side panel (bottom sheet on phones): a place, or one train's stops.
import type { GuideView, Guides, Leg, Network, Photo, Place } from "./data";
import { fmtMins, shortName } from "./map";
import { credit, photoUrl } from "./photos";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pad = (n: number) => String(n).padStart(2, "0");
export const fmtTime = (m: number) => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad(Math.floor(((m % 60) + 60) % 60))}`;
export const fmtKm = (k: number) => Math.round(k).toLocaleString("en-IN");
const FAST = new Set(["Raj", "Shtb", "Drnt", "JShtb", "GR", "SF"]);
const CLOSE = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`;
const wv = (t: string) => `https://en.wikivoyage.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`;

export function scriptLine(p: Place) {
  return [p.hi, p.local].filter((s, i, a) => s && a.indexOf(s) === i).join("  ·  ");
}

export interface PlaceCtx {
  net: Network;
  guides: Guides | null;
  place: Place;
  gv: GuideView | null;
  origin: Place | null;
  legs: Leg[]; // every train from the origin to this place
  passes: (l: Leg) => boolean;
  now: number;
  showAllTrains: boolean;
  activeSight: number;
  titleToPlace: (title: string) => Place | null;
}

function img(p: Photo, w: number, alt = "", cls = "") {
  return `<img ${cls ? `class="${cls}"` : ""} src="${esc(photoUrl(p, w))}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" />`;
}

export function placeHtml(c: PlaceCtx) {
  const { net, place, gv, origin, guides } = c;
  const photos = guides?.photos ?? {};
  const cover = gv?.banner ?? gv?.icon ?? null;
  const used: Photo[] = [];
  if (cover) used.push(cover);
  const codes = place.stations.map((s) => net.stations[s].code);
  const title = gv?.featured ? gv.title : shortName(place);
  const where = gv?.featured
    ? `${esc(place.state || "")} · nearest station <b>${esc(shortName(place))}</b> (${esc(codes[0])})`
    : `${esc(place.state || "")}${place.state ? " · " : ""}${esc(codes.slice(0, 4).join(" · "))}${codes.length > 4 ? " …" : ""}`;
  const script = gv?.featured ? "" : scriptLine(place);

  // ---- getting there
  let travel = "";
  // soonest first, counting from now
  const legs = [...c.legs].sort((a, b) => ((a.dep - c.now + 1440) % 1440) - ((b.dep - c.now + 1440) % 1440));
  if (origin && legs.length) {
    const fastest = Math.min(...legs.map((l) => l.dur));
    const km = Math.min(...legs.map((l) => l.km));
    const upcoming = legs.filter(c.passes);
    const pool = upcoming.length ? upcoming : legs;
    const next = pool.reduce((b, l) => ((l.dep - c.now + 1440) % 1440 < (b.dep - c.now + 1440) % 1440 ? l : b), pool[0]);
    const nextIdx = legs.indexOf(next);
    travel = `<div class="facts">
        <div class="fact"><b>${fmtMins(fastest)}</b><span>fastest</span></div>
        <div class="fact"><b>${legs.length}</b><span>train${legs.length === 1 ? "" : "s"}</span></div>
        <div class="fact"><b>${fmtKm(km)} km</b><span>by rail</span></div>
      </div>
      <button class="next" type="button" data-act="leg" data-i="${nextIdx}">
        <i class="dot"></i><span>Next train <b>${fmtTime(next.dep)}</b> · ${esc(next.train.name)}</span>
      </button>`;
  }

  // ---- what to see
  let sights = "";
  if (gv) {
    const all = gv.art.sights ?? [];
    const withImg = all.map((s, i) => ({ s, i, ph: s.img ? photos[s.img] : undefined })).filter((x) => x.ph);
    const rest = all.filter((s) => !(s.img && photos[s.img]));
    const onMap = all.filter((s) => s.ll).length;
    if (withImg.length) {
      sights = `<section>
        <div class="section-head"><h3>Places to visit</h3>${onMap >= 2 ? `<button class="link-btn" type="button" data-act="sights-map">See on map</button>` : ""}</div>
        <div class="sight-grid">${withImg
          .map(({ s, i, ph }) => {
            used.push(ph!);
            return `<button class="sight ${i === c.activeSight ? "active" : ""}" type="button" data-act="sight" data-i="${i}" id="sight-${i}">
              ${img(ph!, 330, s.n)}
              <b>${esc(s.n)}${s.k === "do" ? `<i class="kind">Do</i>` : ""}</b>
              ${s.d ? `<span>${esc(s.d)}</span>` : ""}
            </button>`;
          })
          .join("")}</div>
        ${rest.length ? `<p class="more-sights">Also: ${rest.slice(0, 6).map((s) => `<b>${esc(s.n)}</b>`).join(", ")}</p>` : ""}
      </section>`;
    } else if (rest.length) {
      sights = `<section><div class="section-head"><h3>Places to visit</h3></div>
        <p class="more-sights">${rest.slice(0, 8).map((s) => `<b>${esc(s.n)}</b>${s.d ? `: ${esc(s.d)}` : ""}`).join("<br/>")}</p></section>`;
    }
  }

  let nearby = "";
  if (gv?.nearby.length) {
    nearby = `<section><div class="section-head"><h3>Nearby</h3></div><div class="nearby">${gv.nearby
      .map((t) => {
        const a = guides?.articles[t];
        const ph = a?.icon ? photos[a.icon] : undefined;
        const inApp = c.titleToPlace(t);
        const face = ph ? img(ph, 120) : "<i></i>";
        return inApp
          ? `<button class="pill" type="button" data-act="place" data-id="${esc(inApp.id)}">${face}${esc(t)}</button>`
          : `<a class="pill" href="${wv(t)}" target="_blank" rel="noopener">${face}${esc(t)} ↗</a>`;
      })
      .join("")}</div></section>`;
  }

  // ---- trains
  let trains = "";
  if (origin && legs.length) {
    const multi = origin.stations.length > 1;
    const shown = c.showAllTrains ? legs : (legs.filter(c.passes).length ? legs.filter(c.passes) : legs).slice(0, 4);
    trains = `<section class="trains">
      <div class="section-head"><h3>Trains from ${esc(shortName(origin))}</h3></div>
      ${shown
        .map((l) => {
          const t = l.train;
          const plusDay = Math.floor((l.dep + l.dur) / 1440);
          const from = net.stations[t.st[l.from]].code;
          return `<button class="row ${c.passes(l) ? "" : "off"}" type="button" data-act="leg" data-i="${legs.indexOf(l)}">
            <span class="dep">${fmtTime(l.dep)}</span>
            <span><span class="tname">${esc(t.name)}</span>
              <span class="sub">${esc(t.no)}<span class="tag ${FAST.has(t.type) ? "fast" : ""}">${esc(t.typeLabel)}</span>${multi ? ` · from ${from}` : ""}</span></span>
            <span class="arr">${fmtTime(t.arr[l.to])}${plusDay ? `<sup>+${plusDay}</sup>` : ""}<small>${fmtMins(l.dur)}</small></span>
          </button>`;
        })
        .join("")}
      ${!c.showAllTrains && shown.length < legs.length ? `<button class="link-btn show-all" type="button" data-act="all-trains">Show all ${legs.length} trains</button>` : ""}
    </section>`;
  } else if (origin) {
    trains = `<div class="cta"><p>No train goes from ${esc(shortName(origin))} to ${esc(title)} without a change.</p>
      <button type="button" data-act="from-here">Start from ${esc(title)} instead</button></div>`;
  } else {
    trains = `<div class="cta"><p>Where would you start from? Pick your station to see every train that goes here.</p>
      <button type="button" data-act="pick-origin">Choose a starting point</button></div>`;
  }

  const coverHtml = cover
    ? `<figure class="cover"><div class="shot">${img(cover, 960, title)}</div>${closeBtn()}${coverText(script, title, where)}</figure>`
    : `<figure class="cover bare">${closeBtn()}${coverText(script, title, where)}</figure>`;

  return `<div class="panel-scroll">
    ${coverHtml}
    ${travel}
    ${gv?.art.x ? `<p class="intro">${esc(gv.art.x)}</p>` : !gv ? `<p class="intro">No travel guide for this stop yet. Small stations are often the best surprises.</p>` : ""}
    ${sights}
    ${trains}
    ${nearby}
    ${creditsHtml(gv, used)}
  </div>`;
}

const closeBtn = () => `<button class="close" type="button" data-act="close" aria-label="Close">${CLOSE}</button>`;
const coverText = (script: string, title: string, where: string) => `<div class="cover-text">
  ${script ? `<p class="script">${esc(script)}</p>` : ""}
  <h2>${esc(title)}</h2>
  <p class="where">${where}</p>
</div>`;

function creditsHtml(gv: GuideView | null, used: Photo[]) {
  if (!gv) return "";
  const uniq = [...new Set(used)];
  const wd = `<a href="https://www.wikidata.org/" target="_blank" rel="noopener">Wikidata</a>`;
  const text =
    gv.art.src === "wd"
      ? `Landmarks near the station from ${wd} (CC0).`
      : `Text: <a href="${wv(gv.title)}" target="_blank" rel="noopener">Wikivoyage</a>, CC BY-SA 4.0${gv.art.sights.some((s) => s.q) ? `. More landmarks from ${wd} (CC0)` : ""}.`;
  return `<footer class="credits-foot">
    ${text}
    ${uniq.length ? `<details><summary>Photo credits (${uniq.length})</summary><ul>${uniq
      .map((p) => `<li><a href="${esc(p.page ?? "#")}" target="_blank" rel="noopener">${esc(credit(p))}</a></li>`)
      .join("")}</ul></details>` : ""}
  </footer>`;
}

export function trainHtml(net: Network, leg: Leg, destTitle: string) {
  const t = leg.train;
  const items: string[] = [];
  let lastDay = 0;
  for (let j = 0; j < t.st.length; j++) {
    const a = t.arr[j], d = t.dep[j];
    if (a < 0 && d < 0) continue;
    const day = Math.floor((d >= 0 ? d : a) / 1440) + 1;
    if (day !== lastDay) {
      if (lastDay) items.push(`<li class="dayrow"><span class="day">Day ${day}</span></li>`);
      lastDay = day;
    }
    const s = net.stations[t.st[j]];
    const cls = [j >= leg.from && j <= leg.to ? "ride" : "", j === leg.from ? "board-at" : "", j === leg.to ? "alight-at" : ""].join(" ");
    items.push(`<li class="${cls}" ${j === leg.from ? 'id="boarding"' : ""}>
      <span class="t">${a >= 0 ? fmtTime(a) : "—"}</span><span class="t">${d >= 0 ? fmtTime(d) : "—"}</span>
      <span class="rail" aria-hidden="true"></span>
      <span class="nm">${esc(s.name)}<code>${esc(s.code)}</code></span></li>`);
  }
  const from = net.stations[t.st[leg.from]];
  const to = net.stations[t.st[leg.to]];
  return `<div class="panel-scroll">
    <button class="back" type="button" data-act="back">← ${esc(destTitle)}</button>
    <header class="tr-head">
      <span class="no">${esc(t.no)}</span><span class="tag ${FAST.has(t.type) ? "fast" : ""}">${esc(t.typeLabel)}</span>
      <h2>${esc(t.name)}</h2>
      <p>${esc(from.name)} <b>${fmtTime(t.dep[leg.from])}</b> → ${esc(to.name)} <b>${fmtTime(t.arr[leg.to])}</b> · ${fmtMins(leg.dur)} · ${fmtKm(leg.km)} km.
      Running days aren't in this 2017 timetable, so check <a href="https://enquiry.indianrail.gov.in/mntes/" target="_blank" rel="noopener">NTES</a> before you plan.</p>
    </header>
    <div>
      <div class="stop-head" aria-hidden="true"><span>Arr</span><span>Dep</span><span></span><span>Halt</span></div>
      <ol class="stops">${items.join("")}</ol>
    </div>
  </div>`;
}

export const destTitleOf = (dest: Place, gv: GuideView | null) => (gv?.featured ? gv.title : shortName(dest));
