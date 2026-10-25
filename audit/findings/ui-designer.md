# UI designer findings (UI)

The four other auditors (UI, UX, engineer, railways) were run as parallel agents twice and stopped
both times on the account's usage limit before writing. These four files were then written by the
lead from the same evidence (audit/before screenshots and report.json, plus the measurements in
scripts/ux-check.mjs, scripts/inp-one.mjs and scripts/prof-load.mjs), each from its own checklist.

## 1. Summary
- The look is intentional and distinctive (relief map, track lines, jharokha arches, ticket,
  station board); the night theme is designed, not inverted. Motion is calm and respects
  `prefers-reduced-motion` (style.css:823, map.ts:105).
- The system underneath has drifted: 26 font sizes (with half pixels), 20 corner radii, padding
  values that follow no scale.
- A few states and sizes fail: the selected ride length is nearly invisible at night, two colour
  pairs miss AA, small targets, and on a phone the place's photo pushes the answer (the train)
  below the sheet.

## 2. Extras

### 2a. Type scale
| Now (px, count) | Proposed token | Use |
|---|---|---|
| 10, 10.5, 11 (16) | `--fs-xs: 11px` | eyebrows, tags, tiny meta (never below 11) |
| 11.5, 12 (20) | `--fs-sm: 12px` | meta lines, legends |
| 12.5, 13 (42) | `--fs-13: 13px` | secondary text, chips |
| 13.5, 14 (48) | `--fs-14: 14px` | body in the panel, buttons |
| 14.5, 15, 15.5 (14) | `--fs-15: 15px` | body (base), list names |
| 16, 17 (13) | `--fs-17: 17px` | inputs (16 minimum), ticket train name |
| 18, 19, 21, 22, 23 (13) | `--fs-21: 21px` | section titles (h3) |
| 24, 25, 27, 28 (10) | `--fs-26: 26px` | view titles on phones, big numbers |
| 30, 32, 34 (6) | `--fs-32: 32px` | view titles (h1/h2), the question |

### 2b. Spacing and radii
- Spacing in use: 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 22 px (paddings), no tokens.
  Proposed 4-pt scale: `--s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px; --s-6: 24px`.
- Radii in use: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 999 px.
  Proposed: `--r-xs: 4px; --r-sm: 8px; --r-md: 12px; --r-lg: 18px; --r-xl: 24px; --r-pill: 999px`.

### 2c. Contrast (WCAG AA 4.5:1 for text)
| Pair | Theme | Ratio | Result |
|---|---|---|---|
| --muted #6c6458 on --paper / --paper-2 / --card | day | 5.23 / 4.80 / 5.74 | pass |
| --muted on --paper-3 #e8dcc6 | day | 4.30 | fail (selected chips, skeletons) |
| --go #2b8a3e on --card (search "direct" meta) | day | 4.30 | fail |
| --rani #c8336b on its 12% tint (`.tag.fast`) | day | ≈4.0 | fail |
| --rani on --paper | day | 4.55 | pass, barely |
| --caution #a8530a on --brand-soft (spot badge) | day | 4.61 | pass |
| --peacock #0f6b63 links on --paper | day | 5.70 | pass |
| --muted #bcb19d on --paper #141b33 | night | 8.03 | pass |
| all night text tokens on night surfaces | night | ≥4.96 | pass |

### 2d. Component states (present / missing)
| Component | hover | focus-visible | pressed/selected | disabled | loading |
|---|---|---|---|---|---|
| icon-btn (header) | yes | yes (global ring) | yes (aria-pressed tint) | n/a | n/a |
| seg (ride length) | yes | yes | **weak at night** | n/a | n/a |
| chips / lenses | yes | yes | yes | n/a | n/a |
| tabs (place pills) | yes | yes | yes | n/a | skeleton |
| ticket train button | yes | yes | n/a | n/a | n/a |
| tk-save (bookmark) | colour only | yes | colour only | n/a | n/a |
| search field | n/a | yes (ring on .route) | n/a | n/a | spinner on near-btn |
| map-btn (Weather) | yes | yes | yes | n/a | "Asking the clouds…" |

## 3. Findings

| ID | Expert | Location (page/component/file:line) | Issue + evidence | Principle/source | Severity | Fix |
|---|---|---|---|---|---|---|
| UI-01 | UI | Place on phones; .pl-cover (style.css) | The 200×236 arch photo fills the sheet at rest; the ticket (the next train, the answer) starts below the fold (06-place-375-day, 06-place-375-night) | Visual hierarchy: the answer first | High | At ≤720 px: `.pl-cover .arch` 132×156 px, cover and name side by side is too tight, so keep stacked but smaller; ticket visible at the resting sheet height |
| UI-02 | UI | Ride-length seg, night; style.css `.seg button[aria-pressed=true]` | Selected "4 h" is hard to tell from the others at night (04-from-4h-1440-night) | State visibility | High | Selected: background `--card`, border 1px `--rule`, colour `--text`, weight 600, and a 2px turmeric underline in both themes |
| UI-03 | UI | Header at 320 px; `.head-tools` | The About button overflows the panel (right edge 338 px at 320 px wide; ux-check) | Responsive layout | High | At ≤360 px: head-tools gap 0, icon-btn 34 px with 44 px hit area via ::after, brand-hi hidden |
| UI-04 | UI | Tap targets: tk-save 20×20, icon-btn 36×36, round 36×36, link-btn 21 px tall, month buttons 25 px wide, trip arrows 30×30, grip 20 px | ux-check measurements on 375 px | WCAG 2.5.8 (24 px min), 44 px comfortable | High | Invisible hit-area expansion: `position: relative` + `::after { inset: -6px }` on small buttons; tk-save becomes 36×36 |
| UI-05 | UI | `.tag.fast`, `.suggest .direct .s-meta` | Rani tag text ≈4.0:1 on its tint; --go meta 4.30:1 on card | WCAG 1.4.3 | Med | Day: `--go: #227a34`; tags use `--rani-ink: #a8285a` for text |
| UI-06 | UI | Type sizes across style.css | 26 sizes incl. 10.5/11.5/12.5/13.5/14.5/15.5 px | Typographic scale | Med | Tokens of 2a; map each declaration to the nearest step, never below 11 px |
| UI-07 | UI | Radii across style.css | 20 radii | Consistency | Low | Tokens of 2b |
| UI-08 | UI | Place tabs (`.pills`) at 404 px panel | Four pills wrap to two rows, "Weather" alone on the second (07-place-when-1440-day) | Gestalt, rhythm | Med | One row that scrolls sideways (`flex-wrap: nowrap; overflow-x: auto`), with a fade at the edge |
| UI-09 | UI | Ride caption `.ride-cap` | Italic red caption ("As far as the tracks go…") reads as an error message | Semantic colour | Low | `color: var(--muted)`, not italic red |
| UI-10 | UI | Inputs `.gh-search input` 15 px, `#trip-input` | 15 px text in a field makes iOS Safari zoom the page on focus | Platform convention | Med | 16 px for every text input |
| UI-11 | UI | Ticket bookmark (tk-save) | A 20 px icon with no label floats beside "Change start"; its meaning isn't obvious | Recognition over recall | Low | 36 px round button with a visible "Save" label on wide screens; keep the icon on phones |
| UI-12 | UI | Deep link loading | A full-screen paper card hides the whole page until the timetable arrives (8–12 s on slow 4G) | Perceived performance | High | See ENG-01: the view drawn into the page, a small loading pill instead |
