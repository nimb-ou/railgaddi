"""Put every station in the right state, by where it is on the map.

The station list came with states from before 2014 (no Telangana, "Orissa", Ladakh inside Jammu
and Kashmir) and plenty of plain mistakes (Dhanbad in West Bengal, Raichur in Andhra Pradesh).
This looks each station up in the state boundaries of datameet's States/Admin2 shapefile
(raw/Admin2.*, fetched by fetch_raw.sh; CC BY 2.5 IN) and rewrites db/stations.csv:

  - a station inside a state is in that state, unless it's within a kilometre or so of the
    state the source gave (a station on the border keeps what the source said: the boundaries
    are simplified, and some stations really do straddle one, like Bhawani Mandi);
  - a station outside every state (the coast, or across the border in Nepal or Bangladesh)
    takes the nearest state within 3 km, or else keeps what the source said;
  - the renamed states take their new names;
  - the name in the state's language (shown under a place's name) follows the state: it's read
    again from OpenStreetMap's node for the station (raw/osm_stations.json), so a station that
    moves from West Bengal to Jharkhand stops showing a Bengali name.

    python3 pipeline/fix_states.py           # rewrites db/stations.csv, prints what moved
    python3 pipeline/fix_states.py --dry     # only prints
"""
import json
import math
import struct
import sys
from pathlib import Path

from db import read_table, write_table

ROOT = Path(__file__).resolve().parent.parent
SHP = ROOT / "raw" / "Admin2"
DRY = "--dry" in sys.argv
RENAMED = {"Orissa": "Odisha", "Delhi NCT": "Delhi", "Pondicherry": "Puducherry", "Uttaranchal": "Uttarakhand",
           "Jammu & Kashmir": "Jammu and Kashmir", "Andaman & Nicobar": "Andaman and Nicobar Islands"}
SPLIT = {("Andhra Pradesh", "Telangana"), ("Jammu and Kashmir", "Ladakh")}  # states divided since the source
LANG = {  # as in import_ogd2017.py
    "Karnataka": "kn", "Tamil Nadu": "ta", "Kerala": "ml", "Andhra Pradesh": "te", "Telangana": "te",
    "Maharashtra": "mr", "Gujarat": "gu", "West Bengal": "bn", "Odisha": "or", "Punjab": "pa",
    "Assam": "as", "Puducherry": "ta", "Goa": "kok",
}
BORDER_KM = 1.2  # this close to the source's state: keep it
COAST_KM = 3.0  # outside every state but this close to one: that one


def read_states():
    """[(name, bbox, rings)] from the shapefile (polygons, WGS84 lon/lat)."""
    dbf = SHP.with_suffix(".dbf").read_bytes()
    n, head, size = struct.unpack("<IHH", dbf[4:12])
    width = dbf[32 + 16]  # one field, ST_NM
    names = []
    for i in range(n):
        raw = dbf[head + i * size + 1: head + i * size + 1 + width].decode("latin1").strip()
        names.append(RENAMED.get(raw, raw))
    shp = SHP.with_suffix(".shp").read_bytes()
    out, at, k = [], 100, 0
    while at < len(shp):
        words = struct.unpack(">I", shp[at + 4:at + 8])[0]
        body = shp[at + 8: at + 8 + words * 2]
        at += 8 + words * 2
        if struct.unpack("<i", body[:4])[0] == 5:
            bbox = struct.unpack("<4d", body[4:36])
            parts_n, points_n = struct.unpack("<ii", body[36:44])
            parts = list(struct.unpack(f"<{parts_n}i", body[44:44 + 4 * parts_n])) + [points_n]
            pts = struct.unpack(f"<{2 * points_n}d", body[44 + 4 * parts_n: 44 + 4 * parts_n + 16 * points_n])
            rings = [[(pts[2 * j], pts[2 * j + 1]) for j in range(parts[r], parts[r + 1])] for r in range(parts_n)]
            out.append((names[k], bbox, rings))
        k += 1
    return out


STATES = read_states()


def inside(x, y, rings):
    hit = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            (xi, yi), (xj, yj) = ring[i], ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def edge_km(x, y, rings):
    """Distance from a point to the nearest edge of a state, in km."""
    kx = 111.32 * math.cos(math.radians(y))
    best = math.inf
    for ring in rings:
        for (ax, ay), (bx, by) in zip(ring, ring[1:]):
            if abs(ax - x) > 0.3 and abs(bx - x) > 0.3 or abs(ay - y) > 0.3 and abs(by - y) > 0.3:
                continue  # far away: skip the arithmetic
            ax, ay, bx, by = (ax - x) * kx, (ay - y) * 111.32, (bx - x) * kx, (by - y) * 111.32
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
            best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def near(x, y, reach):
    return [s for s in STATES if s[1][0] - reach <= x <= s[1][2] + reach and s[1][1] - reach <= y <= s[1][3] + reach]


def state_at(lat, lon, cur):
    """(state, why) for a station; why is "" when it's simply inside one."""
    x, y = lon, lat
    here = [s for s in near(x, y, 0) if inside(x, y, s[2])]
    if here:
        name = here[0][0]
        if cur and cur != name and (cur, name) not in SPLIT:
            mine = [s for s in near(x, y, 0.05) if s[0] == cur]
            if mine and min(edge_km(x, y, s[2]) for s in mine) <= BORDER_KM:
                return cur, "border"
        return name, ""
    dists = sorted((edge_km(x, y, s[2]), s[0]) for s in near(x, y, 0.05))
    if dists and dists[0][0] <= COAST_KM:
        return dists[0][1], "coast"
    return cur, "outside"


def osm_nodes():
    """OpenStreetMap's station nodes by the codes they carry."""
    by_ref = {}
    for e in json.loads((ROOT / "raw" / "osm_stations.json").read_text())["elements"]:
        for ref in e.get("tags", {}).get("ref", "").upper().split(";"):
            if ref.strip():
                by_ref.setdefault(ref.strip(), []).append(e)
    return by_ref


def local_name(r, state, by_ref):
    """The station's name in its state's language, from the OSM node at the station."""
    lang = LANG.get(state)
    if not lang:
        return ""
    lat, lon = float(r["lat"]), float(r["lon"])
    for e in sorted(by_ref.get(r["code"], []), key=lambda e: (e["lat"] - lat) ** 2 + (e["lon"] - lon) ** 2):
        if abs(e["lat"] - lat) < 0.05 and abs(e["lon"] - lon) < 0.05:
            return e["tags"].get(f"name:{lang}", "")
    return ""


if __name__ == "__main__":
    rows = read_table("stations")
    by_ref = osm_nodes()
    moved, kept = [], []
    for r in rows:
        cur = RENAMED.get(r["state"], r["state"])
        if not r["lat"]:
            r["state"] = cur
            continue
        new, why = state_at(float(r["lat"]), float(r["lon"]), cur)
        if why in ("border", "outside") and cur:
            kept.append((r["code"], r["name"], cur, why))
        if new != cur and (cur, new) not in SPLIT:
            moved.append((r["code"], r["name"], cur or "-", new))
        if new != r["state"] and LANG.get(new) != LANG.get(r["state"]):
            r["local"] = local_name(r, new, by_ref)
        r["state"] = new
    print(f"moved {len(moved)} stations to another state (besides Telangana and Ladakh); kept {len(kept)} on borders or outside")
    for m in moved:
        print("  moved", *m)
    for k in kept:
        print("  kept ", *k)
    if not DRY:
        write_table("stations", rows)
