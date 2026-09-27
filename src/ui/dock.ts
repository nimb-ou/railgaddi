// The dock: how far you'll ride ("reach within"), when you'll leave, and a switch to see the
// same places as a list.
import type { Filters, Leave } from "../core/trips";

// "Reach within" slider stops, in minutes
export const STEPS = [60, 120, 180, 240, 360, 480, 720, 1080, 1440, Infinity];
const TICKS: [number, string][] = [[0, "1h"], [2, "3h"], [4, "6h"], [6, "12h"], [8, "24h"], [9, "Any"]];

export class Dock {
  private range: HTMLInputElement;
  private out: HTMLOutputElement;
  private leave: HTMLElement;

  constructor(
    private root: HTMLElement,
    private onChange: (f: Filters, settled: boolean) => void,
    private onList: () => void,
    private color: (mins: number) => string,
  ) {
    this.range = root.querySelector<HTMLInputElement>("#within")!;
    this.out = root.querySelector<HTMLOutputElement>("#within-out")!;
    this.leave = root.querySelector<HTMLElement>("#leave")!;
    const ticks = root.querySelector<HTMLElement>(".ticks")!;
    ticks.innerHTML = TICKS.map(([i, label]) => `<span style="--at:${i / 9}">${label}</span>`).join("");
    this.range.addEventListener("input", () => {
      this.paint();
      this.onChange(this.value(), false);
    });
    this.range.addEventListener("change", () => this.onChange(this.value(), true));
    this.leave.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      this.setLeave(b.dataset.v as Leave);
      this.onChange(this.value(), true);
    });
    root.querySelector("#list-btn")!.addEventListener("click", () => this.onList());
  }

  value(): Filters {
    const pressed = this.leave.querySelector<HTMLElement>('[aria-pressed="true"]');
    return { within: STEPS[Number(this.range.value)], leave: (pressed?.dataset.v as Leave) ?? "any" };
  }

  set(f: Filters) {
    const i = STEPS.findIndex((s) => s >= f.within);
    this.range.value = String(i < 0 ? STEPS.length - 1 : i);
    this.setLeave(f.leave);
    this.paint();
  }

  setListOpen(open: boolean) {
    this.root.querySelector("#list-btn")!.setAttribute("aria-pressed", String(open));
  }

  private setLeave(v: Leave) {
    for (const x of this.leave.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x.dataset.v === v));
  }

  /** The track shows the map's own distance colours, filled up to the chosen stop. */
  paint() {
    const v = STEPS[Number(this.range.value)];
    this.out.textContent = v === Infinity ? "any time" : v === 60 ? "1 hour" : `${v / 60} hours`;
    const stops = STEPS.map((m, i) => `${this.color(m === Infinity ? 1800 : m)} ${(i / 9) * 100}%`).join(", ");
    const pct = (Number(this.range.value) / 9) * 100;
    this.range.style.setProperty("--track", `linear-gradient(90deg, transparent ${pct}%, var(--rule) ${pct}%), linear-gradient(90deg, ${stops})`);
  }
}
