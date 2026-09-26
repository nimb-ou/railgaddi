// Three palettes to compare. Each one lives in style.css under [data-theme=…].

export const THEMES = [
  { id: "dusk", name: "Dusk", swatch: "linear-gradient(135deg, #1b2362 0 50%, #ffc247 50% 70%, #3fc4ff 70%)" },
  { id: "daylight", name: "Daylight", swatch: "linear-gradient(135deg, #eef5fd 0 50%, #ff7a1a 50% 70%, #5b5bf0 70%)" },
  { id: "monsoon", name: "Monsoon", swatch: "linear-gradient(135deg, #0e3a37 0 50%, #ffd166 50% 70%, #5be3b3 70%)" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "patri.theme";

export function savedTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY);
    if (THEMES.some((x) => x.id === t)) return t as ThemeId;
  } catch {
    /* storage can be unavailable; fall back to the default */
  }
  return "dusk";
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* not persisted, still applied */
  }
}
