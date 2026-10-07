// Drive a long-lived headless Chrome step by step (for walking the site without a visible browser).
// Start Chrome once:  node scripts/drive.mjs start
// Then:               node scripts/drive.mjs goto / "click .pill" "type #from-input goa" "shot out.png" "eval document.title"
// Steps: goto <path> | click <selector> | clickText <text> | type <selector> <text> | key <Key> | wait <ms>
//        shot <file> | vp <w> <h> [mobile] | eval <js> | scroll <selector> <y> | text [selector] | theme day|night
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const PORT = 9333;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , ...steps] = process.argv;

if (steps[0] === "start") {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/railgaddi-drive`;
  const p = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--window-size=1366,820", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "about:blank"], { detached: true, stdio: "ignore" });
  p.unref();
  console.log("chrome started", p.pid);
  process.exit(0);
}

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
const [page] = await browser.pages();
const errors = [];
page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`console ${m.type()}: ${m.text()}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const step of steps) {
  const [cmd, ...rest] = step.split(" ");
  const arg = rest.join(" ");
  try {
    if (cmd === "goto") await page.goto(arg.startsWith("http") ? arg : `http://localhost:5173${arg}`, { waitUntil: "networkidle2", timeout: 60000 });
    else if (cmd === "click") await page.click(arg);
    else if (cmd === "clickText") {
      const ok = await page.evaluate((t) => {
        const els = [...document.querySelectorAll("button, a, [role=option], li, summary, label")].filter((e) => e.offsetParent !== null);
        const el = els.find((e) => e.textContent.trim() === t) ?? els.find((e) => e.textContent.trim().startsWith(t));
        el?.click();
        return !!el;
      }, arg);
      if (!ok) console.log("no element with text", arg);
    } else if (cmd === "type") {
      const [sel, ...t] = rest;
      await page.click(sel);
      await page.$eval(sel, (el) => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }); // start from empty
      await page.type(sel, t.join(" "), { delay: 30 });
    } else if (cmd === "key") await page.keyboard.press(arg);
    else if (cmd === "wait") await sleep(Number(arg));
    else if (cmd === "shot") await page.screenshot({ path: arg });
    else if (cmd === "vp") {
      const [w, h, m] = rest;
      await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: m ? 2 : 1, isMobile: !!m, hasTouch: !!m });
    } else if (cmd === "eval") console.log(JSON.stringify(await page.evaluate(arg), null, 1));
    else if (cmd === "scroll") await page.evaluate((s, y) => document.querySelector(s)?.scrollTo(0, Number(y)), rest[0], rest[1]);
    else if (cmd === "text") console.log(await page.evaluate((s) => (document.querySelector(s || "#panel")?.innerText ?? ""), arg));
    else if (cmd === "theme") await page.evaluate((t) => { localStorage.setItem("railgaddi.theme", t); }, arg);
    else console.log("unknown step", cmd);
  } catch (e) {
    console.log(`step "${step}" failed: ${e.message}`);
  }
}
await sleep(100);
if (errors.length) console.log(errors.join("\n"));
browser.disconnect();
