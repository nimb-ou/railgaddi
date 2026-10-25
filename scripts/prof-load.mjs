// CPU profile of a page load (and optional clicks) at 4x CPU slowdown: top self-time functions, and long tasks.
import puppeteer from "puppeteer-core";
const [, , url, clicks = ""] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", defaultViewport: { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const p = await b.newPage();
const c = await p.target().createCDPSession();
await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await c.send("Profiler.enable");
await c.send("Profiler.setSamplingInterval", { interval: 200 });
await p.evaluateOnNewDocument(() => { localStorage.setItem("railgaddi.hinted", "1"); window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); });
if (!clicks) await c.send("Profiler.start");
await p.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 3000));
if (clicks) {
  await p.evaluate(() => (window.__long = []));
  await c.send("Profiler.start");
  for (const s of clicks.split(",")) { await p.click(s); await new Promise((r) => setTimeout(r, 2500)); }
}
const { profile } = await c.send("Profiler.stop");
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; let i = 0;
for (const s of profile.samples) { const n = byId.get(s); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i++] ?? 0) / 1000); }
console.log("long tasks:", JSON.stringify(await p.evaluate(() => window.__long)));
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${Math.round(v)}ms ${k}`).join("\n"));
await b.close();
