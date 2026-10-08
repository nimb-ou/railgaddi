"""Make lines follow the track: for every stretch between two halts that db/ draws as a straight
line (no stations passed recorded in paths.csv), find the stations it passes along
OpenStreetMap's railway (track.py) and record them. Stretches that already have a path keep it.

    python3 pipeline/fetch_osm_rail.py raw      # once: India's track, by tile
    python3 pipeline/route_paths.py raw         # fills paths.csv, then run build_network.py
"""
import sys
from collections import defaultdict
from pathlib import Path

from db import read_table, write_table
from track import Track, hav

RAW = Path(sys.argv[1])
MIN_KM = 15  # shorter stretches look straight anyway

stations = {r["code"]: (float(r["lat"]), float(r["lon"])) for r in read_table("stations") if r["lat"]}
# positions set by hand (db/station_overrides.csv), as build_network.py applies them
pos = {}
for o in read_table("station_overrides"):
    if o["field"] in ("lat", "lon"):
        pos.setdefault(o["code"], {})[o["field"]] = float(o["value"])
stations.update({c: (p["lat"], p["lon"]) for c, p in pos.items() if "lat" in p and "lon" in p})
track = Track(RAW, stations)
print(f"track: {len(track.adj)} junctions and stations; {len(track.node_of)} of {len(stations)} stations on it")

halts = defaultdict(list)
for h in read_table("halts"):
    halts[h["number"]].append(h)
paths = read_table("paths")
have = {(p["number"], int(p["after"])) for p in paths}
added = tried = 0
for no, hs in halts.items():
    hs.sort(key=lambda h: int(h["seq"]))
    for a, b in zip(hs, hs[1:]):
        key = (no, int(a["seq"]))
        if key in have or a["station"] not in stations or b["station"] not in stations:
            continue
        if hav(stations[a["station"]], stations[b["station"]]) < MIN_KM:
            continue
        tried += 1
        passed = track.route(a["station"], b["station"])
        if passed:
            paths.append({"number": no, "after": key[1], "via": " ".join(passed)})
            added += 1
write_table("paths", sorted(paths, key=lambda p: (p["number"], int(p["after"]))))
print(f"straight stretches: {tried}; now following the track: {added} ({added / max(1, tried):.0%})")
