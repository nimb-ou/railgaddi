// Weather, shown: a place's now and next seven days in its panel, the colours of the map's
// weather layer, and the legend that explains them.
import { describe, type Forecast, type Icon, type WeatherMode } from "../core/weather";
import { esc } from "./esc";

const ICONS: Record<Icon, string> = {
  sun: `<circle class="sun" cx="12" cy="12" r="4.2"/><path class="sun" d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>`,
  moon: `<path class="moon" d="M18 14.5A7 7 0 0 1 9.5 6a7 7 0 1 0 8.5 8.5z"/>`,
  partly: `<circle class="sun" cx="9" cy="9" r="3.4"/><path class="sun" d="M9 2.6v1.4M2.6 9h1.4M4.5 4.5l1 1M13.5 4.5l-1 1"/><path class="cloud" d="M8 19h9a3.4 3.4 0 0 0 .3-6.8 4.6 4.6 0 0 0-8.8 1.4A2.7 2.7 0 0 0 8 19z"/>`,
  cloud: `<path class="cloud" d="M7 18.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.5A3 3 0 0 0 7 18.5z"/>`,
  fog: `<path class="cloud" d="M7 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.5A3 3 0 0 0 7 14.5z"/><path class="drop" d="M5 18h14M7 21h10"/>`,
  drizzle: `<path class="cloud" d="M7 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.5A3 3 0 0 0 7 14.5z"/><path class="drop" d="M9 17.5v1M13 17.5v1M15 19.5v1M11 19.5v1"/>`,
  rain: `<path class="cloud" d="M7 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.5A3 3 0 0 0 7 14.5z"/><path class="drop" d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>`,
  snow: `<path class="cloud" d="M7 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.5A3 3 0 0 0 7 14.5z"/><path class="flake" d="M9 18v2M8 19h2M14 18v2M13 19h2"/>`,
  storm: `<path class="cloud" d="M7 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10 1.5A3 3 0 0 0 7 14.5z"/><path class="bolt" d="M12.5 15l-2.5 4h3l-2 4"/>`,
};

export function iconSvg(icon: Icon, cls = "wx-icon") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const deg = (t: number) => `${Math.round(t)}°`;

/** The weather at a place: now, and the next seven days. */
export function weatherHtml(f: Forecast | "loading" | "error", where: string) {
  if (f === "loading") return `<section class="wx" aria-label="Weather"><p class="wx-loading">Getting the weather in ${esc(where)}…</p></section>`;
  if (f === "error") return `<section class="wx" aria-label="Weather"><p class="wx-loading">Couldn't get the weather just now.</p></section>`;
  const now = describe(f.now.code, f.now.day);
  const today = f.days[0];
  return `<section class="wx" aria-labelledby="wx-h">
    <h3 class="vh" id="wx-h">Weather in ${esc(where)}</h3>
    <div class="wx-head">
      ${iconSvg(now.icon)}
      <span class="wx-temp">${deg(f.now.temp)}</span>
      <span class="wx-what"><b>${esc(now.text)}</b><small>Feels ${deg(f.now.feels)}${today ? ` · ${deg(today.max)} / ${deg(today.min)} today` : ""}${today && today.rainChance >= 20 ? ` · ${today.rainChance}% rain` : ""}</small></span>
    </div>
    <ol class="wx-days">${f.days
      .slice(0, 7)
      .map((d, i) => {
        const w = describe(d.code);
        const day = i === 0 ? "Today" : WD[new Date(`${d.date}T12:00:00+05:30`).getUTCDay()];
        return `<li title="${esc(w.text)}"><span class="wd">${day}</span>${iconSvg(w.icon)}<b>${deg(d.max)}</b><small>${deg(d.min)}</small>${d.rainChance >= 30 ? `<span class="rain">${d.rainChance}%</span>` : ""}</li>`;
      })
      .join("")}</ol>
    <p class="wx-src">Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p>
  </section>`;
}

/** A day's weather in a line (for a trip's stops). */
export function weatherLine(d: { code: number; max: number; min: number; rainChance: number }) {
  const w = describe(d.code);
  return `<span class="wx-mini" title="${esc(w.text)}">${iconSvg(w.icon)}${deg(d.max)} / ${deg(d.min)}${d.rainChance >= 30 ? ` · ${d.rainChance}% rain` : ""}</span>`;
}

// ---------------------------------------------------------------- the map layer

type RGBA = [number, number, number, number];
const lerp = (a: RGBA, b: RGBA, t: number): RGBA => a.map((x, i) => Math.round(x + (b[i] - x) * t)) as RGBA;

function ramp(stops: [number, RGBA][]) {
  return (v: number): RGBA => {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) return lerp(stops[i - 1][1], stops[i][1], (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
    return stops[stops.length - 1][1];
  };
}

const SCALES: Record<WeatherMode, { stops: [number, RGBA][]; ticks: string[]; unit: string; label: string }> = {
  temp: {
    stops: [
      [-10, [76, 60, 180, 235]],
      [0, [70, 120, 220, 230]],
      [10, [80, 180, 220, 225]],
      [18, [120, 205, 150, 220]],
      [24, [240, 215, 90, 220]],
      [30, [245, 150, 60, 225]],
      [36, [225, 70, 50, 230]],
      [44, [160, 20, 60, 235]],
    ],
    ticks: ["−10°", "0°", "10°", "20°", "30°", "40°"],
    unit: "°",
    label: "Temperature now",
  },
  rain: {
    stops: [
      [0, [150, 180, 220, 0]],
      [15, [150, 180, 220, 40]],
      [40, [80, 140, 230, 150]],
      [70, [40, 90, 210, 210]],
      [100, [70, 40, 170, 240]],
    ],
    ticks: ["0%", "25%", "50%", "75%", "100%"],
    unit: "%",
    label: "Chance of rain today",
  },
  cloud: {
    stops: [
      [0, [200, 205, 215, 0]],
      [30, [190, 196, 208, 70]],
      [70, [150, 158, 175, 170]],
      [100, [110, 118, 138, 225]],
    ],
    ticks: ["Clear", "", "", "Overcast"],
    unit: "%",
    label: "Cloud cover now",
  },
};

export const weatherColor = (mode: WeatherMode) => ramp(SCALES[mode].stops);
export const weatherUnit = (mode: WeatherMode) => SCALES[mode].unit;

export function legendHtml(mode: WeatherMode) {
  const s = SCALES[mode];
  const lo = s.stops[0][0], hi = s.stops[s.stops.length - 1][0];
  const gradient = s.stops.map(([v, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.25, c[3] / 255).toFixed(2)}) ${(((v - lo) / (hi - lo)) * 100).toFixed(0)}%`).join(", ");
  return `<div class="bar" style="background: linear-gradient(90deg, ${gradient})"></div><div class="ticks">${s.ticks.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`;
}

export const weatherLabel = (mode: WeatherMode) => SCALES[mode].label;
