// Weather from Open-Meteo (open-meteo.com, free, no key, CC BY 4.0): what it's like at a place
// now and over the next days, and a coarse picture of the whole country for the map. Only the
// coordinates of places are sent, never yours. Answers are kept for half an hour.

const API = "https://api.open-meteo.com/v1/forecast";
const FRESH = 30 * 60 * 1000;

export interface Now {
  temp: number;
  feels: number;
  code: number;
  wind: number; // km/h
  humidity: number;
  day: boolean;
}

export interface Day {
  date: string; // YYYY-MM-DD, India time
  code: number;
  max: number;
  min: number;
  rainChance: number; // %
  rain: number; // mm
}

export interface Forecast {
  now: Now;
  days: Day[];
}

/** One point of the country-wide picture. */
export interface GridPoint {
  lat: number;
  lon: number;
  temp: number;
  cloud: number; // %
  rainChance: number; // % today
}

export type WeatherMode = "temp" | "rain" | "cloud";

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function remember<T>(key: string, get: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH) return hit.value as Promise<T>;
  const value = get().catch((err) => {
    cache.delete(key); // try again next time
    throw err;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

const round = (n: number, d = 2) => Number(n.toFixed(d));

async function json(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather: HTTP ${r.status}`);
  return r.json();
}

/** Now, and `days` days ahead (up to 16), at one place. */
export function forecast(lat: number, lon: number, days = 7): Promise<Forecast> {
  const la = round(lat), lo = round(lon);
  return remember(`f:${la},${lo},${days}`, async () => {
    const q = new URLSearchParams({
      latitude: String(la),
      longitude: String(lo),
      current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
      timezone: "Asia/Kolkata",
      forecast_days: String(Math.min(16, Math.max(1, days))),
    });
    const d = await json(`${API}?${q}`);
    const c = d.current;
    return {
      now: {
        temp: c.temperature_2m,
        feels: c.apparent_temperature,
        code: c.weather_code,
        wind: c.wind_speed_10m,
        humidity: c.relative_humidity_2m,
        day: !!c.is_day,
      },
      days: (d.daily.time as string[]).map((date, i) => ({
        date,
        code: d.daily.weather_code[i],
        max: d.daily.temperature_2m_max[i],
        min: d.daily.temperature_2m_min[i],
        rainChance: d.daily.precipitation_probability_max[i] ?? 0,
        rain: d.daily.precipitation_sum[i] ?? 0,
      })),
    };
  });
}

/** The country, point by point: temperature and cloud now, and today's chance of rain. */
export function grid(points: [number, number][]): Promise<GridPoint[]> {
  const key = `g:${points.length}:${points[0]?.join(",")}`;
  return remember(key, async () => {
    const out: GridPoint[] = [];
    // a few hundred points per request keeps the address a sensible length
    for (let i = 0; i < points.length; i += 150) {
      const part = points.slice(i, i + 150);
      const q = new URLSearchParams({
        latitude: part.map((p) => round(p[0])).join(","),
        longitude: part.map((p) => round(p[1])).join(","),
        current: "temperature_2m,cloud_cover",
        daily: "precipitation_probability_max",
        timezone: "Asia/Kolkata",
        forecast_days: "1",
      });
      const d = await json(`${API}?${q}`);
      const list = Array.isArray(d) ? d : [d];
      list.forEach((x: { current: { temperature_2m: number; cloud_cover: number }; daily: { precipitation_probability_max: (number | null)[] } }, j: number) =>
        out.push({ lat: part[j][0], lon: part[j][1], temp: x.current.temperature_2m, cloud: x.current.cloud_cover, rainChance: x.daily.precipitation_probability_max[0] ?? 0 }),
      );
    }
    return out;
  });
}

export function valueOf(p: GridPoint, mode: WeatherMode) {
  return mode === "temp" ? p.temp : mode === "rain" ? p.rainChance : p.cloud;
}

/** WMO weather codes, in words, with the icon that goes with them. */
export function describe(code: number, day = true): { text: string; icon: Icon } {
  if (code === 0) return { text: day ? "Clear" : "Clear night", icon: day ? "sun" : "moon" };
  if (code === 1) return { text: "Mostly clear", icon: day ? "sun" : "moon" };
  if (code === 2) return { text: "Partly cloudy", icon: "partly" };
  if (code === 3) return { text: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { text: "Fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { text: "Drizzle", icon: "drizzle" };
  if (code >= 61 && code <= 67) return { text: code >= 65 ? "Heavy rain" : "Rain", icon: "rain" };
  if (code >= 71 && code <= 77) return { text: "Snow", icon: "snow" };
  if (code >= 80 && code <= 82) return { text: "Showers", icon: "rain" };
  if (code >= 85 && code <= 86) return { text: "Snow showers", icon: "snow" };
  if (code >= 95) return { text: "Thunderstorms", icon: "storm" };
  return { text: "Cloudy", icon: "cloud" };
}

export type Icon = "sun" | "moon" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** Points on a regular grid over India (the caller keeps the ones on land). */
export function indiaGrid(step = 1.5): [number, number][] {
  const out: [number, number][] = [];
  for (let lat = 7; lat <= 36.5; lat += step) for (let lon = 68; lon <= 97.5; lon += step) out.push([lat, lon]);
  return out;
}
