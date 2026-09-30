# Railgaddi (रेलगाड़ी)

Pick your station and see every place in India a train can take you without changing. The best
of them float on the map as photo bubbles; open one to see what it looks like, what to see there,
and every train that goes. No booking and no live running status: the timetable, and the country
it opens up.

The look follows one idea, the journey itself: station boards name places, coach livery colours
the lines, and timetables, tickets and route strips carry the facts. See [DESIGN.md](DESIGN.md).

- **Direct trains, and journeys with one change.** Where no train runs straight between two
  places (Bengaluru to Amritsar), the quickest ways with one change, with running days honoured
  and time to change trains.
- **Search** by city, station, code, famous place ("Hampi" finds Hosapete), train number or train
  name.
- **Your trips.** A bucket list of places and saved routes, on the device; sign in with Google to
  keep them everywhere ([docs/accounts.md](docs/accounts.md)).
- **Discover.** Journeys worth taking, facts about India's railways (each sourced), and records
  from the timetable.
- **Fast.** One request per data file, content-hashed and cached forever; the whole timetable is
  a binary file of about 300 kB compressed. Works offline once visited, and installs as an app.
- **Shareable.** Every view has an address (`/from/bengaluru/to/hampi/`), and the build writes a
  real page for ~3,000 of them with their own title, description and photo for link previews and
  search engines.
- **Free to run.** Static files on a CDN, plus a small Cloudflare Worker and database for
  accounts only; no analytics, no tracking.

## Run it

Needs Node 22 (`.nvmrc`; 20+ works) and, only to rebuild the data, Python 3.10+.

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
  ui/                  DOM pieces: panel, list, search, dock, discover, saved, poster, boards, styles
  app/                 the controller (state, history, panel), the router, saves and sign-in
worker/                the Cloudflare Worker: static files, and the accounts API (/api/)
content/discover.json  Discover's journeys and facts, written for Railgaddi, with sources
  main.ts              boot: fetch, decode, wire up
scripts/
  prerender.ts         after `vite build`: per-view pages, sitemap.xml, robots.txt
  make-icons.mjs       app icons and the link-preview image, rendered with Chrome
  shot.mjs             screenshot any view (design review)
  qa.mjs               walk the site on a desktop and a phone; report console errors
test/                  vitest
```

[ARCHITECTURE.md](ARCHITECTURE.md) explains the data flow and file formats;
[DEPLOY.md](DEPLOY.md) covers hosting and connecting a domain.

## Data and licences

| What | Source | Licence |
|---|---|---|
| Timetable, 2,665 trains (halts, times, distances, running days) | Indian Railways, *Trains at a Glance* 2026 (Railway Board). Permission to be requested before launch: [docs/permissions/tag2026.md](docs/permissions/tag2026.md) | © Indian Railways |
| Timetable, the other 4,593 trains (mostly passenger and local) | Indian Railways timetable on [data.gov.in](https://www.data.gov.in/catalog/indian-railways-train-time-table), Dec 2017 | GODL-India |
| Running days (the rest), trains introduced since | [Wikipedia](https://en.wikipedia.org) train articles (~1,750), checked against our end stations | CC BY-SA 4.0 |
| Train names, types, track path between halts | [datameet/railways](https://github.com/datameet/railways), Aug 2016 | CC0 |
| Station positions, names in Indian scripts | OpenStreetMap via Overpass | ODbL |
| India outline, state borders | [datameet/maps](https://github.com/datameet/maps) (Survey of India boundary) | CC0 |
| Travel guides: intro, See / Do listings | [Wikivoyage](https://en.wikivoyage.org), matched to stations via Wikidata | CC BY-SA 4.0 |
| Landmarks | [Wikidata](https://www.wikidata.org) (heritage sites, temples, forts, falls, parks…) | CC0 |
| Photos | Wikimedia Commons, hotlinked; each credit links to the file page with author and licence | per file |
| Fonts | Archivo, Noto Sans (Indian scripts), self-hosted via Fontsource | SIL OFL 1.1 |

### The timetable database

The timetable lives in [`db/`](db/README.md) as plain CSV that anyone can review or correct.
Nothing on the site calls an outside API. [SOURCES.md](SOURCES.md) explains every source
considered, and why the site uses the ones it does.

```bash
python3 pipeline/build_network.py              # db/ -> data/meta.json, timetable.bin, paths.bin
python3 pipeline/import_wikipedia.py raw       # running days and newer trains (monthly in CI)
python3 pipeline/import_ogd2017.py raw         # rebuild db/'s base from the 2017 sources (rarely)
python3 pipeline/fetch_osm_rail.py raw         # India's railway track from OpenStreetMap (slow, cached)
python3 pipeline/route_paths.py raw            # lines follow that track where db/ had straight stretches
```

The official 2026 timetable is read from the Railway Board's PDFs (`fetch_tag.sh`,
`import_tag.py`, which checks every train, then `merge_tag.py`). `merge_tag.py` only writes to
`db/` once a decision to use that edition is on record in `docs/permissions/`; the 2026 one says
how to undo it if permission is refused ([docs/permission-requests.md](docs/permission-requests.md)).

### Places and photos

```bash
pipeline/fetch_raw.sh raw                      # raw sources into raw/ (git-ignored)
python3 pipeline/fetch_landmarks.py raw        # Wikidata landmarks (slow: 1 query a minute)
python3 pipeline/build_places.py raw           # -> data/places/; fetches what isn't cached
python3 pipeline/build_places.py raw --quick   # never calls an API; builds from the cache
```

Every Wikimedia response is cached in `raw/`, so re-runs only ask for what is new.

## Known limits

- **2,665 trains are on the 2026 timetable; 4,593 still have 2017 times.** The book prints
  principal halts only and about 650 of its trains couldn't be read with full confidence; those,
  and the passenger and local trains it doesn't cover, keep their 2017 times. Small stops the book
  leaves out are kept from 2017 at estimated times, marked "~". The site says where each train's
  times come from and links to NTES.
- **Running days** are known for 2,949 trains; the rest are treated as daily.
- **Trains the 2026 book doesn't list.** 98 trains of the older timetable were renumbered and
  appear under their new number, so the old copies are left out; 22 more were renumbered
  without readable 2026 times and keep their 2017 stops under the new number. 257 match nothing
  in the book (withdrawn, or rerouted too much to tell): they stay, and their page says so.
- **150 trains** known from Wikipedia are listed between their end stations but aren't on the
  map, because their halts and times aren't in either timetable.
- About 160 stations have no known position; their trains list them, but they aren't drawn.

## Next

1. Indian Railways' permission for *Trains at a Glance* (drafts in
   [docs/permission-requests.md](docs/permission-requests.md)), then import it each year.
2. Trips with one change, and "trains between two places".
3. A detailed base map when zoomed in to a town.
