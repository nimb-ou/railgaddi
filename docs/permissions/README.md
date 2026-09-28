# Permissions on record

A source whose terms require permission is only imported once a decision is written down here,
one file per source and edition: the permission (what was granted, by whom, when, for what use),
or, until it arrives, the owner's decision to use the source while it's requested, with how to
undo it. Keep the original email or letter (PDF) with the project's records.

`pipeline/merge_tag.py` checks for `tag<year>.md` before it will write the official
*Trains at a Glance* timetable into `db/`.

Template (`tag2026.md`):

```markdown
# Trains at a Glance 2026

- Granted by: Executive Director (Coaching), Railway Board, Ministry of Railways
- Date: 2026-__-__
- Reference: letter/email no. …
- Scope: train numbers, names, halts, times, distances and days of service, shown on
  railgaddi.in with credit to "Indian Railways, Trains at a Glance 2026"
- Conditions: …
```
