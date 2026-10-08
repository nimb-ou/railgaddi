// Smoothness on this machine's GPU: frame times while you use the map on a laptop-sized Retina
// window (the browser's own frame pacing, not a simulation).
//   node scripts/smooth.mjs [base URL]      (default: the production preview on :4173)
import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
  defaultViewport: { width: 1470, height: 956, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("railgaddi.hinted", "1");
  window.__frames = [];
  window.__long = [];
  let last = 0;
  const tick = (t) => {
    if (last) window.__frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push(e.duration);
  }).observe({ type: "longtask", buffered: true });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
async function measure(label, fn, settle = 300) {
  await page.evaluate(() => { window.__frames = []; window.__long = []; });
  const t0 = Date.now();
  await fn();
  await wait(settle);
  const { f, l } = await page.evaluate(() => ({ f: window.__frames, l: window.__long }));
  const s = [...f].sort((a, b) => a - b);
  const pct = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0);
  const janky = f.filter((x) => x > 25).length;
  rows.push([label, f.length, pct(0.5), pct(0.95), Math.round(s[s.length - 1] ?? 0), janky, Math.round(l.reduce((a, b) => a + b, 0)), Date.now() - t0]);
}
const cpu = async (label, ms = 3000) => {
  const cdp = await page.target().createCDPSession();
  await cdp.send("Performance.enable");
  const a = (await cdp.send("Performance.getMetrics")).metrics;
  await wait(ms);
  const b = (await cdp.send("Performance.getMetrics")).metrics;
  const get = (m, n) => m.find((x) => x.name === n)?.value ?? 0;
  const busy = ["TaskDuration"].map((n) => get(b, n) - get(a, n))[0];
  rows.push([`${label}: main thread busy`, "", "", "", "", "", `${Math.round((busy / (ms / 1000)) * 100)}%`, ""]);
};

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 90000 });
await wait(4000);
await cpu("landing, idle");
await measure("pick a station", async () => {
  await page.click("#from-input");
  await page.keyboard.type("bengal", { delay: 60 });
  await wait(300);
  await page.keyboard.press("Enter");
  await wait(2800);
});
await cpu("after picking, idle");
await measure("hover across the map", async () => {
  for (let i = 0; i < 60; i++) await page.mouse.move(400 + i * 8, 300 + (i % 10) * 12);
});
await measure("drag the map", async () => {
  await page.mouse.move(700, 450);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(700 + i * 6, 450 + i * 3);
  await page.mouse.up();
}, 600);
await measure("wheel zoom in and out", async () => {
  await page.mouse.move(700, 450);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel({ deltaY: -90 }); await wait(30); }
  for (let i = 0; i < 12; i++) { await page.mouse.wheel({ deltaY: 90 }); await wait(30); }
}, 600);
await page.goto(`${BASE}/from/bengaluru/to/hampi/`, { waitUntil: "load" });
await wait(4000);
await measure("scroll the place panel", async () => {
  await page.mouse.move(1200, 500);
  for (let i = 0; i < 20; i++) { await page.mouse.wheel({ deltaY: 80 }); await wait(30); }
}, 600);
await measure("open the next train", async () => { await page.click(".tk-train"); await wait(1200); });
await measure("weather layer on", async () => { await page.click("#weather-btn"); await wait(3000); }, 600);
await measure("drag with weather on", async () => {
  await page.mouse.move(800, 450);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(800 - i * 6, 450 + i * 3);
  await page.mouse.up();
}, 600);
await cpu("train open, idle");

console.log("action".padEnd(34), "frames p50 p95 max  >25ms  longtasks  ms");
for (const r of rows) console.log(String(r[0]).padEnd(34), String(r[1]).padStart(6), String(r[2]).padStart(3), String(r[3]).padStart(3), String(r[4]).padStart(4), String(r[5]).padStart(6), String(r[6]).padStart(9), String(r[7]).padStart(6));
await browser.close();
