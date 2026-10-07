// A CPU profile of one action at 4x slowdown, summarised by function (self time).
//   node scripts/profile.mjs [pick|tap|close|type|weather|discover] [ms]   (ms: only the first ms after the action;
//   needs the production preview on :4173)
import puppeteer from "puppeteer-core";
const what = process.argv[2] ?? "pick";
const within = Number(process.argv[3] ?? Infinity) * 1000; // only the first N ms after the action (µs)
const BASE = "http://localhost:4173";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
const cdp = await page.target().createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.evaluateOnNewDocument(() => localStorage.setItem("railgaddi.hinted", "1"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = what === "close" ? `${BASE}/from/bengaluru/to/hampi/` : what === "tap" || what === "weather" || what === "discover" ? `${BASE}/from/bengaluru/` : `${BASE}/`;
await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
await wait(4000);
if (what === "pick") {
  await page.tap("#from-input");
  await page.keyboard.type("bengal");
  await wait(1500);
}
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
if (what === "pick") await page.keyboard.press("Enter");
if (what === "tap") await page.mouse.click(206, 330);
if (what === "close") await page.tap("[data-act=close]");
if (what === "weather") await page.tap("#weather-btn");
if (what === "discover") await page.tap("#discover-btn");
if (what === "type") { await page.tap("#from-input"); await page.keyboard.type("amrit", { delay: 100 }); }
await wait(3500);
const { profile } = await cdp.send("Profiler.stop");
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const counts = new Map();
let at = 0;
profile.samples.forEach((id, i) => {
  at += dt[i] ?? 0;
  if (at - (dt[0] ?? 0) <= within) counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0));
});
// inclusive time too: which of our functions (and what they call) take it
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
for (const [id, us] of counts) {
  const seen = new Set();
  for (let x = id; x !== undefined; x = parent.get(x)) {
    const f = byId.get(x).callFrame;
    const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    incl.set(key, (incl.get(key) ?? 0) + us);
  }
}
for (const [id, us] of counts) {
  const n = byId.get(id);
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`;
  self.set(key, (self.get(key) ?? 0) + us);
}
const top = [...self].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, us] of top) console.log(String(Math.round(us / 1000)).padStart(6), "ms", k);
console.log("--- inclusive");
const topi = [...incl].filter(([k]) => k.includes(".js")).sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, us] of topi) console.log(String(Math.round(us / 1000)).padStart(6), "ms", k);
await browser.close();
