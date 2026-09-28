// The station's moving parts (see DESIGN.md): split-flap tiles for times, the LED board on a
// coach's side for a train, and the landscape passing a train window while something loads.
import { esc } from "./esc";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FLAP_CHARS = "0123456789";

/** A time on split-flap tiles ("22:05"). With `settle`, the tiles spin and land when shown. */
export function flapHtml(text: string, settle = false) {
  const tiles = [...text].map((c) => (c === ":" || c === " " ? `<i class="sep">${c === ":" ? ":" : ""}</i>` : `<i>${esc(c)}</i>`)).join("");
  return `<span class="flap"${settle ? " data-settle" : ""} role="img" aria-label="${esc(text)}"><span aria-hidden="true">${tiles}</span></span>`;
}

/** Spin every freshly shown flap board once, tile by tile, like a departures board updating. */
export function settleFlaps(root: ParentNode) {
  for (const board of root.querySelectorAll<HTMLElement>(".flap[data-settle]")) {
    board.removeAttribute("data-settle");
    if (reduced()) continue;
    [...board.querySelectorAll<HTMLElement>("i:not(.sep)")].forEach((tile, k) => {
      const final = tile.textContent ?? "";
      const until = performance.now() + 180 + k * 70;
      const spin = () => {
        if (!tile.isConnected) return;
        if (performance.now() >= until) {
          tile.textContent = final;
          tile.classList.remove("spin");
          return;
        }
        tile.textContent = FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
        tile.classList.remove("spin");
        void tile.offsetWidth; // restart the fold
        tile.classList.add("spin");
        setTimeout(spin, 55);
      };
      spin();
    });
  }
}

/**
 * Flap tiles that follow a changing value (the timetable clock). A tile folds over only when its
 * character changes, and the fastest-changing one never folds, so the board stays calm.
 */
export class FlapClock {
  private tiles: HTMLElement[] = [];
  constructor(private el: HTMLElement) {}

  set(text: string) {
    if (this.tiles.length !== text.length) {
      this.el.innerHTML = [...text].map((c) => (c === ":" ? `<i class="sep">:</i>` : `<i>${esc(c)}</i>`)).join("");
      this.tiles = [...this.el.querySelectorAll<HTMLElement>("i")];
      return;
    }
    [...text].forEach((c, k) => {
      const tile = this.tiles[k];
      if (tile.textContent === c) return;
      tile.textContent = c;
      if (k === text.length - 1 || reduced()) return;
      tile.classList.remove("spin");
      void tile.offsetWidth;
      tile.classList.add("spin");
    });
  }
}

/**
 * An LED board, as on a coach's side or over a platform: what's departing. `lead` glows hotter
 * (a train's number). Where the Hindi is known, the second line alternates with it, as real
 * boards do.
 */
export function ledHtml(lead: string, name: string, route: string, routeHi = "", label = `Train ${lead}, ${name}, ${route}`) {
  return `<div class="led" role="img" aria-label="${esc(label)}">
    <div class="led-line" aria-hidden="true">${lead ? `<b>${esc(lead)}</b>` : ""}<span>${esc(name)}</span></div>
    <div class="led-line led-sub" aria-hidden="true"><span class="led-en">${esc(route)}</span>${routeHi ? `<span class="led-hi" lang="hi">${esc(routeHi)}</span>` : ""}</div>
  </div>`;
}

/**
 * The view from a train window, passing: far hills, a line of trees, the fields, and the poles
 * that flick by. Pure CSS motion (paused for reduced motion). Used while things load.
 */
export function landscapeHtml(cls = "") {
  const hills = `<svg viewBox="0 0 400 100" preserveAspectRatio="none"><path d="M0 62 Q40 40 80 52 T160 48 T240 56 T320 44 T400 54 V100 H0Z"/></svg>`;
  const trees = `<svg viewBox="0 0 400 100" preserveAspectRatio="none"><path d="M0 74 Q50 66 100 72 T200 70 T300 73 T400 70 V100 H0Z"/><g><circle cx="38" cy="68" r="7"/><circle cx="46" cy="70" r="5"/><circle cx="150" cy="66" r="8"/><circle cx="252" cy="69" r="6"/><circle cx="262" cy="70" r="4.5"/><circle cx="352" cy="67" r="7"/></g></svg>`;
  const field = `<svg viewBox="0 0 400 100" preserveAspectRatio="none"><path d="M0 84 Q100 80 200 83 T400 82 V100 H0Z"/></svg>`;
  const poles = `<svg viewBox="0 0 400 100" preserveAspectRatio="none"><g class="pole"><rect x="60" y="18" width="2.6" height="82"/><rect x="260" y="18" width="2.6" height="82"/></g><path class="wire" d="M0 24 Q130 34 261 24 T400 26" fill="none"/></svg>`;
  return `<div class="landscape ${cls}" aria-hidden="true">
    <div class="ls-sky"></div>
    <div class="ls-layer ls-hills">${hills}${hills}</div>
    <div class="ls-layer ls-trees">${trees}${trees}</div>
    <div class="ls-layer ls-field">${field}${field}</div>
    <div class="ls-layer ls-poles">${poles}${poles}</div>
  </div>`;
}
