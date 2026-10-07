// Discover: journeys worth taking, facts about the railway, and records from the timetable.
// Facts are printed like the notes of a timetable book ("Note 17"), journeys as postcards, the
// records as a timetable table. Content: content/discover.json, built by pipeline/build_discover.py.
import type { Record } from "../core/numbers";
import type { Photo } from "../core/places";
import { esc } from "./esc";
import { img } from "./panel";
import { coverWidth, credit } from "./photos";

export interface Story {
  slug: string;
  title: string;
  dek: string;
  tags: string[];
  body: string[];
  rides: { from: string; to: string; train?: string; label: string }[];
  sources: string[];
  photo: Photo | null;
}

export interface Fact {
  id: string;
  cat: string;
  text: string;
  source: string;
  stations?: string[];
}

export interface DiscoverData {
  stories: Story[];
  facts: Fact[];
}

/** A ride from a story, as the app resolved it. */
export interface RideView {
  label: string;
  href: string | null;
  note: string; // "6h 40m · 12 trains"
  i: number;
}

export const CATS = ["History", "Trains", "Track", "Stations", "Numbers", "Quirky"];
const CLOSE = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`;
const host = (u: string) => u.replace(/^https?:\/\/(en\.)?/, "").split("/")[0];

/** One fact, as a note in a timetable book. */
export function noteHtml(f: Fact, n: number, total: number, withNav: boolean) {
  return `<figure class="note" aria-live="polite">
    <figcaption><span class="note-no">Note ${n}</span><span class="note-cat">${esc(f.cat)}</span>${withNav ? `<span class="note-of">${n} of ${total}</span>` : ""}</figcaption>
    <p>${esc(f.text)}</p>
    <a class="note-src" href="${esc(f.source)}" target="_blank" rel="noopener">Source: ${esc(host(f.source))} ↗</a>
    ${withNav ? `<div class="note-nav">
      <button type="button" class="link-btn" data-act="fact-prev" aria-label="Previous fact">← Previous</button>
      <button type="button" class="link-btn" data-act="fact-next" aria-label="Another fact">Another →</button>
    </div>` : ""}
  </figure>`;
}

/** The timetable's records, as rows (a train's or a place's open it). */
export function recordsHtml(records: Record[]) {
  return records
    .map(
      (r, i) => `<li>${r.train || r.place ? `<button type="button" data-act="record" data-i="${i}">` : "<div>"}
        <span class="rec-label">${esc(r.label)}</span>
        <b class="rec-value">${esc(r.value)}</b>
        <span class="rec-detail">${esc(r.detail)}</span>
      ${r.train || r.place ? "</button>" : "</div>"}</li>`,
    )
    .join("");
}

export function discoverHtml(d: DiscoverData, v: { fact: number; cat: string; records: Record[]; storyHref: (s: Story) => string }) {
  const facts = v.cat === "All" ? d.facts : d.facts.filter((f) => f.cat === v.cat);
  const f = facts[((v.fact % facts.length) + facts.length) % facts.length];
  const n = d.facts.indexOf(f) + 1;
  return `<div class="panel-scroll discover">
    <header class="list-head">
      <div class="masthead"><span class="eyebrow">Discover</span><h2 id="panel-title" tabindex="-1">Stories from the rails</h2></div>
      <button class="round" type="button" data-act="close" aria-label="Close">${CLOSE}</button>
    </header>

    <section aria-labelledby="facts-h">
      <div class="section-head"><h3 id="facts-h">Did you know?</h3></div>
      <div class="chips" role="group" aria-label="Kinds of fact">${["All", ...CATS]
        .map((c) => `<button type="button" data-act="fact-cat" data-cat="${c}" aria-pressed="${c === v.cat}">${c}</button>`)
        .join("")}</div>
      ${noteHtml(f, n, d.facts.length, true)}
    </section>

    <section aria-labelledby="stories-h">
      <div class="section-head"><h3 id="stories-h">Journeys worth taking</h3></div>
      <div class="story-grid">${d.stories
        .map(
          (s) => `<a class="story-card" href="${esc(v.storyHref(s))}" data-act="story" data-slug="${esc(s.slug)}">
            <span class="frame">${s.photo ? img(s.photo, `${coverWidth(s.photo, 184, 124)}px`, 250, 500, "") : ""}</span>
            <span class="sc-tags">${s.tags.map(esc).join(" · ")}</span>
            <b>${esc(s.title)}</b>
            <span class="sc-dek">${esc(s.dek)}</span>
          </a>`,
        )
        .join("")}</div>
    </section>

    <section aria-labelledby="records-h">
      <div class="section-head"><h3 id="records-h">By the numbers</h3><span class="count">from this timetable</span></div>
      <ol class="records">${recordsHtml(v.records)}</ol>
    </section>
  </div>`;
}

export function storyHtml(s: Story, rides: RideView[], facts: Fact[], allFacts: Fact[]) {
  const cover = s.photo
    ? `<figure class="cover"><div class="shot">${img(s.photo, `(max-width: 720px) 100vw, ${coverWidth(s.photo, 420, 212)}px`, 500, 1920, s.title, true)}</div></figure>`
    : "";
  return `<div class="panel-scroll story">
    <div class="train-top">
      <button class="back" type="button" data-act="discover">← Discover</button>
      <button class="round" type="button" data-act="close" aria-label="Close">${CLOSE}</button>
    </div>
    ${cover}
    <header class="story-head">
      <span class="sc-tags">${s.tags.map(esc).join(" · ")}</span>
      <h2 id="panel-title" tabindex="-1">${esc(s.title)}</h2>
      <p class="story-dek">${esc(s.dek)}</p>
    </header>
    <div class="story-body">${s.body.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
    ${rides.length ? `<section aria-labelledby="ride-h">
      <div class="section-head"><h3 id="ride-h">Ride it</h3></div>
      <div class="rides">${rides
        .map(
          (r) => `<a class="ride-ticket" href="${esc(r.href ?? "#")}" data-act="ride" data-i="${r.i}">
            <span class="rt-label">${esc(r.label)}</span>
            <span class="rt-note">${esc(r.note)}</span>
            <span class="rt-go">See it on the map →</span>
          </a>`,
        )
        .join("")}</div>
    </section>` : ""}
    ${facts.length ? `<section aria-labelledby="sf-h"><div class="section-head"><h3 id="sf-h">Did you know?</h3></div>${facts
      .map((f) => noteHtml(f, allFacts.indexOf(f) + 1, allFacts.length, false))
      .join("")}</section>` : ""}
    <footer class="credits-foot">
      Written for Railgaddi from ${s.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(decodeURIComponent(u.split("/wiki/")[1] ?? host(u)).replace(/_/g, " "))}</a>`).join(", ")} (Wikipedia, CC BY-SA 4.0).
      ${s.photo ? `Photo: <a href="${esc(s.photo.page)}" target="_blank" rel="noopener">${esc(credit(s.photo))}</a>.` : ""}
    </footer>
  </div>`;
}

/** A place's own fact, on its panel. */
export function placeFactHtml(f: Fact, n: number, total: number) {
  return `<section class="place-fact" aria-label="Did you know?">${noteHtml(f, n, total, false)}</section>`;
}
