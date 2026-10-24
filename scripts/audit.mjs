// Every view of the site at a phone, a tablet and a laptop width, by day and by night: a screenshot
// of each, the accessibility problems axe finds in it, and any console errors. For the audit
// (audit/AUDIT.md); run it before a round of work and after.
//   node scripts/audit.mjs [before|after] [base URL]   (default: after, the production preview on :4173)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const SET = process.argv[2] ?? "after";
const BASE = (process.argv[3] ?? "http://localhost:4173").replace(/\/$/, "");
const OUT = `audit/${SET}`;
mkdirSync(OUT, { recursive: true });
// axe-core: Lighthouse's copy, from the npx cache (no extra dependency for the site)
const AXE = execSync(`ls -d ${homedir()}/.npm/_npx/*/node_modules/axe-core/axe.min.js | head -1`).toString().trim();
const axeSource = readFileSync(AXE, "utf8");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// [name, address, steps]: a step is ["click", selector] | ["type", selector, text] | ["scroll", y] | ["wait", ms]
const VIEWS = [
  ["01-home", "/", []],
  ["02-search", "/", [["type", "#from-input", "beng"]]],
  ["03-from", "/from/bengaluru/", []],
  ["04-from-4h", "/from/bengaluru/", [["click", "[data-act=within][data-v='240']"]]],
  ["05-moods", "/from/bengaluru/", [["click", "[data-act=moods]"], ["click", "[data-act=mood][data-mood=hills]"]]],
  ["06-place", "/from/bengaluru/to/hampi/", []],
  ["07-place-when", "/from/bengaluru/to/hampi/", [["click", "[data-act=tab][data-tab=when]"]]],
  ["08-place-trains", "/from/bengaluru/to/hampi/", [["click", "[data-act=tab][data-tab=trains]"]]],
  ["09-train", "/from/bengaluru/to/hampi/", [["click", ".tk-train"]]],
  ["10-journey", "/from/bengaluru/to/amritsar/", []],
  ["11-to", "/to/varanasi/", []],
  ["12-spot", "/to/munnar/", []],
  ["13-weather", "/from/bengaluru/", [["click", "#weather-btn"], ["wait", 2500]]],
  ["14-trip", "/trip/", [["type", "#trip-input", "bengaluru\n"], ["type", "#trip-input", "mysuru\n"], ["type", "#trip-input", "ooty\n"], ["wait", 1500]]],
  ["15-discover", "/discover/", []],
  ["16-story", "/discover/", [["click", ".story-card"]]],
  ["17-saved", "/", [["click", "#saved-btn"]]],
  ["18-about", "/", [["click", "#info-btn"]]],
  ["19-missing", "/to/nowhere-at-all/", []],
  ["20-404", "/404.html", []],
];
const WIDTHS = [
  ["375", { width: 375, height: 812, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ["768", { width: 768, height: 1024, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ["1440", { width: 1440, height: 900, deviceScaleFactor: 1 }],
];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const report = { set: SET, base: BASE, when: new Date().toISOString(), views: {}, errors: [] };

async function run(wName, viewport, theme) {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    defaultViewport: viewport,
  });
  for (const [name, path, steps] of VIEWS) {
    if (ONLY && !ONLY.test(name)) continue;
    const key = `${name}-${wName}-${theme}`;
    const page = await browser.newPage();
    const errs = [];
    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem("railgaddi.theme", t);
      localStorage.setItem("railgaddi.hinted", "1");
    }, theme);
    page.on("pageerror", (e) => errs.push(`page error: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text()}`));
    try {
      await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 90000 });
      await wait(3500);
      for (const [kind, a, b] of steps) {
        if (kind === "click") {
          const el = await page.$(a);
          if (!el) errs.push(`nothing to click at ${a}`);
          else await el.click();
          await wait(1500);
        } else if (kind === "type") {
          await page.click(a);
          for (const part of b.split(/(\n)/)) part === "\n" ? await page.keyboard.press("Enter") : await page.keyboard.type(part, { delay: 30 });
          await wait(1200);
        } else if (kind === "scroll") {
          await page.evaluate((y) => document.querySelector(".panel-scroll")?.scrollTo(0, y), a);
          await wait(600);
        } else await wait(a);
      }
      await wait(800);
      await page.screenshot({ path: `${OUT}/${key}.webp`, type: "webp", quality: 62 });
      // axe: WCAG 2.1 A and AA, plus best practice
      await page.evaluate(axeSource);
      const res = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
      });
      report.views[key] = { axe: res, errors: errs };
    } catch (e) {
      report.views[key] = { axe: [], errors: [...errs, `stopped: ${e.message}`] };
    }
    console.log(key, (report.views[key].axe ?? []).reduce((a, v) => a + v.nodes, 0), "axe nodes", errs.length ? `${errs.length} errors` : "");
    await page.close();
  }
  await browser.close();
}

const themes = (process.env.THEMES ?? "day,night").split(",");
await Promise.all(WIDTHS.map(async ([w, vp]) => {
  for (const t of themes) await run(w, vp, t);
}));

// totals
const rules = {};
let nodes = 0;
for (const v of Object.values(report.views))
  for (const r of v.axe) {
    rules[r.id] ??= { impact: r.impact, help: r.help, views: 0, nodes: 0, examples: [] };
    rules[r.id].views++;
    rules[r.id].nodes += r.nodes;
    nodes += r.nodes;
    if (rules[r.id].examples.length < 6) rules[r.id].examples.push(...r.targets.slice(0, 2));
  }
report.axeTotals = { rules, nodes, distinctRules: Object.keys(rules).length };
report.consoleErrors = Object.entries(report.views).flatMap(([k, v]) => v.errors.map((e) => `${k}: ${e}`));
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(`axe: ${Object.keys(rules).length} rules broken, ${nodes} nodes in all`);
for (const [id, r] of Object.entries(rules)) console.log(`  ${id} (${r.impact}): ${r.nodes} nodes in ${r.views} views`);
console.log(report.consoleErrors.length ? `console errors:\n  ${report.consoleErrors.join("\n  ")}` : "no console errors");
