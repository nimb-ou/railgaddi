// Walk through the site like a visitor, on a desktop and a phone, and save a screenshot of each
// step plus any console errors or failed requests. For design and QA review.
//   node scripts/qa.mjs [base URL] [out dir]          (default: the dev server, ./qa-shots)
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const OUT = process.argv[3] ?? "qa-shots";
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

async function session(name, viewport, theme, steps) {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    defaultViewport: viewport,
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem("railgaddi.theme", t);
    localStorage.setItem("railgaddi.hinted", "1");
  }, theme);
  page.on("pageerror", (e) => problems.push(`${name}: page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${name}: console: ${m.text()}`));
  page.on("requestfailed", (r) => !/googleapis|google\.com|gsi/.test(r.url()) && problems.push(`${name}: failed ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && !r.url().includes("/api/") && problems.push(`${name}: HTTP ${r.status()} ${r.url()}`));
  let n = 0;
  const shot = async (label) => {
    await wait(700);
    await page.screenshot({ path: `${OUT}/${name}-${String(++n).padStart(2, "0")}-${label}.png` });
  };
  const ctx = {
    page,
    shot,
    wait,
    go: async (path, ms = 4500) => {
      await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
      await wait(ms);
    },
    click: async (sel, ms = 1200) => {
      const el = await page.$(sel);
      if (!el) return problems.push(`${name}: nothing to click at ${sel}`);
      await el.click();
      await wait(ms);
    },
    type: async (sel, text, ms = 900) => {
      await page.click(sel);
      await page.keyboard.type(text, { delay: 40 });
      await wait(ms);
    },
    scroll: async (y) => {
      await page.evaluate((y) => document.querySelector(".panel-scroll")?.scrollTo(0, y), y);
      await wait(500);
    },
  };
  try {
    await steps(ctx);
  } catch (e) {
    problems.push(`${name}: stopped: ${e.message}`);
  }
  await browser.close();
}

const desktop = { width: 1440, height: 900, deviceScaleFactor: 1 };
const phone = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

for (const [name, vp, theme] of [["desk", desktop, "day"], ["phone", phone, "night"]]) {
  await session(name, vp, theme, async ({ go, click, type, shot, scroll, page }) => {
    await go("/");
    await shot("landing");
    await type("#origin-input", "hamp");
    await shot("search");
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 3500));
    await shot("origin");
    await go("/from/bengaluru/to/hampi/");
    await shot("place");
    await scroll(900);
    await shot("place-scrolled");
    await click(".ticket-next");
    await shot("train");
    await click(".line .more button");
    await shot("train-earlier");
    await go("/from/bengaluru/to/amritsar/");
    await shot("no-direct");
    await click(".conn");
    await shot("journey");
    await click(".leg-head button");
    await shot("journey-train");
    await click("[data-act=back]");
    await shot("journey-back");
    await go("/to/varanasi/");
    await shot("to-mode");
    await go("/from/delhi/");
    await click("#list-btn");
    await shot("list");
    await go("/discover/");
    await shot("discover");
    await click("[data-act=fact-next]");
    await click("[data-cat=Stations]");
    await shot("discover-facts");
    await scroll(700);
    await shot("discover-scrolled");
    await click(".story-card");
    await shot("story");
    await scroll(2000);
    await shot("story-end");
    await click(".ride-ticket", 3500);
    await shot("story-ride");
    await go("/from/mumbai/to/goa/");
    await click("[data-act=save-place]");
    await click("[data-act=save-route]");
    await click("#saved-btn");
    await shot("saved");
    await go("/to/nowhere-at-all/");
    await shot("missing");
  });
}

console.log(problems.length ? `problems:\n  ${[...new Set(problems)].join("\n  ")}` : "no console errors or failed requests");
console.log(`screenshots in ${OUT}/`);
