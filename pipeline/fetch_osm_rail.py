"""Download India's railway track from OpenStreetMap (ODbL) into RAW/osm-rail/, one file per
4°×4° tile, so lines between halts can follow the real track (see pipeline/track.py).

Only tiles that contain a station in db/ are asked for. Each tile is cached; re-running fetches
only what's missing. Public Overpass servers are shared: one request at a time, and back off.

    python3 pipeline/fetch_osm_rail.py raw
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from db import read_table

RAW = Path(sys.argv[1])
OUT = RAW / "osm-rail"
OUT.mkdir(parents=True, exist_ok=True)
UA = "Railgaddi/1.0 (https://github.com/nimb-ou/railgaddi; non-commercial train-discovery site)"
MIRRORS = ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter"]
STEP = 4
# running lines only: no yards, sidings or spurs; metre and narrow gauge included
QUERY = '[out:json][timeout:170];way["railway"~"^(rail|narrow_gauge)$"]["service"!~"."]({s},{w},{n},{e});out skel geom qt;'

tiles = set()
for r in read_table("stations"):
    if r["lat"]:
        lat, lon = float(r["lat"]), float(r["lon"])
        tiles.add((int(lat // STEP) * STEP, int(lon // STEP) * STEP))
todo = sorted(t for t in tiles if not (OUT / f"{t[0]}_{t[1]}.json").exists())
print(f"{len(tiles)} tiles with stations; {len(todo)} to fetch")

for s, w in todo:
    body = urllib.parse.urlencode({"data": QUERY.format(s=s, w=w, n=s + STEP, e=w + STEP)}).encode()
    for attempt in range(8):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=200) as r:
                data = r.read()
            json.loads(data)  # a busy server answers with an HTML error page
            (OUT / f"{s}_{w}.json").write_bytes(data)
            print(f"  {s},{w}: {len(data) / 1e6:.1f} MB")
            time.sleep(5)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as e:
            wait = 20 * (attempt + 1)
            print(f"  {s},{w}: {type(e).__name__} from {url.split('/')[2]}; retrying in {wait}s")
            time.sleep(wait)
    else:
        print(f"  {s},{w}: giving up for now (run again later)")
print("done:", len(list(OUT.glob("*.json"))), "tiles cached")
