# Patri (पटरी)

Pick where you are, and see every place in India a train can take you without changing trains.
Pick a place to see what it's known for and which trains go there. Pick a train to see its stops.
No booking and no live running status, just the timetable.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (deep link: /#bengaluru, /#mumbai, /#HPT)
npm run build      # static site in dist/
```

## How it's put together

```
pipeline/                     Python, run offline; writes public/data/*.json
  build_network.py            timetable + stations  -> network.json
  build_places.py             Wikivoyage guides     -> places.json
  cities.json                 hand-curated multi-station cities (Bengaluru = SBC, YPR, BNC, KJM, …)
public/data/                  what the browser loads (network 1.5 MB gzipped, places 0.2 MB)
src/
  data.ts                     loads the network; "where can I go from here?" queries and filters
  map.ts                      canvas atlas: projection, zoom, route ink-out, timetable time-lapse
  main.ts                     station board/search, filters, destination and train panels
  style.css                   the look
```

The web app only depends on the shape of `network.json`. To use a newer timetable, change
`build_network.py`, not the frontend.

## Data and licences

| What | Source | Licence | Notes |
|---|---|---|---|
| Timetable (halts, times, distances) | Indian Railways timetable on [data.gov.in](https://www.data.gov.in/catalog/indian-railways-train-time-table), Dec 2017 ([mirror](https://github.com/itzmeanjan/indian-railway)) | GODL-India | **Source of truth.** 11,113 trains; 4,366 suburban locals dropped |
| Train names, types, track path between halts | [datameet/railways](https://github.com/datameet/railways), Aug 2016 | CC0 | Only used to fill gaps |
| Station positions, names in Indian scripts | OpenStreetMap via Overpass | ODbL | Attribution required |
| India outline | [datameet/maps](https://github.com/datameet/maps) `india-composite` (Survey of India boundary) | CC0 | |
| State borders | datameet/maps `States/Admin2` | see repo | |
| What to see and do | [Wikivoyage](https://en.wikivoyage.org) (matched to stations via Wikidata) | CC BY-SA 4.0 | Share-alike: guide text stays CC BY-SA |
| Photos | Wikimedia Commons (hotlinked) | per file | |

To rebuild the data, download the raw files into a folder (see the docstrings at the top of
each script) and run:

```bash
python3 pipeline/build_network.py <raw-dir>
python3 pipeline/build_places.py <raw-dir>
```

## Known limits of the prototype data

- **The timetable is from December 2017.** Trains introduced since then are missing, including
  every Vande Bharat and Amrit Bharat. So are renamed or new stations such as SMVT Bengaluru and
  Prayagraj (PRYJ). Times have changed on many trains.
- **Running days are missing.** The time-lapse and the "next 2 h" filter treat every train as
  daily.
- About 320 stations have no known position. Their trains still list them, but they don't appear
  on the map.

## Next steps

1. Get a current timetable: a paid API synced into this same `network.json` shape (RailRadar,
   indianrailapi.com, …), with running days, and check its terms allow storing the data.
2. Draw lines along the real OSM tracks instead of straight chords between stations.
3. "Trains between two places" and "within X hours" isochrone views.
