// Wikimedia Commons photos: thumbnail URLs at the right size for the screen, a small image
// cache for the canvas, and credit lines.
import type { Photo } from "../core/places";

// Widths Wikimedia serves (and caches) as thumbnails.
const STEPS = [120, 250, 330, 500, 960, 1280, 1920];

/** Largest step we may ask for: never more than the original's width. */
function capped(p: Photo, w: number) {
  if (!p.w || w < p.w) return w;
  return [...STEPS].reverse().find((s) => s < p.w!) ?? 0;
}

/** Width of the original over its height; 4:3 when unknown. */
export const aspect = (p: Photo) => (p.w && p.h ? p.w / p.h : 4 / 3);

/** CSS width a photo must have to cover a w×h box (a wide banner in a squarish slot needs far more). */
export const coverWidth = (p: Photo, w: number, h: number) => Math.ceil(Math.max(w, h * aspect(p)));

export function photoUrl(p: Photo, want: number): string {
  if (!/\/\d+px-[^/]+$/.test(p.t)) return p.t; // smaller than any thumbnail: this is the original
  const w = capped(p, STEPS.find((s) => s >= want) ?? STEPS[STEPS.length - 1]);
  return w ? p.t.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`) : p.t;
}

/** srcset across the thumbnail steps from `min` to `max` CSS-pixel widths (covers 1x-3x screens). */
export function photoSrcset(p: Photo, min: number, max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of STEPS) {
    if (s < min || s > max) continue;
    const url = photoUrl(p, s);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(`${url} ${capped(p, s) || s}w`);
  }
  return out.join(", ");
}

export function credit(p: Photo) {
  if (!p.by && !p.lic) {
    // author and licence live on the file's Commons page, which this credit links to
    const file = decodeURIComponent((p.page ?? "").split("File:")[1] ?? "photo").replace(/_/g, " ").replace(/\.\w+$/, "");
    return `${file} · Wikimedia Commons`;
  }
  const by = p.by && !/^unknown/i.test(p.by) ? p.by : "Unknown author";
  return `${by}${p.lic ? `, ${p.lic}` : ""}`;
}

const images = new Map<string, HTMLImageElement | "failed">();

/** The image if it has loaded; otherwise starts loading it and calls `ready` when done. */
export function loadedImage(url: string, ready: () => void): HTMLImageElement | null {
  const hit = images.get(url);
  if (hit === "failed") return null;
  if (hit) return hit.complete && hit.naturalWidth ? hit : null;
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous"; // Commons sends CORS headers: cacheable offline, canvas stays clean
  img.referrerPolicy = "no-referrer";
  img.onload = ready;
  img.onerror = () => images.set(url, "failed");
  img.src = url;
  images.set(url, img);
  return null;
}

/** Draw an image into a circle, cropped to cover it (like CSS object-fit: cover). */
export function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, r: number) {
  const s = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}
