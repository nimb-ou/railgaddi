import type { Topology } from "topojson-specification";
import {
  buildGuideIndex,
  departures,
  legPasses,
  loadGuides,
  loadNetwork,
  searchPlaces,
  type Destination,
  type Filters,
  type GuideView,
  type Guides,
  type Leg,
  type Network,
  type Place,
  type Train,
} from "./data";
import { RailMap, fmtMins, shortName, type ActiveTrain, type BubbleCandidate, type Reach, type SightPin } from "./map";
import { destTitleOf, esc, fmtTime, placeHtml, scriptLine, trainHtml } from "./panel";
import { photoUrl } from "./photos";
import { THEMES, applyTheme, savedTheme } from "./theme";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function istNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

// "Reach within" slider stops, in minutes
const STEPS = [60, 120, 180, 240, 360, 480, 720, 1080, 1440, Infinity];
const TICKS: [number, string][] = [[0, "1h"], [2, "3h"], [4, "6h"], [6, "12h"], [8, "24h"], [9, "Any"]];
const POPULAR = ["bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad"];
// Destinations people cross the country for, most famous first. On the landing page they
// get first claim on a photo bubble, in this order.
const ICONIC = [
  "Agra", "Varanasi", "Jaipur", "Goa", "Udaipur", "Mumbai", "Delhi", "Hampi", "Kochi", "Darjeeling",
  "Amritsar", "Mysore", "Jaisalmer", "Rishikesh", "Kolkata", "Puri", "Madurai", "Khajuraho", "Jodhpur", "Alappuzha",
  "Ooty", "Shimla", "Pondicherry", "Kanyakumari", "Rameswaram", "Haridwar", "Aurangabad", "Bodh Gaya", "Mahabalipuram",
  "Thanjavur", "Gokarna", "Varkala", "Konark", "Pushkar", "Bikaner", "Mount Abu", "Orchha", "Gwalior", "Hyderabad",
  "Chennai", "Guwahati", "Ujjain", "Sanchi", "Dwarka", "Somnath", "Tirupati", "Ajmer", "Matheran", "Bangalore",
];
const iconicRank = new Map(ICONIC.map((t, i) => [t, ICONIC.length - i]));

// ---------------------------------------------------------------- state
let net: Network;
let guides: Guides | null = null;
let gindex = new Map<Place, GuideView>();
const titlePlace = new Map<string, Place>();
let map: RailMap;
let origin: Place | null = null;
let dests = new Map<Place, Destination>();
let passing = new Map<Place, Leg[]>();
let open: { place: Place; showAll: boolean; sight: number; leg: Leg | null } | null = null;
const filters: Filters = { leave: "any", within: Infinity };

const hero = $("hero");
const input = $<HTMLInputElement>("origin-input");
const suggest = $<HTMLUListElement>("suggest");
const panel = $("panel");
const tip = $("tip");
const pin = $("origin-pin");
const dock = $("dock");
const chip = $("origin-chip");
const narrow = () => window.innerWidth <= 720;

// ---------------------------------------------------------------- boot
async function boot() {
  applyTheme(savedTheme());
  const [n, india, states] = await Promise.all([
    loadNetwork("data/network.json"),
    fetch("data/india.json").then((r) => r.json() as Promise<Topology>),
    fetch("data/state-lines.json").then((r) => r.json() as Promise<Topology>),
  ]);
  net = n;
  map = new RailMap($<HTMLCanvasElement>("map"), net, india, states, {
    onPick: (p) => openPlace(p),
    onPickSight: (i) => {
      if (!open) return;
      open.sight = i;
      renderPanel();
      showSights(open.place, i, false);
      document.getElementById(`sight-${i}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    onHover: showTip,
    onBackground: () => {
      if (open) closePanel();
    },
  });
  if (import.meta.env.DEV) Object.assign(window, { __map: map, __net: net });
  map.simMinute = istNow();
  let shown = -1;
  map.onClock = (m) => {
    if (Math.floor(m) !== shown) {
      shown = Math.floor(m);
      $("clock-time").textContent = fmtTime(shown);
    }
  };

  setupTopbar();
  setupSearch();
  setupDock();
  setupClock();
  layout();
  map.fitIndia(0);
  window.addEventListener("resize", () => {
    layout();
    if (!origin && !open) map.fitIndia(0);
  });
  requestAnimationFrame(trackPin);
  $("loading").classList.add("done");

  loadGuides("data/places.json").then((g) => {
    guides = g;
    if (g) {
      gindex = buildGuideIndex(g, net);
      for (const [p, gv] of gindex) if (!titlePlace.has(gv.title) || p.isCity) titlePlace.set(gv.title, p);
    }
    renderPopular();
    updateCandidates();
    if (open) renderPanel();
  });

  const fromHash = () => net.places.get(decodeURIComponent(location.hash.slice(1)));
  const start = fromHash();
  if (start) chooseOrigin(start);
  else if (!narrow()) input.focus({ preventScroll: true });
  window.addEventListener("hashchange", () => {
    const p = fromHash();
    if (p && p !== origin) chooseOrigin(p);
  });
}

// ---------------------------------------------------------------- layout: what the map must keep clear of
function layout() {
  const vis = (el: HTMLElement) => !el.hidden && !el.classList.contains("leaving");
  const rects: DOMRect[] = [];
  const docked = !document.body.classList.contains("panel-open");
  for (const el of [hero, chip, docked ? dock : null, panel, document.querySelector<HTMLElement>(".topbar")!, $("clock")]) {
    if (!el) continue;
    if (vis(el)) rects.push(el.getBoundingClientRect());
  }
  map.setSafeRects(rects.filter((r) => r.width && r.height));
  const panelOpen = !panel.hidden;
  if (narrow()) {
    const top = !origin ? hero.getBoundingClientRect().bottom + 4 : chip.getBoundingClientRect().bottom + 8;
    const bottom = panelOpen ? window.innerHeight * 0.74 : origin ? dock.getBoundingClientRect().height + 24 : 16;
    map.setInsets({ top, right: 8, bottom, left: 8 });
  } else {
    const left = !origin ? hero.getBoundingClientRect().right + 24 : 24;
    const bottom = origin && !panelOpen ? dock.getBoundingClientRect().height + 36 : 40;
    map.setInsets({ top: origin ? 80 : 60, right: panelOpen ? 460 : 40, bottom, left });
  }
}

// ---------------------------------------------------------------- top bar
function setupTopbar() {
  const themes = $("themes");
  themes.innerHTML = THEMES.map(
    (t) => `<button type="button" role="radio" data-id="${t.id}" aria-label="${t.name} colours" title="${t.name}" style="--sw:${t.swatch}"></button>`,
  ).join("");
  const mark = () => {
    for (const b of themes.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.id === document.documentElement.dataset.theme));
  };
  mark();
  themes.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    applyTheme(b.dataset.id as (typeof THEMES)[number]["id"]);
    mark();
    map.readTheme();
    paintTrack();
  });
  const info = $("info");
  const btn = $("info-btn");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    info.hidden = !info.hidden;
    btn.setAttribute("aria-expanded", String(!info.hidden));
  });
  document.addEventListener("click", (e) => {
    if (!info.hidden && !info.contains(e.target as Node) && e.target !== btn) {
      info.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });
  $("brand").addEventListener("click", (e) => {
    e.preventDefault();
    backToStart();
  });
  $("chip-change").addEventListener("click", () => backToStart(true));
}

// ---------------------------------------------------------------- search
let active = -1;
let results: Place[] = [];

function faceOf(p: Place, w = 120) {
  const ph = gindex.get(p)?.icon;
  return ph ? `<img class="s-img" src="${esc(photoUrl(ph, w))}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<i class="s-img"></i>`;
}

function renderPopular() {
  const box = $("popular");
  box.innerHTML =
    `<span>Popular</span>` +
    POPULAR.map((id) => net.places.get(id))
      .filter((p): p is Place => !!p)
      .map((p) => `<button class="pill" type="button" data-id="${p.id}">${faceOf(p).replace('class="s-img"', "")}${esc(p.name)}</button>`)
      .join("");
}

function setupSearch() {
  renderPopular();
  $("popular").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    const p = b && net.places.get(b.dataset.id!);
    if (p) chooseOrigin(p);
  });
  input.addEventListener("input", () => {
    results = searchPlaces(net, input.value, 6);
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
    }
  });
  input.addEventListener("blur", () => setTimeout(closeSuggest, 150));
  suggest.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest("li");
    if (!li || li.dataset.i === undefined) return;
    e.preventDefault();
    const p = results[Number(li.dataset.i)];
    if (p) chooseOrigin(p);
  });
}

function renderSuggest() {
  const q = input.value.trim();
  if (!results.length) {
    suggest.innerHTML = q ? `<li aria-disabled="true"><span class="s-meta">No station or city by that name in this timetable</span></li>` : "";
    suggest.hidden = !q;
  } else {
    suggest.innerHTML = results
      .map((p, i) => {
        const codes = p.stations.map((s) => net.stations[s].code);
        const meta = p.isCity ? `${p.state} · ${codes.length} stations` : `${p.state ? p.state + " · " : ""}${codes[0]}`;
        return `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === active}">
          ${faceOf(p)}<span class="s-name">${esc(p.name)}</span><span class="s-script">${esc(p.hi || p.local)}</span>
          <span class="s-meta">${esc(meta)}</span></li>`;
      })
      .join("");
    suggest.hidden = false;
  }
  input.setAttribute("aria-expanded", String(!suggest.hidden));
  input.setAttribute("aria-activedescendant", active >= 0 ? `opt-${active}` : "");
}

function closeSuggest() {
  suggest.hidden = true;
  input.setAttribute("aria-expanded", "false");
}

// ---------------------------------------------------------------- choosing where you start
function chooseOrigin(p: Place) {
  closeSuggest();
  input.value = "";
  input.blur();
  const keepOpen = open?.place ?? null;
  origin = p;
  dests = departures(net, p).dests;
  hero.classList.add("leaving");
  setTimeout(() => {
    if (origin) hero.hidden = true;
  }, 450);
  $("chip-name").textContent = shortName(p);
  $("chip-script").textContent = scriptLine(p);
  chip.hidden = false;
  dock.hidden = false;
  pin.hidden = true;
  requestAnimationFrame(() => (pin.hidden = false)); // restart the drop animation
  refresh(true);
  history.replaceState(null, "", `#${encodeURIComponent(p.id)}`);
  document.title = `From ${p.name} · Patri`;
  requestAnimationFrame(() => {
    layout();
    if (keepOpen && keepOpen !== p && dests.has(keepOpen)) {
      openPlace(keepOpen);
    } else {
      closePanel(false);
      map.flyToOrigin();
    }
    setTimeout(layout, 700);
  });
  hint();
}

function backToStart(focus = false) {
  origin = null;
  dests = new Map();
  passing = new Map();
  closePanel(false);
  chip.hidden = true;
  dock.hidden = true;
  pin.hidden = true;
  hero.hidden = false;
  requestAnimationFrame(() => hero.classList.remove("leaving"));
  map.setOrigin(null, new Map(), [], false);
  updateCandidates();
  history.replaceState(null, "", location.pathname);
  document.title = "Patri";
  requestAnimationFrame(() => {
    layout();
    map.fitIndia();
    if (focus) input.focus();
  });
}

function hint() {
  let seen = false;
  try {
    seen = !!localStorage.getItem("patri.hinted");
    localStorage.setItem("patri.hinted", "1");
  } catch {
    /* show it anyway */
  }
  if (seen) return;
  setTimeout(() => {
    const t = $("toast");
    t.textContent = narrow() ? "Tap a photo to explore a place" : "Click a photo to explore a place";
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 5200);
  }, 2600);
}

// ---------------------------------------------------------------- filters
function setupDock() {
  const range = $<HTMLInputElement>("within");
  $("dock").querySelector(".ticks")!.innerHTML = "";
  const ticks = $("dock").querySelector<HTMLElement>(".ticks")!;
  ticks.style.position = "relative";
  ticks.style.height = "12px";
  ticks.innerHTML = TICKS.map(
    ([i, label]) => `<span style="position:absolute;left:calc(${(i / 9) * 100}% + ${10 - (i / 9) * 20}px);transform:translateX(-50%)">${label}</span>`,
  ).join("");
  const sync = () => {
    const v = STEPS[Number(range.value)];
    filters.within = v;
    $("within-out").textContent = v === Infinity ? "any time" : `${v / 60} hours`;
    paintTrack();
  };
  range.addEventListener("input", () => {
    sync();
    refresh(false);
  });
  range.addEventListener("change", () => map.fitRoutes());
  $("leave").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    for (const x of $("leave").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    filters.leave = b.dataset.v as Filters["leave"];
    refresh(false);
    map.fitRoutes();
  });
  sync();
}

function paintTrack() {
  const range = $<HTMLInputElement>("within");
  if (!map) return;
  const stops = STEPS.map((m, i) => `${map.timeColor(m === Infinity ? 1800 : m)} ${(i / 9) * 100}%`).join(", ");
  const pct = (Number(range.value) / 9) * 100;
  range.style.setProperty(
    "--track",
    `linear-gradient(90deg, transparent ${pct}%, color-mix(in srgb, var(--sea) 70%, transparent) ${pct}%), linear-gradient(90deg, ${stops})`,
  );
}

function refresh(animate: boolean) {
  if (!origin) return;
  const now = istNow();
  const act = new Map<Train, ActiveTrain>();
  passing = new Map();
  for (const d of dests.values()) {
    for (const l of d.legs) {
      if (!legPasses(l, filters, now)) continue;
      const a = act.get(l.train);
      if (!a) act.set(l.train, { from: l.from, to: l.to });
      else a.to = Math.max(a.to, l.to);
      (passing.get(d.place) ?? passing.set(d.place, []).get(d.place)!).push(l);
    }
  }
  const reach: Reach[] = [...passing].map(([place, legs]) => ({ place, mins: Math.min(...legs.map((l) => l.dur)) }));
  map.setOrigin(origin, act, reach, animate);
  updateCandidates();
  const withPhotos = reach.filter((r) => gindex.get(r.place)?.icon).length;
  $("count").innerHTML = !dests.size
    ? "No trains leave from here in the 2017 timetable."
    : act.size
      ? `<b>${reach.length.toLocaleString("en-IN")}</b> places · <b>${act.size}</b> trains${withPhotos ? ` · ${withPhotos} with travel guides` : ""}`
      : "No trains match. Try a wider window.";
  if (open && !open.leg) renderPanel();
}

function updateCandidates() {
  if (!map) return;
  const cands: (BubbleCandidate & { guide: string })[] = [];
  const add = (place: Place, mins: number | null, score: number) => {
    const gv = gindex.get(place);
    if (!gv?.icon) return;
    cands.push({ place, title: destTitleOf(place, gv), photo: gv.icon, mins, score: score + (iconicRank.has(gv.title) ? (origin ? 0.8 : 10 + iconicRank.get(gv.title)! * 0.1) : 0), guide: gv.title });
  };
  if (origin) {
    for (const [place, legs] of passing) {
      const gv = gindex.get(place);
      if (!gv) continue;
      add(place, Math.min(...legs.map((l) => l.dur)), Math.log1p(gv.art.appeal) + 0.35 * Math.log1p(legs.length) + (place.isCity ? 0.4 : 0));
    }
  } else {
    for (const [place, gv] of gindex) {
      if (!place.halts) continue;
      // inspiration: rank by how much there is to see, not by how busy the station is
      add(place, null, Math.log1p(gv.art.appeal) + (gv.banner ? 0.3 : 0));
    }
  }
  // one bubble per guide: a city's many stations, or two stations sharing a famous neighbour
  const best = new Map<string, BubbleCandidate>();
  const pref = (c: BubbleCandidate) => c.score + (c.place.isCity ? 1 : 0) + c.place.halts * 1e-6;
  for (const c of cands) {
    const prev = best.get(c.guide);
    if (!prev || pref(prev) < pref(c)) best.set(c.guide, c);
  }
  map.setCandidates([...best.values()]);
}

// ---------------------------------------------------------------- clock
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
    if (p) pin.style.transform = `translate(${p[0] - 26}px, ${p[1] - 24}px)`;
  }
  requestAnimationFrame(trackPin);
}

// ---------------------------------------------------------------- hover
function showTip(p: Place | null, x: number, y: number) {
  if (!p || narrow()) {
    tip.hidden = true;
    return;
  }
  const gv = gindex.get(p);
  const title = destTitleOf(p, gv ?? null);
  let line = p.state || "";
  const legs = passing.get(p);
  if (origin && legs?.length) {
    line = `${fmtMins(Math.min(...legs.map((l) => l.dur)))} · ${legs.length} train${legs.length === 1 ? "" : "s"}`;
  }
  tip.innerHTML = `<b>${esc(title)}</b><span>${esc(line)}</span>`;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(x + 16, window.innerWidth - r.width - 8)}px`;
  tip.style.top = `${y + 18 + r.height > window.innerHeight ? y - r.height - 12 : y + 18}px`;
}

// ---------------------------------------------------------------- panel
function openPlace(p: Place) {
  if (p === origin) return;
  tip.hidden = true;
  open = { place: p, showAll: false, sight: -1, leg: null };
  map.select(p);
  map.selectTrain(null);
  map.showSights([]);
  renderPanel();
  setPanelOpen(true);
  panel.querySelector(".panel-scroll")?.scrollTo({ top: 0 });
  map.focusOn(p);
}

function renderPanel() {
  if (!open) return;
  const p = open.place;
  const gv = gindex.get(p) ?? null;
  if (open.leg) {
    panel.innerHTML = trainHtml(net, open.leg, destTitleOf(p, gv));
    panel.dataset.view = "train";
    panel.querySelector("#boarding")?.scrollIntoView({ block: "center" });
    return;
  }
  const now = istNow();
  const scroll = panel.querySelector(".panel-scroll")?.scrollTop ?? 0;
  panel.dataset.view = "place";
  panel.innerHTML = placeHtml({
    net,
    guides,
    place: p,
    gv,
    origin,
    legs: dests.get(p)?.legs ?? [],
    passes: (l) => legPasses(l, filters, now),
    now,
    showAllTrains: open.showAll,
    activeSight: open.sight,
    titleToPlace: (t) => titlePlace.get(t) ?? null,
  });
  panel.querySelector(".panel-scroll")!.scrollTop = scroll;
}

panel.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el || !open) return;
  const p = open.place;
  const now = istNow();
  const legs = [...(dests.get(p)?.legs ?? [])].sort((a, b) => ((a.dep - now + 1440) % 1440) - ((b.dep - now + 1440) % 1440));
  switch (el.dataset.act) {
    case "close":
      closePanel();
      break;
    case "leg": {
      const leg = legs[Number(el.dataset.i)];
      if (!leg) break;
      open.leg = leg;
      map.selectTrain(leg);
      map.showSights([]);
      renderPanel();
      map.focusLeg(leg);
      break;
    }
    case "back":
      open.leg = null;
      map.selectTrain(null);
      renderPanel();
      map.focusOn(p);
      break;
    case "all-trains":
      open.showAll = true;
      renderPanel();
      break;
    case "sight": {
      const i = Number(el.dataset.i);
      open.sight = open.sight === i ? -1 : i;
      for (const s of panel.querySelectorAll(".sight")) s.classList.toggle("active", Number((s as HTMLElement).dataset.i) === open.sight);
      if (open.sight >= 0) showSights(p, i, true);
      break;
    }
    case "sights-map":
      open.sight = -1;
      showSights(p, -1, true);
      break;
    case "place": {
      const q = net.places.get(el.dataset.id!);
      if (q) openPlace(q);
      break;
    }
    case "pick-origin":
      closePanel();
      input.focus();
      break;
    case "from-here":
      chooseOrigin(p);
      break;
  }
});

function sightPins(p: Place): SightPin[] {
  const gv = gindex.get(p);
  if (!gv || !guides) return [];
  return gv.art.sights
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.ll)
    .map(({ s, i }) => ({ i, name: s.n, lat: s.ll![0], lon: s.ll![1], photo: s.img ? guides!.photos[s.img] ?? null : null }));
}

function showSights(p: Place, active: number, fly: boolean) {
  const pins = sightPins(p);
  if (!pins.length) return;
  map.showSights(pins, active);
  if (fly) map.focusSights(pins, pins.find((x) => x.i === active));
}

function setPanelOpen(on: boolean) {
  panel.hidden = !on;
  document.body.classList.toggle("panel-open", on);
  layout();
}

function closePanel(refit = true) {
  const was = open;
  open = null;
  setPanelOpen(false);
  if (!map) return;
  map.select(null);
  map.selectTrain(null);
  map.showSights([]);
  if (refit && was) {
    if (origin) map.fitRoutes();
    else map.fitIndia();
  }
}

boot().catch((err) => {
  console.error(err);
  $("loading").textContent = "Couldn't load the timetable. Reload the page to try again.";
});
