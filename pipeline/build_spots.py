"""Places without a railway station, and the airports near them: data/spots.json.

Kodaikanal, Munnar, Manali, Gangtok, Leh: people go there by train and then by road. For each
town in GeoNames (population 1,000 and over) this keeps the ones more than 8 km from any station
that three or more trains stop at, plus the famous places in content/spots.json that aren't
towns (Kasol, the Valley of Flowers). The site works out the nearest stations itself, from the
timetable, so this only has to say where each place is, plus:

  - its population, unless GeoNames's figure is plainly a district's (a district seat of "1.7
    million"): those are written negative, so the site ranks by them but doesn't show them;
  - the station it does have, if one within 4 km has only local trains (Kolkata's suburbs,
    narrow-gauge halts): "Barasat Junction", so the site doesn't say there's no station at all;
  - the real road distances and times to its stations, from raw/roads.json (fetch_roads.py),
    in data/roads.json, in the same order (the site fetches it after the page is up).

    pipeline/fetch_geo.sh                 # GeoNames towns and OurAirports, into raw/geo/
    python3 pipeline/build_spots.py       # -> data/spots.json

Sources: GeoNames (CC BY 4.0), OurAirports (public domain).
"""
import csv
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEO = ROOT / "raw" / "geo"
csv.field_size_limit(10**8)


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


# stations with trains: how many different trains stop at each
trains_at = Counter()
seen = set()
for r in csv.DictReader(open(ROOT / "db" / "halts.csv")):
    k = (r["number"], r["station"])
    if k not in seen:
        seen.add(k)
        trains_at[r["station"]] += 1
served = []
local = []  # stations with fewer trains: (lat, lon, name)
for r in csv.DictReader(open(ROOT / "db" / "stations.csv")):
    if r["lat"] and trains_at[r["code"]] >= 3:
        served.append((float(r["lat"]), float(r["lon"])))
    elif r["lat"]:
        local.append((float(r["lat"]), float(r["lon"]), r["name"]))
codes_served = {r["code"] for r in csv.DictReader(open(ROOT / "db" / "stations.csv")) if trains_at[r["code"]] >= 3}
for e in json.load(open(ROOT / "raw" / "osm_stations.json"))["elements"]:
    t = e.get("tags", {})
    if t.get("station") in ("subway", "monorail", "light_rail") or t.get("subway") == "yes" or "metro" in t.get("network", "").lower():
        continue
    if t.get("ref") and t["ref"].upper() not in codes_served and t.get("name"):
        local.append((e["lat"], e["lon"], t.get("name:en") or t["name"]))
local_grid = defaultdict(list)
for q in local:
    local_grid[(int(q[0] * 2), int(q[1] * 2))].append(q)
grid = defaultdict(list)
for p in served:
    grid[(int(p[0] * 2), int(p[1] * 2))].append(p)


def nearest_station_km(p):
    best = 1e9
    gy, gx = int(p[0] * 2), int(p[1] * 2)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for q in grid[(gy + dy, gx + dx)]:
                best = min(best, hav(p, q))
    return best


def local_station(p):
    """The nearest station within 4 km that only local trains stop at (or none)."""
    best = (4.0, "")
    gy, gx = int(p[0] * 2), int(p[1] * 2)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for q in local_grid[(gy + dy, gx + dx)]:
                d = hav(p, q)
                if d < best[0]:
                    best = (d, re.sub(r"\s+railway station$", "", q[2], flags=re.I))
    return best[1]


states = {}
for line in open(GEO / "admin1.txt", encoding="utf-8"):
    code, name, _ascii, _gid = line.rstrip("\n").split("\t")
    if code.startswith("IN."):
        states[code[3:]] = name
STATE_FIX = {"NCT": "Delhi", "State of Odisha": "Odisha"}

# guides the site already has (they sit at stations): a town of the same name isn't a new place
guides = json.load(open(ROOT / "data" / "places" / "index.json"))["articles"]
guide_at = [(re.sub(r"[^a-z]", "", t.lower()), g["ll"]) for t, g in guides.items() if g.get("ll")]

# GeoNames keeps some old or odd spellings; the names on signs and tickets today (the old one
# stays as another name, so it's still found)
RENAME = {
    "Teni": "Theni", "Kulu": "Kullu", "Naini Tal": "Nainital", "Panjim": "Panaji", "Suriapet": "Suryapet",
    "Sangareddi": "Sangareddy", "Garhchiroli": "Gadchiroli", "Kendraparha": "Kendrapara", "Sundergarh": "Sundargarh",
    "Nowrangapur": "Nabarangpur", "Bail-Hongal": "Bailhongal", "Buldana": "Buldhana", "Wanparti": "Wanaparthy",
    "Kodar": "Kodad", "Bhaisa": "Bhainsa", "Kallakkurichchi": "Kallakurichi", "Kalpatta": "Kalpetta",
    "Cherrapunjee": "Sohra",  # renamed; Cherrapunji, the name people know, finds it (content/spots.json)
}

towns = []
for line in open(GEO / "cities1000.txt", encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if f[8] != "IN" or f[6] != "P":
        continue
    name, lat, lon, pop = f[2], float(f[4]), float(f[5]), int(f[14] or 0)
    state = STATE_FIX.get(states.get(f[10], ""), states.get(f[10], ""))
    # GeoNames gives some district seats their district's population: rank by it, don't show it
    doubtful = pop >= 150000 and f[7] not in ("PPLA", "PPLC")
    old = name if name in RENAME else ""
    towns.append({"name": RENAME.get(name, name), "state": state, "lat": lat, "lon": lon, "pop": pop, "doubtful": doubtful, "aka": old})

extra = json.load(open(ROOT / "content" / "spots.json"))
for e in extra["extra"]:
    towns.append({"name": e["name"], "state": e["state"], "lat": e["lat"], "lon": e["lon"], "pop": 0, "aka": e.get("aka", "")})

kept, why = [], Counter()
names_kept = set()
for t in sorted(towns, key=lambda t: -t["pop"]):
    p = (t["lat"], t["lon"])
    if nearest_station_km(p) <= 8:
        why["has a station within 8 km"] += 1
        continue
    key = re.sub(r"[^a-z]", "", t["name"].lower())
    if any(k == key and hav(p, ll) < 30 for k, ll in guide_at):
        why["already a guide at a station"] += 1
        continue
    if (key, t["state"]) in names_kept:
        why["same name twice in a state"] += 1
        continue
    names_kept.add((key, t["state"]))
    kept.append(t)
print(f"towns and places read: {len(towns)}; kept (no station of their own): {len(kept)}; {dict(why)}")

# the names people use for a place: Coorg is Madikeri
aka = defaultdict(list)
for alias, target in extra["aliases"].items():
    aka[target].append(alias)
for t in kept:
    t["aka"] = ", ".join(filter(None, [t.get("aka", ""), *aka.get(t["name"], [])]))
missing = [a for a, target in extra["aliases"].items() if not any(t["name"] == target for t in kept)]
if missing:
    print("aliases whose place isn't kept:", missing)

airports = []
for r in csv.DictReader(open(GEO / "airports.csv", encoding="utf-8")):
    if r["iso_country"] == "IN" and r["type"] in ("large_airport", "medium_airport") and r["scheduled_service"] == "yes" and r["iata_code"]:
        airports.append([r["iata_code"], re.sub(r"\s+Airport$", "", r["name"]), r["municipality"], round(float(r["latitude_deg"]), 4), round(float(r["longitude_deg"]), 4)])
print(f"airports with scheduled flights: {len(airports)}")

roads = json.loads((ROOT / "raw" / "roads.json").read_text()) if (ROOT / "raw" / "roads.json").exists() else {}
with_roads = 0
for t in kept:
    t["local"] = local_station((t["lat"], t["lon"]))
    t["local"] = RENAME.get(t["local"], t["local"])  # the station's name as the town's: Theni
    r = roads.get(f"{round(t['lat'], 4)},{round(t['lon'], 4)}")
    t["roads"] = ";".join(f"{k} {km} {mins}" for k, km, mins in r) if r is not None else None
    with_roads += r is not None
print(f"with real roads: {with_roads}; with only a local station: {sum(1 for t in kept if t['local'])}")

state_list = sorted({t["state"] for t in kept})
out = {
    "meta": {"sources": "GeoNames (CC BY 4.0), OurAirports (public domain), content/spots.json"},
    "states": state_list,
    # name, state, lat, lon, population (negative: not to be shown), other names, the station it
    # has with only local trains
    "spots": [[t["name"], state_list.index(t["state"]), round(t["lat"], 4), round(t["lon"], 4), -t["pop"] if t.get("doubtful") else t["pop"], t["aka"], t["local"]] for t in kept],
    "airports": sorted(airports),
}
path = ROOT / "data" / "spots.json"
path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print(f"wrote {path} ({path.stat().st_size // 1024} kB)")
# each place's roads, in the same order: "CODE km mins;@IATA km mins" (station or airport, km, the
# router's minutes); null where not fetched (the site estimates)
roads_path = ROOT / "data" / "roads.json"
roads_path.write_text(json.dumps([t["roads"] for t in kept], separators=(",", ":")))
print(f"wrote {roads_path} ({roads_path.stat().st_size // 1024} kB)")
