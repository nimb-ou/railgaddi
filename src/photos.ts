// Wikimedia Commons photos: sized thumbnail URLs, a small image cache for the canvas,
// and credit lines.
import type { Photo } from "./data";

// Wikimedia serves (and caches) these thumbnail widths.
const STEPS = [120, 250, 330, 500, 960, 1280];

export function photoUrl(p: Photo, want: number): string {
  const m = p.t.match(/\/(\d+)px-[^/]+$/);
  if (!m) return p.t; // the file is smaller than a thumbnail: this is the original
  let w = STEPS.find((s) => s >= want) ?? STEPS[STEPS.length - 1];
  if (p.w && w >= p.w) w = [...STEPS].reverse().find((s) => s < p.w!) ?? Number(m[1]);
  return p.t.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
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
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}
