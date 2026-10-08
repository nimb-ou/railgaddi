// Sharing a place makes a railway poster of it (see DESIGN.md): its photo screen-printed in the
// site's five inks inside a jharokha arch, standing on a strip of track, its name in Tiro, how far
// it is by train on a ribbon, and a strip of phulkari. Drawn on a canvas
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
const FRAME = 28;
// the inks, darkest first: indigo, peacock, madder, turmeric and ivory (the site's own)
const INKS = [
  [34, 48, 94],
  [15, 107, 99],
  [158, 58, 43],
  [217, 154, 43],
  [248, 242, 231],
];
const INDIGO = "#22305e";
const IVORY = "#f8f2e7";
const MADDER = "#9e3a2b";
const TURMERIC = "#d99a2b";
const NAME = "'Tiro Devanagari Hindi', Georgia, serif";
const TEXT = "Hind, system-ui, sans-serif";
const SCRIPTS = "'Noto Sans Devanagari Variable', 'Noto Sans Kannada Variable', 'Noto Sans Tamil Variable', 'Noto Sans Telugu Variable', 'Noto Sans Malayalam Variable', 'Noto Sans Bengali Variable', 'Noto Sans Gujarati Variable', 'Noto Sans Gurmukhi Variable', 'Noto Sans Oriya Variable', Hind, sans-serif";

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
  sky.addColorStop(0, TURMERIC);
  sky.addColorStop(0.7, "#f3d79a");
  c.fillStyle = sky;
  c.fillRect(x, y, w, h);
  c.fillStyle = IVORY;
  c.beginPath();
  c.arc(x + w / 2, y + h * 0.4, w * 0.13, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = MADDER;
  c.beginPath();
  c.moveTo(x, y + h * 0.66);
  [[0.18, 0.5], [0.34, 0.62], [0.52, 0.45], [0.7, 0.6], [0.86, 0.49], [1, 0.57]].forEach(([fx, fy]) => c.lineTo(x + w * fx, y + h * fy));
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.fill();
  c.fillStyle = "#0f6b63";
  c.beginPath();
  c.moveTo(x, y + h * 0.8);
  c.quadraticCurveTo(x + w * 0.5, y + h * 0.7, x + w, y + h * 0.79);
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.fill();
}

/** The jharokha: a cusped Rajput arch over the box (the same shape as the site's photos). */
function arch(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const X = (v: number) => x + (v / 100) * w;
  const Y = (v: number) => y + (v / 100) * h;
  c.beginPath();
  c.moveTo(X(0), Y(100));
  c.lineTo(X(0), Y(42 * 0.6));
  const seg = (pts: number[]) => c.bezierCurveTo(X(pts[0]), Y(pts[1] * 0.6), X(pts[2]), Y(pts[3] * 0.6), X(pts[4]), Y(pts[5] * 0.6));
  seg([0, 36, 2, 33, 6, 31]);
  seg([6, 25, 10, 21, 16, 20]);
  seg([17, 13, 23, 9, 30, 9]);
  seg([34, 4, 41, 2, 46, 2]);
  c.lineTo(X(50), Y(0));
  c.lineTo(X(54), Y(2 * 0.6));
  seg([59, 2, 66, 4, 70, 9]);
  seg([77, 9, 83, 13, 84, 20]);
  seg([90, 21, 94, 25, 94, 31]);
  seg([98, 33, 100, 36, 100, 42]);
  c.lineTo(X(100), Y(100));
  c.closePath();
}

/** A strip of phulkari: bright diamonds on madder, as embroidered on a dupatta. */
function phulkari(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.fillStyle = "#7a2318";
  c.fillRect(x, y, w, h);
  const step = h * 3.2;
  const r = h * 0.38;
  for (let k = 0, cx = x + step / 4; cx < x + w; k++, cx += step / 2) {
    const big = k % 2 === 0;
    c.fillStyle = big ? (k % 4 === 0 ? "#f59f00" : "#e64980") : "#40c057";
    c.beginPath();
    if (big) {
      c.moveTo(cx, y + h / 2 - r);
      c.lineTo(cx + r, y + h / 2);
      c.lineTo(cx, y + h / 2 + r);
      c.lineTo(cx - r, y + h / 2);
      c.closePath();
    } else c.arc(cx, y + h / 2, r * 0.32, 0, Math.PI * 2);
    c.fill();
    if (big) {
      c.fillStyle = "#fff3bf";
      c.beginPath();
      c.moveTo(cx, y + h / 2 - r * 0.48);
      c.lineTo(cx + r * 0.48, y + h / 2);
      c.lineTo(cx, y + h / 2 + r * 0.48);
      c.lineTo(cx - r * 0.48, y + h / 2);
      c.closePath();
      c.fill();
    }
  }
}

/** The largest size (down to `min`) at which `text` fits `width`. */
function fit(c: CanvasRenderingContext2D, text: string, font: string, max: number, min: number, width: number) {
  let size = max;
  for (; size > min; size -= 4) {
    c.font = `${size}px ${font}`;
    if (c.measureText(text).width <= width) break;
  }
  return size;
}

export async function drawPoster(info: PosterInfo): Promise<HTMLCanvasElement> {
  await Promise.all(
    [document.fonts?.load(`400 120px ${NAME}`), document.fonts?.load(`600 28px ${TEXT}`), document.fonts?.load(`500 20px ${TEXT}`), info.script ? document.fonts?.load(`600 44px ${SCRIPTS}`, info.script) : null].map((p) => p?.catch(() => {})),
  );
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;

  // the frame, the paper, a strip of phulkari at the top
  c.fillStyle = INDIGO;
  c.fillRect(0, 0, W, H);
  c.fillStyle = IVORY;
  c.fillRect(FRAME, FRAME, W - 2 * FRAME, H - 2 * FRAME);
  phulkari(c, FRAME, FRAME, W - 2 * FRAME, 34);

  // the picture, in the arch, with a turmeric rim
  const aw = 720, ah = 800, ax = (W - aw) / 2, ay = 108;
  const img = info.photo ? await load(photoUrl(info.photo, coverWidth(info.photo, aw / 2, ah / 2))) : null;
  c.save();
  arch(c, ax, ay, aw, ah);
  c.clip();
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
  c.restore();
  arch(c, ax - 14, ay - 14, aw + 28, ah + 14);
  c.strokeStyle = TURMERIC;
  c.lineWidth = 6;
  c.stroke();

  // the track it all stands on: two rails and their sleepers
  const ty = ay + ah + 26;
  c.fillStyle = INDIGO;
  for (let x = FRAME + 30; x < W - FRAME - 30; x += 30) c.fillRect(x, ty - 8, 9, 34);
  c.fillRect(FRAME + 20, ty, W - 2 * FRAME - 40, 5);
  c.fillRect(FRAME + 20, ty + 14, W - 2 * FRAME - 40, 5);

  // the name in its own script, then big
  let y = ty + 36;
  c.textAlign = "center";
  c.textBaseline = "alphabetic";
  if (info.script) {
    y += 52;
    c.font = `600 44px ${SCRIPTS}`;
    c.fillStyle = MADDER;
    c.fillText(info.script, W / 2, y);
  }
  const size = fit(c, info.title, `400 ${NAME}`, info.script ? 128 : 144, 60, W - 2 * FRAME - 80);
  c.font = `400 ${size}px ${NAME}`;
  y += 10 + size * 0.86;
  c.fillStyle = INDIGO;
  c.fillText(info.title, W / 2, y);

  // how far by train, on a madder ribbon
  const line = `BY TRAIN · ${info.line.toUpperCase()}`;
  c.font = `600 27px ${TEXT}`;
  c.letterSpacing = "4px";
  const lw = c.measureText(line).width + 48;
  const ly = y + 26;
  c.fillStyle = MADDER;
  c.fillRect(W / 2 - lw / 2, ly, lw, 52);
  c.fillStyle = IVORY;
  c.fillText(line, W / 2 + 2, ly + 36);
  c.letterSpacing = "0px";

  // the maker's mark: a station's name board, and where to find it
  const by = H - FRAME - 70;
  c.fillStyle = "#f4c430";
  c.fillRect(FRAME + 32, by, 196, 46);
  c.strokeStyle = "#111";
  c.lineWidth = 3;
  c.strokeRect(FRAME + 32, by, 196, 46);
  c.font = `600 25px ${TEXT}`;
  c.letterSpacing = "3px";
  c.fillStyle = "#111";
  c.fillText("RAILGADDI", FRAME + 32 + 98 + 1, by + 32);
  c.letterSpacing = "0px";
  c.textAlign = "right";
  c.font = `500 22px ${TEXT}`;
  c.fillStyle = INDIGO;
  c.fillText(info.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), W - FRAME - 32, by + 20);
  if (info.photo && printed) {
    c.font = `400 17px ${TEXT}`;
    c.globalAlpha = 0.7;
    c.fillText(`Photo: ${credit(info.photo)}, adapted`.slice(0, 90), W - FRAME - 32, by + 44);
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
      <div class="ps-art"><div class="ps-wait">Printing your poster, ek minute…</div></div>
      <div class="ps-text">
        <h2>Share ${esc(info.title)}</h2>
        <p>A poster for the family group, and the link to this page.</p>
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
        toast("Link copied. Send it to the gang!");
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
