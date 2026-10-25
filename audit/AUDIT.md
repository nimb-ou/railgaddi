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

How this round actually ran: the five experts were launched as parallel agents. The copywriter
finished; the other four were stopped three times by the account's usage limit before writing
anything, so their audits were then done by the lead, each from its own checklist and the same
evidence (screenshots, axe, Lighthouse, and measurement scripts: `scripts/ux-check.mjs` for
targets, overflow, headings and a keyboard walk, `scripts/inp-one.mjs` for one tap's timing,
`scripts/prof-load.mjs` for a CPU profile). Each file says so at the top.

Counts: copywriter 70 (CW), UI 12 (UI), UX 9 (UX), engineer 12 (ENG), railways 15 (RAIL).

---

## 1.3 Consensus

### Flagged by more than one expert (boosted)
| Merged item | Findings |
|---|---|
| A shared link waits 8–12 s behind a loading card | ENG-01, UX-01, UI-12 |
| On a phone the place's photo hides the next train | UI-01, UX-02 |
| Small tap targets (tk-save 20 px fails WCAG 2.5.8) | UI-04, UX-03, ENG-06 |
| Header breaks at 320 px | UI-03, UX-04 |
| Search boxes at 15 px zoom iOS | UI-10, UX-07 |
| Toy-train towns described as "by road" only | UX-05, RAIL-11 |
| Ooty vs Udhagamandalam | CW-61, UX-09, RAIL-15 |
| Vivek Express launch year | CW-59, RAIL-01 |
| Month buttons / folds named differently from what they show | CW-68, ENG-12 |

### Conflicts, decided
- **Rich photos vs speed:** keep the arch photos (they're the character), but smaller on phones,
  sized by srcset, and preloaded on deep links. Speed comes from not waiting, not from removing.
- **Flavour vs clarity:** the owner dropped Punjabi; at most one pan-Indian word a screen
  ("Chalo", "parathas", "achaar"), never in a label or button. Clarity wins every tie.
- **Gurmukhi in Amritsar's name line and poster (CW-65) vs the owner's rule:** the owner said
  scripts are fine as decoration; it stays (dropped).
- **More stories vs accuracy:** this round corrects the existing 13 stories and 62 facts; new
  stories wait until each is sourced (next steps).
- **Type and radius tokens vs regressions:** introduce the tokens and fold the half-pixel sizes
  into the scale; no layout rewrites in the same pass.
- **Splitting app.ts vs shipping:** a refactor with no user-visible gain; out of scope this round.

### Design principles (the north star)
1. **The answer first.** Each view leads with what you came for (the train, the way in), the
   decoration after it.
2. **One thing at a time,** deeper only when asked.
3. **India's railway, honestly.** Real timetables, sourced facts, exact times; the jokes never
   bend a fact.
4. **Calm and quick.** Nothing waits that doesn't have to; motion only answers you.
5. **Every finger, every eye.** 44 px targets, AA contrast, 320 px phones, keyboard and screen
   readers.

### Visual direction (within the owner's settled look)
- **Type:** Tiro Devanagari Hindi (names), Hind (text), Rozha One (numbers). Scale: 11 · 12 · 13 ·
  14 · 15 · 17 · 21 · 26 · 32 px; nothing under 11 px; inputs 16 px.
- **Colour:** the existing day (ivory, indigo, madder, turmeric, peacock) and night palettes, with
  `--go` darkened to #227a34 in the day and a `--rani-ink` #a8285a for rani text on tints.
- **Spacing:** 4 · 8 · 12 · 16 · 20 · 24 px. **Radii:** 4 · 8 · 12 · 18 · 24 · pill.
- **Shadows:** the two existing (`--shadow`, `--shadow-sm`).
- **Motion:** 160 ms for hover and press, 340 ms for a view rising in, one easing
  (cubic-bezier(0.22, 0.8, 0.24, 1)); none with reduced motion.
- **Voice:** the copywriter's guide (findings/copywriter.md §2b): plain, warm, slightly quirky
  English; say what it is before the joke; one name per thing; errors say what to do.

### Scoring
Impact, Effort and Confidence 1–5; **Priority = Impact × Confidence ÷ Effort.**

## TODO (ranked)

| # | Item | Findings | I | E | C | Priority | Status |
|---|---|---|---|---|---|---|---|
| 1 | Copy: no Punjabi, what it is first, exact facts, one name per thing, errors that help | CW-01..58, 61..70 (except 59, 60, 65) | 5 | 2 | 5 | 12.5 | done (8de3515) |
| 2 | Correct the stories and facts | RAIL-01..09, 12..14, CW-59, CW-60 | 4 | 1 | 5 | 20 | done (4541ce4) |
| 3 | Smaller arch on phones so the next train shows | UI-01, UX-02 | 4 | 1 | 4 | 16 | done (cbf1848) |
| 4 | Netaji Express name for 12311/12312 | RAIL-10 | 3 | 1 | 5 | 15 | done (4541ce4) |
| 5 | Header fits at 320 px | UI-03, UX-04 | 3 | 1 | 5 | 15 | done (cbf1848) |
| 6 | Selected ride length visible at night | UI-02 | 3 | 1 | 5 | 15 | done (cbf1848) |
| 7 | Inputs at 16 px (no iOS zoom) | UI-10, UX-07 | 3 | 1 | 5 | 15 | done (cbf1848) |
| 8 | "Book on IRCTC" and "Live status on NTES" at the end of a train | UX-06 | 3 | 1 | 4 | 12 | done (cbf1848) |
| 9 | Tap targets ≥ 44 px (≥ 24 px minimum) | UI-04, UX-03, ENG-06, UI-11 | 4 | 2 | 5 | 10 | done (cbf1848) |
| 10 | Contrast: --go, rani text on tints | UI-05 | 2 | 1 | 5 | 10 | done (cbf1848) |
| 11 | Inline the theme script (no render-blocking request) | ENG-03 | 2 | 1 | 4 | 8 | done (cbf1848) |
| 12 | A 640 px photo size for covers | ENG-04 | 2 | 1 | 4 | 8 | done: phones get the arch's own size (640 px isn't a Commons step) (cbf1848) |
| 13 | Place tabs in one row | UI-08 | 2 | 1 | 4 | 8 | done (cbf1848) |
| 14 | Arrow keys between place tabs | ENG-07 | 2 | 1 | 4 | 8 | done (cbf1848) |
| 15 | Deep links draw the view at once | ENG-01, UX-01, UI-12 | 5 | 3 | 4 | 6.7 | done (2b11eaa) |
| 16 | Toy train named in the hills lens | UX-05, RAIL-11 | 3 | 2 | 4 | 6 | done (cbf1848) |
| 17 | An h1 on every view | ENG-05 | 3 | 2 | 4 | 6 | done (cbf1848) |
| 18 | The map in a landmark | ENG-08 | 1 | 1 | 5 | 5 | done (cbf1848) |
| 19 | Dead code out | ENG-09 | 1 | 1 | 5 | 5 | done (cbf1848) |
| 20 | Shorter long tasks after the timetable lands | ENG-02 | 3 | 2 | 3 | 4.5 | done (cbf1848) |
| 21 | Ride caption not in error red | UI-09 | 1 | 1 | 4 | 4 | done (cbf1848) |
| 22 | One height on a hill town's page | CW-56 (rest) | 1 | 1 | 4 | 4 | done (cbf1848) |
| 23 | Ooty, not only Udhagamandalam | CW-61, UX-09, RAIL-15 | 2 | 2 | 3 | 3 | dropped: station names follow the official name (Udhagamandalam); preferring Wikivoyage's titles would bring back old names (Bangalore, Mysore) for 852 places; the story already says "Udhagamandalam (Ooty)" |
| 24 | Type and radius tokens | UI-06, UI-07 | 2 | 3 | 4 | 2.7 | done (cbf1848) |
| 25 | Re-measure the story tap | UX-08 | 1 | 1 | 5 | 5 | done: 90 ms (2.3); the 1.7 s was a measuring artefact |

### Dropped
| Finding | Why |
|---|---|
| CW-65 (Gurmukhi on Amritsar's line and poster) | The owner allows scripts as decoration; station boards show the local script by design |
| ENG-10 (Wikimedia's third-party cookie) | Set by upload.wikimedia.org on hotlinked photos; avoiding it means proxying every photo |
| ENG-11 (split app.ts) | A large refactor with no user-visible gain; next round |
| RAIL §2d new stories | Each needs its own sourcing first; listed as next steps |


---

## 2.3 Verification

All after numbers are from the production build (`vite preview`). Screenshots: `audit/after/`
(the same 20 views × 3 widths × 2 themes as before).

### Before and after, measured side by side
Lighthouse's blocking time swings a lot from run to run on one machine (the landing page gave
643 ms and 1,868 ms on two runs in a row), so the old build (f357a81, rebuilt in a worktree) and
the new one were measured under the same conditions, alternating, three runs each; the table is
the median (`scripts/lh-compare.sh`, mobile, devtools throttling).

| Page | Build | Perf | LCP ms | TBT ms | CLS | FCP ms | Requests | KiB |
|---|---|---|---|---|---|---|---|---|
| home | before | 62 | 2167 | 3994 | 0.003 | 2167 | 46 | 1875 |
| home | after | 74 | 1722 | 1005 | 0.001 | 1722 | 45 | 1877 |
| place | before | 47 | 10247 | 924 | 0.053 | 1612 | 73 | 2598 |
| place | after | 73 | 1633 | 965 | 0.024 | 1633 | 56 | 2249 |
| discover | before | 40 | 11662 | 1388 | 0.082 | 1602 | 58 | 2345 |
| discover | after | 65 | 1779 | 1454 | 0.028 | 1745 | 47 | 2252 |

| Metric | Before | After |
|---|---|---|
| Largest paint, a shared place link, phone on slow 4G (`scripts/early-shot.mjs`) | 10.7 s | 1.2–1.5 s |
| Largest paint, Discover link, same | 12.9 s | 1.4 s |
| Largest paint, a town without a station, same | (waited for the stations) | 1.3 s |
| Lighthouse accessibility / best practices / SEO (all six runs) | 100 / 78–100 / 100 | 100 / 100 / 100 |
| axe-core, 120 captures | 2 rules, 238 nodes | **0 rules, 0 nodes** |
| Console errors, 120 captures | 0 | 0 (one 404 found and fixed: a story photo renamed on Commons) |
| Tap to drawn frame, phone, 4x CPU (`scripts/tap-paint.mjs`): another fact | 119–136 ms | 75–82 ms |
| Same: open a story | 93–188 ms | 88–118 ms |
| Tap to paint (`scripts/perf.mjs`, both builds the same day): type in search | 504 ms | 136 ms |
| Same: surprise me | 376 ms | 88 ms |
| Same: a place without a station | 216 ms | 56 ms |
| Same: plan a trip | 160 ms | 96 ms |
| Header at 320 px | the About button cut off | fits |
| Views with an h1 | 1 of 9 | 9 of 9 |
| Smallest tap target | 20 × 20 px (save route) | 44 px hit areas (36 px drawn) |
| JS / CSS (gzip) | 100.5 / 12.4 kB | 101.9 / 12.9 kB |

The 1.7 s "open a story" in the baseline was a measuring artefact: Event Timing reports an
interaction when its frame is presented, and the tap before it ("another fact", tapped as the
test scrolled the button into view) was being counted on the next step. Timed from the tap to
the drawn frame, both are under 200 ms in both builds. `scripts/perf.mjs` now scrolls a target
into view and lets it settle before tapping.

### Top tasks, friction (before → after)
| Task | Before | After |
|---|---|---|
| Where can I go in 4 h (phone) | 2–3 taps; ride-length selection invisible at night | 2–3 taps; selection visible in both themes |
| A place: the next train (phone) | 1 tap + a drag: the train was under a 236 px photo | 1 tap: the ticket is in view with the sheet at rest |
| A place from a shared link (phone, 4G) | 10.7 s behind a loading card | the place, its photo and the ride's length in ~1.5 s |
| A hill town without a station | "nearest about 107 km" (which station?) | "nearest is Angamali, about 107 km by road" |
| Shimla from Delhi (hills lens) | "Train to Kalka, then 2h 45m by road" | "…then the toy train, or 2h 45m by road" |
| After finding the train | a source line | "Book on IRCTC ↗" and "Live status on NTES ↗" |
| A broken link | a 5-second toast | a note on the page until the next pick |

### Checked by hand (keyboard, dark mode, widths)
- Keyboard: the landing walk (skip link → header → search → starts → hill towns → ideas) keeps a
  visible ring throughout; a place's tabs move with ←/→/Home/End; Escape closes About and a train.
- Day and night at 375, 768 and 1440 px: every view in `audit/after/`; no overflow at 320 px.
- Each expert's last pass: no Punjabi left (a sweep of every template found only "Chalo" in the
  question, and "parathas", "achaar", "chai" as everyday English); no new facts without a source;
  the drawn-in previews use the app's own markup and classes.
