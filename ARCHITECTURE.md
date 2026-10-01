# Architecture

Railgaddi is a static site. Everything a visitor needs is a set of files built ahead of time, so it
can sit on any CDN, scale to any traffic for free, and keep working offline.

```
sources ──importers──▶ db/ (CSV, reviewed) ──build_network.py──▶ data/ ──vite build──▶ dist/ ──▶ CDN ──▶ browser
                                                                   └──prerender.ts──▶ dist/**/index.html, sitemap.xml
```

`db/` is Railgaddi's own timetable database: plain CSV, one fact per row, each with its source
(see [db/README.md](db/README.md) and [SOURCES.md](SOURCES.md)). Importers (`pipeline/import_*.py`)
bring sources into it; `build_network.py` validates it and writes the binary files the site loads.
The build needs nothing but `db/`, so it runs in CI and gives the same bytes every time
(`--check` fails the build if `data/` has drifted). The site never calls an outside API.

## In the browser

`main.ts` starts in two steps. First the stations, the guides' index, the map outline and the
places without a station arrive (in parallel) and the app starts: the landing page, the map and
the search work with these alone. The timetable and the trains' names come next, at a lower
priority (`decodeStations`, then `applyTimetable`). An address with trains in it (`/from/…`, a
trip, Discover) waits for both; on the landing page, picking a station before the timetable is in
says "Loading the timetable…" and carries on when it lands (`App.whenReady`). On a phone on slow
4G that has the landing page ready in about 3 s instead of 6. The track geometry follows a moment
later and the lines re-draw along the real track.

| File | Raw | Gzip | When |
|---|---|---|---|
| `meta.json`: stations, cities, renamed stations | 479 kB | 157 kB | first |
| `places/index.json`: which place has a guide, its photos | 368 kB | ~100 kB | first |
| `spots.json`: towns without a station, their roads, airports | ~200 kB | ~60 kB | first |
| `timetable.bin`: every halt of every train | 1.3 MB | 397 kB | next (first, for an address with trains) |
| `trains.json`: each train's number, name and source; newer trains | 352 kB | ~65 kB | with the timetable |
| `paths.bin`: stations passed between halts | 819 kB | 218 kB | after first paint |
| `places/NN.json` ×32: intros and sights | ~40 kB | ~10 kB | when a place opens |

`scripts/boot.mjs` measures a cold first visit on a throttled phone (Slow or Fast 4G, CPU ×4).

The two binary files ship gzipped too (`scripts/compress-data.mjs`, run before every build):
hosts compress JSON on the fly, but not always binary files (Cloudflare doesn't by default), so
the app fetches the `.gz` copies and unpacks them itself (`DecompressionStream`). The map draws
only when something changes (view, selection, a photo arriving, a short fade), so a still map
costs no CPU. The land, the faint network and the weather layer are a separate canvas under the
map, moved as a picture while you pan or pinch and redrawn crisp when the view settles; labels
are drawn once into small images and copied; station dots are gathered into a few paths. The
offline copy is fetched once the page and its photos are in, never alongside them.

A few things come from outside, only when you ask: the weather (Open-Meteo: a place's week when
you open it; about 200 points for the map layer, blended smoothly between them on the land), a
town not in `spots.json` (Open-Meteo's place search, once you pause typing), and a town's summary
and photo (Wikipedia). Answers are kept for half an hour.

Road distances from a place without a station to the stations near it are real for the places
people look up (about 1,300: the famous ones, towns of 20,000 and more, hill towns of 5,000 and
more): `pipeline/fetch_roads.py` asks an OSRM router (OpenStreetMap data) once, and
`build_spots.py` writes the answers into `spots.json`. Times by road are the router's, allowing a
third more for traffic and ghats. Anywhere else, the road is estimated from the straight line.

Every file name carries a content hash, so the CDN and browsers can cache it for a year and a new
timetable is picked up the moment the HTML points at new names. The service worker precaches all
of it after the first visit, so the whole country works offline; photos are cached as they're seen.

### Layers

- **`core/`**: pure functions over typed arrays, no DOM. Decoding (`network.ts`), "where can I go
  from here" (`trips.ts`), guides and shards (`places.ts`), ranking photo bubbles (`rank.ts`),
  search (`search.ts`), addresses (`slugs.ts`), places without a station and the stations and
  roads to them (`spots.ts`), trips with several stops (`tripplan.ts`: for each stretch the train
  that runs that day and arrives first, a change, or the road), weather (`weather.ts`). Tested in Node against the real data, and reused
  by the prerender script.
- **`map/`**: one canvas over a land layer, redrawn on demand: d3 projection and zoom, routes
  coloured by ride time, photos laid out to avoid each other and the panel, a train's or a
  trip's route, the roads to a place without a station, and the weather.
- **`ui/`**: HTML templates and small widgets. Templates are pure functions returning strings with
  every value escaped; interaction is event delegation on `[data-act]`, so there are no inline
  handlers (compatible with a strict Content Security Policy).
  `home.ts` (home, and the places from where you start), `spot.ts`, `trip.ts` and `weather.ts`
  are the new views; `poster.ts` draws the share poster on a canvas, in the browser.
- **`app/`**: the controller holds the state (explore or trip, origin, filters, what's open, the
  trip), keeps the address bar in sync (`router.ts`), and moves focus for keyboard and
  screen-reader users.

### Addresses

```
/                                  landing
/from/bengaluru/                   everywhere you can go from Bengaluru
/from/bengaluru/to/hampi/          one place and the trains that go there
/from/bengaluru/to/mysuru/12007/   one train's stops
/to/hampi/                         a place, before choosing where you start
/to/munnar/                        a place without a station (?at=32.01,77.32 for one found online)
/trip/?stops=bengaluru,hampi,goa&nights=0,2,3&date=2026-10-09   a trip
?within=360&leave=2h&trains=toy    filters (trains: long, local, toy)
```

Cities keep their ids as slugs; stations get a slug of their name, and the busier of two stations
with the same name keeps the plain one. Back and forward restore each view.

## Data formats

Written by `pipeline/build_network.py`, read by `src/core/network.ts`. All integers little-endian.

### `timetable.bin`: "RGTT" version 4

```
char[4]  "RGTT"
u32      version = 4
u32      T  trains
u32      H  halts (all trains)
u32[T]   first halt of each train (index into the halt columns)
u16[H]   station index
u16[H]   arrival delta     first halt: unused; else minutes after the previous departure
u16[H]   departure delta   minutes after this halt's arrival (first halt: absolute, from 00:00)
u16[H]   distance delta    official km since the previous halt (first halt: km from the origin)
u8[T]    train type index (into meta.types)
u8[T]    running days: days the train leaves its origin, bit 0 = Monday … bit 6 = Sunday; 0 = unknown
u8[H]    per halt: bit 0 = times estimated (a small stop kept from an older timetable, shown with ~)
```

Running days shift by one for each midnight a train passes before a halt, so "next train" and the
"leaving in 2 h" filter check the day the train actually leaves *your* station.

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

## Accounts

`worker/index.ts` is the Cloudflare Worker that also serves the static files. Only `/api/*`
runs code (`run_worker_first`); everything else is a static asset as before. The API checks a
Google ID token once (`worker/auth.ts`: RS256 against Google's keys, issuer, audience, expiry),
then keeps a session in an HMAC-signed HttpOnly cookie. Saves live in D1 (`worker/schema.sql`),
one row per saved place or route, merged per item by time (`src/core/saves.ts`, shared with the
browser). Without a database or client id, `/api/config` says so and the site keeps saves on the
device. Setup: [docs/accounts.md](docs/accounts.md).

## Discover

`content/discover.json` holds the journeys and facts, written for Railgaddi with a source for
each. `pipeline/build_discover.py` checks every station code and train against the timetable,
adds each story's photo and credit from Commons, and writes `data/discover.json` (35 kB), which
the app fetches when idle. Facts that name a station also appear on that place's panel. The
records ("By the numbers") are computed in the browser from the timetable (`src/core/numbers.ts`),
so they always match it, and double as a check on the data: an absurd record is a data error.

## Prerendered pages

`scripts/prerender.ts` loads the same data with the same `core/` code and writes an `index.html`
per view worth finding on its own: every origin, every place with a guide, and the top 30
destinations from each of the 45 big cities (~3,000 pages). Each has its own title, description,
canonical address, preview photo, JSON-LD, and a `<noscript>` article with the same facts as
linked text. The app boots on each exactly as on `/`.

## Quality gates

- `npm run typecheck`: strict TypeScript across the app, scripts and tests.
- `python3 pipeline/build_network.py --check`: every row of `db/` makes sense (known stations,
  times running forward, a departure at the first halt and an arrival at the last) and `data/`
  is exactly what `db/` builds.
- `npm test`: the timetable decodes and runs forward in time at every halt, trips are sane,
  running days shift correctly past midnight, every place has a unique address that leads back
  to it, shard hashing matches Python.
- CI runs all of these plus a full build on every pull request; `main` deploys only if they pass.
- Data refreshes arrive as pull requests (`data-refresh.yml`), never straight to the live site.
