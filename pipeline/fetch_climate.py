"""What the land is like at every place: its height (and how hilly it is around it), and the usual
weather month by month. Cached in RAW/climate/, so a re-run only asks for what's new.

    python3 pipeline/fetch_climate.py raw

- Heights: OpenTopoData's public API over SRTM (90 m, public domain), 100 points a request. For each
  place with a guide, eight more points 5 km around it, so a hill town (Matheran, on a ridge) can
  be told from a high plateau city (Bengaluru, flat at 920 m).
- Weather normals: NASA POWER's climatology (MERRA-2: the mean temperature and mean daily range,
  for the usual day and night, and the rain), one request per grid cell (0.5 x 0.625 degrees). A cell's ground can be far lower
  than a hill town in it (Munnar's is 711 m, the town 1,485 m), so build_places.py corrects the
  temperatures for height. Wikivoyage's climate charts (most from the IMD's station tables) are
  used instead wherever a guide has one.
- The coastline: Natural Earth's 1:10m coastline (public domain), for "by the sea".

Sources: SRTM via OpenTopoData (public domain), NASA POWER (NASA Langley Research Center, free to use, credit
asked), Natural Earth (public domain).
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else "raw")
ROOT = Path(__file__).resolve().parent.parent
OUT = RAW / "climate"
(OUT / "power2").mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Railgaddi/1.0 (https://github.com/nimb-ou/railgaddi)"}


def get(url, tries=6):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            print(f"  retry after {e}")
            time.sleep(10 * (k + 1))


# ---------------------------------------------------------------- the places
ix = json.loads((ROOT / "data" / "places" / "index.json").read_text())
guides = {t: a["ll"] for t, a in ix["articles"].items() if a.get("ll")}
spots = json.loads((ROOT / "data" / "spots.json").read_text())["spots"]
spot_ll = {f"@{s[0]}|{s[2]:.3f},{s[3]:.3f}": (s[2], s[3]) for s in spots}
print(f"places with a guide: {len(guides)}; places without a station: {len(spot_ll)}")

# ---------------------------------------------------------------- heights
RING = [(math.cos(a) * 5 / 111, math.sin(a) * 5 / 111) for a in [k * math.pi / 4 for k in range(8)]]  # 5 km out


def key(lat, lon):
    return f"{lat:.4f},{lon:.4f}"


points = set()
for lat, lon in guides.values():
    points.add(key(lat, lon))
    for dy, dx in RING:
        points.add(key(lat + dy, lon + dx / max(0.2, math.cos(math.radians(lat)))))
for lat, lon in spot_ll.values():
    points.add(key(lat, lon))

elev_file = OUT / "elevation.json"
elev = json.loads(elev_file.read_text()) if elev_file.exists() else {}
todo = sorted(p for p in points if p not in elev)
print(f"heights: {len(points)} points, {len(todo)} to fetch")
for i in range(0, len(todo), 100):
    batch = todo[i:i + 100]
    r = get("https://api.opentopodata.org/v1/srtm90m?locations=" + "|".join(batch))
    for p, res in zip(batch, r["results"]):
        elev[p] = res["elevation"]  # None over the sea
    if (i // 100) % 10 == 9 or i + 100 >= len(todo):
        elev_file.write_text(json.dumps(elev, separators=(",", ":")))
        print(f"  {min(i + 100, len(todo))} of {len(todo)}")
    time.sleep(1.1)  # the public API asks for one request a second
elev_file.write_text(json.dumps(elev, separators=(",", ":")))

# ---------------------------------------------------------------- weather normals, by grid cell
def cell(lat, lon):
    return round(lat / 0.5) * 0.5, round(lon / 0.625) * 0.625


# the places with a guide first: they're what the lenses and the strip are for
first = sorted({cell(*ll) for ll in guides.values()})
cells = first + sorted({cell(*ll) for ll in spot_ll.values()} - set(first))
todo = [c for c in cells if not (OUT / "power2" / f"{c[0]:.2f}_{c[1]:.3f}.json").exists()]
print(f"weather normals: {len(cells)} grid cells, {len(todo)} to fetch")


def fetch_cell(c):
    # T2M_MAX and T2M_MIN here are each month's extremes (Delhi's January "max" is 31 degC); the
    # usual day and night are the mean temperature plus and minus half the mean daily range
    q = urllib.parse.urlencode({"parameters": "T2M,T2M_RANGE,PRECTOTCORR", "community": "RE", "latitude": c[0], "longitude": c[1], "format": "JSON"})
    d = get(f"https://power.larc.nasa.gov/api/temporal/climatology/point?{q}")
    p = d["properties"]["parameter"]
    hi = {m: p["T2M"][m] + p["T2M_RANGE"][m] / 2 for m in p["T2M"]}
    lo = {m: p["T2M"][m] - p["T2M_RANGE"][m] / 2 for m in p["T2M"]}
    out = {"elev": d["geometry"]["coordinates"][2], "hi": hi, "lo": lo, "rain": p["PRECTOTCORR"]}
    (OUT / "power2" / f"{c[0]:.2f}_{c[1]:.3f}.json").write_text(json.dumps(out))
    return c


# one at a time, with a breath between: POWER answers "too many requests" to more; a cell that
# still fails is left for the next run (everything fetched so far is cached)
failed = 0
for done, c in enumerate(todo, 1):
    try:
        fetch_cell(c)
    except Exception as e:  # noqa: BLE001
        failed += 1
        print(f"  {c}: {e}")
    if done % 25 == 0 or done == len(todo):
        print(f"  {done} of {len(todo)}{f', {failed} failed' if failed else ''}")
    time.sleep(1.5)

# ---------------------------------------------------------------- the coastline
coast = OUT / "ne_10m_coastline.geojson"
if not coast.exists():
    url = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        g = json.loads(r.read())
    # keep the coasts near India
    keep = []
    for f in g["features"]:
        lines = f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiLineString" else [f["geometry"]["coordinates"]]
        for ln in lines:
            if any(60 <= x <= 100 and 0 <= y <= 40 for x, y in ln):
                keep.append(ln)
    coast.write_text(json.dumps({"lines": keep}, separators=(",", ":")))
    print(f"coastline: {len(keep)} lines near India")
print("done")
