// The station board as a search box: type a city, station, code or famous place.
// An ARIA combobox: arrow keys move, Enter picks, Escape closes.
import type { Network, Place } from "../core/network";
import type { GuideView } from "../core/places";
import { searchPlaces } from "../core/search";
import { esc } from "./panel";
import { photoUrl } from "./photos";

const POPULAR = ["bengaluru", "mumbai", "delhi", "kolkata", "chennai", "hyderabad"];

export class SearchBox {
  private results: Place[] = [];
  private active = -1;

  constructor(
    private input: HTMLInputElement,
    private list: HTMLUListElement,
    private popular: HTMLElement,
    private net: Network,
    private guides: () => Map<Place, GuideView>,
    private onPick: (p: Place) => void,
  ) {
    input.addEventListener("input", () => {
      this.results = searchPlaces(net, guides(), input.value, 6);
      this.active = this.results.length ? 0 : -1;
      this.render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!this.results.length) return;
        this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.results.length) % this.results.length;
        this.render();
      } else if (e.key === "Enter") {
        const p = this.results[Math.max(this.active, 0)];
        if (p) this.pick(p);
      } else if (e.key === "Escape") {
        this.close();
      }
    });
    input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
    list.addEventListener("mousedown", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-i]");
      if (!li) return;
      e.preventDefault();
      this.pick(this.results[Number(li.dataset.i)]);
    });
    popular.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the browser
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      const p = b && net.places.get(b.dataset.id!);
      if (p) {
        e.preventDefault();
        this.pick(p);
      }
    });
    this.renderPopular();
  }

  private face(p: Place) {
    const ph = this.guides().get(p)?.icon;
    return ph
      ? `<img class="s-img" src="${esc(photoUrl(ph, 120))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<i class="s-img"></i>`;
  }

  /** Re-draw the popular picks (call again once guide photos are known). */
  renderPopular(hrefOf?: (p: Place) => string) {
    this.popular.innerHTML =
      `<span>Popular</span>` +
      POPULAR.map((id) => this.net.places.get(id))
        .filter((p): p is Place => !!p)
        .map((p) => `<a class="pill" href="${hrefOf ? esc(hrefOf(p)) : "#"}" data-id="${p.id}">${this.face(p).replace('class="s-img"', "")}${esc(p.name)}</a>`)
        .join("");
  }

  private pick(p: Place) {
    this.input.value = "";
    this.results = [];
    this.close();
    this.input.blur();
    this.onPick(p);
  }

  private render() {
    const q = this.input.value.trim();
    if (!this.results.length) {
      this.list.innerHTML = q ? `<li class="none" aria-disabled="true">No station or city by that name in this timetable</li>` : "";
      this.list.hidden = !q;
    } else {
      this.list.innerHTML = this.results
        .map((p, i) => {
          const codes = p.stations.map((s) => this.net.stations[s].code);
          const meta = p.isCity ? `${p.state} · ${codes.length} stations` : `${p.state ? p.state + " · " : ""}${codes[0]}`;
          const gv = this.guides().get(p);
          const also = gv?.featured ? ` · for ${gv.title}` : "";
          return `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === this.active}">
            ${this.face(p)}<span class="s-name">${esc(p.name)}</span><span class="s-script">${esc(p.hi || p.local)}</span>
            <span class="s-meta">${esc(meta + also)}</span></li>`;
        })
        .join("");
      this.list.hidden = false;
    }
    this.input.setAttribute("aria-expanded", String(!this.list.hidden));
    if (this.active >= 0) this.input.setAttribute("aria-activedescendant", `opt-${this.active}`);
    else this.input.removeAttribute("aria-activedescendant");
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
  }

  focus() {
    this.input.focus({ preventScroll: true });
  }
}
