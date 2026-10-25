// Measurements for the UX and accessibility audit: tap targets under 44 px on a phone, sideways
// overflow at 320 px, the heading outline of each view, and a keyboard walk from the landing page.
//   node scripts/ux-check.mjs [base URL]   (default: the dev server)
import puppeteer from "puppeteer-core";
const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/$/, "");
const VIEWS = [["home", "/"], ["from", "/from/bengaluru/"], ["place", "/from/bengaluru/to/hampi/"], ["train", "/from/bengaluru/to/hampi/", ".tk-train"], ["spot", "/to/munnar/"], ["trip", "/trip/?stops=bengaluru,mysuru,ooty"], ["discover", "/discover/"], ["story", "/discover/konkan-railway/"], ["journey", "/from/bengaluru/to/amritsar/"]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const out = { small: {}, overflow: {}, headings: {}, keyboard: [] };
for (const [name, path, click] of VIEWS) {
  for (const vp of [{ width: 375, height: 812, isMobile: true, hasTouch: true }, { width: 320, height: 640, isMobile: true, hasTouch: true }]) {
    const p = await b.newPage();
    await p.setViewport(vp);
    await p.evaluateOnNewDocument(() => localStorage.setItem("railgaddi.hinted", "1"));
    await p.goto(BASE + path, { waitUntil: "networkidle2", timeout: 90000 });
    await wait(3000);
    if (click) { await p.click(click).catch(() => {}); await wait(1500); }
    if (vp.width === 375) {
      out.small[name] = await p.evaluate(() => {
        const r = [];
        for (const el of document.querySelectorAll("button, a[href], input, select, summary, [role=tab]")) {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight * 3) continue;
          const cs = getComputedStyle(el); if (cs.visibility === "hidden" || el.closest("[hidden]")) continue;
          if (b.width < 44 || b.height < 44) r.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} "${(el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().slice(0, 28)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
        return r;
      });
      out.headings[name] = await p.evaluate(() => [...document.querySelectorAll("h1,h2,h3,h4")].filter((h) => h.offsetParent || h.classList.contains("vh")).map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 40)}`));
    } else {
      out.overflow[name] = await p.evaluate(() => {
        const w = innerWidth; const bad = [];
        for (const el of document.querySelectorAll("#side *")) { const r = el.getBoundingClientRect(); if (r.right > w + 1 && r.width) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} right=${Math.round(r.right)}`); }
        return { scrollW: document.scrollingElement.scrollWidth, w, bad: [...new Set(bad)].slice(0, 8) };
      });
    }
    await p.close();
  }
}
// keyboard walk on the landing page, laptop size
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto(BASE + "/", { waitUntil: "networkidle2" });
await wait(3000);
for (let i = 0; i < 30; i++) {
  await p.keyboard.press("Tab");
  out.keyboard.push(await p.evaluate(() => {
    const el = document.activeElement; const cs = getComputedStyle(el);
    const vis = cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" || cs.boxShadow !== "none";
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().slice(0, 30)}" ring=${vis}`;
  }));
}
await b.close();
console.log(JSON.stringify(out, null, 1));
