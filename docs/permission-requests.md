# Asking Indian Railways for permission

Two emails that, if answered yes, give Railgaddi a current, complete and legally clean timetable.
Send them from your own address; replace the bracketed parts. A short, specific request with a
live link is the most likely to get an answer. If there's no reply in three weeks, send a polite
follow-up, and consider a letter to the same office (addresses below).

---

## 1. Railway Board: use of *Trains at a Glance* timings

**To:** Executive Director (Coaching), Railway Board — neeraj.kumar73@gov.in (the contact printed in
*Trains at a Glance 2026*, "How to read the table")
**Post:** Room No. 354, Rail Bhavan, New Delhi 110 001

**Subject:** Request for permission to use Trains at a Glance timings on a free rail-travel website

> Dear Sir/Madam,
>
> I run Railgaddi ([your domain], currently at https://nimb-ou.github.io/railgaddi/), a free,
> non-commercial website that helps people discover places in India they can reach by train
> without changing trains. You choose your station and it shows, on a map, every place a direct
> train goes, with photos, what to see there, and the trains that run. It sells nothing, has no
> advertising, and sends people to NTES and IRCTC for live information and booking.
>
> While building the site I have used timings from *Trains at a Glance 2026* for about 2,300
> Mail/Express and premium trains, alongside the 2017 timetable published on data.gov.in for the
> rest. The book notes that timings may not be reproduced without written permission, so I am
> writing to request that permission. If you would prefer that I not use them, I will remove
> them promptly and return to the open-data timetable.
>
> Specifically, I would like to use, for Mail/Express and premium trains: train number and name,
> halts, arrival and departure times, distances and days of service. I would show them as part
> of the map and train pages, credit "Indian Railways, Trains at a Glance 2026" on every train
> page, state that timings are subject to change and link to NTES, and update the site when each
> new edition is published. I would not reproduce the book's tables, layout or other content.
>
> If a machine-readable version of the timetable (CSV or similar) can be shared, that would
> ensure there are no transcription errors.
>
> Thank you for considering this. I am happy to share any details or a demonstration.
>
> Yours faithfully,
> [Your name]
> [Phone]
> [Your domain]

---

## 2. CRIS: NTES data and the Pravah API platform

**To:** pravah@cris.org.in
**Cc:** the NTES contact, if you find one on https://enquiry.indianrail.gov.in/mntes/

**Subject:** Request for access to train schedule data (Pravah API / NTES) for a free travel website

> Dear Sir/Madam,
>
> I run Railgaddi ([your domain]), a free, non-commercial website that helps people discover
> places reachable by a direct train: pick your station and it maps every destination with
> photos and the trains that go there. It links to NTES for running status and to IRCTC for
> booking.
>
> I would like to keep its timetable accurate and am writing to ask:
>
> 1. whether Railgaddi could be given access to the Pravah train schedule API (train list and
>    each train's schedule with running days), and on what terms; or
> 2. under the NTES terms, which allow reproduction "after taking proper permission", whether I
>    may use NTES train schedules (halts, times, days of service) with NTES credited as the source.
>
> The site would refresh the schedules at most once a day, store them only to show them, and
> credit NTES/CRIS on every train page.
>
> Thank you. I would be glad to provide any further information.
>
> Yours faithfully,
> [Your name]
> [Phone]
> [Your domain]

---

## 3. Optional: ask for open data

The Open Government Data platform lets anyone request a dataset. Asking the Ministry of Railways
to publish the current timetable on data.gov.in under the Government Open Data License would help
every developer, not just Railgaddi: https://www.data.gov.in → *Suggest a dataset* (needs a free
account).

## Where things stand

*Trains at a Glance 2026* is already merged, on the owner's decision of 2026-09-28, recorded in
[permissions/tag2026.md](permissions/tag2026.md). The emails above say so. When the reply comes:

- **Yes:** replace the status line in `permissions/tag2026.md` with who granted it, the date, the
  reference and any conditions, and keep the letter.
- **No:** revert the commit "Timetable: Trains at a Glance 2026" (every train goes back to the
  2017 open-data timetable), delete `permissions/tag2026.md`, rebuild (`python3
  pipeline/build_network.py && npm test`) and deploy.

Each new edition is the same few commands:

```bash
pipeline/fetch_tag.sh raw 2027            # the PDFs from the Railway Board site
python3 pipeline/import_tag.py raw 2027   # read and check them; see raw/tag2027/report.md
python3 pipeline/merge_tag.py raw 2027    # into db/ (needs docs/permissions/tag2027.md)
python3 pipeline/build_network.py && npm test
```

What the 2026 merge did (September 2026):

- 3,323 trains read from 421 pages; 2,322 pass every check (all stations placed, times running
  forward, no impossible speeds) and replace or join the 2017 timetable: 1,570 updated, 752 new.
  Another 246 trains whose stops couldn't all be read take the book's running days, when its
  first and last halts match ours. Running days are now known for 2,789 trains.
- 14 stations renamed since 2017 take their new codes (Jhansi → Virangana Lakshmibai Jhansi,
  Habibganj → Rani Kamlapati, Mughal Sarai → Deen Dayal Upadhyaya…), listed in
  `db/renames.csv`; they stay in their city, keep their guide, and are found by the old name.
- The other ~1,000 are held back with a reason (`raw/tag2026/report.md`) and keep their 2017
  times until the importer reads them reliably.
- Small stops: *Trains at a Glance* prints principal halts only. The merge puts back the 2017
  small stops that lie on the same line between two printed halts, at times scaled from the older
  schedule and marked "~ estimated" on the train page (10,995 kept; 106 trains skipped because
  their route changed). Places reachable from Bengaluru: 861 on the 2017 data, 840 now.
- Track: lines between halts follow OpenStreetMap's railway (`fetch_osm_rail.py`, `track.py`),
  falling back to the network `db/` already knows: 93% of stretches over 25 km follow the real
  line.
