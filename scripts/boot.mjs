// How long a first visit takes on a phone: cold cache, a throttled network and a CPU four times
// slower. Prints when the page first paints, when the map and panel are ready, and what loaded.
//   node scripts/boot.mjs [path] [--fast]   (needs the production preview on :4173)
// --fast: "Fast 4G" (9 Mbps, 60 ms) instead of "Slow 4G" (1.6 Mbps, 150 ms).
import puppeteer from "puppeteer-core";

const fast = process.argv.includes("--fast");
const path = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "/";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
const cdp = await page.target().createCDPSession();
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Network.emulateNetworkConditions", fast
  ? { offline: false, latency: 60, downloadThroughput: (9000 * 1024) / 8, uploadThroughput: (1500 * 1024) / 8 }
  : { offline: false, latency: 150, downloadThroughput: (1600 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const bytes = new Map();
cdp.on("Network.loadingFinished", (e) => bytes.set(e.requestId, e.encodedDataLength));
const urls = new Map();
cdp.on("Network.responseReceived", (e) => urls.set(e.requestId, e.response.url));
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("railgaddi.hinted", "1");
  window.__t = {};
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t[e.name] = Math.round(e.startTime); }).observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__t.lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
  const t0 = performance.now();
  const poll = () => {
    const l = document.getElementById("loading");
    if (l && l.classList.contains("done")) window.__t.ready = Math.round(performance.now() - t0);
    else requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
});
await page.goto(`http://localhost:4173${path}`, { waitUntil: "load", timeout: 120000 });
await page.waitForFunction(() => window.__t.ready, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
const t = await page.evaluate(() => window.__t);
console.log(`${fast ? "Fast" : "Slow"} 4G, CPU x4, ${path}: first paint ${t["first-contentful-paint"]} ms, LCP ${t.lcp} ms, app ready ${t.ready} ms`);
const rows = [...bytes].map(([id, b]) => [urls.get(id) ?? "", b]).filter(([u]) => u).sort((a, b) => b[1] - a[1]);
console.log(`transferred by then: ${Math.round(rows.reduce((a, r) => a + r[1], 0) / 1024)} kB`);
for (const [u, b] of rows.slice(0, 12)) console.log(`  ${String(Math.round(b / 1024)).padStart(5)} kB  ${u.replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`);
await browser.close();
