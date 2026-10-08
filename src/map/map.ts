// The atlas. India drawn on canvas with the rail network faintly under it. Pick a starting point
// and the routes out of it are drawn, coloured by how long the ride takes. The best places to go
// float above the map as photos: a few at first, more as you zoom in. Weather can lie over the
// land; a trip's stretches, or the roads to a place without a station, are drawn on top.
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";
import type { Topology } from "topojson-specification";
import { fmtMins } from "../core/format";
import type { Geom, Network, Place, Train } from "../core/network";
import type { Photo } from "../core/places";
import type { BubbleCandidate } from "../core/rank";
import type { Leg } from "../core/trips";
import { coverWidth, loadedImage, photoUrl } from "../ui/photos";

export interface SightPin {
  i: number;
  name: string;
  lat: number;
  lon: number;
  photo: Photo | null;
}

export interface Reach {
  place: Place;
  mins: number;
}

export interface ActiveTrain {
  from: number;
  to: number;
}

export interface Hooks {
  onPick(place: Place): void;
  onPickSight(i: number): void;
  onHover(place: Place | null, x: number, y: number): void;
  onBackground(): void;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Palette {
  sea: string; sea2: string; land: string; landEdge: string; ripple: string; border: string; net: string;
  ink: string; livery: string; accent: string; text: string; muted: string; halo: string; ring: string;
  board: string; boardInk: string; rail: string; reliefAlpha: number;
}

interface Motion {
  geom: Geom;
  t: Float32Array; // minutes since boarding
  k: Float32Array; // km at that minute
  dep0: number; // time of day of boarding
  end: number;
}

interface Route {
  train: Train;
  st: Int32Array; // points drawn, boarding -> furthest reachable halt
  mins: Float32Array; // minutes after boarding at each point
  motion: Motion;
}

interface Shown {
  c: BubbleCandidate;
  alpha: number;
  target: number;
  x: number;
  y: number; // centre of the photo, which floats beside its station on a tether
  dx: number; // where the photo floats, relative to the station, fully popped
  dy: number;
}

const TAU = Math.PI * 2;
/** An arch photo's size for a given half-width: a little taller than wide, like a jharokha. */
const archH = (R: number) => R * 2.36;

/** The cusped arch of a Rajput window, as a path in a w x h box (the same shape as the panel's). */
function archPath(c: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number) {
  const X = (u: number) => x + u * w, Y = (v: number) => y + v * h;
  c.moveTo(X(0), Y(1));
  c.lineTo(X(0), Y(0.42));
  c.bezierCurveTo(X(0), Y(0.36), X(0.02), Y(0.33), X(0.06), Y(0.31));
  c.bezierCurveTo(X(0.06), Y(0.25), X(0.1), Y(0.21), X(0.16), Y(0.2));
  c.bezierCurveTo(X(0.17), Y(0.13), X(0.23), Y(0.09), X(0.3), Y(0.09));
  c.bezierCurveTo(X(0.34), Y(0.04), X(0.41), Y(0.02), X(0.46), Y(0.02));
  c.lineTo(X(0.5), Y(0));
  c.lineTo(X(0.54), Y(0.02));
  c.bezierCurveTo(X(0.59), Y(0.02), X(0.66), Y(0.04), X(0.7), Y(0.09));
  c.bezierCurveTo(X(0.77), Y(0.09), X(0.83), Y(0.13), X(0.84), Y(0.2));
  c.bezierCurveTo(X(0.9), Y(0.21), X(0.94), Y(0.25), X(0.94), Y(0.31));
  c.bezierCurveTo(X(0.98), Y(0.33), X(1), Y(0.36), X(1), Y(0.42));
  c.lineTo(X(1), Y(1));
  c.closePath();
}
const BUCKETS = 28;
const MAX_MINS = 36 * 60;
const bucketOf = (m: number) => Math.min(BUCKETS - 1, Math.floor(Math.sqrt(Math.max(0, m) / MAX_MINS) * BUCKETS));
const bucketMins = (b: number) => ((b + 0.5) / BUCKETS) ** 2 * MAX_MINS;
const bucketStart = (b: number) => (b / BUCKETS) ** 2 * MAX_MINS;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT = "Hind, system-ui, sans-serif";
const NAME = "'Tiro Devanagari Hindi', Georgia, serif"; // place names, as on the panel
const SCRIPTS = "'Noto Sans Kannada Variable', 'Noto Sans Tamil Variable', 'Noto Sans Telugu Variable', 'Noto Sans Malayalam Variable', 'Noto Sans Bengali Variable', 'Noto Sans Gujarati Variable', 'Noto Sans Gurmukhi Variable', 'Noto Sans Oriya Variable', 'Noto Sans Devanagari Variable', Hind, sans-serif";

export class RailMap {
  private ctx: CanvasRenderingContext2D;
  private base = document.createElement("canvas");
  private baseCtx = this.base.getContext("2d")!;
  private baseKey = "";
  private dpr = 1;
  private w = 0;
  private h = 0;
  private proj = d3.geoConicConformal().parallels([12, 28]).rotate([-80, 0]);
  private land: d3.GeoPermissibleObjects;
  private stateMesh: d3.GeoPermissibleObjects;
  private landPath = new Path2D();
  private statePath = new Path2D();
  private tropicPath = new Path2D();
  private tropicLabel: [number, number] = [0, 0];
  private netPaths: Path2D[] = [];
  private sx: Float32Array;
  private sy: Float32Array;
  private ok: Uint8Array;
  private edges: { a: number; b: number; w: number }[] = [];
  private zoom: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  private tf = d3.zoomIdentity;
  private c!: Palette;
  private lut: string[] = [];
  private netStrength = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private safe: DOMRect[] = [];

  // what is on the map
  private origin: Place | null = null;
  private routes: Route[] = [];
  private routeCache: Path2D[] | null = null;
  private reach: Reach[] = [];
  private cands: BubbleCandidate[] = [];
  private shown = new Map<Place, Shown>();
  // names on the land when you zoom in: towns (with a station or without) and the states
  private townsLL: { lat: number; lon: number; name: string; rank: number }[] = [];
  private towns: { x: number; y: number; name: string; rank: number }[] = [];
  private stateLabels: { x: number; y: number; name: string }[] = [];
  private nameWidth = new Map<string, number>();
  private discs = new Map<string, HTMLCanvasElement>();
  private selected: Place | null = null;
  private selectedTrains: { leg: Leg }[] = []; // one train, or a journey's trains
  private hintLegs: Leg[] = []; // the best way with a change, drawn quietly while a place is open
  private sights: SightPin[] = [];
  private activeSight = -1;
  private hover: Place | null = null;
  private hoverSight = -1;
  private fade = 1; // the routes fade in over a quarter of a second when the start changes
  private limit = Infinity; // minutes from the start drawn so far: the lines spread outward
  private growFrom = 0;
  private growStart = 0;
  private fadeFrom = 0;
  private maxMins = 1;
  private lastDraw = 0;
  private dirty = true; // something changed since the last drawing

  private toward = false; // routes lead into the centre place instead of out of it
  private weather: { img: HTMLCanvasElement; alpha: number; labels: { x: number; y: number; text: string; strong: boolean }[] } | null = null;
  private spot: { x: number; y: number; name: string; to: { anchor: number; label: string }[] } | null = null;
  private trip: { stops: { x: number; y: number; n: number; label: string }[]; legs: Leg[]; roads: [number, number, number][]; links: [number, number, number, number][] } | null = null;
  private relief: HTMLImageElement | null = null; // the painted land (Natural Earth), in the map's own frame
  private you: [number, number] | null = null; // where you are, if you said so (it never leaves the device)
  private originBoards = new Map<string, HTMLCanvasElement>();

  /** What the app wants to hear about: picks, hovers, clicks on empty map. */
  hooks: Hooks = { onPick() {}, onPickSight() {}, onHover() {}, onBackground() {} };

  constructor(
    private canvas: HTMLCanvasElement,
    private net: Network,
    india: Topology,
    states: Topology,
  ) {
    this.ctx = canvas.getContext("2d")!;
    // the land and the faint network sit on their own layer, under this canvas: redrawn only when
    // the view moves, and never copied across frame by frame (a whole-screen copy, on a phone)
    this.base.className = "map-base";
    this.base.setAttribute("aria-hidden", "true");
    canvas.before(this.base);
    this.land = feature(india, Object.values(india.objects)[0]) as unknown as d3.GeoPermissibleObjects;
    this.stateMesh = mesh(states, Object.values(states.objects)[0] as never);
    const n = net.stations.length;
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.ok = new Uint8Array(n);

    this.indexNetwork();

    this.zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 320])
      .on("zoom", (e) => {
        this.tf = e.transform;
        this.lastZoom = performance.now();
        this.dirty = true;
      });
    d3.select(canvas).call(this.zoom).on("dblclick.zoom", null);
    canvas.addEventListener("pointermove", (e) => this.pointer(e, false));
    canvas.addEventListener("click", (e) => this.pointer(e, true));
    canvas.addEventListener("pointerleave", () => {
      this.dirty = true;
      this.hover = null;
      this.hoverSight = -1;
      this.hooks.onHover(null, 0, 0);
    });

    this.readTheme();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- setup

  readTheme() {
    this.dirty = true;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    this.c = {
      sea: v("--sea"), sea2: v("--sea-2"), land: v("--land"), landEdge: v("--land-edge"), ripple: v("--ripple"),
      border: v("--border"), net: v("--net"), ink: v("--ink"), livery: v("--livery"), accent: v("--accent"),
      text: v("--text"), muted: v("--muted"), halo: v("--halo"), ring: v("--ring"), board: v("--board"), boardInk: v("--board-ink"),
      rail: v("--rail") || v("--net"), reliefAlpha: parseFloat(v("--relief")) || 0,
    };
    this.labelWidth.clear();
    this.nameWidth.clear();
    this.boards.clear();
    this.originBoards?.clear();
    this.netStrength = parseFloat(v("--net-strength")) || 1;
    const scale = d3
      .scaleLinear<string>()
      .domain([0, 120, 360, 720, 1440])
      .range(["--t0", "--t1", "--t2", "--t3", "--t4"].map(v))
      .interpolate(d3.interpolateLab)
      .clamp(true);
    this.lut = d3.range(BUCKETS).map((b) => scale(bucketMins(b)));
    this.baseKey = "";
    this.routeCache = null;
    this.discs.clear();
  }

  /** Colour for a ride of `m` minutes, from the current theme's time scale. */
  timeColor(m: number) {
    return this.lut[bucketOf(m)];
  }

  private geom(t: Train): Geom {
    return t.geom;
  }

  /** The national network: every stretch of line, weighted by how many trains run it. */
  private indexNetwork() {
    const em = new Map<number, { a: number; b: number; w: number }>();
    for (const t of this.net.trains) {
      const g = t.geom;
      for (let j = 1; j < g.st.length; j++) {
        const a = Math.min(g.st[j - 1], g.st[j]);
        const b = Math.max(g.st[j - 1], g.st[j]);
        const e = em.get(a * 100000 + b);
        if (e) e.w++;
        else em.set(a * 100000 + b, { a, b, w: 1 });
      }
    }
    this.edges = [...em.values()];
  }

  /** Call after the network's lines change (the detailed route geometry arrived). */
  refreshNetwork() {
    this.dirty = true;
    this.indexNetwork();
    this.resize();
    if (this.selectedTrains.length) this.selectJourney(this.selectedTrains.map((x) => x.leg));
  }

  /** Minute -> km samples between two point indices (halts carry the times). */
  private motion(t: Train, from: number, to: number): Motion {
    const dep0 = t.dep[from];
    const ts: number[] = [];
    const ks: number[] = [];
    for (let j = from; j <= to; j++) {
      if (t.arr[j] >= 0 && j !== from) {
        ts.push(t.arr[j] - dep0);
        ks.push(t.km[j]);
      }
      if (t.dep[j] >= 0 && j !== to) {
        ts.push(t.dep[j] - dep0);
        ks.push(t.km[j]);
      }
    }
    return {
      geom: this.geom(t),
      t: Float32Array.from(ts),
      k: Float32Array.from(ks),
      dep0: ((dep0 % 1440) + 1440) % 1440,
      end: ts[ts.length - 1] ?? 0,
    };
  }

  resize() {
    this.dirty = true;
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // full density on phones (3x screens), capped at 2x on big screens where pixels add up fast
    this.dpr = Math.min(window.devicePixelRatio || 1, r.width < 800 ? 3 : 2);
    this.w = r.width;
    this.h = r.height;
    for (const cv of [this.canvas, this.base]) {
      cv.width = Math.round(this.w * this.dpr);
      cv.height = Math.round(this.h * this.dpr);
    }
    // project into a fixed frame; the zoom transform does all framing
    this.proj.fitExtent([[0, 0], [1000, 1100]], this.land);
    const path = d3.geoPath(this.proj);
    this.landPath = new Path2D(path(this.land) ?? "");
    this.statePath = new Path2D(path(this.stateMesh) ?? "");
    this.tropicPath = new Path2D(path({ type: "LineString", coordinates: d3.range(66, 99, 0.5).map((x) => [x, 23.4367]) }) ?? "");
    this.tropicLabel = this.proj([91.6, 23.4367])!;
    for (const s of this.net.stations) {
      if (s.lat === null || s.lon === null) continue;
      const p = this.proj([s.lon, s.lat])!;
      this.sx[s.i] = p[0];
      this.sy[s.i] = p[1];
      this.ok[s.i] = 1;
    }
    this.projectNames();
    const buckets = [1, 3, 8, 20, 50, Infinity];
    this.netPaths = buckets.slice(1).map(() => new Path2D());
    for (const e of this.edges) {
      const bi = buckets.findIndex((b, i) => e.w >= b && e.w < buckets[i + 1]);
      this.netPaths[bi].moveTo(this.sx[e.a], this.sy[e.a]);
      this.netPaths[bi].lineTo(this.sx[e.b], this.sy[e.b]);
    }
    this.baseKey = "";
    this.routeCache = null;
    this.discs.clear();
    this.boards.clear();
  }

  // ---------------------------------------------------------------- public API

  setInsets(i: Insets) {
    this.dirty = true;
    this.insets = i;
  }

  /** Screen rectangles (panels, docks) that bubbles should keep clear of. */
  setSafeRects(rects: DOMRect[]) {
    this.dirty = true;
    this.safe = rects;
  }

  setCandidates(cands: BubbleCandidate[]) {
    this.dirty = true;
    this.cands = [...cands].sort((a, b) => b.score - a.score);
    const keep = new Set(cands.map((c) => c.place));
    for (const [p, s] of this.shown) {
      const fresh = cands.find((c) => c.place === p);
      if (fresh) s.c = fresh;
      else if (!keep.has(p)) s.target = 0;
    }
  }

  /**
   * Centre the map on a place and draw the trains that link it. `toward` flips the direction:
   * routes then lead *into* the place (arrivals) and times count down to reaching it.
   */
  setOrigin(origin: Place | null, active: Map<Train, ActiveTrain>, reach: Reach[], animate: boolean, toward = false) {
    this.dirty = true;
    const changed = origin !== this.origin || toward !== this.toward;
    const prevMax = this.maxMins;
    this.origin = origin;
    this.toward = toward;
    this.reach = reach;
    this.routes = [];
    this.routeCache = null;
    this.maxMins = 1;
    for (const [train, a] of active) {
      const motion = this.motion(train, a.from, a.to);
      const g = motion.geom;
      const km0 = train.km[a.from];
      const km1 = train.km[a.to];
      const st: number[] = [];
      const mins: number[] = [];
      for (let j = 0; j < g.st.length; j++) {
        if (g.km[j] < km0 - 0.01 || g.km[j] > km1 + 0.01) continue;
        st.push(g.st[j]);
        mins.push(this.minuteAtKm(motion, g.km[j]));
      }
      if (st.length < 2) continue;
      if (toward) {
        // start the drawing at the destination, so lines grow outward from it
        const total = mins[mins.length - 1];
        st.reverse();
        mins.reverse();
        for (let j = 0; j < mins.length; j++) mins[j] = total - mins[j];
      }
      this.maxMins = Math.max(this.maxMins, mins[mins.length - 1]);
      this.routes.push({ train, st: Int32Array.from(st), mins: Float32Array.from(mins), motion });
    }
    if (changed) {
      for (const s of this.shown.values()) s.target = 0;
      this.fade = animate && !reduceMotion() && origin ? 0 : 1;
      this.fadeFrom = performance.now();
    }
    // the lines spread out from the station: from nothing for a new start, from what was already
    // drawn when the ride gets longer
    if (animate && !reduceMotion() && origin) {
      this.growFrom = changed ? 0 : Math.min(this.limit, prevMax);
      this.growStart = performance.now();
      this.limit = this.growFrom;
    } else this.limit = Infinity;
  }

  select(place: Place | null) {
    this.dirty = true;
    this.selected = place;
  }

  selectTrain(leg: Leg | null) {
    this.selectJourney(leg ? [leg] : []);
  }

  /** The trains of a journey with changes (or one train): drawn in red, the rest dimmed. */
  selectJourney(legs: Leg[]) {
    this.dirty = true;
    this.selectedTrains = legs.map((leg) => ({ leg }));
  }

  /** A way in with a change, for a place no train reaches directly: drawn in livery, quietly. */
  hintJourney(legs: Leg[]) {
    this.dirty = true;
    this.hintLegs = legs;
  }

  showSights(pins: SightPin[], active = -1) {
    this.dirty = true;
    this.sights = pins;
    this.activeSight = active;
  }

  flyToOrigin() {
    if (!this.origin || !this.ok[this.origin.anchor]) return;
    this.fly(this.transformFor(this.boundsOfCore(), 7), 600);
  }

  /** Where most trips go: places within an overnight ride, or everything if that's too few. */
  private boundsOfCore(maxMins = 14 * 60): [[number, number], [number, number]] {
    const near = this.reach.filter((r) => r.mins <= maxMins && this.ok[r.place.anchor]);
    if (near.length < 6) return this.boundsOfRoutes();
    const b = this.boundsOf([this.origin!.anchor, ...near.map((r) => r.place.anchor)]);
    return b.box(0.06);
  }

  fitRoutes(duration = 700) {
    this.fly(this.transformFor(this.boundsOfRoutes(), 7), duration);
  }

  /** Frame what's within a day's ride of the centre place (the ways in, or the ways out). */
  fitCore(duration = 900) {
    if (!this.origin) return this.fitIndia(duration);
    this.fly(this.transformFor(this.boundsOfCore(), 7), duration);
  }

  fitIndia(duration = 900) {
    this.fly(this.transformFor([[0, 0], [1000, 1100]], 1.4), duration);
  }

  /** Frame a destination and the lines that lead to it from the origin. */
  focusOn(place: Place, duration = 850) {
    if (!this.ok[place.anchor]) return;
    const b = this.boundsOf([place.anchor]);
    if (this.origin) {
      b.add(this.origin.anchor);
      for (const l of this.hintLegs) for (let j = l.from; j <= l.to; j++) b.add(l.train.st[j]);
      const dest = new Set(place.stations);
      for (const r of this.routes) {
        const end = r.st.findIndex((s) => dest.has(s));
        if (end < 0) continue;
        for (let j = 0; j <= end; j++) b.add(r.st[j]);
      }
    } else {
      b.pad(18);
    }
    this.fly(this.transformFor(b.box(0.12), 12), duration);
  }

  /** Frame the part of a train's journey you'd ride (or every train of a journey). */
  focusLeg(leg: Leg | Leg[], duration = 850) {
    const b = this.boundsOf([]);
    for (const l of Array.isArray(leg) ? leg : [leg]) for (let j = l.from; j <= l.to; j++) b.add(l.train.st[j]);
    this.fly(this.transformFor(b.box(0.1), 12), duration);
  }

  /** Frame a set of sights (the attractions of a place). */
  focusSights(pins: SightPin[], centre?: SightPin, duration = 900) {
    if (!pins.length) return;
    const xy = pins.map((p) => this.proj([p.lon, p.lat])!);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of xy) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const span = Math.max(x1 - x0, y1 - y0, 0.35);
    if (centre) {
      const [cx, cy] = this.proj([centre.lon, centre.lat])!;
      const half = Math.max(span / 2, 0.35);
      x0 = cx - half; x1 = cx + half; y0 = cy - half; y1 = cy + half;
    }
    const pad = span * 0.25 + 0.05;
    this.fly(this.transformFor([[x0 - pad, y0 - pad], [x1 + pad, y1 + pad]], 300), duration);
  }

  /**
   * The weather over the land: values at points, spread smoothly between them (each pixel a
   * blend of the points around it, nearer ones counting more), coloured by `color`. `labels` are
   * the values written at a few towns. null takes it away.
   */
  setWeather(points: { lat: number; lon: number; v: number }[] | null, color: (v: number) => [number, number, number, number], labels: { lat: number; lon: number; text: string; strong?: boolean }[] = []) {
    this.dirty = true;
    this.baseKey = "";
    if (!points?.length) {
      this.weather = null;
      return;
    }
    const W = 125, H = 138, S = 1000 / W; // an eighth of the map's frame: it's drawn smoothed, and this is quick even on a phone
    // flat arrays and plain loops: this runs 17,000 pixels × a few hundred points
    const n = points.length;
    const PX = new Float64Array(n), PY = new Float64Array(n), PV = new Float64Array(n);
    points.forEach((p, i) => {
      const [x, y] = this.proj([p.lon, p.lat])!;
      PX[i] = x / S;
      PY[i] = y / S;
      PV[i] = p.v;
    });
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const c = cv.getContext("2d")!;
    const img = c.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sw = 0, sv = 0;
        for (let i = 0; i < n; i++) {
          const dx = PX[i] - x, dy = PY[i] - y;
          const d2 = dx * dx + dy * dy + 1;
          const w = 1 / (d2 * d2); // inverse distance, to the fourth: local, but no seams
          sw += w;
          sv += w * PV[i];
        }
        const [r, g, b, a] = color(sv / sw);
        const i = (y * W + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = a;
      }
    }
    c.putImageData(img, 0, 0);
    this.weather = {
      img: cv,
      alpha: 0.72,
      labels: labels.map((l) => {
        const [x, y] = this.proj([l.lon, l.lat])!;
        return { x, y, text: l.text, strong: !!l.strong };
      }),
    };
  }

  /** A place without a station: its pin, and dashed roads to the stations to take a train to. */
  setSpot(spot: { lat: number; lon: number; name: string } | null, stations: { place: Place; label: string }[] = []) {
    this.dirty = true;
    if (!spot) {
      this.spot = null;
      this.spotBoxes = [];
      this.namesEpoch++;
      return;
    }
    const [x, y] = this.proj([spot.lon, spot.lat])!;
    this.spot = { x, y, name: spot.name, to: stations.filter((s) => this.ok[s.place.anchor]).map((s) => ({ anchor: s.place.anchor, label: s.label })) };
  }

  /** A trip: its stops, numbered, and the trains between them (and roads, for places without a station). */
  setTrip(trip: { stops: { lat: number; lon: number; label: string }[]; legs: Leg[]; roads: { lat: number; lon: number; place: Place }[]; links?: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }[] } | null) {
    this.dirty = true;
    this.namesEpoch++; // its stops' names, not the land's
    if (!trip) {
      this.trip = null;
      return;
    }
    this.trip = {
      stops: trip.stops.map((s, i) => {
        const [x, y] = this.proj([s.lon, s.lat])!;
        return { x, y, n: i + 1, label: s.label };
      }),
      legs: trip.legs,
      roads: trip.roads.filter((r) => this.ok[r.place.anchor]).map((r) => {
        const [x, y] = this.proj([r.lon, r.lat])!;
        return [x, y, r.place.anchor] as [number, number, number];
      }),
      links: (trip.links ?? []).map(({ a, b }) => [...this.proj([a.lon, a.lat])!, ...this.proj([b.lon, b.lat])!] as [number, number, number, number]),
    };
  }

  /** Frame some points (lat, lon) and places. */
  focusPoints(points: { lat: number; lon: number }[], places: Place[] = [], maxK = 12, duration = 550) {
    const b = this.boundsOf(places.map((p) => p.anchor));
    for (const p of points) {
      const [x, y] = this.proj([p.lon, p.lat])!;
      b.addXY(x, y);
    }
    b.pad(10);
    this.fly(this.transformFor(b.box(0.12), maxK), duration);
  }

  /** Where you are (a blue dot), or null. */
  setYou(at: { lat: number; lon: number } | null) {
    this.dirty = true;
    this.you = at ? (this.proj([at.lon, at.lat]) as [number, number]) : null;
  }

  /** The painted land: hills, plains and deserts under the lines (see pipeline/build_relief.py). */
  setRelief(img: HTMLImageElement) {
    this.relief = img;
    this.baseKey = "";
    this.dirty = true;
  }

  /** Towns to name on the land when zoomed in, most important first (`rank`: bigger first). */
  setTowns(list: { lat: number; lon: number; name: string; rank: number }[]) {
    this.townsLL = [...list].sort((a, b) => b.rank - a.rank);
    this.projectNames();
    this.baseKey = "";
    this.dirty = true;
  }

  private projectNames() {
    this.towns = this.townsLL.map((t) => {
      const [x, y] = this.proj([t.lon, t.lat])!;
      return { x, y, name: t.name, rank: t.rank };
    });
    // each state's name where most of its stations are (the middle one, east-west and north-south)
    const by = new Map<string, [number[], number[]]>();
    for (const st of this.net.stations) {
      if (!this.ok[st.i] || !st.state) continue;
      let v = by.get(st.state);
      if (!v) by.set(st.state, (v = [[], []]));
      v[0].push(this.sx[st.i]);
      v[1].push(this.sy[st.i]);
    }
    const mid = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
    this.stateLabels = [...by].filter(([, [xs]]) => xs.length >= 6).map(([name, [xs, ys]]) => ({ x: mid(xs), y: mid(ys), name: name.toUpperCase() }));
  }

  /**
   * The names on the land, in screen space: states from a little zoomed in, towns (a dot and a
   * name) from further in, more of them the closer you look. Quiet, below everything, and never
   * under the photos, the panel or another name.
   */
  private drawNames(c: CanvasRenderingContext2D) {
    const z = this.tf.k / this.transformFor([[0, 0], [1000, 1100]], 1.4).k; // 1: all of India
    // with the weather on, its values are the names worth reading
    if (z < 1.7 || this.weather || (!this.towns.length && !this.stateLabels.length)) return;
    const taken: [number, number, number, number][] = this.safe.map((r) => [r.left, r.top, r.right, r.bottom]);
    const R = this.radius();
    const named = new Set<string>();
    for (const sh of this.shown.values()) {
      if (sh.target <= 0) continue;
      const half = Math.max(R + 3, this.boardWidth(sh.c.title) / 2 + 4); // the photo, and the name board under it
      taken.push([sh.x - half, sh.y - R - 3, sh.x + half, sh.y + R + 36]);
      named.add(sh.c.title);
    }
    taken.push(...this.spotBoxes);
    if (this.spot) {
      named.add(this.spot.name);
      for (const t of this.spot.to) named.add(t.label.split(" · ")[0]);
    }
    if (this.origin && this.ok[this.origin.anchor]) {
      // where you start: its dot, and no second name beside it
      const ox = this.tf.applyX(this.sx[this.origin.anchor]), oy = this.tf.applyY(this.sy[this.origin.anchor]);
      taken.push([ox - 12, oy - 12, ox + 12, oy + 12]);
      named.add(this.origin.name.replace(/\s+(Junction|Jn\.?)$/i, "").replace(/\s*\((.+)\)$/, ""));
    }
    for (const st of this.trip?.stops ?? []) {
      // a trip's numbered stops, and their names under them
      const x = this.tf.applyX(st.x), y = this.tf.applyY(st.y), half = this.boardWidth(st.label) / 2 + 3;
      taken.push([x - 14, y - 14, x + 14, y + 14], [x - half, y + 12, x + half, y + 38]);
      named.add(st.label);
    }
    const free = (b: [number, number, number, number]) =>
      b[0] > 6 && b[1] > 6 && b[2] < this.w - 6 && b[3] < this.h - 6 && !taken.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    const width = (text: string, font: string) => {
      const key = `${font}|${text}`;
      let w = this.nameWidth.get(key);
      if (w === undefined) this.nameWidth.set(key, (w = c.measureText(text).width));
      return w;
    };
    c.save();
    c.textBaseline = "middle";
    // the states, fading in as you zoom in and out again once towns take over
    const sa = Math.min(1, (z - 1.7) / 0.5) * Math.max(0, Math.min(1, (8 - z) / 2));
    if (sa > 0) {
      const font = `650 10px ${FONT}`;
      c.font = font;
      c.letterSpacing = "1.6px";
      c.fillStyle = this.c.muted;
      c.globalAlpha = 0.5 * sa;
      c.textAlign = "center";
      for (const st of this.stateLabels) {
        const x = this.tf.applyX(st.x), y = this.tf.applyY(st.y);
        const w = width(st.name, font) + st.name.length * 1.6;
        const box: [number, number, number, number] = [x - w / 2 - 4, y - 8, x + w / 2 + 4, y + 8];
        if (!free(box)) continue;
        taken.push(box);
        c.fillText(st.name, x, y);
      }
      c.letterSpacing = "0px";
    }
    // the towns: the bigger first; small ones only close in
    if (z >= 2.6) {
      // with the routes drawn there's a lot on the map already: fewer, bigger towns
      const busy = (!!this.origin && !this.trip) || !!this.trip?.legs.length;
      const least = (z < 4 ? 3.6 : z < 7 ? 3 : z < 12 ? 2.6 : z < 24 ? 2.2 : 0) + (busy ? 0.6 : 0);
      const most = (this.w < 720 ? 18 : 36) / (busy ? 2 : 1);
      const font = `550 11px ${FONT}`;
      c.font = font;
      c.textAlign = "left";
      c.lineJoin = "round";
      c.lineWidth = 3;
      c.strokeStyle = this.c.land;
      let n = 0;
      for (const t of this.towns) {
        if (t.rank < least || n >= most) break;
        if (named.has(t.name)) continue;
        const x = this.tf.applyX(t.x), y = this.tf.applyY(t.y);
        if (x < 0 || y < 0 || x > this.w || y > this.h) continue;
        const w = width(t.name, font);
        let box: [number, number, number, number] = [x - 3, y - 8, x + 7 + w, y + 8];
        let left = false;
        if (!free(box)) {
          box = [x - 7 - w, y - 8, x + 3, y + 8];
          left = true;
          if (!free(box)) continue;
        }
        taken.push(box);
        n++;
        named.add(t.name);
        c.globalAlpha = 0.75;
        c.fillStyle = this.c.muted;
        c.beginPath();
        c.arc(x, y, 2, 0, TAU);
        c.fill();
        c.globalAlpha = 0.9;
        const tx = left ? x - 6 - w : x + 6;
        c.strokeText(t.name, tx, y);
        c.fillText(t.name, tx, y);
      }
    }
    c.restore();
  }

  onLand(lat: number, lon: number) {
    const [x, y] = this.proj([lon, lat])!;
    return this.baseCtx.isPointInPath(this.landPath, x, y); // the drawn outline: far quicker than spherical geometry
  }

  /** Zoom in (k > 1) or out, around the middle of the open map. */
  zoomBy(k: number) {
    const { top, right, bottom, left } = this.insets;
    const cx = (left + this.w - right) / 2, cy = (top + this.h - bottom) / 2;
    d3.select(this.canvas).transition("fly").duration(reduceMotion() ? 0 : 250).call(this.zoom.scaleBy, k, [cx, cy]);
  }

  screenOf(p: Place): [number, number] | null {
    if (!this.ok[p.anchor]) return null;
    return [this.tf.applyX(this.sx[p.anchor]), this.tf.applyY(this.sy[p.anchor])];
  }

  // ---------------------------------------------------------------- geometry helpers

  /** Move the view: quick (never more than about half a second), and instant if you prefer less motion. */
  private fly(t: d3.ZoomTransform, duration: number) {
    d3.select(this.canvas).transition("fly").duration(reduceMotion() ? 0 : Math.min(duration, 550)).ease(d3.easeCubicOut)
      .call(this.zoom.transform, t);
  }

  private boundsOf(idx: number[]) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const self = this;
    const api = {
      add(i: number) {
        if (!self.ok[i]) return;
        x0 = Math.min(x0, self.sx[i]); x1 = Math.max(x1, self.sx[i]);
        y0 = Math.min(y0, self.sy[i]); y1 = Math.max(y1, self.sy[i]);
      },
      addXY(x: number, y: number) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      },
      pad(p: number) {
        x0 -= p; y0 -= p; x1 += p; y1 += p;
      },
      box(frac: number): [[number, number], [number, number]] {
        const p = Math.max(6, Math.max(x1 - x0, y1 - y0) * frac);
        return [[x0 - p, y0 - p], [x1 + p, y1 + p]];
      },
    };
    idx.forEach(api.add);
    return api;
  }

  private boundsOfRoutes(): [[number, number], [number, number]] {
    const b = this.boundsOf(this.origin ? [this.origin.anchor] : []);
    for (const r of this.routes) for (const s of r.st) b.add(s);
    return b.box(0.05);
  }

  private transformFor([[x0, y0], [x1, y1]]: [[number, number], [number, number]], maxK: number) {
    const { top, right, bottom, left } = this.insets;
    const L = left + 16, R = this.w - right - 16, T = top + 16, B = this.h - bottom - 16;
    const scale = () => Math.max(0.2, Math.min(maxK, (R - L) / Math.max(1, x1 - x0), (B - T) / Math.max(1, y1 - y0)));
    let k = scale();
    // your station's board stands above it: leave it room, so it isn't cut off at the edge
    const o = this.origin;
    if (o && !this.trip && this.ok[o.anchor]) {
      const ox = this.sx[o.anchor], oy = this.sy[o.anchor];
      if (ox >= x0 && ox <= x1 && oy >= y0 && oy <= y1) {
        const [bw, bh] = this.originBoardSize(o);
        y0 = Math.min(y0, oy - (bh + 10) / k);
        x0 = Math.min(x0, ox - (bw / 2 + 6) / k);
        x1 = Math.max(x1, ox + (bw / 2 + 6) / k);
        k = scale();
      }
    }
    return d3.zoomIdentity.translate((L + R) / 2 - (k * (x0 + x1)) / 2, (T + B) / 2 - (k * (y0 + y1)) / 2).scale(k);
  }

  private minuteAtKm(m: Motion, km: number): number {
    const K = m.k;
    if (!K.length) return 0;
    if (km <= K[0]) return m.t[0];
    let lo = 0, hi = K.length - 1;
    if (km >= K[hi]) return m.t[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (K[mid] <= km) lo = mid;
      else hi = mid;
    }
    const f = K[hi] === K[lo] ? 0 : (km - K[lo]) / (K[hi] - K[lo]);
    return m.t[lo] + (m.t[hi] - m.t[lo]) * f;
  }

  private radius() {
    return this.w < 720 ? 18 : 22;
  }

  // ---------------------------------------------------------------- interaction

  private pointer(e: MouseEvent, click: boolean) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    // sights, then photo bubbles, then small dots
    let sight = -1;
    for (const p of this.sights) {
      const [bx, by] = this.proj([p.lon, p.lat])!;
      if (Math.hypot(this.tf.applyX(bx) - mx, this.tf.applyY(by) - my) < 18) sight = p.i;
    }
    let best: Place | null = null;
    if (sight < 0) {
      const R = this.radius();
      for (const s of this.shown.values()) {
        if (s.alpha < 0.5) continue;
        if (Math.hypot(s.x - mx, s.y - my) < R + 4) best = s.c.place;
      }
      if (!best) {
        let bd = 10;
        for (const d of this.reach) {
          if (!this.ok[d.place.anchor]) continue;
          const dist = Math.hypot(this.tf.applyX(this.sx[d.place.anchor]) - mx, this.tf.applyY(this.sy[d.place.anchor]) - my);
          if (dist < bd) { bd = dist; best = d.place; }
        }
      }
    }
    if (click) {
      if (sight >= 0) this.hooks.onPickSight(sight);
      else if (best) this.hooks.onPick(best);
      else this.hooks.onBackground();
      return;
    }
    if (best !== this.hover || sight !== this.hoverSight) this.dirty = true;
    this.hover = best;
    this.hoverSight = sight;
    this.canvas.style.cursor = best || sight >= 0 ? "pointer" : "";
    this.hooks.onHover(best, mx, my);
  }

  // ---------------------------------------------------------------- frame

  /**
   * Draw only when something changed: the view (pan, zoom, hover, what's selected, a photo that
   * arrived) or a short animation under way (routes fading in, photos appearing). A still map
   * costs nothing.
   */
  private frame(now: number) {
    if (this.fade < 1) this.fade = Math.min(1, (now - this.fadeFrom) / 260);
    let growing = false;
    if (this.limit < this.maxMins) {
      const t = Math.min(1, (now - this.growStart) / 1100);
      const e = 1 - Math.pow(1 - t, 3);
      this.limit = t >= 1 ? Infinity : this.growFrom + (this.maxMins - this.growFrom) * e;
      growing = true;
      this.dirty = true;
    }
    if (this.baseCss && now - this.lastZoom >= 120) this.dirty = true; // the view settled: draw the land crisp
    let fading = this.fade < 1 || growing;
    for (const s of this.shown.values()) if (s.alpha !== s.target) fading = true;
    if (this.dirty || fading) {
      this.draw(Math.min(now - this.lastDraw, 100), true);
      this.dirty = false;
      this.lastDraw = now;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * The land layer follows the view. While you pan or pinch (or the map flies somewhere) it's
   * moved and scaled as a picture, which costs nothing, and redrawn crisp a few times a second
   * and once the view settles: redrawing the coast and every line on each frame of a drag is
   * the slowest thing a phone does here.
   */
  private placeBase(now: number) {
    const { k, x, y } = this.tf;
    const b = this.baseTf;
    const key = `${this.w},${this.h},${this.origin ? 1 : 0}`;
    const moved = b.k !== k || b.x !== x || b.y !== y;
    const ratio = k / b.k;
    const gesture = now - this.lastZoom < 120;
    const renamed = this.namesEpoch !== this.baseNames && !gesture && now - this.baseDrawn > 250;
    if (key !== this.baseKey || renamed || (moved && (!gesture || now - this.baseDrawn > 180 || ratio > 1.25 || ratio < 0.8))) {
      this.baseKey = key;
      this.baseNames = this.namesEpoch;
      this.baseTf = this.tf;
      this.baseDrawn = now;
      this.drawBase();
    }
    const sc = k / this.baseTf.k;
    const tx = x - this.baseTf.x * sc, ty = y - this.baseTf.y * sc;
    const css = sc === 1 && tx === 0 && ty === 0 ? "" : `translate(${tx}px, ${ty}px) scale(${sc})`;
    if (css !== this.baseCss) this.base.style.transform = this.baseCss = css;
  }

  private baseTf = d3.zoomIdentity;
  private baseDrawn = 0;
  private baseCss = "";
  private lastZoom = 0;

  private drawBase() {
    const c = this.baseCtx;
    const { k, x, y } = this.tf;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const g = c.createRadialGradient(this.w * 0.6, this.h * 0.45, 0, this.w * 0.6, this.h * 0.45, Math.max(this.w, this.h) * 0.8);
    g.addColorStop(0, this.c.sea2);
    g.addColorStop(1, this.c.sea);
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
    c.save();
    c.translate(x, y);
    c.scale(k, k);
    // two faint coastline rules, as on a printed map
    c.lineJoin = "round";
    const gap = 5 / k;
    for (let i = 2; i >= 1; i--) {
      c.globalAlpha = i === 2 ? 0.35 : 0.6;
      c.strokeStyle = this.c.ripple;
      c.lineWidth = 2 * i * gap;
      c.stroke(this.landPath);
      c.globalAlpha = 1;
      c.strokeStyle = this.c.sea;
      c.lineWidth = 2 * i * gap - 1 / k;
      c.stroke(this.landPath);
    }
    c.fillStyle = this.c.land;
    c.fill(this.landPath);
    if (this.relief && this.c.reliefAlpha > 0) {
      // the land itself: the Himalaya, the Thar, the Deccan, the Ghats
      c.save();
      c.clip(this.landPath);
      // it's painted at two pixels a map unit: close in, it softens rather than blurs
      c.globalAlpha = this.c.reliefAlpha * (1 - 0.45 * Math.min(1, Math.max(0, (k - 3) / 6)));
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
      c.drawImage(this.relief, 0, 0, 1000, 1100);
      c.restore();
    }
    if (this.weather) {
      // the weather lies on the land only, softly, under the lines
      c.save();
      c.clip(this.landPath);
      c.globalAlpha = this.weather.alpha;
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
      c.drawImage(this.weather.img, 0, 0, 1000, 1100);
      c.restore();
    }
    c.lineWidth = 1 / k;
    c.strokeStyle = this.c.landEdge;
    c.stroke(this.landPath);
    c.lineWidth = 0.9 / k;
    c.strokeStyle = this.c.border;
    c.setLineDash([1.5 / k, 2.5 / k]);
    c.stroke(this.statePath);
    c.setLineDash([6 / k, 5 / k]);
    c.stroke(this.tropicPath);
    c.setLineDash([]);
    // every line in the country, as rails: busier corridors a little heavier, and sleepers across
    // them once you're close enough to see them; quieter while your own routes are drawn
    const faint = (this.origin ? 0.45 : 1) * this.netStrength;
    const widths = [0.55, 0.7, 0.85, 1.05, 1.3];
    const alphas = [0.32, 0.4, 0.5, 0.6, 0.7];
    c.strokeStyle = this.c.rail;
    c.lineCap = "butt";
    this.netPaths.forEach((p, i) => {
      c.globalAlpha = Math.min(1, alphas[i] * faint);
      c.lineWidth = widths[i] / k;
      c.stroke(p);
    });
    if (k >= 2.4) {
      c.setLineDash([0.8 / k, 4.6 / k]);
      c.lineWidth = 3.4 / k;
      this.netPaths.forEach((p, i) => {
        c.globalAlpha = Math.min(1, alphas[i] * faint * 0.75);
        c.stroke(p);
      });
      c.setLineDash([]);
    }
    c.globalAlpha = 1;
    c.restore();
    this.drawNames(c);
    const [tx, ty] = [this.tf.applyX(this.tropicLabel[0]), this.tf.applyY(this.tropicLabel[1])];
    c.font = `italic 400 11px ${NAME}`;
    c.fillStyle = this.c.muted;
    c.globalAlpha = 0.8;
    c.fillText("Tropic of Cancer", tx, ty - 6);
    c.globalAlpha = 1;
  }

  private draw(dt: number, layout = true) {
    const ctx = this.ctx;
    this.placeBase(performance.now());
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.font = "";

    if (this.origin && !this.trip) {
      this.drawRoutes();
      if (this.selectedTrains.length) this.drawSelectedTrain();
      this.drawDots();
    }
    if (this.trip) this.drawTrip();
    if (this.spot) this.drawSpot();
    if (layout) this.layoutBubbles(); // where photos go only changes with the view
    this.drawBubbles(dt);
    this.drawYou();
    if (this.origin && !this.trip) {
      this.drawPicked();
      this.drawOrigin();
    }
    if (this.weather) this.drawWeatherLabels();
    if (this.sights.length) this.drawSights();
  }

  /** The railway-map symbol: sleepers across the rail, in the line's own colour. */
  private ties(stroke: () => void, width: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = width * 3.4;
    ctx.lineCap = "butt";
    ctx.setLineDash([1.3, 5.2]);
    stroke();
    ctx.restore();
  }

  private drawRoutes() {
    const ctx = this.ctx;
    const { k, x, y } = this.tf;
    const focus = this.selected;
    const trainFocus = this.selectedTrains.length > 0;
    const dim = this.sights.length ? 0.1 : this.spot ? 0.22 : focus || trainFocus ? 0.16 : 0.55;
    const close = k >= 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!this.routeCache) {
      this.routeCache = d3.range(BUCKETS).map(() => new Path2D());
      for (const r of this.routes) {
        for (let j = 1; j < r.st.length; j++) {
          const p = this.routeCache[bucketOf((r.mins[j - 1] + r.mins[j]) / 2)];
          p.moveTo(this.sx[r.st[j - 1]], this.sy[r.st[j - 1]]);
          p.lineTo(this.sx[r.st[j]], this.sy[r.st[j]]);
        }
      }
    }
    const cache = this.routeCache;
    const grown = (b: number) => bucketStart(b) <= this.limit;
    ctx.save();
    ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);
    ctx.globalAlpha = dim * this.fade;
    // the rail, then sleepers across it: track, in the colour of how soon you're there
    ctx.lineCap = "butt";
    ctx.lineWidth = (close ? 2.4 : 1.5) / k;
    cache.forEach((p, b) => {
      if (!grown(b)) return;
      ctx.strokeStyle = this.lut[b];
      ctx.stroke(p);
    });
    ctx.setLineDash([1.1 / k, (close ? 5.6 : 4.6) / k]);
    ctx.lineWidth = (close ? 5.6 : 4) / k;
    cache.forEach((p, b) => {
      if (!grown(b)) return;
      ctx.strokeStyle = this.lut[b];
      ctx.stroke(p);
    });
    ctx.setLineDash([]);
    ctx.restore();
    // a place reached only with a change: its quickest way, in livery
    if (focus && !trainFocus && !this.sights.length && this.hintLegs.length) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.c.livery;
      ctx.lineWidth = close ? 4 : 2.6;
      for (const leg of this.hintLegs) {
        const p = this.lineOf(leg.train, leg.train.km[leg.from] - 0.01, leg.train.km[leg.to] + 0.01);
        ctx.stroke(p);
        if (close) this.ties(() => ctx.stroke(p), 1.4);
      }
      this.drawChanges(this.hintLegs, this.c.livery);
    }
    // the lines that reach the selected place, in full livery
    if (focus && !trainFocus && !this.sights.length) {
      const dest = new Set(focus.stations);
      const path = new Path2D();
      for (const r of this.routes) {
        const end = r.st.findIndex((s) => dest.has(s));
        if (end < 1) continue;
        path.moveTo(this.tf.applyX(this.sx[r.st[0]]), this.tf.applyY(this.sy[r.st[0]]));
        for (let j = 1; j <= end; j++) path.lineTo(this.tf.applyX(this.sx[r.st[j]]), this.tf.applyY(this.sy[r.st[j]]));
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.c.livery;
      ctx.lineWidth = close ? 4 : 2.6;
      ctx.stroke(path);
      if (close) this.ties(() => ctx.stroke(path), 1.4);
    }
  }

  private drawSelectedTrain() {
    const ctx = this.ctx;
    const journey = this.selectedTrains.length > 1;
    for (const { leg } of this.selectedTrains) {
      const t = leg.train;
      // the whole train's run, faint and dashed (only for a single train: a journey is busy enough)
      if (!journey) {
        ctx.strokeStyle = this.c.ink;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 4]);
        ctx.stroke(this.lineOf(t, -1, Infinity));
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      const ride = this.lineOf(t, t.km[leg.from] - 0.01, t.km[leg.to] + 0.01);
      ctx.strokeStyle = this.c.halo;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.85;
      ctx.stroke(ride);
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
      ctx.strokeStyle = this.c.accent;
      ctx.lineWidth = 3;
      ctx.stroke(ride);
      this.ties(() => ctx.stroke(ride), 1.4);
    }
    for (const { leg } of this.selectedTrains) {
      const t = leg.train;
      for (let j = leg.from; j <= leg.to; j++) {
        if ((t.arr[j] < 0 && t.dep[j] < 0) || !this.ok[t.st[j]]) continue;
        ctx.beginPath();
        ctx.arc(this.tf.applyX(this.sx[t.st[j]]), this.tf.applyY(this.sy[t.st[j]]), 3.4, 0, TAU);
        ctx.fillStyle = this.c.ring;
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = this.c.accent;
        ctx.stroke();
      }
    }
    if (journey) this.drawChanges(this.selectedTrains.map((x) => x.leg), this.c.accent);
  }

  /** A train's drawn line between two distances along it, in screen space. */
  private lineOf(t: Train, km0: number, km1: number) {
    const g = this.geom(t);
    const p = new Path2D();
    let first = true;
    for (let j = 0; j < g.st.length; j++) {
      if (g.km[j] < km0 || g.km[j] > km1) continue;
      const x = this.tf.applyX(this.sx[g.st[j]]), y = this.tf.applyY(this.sy[g.st[j]]);
      if (first) p.moveTo(x, y);
      else p.lineTo(x, y);
      first = false;
    }
    return p;
  }

  /** Where you change trains: the interchange symbol of a line diagram, two linked rings. */
  private drawChanges(legs: Leg[], color: string) {
    const ctx = this.ctx;
    for (let i = 1; i < legs.length; i++) {
      const a = legs[i - 1].train.st[legs[i - 1].to];
      const b = legs[i].train.st[legs[i].from];
      const pts = [a, b].filter((s) => this.ok[s]).map((s) => [this.tf.applyX(this.sx[s]), this.tf.applyY(this.sy[s])]);
      if (!pts.length) continue;
      if (pts.length === 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineWidth = 5;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, TAU);
        ctx.fillStyle = this.c.ring;
        ctx.fill();
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
  }

  /** Every other reachable place: a station circle, as on a railway map. */
  private drawDots() {
    if (this.sights.length) return;
    const ctx = this.ctx;
    const k = this.tf.k;
    const r = k > 4 ? 3 : k > 1.8 ? 2.3 : 1.7;
    // zoomed out, only the busier stations get a ring; every stop appears as you zoom in
    const minHalts = k >= 3.2 ? 0 : k >= 1.8 ? 25 : k >= 1 ? 70 : 140;
    // one path per colour (and one for the picked place's ring), not two draws per station
    const rings = new Path2D();
    const edges = d3.range(BUCKETS).map(() => new Path2D());
    let picked: [number, number] | null = null;
    for (const d of this.reach) {
      const p = d.place;
      if (!this.ok[p.anchor] || this.shown.get(p)?.alpha === 1) continue;
      if (p.halts < minHalts && p !== this.selected && p !== this.hover) continue;
      if (d.mins > this.limit) continue;
      const x = this.tf.applyX(this.sx[p.anchor]);
      const y = this.tf.applyY(this.sy[p.anchor]);
      if (x < -5 || y < -5 || x > this.w + 5 || y > this.h + 5) continue;
      const rr = p === this.hover ? r + 1.5 : r;
      if (p === this.selected) picked = [x, y];
      rings.moveTo(x + rr, y);
      rings.arc(x, y, rr, 0, TAU);
      const e = edges[bucketOf(d.mins)];
      e.moveTo(x + rr, y);
      e.arc(x, y, rr, 0, TAU);
    }
    ctx.globalAlpha = this.selected ? 0.35 : 1;
    ctx.fillStyle = this.c.ring;
    ctx.fill(rings);
    ctx.lineWidth = 1.15;
    edges.forEach((e, b) => {
      ctx.strokeStyle = this.lut[b];
      ctx.stroke(e);
    });
    if (picked) {
      const [x, y] = picked;
      const d = this.reach.find((d) => d.place === this.selected)!;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, this.selected === this.hover ? r + 1.5 : r, 0, TAU);
      ctx.fillStyle = this.c.ring;
      ctx.fill();
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = this.timeColor(d.mins);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.c.accent;
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** The picked place when no direct train reaches it (so it has no photo): a ring and its board, on top. */
  private pickedAlone(): [number, number] | null {
    const sel = this.selected;
    if (!sel || !this.ok[sel.anchor] || this.sights.length || this.shown.get(sel)?.alpha || this.reach.some((d) => d.place === sel)) return null;
    return [this.tf.applyX(this.sx[sel.anchor]), this.tf.applyY(this.sy[sel.anchor])];
  }

  private drawPicked() {
    const at = this.pickedAlone();
    if (at) {
      const ctx = this.ctx;
      const [x, y] = at;
      const k = this.tf.k;
      const r = k > 4 ? 3 : k > 1.8 ? 2.3 : 1.7;
      const sel = this.selected!;
      ctx.beginPath();
      ctx.arc(x, y, r + 1, 0, TAU);
      ctx.fillStyle = this.c.ring;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.c.accent;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, TAU);
      ctx.stroke();
      this.stationBoard(this.selectedTitle || sel.name, x, y + 12);
    }
  }

  /**
   * Where you start: its station's name board, the yellow one every Indian station has, in the
   * local script, Hindi and English, standing on its two posts at the station.
   */
  private drawOrigin() {
    const o = this.origin;
    if (!o || !this.ok[o.anchor]) return;
    const ctx = this.ctx;
    const x = this.tf.applyX(this.sx[o.anchor]), y = this.tf.applyY(this.sy[o.anchor]);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, TAU);
    ctx.fillStyle = "#111";
    ctx.fill();
    const b = this.originBoard(o);
    const w = b.width / this.dpr, h = b.height / this.dpr;
    ctx.drawImage(b, x - w / 2, y - h - 2, w, h);
  }

  private originBoardSize(o: Place): [number, number] {
    const b = this.originBoard(o);
    return [b.width / this.dpr, b.height / this.dpr];
  }

  private originBoard(o: Place) {
    const key = `${o.id}|${this.dpr}`;
    const hit = this.originBoards.get(key);
    if (hit) return hit;
    const en = o.name.replace(/\s+(Junction|Jn\.?)$/i, "").replace(/\s*\((.+)\)$/, "").toUpperCase();
    const lines: [string, string][] = [];
    if (o.local && o.local !== o.hi) lines.push([o.local, `600 12px ${SCRIPTS}`]);
    if (o.hi) lines.push([o.hi, `500 12.5px 'Noto Sans Devanagari Variable', ${NAME}`]);
    lines.push([en, `600 10.5px ${FONT}`]);
    const m = document.createElement("canvas").getContext("2d")!;
    let tw = 0;
    for (const [t, f] of lines) {
      m.font = f;
      tw = Math.max(tw, m.measureText(t).width + (f.includes(FONT) ? t.length * 0.8 : 0));
    }
    const W = Math.ceil(tw + 18), lineH = 15, boardH = lines.length * lineH + 7, legs = 7;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil((W + 4) * this.dpr);
    cv.height = Math.ceil((boardH + legs + 4) * this.dpr);
    const c = cv.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    c.fillStyle = "#2b2b2b";
    c.fillRect(W * 0.22, boardH, 2, legs + 2);
    c.fillRect(W * 0.78, boardH, 2, legs + 2);
    c.shadowColor = "rgba(0,0,0,0.3)";
    c.shadowBlur = 5;
    c.shadowOffsetY = 2;
    c.fillStyle = "#f4c430";
    c.fillRect(2, 2, W, boardH);
    c.shadowColor = "transparent";
    c.lineWidth = 1.5;
    c.strokeStyle = "#111";
    c.strokeRect(2, 2, W, boardH);
    c.fillStyle = "#111";
    c.textAlign = "center";
    lines.forEach(([t, f], i) => {
      c.font = f;
      if (f.includes(FONT)) c.letterSpacing = "0.8px";
      c.fillText(t, 2 + W / 2, 2 + 15 + i * lineH - 2);
      c.letterSpacing = "0px";
    });
    this.originBoards.set(key, cv);
    return cv;
  }

  /** Where you are: the blue dot of every map, quiet. */
  private drawYou() {
    if (!this.you) return;
    const ctx = this.ctx;
    const x = this.tf.applyX(this.you[0]), y = this.tf.applyY(this.you[1]);
    ctx.fillStyle = "rgba(47, 125, 225, 0.18)";
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#2f7de1";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, TAU);
    ctx.fill();
  }

  /** A little pin with a label. */
  private pin(x: number, y: number, fill: string, text?: string) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.3)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 3, y - 7, x - 10, y - 11, x - 10, y - 18);
    ctx.arc(x, y - 18, 10, Math.PI, 0);
    ctx.bezierCurveTo(x + 10, y - 11, x + 3, y - 7, x, y);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y - 18, 3.6, 0, TAU);
    ctx.fillStyle = this.c.ring;
    ctx.fill();
    if (text) this.stationBoard(text, x, y + 4);
  }

  private drawSpot() {
    const sp = this.spot!;
    const ctx = this.ctx;
    const x = this.tf.applyX(sp.x), y = this.tf.applyY(sp.y);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = this.c.ink;
    ctx.globalAlpha = 0.6;
    for (const t of sp.to) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(this.tf.applyX(this.sx[t.anchor]), this.tf.applyY(this.sy[t.anchor]));
      ctx.stroke();
    }
    ctx.restore();
    // labels below their station, else above, right or left: never on top of one another
    const pinHalf = this.boardWidth(sp.name) / 2;
    const taken: [number, number, number, number][] = [[x - 11, y - 30, x + 11, y], [x - pinHalf - 2, y + 2, x + pinHalf + 2, y + 26]];
    // how badly a label would sit there: off the canvas, or over what's already drawn
    const clash = (b: [number, number, number, number]) => {
      const off = b[0] < 4 || b[2] > this.w - 4 || b[1] < 4 || b[3] > this.h - 4 ? 1e6 : 0;
      return off + taken.reduce((a, o) => a + Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1])), 0);
    };
    for (const t of sp.to) {
      const sx = this.tf.applyX(this.sx[t.anchor]), sy = this.tf.applyY(this.sy[t.anchor]);
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, TAU);
      ctx.fillStyle = this.c.ring;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.c.livery;
      ctx.stroke();
      taken.push([sx - 6, sy - 6, sx + 6, sy + 6]);
    }
    for (const t of sp.to) {
      const sx = this.tf.applyX(this.sx[t.anchor]), sy = this.tf.applyY(this.sy[t.anchor]);
      const half = this.boardWidth(t.label) / 2;
      // below, above, beside; then further out, for stations that sit close together (Kasol's three
      // in the Sutlej valley): the first clear place, else the least crowded one
      const spots: [number, number][] = [[sx, sy + 8], [sx, sy - 30], [sx + half + 10, sy - 11], [sx - half - 10, sy - 11],
        [sx + half + 8, sy + 6], [sx - half - 8, sy + 6], [sx + half + 8, sy - 28], [sx - half - 8, sy - 28],
        [sx, sy + 32], [sx, sy - 54], [sx + half + 10, sy + 20], [sx - half - 10, sy + 20]];
      const box = ([cx, top]: [number, number]): [number, number, number, number] => [cx - half - 2, top - 1, cx + half + 2, top + 23];
      let at = spots[0], worst = Infinity;
      for (const c of spots) {
        const v = clash(box(c));
        if (v < worst) [at, worst] = [c, v];
        if (v === 0) break;
      }
      taken.push(box(at));
      // set further out: a hairline back to its station
      const ly = Math.max(at[1], Math.min(at[1] + 22, sy)), lx = Math.max(at[0] - half, Math.min(at[0] + half, sx));
      if (Math.hypot(lx - sx, ly - sy) > 12) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(lx, ly);
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.c.livery;
        ctx.globalAlpha = 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      this.stationBoard(t.label, at[0], at[1]);
    }
    this.pin(x, y, this.c.accent, sp.name);
    // the names on the land keep clear of all this (they're drawn underneath, less often)
    const sig = taken.map((t) => t.map(Math.round).join()).join(";");
    if (sig !== this.spotSig) {
      this.spotSig = sig;
      this.spotBoxes = taken;
      this.namesEpoch++;
    }
  }
  private spotBoxes: [number, number, number, number][] = [];
  private spotSig = "";

  private drawTrip() {
    const tr = this.trip!;
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const leg of tr.legs) {
      const p = this.lineOf(leg.train, leg.train.km[leg.from] - 0.01, leg.train.km[leg.to] + 0.01);
      ctx.strokeStyle = this.c.halo;
      ctx.lineWidth = 6;
      ctx.stroke(p);
      ctx.strokeStyle = this.c.accent;
      ctx.lineWidth = 3.2;
      ctx.stroke(p);
    }
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = this.c.accent;
    for (const [x, y, anchor] of tr.roads) {
      ctx.beginPath();
      ctx.moveTo(this.tf.applyX(x), this.tf.applyY(y));
      ctx.lineTo(this.tf.applyX(this.sx[anchor]), this.tf.applyY(this.sy[anchor]));
      ctx.stroke();
    }
    for (const [x0, y0, x1, y1] of tr.links) {
      ctx.beginPath();
      ctx.moveTo(this.tf.applyX(x0), this.tf.applyY(y0));
      ctx.lineTo(this.tf.applyX(x1), this.tf.applyY(y1));
      ctx.stroke();
    }
    ctx.restore();
    for (const s of tr.stops) {
      const x = this.tf.applyX(s.x), y = this.tf.applyY(s.y);
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, TAU);
      ctx.fillStyle = this.c.accent;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = this.c.ring;
      ctx.stroke();
      this.plainFont(750, 11.5);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(String(s.n), x, y + 4);
      ctx.textAlign = "start";
      this.stationBoard(s.label, x, y + 14);
    }
  }

  /** The weather's values at a few towns, small and quiet. */
  private drawWeatherLabels() {
    const ctx = this.ctx;
    // keep clear of the photos and their names
    const R = this.radius();
    const placed: [number, number, number, number][] = [...this.shown.values()].filter((s) => s.alpha > 0.5).map((s) => [s.x - R - 4, s.y - R - 4, s.x + R + 4, s.y + R + 44]);
    for (const l of this.weather!.labels) {
      const x = this.tf.applyX(l.x), y = this.tf.applyY(l.y);
      if (x < 10 || y < 10 || x > this.w - 10 || y > this.h - 10) continue;
      this.plainFont(l.strong ? 750 : 650, l.strong ? 13 : 11.5);
      const w = ctx.measureText(l.text).width + 10;
      const box: [number, number, number, number] = [x - w / 2, y - 10, x + w / 2, y + 10];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      if (this.safe.some((r) => x > r.left && x < r.right && y > r.top && y < r.bottom)) continue;
      placed.push(box);
      ctx.fillStyle = this.c.board;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(box[0], box[1], w, 20, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.c.boardInk;
      ctx.textAlign = "center";
      ctx.fillText(l.text, x, y + 4);
      ctx.textAlign = "start";
    }
  }

  private selectedTitle = "";

  /** The name to put on the selected place's board when it has no photo bubble. */
  setSelectedTitle(t: string) {
    this.dirty = true;
    this.selectedTitle = t;
  }

  // ---------------------------------------------------------------- photo bubbles, named on station boards

  private labelWidth = new Map<string, number>();

  /** Label lettering: semibold, as written. */
  private boardFont(size = 12.5) {
    this.setFont(`400 ${size}px ${NAME}`, "normal");
  }

  private plainFont(weight: number, size: number) {
    this.setFont(`${weight} ${size}px ${FONT}`, "normal");
  }

  /** The canvas parses every font it's given, so only hand it a new one. */
  private font = "";
  private setFont(font: string, stretch: "condensed" | "normal") {
    const key = font + stretch;
    if (key === this.font) return;
    this.font = key;
    this.ctx.font = font;
    if ("fontStretch" in this.ctx) this.ctx.fontStretch = stretch;
  }

  private boardWidth(text: string) {
    let w = this.labelWidth.get(text);
    if (w === undefined) {
      this.boardFont();
      w = this.ctx.measureText(text).width + 16;
      this.labelWidth.set(text, w);
    }
    return w;
  }

  /** A small yellow station board with a black keyline, centred on (x, top). */
  private stationBoard(text: string, x: number, top: number, under?: string) {
    const sprite = this.board(text, under);
    this.ctx.drawImage(sprite, x - sprite.width / this.dpr / 2, top - 2, sprite.width / this.dpr, sprite.height / this.dpr);
  }

  /**
   * The board, and the ride's length under it, drawn once into a small canvas and copied from
   * then on: lettering is the slowest thing a canvas draws, and photos carry a board each frame.
   */
  private boards = new Map<string, HTMLCanvasElement>();
  private board(text: string, under?: string) {
    const id = `${text}|${under ?? ""}`;
    const hit = this.boards.get(id);
    if (hit) return hit;
    const w = this.boardWidth(text);
    const under_w = under ? (this.plainFont(600, 10.5), this.ctx.measureText(under).width + 8) : 0;
    const W = Math.ceil(Math.max(w, under_w) + 8), H = under ? 38 : 24;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(W * this.dpr);
    cv.height = Math.ceil(H * this.dpr);
    const c = cv.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    const x = W / 2, top = 2, h = 19;
    c.shadowColor = "rgba(15, 23, 42, 0.18)";
    c.shadowBlur = 4;
    c.shadowOffsetY = 1;
    c.fillStyle = this.c.board;
    c.beginPath();
    c.roundRect(x - w / 2, top, w, h, h / 2);
    c.fill();
    c.shadowColor = "transparent";
    c.font = `400 12.5px ${NAME}`;
    c.fillStyle = this.c.boardInk;
    c.textAlign = "center";
    c.fillText(text, x, top + 13.8);
    if (under) {
      c.font = `600 11px ${FONT}`;
      c.lineJoin = "round";
      c.lineWidth = 3;
      c.strokeStyle = this.c.halo;
      c.strokeText(under, x, top + 31);
      c.fillStyle = this.c.muted;
      c.fillText(under, x, top + 31);
    }
    if (this.boards.size > 400) this.boards.clear();
    this.boards.set(id, cv);
    return cv;
  }

  private layoutBubbles() {
    const R = this.radius();
    const narrow = this.w < 720;
    const k = this.tf.k;
    // a few photos, never crowding: more as you zoom in
    const maxN = Math.round(Math.min(narrow ? 10 : 18, (narrow ? 4 : 7) + (narrow ? 2.5 : 4) * Math.log2(Math.max(1, k * 1.4))));
    const boxes: [number, number, number, number][] = this.safe.map((r) => [r.left - 8, r.top - 8, r.right + 8, r.bottom + 8]);
    if (this.origin && this.ok[this.origin.anchor]) {
      // your station's board
      const ox = this.tf.applyX(this.sx[this.origin.anchor]), oy = this.tf.applyY(this.sy[this.origin.anchor]);
      const [bw, bh] = this.originBoardSize(this.origin);
      boxes.push([ox - bw / 2 - 4, oy - bh - 6, ox + bw / 2 + 4, oy + 8]);
    }
    const alone = this.pickedAlone();
    if (alone) {
      const half = this.boardWidth(this.selectedTitle || this.selected!.name) / 2;
      boxes.push([alone[0] - Math.max(half, 10), alone[1] - 10, alone[0] + Math.max(half, 10), alone[1] + 32]);
    }
    const placed = new Map<Place, [number, number]>();
    const H = archH(R);
    const off = H / 2 + 8;
    // where a photo may float: above its station first, then below, beside, diagonal
    const spots: [number, number][] = [[0, -off], [0, off + 4], [-R - 22, -6], [R + 22, -6], [-R - 10, -off], [R + 10, -off], [-R - 10, off], [R + 10, off]];
    const overlaps = (box: [number, number, number, number]) => {
      if (box[0] < 4 || box[1] < 4 || box[2] > this.w - 4 || box[3] > this.h - 4) return true;
      for (const b of boxes) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return true;
      return false;
    };
    const tryPlace = (c: BubbleCandidate) => {
      const p = c.place;
      if (placed.size >= maxN || placed.has(p) || !this.ok[p.anchor]) return;
      if (c.mins !== null && c.mins > this.limit) return; // the lines haven't reached it yet
      if (this.sights.length || this.spot || this.trip) return; // a place's sights, a place without a station, a trip: keep the map quiet
      const x = this.tf.applyX(this.sx[p.anchor]);
      const y = this.tf.applyY(this.sy[p.anchor]);
      const half = Math.max(R + 3, this.boardWidth(c.title) / 2 + 2);
      const below = 30; // its name
      const prev = this.shown.get(p);
      const order = prev?.target ? [[prev.dx, prev.dy] as [number, number], ...spots] : spots; // don't jump around
      for (const [dx, dy] of order) {
        const cx = x + dx, cy = y + dy;
        const box: [number, number, number, number] = [cx - half, cy - H / 2 - 4, cx + half, cy + H / 2 + below];
        if (overlaps(box)) continue;
        boxes.push(box, [x - 4, y - 4, x + 4, y + 4]);
        placed.set(p, [dx, dy]);
        return;
      }
    };
    // the selected place always gets a bubble; the rest by score (fading covers any reshuffle)
    if (this.selected) {
      const c = this.cands.find((c) => c.place === this.selected);
      if (c) tryPlace(c);
    }
    for (const c of this.cands) tryPlace(c);
    for (const [p, [dx, dy]] of placed) {
      const s = this.shown.get(p);
      if (s) {
        s.dx = dx;
        s.dy = dy;
      } else {
        this.shown.set(p, { c: this.cands.find((c) => c.place === p)!, alpha: 0, target: 1, x: 0, y: 0, dx, dy });
      }
    }
    for (const [p, s] of this.shown) s.target = placed.has(p) ? 1 : 0;
    // other photos than before: the names on the land make room for them
    const sig = [...placed.keys()].map((p) => p.id).join();
    if (sig !== this.placedSig) {
      this.placedSig = sig;
      this.namesEpoch++;
    }
  }
  private placedSig = "";
  private namesEpoch = 0;
  private baseNames = 0;

  private disc(photo: Photo | null, key: string, R: number): HTMLCanvasElement | null {
    const id = `${key}|${R}`;
    const hit = this.discs.get(id);
    if (hit) return hit;
    if (!photo) return null;
    const w = 2 * R, h = archH(R);
    const img = loadedImage(photoUrl(photo, coverWidth(photo, w * this.dpr, h * this.dpr)), () => (this.dirty = true)); // draw it once it's here
    if (!img) return null;
    const pad = 6;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil((w + pad * 2) * this.dpr);
    cv.height = Math.ceil((h + pad * 2) * this.dpr);
    const c = cv.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    c.shadowColor = "rgba(20, 28, 60, 0.35)";
    c.shadowBlur = 6;
    c.shadowOffsetY = 2;
    c.beginPath();
    archPath(c, pad, pad, w, h);
    c.fillStyle = this.c.ring;
    c.fill();
    c.shadowColor = "transparent";
    c.save();
    c.beginPath();
    archPath(c, pad + 1.5, pad + 1.5, w - 3, h - 3);
    c.clip();
    const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    c.imageSmoothingQuality = "high";
    c.drawImage(img, pad + w / 2 - (img.naturalWidth * sc) / 2, pad + h / 2 - (img.naturalHeight * sc) / 2, img.naturalWidth * sc, img.naturalHeight * sc);
    c.restore();
    // the rim, in turmeric, up the sides and round the cusps
    c.beginPath();
    archPath(c, pad + 0.8, pad + 0.8, w - 1.6, h - 1.6);
    c.lineWidth = 1.8;
    c.strokeStyle = "#d99a2b";
    c.stroke();
    this.discs.set(id, cv);
    return cv;
  }

  private drawBubbles(dt: number) {
    const ctx = this.ctx;
    const R = this.radius();
    const ease = Math.min(1, dt / 140);
    const order = [...this.shown.values()].sort((a, b) => a.c.score - b.c.score);
    for (const s of order) {
      s.alpha += (s.target - s.alpha) * ease;
      if (Math.abs(s.alpha - s.target) < 0.01) s.alpha = s.target;
      if (s.alpha <= 0) {
        this.shown.delete(s.c.place);
        continue;
      }
      const p = s.c.place;
      const sx = this.tf.applyX(this.sx[p.anchor]);
      const sy = this.tf.applyY(this.sy[p.anchor]);
      const focus = p === this.hover || p === this.selected;
      const pop = s.target ? d3.easeCubicOut(s.alpha) : s.alpha;
      const scale = (focus ? 1.08 : 1) * (0.7 + 0.3 * pop);
      const w = 2 * R * scale, h = archH(R) * scale;
      const bx = sx + s.dx * pop;
      const y = sy + s.dy * pop; // the arch floats beside its station, tethered to it
      s.x = bx;
      s.y = y;
      const len = Math.hypot(bx - sx, y - sy);
      ctx.globalAlpha = s.alpha * 0.55;
      ctx.strokeStyle = this.c.ink;
      ctx.lineWidth = 1.1;
      if (len > h / 2) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx - ((bx - sx) / len) * (h / 2), y - ((y - sy) / len) * (h / 2));
        ctx.stroke();
      }
      ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.8, 0, TAU);
      ctx.fillStyle = this.c.ring;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const disc = this.disc(s.c.photo, s.c.place.id, R);
      if (disc) {
        const k = scale;
        ctx.drawImage(disc, bx - (R + 6) * k, y - (archH(R) / 2 + 6) * k, (2 * R + 12) * k, (archH(R) + 12) * k);
      } else {
        ctx.beginPath();
        archPath(ctx, bx - w / 2, y - h / 2, w, h);
        ctx.fillStyle = this.c.land;
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = "#d99a2b";
        ctx.stroke();
        ctx.font = `400 ${Math.round(R * 0.9)}px ${NAME}`;
        this.font = "";
        ctx.fillStyle = this.c.ink;
        ctx.textAlign = "center";
        ctx.fillText(s.c.title.slice(0, 1), bx, y + R * 0.35);
        ctx.textAlign = "start";
      }
      if (p === this.selected) {
        ctx.beginPath();
        archPath(ctx, bx - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = this.c.accent;
        ctx.stroke();
      }
      // its name, and how long the ride is when you're looking at it
      if (pop > 0.6) {
        ctx.globalAlpha = s.alpha * Math.min(1, (pop - 0.6) * 2.5);
        this.stationBoard(s.c.title, bx, y + h / 2 + 4, focus && s.c.mins !== null ? fmtMins(s.c.mins) : undefined);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawSights() {
    const ctx = this.ctx;
    const R = 16;
    const placed: [number, number, number, number][] = [];
    // the station you'd arrive at, for scale: a small platform sign
    if (this.selected) {
      for (const st of this.selected.stations) {
        if (!this.ok[st]) continue;
        const x = this.tf.applyX(this.sx[st]), y = this.tf.applyY(this.sy[st]);
        const label = this.net.stations[st].code;
        this.stationBoard(label, x, y - 9);
        const w = this.boardWidth(label);
        placed.push([x - w / 2, y - 9, x + w / 2, y + 9]);
      }
    }
    for (const p of this.sights) {
      const [bx, by] = this.proj([p.lon, p.lat])!;
      const x = this.tf.applyX(bx), y = this.tf.applyY(by);
      if (x < -30 || y < -30 || x > this.w + 30 || y > this.h + 30) continue;
      const active = p.i === this.activeSight || p.i === this.hoverSight;
      const r = active ? R * 1.25 : R;
      const disc = this.disc(p.photo, `sight:${p.name}`, R);
      if (disc) {
        const m = (R + 8) * (r / R);
        ctx.drawImage(disc, x - m, y - m, m * 2, m * 2);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fillStyle = this.c.land;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r + 0.5, 0, TAU);
      ctx.lineWidth = active ? 3 : 1;
      ctx.strokeStyle = active ? this.c.accent : "rgba(0,0,0,0.18)";
      ctx.stroke();
      this.plainFont(700, 11.5);
      const w = ctx.measureText(p.name).width;
      const box: [number, number, number, number] = [x - w / 2 - 3, y + r + 4, x + w / 2 + 3, y + r + 19];
      if (!active && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.textAlign = "center";
      ctx.lineWidth = 3.5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = this.c.halo;
      ctx.strokeText(p.name, x, y + r + 16);
      ctx.fillStyle = this.c.ink;
      ctx.fillText(p.name, x, y + r + 16);
      ctx.textAlign = "start";
    }
  }
}
