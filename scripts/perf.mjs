// How long common actions take to show a response, on a phone-speed CPU (4x slower): the
// browser's own input-to-paint timing (Event Timing, as in the INP metric), plus long tasks.
//   node scripts/perf.mjs [--desktop] [base URL]   (default: the production preview on :4173)
// --desktop: a laptop-sized window at full speed, instead of a phone at a quarter of it.
import puppeteer from "puppeteer-core";

const desktop = process.argv.includes("--desktop");
const BASE = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:4173").replace(/\/$/, "");
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: desktop
    ? { width: 1440, height: 900, deviceScaleFactor: 2 }
    : { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
const cdp = await page.target().createCDPSession();
if (!desktop) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("railgaddi.hinted", "1");
  window.__ev = [];
  window.__long = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.interactionId) window.__ev.push([e.name, Math.round(e.duration)]);
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
  }).observe({ type: "longtask", buffered: true });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function step(label, fn, settle = 1500) {
  await page.evaluate(() => {
    window.__ev = [];
    window.__long = [];
  });
  const t = Date.now();
  await fn();
  await wait(settle);
  const { ev, long } = await page.evaluate(() => ({ ev: window.__ev, long: window.__long }));
  const worst = Math.max(0, ...ev.map((e) => e[1]));
  const blocked = long.reduce((a, b) => a + b, 0);
  results.push([label, worst, blocked, Date.now() - t - settle]);
}
const tapAt = async (sel) => {
  const el = await page.$(sel);
  if (!el) throw new Error(`no ${sel}`);
  await (desktop ? el.click() : el.tap());
};

await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 90000 });
await wait(3000);
await step("type in search", async () => {
  await tapAt("#origin-input");
  await page.keyboard.type("bengal", { delay: 120 });
});
await step("pick Bengaluru", () => page.keyboard.press("Enter"), 3500);
await step("tap a photo on the map", async () => {
  const pt = await page.evaluate(() => {
    const m = window.__map;
    return m ? null : null;
  });
  void pt;
  await page.mouse.click(desktop ? 900 : 206, desktop ? 400 : 330); // somewhere on the map: a bubble or the background
}, 2500);
await page.goto(`${BASE}/from/bengaluru/to/hampi/`, { waitUntil: "networkidle2", timeout: 90000 });
await wait(3500);
await step("open the next train", () => tapAt(".ticket-next"), 2500);
await step("back to the place", () => tapAt("[data-act=back]"), 2500);
await step("close the place", () => tapAt("[data-act=close]"), 2500);
await step("slide 'reach within'", async () => {
  const r = await page.$eval("#within", (el) => {
    const b = el.getBoundingClientRect();
    return [b.left, b.top + b.height / 2, b.width];
  });
  await page.mouse.move(r[0] + r[2] - 5, r[1]);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) await page.mouse.move(r[0] + r[2] - 5 - i * (r[2] / 10), r[1], { steps: 2 });
  await page.mouse.up();
}, 2500);
await step("drag the map", async () => {
  await page.mouse.move(200, 300);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) await page.mouse.move(200 + i * 10, 300 + i * 6);
  await page.mouse.up();
}, 1500);
await page.goto(`${BASE}/from/delhi/to/amritsar/`, { waitUntil: "networkidle2", timeout: 90000 });
await wait(3500);
await step("open Discover", () => tapAt("#discover-btn"), 2500);
await step("another fact", () => tapAt("[data-act=fact-next]"), 1500);
await step("open a story", () => tapAt(".story-card"), 2500);
await page.goto(`${BASE}/from/delhi/`, { waitUntil: "networkidle2", timeout: 90000 });
await wait(3500);
await step("open the list", () => tapAt("#list-btn"), 2500);
await step("surprise me", () => tapAt("#surprise-btn"), 3000);

console.log("action".padEnd(26), "input->paint ms", "long tasks ms");
for (const [label, worst, blocked] of results) console.log(label.padEnd(26), String(worst).padStart(8), String(blocked).padStart(14));
await browser.close();
