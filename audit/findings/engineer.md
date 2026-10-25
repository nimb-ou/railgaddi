# Full-stack engineer findings (ENG)

Written by the lead from the evidence after the parallel agent was stopped by the usage limit
(see the note in ui-designer.md). Tools: Lighthouse JSON (audit/before), scripts/prof-load.mjs
(CPU profile at 4x), scripts/inp-one.mjs (Event Timing), scripts/ux-check.mjs, tsc, vitest.

## 1. Summary
- Deep links are slow on phones because the view waits for the whole timetable: the LCP element
  (the place's photo) only starts loading after 9 s of data. The landing page is fine (LCP 2.0 s).
- Accessibility basics are good (Lighthouse 100, axe: 2 rules); gaps are headings (no h1 on most
  views), target sizes, and the map outside landmarks.
- The code is tidy and typed (tsc clean, 62 tests pass); the controller (app.ts, 2,300 lines) is
  large but coherent. Little dead code.

## 2. Extras

### 2a. Performance budget (mobile, Lighthouse devtools throttling)
| Metric | Now (worst page) | Target |
|---|---|---|
| LCP | 12.9 s (Discover), 10.7 s (place) | ≤ 2.5 s |
| TBT | 2.9 s | ≤ 600 ms |
| INP (phone, 4x) | 208 ms worst repeatable (surprise me, plan a trip) | ≤ 200 ms |
| CLS | 0.081 | ≤ 0.05 |
| JS (gzip) | 100 kB | ≤ 110 kB |
| CSS (gzip) | 12 kB | ≤ 15 kB |
| Images on first view | 404–911 KiB | ≤ 600 KiB |
| Requests | 46–86 | ≤ 70 |

### 2b. Keyboard walk (landing, 1440 px)
Skip link → brand → five header buttons → search field (ring on the field box) → near-me →
"use where I am" → six popular starts → "Search it" → ten hill towns → idea cards → CTA → fact
link: every stop has a visible ring and the order follows the page. Enter on a suggestion picks
it; Escape closes About and returns focus. Tabs on a place are buttons with role=tab but no
arrow-key handling (ENG-07).

### 2c. Heading outline (375 px)
home: h1 question, h2 hills, h2 ideas · from: h2 only · place: h2 name, h3 sections · train: h2
(visually hidden) · spot: h2, h3 × 4 · trip: h2 · discover: h2, h3 × 3 · story: h2, h3 × 2.
Every view but the landing starts at h2.

### 2d. Dead code
`settleFlaps` (src/ui/boards.ts:12, empty, unused) · `drawCover` (src/ui/photos.ts:84, unused) ·
`MONTH_SHORT` (src/core/climate.ts:8, unused) · `.num` (style.css:145, unused).

## 3. Findings

| ID | Expert | Location (page/component/file:line) | Issue + evidence | Principle/source | Severity | Fix |
|---|---|---|---|---|---|---|
| ENG-01 | ENG | main.ts:110 (`await ready` for place/discover routes); scripts/prerender.ts `render()` | Place LCP 10.7 s: the cover's request starts at 9.9 s (lighthouse-place-mobile: load delay 9,062 ms) because the panel is rendered only after timetable.bin.gz (397 kB) and five JSON files arrive. Discover LCP 12.9 s, render delay only | Critical rendering path | Critical | Prerender each place/pair/discover/story/spot page's panel into #panel (`data-drawn`), drop `data-deep` for them (the small loading pill instead), and preload the cover with the same URL and srcset the app uses, so the app's redraw doesn't create a larger LCP candidate |
| ENG-02 | ENG | lighthouse-*-mobile: 1,269 ms and 886 ms long tasks after the timetable lands | refreshNetwork + timetableReady + applyRoute run in one task; `istWeekMinute` builds two Intl.DateTimeFormat per call (109 ms self time in the profile); `narrow()` reads innerWidth (layout) | Long tasks, TBT | Med | Yield between the three steps; cache the formatters; `narrow()` via a cached matchMedia |
| ENG-03 | ENG | index.html `<script src="/theme-boot.js">` | A render-blocking request (≈880 ms on slow 4G) for 8 lines | Render-blocking resources | Med | Inline it; allow it in the CSP with its sha256 hash (public/_headers) |
| ENG-04 | ENG | Covers: panel.ts `coverSizes`, photos.ts srcset steps | The place cover is fetched at 960 px for a ~240 px-wide arch on a 1.75x phone (Lighthouse "properly size images": 251 KB) | Image sizing | Med | Add a 640 px step to the srcset; sizes from the arch's real rendered width |
| ENG-05 | ENG | Views other than the landing | No h1; the view title is an h2 (2c) | WCAG 1.3.1, 2.4.6; SEO | Med | The panel title becomes the h1 when the landing question is hidden |
| ENG-06 | ENG | tk-save 20×20 and other small targets | Under WCAG 2.5.8's 24 px | WCAG 2.5.8 | High | UI-04 |
| ENG-07 | ENG | Place tabs (panel.ts `role="tablist"`) | role=tab without arrow-key navigation or roving tabindex | ARIA Authoring Practices: tabs | Low | Left/Right/Home/End move between tabs; inactive tabs tabindex=-1 |
| ENG-08 | ENG | axe `region` (210 nodes) | The map canvas and zoom sit outside any landmark | WCAG best practice | Low | Wrap the map and its tools in `<main aria-label="Map">` |
| ENG-09 | ENG | Dead code (2d) | Four unused symbols | Maintainability | Low | Delete |
| ENG-10 | ENG | Best practices 78–79 on place pages | `WMF-Uniq` third-party cookie set by upload.wikimedia.org on hotlinked photos | Lighthouse third-party-cookies | Low | Can't be fixed without proxying Commons photos; drop with a note |
| ENG-11 | ENG | app.ts (2,297 lines) | One controller owns state, rendering and every click | Separation of concerns | Low | Out of scope for this round (a refactor with no user-visible gain); note as next |
| ENG-12 | ENG | label-content-name-mismatch (axe, 28 nodes) | Month buttons and stop folds | WCAG 2.5.3 | Med | Done in the copy commit (CW-68, month strip names) |
