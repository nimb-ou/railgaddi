// Travel guides for places: a small index loaded up front (photos for the map, what to rank
// first), and each place's intro and sights fetched from its shard when it's opened.
// Written by pipeline/build_places.py.
import type { Network, Place } from "./network";

export interface Photo {
  t: string; // 330px thumbnail URL on upload.wikimedia.org
  w?: number; // original size: never ask for a larger thumbnail than exists, and crop sizes right
  h?: number;
  by: string;
  lic: string;
  page: string; // the Commons file page: author, licence, full size
}

export interface Sight {
  n: string;
  k: "see" | "do";
  d?: string;
  img?: string; // photo key
  ll?: [number, number];
  q?: string; // a Wikidata landmark rather than a Wikivoyage listing
}

export interface ArticleEntry {
  icon?: string;
  banner?: string;
  ll?: [number, number];
  appeal: number; // how much there is to see: ranks which places get a photo bubble
  src?: "wd"; // no Wikivoyage guide: put together from Wikidata landmarks
  n: number; // number of sights
}

export interface ArticleDetail {
  x: string;
  sights: Sight[];
}

interface RawPhoto {
  t: string;
  w?: number;
  h?: number;
  by?: string;
  lic?: string;
}

export interface PlacesIndex {
  meta: { text: string; photos: string; fetched: string; shards: number };
  stations: Record<string, [string | null, string[]]>;
  cities: Record<string, string>;
  articles: Record<string, ArticleEntry>;
  photos: Record<string, RawPhoto>;
}

interface Shard {
  articles: Record<string, ArticleDetail>;
  photos: Record<string, RawPhoto>;
}

/** The travel guide shown for a place. */
export interface GuideView {
  title: string;
  entry: ArticleEntry;
  /** the guide is a highlight near the station rather than the town itself (Hosapete -> Hampi) */
  featured: boolean;
  nearby: string[];
  icon: Photo | null;
  banner: Photo | null;
}

const THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/";

export function photo(key: string, raw: RawPhoto): Photo {
  return {
    t: raw.t.startsWith("http") ? raw.t : THUMB + raw.t,
    w: raw.w,
    h: raw.h,
    by: raw.by ?? "",
    lic: raw.lic ?? "",
    page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(key.replace(/ /g, "_"))}`,
  };
}

/** 32-bit FNV-1a over UTF-8; the pipeline uses the same to put a place in a shard. */
export function fnv1a(text: string) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

export function buildGuideIndex(ix: PlacesIndex, net: Network): Map<Place, GuideView> {
  const has = (t: string | null | undefined): t is string => !!t && t in ix.articles;
  const pic = (k?: string) => (k && ix.photos[k] ? photo(k, ix.photos[k]) : null);
  const appeal = (t: string | null) => (t ? ix.articles[t].appeal : 0);
  const index = new Map<Place, GuideView>();
  for (const place of net.places.values()) {
    let primary: string | null = place.isCity && has(ix.cities[place.id]) ? ix.cities[place.id] : null;
    const near: string[] = [];
    for (const s of place.stations) {
      const st = net.stations[s];
      const link = ix.stations[st.code] ?? (st.was && ix.stations[st.was[0]]); // guides matched before a rename
      if (!link) continue;
      if (!primary && has(link[0])) primary = link[0];
      for (const t of link[1]) if (has(t) && !near.includes(t)) near.push(t);
    }
    const nearby = near.filter((t) => t !== primary);
    // a famous sight next to a small station deserves the spotlight (Hosapete -> Hampi)
    const star = nearby.filter((t) => ix.articles[t].icon).sort((a, b) => appeal(b) - appeal(a))[0];
    let title = primary;
    let featured = false;
    if (!place.isCity && star && appeal(star) >= 12 && appeal(star) > appeal(primary) * 1.8 + 4) {
      title = star;
      featured = !!primary || !place.name.toLowerCase().includes(star.toLowerCase());
    }
    if (!title) continue;
    const entry = ix.articles[title];
    index.set(place, {
      title,
      entry,
      featured,
      nearby: nearby.filter((t) => t !== title).slice(0, 4),
      icon: pic(entry.icon),
      banner: pic(entry.banner),
    });
  }
  return index;
}

/** Fetches a place's intro and sights from its shard, once. */
export class PlaceDetails {
  private shards = new Map<number, Promise<Shard>>();

  constructor(
    private urls: string[],
    private count: number,
  ) {}

  private shard(title: string) {
    const i = fnv1a(title) % this.count;
    let p = this.shards.get(i);
    if (!p) {
      p = fetch(this.urls[i]).then((r) => {
        if (!r.ok) throw new Error(`place details: HTTP ${r.status}`);
        return r.json() as Promise<Shard>;
      });
      p.catch(() => this.shards.delete(i)); // let a later attempt retry
      this.shards.set(i, p);
    }
    return p;
  }

  async get(title: string): Promise<{ detail: ArticleDetail; photos: Map<string, Photo> } | null> {
    const s = await this.shard(title);
    const detail = s.articles[title];
    if (!detail) return null;
    const photos = new Map<string, Photo>();
    for (const sight of detail.sights) if (sight.img && s.photos[sight.img]) photos.set(sight.img, photo(sight.img, s.photos[sight.img]));
    return { detail, photos };
  }

  /** Warm the cache, e.g. when the pointer rests on a place. */
  prefetch(title: string) {
    this.shard(title).catch(() => {});
  }
}
