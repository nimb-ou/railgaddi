// The atlas: a hand-drawn India on canvas, the national network glowing faintly,
// and — once you pick a starting point — every route out of it inked in, with
// trains moving along them by the timetable.
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { Destination, Leg, Network, Place, Train } from "./data";

type Palette = Record<"sea" | "land" | "ripple" | "border" | "grid" | "net" | "ink" | "board" | "signal" | "text" | "halo" | "muted", string>;

interface Geom {
  st: Int32Array; // station indices that have coordinates
  km: Float32Array; // km at each of those points
}

interface Motion {
  train: Train;
  geom: Geom;
  t: Float32Array; // minutes since first departure
  k: Float32Array; // km at that time
  dep0: number; // time of day of first departure (0..1439)
  end: number; // minutes of the last motion sample
}

interface ActiveRoute {
  train: Train;
  geom: Geom;
  km0: number;
  km1: number;
  motion: Motion;
}

export interface MapEvents {
  onPick(place: Place): void;
  onHover(place: Place | null, x: number, y: number): void;
}

const TAU = Math.PI * 2;
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  private statePath = new Path2D();
  private landPath = new Path2D();
  private gridPath = new Path2D();
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
  private c: Palette;

  // state
  private origin: Place | null = null;
  private routes: ActiveRoute[] = [];
  private dests: { d: Destination; legs: Leg[]; r: number; x: number; y: number; guide: boolean; score: number }[] = [];
  private selected: Place | null = null;
  private selectedTrain: { leg: Leg; motion: Motion } | null = null;
  private reveal = 1; // 0..1 route ink-out progress
  private revealStart = 0;
  private maxKm = 1;
  private hover: Place | null = null;
  private insetRight = 0;

  simMinute = 0; // timetable clock, minutes of day
  playing = true;
  private lastFrame = 0;
  onClock: (m: number) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private net: Network,
    india: Topology,
    states: Topology,
    private hasGuide: (p: Place) => boolean,
    private ev: MapEvents,
  ) {
    this.ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    this.c = {
      sea: v("--sea"), land: v("--land"), ripple: v("--ripple"), border: v("--border"), grid: v("--grid"),
      net: v("--net"), ink: v("--ink"), board: v("--board"), signal: v("--signal"), text: v("--text"),
      halo: v("--sea"), muted: v("--muted"),
    };
    const indiaObj = Object.values(india.objects)[0];
    this.land = feature(india, indiaObj) as unknown as d3.GeoPermissibleObjects;
    this.stateMesh = mesh(states, Object.values(states.objects)[0] as never);

    const n = net.stations.length;
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.ok = new Uint8Array(n);

    // national network: deduplicated station-to-station edges, weighted by trains
    const em = new Map<number, { a: number; b: number; w: number }>();
    for (const t of net.trains) {
      const g = this.geom(t);
      for (let j = 1; j < g.st.length; j++) {
        const a = Math.min(g.st[j - 1], g.st[j]);
        const b = Math.max(g.st[j - 1], g.st[j]);
        const key = a * 100000 + b;
        const e = em.get(key);
        if (e) e.w++;
        else em.set(key, { a, b, w: 1 });
      }
      this.everyone.push(this.motion(t, 0, t.st.length - 1));
    }
    this.edges = [...em.values()];

    this.zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.7, 48])
      .on("zoom", (e) => {
        this.tf = e.transform;
      });
    d3.select(canvas).call(this.zoom).on("dblclick.zoom", null);

    canvas.addEventListener("pointermove", (e) => this.pointer(e, false));
    canvas.addEventListener("click", (e) => this.pointer(e, true));
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.ev.onHover(null, 0, 0);
    });

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    requestAnimationFrame((t) => this.frame(t));
  }

  private stateMesh: d3.GeoPermissibleObjects;

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

  /** Time → distance samples for a train between two point indices (halts carry the times). */
  private motion(t: Train, from: number, to: number): Motion {
    const dep0 = t.dep[from];
    const ts: number[] = [];
    const ks: number[] = [];
    for (let j = from; j <= to; j++) {
      const k = t.km[j];
      if (t.arr[j] >= 0 && j !== from) {
        ts.push(t.arr[j] - dep0);
        ks.push(k);
      }
      if (t.dep[j] >= 0 && j !== to) {
        ts.push(t.dep[j] - dep0);
        ks.push(k);
      }
    }
    return {
      train: t,
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
    const narrow = this.w < 720;
    const pad = narrow ? 20 : 56;
    const top = narrow ? 150 : 40;
    this.proj.fitExtent([[pad, top], [this.w - pad, this.h - (narrow ? 90 : 40)]], this.land);
    const path = d3.geoPath(this.proj);
    this.landPath = new Path2D(path(this.land) ?? "");
    this.statePath = new Path2D(path(this.stateMesh) ?? "");
    this.gridPath = new Path2D(path(d3.geoGraticule().step([5, 5]).extent([[60, 0], [100, 40]])()) ?? "");
    this.tropicPath = new Path2D(path({ type: "LineString", coordinates: d3.range(66, 99, 0.5).map((x) => [x, 23.4367]) }) ?? "");
    this.tropicLabel = this.proj([68.6, 23.4367])!;

    for (const s of this.net.stations) {
      if (s.lat === null || s.lon === null) continue;
      const p = this.proj([s.lon, s.lat])!;
      this.sx[s.i] = p[0];
      this.sy[s.i] = p[1];
      this.ok[s.i] = 1;
    }
    // network paths, bucketed by how many trains share an edge
    const buckets = [1, 3, 8, 20, 50, Infinity];
    this.netPaths = buckets.slice(1).map(() => new Path2D());
    for (const e of this.edges) {
      const bi = buckets.findIndex((b, i) => e.w >= b && e.w < buckets[i + 1]);
      const p = this.netPaths[bi];
      p.moveTo(this.sx[e.a], this.sy[e.a]);
      p.lineTo(this.sx[e.b], this.sy[e.b]);
    }
    for (const d of this.dests) this.placeXY(d);
    this.baseKey = "";
  }

  // ---------- public API ----------

  setInsetRight(px: number) {
    this.insetRight = px;
  }

  setOrigin(origin: Place | null, dests: Destination[], active: Map<Train, { from: number; to: number; legs: Leg[] }>, animate: boolean) {
    const changed = origin !== this.origin;
    this.origin = origin;
    this.routes = [];
    this.maxKm = 1;
    for (const [train, a] of active) {
      const geom = this.geom(train);
      const km0 = train.km[a.from];
      const km1 = train.km[a.to];
      this.maxKm = Math.max(this.maxKm, km1 - km0);
      this.routes.push({ train, geom, km0, km1, motion: this.motion(train, a.from, a.to) });
    }
    const destByPlace = new Map<Place, Leg[]>();
    for (const a of active.values()) for (const l of a.legs) {
      const p = this.net.placeOf[l.train.st[l.to]];
      (destByPlace.get(p) ?? destByPlace.set(p, []).get(p)!).push(l);
    }
    this.dests = dests
      .filter((d) => destByPlace.has(d.place) && d.place.lat !== null)
      .map((d) => {
        const legs = destByPlace.get(d.place)!;
        const guide = this.hasGuide(d.place);
        const score = (d.place.isCity ? 400 : 0) + (guide ? 120 : 0) + Math.min(legs.length, 40) * 6 + Math.min(d.place.halts, 300) * 0.4;
        const r = guide ? Math.min(2.6 + Math.sqrt(legs.length) * 0.9, 6.5) : Math.min(1.5 + Math.sqrt(legs.length) * 0.45, 3.2);
        const o = { d, legs, r, x: 0, y: 0, guide, score };
        this.placeXY(o);
        return o;
      })
      .sort((a, b) => b.score - a.score);
    if (this.selected && !destByPlace.has(this.selected)) this.selected = null;
    if (changed && animate && !reduceMotion()) {
      this.reveal = 0;
      this.revealStart = performance.now() + 650;
    }
  }

  select(place: Place | null) {
    this.selected = place;
  }

  selectTrain(leg: Leg | null) {
    this.selectedTrain = leg ? { leg, motion: this.motion(leg.train, 0, leg.train.st.length - 1) } : null;
  }

  /** Fly to the origin, then back out to frame everything reachable. */
  flyToOrigin(done?: () => void) {
    if (!this.origin) return;
    const o = this.origin.anchor;
    const sel = d3.select(this.canvas);
    const dur = reduceMotion() ? 0 : 1;
    const close = this.transformFor([[this.sx[o] - 40, this.sy[o] - 40], [this.sx[o] + 40, this.sy[o] + 40]], 7);
    const bounds = this.boundsOfRoutes();
    sel
      .transition("fly")
      .duration(700 * dur)
      .ease(d3.easeCubicInOut)
      .call(this.zoom.transform, close)
      .transition()
      .delay(250 * dur)
      .duration(1500 * dur)
      .ease(d3.easeCubicInOut)
      .call(this.zoom.transform, this.transformFor(bounds, 6))
      .on("end", () => done?.());
  }

  fitRoutes(duration = 700) {
    d3.select(this.canvas).transition("fly").duration(reduceMotion() ? 0 : duration).ease(d3.easeCubicInOut)
      .call(this.zoom.transform, this.transformFor(this.boundsOfRoutes(), 6));
  }

  /** Frame the origin, a destination, and the lines that connect them. */
  focusOn(place: Place, duration = 800) {
    if (!this.origin || !this.ok[place.anchor]) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (i: number) => {
      if (!this.ok[i]) return;
      x0 = Math.min(x0, this.sx[i]); x1 = Math.max(x1, this.sx[i]);
      y0 = Math.min(y0, this.sy[i]); y1 = Math.max(y1, this.sy[i]);
    };
    add(this.origin.anchor);
    add(place.anchor);
    const dest = new Set(place.stations);
    for (const r of this.routes) {
      const t = r.train;
      let end = -1;
      for (let j = 0; j < t.st.length; j++) if (dest.has(t.st[j]) && t.arr[j] >= 0 && t.km[j] >= r.km0) { end = j; break; }
      if (end < 0) continue;
      for (let j = 0; j < r.geom.st.length; j++) {
        if (r.geom.km[j] >= r.km0 && r.geom.km[j] <= t.km[end]) add(r.geom.st[j]);
      }
    }
    const pad = Math.max(40, Math.max(x1 - x0, y1 - y0) * 0.12);
    const target = this.transformFor([[x0 - pad, y0 - pad], [x1 + pad, y1 + pad]], 9);
    d3.select(this.canvas).transition("fly").duration(reduceMotion() ? 0 : duration).ease(d3.easeCubicInOut)
      .call(this.zoom.transform, target);
  }

  fitIndia(duration = 900) {
    d3.select(this.canvas).transition("fly").duration(reduceMotion() ? 0 : duration).ease(d3.easeCubicInOut)
      .call(this.zoom.transform, d3.zoomIdentity);
  }

  /** Screen position of a place (for DOM overlays). */
  screenOf(p: Place): [number, number] | null {
    if (!this.ok[p.anchor]) return null;
    return [this.tf.applyX(this.sx[p.anchor]), this.tf.applyY(this.sy[p.anchor])];
  }

  // ---------- geometry helpers ----------

  private placeXY(o: { d: Destination; x: number; y: number }) {
    o.x = this.sx[o.d.place.anchor];
    o.y = this.sy[o.d.place.anchor];
  }

  private boundsOfRoutes(): [[number, number], [number, number]] {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (i: number) => {
      if (!this.ok[i]) return;
      x0 = Math.min(x0, this.sx[i]); x1 = Math.max(x1, this.sx[i]);
      y0 = Math.min(y0, this.sy[i]); y1 = Math.max(y1, this.sy[i]);
    };
    if (this.origin) add(this.origin.anchor);
    for (const r of this.routes) for (let j = 0; j < r.geom.st.length; j++) {
      if (r.geom.km[j] >= r.km0 && r.geom.km[j] <= r.km1) add(r.geom.st[j]);
    }
    if (!isFinite(x0)) return [[0, 0], [this.w, this.h]];
    const padX = Math.max(30, (x1 - x0) * 0.04);
    const padY = Math.max(30, (y1 - y0) * 0.04);
    return [[x0 - padX, y0 - padY], [x1 + padX, y1 + padY]];
  }

  private transformFor([[x0, y0], [x1, y1]]: [[number, number], [number, number]], maxK: number) {
    const narrow = this.w < 720;
    const left = narrow ? 16 : 24;
    const right = this.w - (narrow ? 16 : this.insetRight + 24);
    const top = narrow ? 140 : 150;
    const bottom = this.h - (narrow ? Math.max(this.insetRight, 90) : 70);
    const k = Math.max(0.7, Math.min(maxK, (right - left) / (x1 - x0), (bottom - top) / (y1 - y0)));
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    return d3.zoomIdentity.translate(cx - k * (x0 + x1) / 2, cy - k * (y0 + y1) / 2).scale(k);
  }

  /** Position along a train's geometry at a given km (in base coords). */
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

  // ---------- interaction ----------

  private pointer(e: PointerEvent | MouseEvent, click: boolean) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    // bigger dots (cities, places with guides) win when several sit under the pointer
    let best: Place | null = null;
    let bd = Infinity;
    for (const d of this.dests) {
      const x = this.tf.applyX(d.x), y = this.tf.applyY(d.y);
      const dist = Math.hypot(x - mx, y - my);
      if (dist > 14) continue;
      const eff = dist - d.r * 2.2 - (d.d.place.isCity ? 6 : 0);
      if (eff < bd) { bd = eff; best = d.d.place; }
    }
    if (click) {
      if (best) this.ev.onPick(best);
      return;
    }
    if (best !== this.hover) {
      this.hover = best;
      this.canvas.style.cursor = best ? "pointer" : "";
    }
    this.ev.onHover(best, mx, my);
  }

  // ---------- drawing ----------

  private frame(now: number) {
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 100) : 16;
    this.lastFrame = now;
    if (this.playing && !reduceMotion()) {
      this.simMinute = (this.simMinute + dt / 28) % 1440; // ~40 s per timetable day
      this.onClock(this.simMinute);
    }
    if (this.reveal < 1) {
      const p = Math.max(0, (now - this.revealStart) / 2600);
      this.reveal = Math.min(1, p);
    }
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  private drawBase() {
    const key = `${this.tf.k.toFixed(4)},${this.tf.x.toFixed(1)},${this.tf.y.toFixed(1)},${this.w},${this.h},${this.origin ? 1 : 0}`;
    if (key === this.baseKey) return;
    this.baseKey = key;
    const c = this.baseCtx;
    const { k, x, y } = this.tf;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = this.c.sea;
    c.fillRect(0, 0, this.w, this.h);
    c.save();
    c.translate(x, y);
    c.scale(k, k);
    // graticule + tropic of cancer
    c.lineWidth = 0.6 / k;
    c.strokeStyle = this.c.grid;
    c.stroke(this.gridPath);
    // coastline ripples: concentric outlines, drawn widest first
    c.lineJoin = "round";
    const gap = 5 / k;
    for (let i = 5; i >= 1; i--) {
      c.globalAlpha = 0.9 - i * 0.14;
      c.strokeStyle = this.c.ripple;
      c.lineWidth = 2 * i * gap;
      c.stroke(this.landPath);
      c.globalAlpha = 1;
      c.strokeStyle = this.c.sea;
      c.lineWidth = 2 * i * gap - 1.1 / k;
      c.stroke(this.landPath);
    }
    c.fillStyle = this.c.land;
    c.fill(this.landPath);
    c.setLineDash([2 / k, 3 / k]);
    c.lineWidth = 0.8 / k;
    c.strokeStyle = this.c.border;
    c.stroke(this.statePath);
    c.setLineDash([7 / k, 5 / k]);
    c.strokeStyle = this.c.grid;
    c.lineWidth = 0.9 / k;
    c.stroke(this.tropicPath);
    c.setLineDash([]);
    // national network, busier corridors brighter
    const faint = this.origin ? 0.45 : 1;
    const widths = [0.5, 0.7, 0.9, 1.2, 1.6];
    const alphas = [0.16, 0.24, 0.34, 0.46, 0.6];
    c.strokeStyle = this.c.net;
    c.lineCap = "round";
    this.netPaths.forEach((p, i) => {
      c.globalAlpha = alphas[i] * faint;
      c.lineWidth = widths[i] / k;
      c.stroke(p);
    });
    c.globalAlpha = 1;
    c.restore();
    // tropic label in screen space so it stays crisp
    const [tx, ty] = [this.tf.applyX(this.tropicLabel[0]), this.tf.applyY(this.tropicLabel[1])];
    c.font = "italic 500 10.5px 'IBM Plex Sans', system-ui, sans-serif";
    c.fillStyle = this.c.muted;
    c.fillText("Tropic of Cancer  23°26′N", tx, ty - 5);
  }

  private draw() {
    const ctx = this.ctx;
    this.drawBase();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { k } = this.tf;
    const X = (i: number) => this.tf.applyX(this.sx[i]);
    const Y = (i: number) => this.tf.applyY(this.sy[i]);

    if (!this.origin) {
      this.drawEveryone();
      return;
    }

    const revealKm = this.reveal >= 1 ? Infinity : d3.easeCubicOut(this.reveal) * this.maxKm;
    const focus = this.selected;
    const trainFocus = this.selectedTrain?.leg.train ?? null;

    // routes out of the origin
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "lighter";
    for (const r of this.routes) {
      const serves = focus ? this.routeServes(r, focus) : true;
      if (trainFocus && r.train === trainFocus) continue;
      ctx.strokeStyle = this.c.ink;
      ctx.globalAlpha = focus ? (serves ? 0.6 : 0.05) : trainFocus ? 0.06 : 0.3;
      ctx.lineWidth = focus && serves ? 1.8 : 1.3;
      this.strokeRoute(r, revealKm);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // selected train: whole journey, the part we ride in board yellow
    if (this.selectedTrain) {
      const { leg } = this.selectedTrain;
      const t = leg.train;
      const g = this.geom(t);
      ctx.strokeStyle = this.c.ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      this.strokeKm(g, g.km[0], g.km[g.km.length - 1]);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.c.board;
      ctx.lineWidth = 3;
      this.strokeKm(g, t.km[leg.from], t.km[leg.to]);
      // halts as ticks
      for (let j = 0; j < t.st.length; j++) {
        if ((t.arr[j] < 0 && t.dep[j] < 0) || !this.ok[t.st[j]]) continue;
        const onRide = j >= leg.from && j <= leg.to;
        ctx.beginPath();
        ctx.arc(X(t.st[j]), Y(t.st[j]), onRide ? 2.6 : 1.8, 0, TAU);
        ctx.fillStyle = onRide ? this.c.sea : this.c.ink;
        ctx.fill();
        if (onRide) {
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = this.c.board;
          ctx.stroke();
        }
      }
    }

    // destination dots
    for (const d of this.dests) {
      if (d.d.firstKm > revealKm) continue;
      const x = this.tf.applyX(d.x), y = this.tf.applyY(d.y);
      if (x < -20 || y < -20 || x > this.w + 20 || y > this.h + 20) continue;
      const dim = focus ? d.d.place !== focus : false;
      const r = d.r * (k > 3 ? 1.2 : 1);
      ctx.globalAlpha = dim ? 0.35 : d.guide ? 1 : 0.75;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = d.guide ? this.c.board : this.c.ink;
      ctx.fill();
      if (d.guide) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = this.c.sea;
        ctx.stroke();
      }
      if (d.d.place === focus || d.d.place === this.hover) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, TAU);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = this.c.board;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // trains in motion, by the timetable
    if (this.reveal >= 1) this.drawTrains();

    this.drawLabels(revealKm);
  }

  private routeServes(r: ActiveRoute, p: Place) {
    for (const s of p.stations) {
      for (let j = 0; j < r.train.st.length; j++) {
        if (r.train.st[j] === s && r.train.km[j] >= r.km0 && r.train.km[j] <= r.km1 && r.train.arr[j] >= 0) return true;
      }
    }
    return false;
  }

  private strokeRoute(r: ActiveRoute, revealKm: number) {
    this.strokeKm(r.geom, r.km0, Math.min(r.km1, r.km0 + revealKm));
  }

  private strokeKm(g: Geom, km0: number, km1: number) {
    if (km1 <= km0) return;
    const ctx = this.ctx;
    ctx.beginPath();
    const [x0, y0] = this.at(g, km0);
    ctx.moveTo(this.tf.applyX(x0), this.tf.applyY(y0));
    for (let j = 0; j < g.st.length; j++) {
      if (g.km[j] <= km0) continue;
      if (g.km[j] >= km1) break;
      ctx.lineTo(this.tf.applyX(this.sx[g.st[j]]), this.tf.applyY(this.sy[g.st[j]]));
    }
    const [x1, y1] = this.at(g, km1);
    ctx.lineTo(this.tf.applyX(x1), this.tf.applyY(y1));
    ctx.stroke();
  }

  private drawTrains() {
    const ctx = this.ctx;
    const trainFocus = this.selectedTrain?.leg.train ?? null;
    const draw = (m: Motion, bright: boolean) => {
      // ride the most recent departure (the timetable repeats daily in this dataset)
      let e = (this.simMinute - m.dep0 + 1440) % 1440;
      let km = this.kmAt(m, e);
      if (km === null && m.end > 1440) km = this.kmAt(m, e + 1440);
      if (km === null) return;
      const [bx, by] = this.at(m.geom, km);
      const x = this.tf.applyX(bx), y = this.tf.applyY(by);
      if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) return;
      ctx.beginPath();
      ctx.arc(x, y, bright ? 7 : 4.5, 0, TAU);
      ctx.fillStyle = this.c.board;
      ctx.globalAlpha = bright ? 0.28 : 0.16;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, bright ? 3 : 1.9, 0, TAU);
      ctx.globalAlpha = 1;
      ctx.fill();
    };
    if (trainFocus && this.selectedTrain) {
      draw(this.selectedTrain.motion, true);
      return;
    }
    for (const r of this.routes) {
      if (this.selected && !this.routeServes(r, this.selected)) continue;
      draw(r.motion, false);
    }
  }

  private drawEveryone() {
    const ctx = this.ctx;
    ctx.fillStyle = this.c.board;
    ctx.globalAlpha = 0.85;
    for (const m of this.everyone) {
      let e = (this.simMinute - m.dep0 + 1440) % 1440;
      let km = this.kmAt(m, e);
      if (km === null && m.end > 1440) km = this.kmAt(m, e + 1440);
      if (km === null) continue;
      const [bx, by] = this.at(m.geom, km);
      ctx.fillRect(this.tf.applyX(bx) - 0.9, this.tf.applyY(by) - 0.9, 1.8, 1.8);
    }
    ctx.globalAlpha = 1;
    // a few big cities for orientation
    const labels: [number, number, number, number][] = [];
    ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif";
    for (const p of this.net.places.values()) {
      if (!p.isCity || !this.ok[p.anchor] || p.halts < 350) continue;
      const x = this.tf.applyX(this.sx[p.anchor]), y = this.tf.applyY(this.sy[p.anchor]);
      this.label(p.name.toUpperCase(), x + 6, y + 4, labels, this.c.muted, 1.5);
    }
  }

  private label(text: string, x: number, y: number, placed: [number, number, number, number][], color: string, spacing = 0) {
    const ctx = this.ctx;
    const w = ctx.measureText(text).width + spacing * text.length;
    const box: [number, number, number, number] = [x - 2, y - 11, x + w + 2, y + 4];
    for (const b of placed) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return false;
    placed.push(box);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.c.halo;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
    return true;
  }

  private drawLabels(revealKm: number) {
    const ctx = this.ctx;
    const placed: [number, number, number, number][] = [];
    // keep the origin marker and the right-hand panel clear
    if (this.origin && this.ok[this.origin.anchor]) {
      const ox = this.tf.applyX(this.sx[this.origin.anchor]), oy = this.tf.applyY(this.sy[this.origin.anchor]);
      placed.push([ox - 30, oy - 34, ox + 30, oy + 12]);
    }
    const budget = Math.round(26 + this.tf.k * 14);
    let n = 0;
    const order = this.selected ? [...this.dests].sort((a, b) => (b.d.place === this.selected ? 1 : 0) - (a.d.place === this.selected ? 1 : 0)) : this.dests;
    for (const d of order) {
      if (n >= budget) break;
      if (d.d.firstKm > revealKm) continue;
      const x = this.tf.applyX(d.x), y = this.tf.applyY(d.y);
      if (x < 0 || y < 12 || x > this.w - 40 || y > this.h) continue;
      const strong = d.d.place.isCity || d.d.place === this.selected;
      ctx.font = `${strong ? 600 : 500} ${strong ? 12.5 : 11.5}px 'IBM Plex Sans', system-ui, sans-serif`;
      const dim = this.selected && d.d.place !== this.selected;
      const ok = this.label(shortName(d.d.place), x + d.r + 4, y + 4, placed, dim ? this.c.muted : this.c.text);
      if (ok) n++;
    }
  }
}

export function shortName(p: Place) {
  return p.name.replace(/\s+(Junction|Jn\.?)$/i, "").replace(/\s*\((.+)\)$/, "");
}
