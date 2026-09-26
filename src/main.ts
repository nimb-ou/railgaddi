import type { Topology } from "topojson-specification";
import {
  departures,
  guideFor,
  legPasses,
  loadGuides,
  loadNetwork,
  searchPlaces,
  type Destination,
  type Filters,
  type Guides,
  type Leg,
  type Network,
  type Place,
  type Train,
} from "./data";
import { RailMap, shortName } from "./map";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (m: number) => `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad(Math.floor(m % 60))}`;
const fmtDur = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`);
const fmtKm = (k: number) => `${Math.round(k).toLocaleString("en-IN")}`;
const FAST = new Set(["Raj", "Shtb", "Drnt", "JShtb", "GR", "SF"]);

function istNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

// ---------- state ----------
let net: Network;
let guides: Guides | null = null;
let map: RailMap;
let origin: Place | null = null;
let dests = new Map<Place, Destination>();
let passing = new Map<Place, Leg[]>();
let openPlace: Place | null = null;
const filters: Filters = { leave: "any", within: Infinity };

const originEl = $("origin");
const input = $<HTMLInputElement>("origin-input");
const suggest = $<HTMLUListElement>("suggest");
const panel = $("panel");
const tip = $("tip");
const pin = $("origin-pin");

// ---------- boot ----------
async function boot() {
  const [n, india, states] = await Promise.all([
    loadNetwork("data/network.json"),
    fetch("data/india.json").then((r) => r.json() as Promise<Topology>),
    fetch("data/state-lines.json").then((r) => r.json() as Promise<Topology>),
  ]);
  net = n;
  map = new RailMap($<HTMLCanvasElement>("map"), net, india, states, hasGuide, {
    onPick: openDestination,
    onHover: showTip,
  });
  map.simMinute = istNow();
  if (import.meta.env.DEV) Object.assign(window, { __map: map, __net: net });
  let shown = -1;
  map.onClock = (m) => {
    const whole = Math.floor(m);
    if (whole !== shown) {
      shown = whole;
      $("clock-time").textContent = fmtTime(whole);
    }
  };
  $("loading").classList.add("done");
  setupBoard();
  setupFilters();
  setupClock();
  requestAnimationFrame(trackPin);

  loadGuides("data/places.json").then((g) => {
    guides = g;
    if (origin) refresh(false);
    if (openPlace) openDestination(openPlace);
  });

  const fromHash = () => net.places.get(decodeURIComponent(location.hash.slice(1)));
  const start = fromHash();
  if (start) chooseOrigin(start);
  else input.focus({ preventScroll: true });
  window.addEventListener("hashchange", () => {
    const p = fromHash();
    if (p && p !== origin) chooseOrigin(p);
  });
}

function hasGuide(p: Place) {
  const g = guideFor(guides, net, p);
  return !!g && !!g.title;
}

// ---------- the station board ----------
const QUICK = ["bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad", "goa", "varanasi"];
let active = -1;
let results: Place[] = [];

function setupBoard() {
  const quick = $("quick");
  quick.innerHTML = QUICK.map((id) => net.places.get(id))
    .filter((p): p is Place => !!p)
    .map((p) => `<button type="button" data-id="${p.id}">${esc(p.name)}</button>`)
    .join("");
  quick.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    const p = b && net.places.get(b.dataset.id!);
    if (p) chooseOrigin(p);
  });

  input.addEventListener("input", () => {
    results = searchPlaces(net, input.value);
    active = results.length ? 0 : -1;
    renderSuggest();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      renderSuggest();
    } else if (e.key === "Enter") {
      const p = results[Math.max(active, 0)];
      if (p) chooseOrigin(p);
    } else if (e.key === "Escape") {
      closeSuggest();
      if (origin) dockBoard(origin);
    }
  });
  input.addEventListener("blur", () => setTimeout(() => {
    closeSuggest();
    if (origin && originEl.dataset.editing) dockBoard(origin);
  }, 150));
  suggest.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest("li");
    if (!li) return;
    e.preventDefault();
    const p = results[Number(li.dataset.i)];
    if (p) chooseOrigin(p);
  });
  $("board-change").addEventListener("click", () => {
    originEl.dataset.editing = "1";
    for (const id of ["board-name", "board-codes", "board-change"]) $(id).hidden = true;
    $("board-script").textContent = "कहाँ से चलें?";
    $("board-script").hidden = false;
    input.parentElement!.hidden = false;
    input.value = "";
    input.focus();
  });
}

function renderSuggest() {
  if (!results.length) {
    suggest.innerHTML = input.value.trim() ? `<li aria-disabled="true"><span class="s-meta">No station or city by that name in this timetable</span></li>` : "";
    suggest.hidden = !input.value.trim();
    input.setAttribute("aria-expanded", String(!suggest.hidden));
    return;
  }
  suggest.innerHTML = results
    .map((p, i) => {
      const codes = p.stations.map((s) => net.stations[s].code);
      const meta = p.isCity
        ? `${p.state} · ${codes.length} stations · ${codes.slice(0, 4).join(" ")}${codes.length > 4 ? " …" : ""}`
        : `${p.state} · ${codes[0]}`;
      const script = p.hi || p.local;
      return `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === active}">
        <span class="s-name">${esc(p.name)}</span><span class="s-script">${esc(script)}</span>
        <span class="s-meta">${esc(meta)}</span></li>`;
    })
    .join("");
  suggest.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-activedescendant", active >= 0 ? `opt-${active}` : "");
}

function closeSuggest() {
  suggest.hidden = true;
  input.setAttribute("aria-expanded", "false");
}

function scriptLine(p: Place) {
  return [p.hi, p.local].filter((s, i, a) => s && a.indexOf(s) === i).join("  ·  ");
}

function dockBoard(p: Place) {
  delete originEl.dataset.editing;
  originEl.dataset.state = "docked";
  const script = scriptLine(p);
  $("board-script").textContent = script;
  $("board-script").hidden = !script;
  $("board-name").textContent = shortName(p);
  $("board-name").hidden = false;
  const codes = p.stations.map((s) => net.stations[s].code);
  $("board-codes").textContent = codes.join(" · ");
  $("board-codes").hidden = false;
  $("board-change").hidden = false;
  input.parentElement!.hidden = true;
  input.blur();
}

function chooseOrigin(p: Place) {
  closeSuggest();
  closePanel();
  origin = p;
  input.value = "";
  results = [];
  dockBoard(p);
  $("controls").hidden = false;
  dests = departures(net, p).dests;
  refresh(true);
  pin.hidden = true;
  requestAnimationFrame(() => {
    pin.hidden = false; // restarts the drop animation
  });
  map.flyToOrigin();
  history.replaceState(null, "", `#${encodeURIComponent(p.id)}`);
  document.title = `From ${p.name} · Patri`;
}

// ---------- filters ----------
function setupFilters() {
  for (const id of ["leave", "within"] as const) {
    $(id).addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      for (const x of $(id).querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      if (id === "leave") filters.leave = b.dataset.v as Filters["leave"];
      else filters.within = Number(b.dataset.v);
      refresh(false);
      map.fitRoutes();
    });
  }
  const legend = $("leave").querySelector("legend")!;
  const tick = () => (legend.innerHTML = `Leaving <span class="now">· now ${fmtTime(istNow())} IST</span>`);
  tick();
  setInterval(tick, 20_000);
}

function refresh(animate: boolean) {
  if (!origin) return;
  const now = istNow();
  const act = new Map<Train, { from: number; to: number; legs: Leg[] }>();
  passing = new Map();
  for (const d of dests.values()) {
    for (const l of d.legs) {
      if (!legPasses(l, filters, now)) continue;
      let a = act.get(l.train);
      if (!a) act.set(l.train, (a = { from: l.from, to: l.to, legs: [] }));
      a.to = Math.max(a.to, l.to);
      a.legs.push(l);
      (passing.get(d.place) ?? passing.set(d.place, []).get(d.place)!).push(l);
    }
  }
  map.setOrigin(origin, [...dests.values()], act, animate);
  const nPlaces = passing.size;
  $("stats").innerHTML = dests.size
    ? act.size
      ? `<b>${act.size}</b> trains · <b>${nPlaces.toLocaleString("en-IN")}</b> places without changing trains`
      : `No trains match. Try a wider time window.`
    : `No trains leave from here in the 2017 timetable.`;
  if (openPlace && panel.dataset.view === "dest") openDestination(openPlace);
}

// ---------- clock ----------
function setupClock() {
  const btn = $("clock-toggle");
  const icon = $("clock-icon");
  const setPlaying = (on: boolean) => {
    map.playing = on;
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Pause the timetable clock" : "Play the timetable clock");
    icon.setAttribute("d", on ? "M4 3h3v10H4zM9 3h3v10H9z" : "M5 3l8 5-8 5z");
  };
  btn.addEventListener("click", () => setPlaying(!map.playing));
  setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function trackPin() {
  if (origin && !pin.hidden) {
    const p = map.screenOf(origin);
    if (p) pin.style.transform = `translate(${p[0] - 32}px, ${p[1] - 27}px)`;
  }
  requestAnimationFrame(trackPin);
}

// ---------- hover ----------
function showTip(p: Place | null, x: number, y: number) {
  if (!p) {
    tip.hidden = true;
    return;
  }
  const legs = passing.get(p) ?? [];
  const fastest = Math.min(...legs.map((l) => l.dur));
  const km = Math.min(...legs.map((l) => l.km));
  tip.innerHTML = `<b>${esc(shortName(p))}</b><span>${legs.length} train${legs.length === 1 ? "" : "s"} · fastest ${fmtDur(fastest)} · ≈${fmtKm(km)} km</span>`;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const tx = Math.min(x + 14, window.innerWidth - r.width - 8);
  const ty = y + 16 + r.height > window.innerHeight ? y - r.height - 10 : y + 16;
  tip.style.left = `${tx}px`;
  tip.style.top = `${ty}px`;
}

// ---------- panel ----------
function setPanelOpen(open: boolean) {
  panel.hidden = !open;
  document.body.classList.toggle("panel-open", open);
  const narrow = window.innerWidth <= 720;
  map.setInsetRight(open ? (narrow ? window.innerHeight * 0.64 : 440) : 0);
}

function closePanel() {
  openPlace = null;
  setPanelOpen(false);
  if (map) {
    map.select(null);
    map.selectTrain(null);
  }
}

function destBoard(p: Place, km: number | null, withClose = true) {
  const code = net.stations[p.anchor].code;
  const script = scriptLine(p);
  return `<div class="dest-board ${withClose ? "has-close" : ""}">
    <div>
      ${script ? `<div class="script">${esc(script)}</div>` : ""}
      <div class="name">${esc(shortName(p))}</div>
      <div class="codes">${esc(p.stations.map((s) => net.stations[s].code).join(" · "))} · ${esc(p.state)}</div>
    </div>
    ${km !== null ? `<div class="kmstone" aria-label="About ${fmtKm(km)} kilometres by rail"><div class="cap">${esc(code)}</div><div class="num">${fmtKm(km)}<small>KM</small></div></div>` : ""}
    ${withClose ? `<button class="close" type="button" data-act="close" aria-label="Close">×</button>` : ""}
  </div>`;
}

function guideHtml(p: Place) {
  const g = guideFor(guides, net, p);
  if (!guides) return `<p class="noguide">Loading the travel guide…</p>`;
  if (!g) return `<p class="noguide">No travel guide for this stop yet. Small stations are often the best surprises.</p>`;
  const wv = (t: string) => `https://en.wikivoyage.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`;
  const a = g.art;
  const list = (items: { n: string; d?: string }[] | undefined, title: string) =>
    items && items.length
      ? `<div><h3>${title}</h3><ul>${items.slice(0, 5).map((it) => `<li><b>${esc(it.n)}</b>${it.d ? ` <span>${esc(it.d)}</span>` : ""}</li>`).join("")}</ul></div>`
      : "";
  const img = a.img
    ? `<figure><img src="https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(a.img)}?width=720" alt="" loading="lazy" onerror="this.parentElement.remove()" />
       <figcaption>Photo: <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(a.img)}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption></figure>`
    : "";
  const nearby = g.nearby.length
    ? `<div class="nearby"><h3>Nearby</h3>${g.nearby.map((t) => `<a href="${wv(t)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join("")}</div>`
    : "";
  return `<section class="guide">
    ${img}
    ${a.x ? `<p>${esc(a.x)}</p>` : ""}
    ${list(a.see, "See")}
    ${list(a.do, "Do")}
    ${nearby}
    ${g.title ? `<p class="src">From <a href="${wv(g.title)}" target="_blank" rel="noopener">Wikivoyage: ${esc(g.title)}</a> · CC BY-SA 4.0</p>` : ""}
  </section>`;
}

function openDestination(p: Place) {
  if (!origin) return;
  const d = dests.get(p);
  if (!d) return;
  openPlace = p;
  map.select(p);
  map.selectTrain(null);
  const now = istNow();
  const legs = [...d.legs].sort((a, b) => a.dep - b.dep);
  const ok = legs.filter((l) => legPasses(l, filters, now));
  const fastest = Math.min(...legs.map((l) => l.dur));
  const next = legs.reduce((best, l) => ((l.dep - now + 1440) % 1440 < (best.dep - now + 1440) % 1440 ? l : best), legs[0]);
  const multi = origin.stations.length > 1;
  const rows = legs
    .map((l, i) => {
      const t = l.train;
      const on = legPasses(l, filters, now);
      const arr = t.arr[l.to];
      const plusDay = Math.floor((l.dep + l.dur) / 1440);
      const from = net.stations[t.st[l.from]].code;
      const to = net.stations[t.st[l.to]].code;
      return `<button class="row ${on ? "" : "off"}" type="button" data-leg="${i}">
        <span class="dep">${fmtTime(l.dep)}</span>
        <span><span class="no">${esc(t.no)}</span><span class="pill ${FAST.has(t.type) ? "fast" : ""}">${esc(t.typeLabel)}</span>
          <span class="tname">${esc(t.name)}</span>
          <span class="sub">${multi ? `${from} → ${to} · ` : ""}${l.halts ? `${l.halts} halt${l.halts === 1 ? "" : "s"}` : "non-stop"} · ≈${fmtKm(l.km)} km</span></span>
        <span class="arr">${fmtTime(arr)}${plusDay ? `<sup>+${plusDay}</sup>` : ""}<small>${fmtDur(l.dur)}</small></span>
      </button>`;
    })
    .join("");
  panel.dataset.view = "dest";
  panel.innerHTML = `<div class="panel-scroll">
    ${destBoard(p, d.firstKm)}
    <dl class="facts">
      <div><dt>Trains</dt><dd>${legs.length}</dd></div>
      <div><dt>Fastest</dt><dd>${fmtDur(fastest)}</dd></div>
      <div><dt>Next train</dt><dd>${fmtTime(next.dep)}</dd></div>
    </dl>
    ${guideHtml(p)}
    <section class="trains">
      <h3>Trains from ${esc(shortName(origin))}</h3>
      <p class="note">${ok.length === legs.length ? "Departure → arrival, by the timetable." : `${ok.length} of ${legs.length} match your filters; the rest are dimmed.`}</p>
      ${rows}
    </section>
  </div>`;
  panel.onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-leg]");
    if (!el) return;
    if (el.dataset.act === "close") closePanel();
    else if (el.dataset.leg) openTrain(legs[Number(el.dataset.leg)], p);
  };
  setPanelOpen(true);
  map.focusOn(p);
}

function openTrain(leg: Leg, dest: Place) {
  const t = leg.train;
  map.selectTrain(leg);
  const items: string[] = [];
  let lastDay = 0;
  let firstDay = true;
  for (let j = 0; j < t.st.length; j++) {
    const a = t.arr[j], d = t.dep[j];
    if (a < 0 && d < 0) continue;
    const day = Math.floor((d >= 0 ? d : a) / 1440) + 1;
    if (day !== lastDay) {
      if (!firstDay || day > 1) items.push(`<li class="dayrow"><span class="day">Day ${day}</span></li>`);
      lastDay = day;
      firstDay = false;
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
  panel.dataset.view = "train";
  panel.innerHTML = `<div class="panel-scroll">
    <button class="back" type="button" data-act="back">← All trains to ${esc(shortName(dest))}</button>
    <header class="tr-head">
      <span class="no">${esc(t.no)}</span><span class="pill ${FAST.has(t.type) ? "fast" : ""}">${esc(t.typeLabel)}</span>
      <h2>${esc(t.name)}</h2>
      <p>${esc(from.name)} ${fmtTime(t.dep[leg.from])} → ${esc(to.name)} ${fmtTime(t.arr[leg.to])} · ${fmtDur(leg.dur)} · ≈${fmtKm(leg.km)} km.
      Running days aren't in this 2017 timetable, so check <a href="https://enquiry.indianrail.gov.in/mntes/" target="_blank" rel="noopener">NTES</a> before you plan.</p>
    </header>
    <div class="stops-wrap">
      <div class="stop-head" aria-hidden="true"><span>Arr</span><span>Dep</span><span></span><span>Halt</span></div>
      <ol class="stops">${items.join("")}</ol>
    </div>
  </div>`;
  panel.onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (el?.dataset.act === "back") openDestination(dest);
  };
  panel.querySelector("#boarding")?.scrollIntoView({ block: "center" });
}

boot().catch((err) => {
  console.error(err);
  $("loading").textContent = "Couldn't load the timetable. Reload the page to try again.";
});
