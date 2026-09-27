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
> The site currently uses the Indian Railways timetable published on data.gov.in in 2017, which
> is now out of date. *Trains at a Glance 2026* notes that the timings may not be reproduced
> without written permission, so I am writing to request that permission.
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

## When permission arrives

The importer is built and tested; switching over is a few commands.

1. Record it: copy the template in [permissions/README.md](permissions/README.md) to
   `docs/permissions/tag2026.md` and fill it in.
2. Run:

   ```bash
   pipeline/fetch_tag.sh raw 2026            # the PDFs from the Railway Board site
   python3 pipeline/import_tag.py raw 2026   # read and check them; see raw/tag2026/report.md
   python3 pipeline/merge_tag.py raw 2026    # into db/
   python3 pipeline/build_network.py && npm test
   ```

3. Review the diff of `db/` and deploy.

What to expect, measured on the 2026 edition (September 2026, on a copy of the database):

- 3,323 trains read from 421 pages; 2,130 pass every check (all stations placed, times running
  forward, no impossible speeds) and replace or join the 2017 timetable: 1,419 updated, 711 new,
  including 110 of the book's 153 Vande Bharat trains. Running days for 3,108.
- 13 stations renamed since 2017 take their new codes (Jhansi → Virangana Lakshmibai Jhansi,
  Aurangabad → Chhatrapati Sambhaji Nagar, Faizabad → Ayodhya Cantt…).
- The other ~1,200 are held back with a reason (report.md) and keep their 2017 times until the
  importer reads them reliably.
- Trade-off: *Trains at a Glance* prints principal halts only, so updated trains lose some small
  stops (861 places reachable from Bengaluru become 783). Worth doing before switching: keep a
  2017 minor halt when it lies on the same route between two 2026 halts, marked as approximate.
- 63% of long stretches between halts follow known track; the rest draw straight until the
  network gains the lines built since 2016 (OpenStreetMap has them).
