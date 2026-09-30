// The frame around the map: the Day/Night switch and the About dialog.
import type { RailMap } from "../map/map";
import { applyTheme, savedTheme } from "./theme";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MOON = "M16 11.8A6.5 6.5 0 0 1 8.2 4a6.5 6.5 0 1 0 7.8 7.8z";
const SUN = "M10 6.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM10 1.8v1.6M10 16.6v1.6M1.8 10h1.6M16.6 10h1.6M4.2 4.2l1.1 1.1M14.7 14.7l1.1 1.1M4.2 15.8l1.1-1.1M14.7 5.3l1.1-1.1";

export function applySavedTheme() {
  applyTheme(savedTheme());
}

export function setupChrome(map: RailMap, onTheme: () => void) {
  // Day / Night: one button, showing what it switches to
  const btn = $("theme-btn");
  const icon = $("theme-icon");
  const mark = () => {
    const night = document.documentElement.dataset.theme === "night";
    icon.setAttribute("d", night ? SUN : MOON);
    btn.setAttribute("aria-label", night ? "Switch to light" : "Switch to dark");
    btn.title = night ? "Light" : "Dark";
  };
  mark();
  btn.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "night" ? "day" : "night");
    mark();
    map.readTheme();
    onTheme();
  });

  // About
  const info = $("info");
  const infoBtn = $("info-btn");
  const setInfo = (on: boolean) => {
    info.hidden = !on;
    infoBtn.setAttribute("aria-expanded", String(on));
    if (on) info.querySelector<HTMLElement>("h2")?.focus();
  };
  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setInfo(info.hidden);
  });
  // /privacy/ opens the About box at its privacy note
  if (/\/privacy\/?$/.test(location.pathname)) requestAnimationFrame(() => {
    setInfo(true);
    document.getElementById("privacy")?.scrollIntoView({ block: "center" });
  });
  document.addEventListener("click", (e) => {
    if (!info.hidden && !info.contains(e.target as Node) && e.target !== infoBtn) setInfo(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !info.hidden) {
      setInfo(false);
      infoBtn.focus();
    }
  });
}
