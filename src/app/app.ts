// The controller: owns what's picked (where you start, the open place or train, the filters, the
// trip being planned), turns that into map and panel updates, and keeps the address bar in step.
// Everything happens in one panel beside the map (a sheet on phones): search at the top, below it
// the places you can reach, a place, a train, a trip.
import { fmtMins, fmtTime, istWeekMinute, plural } from "../core/format";
import { onMainLine, type Network, type Place, type Train } from "../core/network";
import { worthwhile, type ArticleDetail, type GuideView, type Photo, type PlaceDetails } from "../core/places";
import { ICONIC, rankPlaces, sameTown } from "../core/rank";
import { titleOf, type Slugs } from "../core/slugs";
import { nearestAirports, nearestStations, type Spot, type Spots } from "../core/spots";
import { planTrip, stopLatLon, stopName, type Plan, type Stop, type TripStop } from "../core/tripplan";
import { ANY, arrivals, bySoonest, connections, departures, legPasses, newerBetween, reachable, type Connection, type Destination, type Filters, type Kind, type Leave, type Leg } from "../core/trips";
import { forecast, grid, indiaGrid, valueOf, type Forecast, type GridPoint, type WeatherMode } from "../core/weather";
import type { RailMap, SightPin } from "../map/map";
import { exploreHtml, homeHtml, type ExploreItem } from "../ui/home";
import { esc, journeyHtml, placeHtml, scriptLine, trainHtml, type GetHere, type StopsOpen } from "../ui/panel";
import { openPosterSheet } from "../ui/poster";
import { savedHtml, type SavedPlace, type SavedRoute } from "../ui/saved";
import { spotHtml, type WayView } from "../ui/spot";
import { tripHtml, type TripStopView } from "../ui/trip";
import { legendHtml, weatherColor, weatherHtml, weatherLabel, weatherLine, weatherUnit } from "../ui/weather";
import { placeKey, routeKey, tripKey, type PlaceSave, type RouteSave, type TripSave } from "../core/saves";
import { Saves } from "./saves";
import discoverUrl from "../../data/discover.json?url";
import { records, type Record as TimetableRecord } from "../core/numbers";
import { discoverHtml, placeFactHtml, recordsHtml, storyHtml, type DiscoverData, type RideView, type Story } from "../ui/discover";
import { SearchBox } from "../ui/search";
import { filtersOf, go, href, parse, type Route } from "./router";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const narrow = () => window.innerWidth <= 720;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const POPULAR = ["bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad"];
const LAST = "railgaddi.last"; // the station you started from last time (on this device only)
const journeyKey = (c: Connection) => c.legs.map((l) => l.train.no).join("-");
/** Hill towns people ask about, none with a station of its own. */
const HILLS: [string, string][] = [["Munnar", "Kerala"], ["Manali", "Himachal Pradesh"], ["Kodaikanal", "Tamil Nadu"], ["Gangtok", "Sikkim"], ["Leh", "Ladakh"], ["Madikeri", "Karnataka"], ["Mussoorie", "Uttarakhand"], ["McLeod Ganj", "Himachal Pradesh"], ["Kasol", "Himachal Pradesh"], ["Tawang", "Arunachal Pradesh"]];
const IDEAS: [string, string][] = [["Hampi", "Boulders and temples"], ["Darjeeling", "Tea, and the toy train"], ["Varanasi", "The ghats at dawn"], ["Goa", "Beaches and old churches"]];
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Detail = { detail: ArticleDetail; photos: Map<string, Photo> };
type Summary = { text: string; photo: string | null; page: string };
type Open =
  | { kind: "place"; place: Place; showAll: boolean; sight: number; legs: Leg[]; allFrom?: boolean; choosing?: boolean }
  | { kind: "train"; place: Place; leg: Leg; stops: StopsOpen; journey?: Connection; fromTrip?: boolean }
  | { kind: "journey"; place: Place; conn: Connection }
  | { kind: "spot"; spot: Spot }
  | { kind: "saved" }
  | { kind: "discover"; fact: number; cat: string }
  | { kind: "story"; story: Story };

/** A date as YYYY-MM-DD, in India. */
function isoDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export class App {
  private mode: "explore" | "trip" = "explore";
  private origin: Place | null = null;
  private dests = new Map<Place, Destination>();
  private reach = new Map<Place, Leg[]>();
  private filters: Filters = { ...ANY };
  private open: Open | null = null;
  private list = { withGuides: true, showAll: false, famous: false }; // famous: most to see first, not nearest
  private placeScroll = 0; // where the place panel was scrolled when a train was opened from it
  private trainPushed = false;
  private detailCache = new Map<string, Detail>();
  private titlePlace = new Map<string, Place>();

  private side = $("side");
  private panel = $("panel");
  private tip = $("tip");
  private fromBox: SearchBox;
  private toBox: SearchBox;
  private returnFocus: HTMLElement | null = null;
  private depCache = new Map<Place, Map<Place, Destination>>();
  private arrCache = new Map<Place, Map<Place, Destination>>();
  private changeCache = new Map<string, Connection[]>();
  readonly saves = new Saves();
  private discoverData: DiscoverData | null = null;
  private discoverLoad: Promise<DiscoverData | null> | null = null;
  private timetableRecords: TimetableRecord[] | null = null;
  private factAt = -1; // where the facts deck is, so it resumes there
  private codeIndex = new Map<string, number>();

  // weather
  private weatherOn = false;
  private weatherMode: WeatherMode = "temp";
  private gridData: GridPoint[] | null = null;
  private gridCities: { place: Place; point: GridPoint }[] = [];
  private forecasts = new Map<string, Forecast | "loading" | "error">();
  private summaries = new Map<string, Summary | "loading" | null>();

  // the trip being planned
  private trip: { stops: TripStop[]; date: string; choice: number[] } = { stops: [], date: "", choice: [] };
  private plan: Plan | null = null;

  constructor(
    private net: Network,
    private guides: Map<Place, GuideView>,
    private slugs: Slugs,
    private details: PlaceDetails,
    private map: RailMap,
    private spots: Spots,
  ) {
    for (const [p, gv] of guides) if (!this.titlePlace.has(gv.title) || p.isCity) this.titlePlace.set(gv.title, p);
    for (const st of net.stations) this.codeIndex.set(st.code, st.i);

    const g = () => guides;
    const onTrain = (t: Train) => this.openTrainByNumber(t);
    this.fromBox = new SearchBox($("from-input"), $("from-list"), net, g, (p) => this.chooseFrom(p), {
      context: (p) => this.fromNote(p),
      suggestions: () => this.suggestFrom(),
      onTrain,
      spots: () => this.spots,
      onSpot: (s) => this.startNear(s),
      online: true,
    });
    this.toBox = new SearchBox($("to-input"), $("to-list"), net, g, (p) => this.chooseTo(p), {
      context: (p) => this.toNote(p),
      suggestions: () => this.suggestTo(),
      onTrain,
      spots: () => this.spots,
      onSpot: (s) => this.openSpot(s, { push: true }),
      online: true,
      empty: "No station, town or famous place by that name",
    });
    // typed before the timetable arrived: answer it now
    for (const id of ["from-input", "to-input"]) {
      const input = $<HTMLInputElement>(id);
      if (input.value.trim()) input.dispatchEvent(new Event("input"));
      input.addEventListener("focus", () => {
        input.select();
        if (narrow()) this.expandSheet(true);
      });
      // typed something and left without picking: put back what's picked; emptied it: clear that end
      input.addEventListener("change", () => {
        if (input.value.trim()) return this.syncChrome(true);
        // no start any more: a place you're looking at stays, now with every way into it
        if (id === "from-input" && this.origin) this.destination() ? this.setOrigin(null, { push: true }) : this.startOver(false);
        else if (id === "to-input" && this.open && ("place" in this.open || this.open.kind === "spot")) this.closePanel({ push: true });
      });
    }
    $("route").addEventListener("submit", (e) => e.preventDefault());
    $("near-btn").addEventListener("click", () => this.nearMe());
    $("swap-btn").addEventListener("click", () => this.swap());
    $("tab-explore").addEventListener("click", () => this.setMode("explore", true));
    $("tab-trip").addEventListener("click", () => this.setMode("trip", true));
    $("zoom-in").addEventListener("click", () => map.zoomBy(1.6));
    $("zoom-out").addEventListener("click", () => map.zoomBy(1 / 1.6));
    $("weather-btn").addEventListener("click", () => this.toggleWeather());
    $("wx-mode").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-v]");
      if (b) this.setWeatherMode(b.dataset.v as WeatherMode);
    });

    map.hooks = {
      // looking at the ways into a place: a click picks where you'd start from
      onPick: (p) => {
        if (this.mode === "trip") return this.addStop({ kind: "place", place: p });
        if (this.target() && p !== this.target()) this.setOrigin(p, { push: true });
        else this.openPlace(p, { push: true });
      },
      onPickSight: (i) => this.pickSight(i, false),
      onHover: (p, x, y) => this.hover(p, x, y),
      onBackground: () => this.mode === "explore" && this.open && this.closePanel({ push: true }),
    };

    this.panel.addEventListener("click", (e) => this.onPanelClick(e));
    this.panel.addEventListener("change", (e) => this.onPanelChange(e));
    $("saved-btn").addEventListener("click", () => (this.open?.kind === "saved" ? this.closePanel({ push: false }) : this.openSaved()));
    $("discover-btn").addEventListener("click", () =>
      this.open?.kind === "discover" || this.open?.kind === "story" ? this.closePanel({ push: true }) : this.openDiscover(null, { push: true }),
    );
    // Discover is small (~35 kB); fetch it once things are quiet, for the facts on places
    const idle = (window as Window & { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
    idle(() => this.loadDiscover().then(() => {
      if (!this.open || this.open.kind === "place") this.renderPanel(false);
    }));
    this.saves.on(() => this.savesChanged());
    this.savesChanged();
    this.saves.init();
    // photos fade in once loaded; broken ones step aside (no inline handlers, CSP-friendly)
    this.panel.addEventListener("load", (e) => (e.target as HTMLElement).tagName === "IMG" && (e.target as HTMLElement).classList.add("in"), true);
    this.panel.addEventListener("error", (e) => (e.target as HTMLElement).tagName === "IMG" && (e.target as HTMLElement).classList.add("broken"), true);
    const brand = $("brand") as HTMLAnchorElement;
    brand.href = href({});
    brand.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the browser
      e.preventDefault();
      this.setMode("explore", false);
      this.startOver(false);
    });
    document.addEventListener("keydown", (e) => {
      // "/" to search, as on most sites
      if (e.key === "/" && !(document.activeElement as HTMLElement | null)?.matches("input, textarea, select") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (this.mode === "trip") this.panel.querySelector<HTMLInputElement>("#trip-input")?.focus();
        else (this.origin ? this.toBox : this.fromBox).focus();
        return;
      }
      if (e.key !== "Escape" || (document.activeElement as HTMLElement | null)?.matches("input")) return;
      if (this.open?.kind === "train" || this.open?.kind === "journey") this.back();
      else if (this.open) this.closePanel({ push: true });
    });
    window.addEventListener("popstate", () => this.applyRoute(parse(), false));
    window.addEventListener("resize", () => this.settle());
    this.setupGrip();
  }

  // ---------------------------------------------------------------- the timetable arriving

  private waiting: (() => void) | null = null;

  /**
   * Run now if the timetable is here; otherwise once it is. The landing page doesn't wait for it,
   * so on a slow connection someone may pick a station first: say so, and carry on when it comes.
   */
  private whenReady(fn: () => void) {
    if (this.net.ready) return fn();
    this.waiting = fn; // the last thing asked for
    document.body.classList.add("waiting");
    this.toast("Loading the timetable…", 120000);
  }

  timetableReady() {
    document.body.classList.remove("waiting");
    this.depCache.clear();
    this.arrCache.clear();
    this.changeCache.clear();
    const fn = this.waiting;
    this.waiting = null;
    if (fn) {
      $("toast").hidden = true;
      fn();
    } else if (this.open?.kind === "spot") this.roadsReady(); // its stations: main-line ones, now they're known
    else if (!this.open || this.open.kind === "place") this.refresh(false);
  }

  /** The real roads to places without a station arrived: show them where they're on screen. */
  roadsReady() {
    if (this.open?.kind === "spot") {
      const s = this.open.spot;
      this.map.setSpot(s, this.spotWays(s, false).map((w) => ({ place: this.net.places.get(w.placeId)!, label: `${w.station} · ${fmtMins(w.roadMins)}` })));
      this.renderPanel(false);
    } else if (this.mode === "trip") {
      this.replan();
      this.renderPanel(false);
    }
  }

  /** An address that only needs the stations: a place without a station, nowhere to start from. */
  spotOnly(r: Route) {
    return !r.origin && !!r.place && !this.slugs.find(r.place) && !!this.spotOf(r.place, r.at);
  }

  /** Put the app in the state an address describes (first load, back/forward). */
  applyRoute(r: Route, first: boolean) {
    if (!this.net.ready && (r.origin || (r.place && !this.spotOnly(r)) || r.trip || r.discover !== undefined)) {
      return this.whenReady(() => this.applyRoute(r, first));
    }
    // measure the panel (the sheet, on phones) before framing anything on the map: a shared link
    // to a place must show the place, not leave it under the sheet
    if (first) this.settle();
    if (r.discover !== undefined) {
      // Discover leaves the map as it is: where you start stays where you start
      this.setMode("explore", false);
      this.openDiscover(r.discover || null, { push: false });
      return;
    }
    if (r.trip) {
      const missing: string[] = [];
      const stops = r.trip.stops.flatMap((slug, i): TripStop[] => {
        const stop = this.stopOf(slug);
        if (!stop) missing.push(slug);
        return stop ? [{ stop, nights: r.trip!.nights[i] ?? 0 }] : [];
      });
      this.trip = { stops, date: r.trip.date || this.trip.date || this.defaultDate(), choice: [] };
      this.setMode("trip", false);
      if (missing.length) this.toast(`Couldn't find ${missing.map((m) => `“${m.replace(/-/g, " ")}”`).join(", ")}.`, 5000);
      return;
    }
    if (this.mode !== "explore") this.setMode("explore", false, false);
    this.filters = filtersOf(r);
    const origin = (r.origin && this.slugs.find(r.origin)) || null;
    const place = (r.place && this.slugs.find(r.place)) || null;
    const spot = !place && r.place ? this.spotOf(r.place, r.at) : null;
    // the address says what's open: don't carry the current place across (back, forward, links)
    if (origin !== this.origin) this.setOrigin(origin, { push: false, fly: !place && !spot, animate: true, keep: false });
    else this.refresh(false);
    const o = this.open;
    const here = !!(place && o && "place" in o && o.place === place);
    if (spot) {
      if (!(o?.kind === "spot" && o.spot === spot)) this.openSpot(spot, { push: false });
    } else if (place && place !== origin) {
      const conn = r.journey ? this.changesShown(place).find((c) => journeyKey(c) === r.journey) : undefined;
      if (here && !r.train && !r.journey && o!.kind !== "place") {
        this.showPlace(place); // browser back from a train or a journey: the place, where you left it
      } else if (here && conn && !r.train && o!.kind === "train" && o!.journey) {
        this.back({ push: false }); // back from one of a journey's trains
      } else {
        if (!here || o!.kind !== "place") this.openPlace(place, { push: false });
        if (conn) {
          this.openJourney(conn, { push: false });
          const leg = r.train ? conn.legs.find((l) => l.train.no === r.train) : undefined;
          if (leg) this.openTrain(leg, { push: false }, conn);
        } else {
          const leg = r.train && this.dests.get(place)?.legs.find((l) => l.train.no === r.train);
          if (leg) this.openTrain(leg, { push: false });
        }
      }
    } else if (this.open) {
      this.closePanel({ push: false, refit: !first });
    }
    if (first) this.layout();
    const missing = (r.origin && !origin ? r.origin : null) ?? (r.place && !place && !spot ? r.place : null);
    if (missing) {
      // an old or mistyped link: say so, and show the address of what we could open
      this.toast(`Couldn't find “${missing.replace(/-/g, " ")}”. Try the search.`, 5000);
      this.sync("replace");
    }
    this.syncChrome();
    this.describe();
  }

  /** Re-measure the UI around the map (after first paint, fonts, resizes); on the landing view, refit India. */
  settle() {
    this.map.resize(); // the window changed: know the new size before framing anything
    this.layout();
    if (!this.origin && !this.open && !this.trip.stops.length) this.map.fitIndia(0);
  }

  // ---------------------------------------------------------------- explore or plan

  private setMode(mode: "explore" | "trip", push: boolean, render = true) {
    if (mode === "trip" && !this.net.ready) return this.whenReady(() => this.setMode(mode, push, render));
    const was = this.mode;
    this.mode = mode;
    $("tab-explore").setAttribute("aria-selected", String(mode === "explore"));
    $("tab-trip").setAttribute("aria-selected", String(mode === "trip"));
    $("route").hidden = mode === "trip";
    document.body.classList.toggle("trip-mode", mode === "trip");
    if (mode === "trip") {
      if (was !== "trip") {
        this.open = null;
        this.map.select(null);
        this.map.selectTrain(null);
        this.map.showSights([]);
        this.map.setSpot(null);
        // start from what you were looking at
        if (!this.trip.stops.length && this.origin) this.trip.stops.push({ stop: { kind: "place", place: this.origin }, nights: 0 });
        if (!this.trip.date) this.trip.date = this.defaultDate();
      }
      this.replan();
      if (render) this.renderPanel(true);
      this.fitTrip();
    } else {
      this.map.setTrip(null);
      if (render && was === "trip") {
        this.refresh(false);
        this.renderPanel(true);
        if (this.origin) this.map.fitRoutes();
      }
    }
    this.layout();
    if (push) this.sync("push");
    this.describe();
  }

  // ---------------------------------------------------------------- where you start

  setOrigin(p: Place | null, o: { push: boolean; fly?: boolean; animate?: boolean; focusSearch?: boolean; keep?: boolean }) {
    if (p && !this.net.ready) return this.whenReady(() => this.setOrigin(p, o));
    // the place you were looking at stays open: now with the trains from where you start
    const keep = o.keep === false ? null : this.destination();
    this.origin = p;
    if (p) {
      this.remember(p);
      this.hint();
    }
    this.refresh(o.animate ?? true);
    // decide now, not in the next frame: a caller (a shared link) may open a place right after this
    const reopen = !!(keep && keep !== p);
    if (!reopen && this.open && this.open.kind !== "spot") this.closePanel({ push: false, refit: false });
    else if (!this.open) this.renderPanel(true);
    requestAnimationFrame(() => {
      this.layout();
      if (reopen) this.openPlace(keep!, { push: false });
      else if (this.open?.kind === "spot") this.openSpot(this.open.spot, { push: false });
      else if (p && o.fly !== false) this.map.flyToOrigin();
      else if (!p) this.map.fitIndia();
      if (o.focusSearch) this.fromBox.focus();
    });
    if (o.push) this.sync("push");
    this.describe();
  }

  /** Back to the start: nothing picked. */
  private startOver(focus = true) {
    if (this.open) this.closePanel({ push: false, refit: false });
    this.setOrigin(null, { push: true, focusSearch: focus && !narrow() });
  }

  private chooseFrom(p: Place) {
    if (!this.net.ready) return this.whenReady(() => this.chooseFrom(p));
    if (this.mode === "trip") this.setMode("explore", false, false);
    if (p === this.destination()) this.closePanel({ push: false, refit: false }); // "from" the place you were looking at
    this.setOrigin(p, { push: true });
  }

  private chooseTo(p: Place) {
    if (!this.net.ready) return this.whenReady(() => this.chooseTo(p));
    if (this.mode === "trip") this.setMode("explore", false, false);
    if (p === this.origin) {
      this.toast(`That's where you start. Pick somewhere to go.`);
      return this.syncChrome(true);
    }
    this.openPlace(p, { push: true });
  }

  /** "From Munnar": the best station near it. */
  private startNear(s: Spot) {
    const best = this.nearestFor(s);
    if (!best) return this.toast(`No station with trains near ${s.name}.`);
    this.toast(`${s.name} has no station: starting from ${this.name(best.place)}, about ${best.road.km} km away`, 4500);
    this.chooseFrom(best.place);
  }

  /** The station to start from for a place without one: the best main-line one near it. */
  private nearestFor(s: Spot) {
    return nearestStations(this.net, s, 1, (p) => this.mainLine(p))[0] ?? nearestStations(this.net, s, 1)[0];
  }

  /** From ⇄ To. */
  private swap() {
    const dest = this.destination();
    const o = this.origin;
    if (this.open?.kind === "spot") {
      // from a place without a station: from the station you'd take the road to, back to where you were
      const s = this.open.spot;
      const best = this.nearestFor(s);
      if (!best) return this.toast(`No station with trains near ${s.name}.`);
      this.toast(`${s.name} has no station: starting from ${this.name(best.place)}, about ${best.road.km} km away`, 4500);
      this.closePanel({ push: false, refit: false });
      this.setOrigin(best.place, { push: !o || o === best.place, keep: false });
      if (o && o !== best.place) this.openPlace(o, { push: true });
      return;
    }
    if (o && dest) {
      this.setOrigin(dest, { push: false, keep: false });
      this.openPlace(o, { push: true });
    } else if (o) {
      this.setOrigin(null, { push: false, keep: false });
      this.openPlace(o, { push: true });
    } else if (dest) {
      this.closePanel({ push: false, refit: false });
      this.setOrigin(dest, { push: true });
    }
  }

  /** The place whose ways in the map shows: open, with no start picked. */
  private target(): Place | null {
    return this.origin ? null : this.destination();
  }

  /** The place you're looking at, with or without a start. */
  private destination(): Place | null {
    return this.open && "place" in this.open ? this.open.place : null;
  }

  private departuresFrom(p: Place) {
    let d = this.depCache.get(p);
    if (!d) this.depCache.set(p, (d = departures(this.net, p)));
    if (this.depCache.size > 8) this.depCache.delete(this.depCache.keys().next().value!);
    return d;
  }

  private arrivalsTo(p: Place) {
    let d = this.arrCache.get(p);
    if (!d) this.arrCache.set(p, (d = arrivals(this.net, p)));
    if (this.arrCache.size > 8) this.arrCache.delete(this.arrCache.keys().next().value!);
    return d;
  }

  private name(p: Place) {
    return titleOf(p, this.guides.get(p));
  }

  /** Ways from where you start to `dest` with one change (cached per pair). */
  private changesFor(dest: Place, from = this.origin): Connection[] {
    if (!from || dest === from) return [];
    const key = `${from.id}>${dest.id}`;
    let c = this.changeCache.get(key);
    if (!c) {
      c = connections(this.departuresFrom(from), this.arrivalsTo(dest), from, dest);
      this.changeCache.set(key, c);
      if (this.changeCache.size > 30) this.changeCache.delete(this.changeCache.keys().next().value!);
    }
    return c;
  }

  /** Changes worth showing on a place: all when there's no direct train, else only much quicker ones. */
  private changesShown(dest: Place): Connection[] {
    const direct = this.dests.get(dest);
    if (!direct) return this.changesFor(dest);
    // a change only beats a direct train on long rides (and working it out takes a moment)
    if (direct.fastest < 360) return [];
    const all = this.changesFor(dest);
    const cutoff = direct.fastest * 0.8 - 60;
    return all.filter((c) => c.total < cutoff).slice(0, 3);
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
    return rankPlaces(this.guides, this.reach, this.origin, this.net).slice(0, 6).map((c) => c.place);
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
        guide: worthwhile(gv) && gv.title !== home,
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
  }

  private lastOrigin(): Place | null {
    try {
      const id = localStorage.getItem(LAST);
      return (id && this.net.places.get(id)) || null;
    } catch {
      return null;
    }
  }

  /** A place worth the ride, within the filters: famous ones more likely, never the same twice running. */
  private surprise() {
    const home = this.origin ? this.guides.get(this.origin)?.title : undefined;
    const pool = [...this.reach.keys()]
      .map((p) => ({ p, gv: this.guides.get(p) }))
      .filter(({ p, gv }) => worthwhile(gv) && gv.icon && gv.title !== home && p !== this.destination() && !sameTown(this.origin, p, this.net));
    if (!pool.length) return this.toast("Nothing with a guide within these filters. Try a longer ride.");
    const weight = (x: (typeof pool)[number]) => Math.sqrt(1 + x.gv!.entry.appeal);
    let r = Math.random() * pool.reduce((a, x) => a + weight(x), 0);
    const pick = pool.find((x) => (r -= weight(x)) <= 0) ?? pool[0];
    this.openPlace(pick.p, { push: true });
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

  /** The fields and buttons around the panel: what they show follows what's picked. */
  private syncChrome(force = false) {
    const from = $<HTMLInputElement>("from-input");
    const to = $<HTMLInputElement>("to-input");
    const o = this.open;
    const destName = o?.kind === "spot" ? o.spot.name : this.destination() ? this.name(this.destination()!) : "";
    if (force || document.activeElement !== from) from.value = this.origin ? titleOf(this.origin, null) : "";
    if (force || document.activeElement !== to) to.value = destName;
    $("near-btn").hidden = !!this.origin;
    document.body.classList.toggle("to-mode", !!this.target());
    $("discover-btn").setAttribute("aria-pressed", String(o?.kind === "discover" || o?.kind === "story"));
    $("saved-btn").setAttribute("aria-pressed", String(o?.kind === "saved"));
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
    this.reachTrains = trains.size;
    const reach = [...byPlace].map(([place, legs]) => ({ place, mins: Math.min(...legs.map((l) => l.dur)) }));
    this.map.setOrigin(hub, trains, reach, animate, !this.origin && !!target);
    this.map.setCandidates(rankPlaces(this.guides, hub ? byPlace : null, hub, this.net));
    this.syncChrome();
    if (render && this.mode === "explore" && (!this.open || this.open.kind === "place")) this.renderPanel(false);
    if (this.weatherOn) this.paintWeather();
  }
  private reachTrains = 0;

  /** The route geometry arrived: redraw lines along the track. */
  networkDetailed() {
    this.map.refreshNetwork();
    this.refresh(false);
    if (this.mode === "trip") this.drawTrip();
  }

  // ---------------------------------------------------------------- the panel

  openPlace(p: Place, o: { push: boolean }) {
    if (!this.net.ready) return this.whenReady(() => this.openPlace(p, o));
    if (p === this.origin) return;
    if (this.mode === "trip") this.setMode("explore", false, false);
    if (!this.open) this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this.tip.hidden = true;
    const before = this.target();
    this.open = { kind: "place", place: p, showAll: false, sight: -1, legs: [] };
    this.map.setSpot(null);
    this.map.select(p);
    this.map.selectTrain(null);
    this.map.showSights([]);
    this.map.setSelectedTitle(this.name(p));
    this.map.hintJourney(this.origin && !this.dests.has(p) ? this.changesFor(p)[0]?.legs ?? [] : []);
    // no start picked: the map turns to show every way into this place
    if (!this.origin) this.refresh(before !== p, false);
    this.renderPanel(true);
    this.syncChrome();
    if (narrow()) this.expandSheet(false); // half the screen for the place, half for the map
    if (this.origin) this.map.focusOn(p);
    else requestAnimationFrame(() => this.map.fitCore());
    if (o.push) this.sync("push");
    this.describe();
  }

  private openTrain(leg: Leg, o: { push: boolean }, journey?: Connection, fromTrip = false) {
    if (!fromTrip && (!this.open || !("place" in this.open))) return;
    if (this.open?.kind === "place") this.placeScroll = this.panel.querySelector(".panel-scroll")?.scrollTop ?? 0;
    this.trainPushed = o.push;
    const place = fromTrip ? this.net.placeOf[leg.train.st[leg.to]] : (this.open as { place: Place }).place;
    this.open = { kind: "train", place, leg, stops: { before: false, after: false }, journey, fromTrip };
    this.map.selectTrain(leg);
    this.map.showSights([]);
    this.renderPanel(true);
    this.map.focusLeg(leg);
    if (o.push) this.sync("push");
    this.describe();
  }

  /** One journey with a change: both trains, the change between them, drawn on the map. */
  private openJourney(conn: Connection, o: { push: boolean }) {
    if (!this.open || !("place" in this.open)) return;
    if (this.open.kind === "place") this.placeScroll = this.panel.querySelector(".panel-scroll")?.scrollTop ?? 0;
    this.trainPushed = o.push;
    this.open = { kind: "journey", place: this.open.place, conn };
    this.map.selectJourney(conn.legs);
    this.map.showSights([]);
    this.renderPanel(true);
    this.map.focusLeg(conn.legs);
    if (o.push) this.sync("push");
    this.describe();
  }

  private back(o = { push: true }) {
    if (this.open?.kind !== "train" && this.open?.kind !== "journey") return;
    if (this.open.kind === "train" && this.open.fromTrip) {
      this.open = null;
      this.map.selectTrain(null);
      this.setMode("trip", false);
      return;
    }
    if (o.push && this.trainPushed) {
      history.back(); // we came from the place: step back rather than stacking another entry
      return;
    }
    if (this.open.kind === "train" && this.open.journey) {
      this.open = { kind: "journey", place: this.open.place, conn: this.open.journey };
      this.map.selectJourney(this.open.conn.legs);
      this.renderPanel(true);
      this.map.focusLeg(this.open.conn.legs);
      if (o.push) this.sync("push");
      this.describe();
      return;
    }
    this.showPlace(this.open.place);
    if (o.push) this.sync("push");
  }

  /** Back to a place's own view from one of its trains or journeys, scrolled where you left it. */
  private showPlace(place: Place) {
    this.map.selectTrain(null);
    this.open = { kind: "place", place, showAll: false, sight: -1, legs: [] };
    this.renderPanel(true, this.placeScroll);
    this.placeScroll = 0;
    this.map.focusOn(place);
    this.describe();
  }

  // ---------------------------------------------------------------- places without a station

  /** A place without a station from an address: our list, or one found online (its position rides along). */
  private spotOf(slug: string, at?: string): Spot | null {
    const s = this.spots.find(slug);
    if (s) return s;
    if (!at) return null;
    const [lat, lon] = at.split(",").map(Number);
    const name = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return this.spots.adopt({ id: "", name, state: "", lat, lon, pop: 0, popShown: false, aka: [], local: "", roads: null, fromSearch: true }, (x) => !!this.slugs.find(x));
  }

  private stopOf(slug: string): Stop | null {
    const p = this.slugs.find(slug);
    if (p) return { kind: "place", place: p };
    const s = this.spots.find(slug);
    return s ? { kind: "spot", spot: s } : null;
  }

  openSpot(spot: Spot, o: { push: boolean }) {
    if (this.mode === "trip") return this.addStop({ kind: "spot", spot });
    const s = spot.fromSearch && !spot.id ? this.spots.adopt(spot, (x) => !!this.slugs.find(x)) : spot;
    if (!this.open) this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this.open = { kind: "spot", spot: s };
    this.map.select(null);
    this.map.selectTrain(null);
    this.map.showSights([]);
    this.map.hintJourney([]);
    // the ways with a change take a moment to work out: show the direct ones first
    const ways = this.spotWays(s, false);
    this.spotQuick = s;
    this.map.setSpot(s, ways.map((w) => ({ place: this.net.places.get(w.placeId)!, label: `${w.station} · ${fmtMins(w.roadMins)}` })));
    if (narrow()) this.expandSheet(false);
    this.map.focusPoints([s], ways.map((w) => this.net.places.get(w.placeId)!).filter(Boolean), 16);
    this.loadSummary(s);
    this.renderPanel(true);
    if (this.origin) {
      const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 50));
      idle(() => {
        if (this.spotQuick !== s) return;
        this.spotQuick = null;
        if (this.open?.kind === "spot" && this.open.spot === s) this.renderPanel(false);
      }, { timeout: 400 });
    } else this.spotQuick = null;
    this.syncChrome();
    if (o.push) this.sync("push");
    this.describe();
  }

  private spotQuick: Spot | null = null; // a place without a station just opened: its ways with a change come next

  /** The stations to take a train to for a place without one; from where you start, the whole way, quickest first. */
  private spotWays(s: { lat: number; lon: number; roads?: Spot["roads"] }, withChanges = true, accept?: (p: Place) => boolean): WayView[] {
    const origin = this.origin;
    // a hill railway's halts (Joginder Nagar for Kasol) aren't where anyone changes to the road:
    // main-line stations, unless there are none
    const main = nearestStations(this.net, s, 4, accept ?? ((p) => this.mainLine(p)));
    const ways = (main.length ? main : nearestStations(this.net, s, 4, accept)).map((c): WayView => {
      let train: WayView["train"] = null;
      if (origin && origin !== c.place) {
        const d = this.departuresFrom(origin).get(c.place);
        if (d) train = { mins: d.fastest, trains: new Set(d.legs.map((l) => l.train)).size };
        else if (withChanges || this.changeCache.has(`${origin.id}>${c.place.id}`)) {
          const best = this.changesFor(c.place, origin)[0];
          if (best) train = { mins: best.total, trains: 0, change: this.name(best.via) };
        }
      } else if (origin === c.place) train = { mins: 0, trains: 0 };
      return {
        station: titleOf(c.place, null), // the name on the ticket: Angamali, not Kalady
        code: this.net.stations[c.place.anchor].code,
        placeId: c.place.id,
        href: href({ origin: origin ? this.slugs.of(origin) : undefined, place: this.slugs.of(c.place) }),
        roadKm: c.road.km,
        roadMins: c.road.mins,
        train,
        total: origin ? (train ? train.mins + (train.mins ? 30 : 0) + c.road.mins : null) : null,
      };
    });
    if (origin) ways.sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity));
    return origin ? ways.filter((w) => w.total !== null).concat(ways.filter((w) => w.total === null)) : ways;
  }

  /** Does any train other than a hill railway's toy train stop here? */
  private mainLine(p: Place) {
    return onMainLine(this.net, p);
  }

  /**
   * No direct train from where you start (Darjeeling from Mysuru): the way most people go, a
   * train to a main-line station near it and then the road, when that beats any change of trains.
   */
  private roadWays(place: Place): WayView[] {
    if (!this.origin || place.lat === null || place.lon === null) return [];
    const ways = this.spotWays({ lat: place.lat, lon: place.lon }, true, (p) => p !== place && p.halts >= 6 && this.mainLine(p))
      .filter((w) => w.total !== null && w.train && w.train.mins > 0);
    const best = this.changesShown(place)[0]?.total ?? Infinity;
    if (!ways.length || ways[0].total! >= best) return [];
    return ways.filter((w) => w.total! <= ways[0].total! * 1.4 + 120).slice(0, 3); // not the long way round
  }

  /** A short description and a photo, from Wikipedia (only the place's name is sent). */
  private loadSummary(s: Spot) {
    if (this.summaries.has(s.id)) return;
    this.summaries.set(s.id, "loading");
    const done = (v: Summary | null) => {
      this.summaries.set(s.id, v);
      if (this.open?.kind === "spot" && this.open.spot === s) this.renderPanel(false);
    };
    const q = `${s.name} ${s.state}`.trim();
    fetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?${new URLSearchParams({ q, limit: "3" })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (d: { pages?: { key: string; title: string }[] } | null) => {
        // the article named for the place (not a list, not a district of the same name first)
        const first = s.name.toLowerCase().split(/[\s(]/)[0];
        const page = d?.pages?.find((p) => p.title.toLowerCase().includes(first));
        if (!page) return done(null);
        const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`);
        if (!r.ok) return done(null);
        const sum = (await r.json()) as { extract?: string; thumbnail?: { source: string }; originalimage?: { source: string; width: number }; content_urls?: { desktop: { page: string } }; type?: string };
        if (sum.type === "disambiguation" || !sum.extract) return done(null);
        // Wikimedia serves thumbnails in a few standard widths only: 960 is sharp in the panel
        const photo = sum.thumbnail?.source ? sum.thumbnail.source.replace(/\/\d+px-/, "/960px-") : null;
        done({ text: sum.extract, photo: photo && sum.originalimage && sum.originalimage.width <= 960 ? sum.originalimage.source : photo, page: sum.content_urls?.desktop.page ?? `https://en.wikipedia.org/wiki/${page.key}` });
      })
      .catch(() => done(null));
  }

  // ---------------------------------------------------------------- saved, discover

  /** Saved: the bucket list, routes and trips, and the account that keeps them. */
  private openSaved() {
    if (this.mode === "trip") this.setMode("explore", false, false);
    if (!this.open) this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this.open = { kind: "saved" };
    this.map.select(null);
    this.map.selectTrain(null);
    this.map.showSights([]);
    this.map.setSpot(null);
    this.renderPanel(true);
    this.syncChrome();
  }

  private savedView() {
    const places: SavedPlace[] = this.saves.live("place").map((s) => {
      const d = s.data as PlaceSave;
      const p = this.slugs.find(d.slug);
      const spot = p ? null : this.spots.find(d.slug);
      const gv = p ? this.guides.get(p) : undefined;
      const reach = p && this.origin ? this.departuresFrom(this.origin).get(p) : undefined;
      return {
        key: s.key,
        slug: d.slug,
        title: p ? this.name(p) : d.title,
        state: p?.state ?? d.state ?? "",
        photo: gv?.icon ?? null,
        href: p || spot ? href({ origin: this.origin ? this.slugs.of(this.origin) : undefined, place: d.slug }) : null,
        note: reach ? `${fmtMins(reach.fastest)} from ${titleOf(this.origin!, null)}` : spot ? "No station: see the ways there" : "",
      };
    });
    const routes: SavedRoute[] = this.saves.live("route").map((s) => {
      const d = s.data as RouteSave;
      const a = this.slugs.find(d.from);
      const b = this.slugs.find(d.to);
      const direct = a && b ? this.departuresFrom(a).get(b) : undefined;
      const note = d.journey
        ? `With one change · trains ${d.journey.replace("-", " and ")}`
        : direct
          ? `${fmtMins(direct.fastest)} · ${plural(new Set(direct.legs.map((l) => l.train)).size, "direct train")}`
          : "No direct train: open for ways with a change";
      return { key: s.key, from: a ? titleOf(a, null) : d.fromTitle, to: b ? this.name(b) : d.toTitle, note, href: a && b ? href({ origin: d.from, place: d.to, journey: d.journey }) : null };
    });
    const trips: SavedRoute[] = this.saves.live("trip").map((s) => {
      const d = s.data as TripSave;
      const nights = d.nights.reduce((a, b) => a + b, 0);
      return { key: s.key, from: d.title, to: "", note: `${plural(d.stops.length, "stop")}${nights ? ` · ${plural(nights, "night")}` : ""}${d.date ? ` · from ${this.dayLabel(d.date)}` : ""}`, href: href({ trip: { stops: d.stops, nights: d.nights, date: d.date } }) };
    });
    return { places, routes: [...trips, ...routes], account: this.saves.account, canSignIn: !!this.saves.clientId };
  }

  /** The save for the route from where you start to `place` (and the journey, if it's one). */
  private routeSave(place: Place, conn?: Connection): { key: string; kind: "route"; data: RouteSave } {
    const data: RouteSave = {
      from: this.slugs.of(this.origin!),
      to: this.slugs.of(place),
      fromTitle: titleOf(this.origin!, null),
      toTitle: this.name(place),
      ...(conn ? { journey: journeyKey(conn) } : {}),
    };
    return { key: routeKey(data), kind: "route", data };
  }

  /** Saves changed (here, in another tab, or from the account): the heart's count, and the panel. */
  private savesChanged() {
    const n = this.saves.live().length;
    const count = $("saved-count");
    count.hidden = !n;
    count.textContent = n > 99 ? "99+" : String(n);
    const btn = $("saved-btn");
    btn.classList.toggle("has", n > 0);
    btn.setAttribute("aria-label", n ? `Saved: ${plural(n, "item")}` : "Saved");
    const k = this.open?.kind;
    if (k === "saved" || k === "place" || k === "journey" || k === "spot" || this.mode === "trip") this.renderPanel(false);
  }

  private loadDiscover() {
    this.discoverLoad ??= fetch(discoverUrl)
      .then((r) => (r.ok ? (r.json() as Promise<DiscoverData>) : null))
      .then((d) => (this.discoverData = d))
      .catch(() => {
        this.discoverLoad = null; // try again next time
        return null;
      });
    return this.discoverLoad;
  }

  /** Discover (journeys, facts, records), or one journey's story. */
  private async openDiscover(slug: string | null, o: { push: boolean }) {
    if (!this.net.ready) return this.whenReady(() => this.openDiscover(slug, o));
    const d = await this.loadDiscover();
    if (!d) return this.toast("Couldn't load Discover. Check your connection.");
    if (this.mode === "trip") this.setMode("explore", false, false);
    if (!this.open) this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const story = slug ? d.stories.find((s) => s.slug === slug) : undefined;
    if (slug && !story) this.toast("That story isn't here any more.");
    if (this.factAt < 0) this.factAt = Math.floor(Math.random() * d.facts.length);
    const cat = this.open?.kind === "discover" ? this.open.cat : "All";
    this.open = story ? { kind: "story", story } : { kind: "discover", fact: this.factAt, cat };
    this.map.select(null);
    this.map.selectTrain(null);
    this.map.showSights([]);
    this.map.setSpot(null);
    this.renderPanel(true);
    this.syncChrome();
    if (o.push) this.sync("push");
    this.describe();
  }

  private placeOfCode(code: string) {
    const i = this.codeIndex.get(code);
    return i === undefined ? null : this.net.placeOf[i];
  }

  /** A story's rides, resolved to places and how long they take. */
  private rideViews(s: Story): RideView[] {
    return s.rides.flatMap((r, i) => {
      const a = this.placeOfCode(r.from);
      const b = this.placeOfCode(r.to);
      if (!a || !b) return [];
      const d = this.departuresFrom(a).get(b);
      const legs = r.train ? d?.legs.filter((l) => l.train.no === r.train) : d?.legs;
      const note = legs?.length
        ? r.train
          ? `${legs[0].train.no} ${legs[0].train.name} · ${fmtMins(legs[0].dur)}`
          : `${fmtMins(Math.min(...legs.map((l) => l.dur)))} · ${plural(new Set(legs.map((l) => l.train)).size, "direct train")}`
        : "With one change";
      return [{ label: r.label, note, i, href: href({ origin: this.slugs.of(a), place: this.slugs.of(b), train: legs?.length && r.train ? r.train : undefined }) }];
    });
  }

  /** The facts about a set of stations (a place, a story's rides). */
  private factsAt(codes: string[], max: number) {
    const want = new Set(codes);
    return (this.discoverData?.facts ?? []).filter((f) => f.stations?.some((c) => want.has(c))).slice(0, max);
  }

  private placeFact(p: Place) {
    const f = this.factsAt(p.stations.map((s) => this.net.stations[s].code), 1)[0];
    return f ? placeFactHtml(f, this.discoverData!.facts.indexOf(f) + 1, this.discoverData!.facts.length) : "";
  }

  /** A train found by number or name: its whole run, from its first station to its last. */
  private openTrainByNumber(t: Train) {
    const a = this.net.placeOf[t.st[0]];
    let b = this.net.placeOf[t.st[t.st.length - 1]];
    for (let j = t.st.length - 2; b === a && j > 0; j--) b = this.net.placeOf[t.st[j]]; // a round trip: its far end
    this.goRoute({ origin: this.slugs.of(a), place: this.slugs.of(b), train: t.no });
  }

  /** Follow a link inside the app to a route. */
  private goRoute(r: Route) {
    this.applyRoute({ ...r, within: this.filters.within, leave: this.filters.leave, kind: this.filters.kind }, false);
    this.sync("push");
  }

  closePanel(o: { push: boolean; refit?: boolean }) {
    const was = this.open;
    const wasTarget = this.target();
    this.open = null;
    this.map.select(null);
    this.map.selectTrain(null);
    this.map.showSights([]);
    this.map.setSpot(null);
    this.map.hintJourney([]);
    if (wasTarget) this.refresh(false, false); // leaving the ways into a place: back to the whole country
    this.renderPanel(true);
    this.syncChrome();
    if (o.refit !== false && was && ("place" in was || was.kind === "spot")) {
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

  // ---------------------------------------------------------------- weather

  /** A place's weather for its panel: what's known now, and a fetch if nothing is. */
  private weatherAt(lat: number | null, lon: number | null, where: string, stillHere: () => boolean) {
    if (lat === null || lon === null) return "";
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = this.forecasts.get(key);
    if (hit) return weatherHtml(hit, where);
    this.forecasts.set(key, "loading");
    forecast(lat, lon, 7)
      .then((f) => this.forecasts.set(key, f))
      .catch(() => this.forecasts.set(key, "error"))
      .finally(() => stillHere() && this.renderPanel(false));
    return weatherHtml("loading", where);
  }

  private toggleWeather() {
    this.weatherOn = !this.weatherOn;
    $("weather-btn").setAttribute("aria-pressed", String(this.weatherOn));
    $("wx-card").hidden = !this.weatherOn;
    if (!this.weatherOn) {
      this.map.setWeather(null, weatherColor("temp"));
      this.layout();
      return;
    }
    this.setWeatherMode(this.weatherMode);
    this.layout();
    if (this.gridData) return this.paintWeather();
    $("wx-note").textContent = "Loading the weather…";
    // the button answers first; finding the points on land takes a moment on a phone
    requestAnimationFrame(() => setTimeout(() => this.loadWeather()));
  }

  private wxLoading = false;
  private loadWeather() {
    if (!this.weatherOn || this.gridData || this.wxLoading) return;
    this.wxLoading = true;
    const points = indiaGrid(1.6).filter(([lat, lon]) => this.map.onLand(lat, lon));
    const cities = [...this.net.places.values()].filter((p) => p.isCity && p.lat !== null && p.lon !== null);
    grid([...points, ...cities.map((c) => [c.lat!, c.lon!] as [number, number])])
      .then((all) => {
        this.gridData = all.slice(0, points.length);
        this.gridCities = cities.map((place, i) => ({ place, point: all[points.length + i] }));
        const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(new Date());
        $("wx-note").innerHTML = `${esc(weatherLabel(this.weatherMode))} · updated ${t} · <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>`;
        this.paintWeather();
      })
      .catch(() => {
        $("wx-note").textContent = "Couldn't get the weather just now. Try again in a moment.";
        this.weatherOn = false;
        $("weather-btn").setAttribute("aria-pressed", "false");
      })
      .finally(() => (this.wxLoading = false));
  }

  private setWeatherMode(m: WeatherMode) {
    this.weatherMode = m;
    for (const b of $("wx-mode").querySelectorAll<HTMLElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.v === m));
    $("wx-scale").innerHTML = legendHtml(m);
    const note = $("wx-note");
    if (this.gridData && note.firstChild) note.firstChild.textContent = `${weatherLabel(m)} · `;
    this.paintWeather();
  }

  private paintWeather() {
    if (!this.weatherOn || !this.gridData) return;
    const m = this.weatherMode;
    const unit = weatherUnit(m);
    const picked = new Set([this.origin, this.destination()].filter(Boolean));
    const labels = this.gridCities
      .filter((c) => m === "temp" || valueOf(c.point, m) >= 5)
      .map((c) => ({ lat: c.place.lat!, lon: c.place.lon!, text: m === "temp" ? `${this.name(c.place)} ${Math.round(c.point.temp)}°` : `${this.name(c.place)} ${Math.round(valueOf(c.point, m))}${unit}`, strong: picked.has(c.place) }))
      .sort((a, b) => Number(b.strong) - Number(a.strong));
    const points = this.gridData.map((p) => ({ lat: p.lat, lon: p.lon, v: valueOf(p, m) }));
    requestAnimationFrame(() => setTimeout(() => this.weatherOn && this.map.setWeather(points, weatherColor(m), labels))); // after the button has answered
  }

  // ---------------------------------------------------------------- the trip planner

  private defaultDate() {
    const d = new Date(Date.now() + 7 * 86400_000);
    return isoDay(d);
  }

  /** "Sat 11 Oct" for a YYYY-MM-DD. */
  private dayLabel(iso: string) {
    const d = new Date(`${iso}T12:00:00+05:30`);
    return `${WEEK[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }

  /** The date `mins` into the trip, as a label. */
  private tripDay(mins: number) {
    const d = new Date(`${this.trip.date}T12:00:00+05:30`);
    d.setUTCDate(d.getUTCDate() + Math.floor(mins / 1440));
    return `${WEEK[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }

  private tripIso(mins: number) {
    const d = new Date(`${this.trip.date}T12:00:00+05:30`);
    d.setUTCDate(d.getUTCDate() + Math.floor(mins / 1440));
    return d.toISOString().slice(0, 10);
  }

  private replan() {
    const stops = this.trip.stops;
    if (stops.length < 2) {
      this.plan = null;
    } else {
      const day = new Date(`${this.trip.date}T12:00:00+05:30`).getUTCDay(); // 0 = Sunday
      this.plan = planTrip(
        { net: this.net, departuresFrom: (p) => this.departuresFrom(p), arrivalsTo: (p) => this.arrivalsTo(p) },
        stops,
        (day + 6) % 7, // Monday = 0, as the timetable counts
        6 * 60,
        this.trip.choice,
      );
    }
    this.drawTrip();
  }

  private drawTrip() {
    if (this.mode !== "trip") return;
    const stops = this.trip.stops.map((s) => ({ ...stopLatLon(s.stop)!, label: stopName(s.stop, (p) => this.name(p)) })).filter((s) => s.lat !== undefined);
    const legs: Leg[] = [];
    const roads: { lat: number; lon: number; place: Place }[] = [];
    const links: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }[] = [];
    for (const l of this.plan?.legs ?? []) {
      const a = stopLatLon(l.from), b = stopLatLon(l.to);
      if (!l.ride && a && b) links.push({ a, b }); // by road
      if (l.ride?.kind === "direct") legs.push(l.ride.leg);
      else if (l.ride?.kind === "change") legs.push(...l.ride.conn.legs);
      if (l.roadBefore && l.from.kind === "spot") roads.push({ lat: l.from.spot.lat, lon: l.from.spot.lon, place: l.roadBefore.place });
      if (l.roadAfter && l.to.kind === "spot") roads.push({ lat: l.to.spot.lat, lon: l.to.spot.lon, place: l.roadAfter.place });
    }
    this.map.setTrip(stops.length ? { stops, legs, roads, links } : null);
  }

  private fitTrip() {
    const pts = this.trip.stops.map((s) => stopLatLon(s.stop)).filter((x): x is { lat: number; lon: number } => !!x);
    if (pts.length) requestAnimationFrame(() => this.map.focusPoints(pts, [], pts.length === 1 ? 7 : 9));
    else this.map.fitIndia();
  }

  private addStop(stop: Stop) {
    const last = this.trip.stops[this.trip.stops.length - 1];
    const same = (a: Stop, b: Stop) => (a.kind === "place" && b.kind === "place" && a.place === b.place) || (a.kind === "spot" && b.kind === "spot" && a.spot === b.spot);
    if (last && same(last.stop, stop)) return this.toast("That's already the last stop.");
    if (this.trip.stops.length >= 12) return this.toast("Twelve stops is the most a trip can have.");
    // a stop you stay at: two nights unless you say otherwise (the first stop is where you set off)
    if (this.trip.stops.length) this.trip.stops[this.trip.stops.length - 1].nights ||= this.trip.stops.length > 1 ? 2 : 0;
    this.trip.stops.push({ stop, nights: this.trip.stops.length ? 2 : 0 });
    this.tripChanged(true);
  }

  private tripChanged(fit = false) {
    this.trip.choice = this.trip.choice.slice(0, Math.max(0, this.trip.stops.length - 1));
    this.replan();
    this.renderPanel(false);
    if (fit) this.fitTrip();
    this.sync("replace");
  }

  private tripView() {
    const plan = this.plan;
    const today = isoDay();
    const within = (iso: string) => {
      const days = (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400_000;
      return days >= 0 && days < 16;
    };
    const stops: TripStopView[] = this.trip.stops.map((s, i) => {
      const name = stopName(s.stop, (p) => this.name(p));
      const note = s.stop.kind === "spot" ? `No station` : s.stop.place.state || "";
      const arrive = plan && i > 0 ? `${this.tripDay(plan.arrivals[i])}, ${fmtTime(plan.arrivals[i] % 1440)}` : null;
      const leave = plan && i === 0 && plan.legs[0] ? `${this.tripDay(plan.legs[0].depart)}` : null;
      // the weather on the day you get there, while it's within the forecast
      let weather = "";
      const ll = stopLatLon(s.stop);
      if (plan && ll && i > 0) {
        const iso = this.tripIso(plan.arrivals[i]);
        if (within(iso)) {
          const key = `${ll.lat.toFixed(2)},${ll.lon.toFixed(2)}:16`;
          const f = this.forecasts.get(key);
          if (f && f !== "loading" && f !== "error") {
            const d = f.days.find((x) => x.date === iso);
            if (d) weather = weatherLine(d);
          } else if (!f) {
            this.forecasts.set(key, "loading");
            forecast(ll.lat, ll.lon, 16)
              .then((x) => this.forecasts.set(key, x))
              .catch(() => this.forecasts.set(key, "error"))
              .finally(() => this.mode === "trip" && this.renderPanel(false));
          }
        }
      }
      return { name, note, nights: s.nights, arrive, leave, weather };
    });
    const total = plan ? { days: plan.days, trainMins: plan.totalTrain, km: plan.totalKm } : null;
    const saved = this.trip.stops.length >= 2 && this.saves.has(tripKey({ stops: this.tripSlugs() }));
    const ideas = this.trip.stops.length ? [] : [...new Set([...(this.lastOrigin() ? [this.lastOrigin()!] : []), ...POPULAR.map((id) => this.net.places.get(id)!).filter(Boolean)])].slice(0, 6).map((p) => ({ name: this.name(p), slug: this.slugs.of(p) }));
    return {
      date: this.trip.date,
      today,
      stops,
      legs: plan?.legs ?? [],
      dayOf: (m: number) => this.tripDay(m),
      name: (p: Place) => this.name(p),
      total,
      saved,
      search: `<div class="gh-search">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
        <input id="trip-input" type="search" enterkeyhint="go" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="${this.trip.stops.length ? "Add a stop: city, station or town" : "Where do you start?"}" aria-label="Add a stop" />
        <ul class="suggest" id="trip-list" aria-label="Places to add" hidden></ul>
      </div>`,
      ideas,
    };
  }

  private tripSlugs() {
    return this.trip.stops.map((s) => (s.stop.kind === "place" ? this.slugs.of(s.stop.place) : s.stop.spot.id));
  }

  private tripTitle() {
    return this.trip.stops.map((s) => stopName(s.stop, (p) => this.name(p))).join(" → ");
  }

  // ---------------------------------------------------------------- drawing the panel

  private renderPanel(fresh: boolean, scrollTo?: number) {
    const o = this.open;
    const scroller = () => this.panel.querySelector<HTMLElement>(".panel-scroll");
    const keep = fresh ? 0 : scroller()?.scrollTop ?? 0;
    // the same place drawn again (its guide arrived, something was saved): keep the photo that's
    // already showing, rather than loading and fading it in again
    const shot = fresh ? null : this.panel.querySelector<HTMLElement>(".shot[data-key]");
    const focused = !fresh && document.activeElement instanceof HTMLInputElement && this.panel.contains(document.activeElement) ? document.activeElement.id : "";
    // photos already on screen stay on screen when the panel is drawn again (no second fade-in)
    const shown = fresh ? null : new Set([...this.panel.querySelectorAll<HTMLImageElement>("img.in")].map((i) => i.src));
    if (this.mode === "trip" && o?.kind !== "train") {
      this.panel.dataset.view = "trip";
      this.panel.innerHTML = tripHtml(this.tripView());
      const input = this.panel.querySelector<HTMLInputElement>("#trip-input");
      if (input) {
        new SearchBox(input, this.panel.querySelector<HTMLUListElement>("#trip-list")!, this.net, () => this.guides, (p) => this.addStop({ kind: "place", place: p }), {
          spots: () => this.spots,
          onSpot: (s) => this.addStop({ kind: "spot", spot: s.fromSearch && !s.id ? this.spots.adopt(s, (x) => !!this.slugs.find(x)) : s }),
          online: true,
          suggestions: () => this.suggestTo(),
        });
      }
    } else if (!o) {
      if (this.origin) {
        this.panel.dataset.view = "explore";
        this.panel.innerHTML = exploreHtml({
          from: titleOf(this.origin, null),
          places: this.reach.size,
          trains: this.reachTrains,
          items: this.exploreItems(this.list.withGuides, this.list.famous && this.list.withGuides),
          showAll: this.list.showAll,
          withGuides: this.list.withGuides,
          famous: this.list.famous,
          kind: this.filters.kind ?? "all",
          within: this.filters.within,
          leave: this.filters.leave,
          noneLeave: !this.dests.size,
        });
      } else {
        this.panel.dataset.view = "home";
        this.panel.innerHTML = homeHtml(this.homeView());
      }
    } else if (o.kind === "train") {
      const gv = this.guides.get(o.place) ?? null;
      const boards = this.net.placeOf[o.leg.train.st[o.leg.from]];
      const gets = this.net.placeOf[o.leg.train.st[o.leg.to]];
      this.panel.dataset.view = "train";
      this.panel.innerHTML = o.fromTrip
        ? trainHtml(this.net, o.leg, titleOf(boards, null), titleOf(gets, null), o.stops, "Your trip")
        : o.journey
          ? trainHtml(this.net, o.leg, titleOf(boards, null), titleOf(gets, null), o.stops, "The journey")
          : trainHtml(this.net, o.leg, titleOf(this.origin ?? boards, null), titleOf(o.place, gv), o.stops);
    } else if (o.kind === "journey") {
      this.panel.dataset.view = "train";
      this.panel.innerHTML = journeyHtml(this.net, o.conn, titleOf(this.origin!, null), this.name(o.place), this.name(o.conn.via), this.saves.has(this.routeSave(o.place, o.conn).key));
    } else if (o.kind === "spot") {
      this.panel.dataset.view = "spot";
      const s = o.spot;
      this.panel.innerHTML = spotHtml({
        spot: s,
        from: this.origin ? titleOf(this.origin, null) : null,
        ways: this.spotWays(s, this.spotQuick !== s),
        airports: nearestAirports(this.spots.airports, s, 2).map((a) => ({ code: a.airport.iata, name: a.airport.name, km: a.road.km, mins: a.road.mins })),
        summary: this.summaries.get(s.id) ?? null,
        weather: this.weatherAt(s.lat, s.lon, s.name, () => this.open?.kind === "spot" && this.open.spot === s),
        saved: this.saves.has(placeKey(s.id)),
        fromChoices: `<div class="gh-search">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4.5 4.5" /></svg>
          <input id="gh-input" type="search" enterkeyhint="go" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Where do you start?" aria-label="Where do you start?" />
          <ul class="suggest" id="gh-list" aria-label="Where you could start" hidden></ul>
        </div>`,
      });
      const gh = this.panel.querySelector<HTMLInputElement>("#gh-input");
      if (gh) new SearchBox(gh, this.panel.querySelector<HTMLUListElement>("#gh-list")!, this.net, () => this.guides, (p) => this.setOrigin(p, { push: true }), { suggestions: () => this.suggestFrom() });
    } else if (o.kind === "discover") {
      this.panel.dataset.view = "discover";
      // the records (at the bottom) take a moment to work out: Discover shows first, they follow
      if (!this.timetableRecords) {
        setTimeout(() => {
          this.timetableRecords ??= records(this.net);
          const ol = this.open?.kind === "discover" ? this.panel.querySelector(".records") : null;
          if (ol) ol.innerHTML = recordsHtml(this.timetableRecords);
        }, 60);
      }
      this.panel.innerHTML = discoverHtml(this.discoverData!, { fact: o.fact, cat: o.cat, records: this.timetableRecords ?? [], storyHref: (st) => href({ discover: st.slug }) });
    } else if (o.kind === "story") {
      this.panel.dataset.view = "story";
      const codes = o.story.rides.flatMap((r) => [r.from, r.to]);
      this.panel.innerHTML = storyHtml(o.story, this.rideViews(o.story), this.factsAt(codes, 2), this.discoverData!.facts);
    } else if (o.kind === "saved") {
      this.panel.dataset.view = "saved";
      this.panel.innerHTML = savedHtml(this.savedView());
      const gsi = this.panel.querySelector<HTMLElement>("#gsi-button");
      if (gsi) this.saves.renderSignIn(gsi, document.documentElement.dataset.theme === "night", (m) => this.toast(m));
    } else {
      const now = istWeekMinute();
      const gv = this.guides.get(o.place) ?? null;
      const legs = this.dests.get(o.place)?.legs ?? [];
      o.legs = bySoonest(legs, now); // the panel numbers trains in this order
      this.panel.dataset.view = "place";
      const place = o.place;
      this.panel.innerHTML = placeHtml({
        net: this.net,
        place,
        gv,
        detail: this.detailFor(gv, place),
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
        newer: this.origin ? newerBetween(this.net, this.origin, place) : [],
        getHere: this.getHere(place, !!o.allFrom, !!o.choosing),
        changes: this.origin ? this.changesShown(place) : [],
        roadWays: this.origin && !legs.length ? this.roadWays(place) : [],
        name: (p) => this.name(p),
        saved: { place: this.saves.has(placeKey(this.slugs.of(place))), route: !!this.origin && this.saves.has(this.routeSave(place).key) },
        fact: this.placeFact(place),
        weather: this.weatherAt(gv?.entry.ll?.[0] ?? place.lat, gv?.entry.ll?.[1] ?? place.lon, this.name(place), () => this.open?.kind === "place" && this.open.place === place),
      });
      const gh = this.panel.querySelector<HTMLInputElement>("#gh-input");
      if (gh) {
        new SearchBox(gh, this.panel.querySelector<HTMLUListElement>("#gh-list")!, this.net, () => this.guides, (p) => this.chooseFrom(p), {
          context: (p) => this.fromNote(p),
          suggestions: () => this.suggestFrom(),
        });
      }
    }
    document.body.dataset.view = this.panel.dataset.view ?? ""; // phones fold the chrome away around a place, a train
    const again = shot && this.panel.querySelector<HTMLElement>(`.shot[data-key="${CSS.escape(shot.dataset.key!)}"]`);
    if (again) again.replaceWith(shot);
    for (const im of this.panel.querySelectorAll<HTMLImageElement>("img:not(.in)")) {
      if (shown?.has(im.src) || (im.complete && im.naturalWidth > 0)) im.classList.add("in");
    }
    const s = scroller();
    if (s && fresh) s.classList.add("enter");
    if (s && !fresh) s.scrollTop = keep;
    else if (s && scrollTo) s.scrollTop = scrollTo;
    // a train opens at its top: its name and times first (the stops before yours are folded
    // away, so your boarding station is just below)
    if (focused) this.panel.querySelector<HTMLInputElement>(`#${focused}`)?.focus({ preventScroll: true });
    else if (fresh && !narrow()) this.panel.querySelector<HTMLElement>("#panel-title")?.focus({ preventScroll: true });
  }

  private homeView() {
    const face = (p: Place) => this.guides.get(p)?.icon ?? null;
    const last = this.lastOrigin();
    const find = (name: string, state: string) => this.spots.list.find((s) => s.name === name && s.state === state);
    const hills = HILLS.map(([n, st]) => find(n, st)).filter((s): s is Spot => !!s).map((s) => ({ name: s.name, href: href({ place: s.id }), note: `${s.name}, ${s.state}: no station, see how to get there` }));
    const ideas = IDEAS.flatMap(([title, note]) => {
      const p = this.titlePlace.get(title);
      return p ? [{ title, note, href: href({ place: this.slugs.of(p) }), photo: this.guides.get(p)?.icon ?? null }] : [];
    });
    const short = (this.discoverData?.facts ?? []).filter((f) => f.text.length <= 150);
    this.homeFact ??= short.length ? short[Math.floor(Math.random() * short.length)].text : null;
    return {
      last: last ? { id: last.id, name: last.name, href: href({ origin: this.slugs.of(last) }) } : null,
      popular: POPULAR.map((id) => this.net.places.get(id)).filter((p): p is Place => !!p && p !== last).map((p) => ({ id: p.id, name: p.name, href: href({ origin: this.slugs.of(p) }), photo: face(p) })),
      hills,
      ideas,
      fact: this.homeFact ? { text: this.homeFact, href: href({ discover: "" }) } : null,
    };
  }
  private homeFact: string | null = null;

  private exploreItems(withGuides: boolean, famous = false): ExploreItem[] {
    // your own city's guide isn't somewhere to go: its stations are listed, without its photo
    const home = this.guides.get(this.origin!)?.title;
    const rows = new Map<string, ExploreItem & { city: boolean }>();
    for (const [place, legs] of this.reach) {
      const gv = this.guides.get(place) ?? null;
      if (withGuides && (!worthwhile(gv) || gv.title === home || sameTown(this.origin, place, this.net))) continue;
      const item = {
        appeal: gv ? gv.entry.appeal + (ICONIC.includes(gv.title) ? 60 : 0) : 0,
        id: place.id,
        title: titleOf(place, gv),
        state: place.state,
        mins: Math.min(...legs.map((l) => l.dur)),
        trains: new Set(legs.map((l) => l.train)).size,
        photo: gv && gv.title !== home ? gv.icon : null,
        guide: worthwhile(gv) && gv.title !== home,
        href: href({ origin: this.slugs.of(this.origin!), place: this.slugs.of(place) }),
        city: place.isCity,
      };
      // with guides: one row per guide, at the city's own station if it has one, else the nearest
      const key = withGuides ? gv!.title : place.id;
      const prev = rows.get(key);
      if (!prev || (item.city && !prev.city) || (item.city === prev.city && item.mins < prev.mins)) rows.set(key, item);
    }
    const rows2 = [...rows.values()];
    return famous ? rows2.sort((a, b) => b.appeal - a.appeal || a.mins - b.mins) : rows2.sort((a, b) => a.mins - b.mins);
  }

  // ---------------------------------------------------------------- clicks in the panel

  private onPanelChange(e: Event) {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLSelectElement && el.dataset.sort !== undefined) {
      this.list.famous = el.value === "famous";
      this.list.showAll = false;
      this.renderPanel(false);
      this.panel.querySelector<HTMLElement>("select[data-sort]")?.focus({ preventScroll: true });
      return;
    }
    if (el instanceof HTMLSelectElement && el.dataset.f) {
      const v = el.value;
      const f = { ...this.filters };
      if (el.dataset.f === "kind") f.kind = v as Kind;
      if (el.dataset.f === "within") f.within = v === "Infinity" ? Infinity : Number(v);
      if (el.dataset.f === "leave") f.leave = v as Leave;
      this.list.showAll = false;
      this.setFilters(f, true);
      this.panel.querySelector<HTMLElement>(`select[data-f="${el.dataset.f}"]`)?.focus({ preventScroll: true });
    }
    if (el instanceof HTMLInputElement && el.id === "trip-date" && /^\d{4}-\d{2}-\d{2}$/.test(el.value)) {
      this.trip.date = el.value;
      this.trip.choice = [];
      this.tripChanged();
    }
  }

  private onPanelClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el) return;
    const o = this.open;
    const act = el.dataset.act!;
    const plainClick = !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0);
    if (act === "nav" || act === "goto") {
      // an in-app link: follow it without a page load, keep real hrefs for sharing and crawlers
      if (!plainClick) return;
      e.preventDefault();
      const r = parse(new URL((el as HTMLAnchorElement).href));
      if (act === "goto" || r.trip || r.discover !== undefined) return this.goRoute(r);
      const p = r.place ? this.slugs.find(r.place) : null;
      if (!p) return this.goRoute(r);
      const from = r.origin ? this.slugs.find(r.origin) : this.origin;
      if (from !== this.origin || r.journey) this.goRoute(r); // a saved route: its start, its place, its journey
      else this.openPlace(p, { push: true });
      return;
    }
    if (act === "from") {
      // "start from here" (a popular place, or one in the ways-in list)
      if (!plainClick) return;
      e.preventDefault();
      const p = this.net.places.get(el.dataset.id!);
      if (p) this.chooseFrom(p);
      return;
    }
    if (act === "way") {
      if (!plainClick) return;
      e.preventDefault();
      const p = this.net.places.get(el.dataset.id!);
      if (p && p !== this.origin) this.openPlace(p, { push: true });
      return;
    }
    switch (act) {
      case "close":
        if (o) this.closePanel({ push: "place" in o || o.kind === "spot" });
        break;
      case "plan":
        this.setMode("trip", true);
        break;
      case "surprise":
        this.surprise();
        break;
      case "reset":
        this.list.showAll = false;
        this.setFilters({ ...ANY }, true);
        break;
      case "share":
        if (o?.kind === "place") this.sharePoster(o.place);
        else this.share();
        break;
      case "fact-next":
      case "fact-prev":
        if (o?.kind === "discover") {
          o.fact += act === "fact-next" ? 1 : -1;
          this.factAt = o.fact;
          this.renderPanel(false);
          this.panel.querySelector<HTMLElement>(`[data-act=${act}]`)?.focus({ preventScroll: true });
        }
        break;
      case "fact-cat":
        if (o?.kind === "discover") {
          o.cat = el.dataset.cat ?? "All";
          o.fact = 0;
          this.renderPanel(false);
        }
        break;
      case "story":
      case "discover":
        if (!plainClick) return;
        e.preventDefault();
        this.openDiscover(act === "story" ? el.dataset.slug! : null, { push: true });
        break;
      case "ride":
        if (o?.kind === "story") {
          if (!plainClick) return;
          e.preventDefault();
          this.goRoute(parse(new URL((el as HTMLAnchorElement).href)));
        }
        break;
      case "record": {
        const rec = this.timetableRecords?.[Number(el.dataset.i)];
        if (rec?.train) {
          const { train, from, to } = rec.train;
          this.goRoute({ origin: this.slugs.of(this.net.placeOf[train.st[from]]), place: this.slugs.of(this.net.placeOf[train.st[to]]), train: train.no });
        } else if (rec?.place) this.goRoute({ origin: this.origin ? this.slugs.of(this.origin) : undefined, place: this.slugs.of(rec.place) });
        break;
      }
      case "save-place":
        if (o?.kind === "place") {
          const on = this.saves.toggle({ key: placeKey(this.slugs.of(o.place)), kind: "place", data: { slug: this.slugs.of(o.place), title: this.name(o.place), state: o.place.state } });
          this.toast(on ? `${this.name(o.place)} is on your bucket list` : `Removed from your bucket list`, 2400, on ? { label: "See it", run: () => this.openSaved() } : undefined);
        }
        break;
      case "save-spot":
        if (o?.kind === "spot") {
          const s = o.spot;
          const on = this.saves.toggle({ key: placeKey(s.id), kind: "place", data: { slug: s.id, title: s.name, state: s.state } });
          this.toast(on ? `${s.name} is on your bucket list` : `Removed from your bucket list`, 2400, on ? { label: "See it", run: () => this.openSaved() } : undefined);
        }
        break;
      case "save-route":
        if ((o?.kind === "place" || o?.kind === "journey") && this.origin) {
          const on = this.saves.toggle(this.routeSave(o.place, o.kind === "journey" ? o.conn : undefined));
          this.toast(on ? "Route saved" : "Route removed", 2400, on ? { label: "Saved", run: () => this.openSaved() } : undefined);
        }
        break;
      case "unsave": {
        const item = this.saves.live().find((x) => x.key === el.dataset.key);
        if (item) this.saves.toggle(item);
        break;
      }
      case "sign-out":
        this.saves.signOut().then(() => this.toast("Signed out. What you saved stays on this device."));
        break;
      case "delete-account":
        if (confirm("Delete your Railgaddi account and everything saved in it? This device keeps its own copy.")) {
          this.saves.deleteAccount().then((ok) => this.toast(ok ? "Account deleted" : "Couldn't delete it just now. Try again."));
        }
        break;
      case "journey":
        if (o?.kind === "place") {
          const c = this.changesShown(o.place)[Number(el.dataset.i)];
          if (c) this.openJourney(c, { push: true });
        }
        break;
      case "journey-train":
        if (o?.kind === "journey") this.openTrain(o.conn.legs[Number(el.dataset.k)], { push: true }, o.conn);
        break;
      case "stops":
        if (o?.kind === "train") {
          const side = el.dataset.side as "before" | "after";
          o.stops[side] = true;
          this.renderPanel(false);
          this.panel.querySelector<HTMLElement>(".line")?.focus({ preventScroll: true }); // the button that had focus is gone
        }
        break;
      case "back":
        this.back();
        break;
      case "leg":
        if (o?.kind === "place") {
          const leg = o.legs[Number(el.dataset.i)];
          if (leg) this.openTrain(leg, { push: true });
        }
        break;
      case "all-trains":
        if (o?.kind === "place") {
          o.showAll = true;
          this.renderPanel(false);
        }
        break;
      case "sight":
        this.pickSight(Number(el.dataset.i), true);
        break;
      case "sights-map":
        if (o?.kind === "place") {
          o.sight = -1;
          this.showSights(o.place, -1, true);
        }
        break;
      case "change-from":
        if (o?.kind === "place") {
          o.choosing = true;
          this.renderPanel(false);
          const gh = this.panel.querySelector<HTMLElement>(".get-here");
          gh?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
          this.panel.querySelector<HTMLInputElement>("#gh-input")?.focus({ preventScroll: true });
        }
        break;
      case "gh-all":
        if (o?.kind === "place") {
          o.allFrom = true;
          this.renderPanel(false);
        }
        break;
      case "from-here":
        if (o?.kind === "place") this.setOrigin(o.place, { push: true });
        break;
      case "list-more":
        this.list.showAll = true;
        this.renderPanel(false);
        break;
      case "list-guides":
      case "list-all":
        this.list.withGuides = act === "list-guides";
        this.list.showAll = false;
        this.renderPanel(false);
        break;
      // ---- the trip
      case "trip-idea": {
        const stop = this.stopOf(el.dataset.slug!);
        if (stop) this.addStop(stop);
        break;
      }
      case "trip-nights": {
        const s = this.trip.stops[Number(el.dataset.i)];
        if (s) {
          s.nights = Math.max(0, Math.min(30, s.nights + Number(el.dataset.d)));
          this.tripChanged();
        }
        break;
      }
      case "trip-move": {
        const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
        const st = this.trip.stops;
        if (j >= 0 && j < st.length) {
          [st[i], st[j]] = [st[j], st[i]];
          st[0].nights = 0;
          this.trip.choice = [];
          this.tripChanged(true);
        }
        break;
      }
      case "trip-remove":
        this.trip.stops.splice(Number(el.dataset.i), 1);
        if (this.trip.stops[0]) this.trip.stops[0].nights = 0;
        this.trip.choice = [];
        this.tripChanged(true);
        break;
      case "trip-alt": {
        const i = Number(el.dataset.leg);
        this.trip.choice[i] = Number(el.dataset.k);
        for (let k = i + 1; k < this.trip.choice.length; k++) this.trip.choice[k] = 0; // later trains follow from it
        this.tripChanged();
        break;
      }
      case "trip-train": {
        const leg = this.plan?.legs[Number(el.dataset.leg)];
        const ride = leg?.ride;
        if (ride) this.openTrain(ride.kind === "direct" ? ride.leg : ride.conn.legs[0], { push: false }, ride.kind === "change" ? ride.conn : undefined, true);
        break;
      }
      case "trip-save":
        if (this.trip.stops.length >= 2) {
          const data: TripSave = { title: this.tripTitle(), stops: this.tripSlugs(), nights: this.trip.stops.map((s) => s.nights), date: this.trip.date };
          const on = this.saves.toggle({ key: tripKey(data), kind: "trip", data });
          this.toast(on ? "Trip saved" : "Trip removed", 2400, on ? { label: "Saved", run: () => this.openSaved() } : undefined);
        }
        break;
      case "trip-clear":
        this.trip = { stops: [], date: this.trip.date, choice: [] };
        this.tripChanged();
        this.map.fitIndia();
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
    const line = this.mode === "trip"
      ? "Click to add to your trip"
      : target && legs?.length
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

  /** Sharing a place: its travel poster, with the link. */
  private sharePoster(p: Place) {
    const gv = this.guides.get(p) ?? null;
    const d = this.dests.get(p);
    const title = this.name(p);
    const line = this.origin && d
      ? `${fmtMins(d.fastest)} from ${titleOf(this.origin, null)}`
      : `direct from ${plural(this.arrivalsTo(p).size, "place")}`;
    openPosterSheet(
      {
        title,
        script: gv?.featured ? "" : scriptLine(p).split("  ·  ").pop() ?? "",
        state: p.state,
        line,
        photo: (gv?.icon && (gv.icon.w ?? 0) >= 800 ? gv.icon : gv?.banner ?? gv?.icon) ?? null,
        url: location.href,
      },
      (t) => this.toast(t),
    );
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
    if (this.weatherOn) this.paintWeather();
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
      if (this.open || !this.origin || seen() || this.mode !== "explore") return;
      this.toast(narrow() ? "Tap a photo to explore a place" : "Click a photo on the map, or a place in the list", 5000);
      try {
        localStorage.setItem(KEY, "1");
      } catch {
        /* then it may show again next time */
      }
    }, 2600);
  }

  private sync(mode: "push" | "replace") {
    if (this.mode === "trip" && this.open?.kind !== "train") {
      go({ trip: { stops: this.tripSlugs(), nights: this.trip.stops.map((s) => s.nights), date: this.trip.date } }, mode);
      return;
    }
    const o = this.open;
    if (o?.kind === "discover" || o?.kind === "story") {
      go({ discover: o.kind === "story" ? o.story.slug : "" }, mode);
      return;
    }
    const place = o && "place" in o ? o.place : null;
    const spot = o?.kind === "spot" ? o.spot : null;
    go(
      {
        origin: this.origin ? this.slugs.of(this.origin) : undefined,
        place: place ? this.slugs.of(place) : spot ? spot.id : undefined,
        at: spot?.fromSearch ? `${spot.lat.toFixed(3)},${spot.lon.toFixed(3)}` : undefined,
        train: o?.kind === "train" ? o.leg.train.no : undefined,
        journey: o?.kind === "journey" ? journeyKey(o.conn) : o?.kind === "train" && o.journey ? journeyKey(o.journey) : undefined,
        within: this.filters.within,
        leave: this.filters.leave,
        kind: this.filters.kind,
      },
      mode,
    );
  }

  /** Title and description for the current view (tabs, history, link previews). */
  private describe() {
    const o = this.open;
    const from = this.origin ? titleOf(this.origin, null) : null;
    let title = "Railgaddi · where can the train take you?";
    if (this.mode === "trip" && o?.kind !== "train") title = this.trip.stops.length ? `Trip: ${this.tripTitle()} · Railgaddi` : "Plan a trip by train · Railgaddi";
    else if (o?.kind === "train") title = `${o.leg.train.no} ${o.leg.train.name} · ${fmtTime(o.leg.dep)} · Railgaddi`;
    else if (o?.kind === "discover") title = "Discover: journeys worth taking, and facts from India's railways · Railgaddi";
    else if (o?.kind === "story") title = `${o.story.title} · Railgaddi`;
    else if (o?.kind === "journey") title = `${from} to ${this.name(o.place)} with one change at ${this.name(o.conn.via)} · Railgaddi`;
    else if (o?.kind === "spot") title = `${o.spot.name} by train${from ? ` from ${from}` : ""}: the nearest stations · Railgaddi`;
    else if (o?.kind === "place") {
      const name = titleOf(o.place, this.guides.get(o.place));
      title = from ? `${name} by train from ${from} · Railgaddi` : `${name} by train: direct from ${plural(this.reach.size, "place")} · Railgaddi`;
    } else if (from) title = `Trains from ${from}: ${plural(this.reach.size, "place")} without changing · Railgaddi`;
    document.title = title;
  }

  // ---------------------------------------------------------------- layout, and the sheet on phones

  private layout() {
    const rects: DOMRect[] = [this.side.getBoundingClientRect(), $("map-tools").getBoundingClientRect()];
    this.map.setSafeRects(rects.filter((r) => r.width && r.height));
    const tools = $("map-tools").getBoundingClientRect();
    if (narrow()) {
      // where the sheet is going, not where it is mid-slide (heights as in style.css)
      const b = document.body.classList;
      const H = window.innerHeight;
      const top = this.side.style.height ? this.side.getBoundingClientRect().top : b.contains("sheet-full") ? 48 : b.contains("sheet-min") ? H - 198 : H * 0.52;
      this.map.setInsets({ top: Math.max(16, tools.bottom + 8), right: 8, bottom: H - top + 8, left: 8 });
    } else {
      const side = this.side.getBoundingClientRect();
      this.map.setInsets({ top: 24, right: Math.max(24, window.innerWidth - tools.left + 8), bottom: 24, left: side.right + 24 });
    }
  }

  private expandSheet(full: boolean) {
    document.body.classList.toggle("sheet-full", full);
    document.body.classList.remove("sheet-min");
    $("grip").setAttribute("aria-label", full ? "Show less" : "Show more");
    this.layout();
  }

  /** The sheet's handle, on phones: drag or tap it to see more of the panel, or more of the map. */
  private setupGrip() {
    const grip = $("grip");
    grip.hidden = false;
    let startY = 0, dy = 0, dragging = false, startH = 0;
    grip.addEventListener("pointerdown", (e) => {
      if (!narrow()) return;
      dragging = true;
      startY = e.clientY;
      dy = 0;
      startH = this.side.getBoundingClientRect().height;
      grip.setPointerCapture(e.pointerId);
      this.side.style.transition = "none";
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dy = e.clientY - startY;
      this.side.style.height = `${Math.max(150, Math.min(window.innerHeight - 40, startH - dy))}px`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.side.style.transition = "";
      this.side.style.height = "";
      const b = document.body.classList;
      if (Math.abs(dy) < 6) {
        // a tap: from small to half, half to full, full back to half
        if (b.contains("sheet-min")) b.remove("sheet-min");
        else this.expandSheet(!b.contains("sheet-full"));
      } else if (dy < -40) {
        if (b.contains("sheet-min")) b.remove("sheet-min");
        else this.expandSheet(true);
      } else if (dy > 40) {
        if (b.contains("sheet-full")) b.remove("sheet-full");
        else b.add("sheet-min");
      }
      this.layout();
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    grip.addEventListener("click", (e) => {
      if (e.detail === 0) this.expandSheet(!document.body.classList.contains("sheet-full")); // keyboard
    });
  }
}
