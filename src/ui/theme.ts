// Two palettes, both taken from the journey (see DESIGN.md):
//   Day   — a printed timetable: paper, coach blue, station-board yellow
//   Night — a sleeper coach after dark: deep livery blue, lamp yellow
// Each lives in style.css under [data-theme=…].

export const THEMES = [
  { id: "day", name: "Day" },
  { id: "night", name: "Night" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "railgaddi.theme";

export function savedTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY);
    if (THEMES.some((x) => x.id === t)) return t as ThemeId;
  } catch {
    /* storage can be unavailable; fall back to the default */
  }
  return "day";
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* not persisted, still applied */
  }
}
