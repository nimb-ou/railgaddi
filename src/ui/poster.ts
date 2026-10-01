// Sharing a place makes a railway poster of it (see DESIGN.md): its photo screen-printed in five
// flat inks, the name in big condensed capitals, and how far it is by train. Drawn on a canvas
// in the browser, so every one of the site's places has one, and nothing is uploaded anywhere.
import type { Photo } from "../core/places";
import { esc } from "./esc";
import { coverWidth, credit, loadedImage, photoUrl } from "./photos";

export interface PosterInfo {
  title: string;
  script: string; // the name in Hindi or the local script, if known
  state: string;
  line: string; // "8h 40m from Bengaluru by train"
  photo: Photo | null;
  url: string;
}

const W = 1080;
const H = 1350;
const FRAME = 40;
// the inks, darkest first: a travel poster's navy, teal, terracotta, marigold and paper
const INKS = [
  [30, 58, 76],
  [47, 111, 115],
  [201, 115, 58],
  [242, 169, 59],
  [246, 231, 200],
];
const NAVY = "#1e3a4c";
const PAPER = "#f3e7cf";
const FONT = "'Archivo Variable', 'Archivo', system-ui, sans-serif";
const SCRIPTS = "'Archivo Variable', 'Noto Sans Devanagari Variable', 'Noto Sans Kannada Variable', 'Noto Sans Tamil Variable', 'Noto Sans Telugu Variable', 'Noto Sans Malayalam Variable', 'Noto Sans Bengali Variable', 'Noto Sans Gujarati Variable', 'Noto Sans Gurmukhi Variable', 'Noto Sans Oriya Variable', system-ui, sans-serif";

function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const now = loadedImage(url, () => resolve(loadedImage(url, () => {})));
    if (now) resolve(now);
    setTimeout(() => resolve(null), 8000);
  });
}

/** Cover-crop an image into a box, then print it in the poster's five inks. */
function screenPrint(img: HTMLImageElement, w: number, h: number) {
  // soften first (draw small, scale up) so the inks form flat shapes rather than speckle
  const small = document.createElement("canvas");
  small.width = Math.round(w / 5);
  small.height = Math.round(h / 5);
  const sc = small.getContext("2d")!;
  const s = Math.max(small.width / img.naturalWidth, small.height / img.naturalHeight);
  sc.imageSmoothingQuality = "high";
  sc.drawImage(img, (small.width - img.naturalWidth * s) / 2, (small.height - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const oc = out.getContext("2d", { willReadFrequently: true })!;
  oc.imageSmoothingQuality = "high";
  oc.drawImage(small, 0, 0, w, h);
  const data = oc.getImageData(0, 0, w, h);
  const px = data.data;
  // spread the photo's own tones over the five inks (its darkest to its lightest)
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 16) hist[Math.round(0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2])]++;
  const total = hist.reduce((a, b) => a + b, 0);
  const cuts: number[] = [];
  let acc = 0;
  const shares = [0.16, 0.38, 0.62, 0.84];
  for (let v = 0, k = 0; v < 256 && k < shares.length; v++) {
    acc += hist[v];
    while (k < shares.length && acc >= shares[k] * total) cuts[k++] = v;
  }
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
    let k = 0;
    while (k < cuts.length && l > cuts[k]) k++;
    const ink = INKS[k];
    px[i] = ink[0];
    px[i + 1] = ink[1];
    px[i + 2] = ink[2];
  }
  oc.putImageData(data, 0, 0);
  return out;
}

/** No photo: a sun over hills, in the same inks. */
function scenery(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const sky = c.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, "#f2a93b");
  sky.addColorStop(0.7, "#f6d38a");
  c.fillStyle = sky;
  c.fillRect(x, y, w, h);
  c.fillStyle = "#fff1c7";
  c.beginPath();
  c.arc(x + w / 2, y + h * 0.36, w * 0.12, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#c9733a";
  c.beginPath();
  c.moveTo(x, y + h * 0.62);
  [[0.18, 0.45], [0.34, 0.58], [0.52, 0.4], [0.7, 0.55], [0.86, 0.44], [1, 0.52]].forEach(([fx, fy]) => c.lineTo(x + w * fx, y + h * fy));
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.fill();
  c.fillStyle = "#2f6f73";
  c.beginPath();
  c.moveTo(x, y + h * 0.78);
  c.quadraticCurveTo(x + w * 0.5, y + h * 0.66, x + w, y + h * 0.76);
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.fill();
}

/** The largest size (down to `min`) at which `text` fits `width`, in the station-board face. */
function fit(c: CanvasRenderingContext2D, text: string, style: string, max: number, min: number, width: number) {
  let size = max;
  for (; size > min; size -= 4) {
    c.font = `${style} ${size}px ${FONT}`;
    if (c.measureText(text).width <= width) break;
  }
  return size;
}

export async function drawPoster(info: PosterInfo): Promise<HTMLCanvasElement> {
  // the condensed width is only used here: the rest of the site loads the lighter weight-only font
  await import("@fontsource-variable/archivo/wdth.css").catch(() => {});
  await Promise.all(
    [document.fonts?.load(`900 condensed 100px ${FONT}`), document.fonts?.load(`900 100px ${FONT}`), document.fonts?.load(`700 30px ${FONT}`), info.script ? document.fonts?.load(`700 36px ${SCRIPTS}`, info.script) : null].map((p) => p?.catch(() => {})),
  );
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;

  // the frame and the paper
  c.fillStyle = NAVY;
  c.fillRect(0, 0, W, H);
  c.fillStyle = PAPER;
  c.fillRect(FRAME, FRAME, W - 2 * FRAME, H - 2 * FRAME);

  // the picture
  const ax = FRAME + 20, ay = FRAME + 20, aw = W - 2 * ax, ah = 870;
  const img = info.photo ? await load(photoUrl(info.photo, coverWidth(info.photo, aw / 2, ah / 2))) : null;
  let printed = false;
  if (img) {
    try {
      c.drawImage(screenPrint(img, aw, ah), ax, ay);
      printed = true;
    } catch {
      /* a photo without CORS headers taints the canvas: fall back to scenery */
    }
  }
  if (!printed) scenery(c, ax, ay, aw, ah);
  // sun rays over the sky, faint, as printed posters had
  c.save();
  c.beginPath();
  c.rect(ax, ay, aw, ah * 0.55);
  c.clip();
  c.globalAlpha = 0.07;
  c.fillStyle = "#fff6dc";
  const [sx, sy] = [ax + aw / 2, ay + ah * 0.34];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
    c.beginPath();
    c.moveTo(sx, sy);
    c.arc(sx, sy, 1400, a, a + Math.PI / 30);
    c.fill();
  }
  c.restore();

  // a train crossing the foot of the picture, on its embankment
  const ty = ay + ah - 74;
  c.fillStyle = NAVY;
  c.fillRect(ax, ty + 52, aw, 22);
  const coaches = 5;
  for (let k = 0; k < coaches; k++) {
    const x = ax + 90 + k * 158;
    c.beginPath();
    c.roundRect(x, ty, 152, 48, k === 0 ? [22, 5, 5, 5] : 4);
    c.fill();
  }
  c.fillStyle = "#f6d38a";
  for (let k = 0; k < coaches; k++) for (let w = 0; w < 5; w++) c.fillRect(ax + 104 + k * 158 + w * 27, ty + 10, 17, 13);
  c.fillStyle = "#c9733a";
  for (let k = 0; k < coaches; k++) c.fillRect(ax + 90 + k * 158, ty + 32, 152, 4); // the livery stripe

  // the name in the local script, then big in capitals
  let y = ay + ah;
  c.textAlign = "center";
  c.textBaseline = "alphabetic";
  if (info.script) {
    y += 62;
    c.font = `700 46px ${SCRIPTS}`;
    c.fillStyle = "#c9733a";
    c.fillText(info.script, W / 2, y);
  }
  const name = info.title.toUpperCase();
  // condensed capitals, as on a station board (the width is part of the font shorthand: setting
  // ctx.font resets ctx.fontStretch)
  const size = fit(c, name, "900 condensed", info.script ? 176 : 196, 70, aw - 30);
  c.font = `900 condensed ${size}px ${FONT}`;
  y += 22 + size * 0.74;
  const ny = y;
  c.fillStyle = NAVY;
  c.fillText(name, W / 2, ny);

  const line = `BY TRAIN · ${info.line.toUpperCase()}`;
  c.font = `800 29px ${FONT}`;
  c.letterSpacing = "5px";
  const lw = c.measureText(line).width + 44;
  const ly = ny + 28;
  c.fillStyle = NAVY;
  c.fillRect(W / 2 - lw / 2, ly, lw, 54);
  c.fillStyle = PAPER;
  c.fillText(line, W / 2 + 3, ly + 38);
  c.letterSpacing = "0px";

  // the maker's mark: a small station board, and where to find it
  const by = H - FRAME - 64;
  c.textAlign = "left";
  c.fillStyle = "#ffd02b";
  c.beginPath();
  c.roundRect(ax, by, 150, 40, 4);
  c.fill();
  c.strokeStyle = "#111";
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(ax + 4, by + 4, 142, 32, 3);
  c.stroke();
  c.font = `900 condensed 24px ${FONT}`;
  c.fillStyle = "#111";
  c.textAlign = "center";
  c.fillText("RAILGADDI", ax + 75, by + 28);
  c.textAlign = "right";
  c.font = `600 22px ${FONT}`;
  c.fillStyle = NAVY;
  c.fillText(info.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), W - ax, by + 20);
  if (info.photo && printed) {
    c.font = `500 17px ${FONT}`;
    c.globalAlpha = 0.7;
    c.fillText(`Photo: ${credit(info.photo)}, adapted`.slice(0, 90), W - ax, by + 44);
    c.globalAlpha = 1;
  }
  return cv;
}

/** The sheet that shows the poster, with ways to send it. */
export async function openPosterSheet(info: PosterInfo, toast: (s: string) => void) {
  document.querySelector(".poster-sheet")?.remove();
  const sheet = document.createElement("div");
  sheet.className = "poster-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", `Share ${info.title}`);
  sheet.innerHTML = `<div class="ps-card">
      <div class="ps-art"><div class="ps-wait">Printing the poster…</div></div>
      <div class="ps-text">
        <h2>Share ${esc(info.title)}</h2>
        <p>A poster to send, and the link to this page.</p>
        <div class="ps-actions">
          <button type="button" class="ps-main" data-ps="share" disabled>Share poster</button>
          <button type="button" data-ps="save" disabled>Save image</button>
          <button type="button" data-ps="link">Copy link</button>
        </div>
      </div>
      <button type="button" class="round ps-close" data-ps="close" aria-label="Close"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button>
    </div>`;
  document.body.append(sheet);
  const back = document.activeElement as HTMLElement | null;
  const close = () => {
    sheet.classList.add("closing");
    setTimeout(() => sheet.remove(), 220);
    document.removeEventListener("keydown", onKey);
    back?.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    if (e.key !== "Tab") return;
    // keep focus inside the dialog while it's open
    const items = [...sheet.querySelectorAll<HTMLElement>("button:not([disabled]):not([hidden])")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) (e.preventDefault(), items[items.length - 1]?.focus());
    else if (!e.shiftKey && i === items.length - 1) (e.preventDefault(), items[0]?.focus());
  };
  document.addEventListener("keydown", onKey);
  sheet.querySelector<HTMLElement>("[data-ps=link]")!.focus();

  const slug = info.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place";
  let file: File | null = null;
  drawPoster(info).then((cv) =>
    cv.toBlob((blob) => {
      if (!blob || !sheet.isConnected) return;
      file = new File([blob], `railgaddi-${slug}.png`, { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const art = sheet.querySelector(".ps-art")!;
      art.innerHTML = `<img src="${url}" alt="A poster of ${esc(info.title)}: ${esc(info.line)} by train" />`;
      for (const b of sheet.querySelectorAll<HTMLButtonElement>("[disabled]")) b.disabled = false;
      if (!navigator.canShare?.({ files: [file] })) sheet.querySelector<HTMLElement>("[data-ps=share]")!.hidden = true;
    }, "image/png"),
  );

  sheet.addEventListener("click", async (e) => {
    if (e.target === sheet) return close();
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-ps]")?.dataset.ps;
    try {
      if (act === "close") close();
      else if (act === "link") {
        await navigator.clipboard.writeText(info.url);
        toast("Link copied");
      } else if (act === "save" && file) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } else if (act === "share" && file) {
        await navigator.share({ files: [file], title: `${info.title} by train`, text: `${info.title}: ${info.line} by train. ${info.url}` });
      }
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") toast("Couldn't do that here. Copy the address from the address bar.");
    }
  });
}
