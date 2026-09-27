// The station board as a search box: type a city, station, code or famous place.
// An ARIA combobox: arrow keys move, Enter picks, Escape closes. The same widget serves every
// "where" field (from, to, the ticket, the place panel); `context` lets a field rank what makes
// sense there first, e.g. places with a direct train to where you're going.
import type { Network, Place } from "../core/network";
import type { GuideView } from "../core/places";
import { searchPlaces } from "../core/search";
import { esc } from "./panel";
import { photoUrl } from "./photos";

/** Extra ranking for one field: a note to show ("8h 40m to Hampi") and a boost, or null. */
export type SearchContext = (p: Place) => { note: string; boost: number } | null;

export interface SearchOptions {
  popular?: HTMLElement;
  popularIds?: string[];
  context?: SearchContext;
  /** Rows to show before anything is typed (e.g. the fastest direct trains). */
  suggestions?: () => Place[];
  empty?: string;
}

let uid = 0;

export class SearchBox {
  private results: Place[] = [];
  private active = -1;
  private id = `s${++uid}`;

  constructor(
    private input: HTMLInputElement,
    private list: HTMLUListElement,
    private net: Network,
    private guides: () => Map<Place, GuideView>,
    private onPick: (p: Place) => void,
    private opts: SearchOptions = {},
  ) {
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    if (!list.id) list.id = `${this.id}-list`;
    input.setAttribute("aria-controls", list.id);
    list.setAttribute("role", "listbox");
    input.addEventListener("input", () => this.update());
    input.addEventListener("focus", () => {
      if (!input.value.trim() && opts.suggestions) this.update();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!this.results.length) return;
        this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.results.length) % this.results.length;
        this.render();
      } else if (e.key === "Enter") {
        const p = this.results[Math.max(this.active, 0)];
        if (p) {
          e.preventDefault();
          this.pick(p);
        }
      } else if (e.key === "Escape") {
        if (!this.list.hidden) {
          e.stopPropagation();
          this.close();
        }
      }
    });
    input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
    list.addEventListener("mousedown", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-i]");
      if (!li) return;
      e.preventDefault();
      this.pick(this.results[Number(li.dataset.i)]);
    });
    opts.popular?.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the browser
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      const p = b && net.places.get(b.dataset.id!);
      if (p) {
        e.preventDefault();
        this.pick(p);
      }
    });
  }

  private update() {
    const q = this.input.value;
    const ctx = this.opts.context;
    if (!q.trim()) {
      this.results = this.opts.suggestions?.() ?? [];
    } else {
      const found = searchPlaces(this.net, this.guides(), q, ctx ? 40 : 6);
      // the order searchPlaces gives, nudged by what makes sense for this field
      this.results = ctx
        ? found
            .map((p, i) => ({ p, s: (ctx(p)?.boost ?? 0) * 0.3 - i * 0.3 })) // a direct train lifts a match about ten places
            .sort((a, b) => b.s - a.s)
            .slice(0, 6)
            .map((r) => r.p)
        : found;
    }
    this.active = this.results.length && q.trim() ? 0 : -1;
    this.render();
  }

  private face(p: Place) {
    const ph = this.guides().get(p)?.icon;
    return ph
      ? `<img class="s-img" src="${esc(photoUrl(ph, 120))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<i class="s-img"></i>`;
  }

  /** Re-draw the popular picks. `lead` goes first (the station you used last time). */
  renderPopular(hrefOf: (p: Place) => string, lead?: { place: Place; label: string } | null) {
    const el = this.opts.popular;
    if (!el) return;
    const picks = (this.opts.popularIds ?? []).map((id) => this.net.places.get(id)).filter((p): p is Place => !!p && p !== lead?.place);
    el.innerHTML =
      (lead
        ? `<a class="pill last" href="${esc(hrefOf(lead.place))}" data-id="${lead.place.id}" title="${esc(lead.label)}">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 3v2.5h2.5"/></svg>${esc(lead.place.name)}</a>`
        : "") +
      picks.map((p) => `<a class="pill" href="${esc(hrefOf(p))}" data-id="${p.id}">${this.face(p).replace('class="s-img"', "")}${esc(p.name)}</a>`).join("");
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
      this.list.innerHTML = q ? `<li class="none" aria-disabled="true">${esc(this.opts.empty ?? "No station or city by that name in this timetable")}</li>` : "";
      this.list.hidden = !q;
    } else {
      this.list.innerHTML = this.results
        .map((p, i) => {
          const codes = p.stations.map((s) => this.net.stations[s].code);
          const note = this.opts.context?.(p)?.note;
          const meta = note ?? (p.isCity ? `${p.state} · ${codes.length} stations` : `${p.state ? p.state + " · " : ""}${codes[0]}`);
          const gv = this.guides().get(p);
          const also = gv?.featured ? ` · for ${gv.title}` : "";
          return `<li role="option" id="${this.id}-${i}" data-i="${i}" aria-selected="${i === this.active}" class="${note ? "direct" : ""}">
            ${this.face(p)}<span class="s-name">${esc(p.name)}</span><span class="s-script">${esc(p.hi || p.local)}</span>
            <span class="s-meta">${esc(meta + also)}</span></li>`;
        })
        .join("");
      this.list.hidden = false;
    }
    this.input.setAttribute("aria-expanded", String(!this.list.hidden));
    if (this.active >= 0) this.input.setAttribute("aria-activedescendant", `${this.id}-${this.active}`);
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
