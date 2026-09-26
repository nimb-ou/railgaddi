// The atlas. India drawn on canvas with the rail network glowing faintly. Pick a
// starting point and the routes out of it spread outward, coloured by how long the
// ride takes. The best places to go float above the map as photo bubbles: a few
// at first, more as you zoom in.
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { Leg, Network, Photo, Place, Train } from "./data";
import { drawCover, loadedImage, photoUrl } from "./photos";

export interface BubbleCandidate {
  place: Place;
  title: string;
  photo: Photo | null;
  mins: number | null; // fastest ride from the origin; null when no origin is picked
  score: number;
}

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
  ink: string; accent: string; accent2: string; text: string; muted: string; halo: string; ring: string;
}

interface Geom {
  st: Int32Array; // stations with coordinates, in running order
  km: Float32Array;
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
const BUCKETS = 28;
const MAX_MINS = 36 * 60;
const bucketOf = (m: number) => Math.min(BUCKETS - 1, Math.floor(Math.sqrt(Math.max(0, m) / MAX_MINS) * BUCKETS));
const bucketMins = (b: number) => ((b + 0.5) / BUCKETS) ** 2 * MAX_MINS;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT = "'Manrope', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

export function fmtMins(m: number) {
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

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
  private geoms = new Map<number, Geom>();
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
  private selectedTrain: { leg: Leg; motion: Motion } | null = null;
  private sights: SightPin[] = [];
  private activeSight = -1;
  private hover: Place | null = null;
  private hoverSight = -1;
  private revealMins = Infinity;
  private revealFrom = 0;
  private maxMins = 1;
  private lastFrame = 0;

  simMinute = 0; // timetable clock, minutes of day
  playing = true;
  onClock: (m: number) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private net: Network,
    india: Topology,
    states: Topology,
    private hooks: Hooks,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.land = feature(india, Object.values(india.objects)[0]) as unknown as d3.GeoPermissibleObjects;
    this.stateMesh = mesh(states, Object.values(states.objects)[0] as never);
    const n = net.stations.length;
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.ok = new Uint8Array(n);

    // the national network: deduplicated station-to-station edges, weighted by trains
    const em = new Map<number, { a: number; b: number; w: number }>();
    for (const t of net.trains) {
      const g = this.geom(t);
      for (let j = 1; j < g.st.length; j++) {
        const a = Math.min(g.st[j - 1], g.st[j]);
        const b = Math.max(g.st[j - 1], g.st[j]);
        const e = em.get(a * 100000 + b);
        if (e) e.w++;
        else em.set(a * 100000 + b, { a, b, w: 1 });
      }
      this.everyone.push(this.motion(t, 0, t.st.length - 1));
    }
    this.edges = [...em.values()];

    this.zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 320])
      .on("zoom", (e) => (this.tf = e.transform));
    d3.select(canvas).call(this.zoom).on("dblclick.zoom", null);
    canvas.addEventListener("pointermove", (e) => this.pointer(e, false));
    canvas.addEventListener("click", (e) => this.pointer(e, true));
    canvas.addEventListener("pointerleave", () => {
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
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    this.c = {
      sea: v("--sea"), sea2: v("--sea-2"), land: v("--land"), landEdge: v("--land-edge"), ripple: v("--ripple"),
      border: v("--border"), net: v("--net"), ink: v("--ink"), accent: v("--accent"), accent2: v("--accent-2"),
      text: v("--text"), muted: v("--muted"), halo: v("--halo"), ring: v("--ring"),
    };
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
    let g = this.geoms.get(t.i);
    if (g) return g;
    const st: number[] = [];
    const km: number[] = [];
    for (let j = 0; j < t.st.length; j++) {
      if (this.net.stations[t.st[j]].lat === null) continue;
      if (st.length && st[st.length - 1] === t.st[j]) continue;
      st.push(t.st[j]);
      km.push(t.km[j]);
    }
    g = { st: Int32Array.from(st), km: Float32Array.from(km) };
    this.geoms.set(t.i, g);
    return g;
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
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  }

  // ---------------------------------------------------------------- public API

  setInsets(i: Insets) {
    this.insets = i;
  }

  /** Screen rectangles (panels, docks) that bubbles should keep clear of. */
  setSafeRects(rects: DOMRect[]) {
    this.safe = rects;
  }

  setCandidates(cands: BubbleCandidate[]) {
    this.cands = [...cands].sort((a, b) => b.score - a.score);
    const keep = new Set(cands.map((c) => c.place));
    for (const [p, s] of this.shown) {
      const fresh = cands.find((c) => c.place === p);
      if (fresh) s.c = fresh;
      else if (!keep.has(p)) s.target = 0;
    }
  }

  setOrigin(origin: Place | null, active: Map<Train, ActiveTrain>, reach: Reach[], animate: boolean) {
    const changed = origin !== this.origin;
    this.origin = origin;
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
      this.maxMins = Math.max(this.maxMins, mins[mins.length - 1]);
      this.routes.push({ train, st: Int32Array.from(st), mins: Float32Array.from(mins), motion });
    }
    if (changed) {
      for (const s of this.shown.values()) s.target = 0;
      if (animate && !reduceMotion() && origin) {
        this.revealMins = 0;
        this.revealFrom = performance.now() + 900;
      } else {
        this.revealMins = Infinity;
      }
    }
  }

  select(place: Place | null) {
    this.selected = place;
  }

  selectTrain(leg: Leg | null) {
    this.selectedTrain = leg ? { leg, motion: this.motion(leg.train, 0, leg.train.st.length - 1) } : null;
  }

  showSights(pins: SightPin[], active = -1) {
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

  fitIndia(duration = 900) {
    this.fly(this.transformFor([[0, 0], [1000, 1100]], 1.4), duration);
  }

  /** Frame a destination and the lines that lead to it from the origin. */
  focusOn(place: Place, duration = 850) {
    if (!this.ok[place.anchor]) return;
    const b = this.boundsOf([place.anchor]);
    if (this.origin) {
      b.add(this.origin.anchor);
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

  /** Frame the part of a train's journey you'd ride. */
  focusLeg(leg: Leg, duration = 850) {
    const t = leg.train;
    const b = this.boundsOf([]);
    for (let j = leg.from; j <= leg.to; j++) b.add(t.st[j]);
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
    this.hover = best;
    this.hoverSight = sight;
    this.canvas.style.cursor = best || sight >= 0 ? "pointer" : "";
    this.hooks.onHover(best, mx, my);
  }

  // ---------------------------------------------------------------- frame

  private frame(now: number) {
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 100) : 16;
    this.lastFrame = now;
    if (this.playing && !reduceMotion()) {
      this.simMinute = (this.simMinute + dt / 28) % 1440; // ~40 s per timetable day
      this.onClock(this.simMinute);
    }
    if (this.revealMins !== Infinity) {
      const p = (now - this.revealFrom) / 2400;
      this.revealMins = p >= 1 ? Infinity : Math.max(0, d3.easeCubicOut(Math.max(0, p)) * this.maxMins);
    }
    this.draw(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private drawBase() {
    const key = `${this.tf.k.toFixed(4)},${this.tf.x.toFixed(1)},${this.tf.y.toFixed(1)},${this.w},${this.h},${this.origin ? 1 : 0}`;
    if (key === this.baseKey) return;
    this.baseKey = key;
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
    // soft coastline ripples, widest first
    c.lineJoin = "round";
    const gap = 6 / k;
    for (let i = 3; i >= 1; i--) {
      c.globalAlpha = 0.55 - i * 0.12;
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
    c.lineWidth = 1.2 / k;
    c.strokeStyle = this.c.landEdge;
    c.stroke(this.landPath);
    c.lineWidth = 0.8 / k;
    c.strokeStyle = this.c.border;
    c.stroke(this.statePath);
    c.setLineDash([6 / k, 5 / k]);
    c.strokeStyle = this.c.border;
    c.stroke(this.tropicPath);
    c.setLineDash([]);
    const faint = (this.origin ? 0.35 : 1) * this.netStrength;
    const widths = [0.5, 0.7, 0.9, 1.2, 1.6];
    const alphas = [0.1, 0.16, 0.24, 0.34, 0.46];
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

  private draw(dt: number) {
    const ctx = this.ctx;
    this.drawBase();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.origin) {
      this.drawRoutes();
      if (this.selectedTrain) this.drawSelectedTrain();
      this.drawDots();
    }
    this.drawTrains();
    this.layoutBubbles();
    this.drawBubbles(dt);
    if (this.sights.length) this.drawSights();
  }

  private drawRoutes() {
    const ctx = this.ctx;
    const { k, x, y } = this.tf;
    const focus = this.selected;
    const trainFocus = this.selectedTrain?.leg.train ?? null;
    const dim = this.sights.length ? 0.1 : focus || trainFocus ? 0.16 : 0.62;
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
      ctx.save();
      ctx.setTransform(this.dpr * k, 0, 0, this.dpr * k, this.dpr * x, this.dpr * y);
      ctx.lineWidth = 1.5 / k;
      ctx.globalAlpha = dim;
      this.routeCache.forEach((p, b) => {
        ctx.strokeStyle = this.lut[b];
        ctx.stroke(p);
      });
      ctx.restore();
    } else {
      // spreading out from the origin, by minutes of travel
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.75;
      for (const r of this.routes) {
        for (let j = 1; j < r.st.length; j++) {
          const m = (r.mins[j - 1] + r.mins[j]) / 2;
          if (m > this.revealMins) break;
          ctx.strokeStyle = this.lut[bucketOf(m)];
          ctx.beginPath();
          ctx.moveTo(this.tf.applyX(this.sx[r.st[j - 1]]), this.tf.applyY(this.sy[r.st[j - 1]]));
          ctx.lineTo(this.tf.applyX(this.sx[r.st[j]]), this.tf.applyY(this.sy[r.st[j]]));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    // the lines that reach the selected place, bright
    if (focus && !trainFocus && !this.sights.length) {
      const dest = new Set(focus.stations);
      ctx.lineWidth = 2.6;
      for (const r of this.routes) {
        const end = r.st.findIndex((s) => dest.has(s));
        if (end < 1) continue;
        for (let j = 1; j <= end; j++) {
          ctx.strokeStyle = this.lut[bucketOf((r.mins[j - 1] + r.mins[j]) / 2)];
          ctx.beginPath();
          ctx.moveTo(this.tf.applyX(this.sx[r.st[j - 1]]), this.tf.applyY(this.sy[r.st[j - 1]]));
          ctx.lineTo(this.tf.applyX(this.sx[r.st[j]]), this.tf.applyY(this.sy[r.st[j]]));
          ctx.stroke();
        }
      }
    }
  }

  private drawSelectedTrain() {
    const ctx = this.ctx;
    const { leg } = this.selectedTrain!;
    const t = leg.train;
    const g = this.geom(t);
    const X = (i: number) => this.tf.applyX(this.sx[i]);
    const Y = (i: number) => this.tf.applyY(this.sy[i]);
    const line = (km0: number, km1: number) => {
      ctx.beginPath();
      let first = true;
      for (let j = 0; j < g.st.length; j++) {
        if (g.km[j] < km0 || g.km[j] > km1) continue;
        if (first) ctx.moveTo(X(g.st[j]), Y(g.st[j]));
        else ctx.lineTo(X(g.st[j]), Y(g.st[j]));
        first = false;
      }
      ctx.stroke();
    };
    ctx.strokeStyle = this.c.ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 4]);
    line(-1, Infinity);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.c.accent;
    ctx.lineWidth = 3.2;
    line(t.km[leg.from] - 0.01, t.km[leg.to] + 0.01);
    for (let j = leg.from; j <= leg.to; j++) {
      if ((t.arr[j] < 0 && t.dep[j] < 0) || !this.ok[t.st[j]]) continue;
      ctx.beginPath();
      ctx.arc(X(t.st[j]), Y(t.st[j]), 3, 0, TAU);
      ctx.fillStyle = this.c.sea;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = this.c.accent;
      ctx.stroke();
    }
  }

  private drawDots() {
    if (this.sights.length) return;
    const ctx = this.ctx;
    const r = this.tf.k > 4 ? 3 : this.tf.k > 1.8 ? 2.4 : 1.9;
    for (const d of this.reach) {
      if (!this.ok[d.place.anchor] || d.mins > this.revealMins || this.shown.get(d.place)?.alpha === 1) continue;
      const x = this.tf.applyX(this.sx[d.place.anchor]);
      const y = this.tf.applyY(this.sy[d.place.anchor]);
      if (x < -5 || y < -5 || x > this.w + 5 || y > this.h + 5) continue;
      const dim = this.selected && this.selected !== d.place;
      ctx.globalAlpha = dim ? 0.35 : 0.95;
      ctx.beginPath();
      ctx.arc(x, y, d.place === this.hover ? r + 2 : r, 0, TAU);
      ctx.fillStyle = this.timeColor(d.mins);
      ctx.fill();
      if (d.place === this.selected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.c.accent;
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawTrains() {
    const ctx = this.ctx;
    const dot = (m: Motion, size: number, glow: number) => {
      const e = (this.simMinute - m.dep0 + 1440) % 1440;
      let km = this.kmAt(m, e);
      if (km === null && m.end > 1440) km = this.kmAt(m, e + 1440);
      if (km === null) return;
      const [bx, by] = this.at(m.geom, km);
      const x = this.tf.applyX(bx), y = this.tf.applyY(by);
      if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) return;
      if (glow) {
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(x, y, size * 2.6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    };
    ctx.fillStyle = this.c.accent;
    if (!this.origin) {
      ctx.globalAlpha = 0.7;
      for (const m of this.everyone) dot(m, 0.9, 0);
      ctx.globalAlpha = 1;
      return;
    }
    if (this.revealMins !== Infinity) return;
    if (this.selectedTrain) {
      dot(this.selectedTrain.motion, 2.4, 0.3);
      return;
    }
    for (const r of this.routes) dot(r.motion, 1.4, 0.18);
  }

  // ---------------------------------------------------------------- photo bubbles

  private labelWidth = new Map<string, number>();

  private measure(text: string, font: string) {
    const key = font + text;
    let w = this.labelWidth.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.labelWidth.set(key, w);
    }
    return w;
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
    const placed = new Map<Place, [number, number]>();
    const font = `700 12px ${FONT}`;
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
      const half = Math.max(R + 3, this.measure(c.title, font) / 2 + 4);
      const prev = this.shown.get(p);
      const order = prev?.target ? [[prev.dx, prev.dy] as [number, number], ...spots] : spots; // don't jump around
      for (const [dx, dy] of order) {
        const cx = x + dx, cy = y + dy;
        const box: [number, number, number, number] = [cx - half, cy - R - 4, cx + half, cy + R + 30];
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
    const img = loadedImage(photoUrl(photo, R * this.dpr * 2 > 120 ? 250 : 120), () => {});
    if (!img) return null;
    const pad = 8;
    const size = Math.ceil((R + pad) * 2 * this.dpr);
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const c = cv.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    const m = R + pad;
    c.shadowColor = "rgba(0,0,0,0.35)";
    c.shadowBlur = 8;
    c.shadowOffsetY = 3;
    c.beginPath();
    c.arc(m, m, R, 0, TAU);
    c.fillStyle = this.c.ring;
    c.fill();
    c.shadowColor = "transparent";
    drawCover(c, img, m, m, R - 2);
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
      const len = Math.hypot(bx - sx, y - sy);
      ctx.strokeStyle = this.c.text;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = s.alpha * 0.6;
      if (len > r) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx - ((bx - sx) / len) * r, y - ((y - sy) / len) * r);
        ctx.stroke();
      }
      ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.4, 0, TAU);
      ctx.fillStyle = this.c.text;
      ctx.fill();
      // time ring
      const ring = s.c.mins !== null ? this.timeColor(s.c.mins) : this.c.accent;
      ctx.beginPath();
      ctx.arc(bx, y, r + 3, 0, TAU);
      ctx.fillStyle = p === this.selected ? this.c.accent : ring;
      ctx.fill();
      const disc = this.disc(s.c.photo, s.c.place.id, R);
      if (disc) {
        const m = (R + 8) * (r / R);
        ctx.drawImage(disc, s.x - m, y - m, m * 2, m * 2);
      } else {
        ctx.beginPath();
        ctx.arc(s.x, y, r, 0, TAU);
        ctx.fillStyle = this.c.land;
        ctx.fill();
        ctx.fillStyle = this.c.text;
        ctx.font = `800 ${Math.round(r * 0.8)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(s.c.title.slice(0, 1), s.x, y + r * 0.28);
        ctx.textAlign = "start";
      }
      // label
      if (pop > 0.6) {
        ctx.globalAlpha = s.alpha * Math.min(1, (pop - 0.6) * 2.5);
        ctx.textAlign = "center";
        ctx.lineJoin = "round";
        ctx.font = `700 12px ${FONT}`;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = this.c.halo;
        const ty = y + r + 17;
        ctx.strokeText(s.c.title, s.x, ty);
        ctx.fillStyle = this.c.text;
        ctx.fillText(s.c.title, s.x, ty);
        if (s.c.mins !== null) {
          ctx.font = `500 10.5px ${MONO}`;
          const t = fmtMins(s.c.mins);
          ctx.strokeText(t, s.x, ty + 13);
          ctx.fillStyle = ring;
          ctx.fillText(t, s.x, ty + 13);
        }
        ctx.textAlign = "start";
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawSights() {
    const ctx = this.ctx;
    const R = 16;
    const placed: [number, number, number, number][] = [];
    // the station you'd arrive at, for scale
    if (this.selected) {
      for (const st of this.selected.stations) {
        if (!this.ok[st]) continue;
        const x = this.tf.applyX(this.sx[st]), y = this.tf.applyY(this.sy[st]);
        const label = `${this.net.stations[st].code} station`;
        ctx.font = `700 10.5px ${FONT}`;
        const w = ctx.measureText(label).width + 26;
        ctx.fillStyle = this.c.accent;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - 10, w, 20, 10);
        ctx.fill();
        ctx.fillStyle = this.c.sea;
        ctx.fillRect(x - w / 2 + 8, y - 4, 9, 7); // a tiny coach
        ctx.fillText(label, x - w / 2 + 21, y + 4);
        placed.push([x - w / 2, y - 10, x + w / 2, y + 10]);
      }
    }
    for (const p of this.sights) {
      const [bx, by] = this.proj([p.lon, p.lat])!;
      const x = this.tf.applyX(bx), y = this.tf.applyY(by);
      if (x < -30 || y < -30 || x > this.w + 30 || y > this.h + 30) continue;
      const active = p.i === this.activeSight || p.i === this.hoverSight;
      const r = active ? R * 1.25 : R;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, TAU);
      ctx.fillStyle = active ? this.c.accent : this.c.ring;
      ctx.fill();
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
      ctx.font = `700 11.5px ${FONT}`;
      const w = ctx.measureText(p.name).width;
      const box: [number, number, number, number] = [x - w / 2 - 3, y + r + 4, x + w / 2 + 3, y + r + 19];
      if (!active && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.textAlign = "center";
      ctx.lineWidth = 3.5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = this.c.halo;
      ctx.strokeText(p.name, x, y + r + 16);
      ctx.fillStyle = this.c.text;
      ctx.fillText(p.name, x, y + r + 16);
      ctx.textAlign = "start";
    }
  }
}

export function shortName(p: Place) {
  return p.name.replace(/\s+(Junction|Jn\.?)$/i, "").replace(/\s*\((.+)\)$/, "");
}
