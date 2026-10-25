// One tap's Event Timing breakdown at 4x slowdown: input delay, processing, and presentation delay.
//   node scripts/inp-one.mjs <url> <selector>[,<selector>...]   (the last one is measured)
import puppeteer from "puppeteer-core";
const [, , url, sels] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", defaultViewport: { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const p = await b.newPage(); const c = await p.target().createCDPSession(); await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("railgaddi.hinted", "1"); window.__ev = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ n: e.name, d: Math.round(e.duration), delay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart), pres: Math.round(e.startTime + e.duration - e.processingEnd) }); }).observe({ type: "event", durationThreshold: 16, buffered: true }); });
await p.goto(url, { waitUntil: "networkidle2", timeout: 90000 }); await new Promise((r) => setTimeout(r, 4000));
const list = sels.split(",");
for (const [i, s] of list.entries()) {
  const el = await p.$(s);
  // PRESCROLL=1: bring it into view first and let that settle, as a person scrolls before tapping
  if (process.env.PRESCROLL) { await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await new Promise((r) => setTimeout(r, 2500)); }
  if (i === list.length - 1) await p.evaluate(() => (window.__ev = []));
  await el.tap();
  await new Promise((r) => setTimeout(r, 4000));
}
console.log(JSON.stringify(await p.evaluate(() => window.__ev)));
await b.close();
