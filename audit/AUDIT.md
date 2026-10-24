# Railgaddi: the five-expert audit

What this file is: the audit of railgaddi (nimb-ou.github.io/railgaddi) by a copywriter, a UI
designer, a UX designer, a full-stack engineer and an Indian railways historian, and the ranked
list of work that came out of it. Each expert's own findings are in `audit/findings/`. The
screenshots are in `audit/before/` and `audit/after/`.

- **Site:** pick your station and see every place in India a direct train can take you, as far as
  you're happy to ride; each place's next train, what's there and when to go; hill towns without
  a station; a trip planner; railway stories. Discovery only, no booking.
- **Users:** Indian travellers and train lovers, mostly on phones, often arriving on a shared link
  or from a search.
- **Top tasks:** (1) where can I go from my station in N hours; (2) a place: the next train, what's
  there, when to go; (3) a hill town with no station; (4) a trip with several stops; (5) stories
  and facts; (6) save or share.
- **Stack:** Vite 8 + TypeScript (no UI framework), d3 + canvas map, PWA, 3,987 prerendered pages,
  GitHub Pages. Kept: nothing in the audit needs a different stack.

---

## 1.1 Baseline

### Metrics (before)

Production build on `vite preview`. Lighthouse 12.8.2 with devtools throttling (mobile: 4x CPU,
slow 4G). Full reports: `audit/before/lighthouse-*.json`, `audit/before/metrics.md`.

| Page | Form | Perf | A11y | BP | SEO | LCP | CLS | TBT | Requests | Weight |
|---|---|---|---|---|---|---|---|---|---|---|
| Home | mobile | 78 | 100 | 100 | 100 | 1.97 s | 0.003 | 663 ms | 46 | 1,874 KiB |
| Home | desktop | 80 | 100 | 100 | 100 | 0.24 s | 0.039 | 433 ms | 52 | 1,911 KiB |
| Place (Hampi from Bengaluru) | mobile | 37 | 100 | 79 | 100 | 10.66 s | 0.014 | 2,797 ms | 55 | 2,429 KiB |
| Place | desktop | 80 | 100 | 78 | 100 | 1.19 s | 0.004 | 376 ms | 86 | 2,346 KiB |
| Discover | mobile | 35 | 100 | 100 | 100 | 12.87 s | 0.081 | 2,918 ms | 58 | 2,402 KiB |
| Discover | desktop | 88 | 100 | 100 | 100 | 1.01 s | 0.022 | 270 ms | 61 | 2,132 KiB |

- **Input to paint (INP-style, phone, 4x slower CPU, `scripts/perf.mjs`):** open a story 1,728 ms;
  surprise me 208 ms; plan a trip 208 ms; typing in search 200 ms; a place without a station
  184 ms; everything else under 140 ms. Toy-trains filter: a 632 ms long task.
- **Bundles (gzip):** JS 100.5 kB (one 300 kB file), CSS 12.4 kB. Fonts: 17 woff2, 1.0 MB, mostly
  Indian scripts loaded on demand. Data on first visit: timetable 406 kB, paths 223 kB, meta
  479 kB, trains 353 kB, places index 394 kB (raw JSON, compressed by the host).
- **Images:** 404-911 KiB per first view (Wikimedia Commons thumbnails), relief 136 kB WebP.
- **axe-core 4.14** (WCAG 2.1 AA + best practice) on 120 captures: 2 rules, 238 nodes: `region`
  (moderate, 210: the map canvas and zoom outside landmarks) and `label-content-name-mismatch`
  (serious, 28: the month buttons, the folded-stops buttons).
- **Console errors:** none in 120 captures.

### Screenshots

`audit/before/NN-view-WIDTH-THEME.webp`: 20 views at 375, 768 and 1440 px, day and night (120).
Captured by `scripts/audit.mjs`, Lighthouse by `scripts/lighthouse.sh`.

### Inventory

**Views** (each has its own address): landing · search suggestions · a station's reach (ride
length, lenses, moods, fine-tune, the list) · a place (ticket; tabs: what to see, when to go, all
trains, quicker with a change, weather, close by; getting here; credits) · one train's stops ·
a journey with one change · a place without a station · the weather layer · the trip planner ·
Discover (facts, stories, records) · a story · Saved (optional Google sign-in) · About ·
an unknown place · offline · the share poster · 3,987 prerendered static pages, sitemap, robots.

**Components:** header (brand, five icon buttons) · phulkari band · route form (from/to, near-me,
swap, suggestion lists) · panel / bottom sheet with grip · canvas map (relief, track, station
board, arch markers, blue dot, tooltip) · map tools (Mausam card, zoom) · toast · loading card ·
chips and pills · idea cards · call-to-action card · fact note · ride-length steps · lens and mood
chips · fine-tune selects · destination rows · arch cover · ticket · tabs · sight cards · month
strip · forecast · timetable rows · newer trains · LED board and split-flap times · line diagram ·
journey strip · ways (train then road) · airports · trip stops and hops · story cards · records ·
saved list · poster.

**Flows:** pick a start (type, near me, a popular chip, last time) · narrow (ride length, lens,
mood, good this month, train kind, leaving when) · open a place (list or map) · next train → stops ·
all trains · a journey with a change · change start · place first, then start · a hill town ·
weather layer · plan a trip (stops, nights, date, other trains, save, share) · Discover → story →
ride it · save a place / route / town · share (Web Share or poster) · day/night · sign in ·
offline.

**Content:** 891 place guides (Wikivoyage + Wikidata), 2,784 towns without a station, 13 stories,
62 facts, timetable records, 12-month weather for every place; 7,865 trains, 142,780 halts,
9,476 stations, 136 newer trains.

**Data sources:** Trains at a Glance 2026 and the 2017 open-data timetable (data.gov.in);
Wikipedia (running days, newer trains, summaries); Wikivoyage; Wikidata; Wikimedia Commons;
GeoNames; OurAirports; OpenStreetMap + OSRM; datameet (stations, track, maps; boundaries per
Survey of India); Natural Earth (relief, coastline); NASA POWER; IMD via Wikivoyage; SRTM via
OpenTopoData. At runtime: upload.wikimedia.org (photos), en.wikipedia.org (summaries of towns
without a station), Open-Meteo (forecast, place search).

---

## 1.2 Expert audits

Each expert audited independently (in parallel, without seeing the others' findings):

- [Copywriter](findings/copywriter.md)
- [UI designer](findings/ui-designer.md)
- [UX designer](findings/ux-designer.md)
- [Full-stack engineer](findings/engineer.md)
- [Railways and history expert](findings/railways-expert.md)
