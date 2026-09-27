# Architecture

Railgaddi is a static site. Everything a visitor needs is a set of files built ahead of time, so it
can sit on any CDN, scale to any traffic for free, and keep working offline.

```
raw sources ──pipeline/ (Python)──▶ data/ ──vite build──▶ dist/assets (hashed) ──▶ CDN ──▶ browser
                                        └──scripts/prerender.ts──▶ dist/**/index.html, sitemap.xml
```

## In the browser

`main.ts` fetches four files in parallel, decodes them, and starts the app. The map is drawn as
soon as they arrive; the track geometry follows a moment later and the lines re-draw along the
real track.

| File | Raw | Brotli | When |
|---|---|---|---|
| `meta.json`: stations, cities, train names | 741 kB | 179 kB | first paint |
| `timetable.bin`: every halt of every train | 1.1 MB | 296 kB | first paint |
| `places/index.json`: which place has a guide, its photos | 373 kB | 76 kB | first paint |
| `paths.bin`: stations passed between halts | 763 kB | 80 kB | after first paint |
| `places/NN.json` ×32: intros and sights | ~40 kB | ~10 kB | when a place opens |

Every file name carries a content hash, so the CDN and browsers can cache it for a year and a new
timetable is picked up the moment the HTML points at new names. The service worker precaches all
of it after the first visit, so the whole country works offline; photos are cached as they're seen.

### Layers

- **`core/`**: pure functions over typed arrays, no DOM. Decoding (`network.ts`), "where can I go
  from here" (`trips.ts`), guides and shards (`places.ts`), ranking photo bubbles (`rank.ts`),
  search (`search.ts`), addresses (`slugs.ts`). Tested in Node against the real data, and reused
  by the prerender script.
- **`map/`**: one canvas, redrawn on demand: d3 projection and zoom, routes coloured by ride time,
  photo bubbles laid out to avoid each other and the UI, trains moving on the timetable clock.
- **`ui/`**: HTML templates and small widgets. Templates are pure functions returning strings with
  every value escaped; interaction is event delegation on `[data-act]`, so there are no inline
  handlers (compatible with a strict Content Security Policy).
- **`app/`**: the controller holds the state (origin, filters, what's open), keeps the address bar
  in sync (`router.ts`), and moves focus for keyboard and screen-reader users.

### Addresses

```
/                                  landing
/from/bengaluru/                   everywhere you can go from Bengaluru
/from/bengaluru/to/hampi/          one place and the trains that go there
/from/bengaluru/to/mysuru/12007/   one train's stops
/to/hampi/                         a place, before choosing where you start
?within=360&leave=2h               filters
```

Cities keep their ids as slugs; stations get a slug of their name, and the busier of two stations
with the same name keeps the plain one. Back and forward restore each view.

## Data formats

Written by `pipeline/build_network.py`, read by `src/core/network.ts`. All integers little-endian.

### `timetable.bin`: "RGTT" version 2

```
char[4]  "RGTT"
u32      version = 2
u32      T  trains
u32      H  halts (all trains)
u32[T]   first halt of each train (index into the halt columns)
u16[H]   station index
u16[H]   arrival delta     first halt: unused; else minutes after the previous departure
u16[H]   departure delta   minutes after this halt's arrival (first halt: absolute, from 00:00)
u16[H]   distance delta    official km since the previous halt (first halt: km from the origin)
u8[T]    train type index (into meta.types)
```

Deltas are taken mod 2¹⁶ and decoded as running sums, so times run past midnight across days
(minute 1,500 is 01:00 on day 2). The last halt has no departure. The pipeline decodes its own
output and checks every train before writing.

### `paths.bin`: "RGTP" version 1

```
char[4]  "RGTP"
u32      version = 1
u32      H  halts (same order as timetable.bin)
u32      P  pass points
u16[H]   stations passed between halt h and h+1
u16[P]   those stations, in order
```

### `places/`

`index.json` maps station codes and city ids to Wikivoyage guide titles, and holds each guide's
bubble photo, banner, position and an "appeal" score. Each guide's intro and sights live in shard
`fnv1a(title) % 32`, computed identically in Python and TypeScript (a test pins the two together).
Photos are stored as Commons thumbnail paths; the app asks for the width the screen needs
(`ui/photos.ts`), never more than the original.

## Prerendered pages

`scripts/prerender.ts` loads the same data with the same `core/` code and writes an `index.html`
per view worth finding on its own: every origin, every place with a guide, and the top 30
destinations from each of the 45 big cities (~3,000 pages). Each has its own title, description,
canonical address, preview photo, JSON-LD, and a `<noscript>` article with the same facts as
linked text. The app boots on each exactly as on `/`.

## Quality gates

- `npm run typecheck`: strict TypeScript across the app, scripts and tests.
- `npm test`: the timetable decodes and runs forward in time at every halt, trips are sane,
  every place has a unique address that leads back to it, shard hashing matches Python.
- CI runs both plus a full build on every pull request; `main` deploys only if they pass.
