# Timetable sources

Where a current Indian Railways timetable can come from, what each option costs and risks, and
why Railgaddi is built the way it is. Researched September 2026; check again before relying on it.

## The short version

There is no current, openly licensed, machine-readable timetable for Indian Railways. The data
exists and is published, but reusing it needs Indian Railways' written permission. So Railgaddi:

1. **Owns its database** (`db/`, plain CSV) and never calls an outside service at runtime. If a
   source disappears, the site keeps working on the last good data.
2. **Uses only sources it's allowed to use:** the 2017 timetable Indian Railways released as open
   data, and Wikipedia for running days and newer trains.
3. **Is asking for permission** to use the official 2026 timetable (drafts in
   [docs/permission-requests.md](docs/permission-requests.md)). The importer for it is already
   built and tested on a copy of the database (2,130 trains pass every check), so a yes turns into
   an update the same day, and every January after.

## Official sources

| Source | What | Current? | Can we use it? |
|---|---|---|---|
| [data.gov.in: Indian Railways Train Time Table](https://www.data.gov.in/catalog/indian-railways-train-time-table) | every halt of ~11,000 trains, with times and distances; no running days | Dec 2017 is the newest file listed | **Yes.** Government Open Data License – India. *In use.* |
| [Trains at a Glance 2026](https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,537,3143) (Railway Board) | the official all-India timetable as 97 PDF tables, plus Vande Bharat, Amrit Bharat and Namo Bharat lists: ~3,500 long-distance trains with halts, times, running days and classes | in force from 1 Jan 2026; a new edition every year (46th edition) | **Not without permission.** Each edition says: "No part of the Timetable including the Train Timings should be reproduced without the written permission of the publishers." The Railway Board portal's terms also forbid copying its material. Contact given: Executive Director (Coaching), Railway Board. |
| [NTES](https://enquiry.indianrail.gov.in/mntes/) (CRIS) | every train, current schedules and running days, live status | live | **Not without permission.** Its terms forbid "regularly or systematically downloading and storing" its pages and commercial use, but say material "may be reproduced free of charge after taking proper permission" with the source acknowledged. |
| [Pravah, the CRIS API platform](https://crisapis.indianrail.gov.in/) | official APIs (train service, live station…) | live | Sign-in only; no public sign-up. Terms are written for organisations using APIs for their own purposes. Ask: pravah@cris.org.in. |
| IRCTC | booking; no public timetable API | live | No. Terms forbid automated access; CAPTCHA protected. |

## Community and commercial sources

| Source | What | Verdict |
|---|---|---|
| [Wikipedia](https://en.wikipedia.org/) train articles | ~1,750 Indian train articles with infoboxes: numbers, end stations, frequency, distance, journey time, number of stops. Schedules were removed from articles years ago, so no halts or times. | **In use** (CC BY-SA 4.0) for running days and trains introduced since 2017, with a check that the article describes the same train (numbers get reused: 204 of our 2017 numbers now belong to a different or re-routed train). |
| [OpenStreetMap](https://www.openstreetmap.org/) | station positions and names in Indian scripts; the railway track itself; no times by design | **In use** (ODbL) for stations, renamed station codes (`old_ref`), and the track lines follow. |
| [datameet/railways](https://github.com/datameet/railways) | 2016 train names, types and track paths | **In use** (CC0). |
| [indianrailways-gtfs](https://github.com/Neo2308/indianrailways-gtfs) (used by Transitous, Mobility Database) | GTFS for ~10,500 trains, Nov 2025 | **No.** Built by calling NTES through the UMANG app's API gateway with an app key, which NTES's terms don't allow without permission; no licence; breaks whenever the key or API changes. |
| [RailRadar](https://railradar.in/docs) | REST API: schedules, live status, routes | **Not as a foundation.** Operator not named ("est. 2026"), data provenance unclear, free plan is 1,000 requests a month (the timetable is ~13,000 trains), and the terms don't cover storing or republishing API data. |
| erail.in API | was a free non-commercial API | Gone: `api.erail.in` no longer resolves. An example of why not to depend on a third party. |
| IndiaRailInfo, etrain.info, ixigo, ConfirmTkt, RailYatri… | rich, current, crowd-maintained or commercial | No public data licence; scraping them would copy their work without permission. |
| Scraper services (Apify, RapidAPI "IRCTC" APIs) | scrape erail/IRCTC/NTES | No: same permission problem, and they break without notice. |
| Lepton Software (via Datarade) | commercial India transit data, GTFS | Paid enterprise licence; an option if the site ever earns money. |

## Why not crawl?

Technically easy, practically fragile, and not ours to take. NTES and IRCTC forbid systematic
downloading, the Railway Board reserves the timetable, and India's IT Act (section 43) makes
downloading or extracting data from a computer system without the owner's permission a civil
wrong. Crawlers also break whenever a site changes. Asking for permission costs an email and gives
a source that won't vanish: the Railway Board has published *Trains at a Glance* every year for
46 years. (This is a summary of what the sources say, not legal advice.)

## How a new source joins

Write `pipeline/import_<source>.py` that reads the source and updates `db/` with provenance in
`src` / `days_src`, never overwriting `override` rows. `build_network.py` validates everything and
refuses bad data. A monthly workflow re-runs the Wikipedia import and opens a pull request if
anything changed, so every update is reviewed before it goes live.
