// Times, durations and distances, the way a timetable prints them.

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes since midnight (any day) -> "07:05". */
export function fmtTime(m: number) {
  const d = ((Math.floor(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(d / 60))}:${pad(d % 60)}`;
}

/** Minutes -> "45m", "2h", "8h 40m". */
export function fmtMins(m: number) {
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

export const fmtKm = (k: number) => Math.round(k).toLocaleString("en-IN");

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** Minutes since midnight in India, whatever the visitor's own time zone. */
export function istNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}
