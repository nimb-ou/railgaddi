# Baseline metrics (before), 10 October 2026, production build (vite preview, localhost:4173)

## Lighthouse 12.8.2 (devtools throttling; mobile = 4x CPU + slow 4G)
| Page | Form | Perf | A11y | Best pr. | SEO | LCP | CLS | TBT | FCP | Requests | Bytes | Images |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home `/` | mobile | 78 | 100 | 100 | 100 | 1,965 ms | 0.003 | 663 ms | 1,965 ms | 46 | 1,874 KiB | 404 KiB |
| home `/` | desktop | 80 | 100 | 100 | 100 | 241 ms | 0.039 | 433 ms | 241 ms | 52 | 1,911 KiB | 442 KiB |
| place `/from/bengaluru/to/hampi/` | mobile | 37 | 100 | 79 | 100 | 10,664 ms | 0.014 | 2,797 ms | 1,762 ms | 55 | 2,429 KiB | 842 KiB |
| place | desktop | 80 | 100 | 78 | 100 | 1,187 ms | 0.004 | 376 ms | 155 ms | 86 | 2,346 KiB | 760 KiB |
| discover `/discover/` | mobile | 35 | 100 | 100 | 100 | 12,865 ms | 0.081 | 2,918 ms | 1,903 ms | 58 | 2,402 KiB | 911 KiB |
| discover | desktop | 88 | 100 | 100 | 100 | 1,014 ms | 0.022 | 270 ms | 181 ms | 61 | 2,132 KiB | 641 KiB |

## Responsiveness (scripts/perf.mjs: phone, 4x slower CPU; Event Timing input-to-paint, as INP)
See inp-phone.txt. Worst: open a story 1,728 ms; surprise me 208 ms; plan a trip 208 ms; type in
search 200 ms; open a place without a station 184 ms. Long tasks: toy-trains filter 632 ms.

## Bundles (gzip -9)
| File | Raw | Gzip |
|---|---|---|
| index.js | 299.7 kB | 100.5 kB |
| index.css | 57.5 kB | 12.4 kB |
| workbox-window.js | 5.7 kB | 2.3 kB |
| Fonts (17 woff2, mostly Indic scripts, loaded on demand) | 1.0 MB | n/a |
| Data: timetable.bin.gz 406 kB, paths.bin.gz 223 kB, meta 479 kB, trains 353 kB, places index 394 kB, spots-weather 373 kB, relief.webp 136 kB | | |

## axe-core 4.14 (WCAG 2.1 A/AA + best practice), 120 captures (20 views x 3 widths x 2 themes)
- 2 rules, 238 nodes: `region` (moderate) 210 nodes in 120 views (#map canvas, .zoom outside
  landmarks); `label-content-name-mismatch` (serious) 28 nodes in 6 views (month buttons in
  When to go, "earlier stops" fold buttons in the train view).
- Lighthouse a11y: 100 on all six.

## Console errors
None in 120 captures (report.json).

## Request count and weight
See the Lighthouse table: 46-86 requests, 1.9-2.4 MiB per first visit (most of it timetable data).
