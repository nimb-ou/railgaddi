// The usual weather month by month, and what kind of place somewhere is: worked out at build time
// (pipeline/climate.py) and shipped as a letter a month and a bit a mood.

/** One month as a traveller feels it. */
export type MonthKind = "B" | "G" | "R" | "M" | "H" | "W" | "C";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const KIND_WORDS: Record<MonthKind, string> = {
  B: "Lovely",
  G: "Good",
  R: "Rainy",
  M: "Hot",
  H: "Too hot",
  W: "Very wet",
  C: "Cold",
};

/** Good enough to go: lovely, good, or a few showers (not the monsoon's worst, not too hot or cold). */
export const goodMonth = (w: string | undefined, month: number) => !!w && (w[month] === "B" || w[month] === "G" || w[month] === "R");

/** This month, in India. */
export function monthNow(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", month: "numeric" }).format(d)) - 1;
}

/** Moods, as the build writes them (a bit each); big cities come from the timetable's own list. */
export const MOODS = {
  sea: { bit: 1, label: "Sea and sand", noun: "places by the sea" },
  hills: { bit: 2, label: "Up in the hills", noun: "places up in the hills" },
  spirit: { bit: 4, label: "Temples and shrines", noun: "temple towns and shrines" },
  heritage: { bit: 8, label: "Forts and palaces", noun: "places with forts and palaces" },
  wild: { bit: 16, label: "Wild and green", noun: "wild, green places" },
  city: { bit: 0, label: "Big city buzz", noun: "big cities" },
} as const;
export type Mood = keyof typeof MOODS;

/**
 * The months in runs, for a line like "Lovely from October to March": each run of months that
 * pass `test`, wrapping round the year.
 */
export function runs(w: string, test: (k: MonthKind) => boolean): [number, number][] {
  if (w.length !== 12) return [];
  const on = [...w].map((k) => test(k as MonthKind));
  if (on.every(Boolean)) return [[0, 11]];
  const out: [number, number][] = [];
  const start = on.findIndex((x, i) => !x && on[(i + 1) % 12]); // begin just after an off month
  if (start < 0) return [];
  for (let n = 1; n <= 12; n++) {
    const i = (start + n) % 12;
    if (!on[i]) continue;
    if (!on[(i + 11) % 12]) out.push([i, i]);
    else out[out.length - 1][1] = i;
  }
  return out;
}

/** "October to March", "May", "all year" */
export function spanWords([a, b]: [number, number]) {
  if (b === (a + 11) % 12) return "all year";
  return a === b ? MONTH_NAMES[a] : `${MONTH_NAMES[a]} to ${MONTH_NAMES[b]}`;
}

/** A line about when to go: "Lovely from October to March. June to September, it pours." */
export function whenLine(w: string) {
  const parts: string[] = [];
  const best = runs(w, (k) => k === "B" || k === "G");
  if (best.length) parts.push(best[0][0] === 0 && best[0][1] === 11 ? "Good all year round, balle balle." : `Best from ${best.map(spanWords).join(" and ")}.`);
  const wet = runs(w, (k) => k === "W");
  if (wet.length) parts.push(`${wet.map(spanWords).join(" and ")}: the monsoon pours.`);
  const hot = runs(w, (k) => k === "H");
  if (hot.length) parts.push(`${hot.map(spanWords).join(" and ")}: garmi, very hot.`);
  const cold = runs(w, (k) => k === "C");
  if (cold.length) parts.push(`${cold.map(spanWords).join(" and ")}: properly cold, pack the woollens.`);
  return parts.join(" ");
}
