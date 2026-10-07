// The station board as a search box: type a city, station, code or famous place.
// An ARIA combobox: arrow keys move, Enter picks, Escape closes. The same widget serves every
// "where" field (from, to, the ticket, the place panel); `context` lets a field rank what makes
// sense there first, e.g. places with a direct train to where you're going.
import { daysLabel } from "../core/format";
import type { Network, Place, Train } from "../core/network";
import type { GuideView } from "../core/places";
import { searchPlaceHits, searchTrains, type PlaceHit } from "../core/search";
import { km, searchOnline, type Spot, type Spots } from "../core/spots";
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
  /** Also find trains by number or name, and open one when picked. */
  onTrain?: (t: Train) => void;
  /** Also find places without a station (and, failing that, look the name up online). */
  spots?: () => Spots | null;
  onSpot?: (s: Spot) => void;
  online?: boolean;
}

type Item = { p: Place; t?: undefined; s?: undefined; via?: string } | { t: Train; p?: undefined; s?: undefined } | { s: Spot; p?: undefined; t?: undefined };
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const fold = (x: string) => x.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const PIN = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 15s-5-4.6-5-8.3a5 5 0 0 1 10 0C13 10.4 8 15 8 15z"/><circle cx="8" cy="6.7" r="1.8" fill="#fff"/></svg>`;

let uid = 0;

export class SearchBox {
  private results: Item[] = [];
  private active = -1;
  private id = `s${++uid}`;
  private asked = ""; // the last name looked up online
  private lookup = 0;

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
        const it = this.results[Math.max(this.active, 0)];
        if (it) {
          e.preventDefault();
          this.pick(it);
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
      const it = this.results[Number(li.dataset.i)];
      if (it) this.pick(it);
    });
    opts.popular?.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the browser
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      const p = b && net.places.get(b.dataset.id!);
      if (p) {
        e.preventDefault();
        this.pick({ p });
      }
    });
  }

  private update() {
    const q = this.input.value;
    const ctx = this.opts.context;
    if (!q.trim()) {
      this.results = (this.opts.suggestions?.() ?? []).map((p) => ({ p }));
    } else {
      const found = searchPlaceHits(this.net, this.guides(), q, ctx ? 40 : 6);
      // the order the search gives, nudged by what makes sense for this field
      const places: PlaceHit[] = ctx
        ? found
            .map((h, i) => ({ h, s: (ctx(h.p)?.boost ?? 0) * 0.3 - i * 0.3 })) // a direct train lifts a match about ten places
            .sort((a, b) => b.s - a.s)
            .slice(0, 6)
            .map((r) => r.h)
        : found;
      const trains = this.opts.onTrain ? searchTrains(this.net, q) : [];
      const spotHits = this.opts.spots?.()?.searchHits(q, 3) ?? [];
      const spots = spotHits.map((h) => h.s);
      // a number is a train; a name can be a station, a town without one, or a train. A town
      // without a station goes first when no station's name starts with what you typed
      // what reads as typed goes first: a station or city, else a town without a station, else
      // whichever needed fewer slips forgiven, stations on a tie ("manaali": Manali before
      // Mangaliyawas; "dehli": Delhi before Deoli)
      const spotStrong = !!spotHits.length && spotHits[0].strong;
      const plain = places.length && (places[0].strong || (!spotStrong && (!spotHits.length || places[0].slip <= spotHits[0].slip)));
      const ps = places.slice(0, trains.length || spots.length ? 4 : 6).map((h) => ({ p: h.p, via: h.via }) as Item);
      const ss = spots.map((x) => ({ s: x }) as Item);
      this.results = [...(plain ? [...ps, ...ss] : [...ss, ...ps]), ...trains.map((t) => ({ t }) as Item)];
      this.online(q);
    }
    this.active = this.results.length && q.trim() ? 0 : -1;
    this.render();
  }

  /** Nothing much here: ask the online place search (once you've paused typing). */
  private online(q: string) {
    clearTimeout(this.lookup);
    const hits = this.results.filter((r) => !r.t).length;
    // a station, city or town that's exactly what you typed ("bombay" is Mumbai): no need to look further
    const f = fold(q.trim());
    const exact = this.results.some((r) => (r.p && (fold(r.p.name) === f || r.p.aka.some((a) => fold(a) === f))) || (r.s && (fold(r.s.name) === f || r.s.aka.some((a) => fold(a) === f))));
    if (!this.opts.online || !this.opts.onSpot || q.trim().length < 4 || hits >= 3 || exact || fold(q) === this.asked) return;
    this.lookup = window.setTimeout(async () => {
      this.asked = fold(q);
      const found = await searchOnline(q).catch(() => []);
      if (this.input.value !== q || !found.length) return;
      const near = (a: { lat: number | null; lon: number | null }, b: Spot) => a.lat !== null && a.lon !== null && Math.abs(a.lat - b.lat) < 0.08 && Math.abs(a.lon - b.lon) < 0.08;
      // one of ours already, or the same name in the same state as one of ours
      const same = (r: Item, f: Spot) => (r.p && near(r.p, f)) || (r.s && (near(r.s, f) || (fold(r.s.name) === fold(f.name) && r.s.state === f.state)));
      // a place found online that has a station of its own isn't "a place without a station"
      const served = (f: Spot) =>
        [...this.net.places.values()].some((p) => p.halts >= 3 && p.lat !== null && p.lon !== null && Math.abs(p.lat - f.lat) < 0.06 && Math.abs(p.lon - f.lon) < 0.06 && km(f, { lat: p.lat, lon: p.lon }) < 6);
      const fresh = found.filter((f) => !this.results.some((r) => same(r, f)) && !served(f));
      this.results = [...this.results, ...fresh.slice(0, 4).map((s) => ({ s }))];
      if (this.active < 0 && this.results.length) this.active = 0;
      this.render();
    }, 380);
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

  private pick(it: Item) {
    this.input.value = "";
    this.results = [];
    this.close();
    this.input.blur();
    if (it.t) this.opts.onTrain?.(it.t);
    else if (it.s) this.opts.onSpot?.(it.s);
    else this.onPick(it.p);
  }

  private render() {
    const q = this.input.value.trim();
    if (!this.results.length) {
      this.list.innerHTML = q ? `<li class="none" aria-disabled="true">${esc(this.opts.empty ?? "No station or city by that name in this timetable")}</li>` : "";
      this.list.hidden = !q;
    } else {
      this.list.innerHTML = this.results
        .map((it, i) => {
          if (it.s) {
            const s = it.s;
            return `<li role="option" id="${this.id}-${i}" data-i="${i}" aria-selected="${i === this.active}">
              <span class="s-img s-spot" aria-hidden="true">${PIN}</span><span class="s-name">${esc(s.name)}</span><span class="s-script"></span>
              <span class="s-meta">${esc(`${s.state ? `${s.state} · ` : ""}${s.fromSearch ? "found online · " : ""}no station: see how to get there`)}</span></li>`;
          }
          if (it.t) {
            const t = it.t;
            const a = this.net.stations[t.st[0]].name;
            const b = this.net.stations[t.st[t.st.length - 1]].name;
            return `<li role="option" id="${this.id}-${i}" data-i="${i}" aria-selected="${i === this.active}" class="s-train">
              <span class="s-img s-no" aria-hidden="true">${esc(t.no)}</span><span class="s-name">${esc(t.name)}</span><span class="s-script">${esc(t.no)}</span>
              <span class="s-meta">${esc(`${a} → ${b}${t.days ? ` · ${daysLabel(t.days)}` : ""}`)}</span></li>`;
          }
          const p = it.p;
          const codes = p.stations.map((s) => this.net.stations[s].code);
          const note = this.opts.context?.(p)?.note;
          const meta = note ?? (it.via ? `${titleCase(it.via)} · ${p.state}` : p.isCity && codes.length > 1 ? `${p.state} · ${codes.length} stations` : `${p.state ? p.state + " · " : ""}${codes[0]}`);
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
