"""Places without a railway station, and the airports near them: data/spots.json.

Kodaikanal, Munnar, Manali, Gangtok, Leh: people go there by train and then by road. For each
town in GeoNames (population 1,000 and over) this keeps the ones more than 8 km from any station
that three or more trains stop at, plus the famous places in content/spots.json that aren't
towns (Kasol, the Valley of Flowers). The site works out the nearest stations itself, from the
timetable, so this only has to say where each place is.

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
for r in csv.DictReader(open(ROOT / "db" / "stations.csv")):
    if r["lat"] and trains_at[r["code"]] >= 3:
        served.append((float(r["lat"]), float(r["lon"])))
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


states = {}
for line in open(GEO / "admin1.txt", encoding="utf-8"):
    code, name, _ascii, _gid = line.rstrip("\n").split("\t")
    if code.startswith("IN."):
        states[code[3:]] = name
STATE_FIX = {"NCT": "Delhi", "State of Odisha": "Odisha"}

# guides the site already has (they sit at stations): a town of the same name isn't a new place
guides = json.load(open(ROOT / "data" / "places" / "index.json"))["articles"]
guide_at = [(re.sub(r"[^a-z]", "", t.lower()), g["ll"]) for t, g in guides.items() if g.get("ll")]

towns = []
for line in open(GEO / "cities1000.txt", encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if f[8] != "IN" or f[6] != "P":
        continue
    name, lat, lon, pop = f[2], float(f[4]), float(f[5]), int(f[14] or 0)
    state = STATE_FIX.get(states.get(f[10], ""), states.get(f[10], ""))
    towns.append({"name": name, "state": state, "lat": lat, "lon": lon, "pop": pop})

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

state_list = sorted({t["state"] for t in kept})
out = {
    "meta": {"sources": "GeoNames (CC BY 4.0), OurAirports (public domain), content/spots.json"},
    "states": state_list,
    # name, state, lat, lon, population, other names
    "spots": [[t["name"], state_list.index(t["state"]), round(t["lat"], 4), round(t["lon"], 4), t["pop"], t["aka"]] for t in kept],
    "airports": sorted(airports),
}
path = ROOT / "data" / "spots.json"
path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print(f"wrote {path} ({path.stat().st_size // 1024} kB)")
