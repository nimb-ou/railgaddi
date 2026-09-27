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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Minutes since Monday 00:00 in India: the "now" that running days are checked against. */
export function istWeekMinute(date = new Date()) {
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" }).format(date);
  return WEEKDAYS.indexOf(wd.slice(0, 3)) * 1440 + istNow(date);
}

/** Running days as people say them: "Daily", "Except Wed", "Mon, Thu"; "" when not known. */
export function daysLabel(mask: number) {
  if (!mask) return "";
  if (mask === 127) return "Daily";
  const on = WEEKDAYS.filter((_, i) => (mask >> i) & 1);
  if (on.length === 6) return `Except ${WEEKDAYS.find((_, i) => !((mask >> i) & 1))}`;
  return on.join(", ");
}

/** Shift a running-days mask by `days` (the days a train is on the move before reaching a halt). */
export function shiftDays(mask: number, days: number) {
  const k = ((days % 7) + 7) % 7;
  return ((mask << k) | (mask >> (7 - k))) & 127;
}

/** "today", "tomorrow" or a weekday, for a moment `wait` minutes after `now` (minutes into the week). */
export function dayWord(now: number, wait: number) {
  const days = Math.floor(((now % 1440) + wait) / 1440);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return WEEKDAYS[(Math.floor(now / 1440) + days) % 7];
}

