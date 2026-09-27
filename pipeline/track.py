"""The railway as OpenStreetMap draws it (RAW/osm-rail/, from fetch_osm_rail.py), for finding
the stations a train passes between two halts, so its line on the map follows the real track.

    from track import Track
    t = Track(raw, stations)            # stations: {code: (lat, lon)}
    t.route("SBC", "SSPN")              # -> ["YNK", "GBD", …] or None

Stations snap to the nearest track within 1 km. The graph keeps only junctions and stations
(the points in between just add length), so all of India fits in memory comfortably. A route
is refused when it's a detour: longer than 1.5× the straight line plus 25 km.
"""
import heapq
import json
import math
from collections import defaultdict
from pathlib import Path


def hav(a, b):
    p = math.pi / 180
    x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


class Track:
    def __init__(self, raw: Path, stations: dict, snap_km=1.0):
        ways = {}
        for f in sorted((raw / "osm-rail").glob("*.json")):
            for e in json.loads(f.read_text())["elements"]:
                if e.get("type") == "way" and len(e.get("nodes", [])) >= 2:
                    ways[e["id"]] = e  # tiles overlap at their edges: one copy of each way
        self.pos = {}
        uses = defaultdict(int)
        for w in ways.values():
            for n, g in zip(w["nodes"], w["geometry"]):
                if g:
                    self.pos[n] = (g["lat"], g["lon"])
            for i, n in enumerate(w["nodes"]):
                uses[n] += 2 if i in (0, len(w["nodes"]) - 1) else 1
        # stations -> nearest track node, through a 0.02° grid
        grid = defaultdict(list)
        for n, (lat, lon) in self.pos.items():
            grid[(int(lat * 50), int(lon * 50))].append(n)
        self.node_of, self.station_at = {}, defaultdict(list)
        for code, (lat, lon) in stations.items():
            best, bd = None, snap_km
            gy, gx = int(lat * 50), int(lon * 50)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for n in grid.get((gy + dy, gx + dx), ()):
                        d = hav((lat, lon), self.pos[n])
                        if d < bd:
                            best, bd = n, d
            if best is not None:
                self.node_of[code] = best
                self.station_at[best].append(code)
        # yards and crossovers aren't fetched, so lines can stop just short of each other at a
        # station throat: bridge a loose end to the nearest other line within 250 m
        way_of = {}
        for w in ways.values():
            for n in w["nodes"]:
                way_of.setdefault(n, w["id"])
        bridges = []
        for w in ways.values():
            for n in (w["nodes"][0], w["nodes"][-1]):
                if uses[n] != 2 or n not in self.pos:
                    continue  # shared with another way already, or no position
                lat, lon = self.pos[n]
                best, bd = None, 0.25
                gy, gx = int(lat * 50), int(lon * 50)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        for m in grid.get((gy + dy, gx + dx), ()):
                            if way_of.get(m) != w["id"]:
                                d = hav((lat, lon), self.pos[m])
                                if d < bd:
                                    best, bd = m, d
                if best is not None:
                    bridges.append((n, best, bd))
        keep = {n for n, u in uses.items() if u >= 2} | set(self.station_at) | {m for _, m, _ in bridges}
        # edges between kept nodes, weighted by length along the track
        self.adj = defaultdict(dict)
        for w in ways.values():
            nodes = [n for n in w["nodes"] if n in self.pos]
            prev, length = None, 0.0
            for i, n in enumerate(nodes):
                if i:
                    length += hav(self.pos[nodes[i - 1]], self.pos[n])
                if n in keep:
                    if prev is not None and prev != n:
                        if length < self.adj[prev].get(n, 1e18):
                            self.adj[prev][n] = self.adj[n][prev] = length
                    prev, length = n, 0.0
        for a, b, d in bridges:
            if d < self.adj[a].get(b, 1e18):
                self.adj[a][b] = self.adj[b][a] = d
        self.bridges = len(bridges)
        self.stations = stations

    def route(self, a: str, b: str):
        """Stations passed between halts a and b along the track (in order, a and b excluded),
        or None when either isn't on the mapped track or the only route is a detour."""
        s, t = self.node_of.get(a), self.node_of.get(b)
        if s is None or t is None:
            return None
        if s == t:
            return []
        goal = self.pos[t]
        limit = hav(self.pos[s], goal) * 1.5 + 25
        dist, prev = {s: 0.0}, {}
        heap = [(hav(self.pos[s], goal), 0.0, s)]
        while heap:
            _, d, u = heapq.heappop(heap)
            if u == t:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w in self.adj[u].items():
                nd = d + w
                if nd < dist.get(v, 1e18) and nd + hav(self.pos[v], goal) <= limit:
                    dist[v], prev[v] = nd, u
                    heapq.heappush(heap, (nd + hav(self.pos[v], goal), nd, v))
        if t not in prev:
            return None
        path, u = [], prev[t]
        while u != s:
            path.append(u)
            u = prev[u]
        out = []
        for n in reversed(path):
            for code in self.station_at.get(n, ()):
                if code not in (a, b) and code not in out:
                    out.append(code)
        return out
