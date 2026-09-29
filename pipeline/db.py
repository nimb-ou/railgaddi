"""Railgaddi's own timetable database: plain CSV files in db/, one row per fact, easy to review
in a diff and to correct in a spreadsheet. Importers write to it; build_network.py reads it.

Conventions (see db/README.md):
  times   "HH:MM", with "+N" for N days after the day the train left its origin ("00:05+1")
  days    days the train leaves its origin: "Daily", "Mon,Thu", or "" when not known
  approx  "1" on a halt whose times are estimated (a small stop kept from an older timetable)
"""
import csv
import os
import re
from pathlib import Path

# RAILGADDI_DB points the pipeline at another copy of the database (to try an import safely)
DB = Path(os.environ.get("RAILGADDI_DB") or Path(__file__).resolve().parent.parent / "db")
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

COLUMNS = {
    "stations": ["code", "name", "state", "lat", "lon", "coord", "hi", "local"],
    "trains": ["number", "name", "type", "days", "days_src", "src"],
    "halts": ["number", "seq", "station", "arr", "dep", "km", "approx"],
    "paths": ["number", "after", "via"],
    "newer_trains": ["numbers", "name", "type", "from", "to", "days", "per_week", "minutes", "km", "stops", "src"],
    "overrides": ["number", "field", "value", "reason"],
    "renames": ["old", "new", "old_name", "since"],
    "station_overrides": ["code", "field", "value", "reason"],
    "retired": ["number", "name", "status", "reason"],
    "renumbered": ["old", "new", "name", "since"],
}


def read_table(name):
    path = DB / f"{name}.csv"
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_table(name, rows):
    DB.mkdir(exist_ok=True)
    with open(DB / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS[name], lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in COLUMNS[name]})


def fmt_time(minutes):
    if minutes is None:
        return ""
    day, m = divmod(int(minutes), 1440)
    return f"{m // 60:02d}:{m % 60:02d}" + (f"+{day}" if day else "")


def parse_time(s):
    s = (s or "").strip()
    if not s:
        return None
    m = re.fullmatch(r"(\d{1,2}):(\d{2})(?:\+(\d+))?", s)
    if not m:
        raise ValueError(f"bad time {s!r}")
    return int(m.group(3) or 0) * 1440 + int(m.group(1)) * 60 + int(m.group(2))


def days_mask(s):
    """ "Daily" -> 127, "Mon,Thu" -> 0b1001, "" -> 0 (unknown). Bit 0 is Monday. """
    s = (s or "").strip()
    if not s:
        return 0
    if s.lower() == "daily":
        return 127
    mask = 0
    for part in s.split(","):
        part = part.strip()[:3].title()
        if part not in DAYS:
            raise ValueError(f"bad days {s!r}")
        mask |= 1 << DAYS.index(part)
    return mask


def days_text(mask):
    if not mask:
        return ""
    if mask == 127:
        return "Daily"
    return ",".join(d for i, d in enumerate(DAYS) if mask >> i & 1)
