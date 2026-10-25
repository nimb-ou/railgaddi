# UX designer findings (UX)

Written by the lead from the evidence after the parallel agent was stopped by the usage limit
(see the note in ui-designer.md). Measurements: scripts/ux-check.mjs (targets, overflow,
headings, keyboard), scripts/inp-one.mjs, the before screenshots.

## 1. Summary
- The core loop works and is quick once loaded: station → ride length → place → train, three or
  four taps, with real addresses so Back and sharing behave.
- The worst friction is at the two edges: arriving from a shared link (a full-screen wait of
  8–12 s on a phone on 4G) and, on a phone, the place's photo hiding the answer.
- Small targets everywhere a finger goes often (header icons, the save-route bookmark, month
  buttons, link buttons), and a header that breaks at 320 px.

## 2. Extras

### 2a. Top tasks
| Task | Device | Steps (taps) | Decisions | Typing | Time to answer | Friction | Drop-off risk |
|---|---|---|---|---|---|---|---|
| 1. Where can I go in 4 h? | phone | 2 (a popular chip, "4h") or 3 (search, pick, "4h") | 2 | 0–4 letters | immediate once stations load (~2 s) | the list starts below the ride controls; scroll the sheet | Low |
| 2. A place: next train, what's there | phone, from the list | 1 tap + 1 drag | 1 | 0 | immediate | the next train sits below a 236 px photo (06-place-375) | Med |
| 2b. Same, from a shared link | phone, 4G | 0 | 0 | 0 | 8–12 s behind a full-screen loading card | nothing to look at while waiting | **High** |
| 3. A hill town without a station | phone | 1 (Munnar chip) + start: type, pick | 2 | 3–6 letters | immediate | the ways list is under the summary and weather (fixed order: badge names the station now) | Low |
| 4. A trip with three stops | laptop | 1 + 3 × (type, Enter) + nights | 4+ | 3 names | immediate | Ooty shows as "Udhagamandalam" | Low |
| 5. A story | any | 2 (compass, card) | 1 | 0 | 48–104 ms on a slowed phone (1.7 s once in the baseline, during the route download) | none | Low |
| 6. Save or share a place | any | 1 | 0 | 0 | instant (toast) | the save-route bookmark is a 20 px target | Low |

### 2b. Nielsen's heuristics (1–5)
| Heuristic | Score | Example | Fix |
|---|---|---|---|
| Visibility of system status | 3 | Deep links show only a loading bar for 8–12 s | Draw the view at once, loading pill in the corner (ENG-01) |
| Match with the real world | 4 | Tickets, station boards, "Hop on/off"; NTES now glossed | Keep |
| User control and freedom | 4 | Every view has an address; Back works; "Clear it all" | Keep |
| Consistency and standards | 3 | Saved/Stories/Weather now one name each; targets and states vary | Tokens, target sizes (UI-04, UI-06) |
| Error prevention | 3 | Fuzzy search; but Shimla's way in says only "by road" | Name the toy train (UX-05) |
| Recognition rather than recall | 4 | Last station remembered as a chip; popular starts | Keep |
| Flexibility and efficiency | 4 | Keyboard search, filters in the URL, Surprise me | Keep |
| Aesthetic and minimalist design | 4 | One thing at a time; phone place hierarchy off | UI-01 |
| Recover from errors | 4 | Unknown links now explained on the page (CW-37/38) | Keep |
| Help and documentation | 3 | About explains what it is; nothing explains the sheet | Grip hit area and "Show more" label (UX-03) |

### 2c. Targets under 44 px on a 375 px phone (scripts/ux-check.mjs)
grip 96×20 · icon-btn ×5 36×36 · field-btn 38×38 · "use where I am" 211×22 · popular pills 40 px
tall · hill chips 37 px tall · "Search it →" 288×21 · ride steps 53×36 · lens chips 34 px tall ·
"Show all" 331×21 · "Fine-tune" 75×21 · back 33 px tall · round ×2 36×36 · **tk-save 20×20** ·
tk-change 73×20 · place tabs 36 px tall · stop folds 98×29 · month buttons 25×76 · trip arrows
30×30 · discover chips 37 px · fact prev/next 21 px · way links 20 px · map Weather 106×38.

## 3. Findings

| ID | Expert | Location (page/component/file:line) | Issue + evidence | Principle/source | Severity | Fix |
|---|---|---|---|---|---|---|
| UX-01 | UX | Deep links: main.ts `await ready` before `applyRoute`; style.css `html[data-deep] .loading` | A shared place link shows a full-screen loading card until all ~1.9 MB of timetable has arrived: LCP 10.7 s (place), 12.9 s (Discover) on mobile | System status; perceived performance | Critical | Draw the view into the page at build time (photo, name, where, intro, when to go), loading pill in the corner; the app replaces it in place (ENG-01) |
| UX-02 | UX | Place on phones (06-place-375) | The answer to task 2 (the next train) is below the fold under the photo | Hierarchy; Fitts | High | Smaller arch on phones (UI-01) |
| UX-03 | UX | Small targets (2c) | 24 targets under 44 px; tk-save 20×20 is under WCAG 2.5.8's 24 px | Fitts; WCAG 2.5.8 | High | Hit areas ≥44 px via ::after; tk-save 36 px; grip 44 px tall |
| UX-04 | UX | Header at 320 px | About button cut off (UI-03) | Responsive | High | UI-03 |
| UX-05 | UX | Hills lens note, app.ts:1672 (`via`) | Shimla shows "Train to Kalka, then 2h 45m by road": the toy train, the famous way up, isn't mentioned | Match with the real world | Med | When a toy train links the station and the place: "Train to Kalka, then the toy train, or 2h 45m by road" |
| UX-06 | UX | The ending: train view footer (panel.ts trainHtml) | After finding the train there's no next step but a source line; booking is the natural next action | Peak-end rule | Med | A row of clear links at the end of a train: "Book on IRCTC ↗", "Live status on NTES ↗" |
| UX-07 | UX | iOS zoom on `#gh-input`, `#trip-input` (15 px) | The page zooms in when a phone user taps the box | Platform | Med | 16 px (UI-10) |
| UX-08 | UX | Story open, perf baseline | 1,728 ms once; re-measured 48 and 104 ms (scripts/inp-one.mjs). The slow one overlapped the route-geometry download | INP | Low | Re-measure after ENG-03; nothing to change if it stays under 200 ms |
| UX-09 | UX | Trip stop names | "Udhagamandalam" in the trip and on the map, "Ooty" in the hills list and stories | Consistency | Low | Show the guide's name with the station's in brackets when they differ: "Ooty (Udhagamandalam)" |
