"""Build the railway network data (data/meta.json, data/timetable.bin, data/paths.bin).

Sources (all in RAW, see README):
  - ogd_timetable_2017.csv  Indian Railways timetable published on data.gov.in (Dec 2017),
                            Government Open Data License - India. Lists every real stoppage
                            with arrival, departure and official distance. **Source of truth.**
  - schedules.json, trains.json, stations.json   datameet/railways (Aug 2016, CC0). Used only for
                            full train names/types and the pass-through points that trace a
                            train's path between halts.
  - osm_stations.json       OpenStreetMap railway=station|halt nodes for India (ODbL): positions
                            and names in Indian scripts.

The web app only depends on the output shape, so a current timetable feed can replace the
OGD file here without touching the frontend.
"""
import csv
import json
import math
import re
import struct
import sys
import unicodedata
from array import array
from collections import Counter, defaultdict
from pathlib import Path

RAW = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"

TYPE_LABELS = {
    "Pass": "Passenger", "Exp": "Express", "SF": "Superfast", "MEMU": "MEMU", "DEMU": "DEMU",
    "GR": "Garib Rath", "Raj": "Rajdhani", "Drnt": "Duronto", "SKr": "Sampark Kranti",
    "JShtb": "Jan Shatabdi", "Shtb": "Shatabdi", "Mail": "Mail", "Toy": "Heritage toy train",
    "Spl": "Special",
}
TYPE_WORD = {"Pass": "Passenger", "MEMU": "MEMU", "DEMU": "DEMU", "Spl": "Special", "SF": "Superfast Express"}
STATE_LANG = {
    "Karnataka": "kn", "Tamil Nadu": "ta", "Kerala": "ml", "Andhra Pradesh": "te", "Telangana": "te",
    "Maharashtra": "mr", "Gujarat": "gu", "West Bengal": "bn", "Odisha": "or", "Punjab": "pa",
    "Assam": "as", "Puducherry": "ta", "Goa": "kok",
}


def hav(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    x = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


SMALL = {"jn": "Jn", "jn.": "Jn", "cantt": "Cantt", "rd": "Road", "halt": "Halt", "of": "of"}


def tidy_name(s):
    s = re.sub(r"\s+", " ", s.strip())
    if not s or (s.upper() != s and s.lower() != s):
        return s  # empty, or already mixed case: trust it
    words = []
    for w in s.split(" "):
        lw = w.lower()
        if lw in SMALL:
            words.append(SMALL[lw])
        elif "-" in w:
            words.append("-".join(p.capitalize() for p in w.split("-")))
        else:
            words.append(w.capitalize())
    return " ".join(words)


def tidy_train_name(s):
    out = []
    for w in re.sub(r"\s+", " ", s.strip()).split(" "):
        if w.isupper() and w.isalpha() and w not in {"AC", "SF"}:
            out.append(w.capitalize())
        else:
            out.append(w)
    return " ".join(out)


def norm_tokens(s):
    s = unicodedata.normalize("NFKD", s).lower()
    s = re.sub(r"[^a-z ]", " ", s)
    stop = {"jn", "junction", "cantt", "cantonment", "city", "road", "halt", "railway", "station", "terminus", "town"}
    return {t for t in s.split() if t and t not in stop}


def is_ascii(s):
    return all(ord(c) < 128 for c in s)


def hhmm(t):
    m = re.match(r"\s*(\d{1,2}):(\d{2})", t or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


# ---------- stations ----------
dm_st = {f["properties"]["code"].strip().upper(): f for f in json.load(open(RAW / "stations.json"))["features"]}
osm_by_ref = defaultdict(list)
for e in json.load(open(RAW / "osm_stations.json"))["elements"]:
    tags = e.get("tags", {})
    if tags.get("station") in {"subway", "light_rail", "monorail"} or tags.get("subway") == "yes":
        continue
    for r in tags.get("ref", "").upper().split(";"):
        if r.strip():
            osm_by_ref[r.strip()].append(e)

ogd = defaultdict(list)
ogd_station_name = {}
for r in csv.DictReader(open(RAW / "ogd_timetable_2017.csv", encoding="utf-8", errors="replace")):
    if not (r["Train No"].strip().isdigit() and r["SEQ"].strip().isdigit()):
        continue  # a handful of rows are spill-over from a broken line in the source CSV
    no = r["Train No"].strip().zfill(5)
    ogd[no].append(r)
    ogd_station_name.setdefault(r["Station Code"].strip().upper(), r["Station Name"])

stations = {}
coord_source = Counter()
for code in set(dm_st) | set(ogd_station_name):
    f = dm_st.get(code)
    p = f["properties"] if f else {}
    lat = lon = None
    if f and f["geometry"]:
        lon, lat = f["geometry"]["coordinates"]
    name = tidy_name(p.get("name") or ogd_station_name.get(code) or code)
    state = (p.get("state") or "").strip()
    best = None
    cands = osm_by_ref.get(code, [])
    if lat is not None:
        if cands:
            best = min(cands, key=lambda e: hav(lat, lon, e["lat"], e["lon"]))
            if hav(lat, lon, best["lat"], best["lon"]) > 25:
                best = None
    elif len(cands) == 1:
        best = cands[0]  # the only railway station carrying this code
    else:
        # official names are often truncated ("Shravanabela"): allow prefix matches
        toks = norm_tokens(name)
        def similar(e):
            other = norm_tokens(e["tags"].get("name:en") or e["tags"].get("name", ""))
            return any(a == b or (min(len(a), len(b)) >= 5 and (a.startswith(b) or b.startswith(a))) for a in toks for b in other)
        best = next((e for e in cands if similar(e)), None)
    hi = local = None
    if best:
        t = best["tags"]
        lat, lon = best["lat"], best["lon"]
        coord_source["osm"] += 1
        en = re.sub(r"\s+railway station$", "", t.get("name:en") or t.get("name") or "", flags=re.I)
        if en and is_ascii(en) and len(en) < 42:
            name = en
        hi = t.get("name:hi")
        if STATE_LANG.get(state):
            local = t.get(f"name:{STATE_LANG[state]}")
    else:
        coord_source["datameet" if lat is not None else "none"] += 1
    stations[code] = dict(code=code, name=name, lat=lat, lon=lon, state=state, hi=hi, local=local)
print("station coordinates:", dict(coord_source))

# stations only in the official timetable have no state: borrow the nearest station's
known = [(v["lat"], v["lon"], v["state"]) for v in stations.values() if v["state"] and v["lat"] is not None]
for v in stations.values():
    if not v["state"] and v["lat"] is not None:
        v["state"] = min(known, key=lambda k: (k[0] - v["lat"]) ** 2 + (k[1] - v["lon"]) ** 2)[2]

# ---------- datameet: names, types, and the path between halts ----------
dm_meta = {f["properties"]["number"]: f["properties"] for f in json.load(open(RAW / "trains.json"))["features"]}
dm_path = defaultdict(list)
for r in json.load(open(RAW / "schedules.json")):
    dm_path[r["train_number"]].append(r)
for no in dm_path:
    dm_path[no] = [r["station_code"].strip().upper() for r in sorted(dm_path[no], key=lambda r: r["id"])]


def infer_type(no, name):
    n = name.upper()
    for key, t in (("JAN SHATABDI", "JShtb"), ("RAJDHANI", "Raj"), ("SHATABDI", "Shtb"), ("DURONTO", "Drnt"),
                   ("GARIB", "GR"), ("SAMPARK", "SKr"), ("MEMU", "MEMU"), ("DEMU", "DEMU"), ("DMU", "DEMU"),
                   ("PASS", "Pass")):
        if key in n:
            return t
    if no[0] == "0":
        return "Spl"
    if no[0] == "5":
        return "Pass"
    if no[0] == "6":
        return "MEMU"
    if no[0] == "7":
        return "DEMU"
    if no[:2] in ("12", "20", "22"):
        return "SF"
    return "Exp"


def short_station(code):
    n = stations.get(code, {}).get("name") or code
    return re.sub(r"\s*\(.*?\)|\s+(Jn|Junction|Cantt|Terminus|Central)\.?$", "", n).strip()


def is_suburban(no, name):
    n = name.upper()
    return no[0] in "349" or re.search(r"(^|[^MD])EMU\b|\bLOC(AL)?\b|MMTS", n) is not None


# ---------- trains ----------
trains = []
dropped = Counter()
for no, rows in ogd.items():
    raw_name = rows[0]["Train Name"].strip()
    if is_suburban(no, raw_name):
        dropped["suburban"] += 1
        continue
    rows.sort(key=lambda r: int(r["SEQ"]))
    halts = []
    last = None
    for i, r in enumerate(rows):
        code = r["Station Code"].strip().upper()
        a, d = hhmm(r["Arrival time"]), hhmm(r["Departure Time"])
        if i == 0:
            a = None
        if i == len(rows) - 1:
            d = None
        # times are clock times; roll days forward whenever the clock goes backwards
        vals = []
        for v in (a, d):
            if v is not None:
                if last is not None:
                    while v < last:
                        v += 1440
                last = v
            vals.append(v)
        try:
            km = float(r["Distance"])
        except ValueError:
            km = None
        halts.append([code, vals[0], vals[1], km])
    if len(halts) < 2 or halts[0][2] is None or halts[-1][1] is None:
        dropped["no times"] += 1
        continue

    meta = dm_meta.get(no)
    ttype = meta["type"] if meta and meta["type"] not in ("", "Hyd", "Del", "Klkt") else infer_type(no, raw_name)
    if meta:
        name = tidy_train_name(meta["name"])
    elif len(raw_name) < 12 and "-" not in raw_name:
        name = tidy_train_name(raw_name.replace("EXP", "Express"))
    else:  # OGD truncates names to 12 characters; name it by its ends instead
        name = f"{short_station(halts[0][0])} – {short_station(halts[-1][0])} {TYPE_WORD.get(ttype, 'Express')}"

    # thread the halts through datameet's full path so lines follow the track, not straight chords
    path = dm_path.get(no, [])
    pts = []
    pos = 0
    for h in halts:
        try:
            k = path.index(h[0], pos)
        except ValueError:
            k = None
        if k is not None and (k - pos) < 400:
            if pts:
                pts += [[c, None, None, None] for c in path[pos:k] if c != pts[-1][0]]
            pos = k + 1
        pts.append(h)
    trains.append(dict(number=no, name=name, type=ttype, stops=pts))

print("trains kept:", len(trains), "dropped:", dict(dropped))

# ---------- coordinate outliers ----------
# A station whose position makes trains zig-zag hundreds of km is almost certainly mis-geocoded.
for _ in range(2):
    flagged, seen = Counter(), Counter()
    for t in trains:
        pts = [s[0] for s in t["stops"] if stations.get(s[0], {}).get("lat") is not None]
        for j in range(1, len(pts) - 1):
            a, b, c = (stations[x] for x in pts[j - 1:j + 2])
            ab = hav(a["lat"], a["lon"], b["lat"], b["lon"])
            bc = hav(b["lat"], b["lon"], c["lat"], c["lon"])
            ac = hav(a["lat"], a["lon"], c["lat"], c["lon"])
            seen[b["code"]] += 1
            if ab + bc > 2.5 * ac + 40:
                flagged[b["code"]] += 1
    bad = [c for c, n in flagged.items() if n / seen[c] > 0.5]
    for c in bad:
        stations[c]["lat"] = stations[c]["lon"] = None
    print("mis-geocoded stations dropped:", len(bad))

# ---------- cities ----------
cities = json.load(open(ROOT / "pipeline" / "cities.json"))

# ---------- emit ----------
halt_count = Counter()
for t in trains:
    for code, a, d, _ in t["stops"]:
        if a is not None or d is not None:
            halt_count[code] += 1
used = sorted({s[0] for t in trains for s in t["stops"]}, key=lambda c: -halt_count[c])
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
train_start, h_station, h_arr, h_dep, h_dist, t_type = [0], [], [], [], [], []
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

timetable = bytearray(b"RGTT") + struct.pack("<III", 2, n_trains, n_halts)
timetable += array("I", train_start).tobytes()
for col_ in (h_station, d_arr, d_dep, d_dist):
    timetable += array("H", col_).tobytes()
timetable += array("B", t_type).tobytes()
paths = bytearray(b"RGTP") + struct.pack("<III", 1, n_halts, len(pass_station))
paths += array("H", pass_count).tobytes() + array("H", pass_station).tobytes()

meta = {
    "meta": {
        "timetable": "Indian Railways timetable on data.gov.in (Dec 2017), GODL-India",
        "stations": "OpenStreetMap contributors (ODbL) + datameet (CC0)",
        "snapshot": "2017-12",
    },
    "types": [[t, TYPE_LABELS.get(t, t)] for t in types],
    "states": states,
    "stations": col,
    "cities": out_cities,
    "trains": [[t["number"], t["name"]] for t in trains],
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
(OUT / "timetable.bin").write_bytes(timetable)
(OUT / "paths.bin").write_bytes(paths)
for f in ("meta.json", "timetable.bin", "paths.bin"):
    print(f"  {f}: {(OUT / f).stat().st_size / 1e3:.0f} kB")
print(f"trains {n_trains}, halts {n_halts}, pass-through points {len(pass_station)}, stations {len(used)}")
