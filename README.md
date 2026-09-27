# Railgaddi (रेलगाड़ी)

Pick your station and see every place in India a train can take you without changing. The best
of them float on the map as photo bubbles; open one to see what it looks like, what to see there,
and every train that goes. No booking and no live running status: the timetable, and the country
it opens up.

The look follows one idea, the journey itself: station boards name places, coach livery colours
the lines, and timetables, tickets and route strips carry the facts. See [DESIGN.md](DESIGN.md).

- **Fast.** One request per data file, content-hashed and cached forever; the whole timetable is
  a binary file of about 300 kB compressed. Works offline once visited, and installs as an app.
- **Shareable.** Every view has an address (`/from/bengaluru/to/hampi/`), and the build writes a
  real page for ~3,000 of them with their own title, description and photo for link previews and
  search engines.
- **Free to run.** A static site: no server, no database, no accounts, no tracking.

## Run it

Needs Node 20+ (`.nvmrc`) and, only to rebuild the data, Python 3.10+.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # core logic against the real data
npm run build        # dist/: the app + prerendered pages + sitemap
```

## How it's put together

```
data/                  the published data, written by pipeline/ (see ARCHITECTURE.md for formats)
pipeline/              Python, run offline: raw sources -> data/
src/
  core/                pure logic, no DOM: timetable decoding, trips, places, search, addresses
  map/map.ts           the canvas map: projection, zoom, routes, photo bubbles, moving trains
  ui/                  DOM pieces: panel, list, search, dock, chrome, photos, offline, styles
  app/                 the controller (state, history, panel) and the router
  main.ts              boot: fetch, decode, wire up
scripts/
  prerender.ts         after `vite build`: per-view pages, sitemap.xml, robots.txt
  make-icons.mjs       app icons and the link-preview image, rendered with Chrome
  shot.mjs             screenshot any view (design review)
test/                  vitest
```

[ARCHITECTURE.md](ARCHITECTURE.md) explains the data flow and file formats;
[DEPLOY.md](DEPLOY.md) covers hosting and connecting a domain.

## Data and licences

| What | Source | Licence |
|---|---|---|
| Timetable (halts, times, distances) | Indian Railways timetable on [data.gov.in](https://www.data.gov.in/catalog/indian-railways-train-time-table), Dec 2017. 6,746 trains after dropping suburban locals | GODL-India |
| Train names, types, track path between halts | [datameet/railways](https://github.com/datameet/railways), Aug 2016 | CC0 |
| Station positions, names in Indian scripts | OpenStreetMap via Overpass | ODbL |
| India outline, state borders | [datameet/maps](https://github.com/datameet/maps) (Survey of India boundary) | CC0 |
| Travel guides: intro, See / Do listings | [Wikivoyage](https://en.wikivoyage.org), matched to stations via Wikidata | CC BY-SA 4.0 |
| Landmarks | [Wikidata](https://www.wikidata.org) (heritage sites, temples, forts, falls, parks…) | CC0 |
| Photos | Wikimedia Commons, hotlinked; each credit links to the file page with author and licence | per file |
| Fonts | Archivo, Noto Sans (Indian scripts), self-hosted via Fontsource | SIL OFL 1.1 |

### Rebuilding the data

```bash
pipeline/fetch_raw.sh raw                      # raw sources into raw/ (git-ignored)
python3 pipeline/fetch_landmarks.py raw        # Wikidata landmarks (slow: 1 query a minute)
python3 pipeline/build_network.py raw          # -> data/meta.json, timetable.bin, paths.bin
python3 pipeline/build_places.py raw           # -> data/places/; fetches what isn't cached
python3 pipeline/build_places.py raw --quick   # never calls an API; builds from the cache
```

Every Wikimedia response is cached in `raw/wv-cache`, so re-runs only ask for what is new.

## Known limits

- **The timetable is from December 2017.** Newer trains are missing (every Vande Bharat and
  Amrit Bharat), as are renamed stations such as SMVT Bengaluru, and many times have changed.
  The site says so and links to NTES.
- **Running days are missing**, so "next 2 h" treats every train as daily.
- About 160 stations have no known position; their trains list them, but they aren't drawn.

## Next

1. A current timetable with running days, from a licensed API (e.g. RailRadar), written into the
   same `data/` formats so nothing in the app changes.
2. Trips with one change, and "trains between two places".
3. A detailed base map when zoomed in to a town.
