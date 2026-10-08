// When to go: the twelve months in a strip, coloured by the usual weather, with the one you tap
// (this month, at first) spelled out.
import { KIND_WORDS, MONTH_NAMES, whenLine, type MonthKind } from "../core/climate";
import { esc } from "./esc";

const INITIAL = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/**
 * `w`: a letter a month; `c`: low, high and rain for each month (when the details are loaded);
 * `src`: "imd" for a guide's climate chart, "est" for an estimate; `month`: the one spelled out.
 */
export function whenHtml(w: string, c: number[] | null, src: string, month: number, now: number, where: string, elev?: number) {
  if (w.length !== 12) return "";
  const k = w[month] as MonthKind;
  const at = (m: number) => (c ? { lo: c[m * 3], hi: c[m * 3 + 1], mm: c[m * 3 + 2] } : null);
  const d = at(month);
  const detail = d
    ? `<b>${MONTH_NAMES[month]}: ${esc(KIND_WORDS[k].toLowerCase())}.</b> Days around ${d.hi}°, nights ${d.lo}°, ${d.mm < 5 ? "hardly any rain" : `about ${d.mm} mm of rain`}.`
    : `<b>${MONTH_NAMES[month]}: ${esc(KIND_WORDS[k].toLowerCase())}.</b>`;
  const source = src === "imd"
    ? "Long-term averages from the IMD's station tables, via Wikivoyage."
    : `Estimated from NASA POWER's 20-year averages${elev !== undefined && elev >= 600 ? `, adjusted for ${esc(where)}'s height (${elev.toLocaleString("en-IN")} m)` : ""}.`;
  return `<section class="when" aria-labelledby="when-h">
    <div class="section-head"><h3 id="when-h">When to go</h3><span class="count">the usual weather</span></div>
    <p class="when-line">${esc(whenLine(w))}</p>
    <ol class="months" aria-label="Month by month">${[...w]
      .map((x, m) => {
        const t = at(m);
        const label = `${MONTH_NAMES[m]}: ${KIND_WORDS[x as MonthKind].toLowerCase()}${t ? `, ${t.hi}° by day` : ""}`;
        return `<li><button type="button" class="mo k-${x}${m === now ? " now" : ""}" data-act="month" data-m="${m}" aria-pressed="${m === month}" aria-label="${esc(label)}" title="${esc(label)}">
          <span class="mo-i">${INITIAL[m]}</span><i aria-hidden="true"></i>${t ? `<span class="mo-t">${t.hi}°</span>` : ""}</button></li>`;
      })
      .join("")}</ol>
    <p class="when-key" aria-hidden="true">${(["B", "G", "R", "W", "M", "H", "C"] as MonthKind[]).filter((x) => w.includes(x)).map((x) => `<span class="k-${x}"><i></i>${KIND_WORDS[x]}</span>`).join("")}</p>
    <p class="when-detail" aria-live="polite">${detail}</p>
    <p class="wx-src">${source}</p>
  </section>`;
}
