// The controller: owns what's picked (where you start, the open place or train, the filters),
// turns that into map and panel updates, and keeps the address bar in step.
import { fmtMins, fmtTime, istWeekMinute, plural } from "../core/format";
import type { Network, Place } from "../core/network";
import type { ArticleDetail, GuideView, Photo, PlaceDetails } from "../core/places";
import { rankPlaces } from "../core/rank";
import { titleOf, type Slugs } from "../core/slugs";
import { ANY, arrivals, bySoonest, departures, legPasses, newerBetween, reachable, type Destination, type Filters, type Leg } from "../core/trips";
import type { RailMap, SightPin } from "../map/map";
import { Dock } from "../ui/dock";
import { listHtml, type ListItem } from "../ui/list";
import { esc, placeHtml, scriptLine, trainHtml, type GetHere } from "../ui/panel";
import { SearchBox } from "../ui/search";
import { filtersOf, go, href, parse, type Route } from "./router";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const narrow = () => window.innerWidth <= 720;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const POPULAR = ["bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad"];
const LAST = "railgaddi.last"; // the station you started from last time (on this device only)

type Detail = { detail: ArticleDetail; photos: Map<string, Photo> };
type Open =
  | { kind: "place"; place: Place; showAll: boolean; sight: number; legs: Leg[]; allFrom?: boolean; choosing?: boolean }
  | { kind: "train"; place: Place; leg: Leg }
  | { kind: "list"; showAll: boolean; withGuides: boolean };

export class App {
  private origin: Place | null = null;
  private dests = new Map<Place, Destination>();
  private reach = new Map<Place, Leg[]>();
  private filters: Filters = { ...ANY };
  private open: Open | null = null;
  private placeScroll = 0; // where the place panel was scrolled when a train was opened from it
  private trainPushed = false;
  private detailCache = new Map<string, Detail>();
  private titlePlace = new Map<string, Place>();

  private hero = $("hero");
  private chip = $("origin-chip");
  private dockEl = $("dock");
  private panel = $("panel");
  private tip = $("tip");
  private pin = $("origin-pin");
  private search: SearchBox;
  private tkFrom: SearchBox;
  private tkTo: SearchBox;
  private dock: Dock;
  private heroShown = true;
  private returnFocus: HTMLElement | null = null;
  private depCache = new Map<Place, Map<Place, Destination>>();
  private arrCache = new Map<Place, Map<Place, Destination>>();

  constructor(
    private net: Network,
    private guides: Map<Place, GuideView>,
    private slugs: Slugs,
    private details: PlaceDetails,
    private map: RailMap,
  ) {
    for (const [p, gv] of guides) if (!this.titlePlace.has(gv.title) || p.isCity) this.titlePlace.set(gv.title, p);

    const g = () => guides;
    this.search = new SearchBox($("origin-input"), $("suggest"), net, g, (p) => this.chooseFrom(p), {
      popular: $("popular"),
      popularIds: POPULAR,
    });
    new SearchBox($("to-input"), $("suggest-to"), net, g, (p) => this.chooseTo(p), {
      empty: "No station, city or famous place by that name",
    });
    this.tkFrom = new SearchBox($("tk-from-input"), $("tk-from-list"), net, g, (p) => this.chooseFrom(p), {
      context: (p) => this.fromNote(p),
      suggestions: () => this.suggestFrom(),
    });
    this.tkTo = new SearchBox($("tk-to-input"), $("tk-to-list"), net, g, (p) => this.chooseTo(p), {
      context: (p) => this.toNote(p),
      suggestions: () => this.suggestTo(),
    });
    this.renderPopular();
    $("tk-from").addEventListener("click", () => this.editTicket("from"));
    $("tk-to").addEventListener("click", () => this.editTicket("to"));
    for (const id of ["tk-from-input", "tk-to-input"]) {
      $(id).addEventListener("blur", () => setTimeout(() => !$("tk-edit").contains(document.activeElement) && ($("tk-edit").hidden = true), 180));
      $(id).addEventListener("keydown", (e) => e.key === "Escape" && (($("tk-edit").hidden = true), $("tk-from").focus()));
    }
    $("near-btn").addEventListener("click", () => this.nearMe());
    $("count").addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest("[data-act=reset]")) return;
      this.dock.set({ ...ANY });
      this.setFilters({ ...ANY }, true);
    });
    this.dock = new Dock(
      this.dockEl,
      (f, settled) => this.setFilters(f, settled),
      () => (this.open?.kind === "list" ? this.closePanel({ push: false }) : this.openList()),
      (m) => map.timeColor(m),
    );

    map.hooks = {
      // looking at the ways into a place: a click picks where you'd start from
      onPick: (p) => (this.target() && p !== this.target() ? this.setOrigin(p, { push: true }) : this.openPlace(p, { push: true })),
      onPickSight: (i) => this.pickSight(i, false),
      onHover: (p, x, y) => this.hover(p, x, y),
      onBackground: () => this.open && this.closePanel({ push: true }),
    };

    this.panel.addEventListener("click", (e) => this.onPanelClick(e));
    // photos fade in once loaded; broken ones step aside (no inline handlers, CSP-friendly)
    this.panel.addEventListener("load", (e) => (e.target as HTMLElement).tagName === "IMG" && (e.target as HTMLElement).classList.add("in"), true);
    this.panel.addEventListener("error", (e) => (e.target as HTMLElement).tagName === "IMG" && (e.target as HTMLElement).classList.add("broken"), true);
    $("chip-change").addEventListener("click", () => this.startOver());
    const brand = $("brand") as HTMLAnchorElement;
    brand.href = href({});
    brand.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the browser
      e.preventDefault();
      this.startOver(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || (document.activeElement as HTMLElement | null)?.matches("input")) return;
      if (this.open?.kind === "train") this.back();
      else if (this.open) this.closePanel({ push: true });
    });
    window.addEventListener("popstate", () => this.applyRoute(parse(), false));
    window.addEventListener("resize", () => this.settle());
    requestAnimationFrame(() => this.trackPin());
  }

  /** Put the app in the state an address describes (first load, back/forward). */
  applyRoute(r: Route, first: boolean) {
    this.filters = filtersOf(r);
    this.dock.set(this.filters);
    const origin = (r.origin && this.slugs.find(r.origin)) || null;
    const place = (r.place && this.slugs.find(r.place)) || null;
    if (origin !== this.origin) this.setOrigin(origin, { push: false, fly: !place, animate: true });
    else this.refresh(false);
    if (place && place !== origin && !r.train && this.open?.kind === "train" && this.open.place === place) {
      this.back({ push: false }); // browser back from a train: the place, scrolled where you left it
    } else if (place && place !== origin) {
      this.openPlace(place, { push: false });
      const leg = r.train && this.dests.get(place)?.legs.find((l) => l.train.no === r.train);
      if (leg) this.openTrain(leg, { push: false });
    } else if (this.open && this.open.kind !== "list") {
      this.closePanel({ push: false, refit: !first });
    }
    if (first) this.settle();
    if (first && !origin && !place && !narrow()) this.search.focus();
    const missing = (r.origin && !origin ? r.origin : null) ?? (r.place && !place ? r.place : null);
    if (missing) {
      // an old or mistyped link: say so, and show the address of what we could open
      this.toast(`Couldn't find “${missing.replace(/-/g, " ")}”. Try the search.`, 5000);
      this.sync("replace");
    }
    this.describe();
  }

  /** Re-measure the UI around the map (after first paint, fonts, resizes); on the landing view, refit India. */
  settle() {
    this.map.resize(); // the window changed: know the new size before framing anything
    this.layout();
    if (!this.origin && !this.open) this.map.fitIndia(0);
  }

  // ---------------------------------------------------------------- where you start

  setOrigin(p: Place | null, o: { push: boolean; fly?: boolean; animate?: boolean; focusSearch?: boolean }) {
    // the place you were looking at stays open: now with the trains from where you start
    const keep = this.destination();
    this.origin = p;
    if (p) {
      this.remember(p);
      this.pin.hidden = true;
      requestAnimationFrame(() => (this.pin.hidden = !this.origin)); // restart the drop animation
      this.hint();
    } else {
      this.pin.hidden = true;
    }
    this.refresh(o.animate ?? true);
    // decide now, not in the next frame: a caller (a shared link) may open a place right after this
    const reopen = !!(keep && keep !== p);
    if (!reopen && this.open) this.closePanel({ push: false, refit: false });
    requestAnimationFrame(() => {
      this.layout();
      if (reopen) this.openPlace(keep!, { push: false });
      else if (p && o.fly !== false) this.map.flyToOrigin();
      else if (!p) this.map.fitIndia();
      setTimeout(() => this.layout(), 700);
      if (o.focusSearch) this.search.focus();
    });
    if (o.push) this.sync("push");
    this.describe();
  }

  /** Back to the start: nothing picked, the landing page. */
  private startOver(focus = true) {
    if (this.open) this.closePanel({ push: false, refit: false });
    this.setOrigin(null, { push: true, focusSearch: focus && !narrow() });
  }

  private chooseFrom(p: Place) {
    $("tk-edit").hidden = true;
    if (p === this.destination()) {
      // "from" the place you were looking at: explore from there instead
      this.closePanel({ push: false, refit: false });
    }
    this.setOrigin(p, { push: true });
  }

  private chooseTo(p: Place) {
    $("tk-edit").hidden = true;
    if (p === this.origin) {
      this.toast(`That's where you start. Pick somewhere to go.`);
      return;
    }
    this.openPlace(p, { push: true });
  }

  /** Open the ticket's search for one end. */
  private editTicket(end: "from" | "to") {
    const box = $("tk-edit");
    box.hidden = false;
    $("tk-from-input").hidden = end !== "from";
    $("tk-to-input").hidden = end !== "to";
    (end === "from" ? this.tkFrom : this.tkTo).focus();
    $(end === "from" ? "tk-from-input" : "tk-to-input").dispatchEvent(new Event("focus"));
  }

  /** The place whose ways in the map shows: open, with no start picked. */
  private target(): Place | null {
    return !this.origin && this.open && this.open.kind !== "list" ? this.open.place : null;
  }

  /** The place you're looking at, with or without a start. */
  private destination(): Place | null {
    return this.open && this.open.kind !== "list" ? this.open.place : null;
  }

  private departuresFrom(p: Place) {
    let d = this.depCache.get(p);
    if (!d) this.depCache.set(p, (d = departures(this.net, p)));
    if (this.depCache.size > 6) this.depCache.delete(this.depCache.keys().next().value!);
    return d;
  }

  private arrivalsTo(p: Place) {
    let d = this.arrCache.get(p);
    if (!d) this.arrCache.set(p, (d = arrivals(this.net, p)));
    if (this.arrCache.size > 6) this.arrCache.delete(this.arrCache.keys().next().value!);
    return d;
  }

  private name(p: Place) {
    return titleOf(p, this.guides.get(p));
  }

  /** In a "from" field: how you'd get from there to where you're looking. */
  private fromNote(p: Place) {
    const dest = this.destination();
    const d = dest && this.arrivalsTo(dest).get(p);
    if (!d) return null;
    return { note: `${fmtMins(d.fastest)} to ${this.name(dest!)} · ${plural(new Set(d.legs.map((l) => l.train)).size, "direct train")}`, boost: 10 };
  }

  /** In a "to" field: how long it takes from where you start. */
  private toNote(p: Place) {
    const d = this.origin && this.departuresFrom(this.origin).get(p);
    if (!d) return null;
    return { note: `${fmtMins(d.fastest)} from ${titleOf(this.origin!, null)}`, boost: 10 };
  }

  private suggestFrom(): Place[] {
    const dest = this.destination();
    if (dest) return this.fromPlaces(dest).slice(0, 6).map((d) => d.place);
    const last = this.lastOrigin();
    return [...(last ? [last] : []), ...POPULAR.map((id) => this.net.places.get(id)!).filter((p) => p && p !== last)].slice(0, 6);
  }

  private suggestTo(): Place[] {
    if (!this.origin) return [];
    return rankPlaces(this.guides, this.reach).slice(0, 6).map((c) => c.place);
  }

  /** Places with a direct train to `dest`: cities first, then the rest, each quickest first. */
  private fromPlaces(dest: Place) {
    return [...this.arrivalsTo(dest).values()].sort((a, b) => Number(b.place.isCity) - Number(a.place.isCity) || a.fastest - b.fastest);
  }

  private getHere(dest: Place, showAll: boolean, choosing = false): GetHere | null {
    if (this.origin && this.dests.has(dest) && !choosing) return null; // the trains are right there
    const all = this.fromPlaces(dest);
    const home = this.guides.get(dest)?.title;
    const items = (showAll ? all : all.slice(0, 8)).map((d) => {
      const gv = this.guides.get(d.place);
      return {
        id: d.place.id,
        title: this.name(d.place),
        state: d.place.state,
        mins: d.fastest,
        trains: new Set(d.legs.map((l) => l.train)).size,
        href: href({ origin: this.slugs.of(d.place), place: this.slugs.of(dest) }),
        photo: gv && gv.title !== home ? gv.icon : null,
      };
    });
    return { items, total: all.length, showAll, blockedFrom: this.origin ? titleOf(this.origin, null) : null, choosing };
  }

  private remember(p: Place) {
    try {
      localStorage.setItem(LAST, p.id);
    } catch {
      /* private browsing: fine */
    }
    this.renderPopular();
  }

  private lastOrigin(): Place | null {
    try {
      const id = localStorage.getItem(LAST);
      return (id && this.net.places.get(id)) || null;
    } catch {
      return null;
    }
  }

  private renderPopular() {
    const last = this.lastOrigin();
    this.search.renderPopular((p) => href({ origin: this.slugs.of(p) }), last && { place: last, label: "Where you started last time" });
  }

  /** Start from the station nearest you (the position never leaves this device). */
  private nearMe() {
    if (!navigator.geolocation) {
      this.toast("This browser can't share your location");
      return;
    }
    const btn = $("near-btn");
    btn.classList.add("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove("busy");
        const { latitude: lat, longitude: lon } = pos.coords;
        const km = (p: Place) => {
          const dy = (p.lat! - lat) * 111;
          const dx = (p.lon! - lon) * 111 * Math.cos((lat * Math.PI) / 180);
          return Math.hypot(dx, dy);
        };
        const near = [...this.net.places.values()].filter((p) => p.halts && p.lat !== null).map((p) => ({ p, d: km(p) }));
        // within 25 km, the station most trains stop at; otherwise simply the closest
        const close = near.filter((x) => x.d < 25).sort((a, b) => b.p.halts - a.p.halts);
        const pick = close[0] ?? near.sort((a, b) => a.d - b.d)[0];
        if (!pick || pick.d > 150) {
          this.toast("No station within 150 km of you in this timetable");
          return;
        }
        this.toast(`Starting from ${this.name(pick.p)}, ${Math.round(pick.d)} km away`);
        this.chooseFrom(pick.p);
      },
      () => {
        btn.classList.remove("busy");
        this.toast("Couldn't get your location. Type your station instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  /** What's on screen around the map: the landing page, or the ticket once something's picked. */
  private syncChrome() {
    const dest = this.destination();
    const active = !!(this.origin || dest);
    this.showHero(!active);
    this.chip.hidden = !active;
    this.dockEl.hidden = !this.origin;
    const fromName = $("chip-name");
    fromName.textContent = this.origin ? titleOf(this.origin, null) : "Anywhere";
    fromName.classList.toggle("open", !this.origin);
    $("chip-script").textContent = this.origin ? scriptLine(this.origin) : "";
    const toName = $("tk-to-name");
    toName.textContent = dest ? this.name(dest) : "Anywhere";
    toName.classList.toggle("open", !dest);
    $("tk-from").setAttribute("aria-label", this.origin ? `From ${titleOf(this.origin, null)}. Change where you start` : "Choose where you start");
    $("tk-to").setAttribute("aria-label", dest ? `To ${this.name(dest)}. Change where you're going` : "Choose where to go");
    document.body.classList.toggle("to-mode", !!this.target());
  }

  private showHero(on: boolean) {
    if (on === this.heroShown) return;
    this.heroShown = on;
    if (on) {
      this.hero.hidden = false;
      requestAnimationFrame(() => this.hero.classList.remove("leaving"));
    } else {
      this.hero.classList.add("leaving");
      setTimeout(() => !this.heroShown && (this.hero.hidden = true), 450);
    }
  }

  private setFilters(f: Filters, settled: boolean) {
    this.filters = f;
    this.refresh(false);
    if (settled) {
      this.map.fitRoutes();
      this.sync("replace");
    }
  }

  /**
   * Recompute what the map shows: the places reachable from where you start (under the filters),
   * or, with only a destination open, the places with a direct train to it.
   */
  private refresh(animate: boolean, render = true) {
    const now = istWeekMinute();
    const target = this.target();
    const hub = this.origin ?? target;
    this.dests = this.origin ? this.departuresFrom(this.origin) : target ? this.arrivalsTo(target) : new Map();
    const { trains, byPlace } = reachable(this.dests, this.origin ? this.filters : ANY, now);
    this.reach = byPlace;
    const reach = [...byPlace].map(([place, legs]) => ({ place, mins: Math.min(...legs.map((l) => l.dur)) }));
    this.map.setOrigin(hub, trains, reach, animate, !this.origin && !!target);
    this.map.setCandidates(rankPlaces(this.guides, hub ? byPlace : null));
    const withGuides = reach.filter((r) => this.guides.get(r.place)?.icon).length;
    const year = this.net.meta.snapshot.slice(0, 4);
    $("count").innerHTML = target
      ? reach.length
        ? `<b>${reach.length.toLocaleString("en-IN")}</b> places with a direct train here`
        : `No direct train comes here in the ${year} timetable`
      : !this.origin
        ? ""
        : !this.dests.size
          ? `No trains leave from here in the ${year} timetable`
          : trains.size
            ? `<b>${reach.length.toLocaleString("en-IN")}</b> places · <b>${trains.size}</b> trains${withGuides ? ` · ${withGuides} with guides` : ""}`
            : `No train matches these filters. <button type="button" data-act="reset">Show all</button>`;
    this.syncChrome();
    if (render && (this.open?.kind === "place" || this.open?.kind === "list")) this.renderPanel(false);
  }

  /** The route geometry arrived: redraw lines along the track. */
  networkDetailed() {
    this.map.refreshNetwork();
    this.refresh(false);
  }

  // ---------------------------------------------------------------- the panel

  openPlace(p: Place, o: { push: boolean }) {
    if (p === this.origin) return;
    if (!this.open) this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this.tip.hidden = true;
    const before = this.target();
    this.open = { kind: "place", place: p, showAll: false, sight: -1, legs: [] };
    this.map.select(p);
    this.map.selectTrain(null);
    this.map.showSights([]);
    // no start picked: the map turns to show every way into this place
    if (!this.origin) this.refresh(before !== p, false);
    this.transition(() => this.renderPanel(true));
    this.setPanelOpen(true);
    if (this.origin) this.map.focusOn(p);
    else requestAnimationFrame(() => this.map.fitCore());
    if (o.push) this.sync("push");
    this.describe();
  }

  private openTrain(leg: Leg, o: { push: boolean }) {
    if (this.open?.kind !== "place" && this.open?.kind !== "train") return;
    if (this.open.kind === "place") this.placeScroll = this.panel.querySelector(".panel-scroll")?.scrollTop ?? 0;
    this.trainPushed = o.push;
    this.open = { kind: "train", place: this.open.place, leg };
    this.map.selectTrain(leg);
    this.map.showSights([]);
    this.transition(() => this.renderPanel(true));
    this.map.focusLeg(leg);
    if (o.push) this.sync("push");
    this.describe();
  }

  private back(o = { push: true }) {
    if (this.open?.kind !== "train") return;
    if (o.push && this.trainPushed) {
      history.back(); // we came from the place: step back rather than stacking another entry
      return;
    }
    const place = this.open.place;
    this.map.selectTrain(null);
    this.open = { kind: "place", place, showAll: false, sight: -1, legs: [] };
    this.transition(() => this.renderPanel(true, this.placeScroll));
    this.placeScroll = 0;
    this.map.focusOn(place);
    if (o.push) this.sync("push");
    this.describe();
  }

  private openList() {
    if (!this.origin) return;
    this.open = { kind: "list", showAll: false, withGuides: true };
    this.map.select(null);
    this.map.selectTrain(null);
    this.map.showSights([]);
    this.transition(() => this.renderPanel(true));
    this.setPanelOpen(true);
    this.dock.setListOpen(true);
  }

  closePanel(o: { push: boolean; refit?: boolean }) {
    const was = this.open;
    const wasTarget = this.target();
    this.open = null;
    this.setPanelOpen(false);
    this.dock.setListOpen(false);
    this.map.select(null);
    this.map.selectTrain(null);
    this.map.showSights([]);
    if (wasTarget) this.refresh(false); // leaving the ways into a place: back to the whole country
    else this.syncChrome();
    if (o.refit !== false && was && was.kind !== "list") {
      if (this.origin) this.map.fitRoutes();
      else this.map.fitIndia();
    }
    // keyboard users land back where they were
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected && back.offsetParent !== null) back.focus({ preventScroll: true });
    if (o.push) this.sync("push");
    this.describe();
  }

  private setPanelOpen(on: boolean) {
    if (!on) document.body.classList.remove("sheet-full");
    this.panel.hidden = !on;
    document.body.classList.toggle("panel-open", on);
    this.layout();
  }

  private detailFor(gv: GuideView | null, place: Place): Detail | "loading" | null {
    if (!gv) return null;
    const hit = this.detailCache.get(gv.title);
    if (hit) return hit;
    this.details
      .get(gv.title)
      .then((d) => {
        if (!d) return;
        this.detailCache.set(gv.title, d);
        if (this.open?.kind === "place" && this.open.place === place) this.renderPanel(false);
      })
      .catch(() => {
        if (this.open?.kind === "place" && this.open.place === place) this.toast("Couldn't load this place's guide. Check your connection.");
      });
    return "loading";
  }

  private renderPanel(fresh: boolean, scrollTo?: number) {
    const o = this.open;
    if (!o) return;
    const scroller = () => this.panel.querySelector<HTMLElement>(".panel-scroll");
    const keep = fresh ? 0 : scroller()?.scrollTop ?? 0;
    if (o.kind === "train") {
      const gv = this.guides.get(o.place) ?? null;
      this.panel.innerHTML = trainHtml(this.net, o.leg, titleOf(o.place, gv));
      this.panel.dataset.view = "train";
    } else if (o.kind === "list") {
      this.panel.dataset.view = "list";
      this.panel.innerHTML = listHtml(titleOf(this.origin!, null), this.listItems(o.withGuides), o.showAll, o.withGuides);
    } else {
      const now = istWeekMinute();
      const gv = this.guides.get(o.place) ?? null;
      const legs = this.dests.get(o.place)?.legs ?? [];
      o.legs = bySoonest(legs, now); // the panel numbers trains in this order
      this.panel.dataset.view = "place";
      this.panel.innerHTML = placeHtml({
        net: this.net,
        place: o.place,
        gv,
        detail: this.detailFor(gv, o.place),
        origin: this.origin,
        legs,
        passes: (l) => legPasses(l, this.filters, now),
        now,
        showAllTrains: o.showAll,
        activeSight: o.sight,
        nearby: (gv?.nearby ?? []).map((t) => {
          const p = this.titlePlace.get(t);
          const ix = p ? this.guides.get(p) : undefined;
          return { title: t, href: p ? href({ origin: this.origin ? this.slugs.of(this.origin) : undefined, place: this.slugs.of(p) }) : null, photo: ix?.icon ?? null };
        }),
        newer: this.origin ? newerBetween(this.net, this.origin, o.place) : [],
        getHere: this.getHere(o.place, !!o.allFrom, !!o.choosing),
      });
      const gh = this.panel.querySelector<HTMLInputElement>("#gh-input");
      if (gh) {
        new SearchBox(gh, this.panel.querySelector<HTMLUListElement>("#gh-list")!, this.net, () => this.guides, (p) => this.chooseFrom(p), {
          context: (p) => this.fromNote(p),
          suggestions: () => this.suggestFrom(),
        });
      }
    }
    this.addGrip();
    const s = scroller();
    if (s && !fresh) s.scrollTop = keep;
    else if (s && scrollTo) s.scrollTop = scrollTo;
    else if (s && o.kind === "train") {
      // open the stops list with your boarding station a third of the way down
      const b = s.querySelector<HTMLElement>("#boarding");
      if (b) s.scrollTop = b.getBoundingClientRect().top - s.getBoundingClientRect().top - s.clientHeight / 3;
    }
    if (fresh) this.panel.querySelector<HTMLElement>("#panel-title")?.focus({ preventScroll: true });
  }

  /**
   * The bottom sheet's handle, on phones: drag it down to close, up (or tap) to see more. It's a
   * real control, not a decoration, so the grip means what it looks like it means.
   */
  private addGrip() {
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "sheet-grip";
    grip.setAttribute("aria-label", document.body.classList.contains("sheet-full") ? "Show less" : "Show more");
    this.panel.prepend(grip);
    let startY = 0;
    let dy = 0;
    let dragging = false;
    grip.addEventListener("pointerdown", (e) => {
      if (!narrow()) return;
      dragging = true;
      startY = e.clientY;
      dy = 0;
      grip.setPointerCapture(e.pointerId);
      this.panel.style.transition = "none";
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dy = e.clientY - startY;
      this.panel.style.transform = `translateY(${Math.max(-40, dy)}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.panel.style.transition = "";
      this.panel.style.transform = "";
      if (dy > 90) this.closePanel({ push: true });
      else if (dy < -30) this.expandSheet(true);
      else if (Math.abs(dy) < 6) this.expandSheet(!document.body.classList.contains("sheet-full"));
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    grip.addEventListener("click", (e) => {
      if (e.detail === 0) this.expandSheet(!document.body.classList.contains("sheet-full")); // keyboard
    });
  }

  private expandSheet(on: boolean) {
    document.body.classList.toggle("sheet-full", on);
    this.panel.querySelector(".sheet-grip")?.setAttribute("aria-label", on ? "Show less" : "Show more");
    this.layout();
  }

  private listItems(withGuides: boolean): ListItem[] {
    // your own city's guide isn't somewhere to go: its stations are listed, without its photo
    const home = this.guides.get(this.origin!)?.title;
    const rows = new Map<string, ListItem & { city: boolean }>();
    for (const [place, legs] of this.reach) {
      const gv = this.guides.get(place) ?? null;
      if (withGuides && (!gv || gv.title === home)) continue;
      const item = {
        id: place.id,
        title: titleOf(place, gv),
        state: place.state,
        mins: Math.min(...legs.map((l) => l.dur)),
        trains: new Set(legs.map((l) => l.train)).size,
        photo: gv && gv.title !== home ? gv.icon : null,
        href: href({ origin: this.slugs.of(this.origin!), place: this.slugs.of(place) }),
        city: place.isCity,
      };
      // with guides: one row per guide, at the city's own station if it has one, else the nearest
      const key = withGuides ? gv!.title : place.id;
      const prev = rows.get(key);
      if (!prev || (item.city && !prev.city) || (item.city === prev.city && item.mins < prev.mins)) rows.set(key, item);
    }
    return [...rows.values()].sort((a, b) => a.mins - b.mins);
  }


  private onPanelClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    const o = this.open;
    if (!el || !o) return;
    const act = el.dataset.act;
    if (act === "nav") {
      // an in-app link: follow it without a page load, keep real hrefs for sharing and crawlers
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      const r = parse(new URL((el as HTMLAnchorElement).href));
      const p = r.place ? this.slugs.find(r.place) : null;
      if (p) this.openPlace(p, { push: true });
      return;
    }
    if (act === "from") {
      // "start from here" in the ways-in list: stay on this place, now with its trains
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      const p = this.net.places.get(el.dataset.id!);
      if (p) this.chooseFrom(p);
      return;
    }
    switch (act) {
      case "close":
        this.closePanel({ push: o.kind !== "list" });
        break;
      case "share":
        this.share();
        break;
      case "back":
        this.back();
        break;
      case "leg":
        if (o.kind === "place") {
          const leg = o.legs[Number(el.dataset.i)];
          if (leg) this.openTrain(leg, { push: true });
        }
        break;
      case "all-trains":
        if (o.kind === "place") {
          o.showAll = true;
          this.renderPanel(false);
        }
        break;
      case "sight":
        this.pickSight(Number(el.dataset.i), true);
        break;
      case "sights-map":
        if (o.kind === "place") {
          o.sight = -1;
          this.showSights(o.place, -1, true);
        }
        break;
      case "change-from":
        if (o.kind === "place") {
          o.choosing = true;
          this.renderPanel(false);
          const gh = this.panel.querySelector<HTMLElement>(".get-here");
          gh?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
          this.panel.querySelector<HTMLInputElement>("#gh-input")?.focus({ preventScroll: true });
        }
        break;
      case "gh-all":
        if (o.kind === "place") {
          o.allFrom = true;
          this.renderPanel(false);
        }
        break;
      case "from-here":
        if (o.kind === "place") this.setOrigin(o.place, { push: true });
        break;
      case "list-more":
        if (o.kind === "list") {
          o.showAll = true;
          this.renderPanel(false);
        }
        break;
      case "list-guides":
      case "list-all":
        if (o.kind === "list") {
          o.withGuides = act === "list-guides";
          o.showAll = false;
          this.renderPanel(false);
        }
        break;
    }
  }

  private pickSight(i: number, fly: boolean) {
    if (this.open?.kind !== "place") return;
    const o = this.open;
    o.sight = o.sight === i && fly ? -1 : i;
    for (const s of this.panel.querySelectorAll<HTMLElement>(".sight")) {
      const on = Number(s.dataset.i) === o.sight;
      s.classList.toggle("active", on);
      s.setAttribute("aria-pressed", String(on));
    }
    if (o.sight >= 0) {
      this.showSights(o.place, o.sight, fly);
      document.getElementById(`sight-${o.sight}`)?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  private showSights(p: Place, active: number, fly: boolean) {
    const gv = this.guides.get(p);
    const d = gv && this.detailCache.get(gv.title);
    if (!d) return;
    const pins: SightPin[] = d.detail.sights
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.ll)
      .map(({ s, i }) => ({ i, name: s.n, lat: s.ll![0], lon: s.ll![1], photo: s.img ? d.photos.get(s.img) ?? null : null }));
    if (!pins.length) return;
    this.map.showSights(pins, active);
    if (fly) this.map.focusSights(pins, pins.find((x) => x.i === active));
  }

  // ---------------------------------------------------------------- small things

  private hover(p: Place | null, x: number, y: number) {
    const gv = p ? this.guides.get(p) : undefined;
    if (gv) this.details.prefetch(gv.title);
    if (!p || narrow()) {
      this.tip.hidden = true;
      return;
    }
    const legs = this.reach.get(p);
    const target = this.target();
    const mins = legs?.length ? fmtMins(Math.min(...legs.map((l) => l.dur))) : "";
    const line = target && legs?.length
      ? `${mins} to ${this.name(target)} · click to start here`
      : this.origin && legs?.length
        ? `${mins} · ${plural(legs.length, "train")}`
        : p.state || "";
    this.tip.innerHTML = `<b>${esc(titleOf(p, gv))}</b><span>${esc(line)}</span>`;
    this.tip.hidden = false;
    const r = this.tip.getBoundingClientRect();
    this.tip.style.left = `${Math.min(x + 16, window.innerWidth - r.width - 8)}px`;
    this.tip.style.top = `${y + 18 + r.height > window.innerHeight ? y - r.height - 12 : y + 18}px`;
  }

  private async share() {
    const url = location.href;
    const title = document.title;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.toast("Link copied");
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") this.toast("Couldn't share. Copy the address from the address bar.");
    }
  }

  /** Theme changed: repaint what's coloured outside the canvas. */
  refreshColors() {
    this.dock.paint();
  }

  toast(text: string, ms = 3200, action?: { label: string; run: () => void }) {
    const t = $("toast");
    t.textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      b.addEventListener("click", () => {
        t.hidden = true;
        action.run();
      });
      t.append(b);
    }
    t.hidden = false;
    t.style.animation = "none";
    void t.offsetWidth; // restart the animation
    t.style.animation = "";
    clearTimeout((t as HTMLElement & { timer?: number }).timer);
    (t as HTMLElement & { timer?: number }).timer = window.setTimeout(() => (t.hidden = true), ms);
  }

  private hint() {
    const KEY = "railgaddi.hinted";
    const seen = () => {
      try {
        return !!localStorage.getItem(KEY);
      } catch {
        return false;
      }
    };
    if (seen()) return;
    setTimeout(() => {
      // only while the map is what you're looking at, and only once
      if (this.open || !this.origin || seen()) return;
      this.toast(narrow() ? "Tap a photo to explore a place" : "Click a photo to explore a place", 5000);
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* then it may show again next time */
      }
    }, 2600);
  }


  /** Swap panel content with a View Transition where the browser has one. */
  private transition(update: () => void) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !reducedMotion() && !this.panel.hidden) doc.startViewTransition(update);
    else update();
  }

  private sync(mode: "push" | "replace") {
    const o = this.open;
    const place = o && o.kind !== "list" ? o.place : null;
    go(
      {
        origin: this.origin ? this.slugs.of(this.origin) : undefined,
        place: place ? this.slugs.of(place) : undefined,
        train: o?.kind === "train" ? o.leg.train.no : undefined,
        within: this.filters.within,
        leave: this.filters.leave,
      },
      mode,
    );
  }

  /** Title and description for the current view (tabs, history, link previews). */
  private describe() {
    const o = this.open;
    const from = this.origin ? titleOf(this.origin, null) : null;
    let title = "Railgaddi · where can the train take you?";
    if (o?.kind === "train") title = `${o.leg.train.no} ${o.leg.train.name} · ${fmtTime(o.leg.dep)} · Railgaddi`;
    else if (o?.kind === "place") {
      const name = titleOf(o.place, this.guides.get(o.place));
      title = from ? `${name} by train from ${from} · Railgaddi` : `${name} by train: direct from ${plural(this.reach.size, "place")} · Railgaddi`;
    } else if (from) title = `Trains from ${from}: ${plural(this.reach.size, "place")} without changing · Railgaddi`;
    document.title = title;
  }

  private layout() {
    const vis = (el: HTMLElement) => !el.hidden && !el.classList.contains("leaving");
    const docked = !document.body.classList.contains("panel-open");
    const rects: DOMRect[] = [];
    for (const el of [this.hero, this.chip, docked ? this.dockEl : null, this.panel, document.querySelector<HTMLElement>(".topbar"), $("clock")]) {
      if (el && vis(el)) rects.push(el.getBoundingClientRect());
    }
    this.map.setSafeRects(rects.filter((r) => r.width && r.height));
    const open = !this.panel.hidden;
    if (narrow()) {
      const top = open ? 56 : this.heroShown ? this.hero.getBoundingClientRect().bottom + 4 : this.chip.getBoundingClientRect().bottom + 8;
      const bottom = open ? this.panel.getBoundingClientRect().height || window.innerHeight * 0.74 : this.origin ? this.dockEl.getBoundingClientRect().height + 24 : 16;
      this.map.setInsets({ top, right: 8, bottom, left: 8 });
    } else {
      const left = this.heroShown ? this.hero.getBoundingClientRect().right + 24 : 24;
      const bottom = this.origin && !open ? this.dockEl.getBoundingClientRect().height + 36 : 40;
      const top = this.heroShown ? 60 : this.chip.getBoundingClientRect().bottom + 12;
      this.map.setInsets({ top, right: open ? 460 : 40, bottom, left });
    }
  }

  private trackPin() {
    if (this.origin && !this.pin.hidden) {
      const p = this.map.screenOf(this.origin);
      if (p) this.pin.style.transform = `translate(${p[0] - 26}px, ${p[1] - 24}px)`;
    }
    requestAnimationFrame(() => this.trackPin());
  }
}
