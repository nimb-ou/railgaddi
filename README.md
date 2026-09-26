# Patri (पटरी)

Pick where you are, and see every place in India a train can take you without changing trains.
The best of them float on the map as photo bubbles. Open one to see what it looks like, what to
see there, and every train that goes. No booking and no live running status, just the timetable.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (deep link: /#bengaluru, /#mumbai, /#HPT)
npm run build      # static site in dist/
```

## How it's put together

```
pipeline/                     Python, run offline; writes public/data/*.json
  fetch_raw.sh                downloads the raw sources into raw/ (git-ignored)
  fetch_landmarks.py          photographed landmarks in India, from the Wikidata Query Service
  build_network.py            timetable + stations  -> network.json
  build_places.py             guides, sights, photos -> places.json
  cities.json                 hand-curated multi-station cities (Bengaluru = SBC, YPR, BNC, KJM, …)
public/data/                  what the browser loads
src/
  data.ts                     loads the network; "where can I go from here?" queries, filters, guide index
  map.ts                      canvas atlas: projection, zoom, routes coloured by travel time,
                              photo bubbles (layout, pop-in, tethers), sight pins, timetable time-lapse
  panel.ts                    place panel (photo, facts, sights gallery, trains) and train stops
  photos.ts                   Wikimedia thumbnail sizes, image cache, credits
  theme.ts                    Dusk / Daylight / Monsoon palettes
  main.ts                     wiring: search, dock, bubbles, panel, layout insets
  style.css                   the look; every palette is a block of CSS variables
```

The web app only depends on the shape of the JSON files. To use a newer timetable, change
`build_network.py`, not the frontend.

## Data and licences

| What | Source | Licence |
|---|---|---|
| Timetable (halts, times, distances) | Indian Railways timetable on [data.gov.in](https://www.data.gov.in/catalog/indian-railways-train-time-table), Dec 2017 ([mirror](https://github.com/itzmeanjan/indian-railway)). 11,113 trains; 4,366 suburban locals dropped | GODL-India |
| Train names, types, track path between halts | [datameet/railways](https://github.com/datameet/railways), Aug 2016 | CC0 |
| Station positions, names in Indian scripts | OpenStreetMap via Overpass | ODbL |
| India outline, state borders | [datameet/maps](https://github.com/datameet/maps) (Survey of India boundary) | CC0 |
| Travel guides: intro, See / Do listings | [Wikivoyage](https://en.wikivoyage.org), matched to stations via Wikidata | CC BY-SA 4.0 |
| Landmarks and place photos | [Wikidata](https://www.wikidata.org) (P18 photo, P948 banner, heritage sites) | CC0 |
| Photos | Wikimedia Commons, hotlinked; each credit links to the file page with author and licence | per file |

### Rebuilding the data

```bash
pipeline/fetch_raw.sh raw
python3 pipeline/fetch_landmarks.py raw
python3 pipeline/build_network.py raw
python3 pipeline/build_places.py raw          # fetches what isn't cached yet (slow: see below)
python3 pipeline/build_places.py raw --quick  # never calls an API; builds from the cache
```

Every Wikimedia response is cached in `raw/wv-cache` and indexed by title, item and file, so re-runs
only ask for what is new. Wikimedia throttles clients that don't identify themselves (HTTP 429). Put a
contact address in `UA` at the top of `build_places.py` for much faster fetching.

## Known limits of the prototype

- **The timetable is from December 2017.** Trains introduced since then are missing (every Vande
  Bharat and Amrit Bharat), as are renamed stations such as SMVT Bengaluru. Times have changed on
  many trains.
- **Running days are missing.** The time-lapse and the "next 2 h" filter treat every train as daily.
- About 160 stations have no known position. Their trains list them, but they aren't on the map.
- Zoomed in to a town's sights, the map has no streets or water, just the sights.

## Next steps

1. A current timetable: a paid API synced into this same `network.json` shape (RailRadar,
   indianrailapi.com, …), with running days. Check its terms allow storing the data.
2. A detailed base map when zoomed in close.
3. "Trains between two places" and trip planning with one change.
