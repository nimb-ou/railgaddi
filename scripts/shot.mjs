// Screenshot the dev server with the installed Chrome (for design review without a visible browser).
// node scripts/shot.mjs "<path+query+hash>" out.png [width] [height] [waitMs] [theme]
import puppeteer from "puppeteer-core";

const [, , path = "", out = "shot.png", w = "1366", h = "820", wait = "9000", theme] = process.argv;
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  defaultViewport: { width: Number(w), height: Number(h), deviceScaleFactor: 1, isMobile: Number(w) < 720, hasTouch: Number(w) < 720 },
});
const page = await browser.newPage();
if (theme) await page.evaluateOnNewDocument((t) => localStorage.setItem("railgaddi.theme", t), theme);
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(path.startsWith("http") ? path : `http://localhost:5173/${path}`, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, Number(wait)));
await page.screenshot({ path: out });
await browser.close();
console.log("saved", out);
