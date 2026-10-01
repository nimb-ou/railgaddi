"""Real road distances from places without a station to the stations (and airports) near them.

The site estimates a road from the straight line, which is fine on the plains and badly short in
the hills: Kodaikanal to Palani is 25 km as the crow flies and 57 km by the ghat road. For the
places people look up (the famous ones in content/spots.json, towns of 20,000 and more, and hill
towns of 5,000 and more) this asks an OSRM router (OpenStreetMap data, ODbL) for the driving
distance and time to the eight stations the site would consider and the two nearest airports,
and keeps the answers in raw/roads.json. build_spots.py then writes them into data/spots.json.

    python3 pipeline/build_spots.py       # the places
    python3 pipeline/fetch_roads.py       # their roads (only what isn't in raw/roads.json yet)
    python3 pipeline/build_spots.py       # the places, with their roads

One request a second, with a User-Agent, as the public OSRM server asks. A place no road reaches
(an island) is kept with no roads at all, which the site reads as "fly or take the ship".
"""
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "raw" / "roads.json"
OSRM = "https://router.project-osrm.org/table/v1/driving/"
UA = "Railgaddi/1.0 (https://github.com/nimb-ou/railgaddi; non-commercial train-discovery site)"
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def hilly(lat, lon):  # as isHilly() in src/core/spots.ts
    return (lat > 29.8 and lon < 81.5) or (lat > 26.4 and lon > 88) or (9 < lat < 13 and 75.4 < lon < 77.8)


def estimate(straight, hills):  # as road() in src/core/spots.ts
    kms = round(straight * (1.45 if hills else 1.3) + 2)
    return kms, round(kms / (32 if hills else 45) * 60 / 5) * 5 + 10


meta = json.loads((ROOT / "data" / "meta.json").read_text())
S = meta["stations"]
in_city = set()
places = []  # (code of the station that positions it, lat, lon, trains stopping)
for c in meta["cities"]:
    in_city.update(c["stations"])
    anchor = next((m for m in c["stations"] if S["lat"][m] is not None), c["stations"][0])
    if S["lat"][anchor] is not None:
        places.append((S["code"][anchor], S["lat"][anchor], S["lon"][anchor], sum(S["halts"][m] for m in c["stations"])))
for i, code in enumerate(S["code"]):
    if i not in in_city and S["lat"][i] is not None and S["halts"][i] >= 2:
        places.append((code, S["lat"][i], S["lon"][i], S["halts"][i]))

spots = json.loads((ROOT / "data" / "spots.json").read_text())
airports = spots["airports"]


# the hill railways' halts (as in build_network.py): people don't change from a toy train to the
# road, so they aren't candidates (their main-line ends are)
TOY = set("""KLK TSL GMM KOTI SWO DMP KMTI BOF SOL SLR KDZ KANO KEJ SGS TVI JTO SHZ SML
NJP SGUJ SN RTG TDH GBE MHN KGN TUNG SAD GHUM DJ MTP KXR HLG ADR RNE ONR WEL AVK KXT LOV UAM
PTK PTKC DLSR KAWL NUPR TLRA BLDL BRMR JWLS HRDR MGRP NGRS BRHL NDBT GULR LNS TRPL JMKR KPLR KGRA
KGMR SMLT NGRT CMMG PRAR SLHP PLMX PTRJ PHRH MNHL BJPL BJMR AHJU CTZ JDNX NRL JUM WHR AMAN MAE""".split()) - {
    "KLK", "NJP", "SGUJ", "MTP", "PTK", "PTKC", "NRL"}


def candidates(lat, lon):
    """The stations the site would weigh up (nearestStations in src/core/spots.ts), a few more."""
    hills = hilly(lat, lon)
    scored = []
    for code, plat, plon, halts in places:
        if code in TOY:
            continue
        d = hav((lat, lon), (plat, plon))
        if d > 350:
            continue
        mins = estimate(d, hills)[1]
        penalty = 180 if halts < 6 else 100 if halts < 20 else 50 if halts < 60 else 15 if halts < 120 else 0
        scored.append((mins + penalty, code, plat, plon))
    scored.sort()
    out = []
    for _, code, plat, plon in scored:
        if len(out) >= 8:
            break
        if any(hav((plat, plon), (o[1], o[2])) < 6 for o in out):
            continue
        out.append((code, plat, plon))
    return out


def wanted(s):
    name, _st, lat, lon, pop = s[:5]
    return pop == 0 or pop >= 20000 or (pop >= 5000 and hilly(lat, lon))


roads = json.loads(OUT.read_text()) if OUT.exists() else {}
# asked before toy-train halts were left out, and found fewer than three others: ask again
for k, v in list(roads.items()):
    if any(code in TOY for code, _, _ in v) and sum(1 for code, _, _ in v if not code.startswith("@") and code not in TOY) < 3:
        del roads[k]
todo = [s for s in spots["spots"] if wanted(s) and f"{s[2]},{s[3]}" not in roads][:LIMIT]
print(f"{sum(1 for s in spots['spots'] if wanted(s))} places want roads; {len(todo)} still to fetch")
for n, s in enumerate(todo, 1):
    name, _st, lat, lon = s[:4]
    near = candidates(lat, lon)
    ports = sorted(airports, key=lambda a: hav((lat, lon), (a[3], a[4])))[:2]
    pts = [(lon, lat)] + [(p[2], p[1]) for p in near] + [(a[4], a[3]) for a in ports]
    url = OSRM + ";".join(f"{x:.5f},{y:.5f}" for x, y in pts) + "?sources=0&annotations=distance,duration"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                d = json.loads(r.read())
            break
        except Exception as e:  # noqa: BLE001 (network hiccups: wait and try again)
            print(f"  {name}: {e}; retrying")
            time.sleep(5 * (attempt + 1))
    else:
        print(f"  {name}: gave up")
        continue
    if d.get("code") != "Ok":
        print(f"  {name}: {d.get('code')}")
        continue
    dist, dur = d["distances"][0], d["durations"][0]
    keys = [p[0] for p in near] + [f"@{a[0]}" for a in ports]
    roads[f"{lat},{lon}"] = [[k, round(dist[i + 1] / 1000), round(dur[i + 1] / 60)] for i, k in enumerate(keys) if dist[i + 1] is not None]
    if n % 25 == 0 or n == len(todo):
        OUT.write_text(json.dumps(roads, separators=(",", ":")))
        print(f"  {n}/{len(todo)}: {name} {roads[f'{lat},{lon}'][:2]}")
    time.sleep(1.05)
OUT.write_text(json.dumps(roads, separators=(",", ":")))
print(f"raw/roads.json: {len(roads)} places")
