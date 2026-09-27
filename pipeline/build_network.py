"""Build what the site loads (data/meta.json, data/timetable.bin, data/paths.bin) from
Railgaddi's own database in db/. Needs nothing else: no network, no raw downloads, so it runs
in CI and gives the same bytes every time.

    python3 pipeline/build_network.py            # writes data/
    python3 pipeline/build_network.py --check    # fails if data/ is out of date with db/

Binary layouts are documented in ARCHITECTURE.md.
"""
import json
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

trains = []
for no in sorted(train_rows):
    t = train_rows[no]
    rows = sorted(halts[no], key=lambda r: int(r["seq"]))
    stops = []
    for i, r in enumerate(rows):
        if r["station"] not in stations:
            sys.exit(f"halts.csv: train {no} halts at unknown station {r['station']}")
        a, d = parse_time(r["arr"]), parse_time(r["dep"])
        km = float(r["km"]) if r["km"] else None
        stops.append([r["station"], a, d, km])
        if i < len(rows) - 1:
            stops += [[c, None, None, None] for c in via.get((no, int(r["seq"])), []) if c in stations]
    # the checks the app relies on: first halt only departs, last only arrives, time runs forward
    times = [v for s in stops for v in s[1:3] if v is not None]
    if len(rows) < 2 or stops[0][1] is not None or stops[0][2] is None or stops[-1][2] is not None or stops[-1][1] is None:
        sys.exit(f"train {no}: needs a departure at its first halt and an arrival at its last")
    if any(b < a for a, b in zip(times, times[1:])):
        sys.exit(f"train {no}: times go backwards (use +1, +2 for later days)")
    trains.append(dict(number=no, name=t["name"], type=t["type"], days=days_mask(t["days"]), src=t["src"], stops=stops))

newer = read_table("newer_trains")
SOURCES = {"ogd2017": "the 2017 timetable (data.gov.in)", "tag2026": "Indian Railways' 2026 timetable (Trains at a Glance)"}
source_keys = sorted({t["src"] for t in trains})
print(f"db/: {len(stations)} stations, {len(trains)} trains, {sum(len(v) for v in halts.values())} halts, "
      f"{sum(1 for t in trains if t['days'])} with running days, {len(newer)} newer trains")

# ---------- cities ----------
cities = json.load(open(ROOT / "pipeline" / "cities.json"))

# ---------- emit ----------
halt_count = Counter()
for t in trains:
    for code, a, d, _ in t["stops"]:
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
    missing = [k for k in c["codes"] if k not in idx]
    if missing:
        print(f"  {c['id']}: not in timetable {missing}")
    members = [idx[k] for k in c["codes"] if k in idx]
    if members:
        out_cities.append({k: c[k] for k in ("id", "name", "hi", "aka", "state")} | {"local": c.get("local", ""), "stations": members})

# ---------- write: meta.json (names), timetable.bin (halts), paths.bin (drawing geometry) ----------
# Binary layouts are documented in ARCHITECTURE.md; the app reads them with zero parsing.
NONE = 0xFFFF
train_start, h_station, h_arr, h_dep, h_dist, t_type, t_days = [0], [], [], [], [], [], []
pass_count, pass_station = [], []  # pass_count[h]: points passed between halt h and the next halt
for t in trains:
    gap = []
    for code, a, d, km in t["stops"]:
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

timetable = bytearray(b"RGTT") + struct.pack("<III", 3, n_trains, n_halts)
timetable += array("I", train_start).tobytes()
for col_ in (h_station, d_arr, d_dep, d_dist):
    timetable += array("H", col_).tobytes()
timetable += array("B", t_type).tobytes()
timetable += array("B", t_days).tobytes()  # v3: days the train leaves its origin, bit 0 = Monday
paths = bytearray(b"RGTP") + struct.pack("<III", 1, n_halts, len(pass_station))
paths += array("H", pass_count).tobytes() + array("H", pass_station).tobytes()

meta = {
    "meta": {
        "timetable": "Indian Railways timetable on data.gov.in (Dec 2017), GODL-India",
        "stations": "OpenStreetMap contributors (ODbL) + datameet (CC0)",
        "snapshot": "2026-01" if "tag2026" in source_keys else "2017-12",
    },
    "types": [[t, TYPE_LABELS.get(t, t)] for t in types],
    "states": states,
    "stations": col,
    "cities": out_cities,
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
