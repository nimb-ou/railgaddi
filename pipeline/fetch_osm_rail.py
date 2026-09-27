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
# running lines only: no yards, sidings or spurs; metre and narrow gauge included
QUERY = '[out:json][timeout:170];way["railway"~"^(rail|narrow_gauge)$"]["service"!~"."]({s},{w},{n},{e});out skel geom qt;'

STEP = 2  # 2°×2° boxes: small enough for busy public servers to answer in time

# what's cached already: "s_w.json" (older 4° files) or "s_w_step.json"
covered = []
for f in OUT.glob("*.json"):
    parts = [int(x) for x in f.stem.split("_")]
    covered.append((parts[0], parts[1], parts[2] if len(parts) > 2 else 4))

cells = set()
for r in read_table("stations"):
    if r["lat"]:
        lat, lon = float(r["lat"]), float(r["lon"])
        cells.add((int(lat // STEP) * STEP, int(lon // STEP) * STEP))


def have(s, w):
    return any(cs <= s and s + STEP <= cs + step and cw <= w and w + STEP <= cw + step for cs, cw, step in covered)


todo = sorted(c for c in cells if not have(*c))
print(f"{len(cells)} boxes with stations; {len(todo)} to fetch")


def fetch(s, w, step):
    """One box; True when saved. Busy servers answer with an HTML page or time out."""
    body = urllib.parse.urlencode({"data": QUERY.format(s=s, w=w, n=s + step, e=w + step)}).encode()
    for attempt in range(4):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=200) as r:
                data = r.read()
            json.loads(data)
            (OUT / f"{s}_{w}_{step}.json").write_bytes(data)
            print(f"  {s},{w} ({step}°): {len(data) / 1e6:.1f} MB")
            time.sleep(5)
            return True
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError, OSError) as e:
            wait = 20 * (attempt + 1)
            print(f"  {s},{w} ({step}°): {type(e).__name__} from {url.split('/')[2]}; retrying in {wait}s")
            time.sleep(wait)
    return False


for s, w in todo:
    if not fetch(s, w, STEP):
        print(f"  {s},{w}: giving up for now (run again later)")
print("done:", len(list(OUT.glob("*.json"))), "tiles cached")
