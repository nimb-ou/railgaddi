// Renders the app icons and the link-preview image into public/ with the installed Chrome.
// Icons come from public/favicon.svg; og.jpg is the real landing page, its map and the one question.
// Needs the dev server running (npm run dev) for og.jpg.  node scripts/make-icons.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const svg = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
const out = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
const page = await browser.newPage();

// size, file, full-bleed background (for maskable / apple icons, which the OS crops itself), mark scale
const icons = [
  [192, "icon-192.png", null, 1],
  [512, "icon-512.png", null, 1],
  [512, "icon-maskable-512.png", "#22305e", 0.62],
  [180, "apple-touch-icon.png", "#22305e", 0.78],
  [48, "favicon-48.png", null, 1],
];
for (const [size, file, bg, scale] of icons) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${bg ?? "transparent"}">
    <div style="width:${size * scale}px;height:${size * scale}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body>`);
  await page.screenshot({ path: out(file), omitBackground: !bg });
  console.log("wrote", file);
}

// link preview: the landing page itself, the question and the map (a page of its own: the icon
// shots above leave theirs drawing on a transparent background)
const og = await browser.newPage();
await og.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await og.evaluateOnNewDocument(() => localStorage.setItem("railgaddi.theme", "day"));
await og.goto("http://localhost:5173/", { waitUntil: "networkidle2" });
await og.addStyleTag({
  content: `.map-tools, .loading, .suggest, .skip, .home .ask-to, .home .hills, .home .cta, .home .hero-fact { display: none !important; }`,
});
await og.evaluate(() => window.dispatchEvent(new Event("resize")));
await new Promise((r) => setTimeout(r, 5000));
// JPEG: WhatsApp drops previews over ~300 kB
await og.screenshot({ path: out("og.jpg"), type: "jpeg", quality: 86 });
console.log("wrote og.jpg");
await browser.close();
