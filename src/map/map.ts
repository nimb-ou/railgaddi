// The atlas. India drawn on canvas with the rail network glowing faintly. Pick a
// starting point and the routes out of it spread outward, coloured by how long the
// ride takes. The best places to go float above the map as photo bubbles: a few
// at first, more as you zoom in.
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";
import type { Topology } from "topojson-specification";
import { fmtMins } from "../core/format";
import type { Geom, Network, Place, Train } from "../core/network";
import type { Photo } from "../core/places";
import type { BubbleCandidate } from "../core/rank";
import type { Leg } from "../core/trips";
import { coverWidth, drawCover, loadedImage, photoUrl } from "../ui/photos";

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
  board: string; boardInk: string;
}

/** Timetable minutes that pass per real second: slow enough to read, fast enough to see move. */
const SIM_SPEED = 3;
/** Length of a train's streak, in timetable minutes behind it. */
const TAIL = 14;

const LOCAL = new Set(["Pass", "MEMU", "DEMU", "Toy", "Spl"]);
const PREMIUM = new Set(["Raj", "Shtb", "Drnt", "JShtb", "VB", "AB"]);

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
const BUCKETS = 28;
const MAX_MINS = 36 * 60;
const bucketOf = (m: number) => Math.min(BUCKETS - 1, Math.floor(Math.sqrt(Math.max(0, m) / MAX_MINS) * BUCKETS));
const bucketMins = (b: number) => ((b + 0.5) / BUCKETS) ** 2 * MAX_MINS;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT = "'Archivo Variable', 'Archivo', system-ui, sans-serif";

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
  private everyone: Motion[] = [];
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
  private discs = new Map<string, HTMLCanvasElement>();
  private selected: Place | null = null;
  private selectedTrains: { leg: Leg; motion: Motion }[] = []; // one train, or a journey's trains
  private hintLegs: Leg[] = []; // the best way with a change, drawn quietly while a place is open
  private sights: SightPin[] = [];
  private activeSight = -1;
  private hover: Place | null = null;
  private hoverSight = -1;
  private revealMins = Infinity;
  private revealSegs: { m: number; b: number; a: number; z: number }[] = [];
  private revealAt = 0;
  private laidOut = 0;
  private revealPaths: Path2D[] = [];
  private revealFrom = 0;
  private maxMins = 1;
  private lastFrame = 0;
  private lastDraw = 0;
  private dirty = true; // something changed since the last drawing

  simMinute = 0; // timetable clock, minutes of day
  private toward = false; // routes lead into the centre place instead of out of it
  playing = true;
  onClock: (m: number) => void = () => {};

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
    };
    this.labelWidth.clear();
    this.boards.clear();
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

  /** The national network (edges weighted by trains) and every train's motion, from the current lines. */
  private indexNetwork() {
    const em = new Map<number, { a: number; b: number; w: number }>();
    this.everyone = [];
    for (const t of this.net.trains) {
      const g = t.geom;
      for (let j = 1; j < g.st.length; j++) {
        const a = Math.min(g.st[j - 1], g.st[j]);
        const b = Math.max(g.st[j - 1], g.st[j]);
        const e = em.get(a * 100000 + b);
        if (e) e.w++;
        else em.set(a * 100000 + b, { a, b, w: 1 });
      }
      // the landing map shows a calm sample: long-distance trains, about one in three
      const long = !LOCAL.has(t.type) && t.arr[t.st.length - 1] - t.dep[0] >= 180;
      if (long && (PREMIUM.has(t.type) || (t.i * 2654435761) % 3 === 0)) this.everyone.push(this.motion(t, 0, t.st.length - 1));
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
      if (animate && !reduceMotion() && origin) {
        this.revealMins = 0;
        this.revealFrom = performance.now() + 900;
        // every stretch of every route, in the order the spreading lines reach it
        this.revealSegs = [];
        for (const r of this.routes) {
          for (let j = 1; j < r.st.length; j++) {
            const m = (r.mins[j - 1] + r.mins[j]) / 2;
            this.revealSegs.push({ m, b: bucketOf(m), a: r.st[j - 1], z: r.st[j] });
          }
        }
        this.revealSegs.sort((p, q) => p.m - q.m);
        this.revealAt = 0;
        this.revealPaths = d3.range(BUCKETS).map(() => new Path2D());
      } else {
        this.revealMins = Infinity;
      }
    }
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
    this.selectedTrains = legs.map((leg) => ({ leg, motion: this.motion(leg.train, 0, leg.train.st.length - 1) }));
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
    const o = this.origin.anchor;
    const d = reduceMotion() ? 0 : 1;
    d3.select(this.canvas)
      .transition("fly")
      .duration(800 * d)
      .ease(d3.easeCubicInOut)
      .call(this.zoom.transform, this.transformFor([[this.sx[o] - 25, this.sy[o] - 25], [this.sx[o] + 25, this.sy[o] + 25]], 8))
      .transition()
      .delay(200 * d)
      .duration(1600 * d)
      .ease(d3.easeCubicInOut)
      .call(this.zoom.transform, this.transformFor(this.boundsOfCore(), 7));
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

  screenOf(p: Place): [number, number] | null {
    if (!this.ok[p.anchor]) return null;
    return [this.tf.applyX(this.sx[p.anchor]), this.tf.applyY(this.sy[p.anchor])];
  }

  // ---------------------------------------------------------------- geometry helpers

  private fly(t: d3.ZoomTransform, duration: number) {
    d3.select(this.canvas).transition("fly").duration(reduceMotion() ? 0 : duration).ease(d3.easeCubicInOut)
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
    const k = Math.max(0.2, Math.min(maxK, (R - L) / Math.max(1, x1 - x0), (B - T) / Math.max(1, y1 - y0)));
    return d3.zoomIdentity.translate((L + R) / 2 - (k * (x0 + x1)) / 2, (T + B) / 2 - (k * (y0 + y1)) / 2).scale(k);
  }

  private at(g: Geom, km: number): [number, number] {
    const K = g.km;
    let lo = 0, hi = K.length - 1;
    if (km <= K[0]) return [this.sx[g.st[0]], this.sy[g.st[0]]];
    if (km >= K[hi]) return [this.sx[g.st[hi]], this.sy[g.st[hi]]];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (K[mid] <= km) lo = mid;
      else hi = mid;
    }
    const f = K[hi] === K[lo] ? 0 : (km - K[lo]) / (K[hi] - K[lo]);
    const a = g.st[lo], b = g.st[hi];
    return [this.sx[a] + (this.sx[b] - this.sx[a]) * f, this.sy[a] + (this.sy[b] - this.sy[a]) * f];
  }

  private kmAt(m: Motion, minute: number): number | null {
    const T = m.t;
    if (!T.length || minute < 0 || minute > m.end) return null;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (T[mid] <= minute) lo = mid;
      else hi = mid;
    }
    const f = T[hi] === T[lo] ? 0 : (minute - T[lo]) / (T[hi] - T[lo]);
    return m.k[lo] + (m.k[hi] - m.k[lo]) * Math.max(0, Math.min(1, f));
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
          if (!this.ok[d.place.anchor] || d.mins > this.revealMins) continue;
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
   * arrived), an animation under way (lines spreading out, photos fading), or the moving trains,
   * which move about a pixel a second and are redrawn four to twelve times a second, by zoom. An
   * idle map costs nothing, which matters on a phone.
   */
  private frame(now: number) {
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 100) : 16;
    this.lastFrame = now;
    const moving = this.playing && !reduceMotion();
    if (moving) {
      this.simMinute = (this.simMinute + (dt / 1000) * SIM_SPEED) % 1440; // timetable minutes per real second
      this.onClock(this.simMinute);
    }
    if (this.revealMins !== Infinity) {
      const p = (now - this.revealFrom) / 2400;
      this.revealMins = p >= 1 ? Infinity : Math.max(0, d3.easeCubicOut(Math.max(0, p)) * this.maxMins);
      if (p >= 1) this.dirty = true; // the last frame: every line, and photos laid out once more
    }
    if (this.baseCss && now - this.lastZoom >= 120) this.dirty = true; // the view settled: draw the land crisp
    let fading = false;
    for (const s of this.shown.values()) if (s.alpha !== s.target) fading = true;
    const animating = fading || this.revealMins !== Infinity;
    // trains move about a pixel a second with the whole country in view: a few redraws a second
    // are as smooth as many; zoomed in, they cross pixels faster and get more
    const every = Math.max(80, Math.min(250, 250 / this.tf.k));
    if (this.dirty || animating || (moving && now - this.lastDraw > every)) {
      this.draw(Math.min(now - this.lastDraw, 100), this.dirty || animating);
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
    if (key !== this.baseKey || (moved && (!gesture || now - this.baseDrawn > 180 || ratio > 1.25 || ratio < 0.8))) {
      this.baseKey = key;
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
    // every line in the country, faint, busier corridors a little darker
    const faint = (this.origin ? 0.3 : 0.85) * this.netStrength;
    const widths = [0.5, 0.7, 0.9, 1.1, 1.4];
    const alphas = [0.14, 0.2, 0.28, 0.36, 0.46];
    c.strokeStyle = this.c.net;
    c.lineCap = "round";
    this.netPaths.forEach((p, i) => {
      c.globalAlpha = Math.min(1, alphas[i] * faint);
      c.lineWidth = widths[i] / k;
      c.stroke(p);
    });
    c.globalAlpha = 1;
    c.restore();
    const [tx, ty] = [this.tf.applyX(this.tropicLabel[0]), this.tf.applyY(this.tropicLabel[1])];
    c.font = `italic 500 10.5px ${FONT}`;
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

    if (this.origin) {
      this.drawRoutes();
      if (this.selectedTrains.length) this.drawSelectedTrain();
      this.drawDots();
    }
    this.drawTrains();
    // where photos go only changes with the view (and, while lines spread out, a few times a second)
    if (layout && (this.revealMins === Infinity || performance.now() - this.laidOut > 150)) {
      this.layoutBubbles();
      this.laidOut = performance.now();
    }
    this.drawBubbles(dt);
    if (this.origin) this.drawPicked();
    if (this.sights.length) this.drawSights();
  }

  /** The railway-map symbol: once zoomed in, lines get pale sleeper ties. */
  private ties(stroke: () => void, width: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.c.land;
    ctx.lineWidth = width;
    ctx.lineCap = "butt";
    ctx.setLineDash([width * 2.4, width * 3]);
    stroke();
    ctx.restore();
  }

  private drawRoutes() {
    const ctx = this.ctx;
    const { k, x, y } = this.tf;
    const focus = this.selected;
    const trainFocus = this.selectedTrains.length > 0;
    const dim = this.sights.length ? 0.1 : focus || trainFocus ? 0.16 : 0.55;
    const close = k >= 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (this.revealMins === Infinity) {
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
      ctx.save();
      ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);
      ctx.lineWidth = (close ? 3 : 1.25) / k;
      ctx.globalAlpha = dim;
      cache.forEach((p, b) => {
        ctx.strokeStyle = this.lut[b];
        ctx.stroke(p);
      });
      if (close && dim > 0.5) this.ties(() => cache.forEach((p) => ctx.stroke(p)), 1.2 / k);
      ctx.restore();
    } else {
      // spreading out from the origin, minute by minute of travel: each frame adds the newly
      // reached stretches to one path per colour, and draws those few paths
      const segs = this.revealSegs;
      while (this.revealAt < segs.length && segs[this.revealAt].m <= this.revealMins) {
        const g = segs[this.revealAt++];
        const path = this.revealPaths[g.b];
        path.moveTo(this.sx[g.a], this.sy[g.a]);
        path.lineTo(this.sx[g.z], this.sy[g.z]);
      }
      ctx.save();
      ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);
      ctx.lineWidth = 1.4 / k;
      ctx.globalAlpha = 0.7;
      this.revealPaths.forEach((path, b) => {
        ctx.strokeStyle = this.lut[b];
        ctx.stroke(path);
      });
      ctx.restore();
      this.font = "";
    }
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
      ctx.strokeStyle = this.c.accent;
      ctx.lineWidth = 4;
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
      if (!this.ok[p.anchor] || d.mins > this.revealMins || this.shown.get(p)?.alpha === 1) continue;
      if (p.halts < minHalts && p !== this.selected && p !== this.hover) continue;
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

  private selectedTitle = "";

  /** The name to put on the selected place's board when it has no photo bubble. */
  setSelectedTitle(t: string) {
    this.dirty = true;
    this.selectedTitle = t;
  }

  private drawTrains() {
    const ctx = this.ctx;
    // Trains as short streaks along their lines, brightest at the head, fading in and out at the
    // ends. Hundreds of them: gathered into a few paths by how faded they are, and drawn together.
    const BANDS = 4;
    let tails: Path2D[] = [], heads: Path2D[] = [];
    const begin = () => {
      tails = d3.range(BANDS).map(() => new Path2D());
      heads = d3.range(BANDS).map(() => new Path2D());
    };
    const add = (m: Motion, head: number) => {
      const e = (this.simMinute - m.dep0 + 1440) % 1440;
      const minute = this.kmAt(m, e) !== null ? e : m.end > 1440 && this.kmAt(m, e + 1440) !== null ? e + 1440 : -1;
      if (minute < 0) return;
      const km = this.kmAt(m, minute)!;
      const [hx, hy] = this.at(m.geom, km);
      const x = this.tf.applyX(hx), y = this.tf.applyY(hy);
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) return;
      const fade = Math.min(1, minute / 12, (m.end - minute) / 12);
      const band = Math.min(BANDS - 1, Math.floor(fade * BANDS));
      const tailKm = this.kmAt(m, Math.max(0, minute - TAIL)) ?? km;
      if (tailKm < km - 0.2) {
        // the streak follows the track: a few points between tail and head
        const t = tails[band];
        for (let i = 0; i <= 4; i++) {
          const [px, py] = i === 4 ? [hx, hy] : this.at(m.geom, tailKm + ((km - tailKm) * i) / 4);
          const sx = this.tf.applyX(px), sy = this.tf.applyY(py);
          if (i === 0) t.moveTo(sx, sy);
          else t.lineTo(sx, sy);
        }
      }
      heads[band].moveTo(x + head, y);
      heads[band].arc(x, y, head, 0, TAU);
    };
    const flush = (width: number, alpha: number) => {
      ctx.lineWidth = width;
      for (let b = 0; b < BANDS; b++) {
        const fade = (b + 1) / BANDS;
        ctx.globalAlpha = alpha * fade;
        ctx.stroke(tails[b]);
        ctx.globalAlpha = Math.min(1, alpha * 1.6) * fade;
        ctx.fill(heads[b]);
      }
      ctx.globalAlpha = 1;
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!this.origin) {
      // a calm sample of the country's long-distance trains, moving by the timetable
      ctx.strokeStyle = ctx.fillStyle = this.c.livery;
      begin();
      for (const m of this.everyone) add(m, 1.1);
      flush(1.1, 0.3);
      return;
    }
    if (this.revealMins !== Infinity) return;
    if (this.selectedTrains.length) {
      ctx.strokeStyle = ctx.fillStyle = this.c.accent;
      begin();
      for (const x of this.selectedTrains) add(x.motion, 4);
      flush(3, 0.9);
      return;
    }
    // the trains on the lines from here: ink, not the red that means "you" and "picked"
    ctx.strokeStyle = ctx.fillStyle = this.c.ink;
    begin();
    for (const r of this.routes) add(r.motion, 1.7);
    flush(1.6, this.selected ? 0.35 : 0.7);
  }

  // ---------------------------------------------------------------- photo bubbles, named on station boards

  private labelWidth = new Map<string, number>();

  /** Station-board lettering: bold, condensed, capitals. */
  private boardFont(size = 11) {
    this.setFont(`800 ${size}px ${FONT}`, "condensed");
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
      w = this.ctx.measureText(text.toUpperCase()).width + 14;
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
    const under_w = under ? (this.plainFont(700, 11), this.ctx.measureText(under).width + 8) : 0;
    const W = Math.ceil(Math.max(w, under_w) + 4), H = under ? 40 : 22;
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(W * this.dpr);
    cv.height = Math.ceil(H * this.dpr);
    const c = cv.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    const x = W / 2, top = 2, h = 18;
    c.fillStyle = this.c.board;
    c.beginPath();
    c.roundRect(x - w / 2, top, w, h, 3);
    c.fill();
    c.strokeStyle = this.c.boardInk;
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x - w / 2 + 2, top + 2, w - 4, h - 4, 2);
    c.stroke();
    c.font = `800 11px ${FONT}`;
    if ("fontStretch" in c) c.fontStretch = "condensed";
    c.fillStyle = this.c.boardInk;
    c.textAlign = "center";
    c.fillText(text.toUpperCase(), x, top + 12.8);
    if (under) {
      c.font = `700 11px ${FONT}`;
      if ("fontStretch" in c) c.fontStretch = "normal";
      c.lineJoin = "round";
      c.lineWidth = 3;
      c.strokeStyle = this.c.halo;
      c.strokeText(under, x, top + 31);
      c.fillStyle = this.c.ink;
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
    const maxN = Math.round(Math.min(narrow ? 22 : 36, (narrow ? 6 : 11) + (narrow ? 4 : 6) * Math.log2(Math.max(1, k * 1.4))));
    const boxes: [number, number, number, number][] = this.safe.map((r) => [r.left - 8, r.top - 8, r.right + 8, r.bottom + 8]);
    if (this.origin && this.ok[this.origin.anchor]) {
      const ox = this.tf.applyX(this.sx[this.origin.anchor]), oy = this.tf.applyY(this.sy[this.origin.anchor]);
      boxes.push([ox - 28, oy - 28, ox + 28, oy + 6]);
    }
    const alone = this.pickedAlone();
    if (alone) {
      const half = this.boardWidth(this.selectedTitle || this.selected!.name) / 2;
      boxes.push([alone[0] - Math.max(half, 10), alone[1] - 10, alone[0] + Math.max(half, 10), alone[1] + 32]);
    }
    const placed = new Map<Place, [number, number]>();
    const off = R + 8;
    // where a photo may float: above its station first, then below, beside, diagonal
    const spots: [number, number][] = [[0, -off], [0, off + 4], [-off - 14, 0], [off + 14, 0], [-off, -off], [off, -off], [-off, off], [off, off]];
    const overlaps = (box: [number, number, number, number]) => {
      if (box[0] < 4 || box[1] < 4 || box[2] > this.w - 4 || box[3] > this.h - 4) return true;
      for (const b of boxes) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return true;
      return false;
    };
    const tryPlace = (c: BubbleCandidate) => {
      const p = c.place;
      if (placed.size >= maxN || placed.has(p) || !this.ok[p.anchor]) return;
      if (this.origin && c.mins !== null && c.mins > this.revealMins) return;
      if (this.sights.length) return; // exploring a place's sights: keep the map quiet
      const x = this.tf.applyX(this.sx[p.anchor]);
      const y = this.tf.applyY(this.sy[p.anchor]);
      const half = Math.max(R + 3, this.boardWidth(c.title) / 2 + 2);
      const below = c.mins !== null ? 42 : 28; // board, then travel time
      const prev = this.shown.get(p);
      const order = prev?.target ? [[prev.dx, prev.dy] as [number, number], ...spots] : spots; // don't jump around
      for (const [dx, dy] of order) {
        const cx = x + dx, cy = y + dy;
        const box: [number, number, number, number] = [cx - half, cy - R - 4, cx + half, cy + R + below];
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
  }

  private disc(photo: Photo | null, key: string, R: number): HTMLCanvasElement | null {
    const id = `${key}|${R}`;
    const hit = this.discs.get(id);
    if (hit) return hit;
    if (!photo) return null;
    const d = 2 * R * this.dpr;
    const img = loadedImage(photoUrl(photo, coverWidth(photo, d, d)), () => (this.dirty = true)); // draw it once it's here
    if (!img) return null;
    const pad = 8;
    const size = Math.ceil((R + pad) * 2 * this.dpr);
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const c = cv.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    const m = R + pad;
    c.shadowColor = "rgba(0,0,0,0.3)";
    c.shadowBlur = 7;
    c.shadowOffsetY = 2;
    c.beginPath();
    c.arc(m, m, R, 0, TAU);
    c.fillStyle = this.c.ring;
    c.fill();
    c.shadowColor = "transparent";
    drawCover(c, img, m, m, R - 2.5);
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
      const lift = p === this.hover || p === this.selected ? 1.12 : 1;
      const pop = s.target ? d3.easeBackOut.overshoot(2.2)(s.alpha) : s.alpha;
      const r = R * lift * (0.4 + 0.6 * pop);
      const bx = sx + s.dx * pop;
      const y = sy + s.dy * pop; // the photo floats beside its station, tethered to it
      s.x = bx;
      s.y = y;
      // tether to the station circle
      const len = Math.hypot(bx - sx, y - sy);
      ctx.strokeStyle = this.c.ink;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = s.alpha * 0.5;
      if (len > r) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx - ((bx - sx) / len) * r, y - ((y - sy) / len) * r);
        ctx.stroke();
      }
      ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, TAU);
      ctx.fillStyle = this.c.ring;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = this.c.ink;
      ctx.stroke();
      // the photo, in a white mount; red ring when it's the one you picked
      const disc = this.disc(s.c.photo, s.c.place.id, R);
      if (disc) {
        const m = (R + 8) * (r / R);
        ctx.drawImage(disc, bx - m, y - m, m * 2, m * 2);
      } else {
        ctx.beginPath();
        ctx.arc(bx, y, r, 0, TAU);
        ctx.fillStyle = this.c.land;
        ctx.fill();
        this.plainFont(800, Math.round(r * 0.8));
        ctx.fillStyle = this.c.ink;
        ctx.textAlign = "center";
        ctx.fillText(s.c.title.slice(0, 1), bx, y + r * 0.28);
        ctx.textAlign = "start";
      }
      ctx.beginPath();
      ctx.arc(bx, y, r + 0.5, 0, TAU);
      ctx.lineWidth = p === this.selected ? 3 : 1;
      ctx.strokeStyle = p === this.selected ? this.c.accent : "rgba(0,0,0,0.18)";
      ctx.stroke();
      // its name on a station board, and how long the ride is
      if (pop > 0.6) {
        ctx.globalAlpha = s.alpha * Math.min(1, (pop - 0.6) * 2.5);
        this.stationBoard(s.c.title, bx, y + r + 5, s.c.mins !== null ? fmtMins(s.c.mins) : undefined);
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
