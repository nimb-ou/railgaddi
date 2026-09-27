"""Import the 2017 official timetable into Railgaddi's own database (db/*.csv).

This is the base layer of db/: every station, every train and every halt, cleaned and matched
to map positions. Other importers (import_wikipedia.py, …) add to it, and build_network.py
turns db/ into what the site loads. Run it again only to rebuild the base from scratch; it
overwrites stations.csv, trains.csv, halts.csv and paths.csv (running days already in
trains.csv are kept).

    python3 pipeline/import_ogd2017.py raw

Sources (all in RAW, see README):
  - ogd_timetable_2017.csv  Indian Railways timetable published on data.gov.in (Dec 2017),
                            Government Open Data License - India. Lists every real stoppage
                            with arrival, departure and official distance. **Source of truth.**
  - schedules.json, trains.json, stations.json   datameet/railways (Aug 2016, CC0). Used only for
                            full train names/types and the pass-through points that trace a
                            train's path between halts.
  - osm_stations.json       OpenStreetMap railway=station|halt nodes for India (ODbL): positions
                            and names in Indian scripts.

"""
import csv
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from db import DB, fmt_time, read_table, write_table

RAW = Path(sys.argv[1])

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
    stations[code] = dict(code=code, name=name, lat=lat, lon=lon, state=state, hi=hi, local=local,
                          coord="osm" if best else "datameet" if lat is not None else "")
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
        stations[c]["coord"] = "dropped: trains zig-zag through it"
    print("mis-geocoded stations dropped:", len(bad))

# ---------- write db/ ----------
def num(v, nd=5):
    return "" if v is None else f"{round(v, nd):g}"


write_table("stations", [
    {"code": s["code"], "name": s["name"], "state": s["state"], "lat": num(s["lat"]), "lon": num(s["lon"]),
     "coord": s["coord"], "hi": s["hi"] or "", "local": s["local"] or ""}
    for s in sorted(stations.values(), key=lambda s: s["code"])
])

# keep running days someone (or another importer) already added
old = {r["number"]: r for r in read_table("trains")} if (DB / "trains.csv").exists() else {}
write_table("trains", [
    {"number": t["number"], "name": t["name"], "type": t["type"],
     "days": old.get(t["number"], {}).get("days", ""), "days_src": old.get(t["number"], {}).get("days_src", ""),
     "src": "ogd2017"}
    for t in sorted(trains, key=lambda t: t["number"])
])

halts, via = [], []
for t in sorted(trains, key=lambda t: t["number"]):
    seq = 0
    for code, a, d, km in t["stops"]:
        if a is None and d is None:
            via[-1]["via"] += (" " if via[-1]["via"] else "") + code
            continue
        seq += 1
        halts.append({"number": t["number"], "seq": seq, "station": code, "arr": fmt_time(a), "dep": fmt_time(d),
                      "km": "" if km is None else f"{km:g}"})
        via.append({"number": t["number"], "after": seq, "via": ""})
write_table("halts", halts)
write_table("paths", [v for v in via if v["via"]])
print(f"db/: {len(stations)} stations, {len(trains)} trains, {len(halts)} halts")
