"""Build what the site loads (data/meta.json, data/timetable.bin, data/paths.bin) from
Railgaddi's own database in db/. Needs nothing else: no network, no raw downloads, so it runs
in CI and gives the same bytes every time.

    python3 pipeline/build_network.py            # writes data/
    python3 pipeline/build_network.py --check    # fails if data/ is out of date with db/

Binary layouts are documented in ARCHITECTURE.md.
"""
import json
import re
import struct
import sys
import tempfile
from array import array
from collections import Counter, defaultdict
from pathlib import Path

from db import days_mask, parse_time, read_table

ROOT = Path(__file__).resolve().parent.parent
CHECK = "--check" in sys.argv
OUT = Path(tempfile.mkdtemp()) if CHECK else ROOT / "data"

TYPE_LABELS = {
    "Pass": "Passenger", "Exp": "Express", "SF": "Superfast", "MEMU": "MEMU", "DEMU": "DEMU",
    "GR": "Garib Rath", "Raj": "Rajdhani", "Drnt": "Duronto", "SKr": "Sampark Kranti",
    "JShtb": "Jan Shatabdi", "Shtb": "Shatabdi", "Mail": "Mail", "Toy": "Heritage toy train",
    "Spl": "Special", "VB": "Vande Bharat", "AB": "Amrit Bharat",
}

# ---------- read db/ ----------
stations = {}
for r in read_table("stations"):
    stations[r["code"]] = dict(code=r["code"], name=r["name"], state=r["state"], hi=r["hi"] or None, local=r["local"] or None,
                               lat=float(r["lat"]) if r["lat"] else None, lon=float(r["lon"]) if r["lon"] else None)

for o in read_table("station_overrides"):  # hand corrections to stations, like overrides.csv for trains
    if o["code"] not in stations or o["field"] not in ("name", "hi", "local", "state"):
        sys.exit(f"station_overrides.csv: can't set {o['field']!r} on {o['code']!r}")
    stations[o["code"]][o["field"]] = o["value"]

train_rows = {r["number"]: r for r in read_table("trains")}
for o in read_table("overrides"):  # hand corrections win over every importer
    if o["number"] not in train_rows:
        sys.exit(f"overrides.csv: unknown train {o['number']}")
    if o["field"] not in ("name", "type", "days"):
        sys.exit(f"overrides.csv: can't override {o['field']!r}")
    train_rows[o["number"]][o["field"]] = o["value"]
    if o["field"] == "days":
        train_rows[o["number"]]["days_src"] = "override"

halts = defaultdict(list)
for r in read_table("halts"):
    halts[r["number"]].append(r)
via = {(r["number"], int(r["after"])): r["via"].split() for r in read_table("paths")}

KEEP_CAPS = {"MEMU", "DEMU", "CSMT", "SMVT", "SMVB", "LOKMANYA"} - {"LOKMANYA"}


# every word of every station's name and every train's: to mend names the book wrapped mid-word
VOCAB = Counter(w.lower() for r in list(stations.values()) + list(train_rows.values()) for w in re.findall(r"[A-Za-z]+", r["name"]))


def mend(n):
    """ "Varanasi New Del hi" -> "Varanasi New Delhi": the book's column headings wrap long names
    mid-word. Two pieces are one word again when together they make a known name and one of them
    isn't a word on its own."""
    words = n.split()
    out = []
    for w in words:
        if out and out[-1].isalpha() and w.isalpha() and w[0].islower() | (len(w) <= 3):
            joined = (out[-1] + w).lower()
            if VOCAB[joined] and (VOCAB[out[-1].lower()] < 2 or VOCAB[w.lower()] < 2 or w[0].islower()):
                out[-1] = out[-1] + w.lower()
                continue
        out.append(w)
    return " ".join(out)


def display_name(n):
    """How a train's name is shown: the older timetable abbreviates and shouts ("VASCO-DA-GAMA -
    Howrah Amaravati Exp"); db/ keeps the names as sourced."""
    n = mend(n)
    n = re.sub(r"\bS/?F\.?\s+Exp(ress)?\.?(?=$|\s)", "Superfast Express", n)
    n = re.sub(r"\bExp\.?(?=$|\s)", "Express", n)
    n = re.sub(r"\bSpl\.?(?=$|\s)", "Special", n)
    n = re.sub(r"\bPass\.?$", "Passenger", n)
    words = []
    for w in n.split():
        letters = re.sub(r"[^A-Za-z]", "", w)
        if letters.isupper() and len(letters) >= 5 and w not in KEEP_CAPS:
            w = "-".join(part.capitalize() for part in w.split("-"))
        words.append(w)
    return re.sub(r"\s+", " ", " ".join(words)).strip()


def seasonal_2017(no, t):
    """A special from the 2017 timetable (numbers 0xxxx, Suvidha 82xxx): it ran for a season in
    2017, so drawing it today would promise a train that isn't there."""
    return t["src"] == "ogd2017" and (t["type"] == "Spl" or no[0] == "0" or no.startswith("82"))


retired_rows = read_table("retired")
retired = {r["number"] for r in retired_rows if r["status"] == "duplicate"}  # renumbered: the new number has newer times
unlisted = {r["number"] for r in retired_rows if r["status"] == "unlisted"}  # the newer book doesn't list the number
skipped = [no for no, t in train_rows.items() if seasonal_2017(no, t) or no in retired]
renamed_local = []
trains = []
for no in sorted(train_rows):
    t = train_rows[no]
    if seasonal_2017(no, t) or no in retired:
        continue
    rows = sorted(halts[no], key=lambda r: int(r["seq"]))
    stops = []
    for i, r in enumerate(rows):
        if r["station"] not in stations:
            sys.exit(f"halts.csv: train {no} halts at unknown station {r['station']}")
        a, d = parse_time(r["arr"]), parse_time(r["dep"])
        km = float(r["km"]) if r["km"] else None
        stops.append([r["station"], a, d, km, 1 if r.get("approx") == "1" else 0])
        if i < len(rows) - 1:
            stops += [[c, None, None, None, 0] for c in via.get((no, int(r["seq"])), []) if c in stations]
    # the checks the app relies on: first halt only departs, last only arrives, time runs forward
    times = [v for s in stops for v in s[1:3] if v is not None]
    if len(rows) < 2 or stops[0][1] is not None or stops[0][2] is None or stops[-1][2] is not None or stops[-1][1] is None:
        sys.exit(f"train {no}: needs a departure at its first halt and an arrival at its last")
    if any(b < a for a, b in zip(times, times[1:])):
        sys.exit(f"train {no}: times go backwards (use +1, +2 for later days)")
    src = f"{t['src']}-unlisted" if no in unlisted else t["src"]
    name = display_name(t["name"])
    if t["src"] == "ogd2017" and t["type"] in ("Pass", "MEMU", "DEMU"):
        # the older timetable sometimes files a local train under another's name ("Karimganj
        # Dullabcherra Passenger" for Kurseong to Darjeeling): if it names none of its own
        # stations, call it by its ends
        on_route = " ".join(stations[s[0]]["name"] for s in stops).lower()
        own = [w for w in re.findall(r"[a-z]{4,}", name.lower()) if w not in ("passenger", "memu", "demu", "fast", "express", "special", "shuttle", "local")]
        if own and not any(w in on_route for w in own):
            short = lambda c: re.sub(r"\s+(Junction|Jn\.?|Terminus|Road|Halt)$", "", stations[c]["name"])  # noqa: E731
            name = f"{short(stops[0][0])} – {short(stops[-1][0])} {TYPE_LABELS.get(t['type'], t['type'])}"
            renamed_local.append(no)
    trains.append(dict(number=no, name=name, type=t["type"], days=days_mask(t["days"]), src=src, stops=stops))

newer = read_table("newer_trains")
SOURCES = {
    "ogd2017": "the 2017 timetable (data.gov.in)",
    "ogd2017-unlisted": "the 2017 timetable (data.gov.in). The 2026 timetable doesn't list this train number: it may have been renumbered, changed or withdrawn",
    "tag2026": "Indian Railways' 2026 timetable (Trains at a Glance)",
}
source_keys = sorted({t["src"] for t in trains})
print(f"left out: {len(skipped)} seasonal specials and retired trains from the 2017 timetable; "
      f"{len(renamed_local)} local trains named after their own ends")
print(f"db/: {len(stations)} stations, {len(trains)} trains, {sum(len(v) for v in halts.values())} halts, "
      f"{sum(1 for t in trains if t['days'])} with running days, {len(newer)} newer trains")

# ---------- cities ----------
cities = json.load(open(ROOT / "pipeline" / "cities.json"))
# stations renamed since cities.json was written keep their place in their city (Habibganj HBJ is
# Bhopal's Rani Kamlapati RKMP); the app also finds them by their old name
renames = {r["old"]: r for r in read_table("renames")}


def current(c):
    seen = set()
    while c in renames and c not in seen:
        seen.add(c)
        c = renames[c]["new"]
    return c


# ---------- emit ----------
halt_count = Counter()
for t in trains:
    for code, a, d, _, _ in t["stops"]:
        if a is not None or d is not None:
            halt_count[code] += 1
used = sorted({s[0] for t in trains for s in t["stops"]} | {c for n in newer for c in (n["from"], n["to"]) if c in stations},
             key=lambda c: (-halt_count[c], c))
idx = {c: i for i, c in enumerate(used)}
states = sorted({stations[c]["state"] for c in used})
sidx = {s: i for i, s in enumerate(states)}
types = sorted({t["type"] for t in trains})
tidx = {t: i for i, t in enumerate(types)}

col = defaultdict(list)
for c in used:
    s = stations[c]
    col["code"].append(c)
    col["name"].append(s["name"])
    col["lat"].append(None if s["lat"] is None else round(s["lat"], 4))
    col["lon"].append(None if s["lon"] is None else round(s["lon"], 4))
    col["state"].append(sidx[s["state"]])
    col["hi"].append(s["hi"] or "")
    col["local"].append(s["local"] or "")
    col["halts"].append(halt_count[c])

out_cities = []
for c in cities:
    codes = list(dict.fromkeys(current(k) for k in c["codes"]))  # a renamed station can be listed already under its new code
    missing = [k for k in codes if k not in idx]
    if missing:
        print(f"  {c['id']}: not in timetable {missing}")
    members = [idx[k] for k in codes if k in idx]
    if members:
        out_cities.append({k: c[k] for k in ("id", "name", "hi", "aka", "state")} | {"local": c.get("local", ""), "stations": members})

# ---------- write: meta.json (names), timetable.bin (halts), paths.bin (drawing geometry) ----------
# Binary layouts are documented in ARCHITECTURE.md; the app reads them with zero parsing.
NONE = 0xFFFF
train_start, h_station, h_arr, h_dep, h_dist, h_flags, t_type, t_days = [0], [], [], [], [], [], [], []
pass_count, pass_station = [], []  # pass_count[h]: points passed between halt h and the next halt
for t in trains:
    gap = []
    for code, a, d, km, approx in t["stops"]:
        if a is None and d is None:  # a point the train passes through: geometry only
            gap.append(idx[code])
            continue
        for v in (a, d, km):
            assert v is None or 0 <= v < NONE, (t["number"], v)
        if len(h_station) > train_start[-1]:  # close the gap after this train's previous halt
            pass_count[-1] = len(gap)
            pass_station += gap
        gap = []
        h_station.append(idx[code])
        h_arr.append(NONE if a is None else a)
        h_dep.append(NONE if d is None else d)
        h_dist.append(NONE if km is None else round(km))
        h_flags.append(approx)  # bit 0: times estimated
        pass_count.append(0)
    train_start.append(len(h_station))
    t_type.append(tidx[t["type"]])
    t_days.append(t["days"])

n_trains, n_halts = len(trains), len(h_station)

# Times and distances are stored as differences from the previous halt, which compress
# far better (450 -> 270 kB brotli). Arithmetic is mod 2^16, so any value round-trips.
#   first halt:  arr = none, dep = d_dep (absolute), dist = d_dist (absolute)
#   later halts: arr = prev dep + d_arr, dep = arr + d_dep (last halt: none), dist = prev + d_dist
d_arr, d_dep, d_dist = [0] * n_halts, [0] * n_halts, [0] * n_halts
for t in range(n_trains):
    prev_dep = prev_dist = 0
    for h in range(train_start[t], train_start[t + 1]):
        first, last = h == train_start[t], h == train_start[t + 1] - 1
        assert (h_arr[h] == NONE) == first and (h_dep[h] == NONE) == last, trains[t]["number"]
        dist = prev_dist if h_dist[h] == NONE else h_dist[h]  # rare gaps: carry the last distance
        d_arr[h] = 0 if first else (h_arr[h] - prev_dep) % 65536
        if last:
            d_dep[h] = 0
        elif first:
            d_dep[h] = h_dep[h]
        else:
            d_dep[h] = (h_dep[h] - h_arr[h]) % 65536
        d_dist[h] = (dist - prev_dist) % 65536
        prev_dep, prev_dist = h_dep[h], dist
        h_dist[h] = dist


def decode(t):
    """Mirror of the app's decoder (src/core/network.ts), used to check the file round-trips."""
    out, dep, dist = [], 0, 0
    for h in range(train_start[t], train_start[t + 1]):
        first, last = h == train_start[t], h == train_start[t + 1] - 1
        a = NONE if first else (dep + d_arr[h]) % 65536
        d = NONE if last else d_dep[h] if first else (a + d_dep[h]) % 65536
        dist = (dist + d_dist[h]) % 65536
        out.append((h_station[h], a, d, dist))
        dep = d
    return out


for t in range(n_trains):
    want = [(h_station[h], h_arr[h], h_dep[h], h_dist[h]) for h in range(train_start[t], train_start[t + 1])]
    assert decode(t) == want, f"timetable round-trip failed for {trains[t]['number']}"

timetable = bytearray(b"RGTT") + struct.pack("<III", 4, n_trains, n_halts)
timetable += array("I", train_start).tobytes()
for col_ in (h_station, d_arr, d_dep, d_dist):
    timetable += array("H", col_).tobytes()
timetable += array("B", t_type).tobytes()
timetable += array("B", t_days).tobytes()  # v3: days the train leaves its origin, bit 0 = Monday
timetable += array("B", h_flags).tobytes()  # v4: per halt, bit 0 = times estimated
paths = bytearray(b"RGTP") + struct.pack("<III", 1, n_halts, len(pass_station))
paths += array("H", pass_count).tobytes() + array("H", pass_station).tobytes()

meta = {
    "meta": {
        "timetable": ("Indian Railways, Trains at a Glance 2026; other trains: the timetable on data.gov.in (Dec 2017), GODL-India"
                      if "tag2026" in source_keys else "Indian Railways timetable on data.gov.in (Dec 2017), GODL-India"),
        "stations": "OpenStreetMap contributors (ODbL) + datameet (CC0)",
        "snapshot": "2026-01" if "tag2026" in source_keys else "2017-12",
    },
    "types": [[t, TYPE_LABELS.get(t, t)] for t in types],
    "states": states,
    "stations": col,
    "cities": out_cities,
    # station code -> [its code and name before a rename]: guides and searches made with the old ones still find it
    "renamed": {current(r["old"]): [r["old"], r["old_name"]] for r in renames.values() if current(r["old"]) in idx},
    # where each train's times come from: index into "sources"
    "sources": [[k, SOURCES.get(k, k)] for k in source_keys],
    "trains": [[t["number"], t["name"], source_keys.index(t["src"])] for t in trains],
    # trains we know run but whose halts we don't have yet: shown as a note, not on the map
    "newer": [[n["numbers"], n["name"], n["type"], idx.get(n["from"], -1), idx.get(n["to"], -1), days_mask(n["days"]),
               int(n["per_week"] or 0), int(n["minutes"] or 0), int(float(n["km"] or 0)), int(n["stops"] or 0), n["src"]]
              for n in newer if n["from"] in idx and n["to"] in idx],
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
(OUT / "timetable.bin").write_bytes(timetable)
(OUT / "paths.bin").write_bytes(paths)
for f in ("meta.json", "timetable.bin", "paths.bin"):
    print(f"  {f}: {(OUT / f).stat().st_size / 1e3:.0f} kB")
print(f"trains {n_trains}, halts {n_halts}, pass-through points {len(pass_station)}, stations {len(used)}")
if CHECK:
    stale = [f for f in ("meta.json", "timetable.bin", "paths.bin") if (OUT / f).read_bytes() != (ROOT / "data" / f).read_bytes()]
    if stale:
        sys.exit(f"data/ is out of date with db/ ({', '.join(stale)}): run python3 pipeline/build_network.py")
    print("data/ matches db/")
