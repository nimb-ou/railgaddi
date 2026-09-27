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

Keep the reply (a PDF of the email is fine) in a safe place and note its date and scope in
`SOURCES.md`. The Trains at a Glance tables then need an importer (`pipeline/import_tag.py`) that
reads the PDFs into `db/` with `src` set to `tag2026`; `import_wikipedia.py` and the rest stay as
they are.
