// The controller: owns what's picked (where you start, the open place or train, the filters),
// turns that into map and panel updates, and keeps the address bar in step.
import { fmtMins, fmtTime, istNow, plural } from "../core/format";
import type { Network, Place } from "../core/network";
import type { ArticleDetail, GuideView, Photo, PlaceDetails } from "../core/places";
import { rankPlaces } from "../core/rank";
import { titleOf, type Slugs } from "../core/slugs";
import { ANY, bySoonest, departures, legPasses, reachable, type Destination, type Filters, type Leg } from "../core/trips";
import type { RailMap, SightPin } from "../map/map";
import { Dock } from "../ui/dock";
import { listHtml, type ListItem } from "../ui/list";
import { esc, placeHtml, scriptLine, trainHtml } from "../ui/panel";
import { SearchBox } from "../ui/search";
import { filtersOf, go, href, parse, type Route } from "./router";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const narrow = () => window.innerWidth <= 720;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Detail = { detail: ArticleDetail; photos: Map<string, Photo> };
type Open =
  | { kind: "place"; place: Place; showAll: boolean; sight: number; legs: Leg[] }
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
  private dock: Dock;

  constructor(
    private net: Network,
    private guides: Map<Place, GuideView>,
    private slugs: Slugs,
    private details: PlaceDetails,
    private map: RailMap,
  ) {
    for (const [p, gv] of guides) if (!this.titlePlace.has(gv.title) || p.isCity) this.titlePlace.set(gv.title, p);

    this.search = new SearchBox($("origin-input"), $("suggest"), $("popular"), net, () => guides, (p) => this.setOrigin(p, { push: true }));
    this.search.renderPopular((p) => href({ origin: slugs.of(p) }));
    this.dock = new Dock(
      this.dockEl,
      (f, settled) => this.setFilters(f, settled),
      () => (this.open?.kind === "list" ? this.closePanel({ push: false }) : this.openList()),
      (m) => map.timeColor(m),
    );

    map.hooks = {
      onPick: (p) => this.openPlace(p, { push: true }),
      onPickSight: (i) => this.pickSight(i, false),
      onHover: (p, x, y) => this.hover(p, x, y),
      onBackground: () => this.open && this.closePanel({ push: true }),
    };

    this.panel.addEventListener("click", (e) => this.onPanelClick(e));
    // photos fade in once loaded; broken ones step aside (no inline handlers, CSP-friendly)
    this.panel.addEventListener("load", (e) => (e.target as HTMLElement).tagName === "IMG" && (e.target as HTMLElement).classList.add("in"), true);
    this.panel.addEventListener("error", (e) => (e.target as HTMLElement).tagName === "IMG" && (e.target as HTMLElement).classList.add("broken"), true);
    $("chip-change").addEventListener("click", () => this.setOrigin(null, { push: true, focusSearch: true }));
    const brand = $("brand") as HTMLAnchorElement;
    brand.href = href({});
    brand.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the browser
      e.preventDefault();
      this.setOrigin(null, { push: true });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || document.activeElement?.id === "origin-input") return;
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
    this.layout();
    if (!this.origin && !this.open) this.map.fitIndia(0);
  }

  // ---------------------------------------------------------------- where you start

  setOrigin(p: Place | null, o: { push: boolean; fly?: boolean; animate?: boolean; focusSearch?: boolean }) {
    const keep = this.open?.kind === "place" ? this.open.place : null;
    this.origin = p;
    this.dests = p ? departures(this.net, p) : new Map();
    if (p) {
      this.hero.classList.add("leaving");
      setTimeout(() => this.origin && (this.hero.hidden = true), 450);
      $("chip-name").textContent = titleOf(p, null);
      $("chip-script").textContent = scriptLine(p);
      this.chip.hidden = false;
      this.dockEl.hidden = false;
      this.pin.hidden = true;
      requestAnimationFrame(() => (this.pin.hidden = false)); // restart the drop animation
      this.hint();
    } else {
      this.chip.hidden = true;
      this.dockEl.hidden = true;
      this.pin.hidden = true;
      this.hero.hidden = false;
      requestAnimationFrame(() => this.hero.classList.remove("leaving"));
    }
    this.refresh(o.animate ?? true);
    // decide now, not in the next frame: a caller (a shared link) may open a place right after this
    const reopen = !!(p && keep && keep !== p && this.dests.has(keep));
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

  private setFilters(f: Filters, settled: boolean) {
    this.filters = f;
    this.refresh(false);
    if (settled) {
      this.map.fitRoutes();
      this.sync("replace");
    }
  }

  /** Recompute what's reachable under the filters and hand it to the map. */
  private refresh(animate: boolean) {
    const now = istNow();
    const { trains, byPlace } = reachable(this.dests, this.filters, now);
    this.reach = byPlace;
    const reach = [...byPlace].map(([place, legs]) => ({ place, mins: Math.min(...legs.map((l) => l.dur)) }));
    this.map.setOrigin(this.origin, trains, reach, animate);
    this.map.setCandidates(rankPlaces(this.guides, this.origin ? byPlace : null));
    const withGuides = reach.filter((r) => this.guides.get(r.place)?.icon).length;
    $("count").innerHTML = !this.origin
      ? ""
      : !this.dests.size
        ? "No trains leave from here in the 2017 timetable."
        : trains.size
          ? `<b>${reach.length.toLocaleString("en-IN")}</b> places · <b>${trains.size}</b> trains${withGuides ? ` · ${withGuides} with guides` : ""}`
          : "No trains match. Try a wider window.";
    if (this.open?.kind === "place" || this.open?.kind === "list") this.renderPanel(false);
  }

  /** The route geometry arrived: redraw lines along the track. */
  networkDetailed() {
    this.map.refreshNetwork();
    this.refresh(false);
  }

  // ---------------------------------------------------------------- the panel

  openPlace(p: Place, o: { push: boolean }) {
    if (p === this.origin) return;
    this.tip.hidden = true;
    this.open = { kind: "place", place: p, showAll: false, sight: -1, legs: [] };
    this.map.select(p);
    this.map.selectTrain(null);
    this.map.showSights([]);
    this.transition(() => this.renderPanel(true));
    this.setPanelOpen(true);
    this.map.focusOn(p);
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
    this.open = null;
    this.setPanelOpen(false);
    this.dock.setListOpen(false);
    this.map.select(null);
    this.map.selectTrain(null);
    this.map.showSights([]);
    if (o.refit !== false && was && was.kind !== "list") {
      if (this.origin) this.map.fitRoutes();
      else this.map.fitIndia();
    }
    if (o.push) this.sync("push");
    this.describe();
  }

  private setPanelOpen(on: boolean) {
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
      const now = istNow();
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
      });
    }
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
      case "pick-origin":
        this.closePanel({ push: true });
        this.search.focus();
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
    const line = this.origin && legs?.length ? `${fmtMins(Math.min(...legs.map((l) => l.dur)))} · ${plural(legs.length, "train")}` : p.state || "";
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
      title = from ? `${name} by train from ${from} · Railgaddi` : `${name} by train · Railgaddi`;
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
      const top = open ? 56 : !this.origin ? this.hero.getBoundingClientRect().bottom + 4 : this.chip.getBoundingClientRect().bottom + 8;
      const bottom = open ? window.innerHeight * 0.74 : this.origin ? this.dockEl.getBoundingClientRect().height + 24 : 16;
      this.map.setInsets({ top, right: 8, bottom, left: 8 });
    } else {
      const left = !this.origin ? this.hero.getBoundingClientRect().right + 24 : 24;
      const bottom = this.origin && !open ? this.dockEl.getBoundingClientRect().height + 36 : 40;
      this.map.setInsets({ top: this.origin ? 80 : 60, right: open ? 460 : 40, bottom, left });
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
