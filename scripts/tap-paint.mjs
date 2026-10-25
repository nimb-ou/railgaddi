// From a tap to the frame that shows its result, without Event Timing: tap, then wait for two
// animation frames in the page. At 4x CPU on a phone viewport.
//   node scripts/tap-paint.mjs <url> <setup selectors, comma-separated or -> <measured selector>
import puppeteer from "puppeteer-core";
const [, , url, setup, sel] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", defaultViewport: { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const p = await b.newPage(); const c = await p.target().createCDPSession(); await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await p.goto(url, { waitUntil: "networkidle2", timeout: 90000 }); await new Promise((r) => setTimeout(r, 4000));
const go = async (s) => { const el = await p.$(s); await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await new Promise((r) => setTimeout(r, 1500)); return el; };
for (const s of setup === "-" ? [] : setup.split(",")) { await (await go(s)).tap(); await new Promise((r) => setTimeout(r, 3000)); }
const ms = [];
for (let i = 0; i < 3; i++) {
  const el = await go(sel); // found again each time: a redraw replaces it
  const t = await p.evaluate(() => performance.now());
  await el.tap();
  const end = await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))));
  ms.push(Math.round(end - t));
  if (sel.includes("story")) break; // a story replaces the list: one measurement
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(sel, JSON.stringify(ms));
await b.close();
