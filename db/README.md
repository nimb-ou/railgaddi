# Railgaddi's timetable database

Plain CSV files, one fact per row, so every change is a readable diff and anyone can fix a row in
a spreadsheet. `pipeline/build_network.py` turns them into what the site loads (`data/`); the site
never calls an outside service, so no API outage can break it.

| File | One row per | Columns |
|---|---|---|
| `stations.csv` | station | `code`, `name`, `state`, `lat`, `lon`, `coord` (where the position came from), `hi` (Hindi name), `local` (name in the state's language) |
| `trains.csv` | train | `number`, `name`, `type`, `days`, `days_src`, `src` |
| `halts.csv` | stop of a train | `number`, `seq` (1, 2, 3…), `station`, `arr`, `dep`, `km` (official distance from the train's origin), `approx` (`1` = times estimated) |
| `paths.csv` | stretch between two halts | `number`, `after` (halt `seq`), `via` (stations passed without stopping, for drawing the line) |
| `newer_trains.csv` | train we know runs but have no halts for | `numbers`, `name`, `type`, `from`, `to`, `days`, `per_week`, `minutes`, `km`, `stops`, `src` |
| `overrides.csv` | hand correction | `number`, `field` (`name`, `type` or `days`), `value`, `reason` |
| `station_overrides.csv` | hand correction to a station | `code`, `field` (`name`, `hi`, `local` or `state`), `value`, `reason` |
| `renames.csv` | station renamed since an older source | `old` code, `new` code, `old_name`, `since` (the source that brought the new code) |

**Times** are `HH:MM`, with `+N` for N days after the train left its origin: `23:55`, `00:05+1`.
The first halt has only a departure, the last only an arrival, and times never go backwards.

**Seasonal specials** from the 2017 timetable (numbers starting `0`, Suvidha `82…`) stay in
`trains.csv` for the record but aren't built into the site: they ran for a season in 2017.

**Days** are the days a train leaves its origin: `Daily`, or a comma list such as `Mon,Thu`. Empty
means not known. The site shifts them for halts reached after midnight.

**Sources** are named in `src` and `days_src`: `ogd2017`, `tag2026`, `wikipedia`, `override`. Importers never
overwrite an `override` or a better source.

## Correcting something

Add a row to `overrides.csv` (it wins over every importer), or edit the row directly and say
where the fact comes from in the pull request. Then:

```bash
python3 pipeline/build_network.py      # checks everything and rebuilds data/
```

It refuses rows that don't make sense (unknown stations, times going backwards, a first halt with
an arrival) and says which train is wrong.

## Where it comes from

| Importer | Source | Licence |
|---|---|---|
| `import_ogd2017.py` | Indian Railways timetable on data.gov.in (Dec 2017); datameet/railways (2016) for names, types and track paths; OpenStreetMap for station positions and names | GODL-India; CC0; ODbL |
| `import_wikipedia.py` | English Wikipedia train infoboxes: running days, newer trains | CC BY-SA 4.0 |
| `route_paths.py` | OpenStreetMap railway track: the stations a train passes between halts (`paths.csv`) | ODbL |
| `merge_tag.py` (after `import_tag.py`) | Indian Railways, *Trains at a Glance* 2026 | © Indian Railways; used on the decision recorded in `docs/permissions/tag2026.md` |

See [SOURCES.md](../SOURCES.md) for every source considered and why.

## Licence

This database is available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
(station positions and names are © OpenStreetMap contributors and require it). It contains
information from the Indian Railways timetable on data.gov.in (Government Open Data License –
India), datameet (CC0) and Wikipedia contributors (CC BY-SA 4.0). Rows whose source is `tag2026`
are Indian Railways' *Trains at a Glance* 2026 and are not covered by this licence.
