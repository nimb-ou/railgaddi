// The frame around the map: Day/Night switch, the About dialog, and the pause button for the
// moving trains (moving content needs one: WCAG 2.2.2).
import type { RailMap } from "../map/map";
import { THEMES, applyTheme, savedTheme, type ThemeId } from "./theme";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ICONS: Record<ThemeId, string> = {
  day: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>`,
  night: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 9.8A5.5 5.5 0 0 1 6.2 3a5.5 5.5 0 1 0 6.8 6.8z"/></svg>`,
};

export function applySavedTheme() {
  applyTheme(savedTheme());
}

export function setupChrome(map: RailMap, onTheme: () => void) {
  // Day / Night
  const themes = $("themes");
  themes.innerHTML = THEMES.map((t) => `<button type="button" role="radio" data-id="${t.id}">${ICONS[t.id]}<span>${t.name}</span></button>`).join("");
  const mark = () => {
    for (const b of themes.querySelectorAll<HTMLElement>("button")) b.setAttribute("aria-checked", String(b.dataset.id === document.documentElement.dataset.theme));
  };
  mark();
  themes.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!b) return;
    applyTheme(b.dataset.id as ThemeId);
    mark();
    map.readTheme();
    onTheme();
  });

  // About
  const info = $("info");
  const btn = $("info-btn");
  const setInfo = (on: boolean) => {
    info.hidden = !on;
    btn.setAttribute("aria-expanded", String(on));
    if (on) info.querySelector<HTMLElement>("h2")?.focus();
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setInfo(info.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!info.hidden && !info.contains(e.target as Node) && e.target !== btn) setInfo(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !info.hidden) {
      setInfo(false);
      btn.focus();
    }
  });

  // the moving trains: a pause button (anything that moves on its own must be pausable)
  const toggle = $("clock-toggle");
  const icon = $("clock-icon");
  const setPlaying = (on: boolean) => {
    map.playing = on;
    toggle.setAttribute("aria-pressed", String(on));
    const label = on ? "Pause the moving trains" : "Play the moving trains";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    icon.setAttribute("d", on ? "M4 3h3v10H4zM9 3h3v10H9z" : "M5 3l8 5-8 5z");
  };
  toggle.addEventListener("click", () => setPlaying(!map.playing));
  setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
