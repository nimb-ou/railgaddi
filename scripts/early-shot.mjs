// What a phone on slow 4G sees a few seconds into a shared link, and once it's all in.
//   node scripts/early-shot.mjs <url> <out-prefix> [early ms]
import puppeteer from "puppeteer-core";
const [, , url, out, early = "3000"] = process.argv;
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", defaultViewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const p = await b.newPage();
const c = await p.target().createCDPSession();
await c.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const t0 = Date.now();
p.goto(url, { timeout: 120000 }).catch(() => {});
await new Promise((r) => setTimeout(r, Number(early)));
await p.screenshot({ path: `${out}-early.png` });
await p.waitForNetworkIdle({ idleTime: 1500, timeout: 90000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));
await p.screenshot({ path: `${out}-late.png` });
const lcp = await p.evaluate(() => new Promise((r) => new PerformanceObserver((l) => { const e = l.getEntries().at(-1); r({ t: Math.round(e.startTime), el: e.element?.outerHTML.slice(0, 90) }); }).observe({ type: "largest-contentful-paint", buffered: true })));
console.log(JSON.stringify({ lcp, total: Date.now() - t0, errs }));
await b.close();
