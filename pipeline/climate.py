"""The usual weather month by month, and what kind of place somewhere is, from the caches that
fetch_climate.py fills (RAW/climate/). Used by build_places.py and build_spots.py.

Weather, in order of trust:
  1. a Wikivoyage guide's climate chart: most quote the IMD's station tables (1991-2020);
  2. NASA POWER's climatology for the grid cell (the mean temperature plus and minus half the mean
     daily range, for the usual day and night; 2001-2020), its temperatures moved by 6.5 degC a kilometre
     for the difference between the town's height and the cell's (Munnar's cell is 711 m, the
     town 1,485 m: about 5 degC cooler than the cell says).

Each month gets one letter, for the "when to go" strip and the "good this month" lens:
  B best (warm, dry, comfortable), G good, R rainy, M muggy hot, H too hot, W very wet, C cold.
"""
import json
import math
import re
from pathlib import Path

DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
LAPSE = 6.5 / 1000  # degC per metre


class Climate:
    def __init__(self, raw: Path):
        d = raw / "climate"
        self.elev = json.loads((d / "elevation.json").read_text()) if (d / "elevation.json").exists() else {}
        self.cells = {}
        for f in (d / "power2").glob("*.json"):
            lat, lon = f.stem.split("_")
            self.cells[(float(lat), float(lon))] = json.loads(f.read_text())
        coast = d / "ne_10m_coastline.geojson"
        self.coast = json.loads(coast.read_text())["lines"] if coast.exists() else []
        self._coast_index = None

    # ---------------------------------------------------------------- height
    @staticmethod
    def key(lat, lon):
        return f"{lat:.4f},{lon:.4f}"

    def height(self, lat, lon):
        return self.elev.get(self.key(lat, lon))

    def hilliness(self, lat, lon):
        """Highest minus lowest of the town and eight points 5 km around it (None if not fetched)."""
        hs = [self.height(lat, lon)]
        for k in range(8):
            a = k * math.pi / 4
            dy, dx = math.cos(a) * 5 / 111, math.sin(a) * 5 / 111
            hs.append(self.height(lat + dy, lon + dx / max(0.2, math.cos(math.radians(lat)))))
        hs = [h for h in hs if h is not None]
        return max(hs) - min(hs) if len(hs) >= 5 else None

    # ---------------------------------------------------------------- the coast
    def coast_km(self, lat, lon):
        """Distance to the sea's edge, in km (Natural Earth 1:10m coastline)."""
        if self._coast_index is None:
            grid = {}
            for ln in self.coast:
                for (x0, y0), (x1, y1) in zip(ln, ln[1:]):
                    for gx in range(int(min(x0, x1) // 0.5), int(max(x0, x1) // 0.5) + 1):
                        for gy in range(int(min(y0, y1) // 0.5), int(max(y0, y1) // 0.5) + 1):
                            grid.setdefault((gx, gy), []).append((x0, y0, x1, y1))
            self._coast_index = grid
        best = math.inf
        cos = math.cos(math.radians(lat))
        gx, gy = int(lon // 0.5), int(lat // 0.5)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for x0, y0, x1, y1 in self._coast_index.get((gx + dx, gy + dy), ()):
                    # nearest point on the segment, in a local flat frame (km)
                    ax, ay = (x0 - lon) * 111 * cos, (y0 - lat) * 111
                    bx, by = (x1 - lon) * 111 * cos, (y1 - lat) * 111
                    vx, vy = bx - ax, by - ay
                    t = max(0.0, min(1.0, -(ax * vx + ay * vy) / (vx * vx + vy * vy or 1)))
                    best = min(best, math.hypot(ax + t * vx, ay + t * vy))
        return best

    # ---------------------------------------------------------------- weather
    def estimate(self, lat, lon):
        """NASA POWER's normals for the cell, corrected for the town's height: [[lo, hi, mm]] x 12."""
        c = self.cells.get((round(lat / 0.5) * 0.5, round(lon / 0.625) * 0.625))
        if not c:
            return None
        h = self.height(lat, lon)
        shift = (h - c["elev"]) * LAPSE if h is not None and c.get("elev") is not None else 0.0
        return [[c["lo"][m] - shift, c["hi"][m] - shift, c["rain"][m] * DAYS[i]] for i, m in enumerate(MONTHS)]

    def normals(self, lat, lon, wikitext=None):
        """(months, source): source "imd" when it's a guide's climate chart, "est" when estimated."""
        chart = chart_of(wikitext) if wikitext else None
        if chart:
            return chart, "imd"
        est = self.estimate(lat, lon) if lat is not None else None
        return (est, "est") if est else (None, "")


def chart_of(text):
    """A Wikivoyage {{climate chart}}: twelve rows of low, high (degC) and rain (mm)."""
    m = re.search(r"\{\{\s*climate chart\s*\|(.*?)\}\}", text or "", re.I | re.S)
    if not m:
        return None
    body = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", m.group(1))  # [[w:Lucknow#Climate|Wikipedia]] -> Wikipedia
    if re.search(r"\|\s*(imperial|units)\s*=\s*(yes|imperial|F)", body, re.I):
        return None  # Fahrenheit and inches: none of India's guides, and not worth converting
    parts = [p.strip() for p in body.split("|")]
    nums = []
    for p in parts[1:]:  # the first is the chart's title
        if "=" in p:
            continue
        p = p.replace("−", "-").replace(",", "")
        try:
            nums.append(float(p))
        except ValueError:
            if p:
                return None
    if len(nums) < 36:
        return None
    months = [nums[i * 3:i * 3 + 3] for i in range(12)]
    for lo, hi, mm in months:
        if not (-40 <= lo <= 40 and -30 <= hi <= 50 and lo <= hi and 0 <= mm <= 3000):
            return None
    return months


def letter(lo, hi, mm):
    """One month, as a traveller feels it."""
    if hi < 10 or lo < -6:
        return "C"  # cold: Leh in January
    if mm >= 300:
        return "W"  # very wet: the monsoon on the coast and in the Ghats
    if hi >= 39:
        return "H"  # too hot: Rajasthan in May
    if mm >= 140:
        return "R"  # rainy
    if hi >= 35:
        return "M"  # hot, bearable
    if 16 <= hi <= 32 and mm < 70 and lo >= 4:
        return "B"
    return "G"


def letters(months):
    return "".join(letter(lo, hi, mm) for lo, hi, mm in months) if months else ""


def flat(months):
    return [round(v) for m in months for v in m] if months else None


# ---------------------------------------------------------------- moods
SEA, HILLS, SPIRIT, HERITAGE, WILD = 1, 2, 4, 8, 16
SPIRITUAL = re.compile(r"\b(temple|mandir|devasthan|kovil|koil|masjid|mosque|dargah|church|cathedral|basilica|gurdwara|gurudwara|"
                       r"monastery|gompa|stupa|shrine|jain|basadi|ashram|math|mutt|ghat|jyotirlinga|shakti peeth|pilgrimage)\b", re.I)
HISTORIC = re.compile(r"\b(fort|qila|kila|palace|mahal|ruins?|archaeological|caves?|tomb|maqbara|mausoleum|stepwell|baori|bawdi|vav|"
                      r"haveli|world heritage|monuments?|citadel|chhatri|cenotaph|minar|gateway)\b", re.I)
WILDLIFE = re.compile(r"\b(national park|wildlife|sanctuary|tiger reserve|biosphere|elephant camp|safari)\b", re.I)
GREEN = re.compile(r"\b(waterfalls?|falls|forests?|tea (estates?|gardens?)|backwaters?|glaciers?|meadows?|valley|trek(king)?|national park|wildlife|sanctuary)\b", re.I)
BEACH = re.compile(r"\b(beach(es)?|sea ?face|seashore|lighthouse|promenade)\b", re.I)
SEASIDE = re.compile(r"\b(beach(es)?|coast(al|line)?|seaside|sea ?shore|Arabian Sea|Bay of Bengal|Laccadive Sea|Indian Ocean|port town)\b", re.I)
RUINS = re.compile(r"World Heritage Site|\bruins\b|\bforts?\b|\bpalaces?\b|\bcitadel\b", re.I)


# on a creek, an estuary or a lagoon the coastline traces, not the open sea
NOT_SEASIDE = {"Thane", "Navi Mumbai", "Bharuch", "Kundara", "Aroor", "Tada", "Wimco Nagar", "Kottayam", "Kolaghat", "Tamluk"}


def moods(core, near, intro, coast_km, height, hilly, pilgrimage=False, city=False, top=(), title=""):
    """What kind of place somewhere is: by the sea, in the hills, a temple town, forts and palaces,
    wild and green. `core`: the names and descriptions of what its guide lists and we show;
    `near`: every photographed landmark within 12 km too; `intro`: the guide's first lines; `top`:
    the three sights shown first."""
    m = 0
    n = max(1, len(core))
    count = lambda rx, items: sum(1 for x in items if rx.search(x))  # noqa: E731
    # near the sea's edge, with a beach to go to (Thane is near the sea; nobody goes there for it)
    seaside = coast_km <= 2 or (coast_km <= 8 and (count(BEACH, near) >= 1 or SEASIDE.search(intro or ""))) or (coast_km <= 15 and count(BEACH, core) >= 2)
    if seaside and title not in NOT_SEASIDE:
        m |= SEA
    if height is not None and (height >= 1000 or (height >= 550 and hilly is not None and hilly >= 450)):
        m |= HILLS
    spirit = count(SPIRITUAL, core)
    # nearly every town's guide lists a few temples: a temple town is one that's mostly temples
    if pilgrimage or (not city and spirit >= 8 and spirit / n >= 0.6):
        m |= SPIRIT
    historic = count(HISTORIC, core)
    if (historic >= 4 and historic / n >= 0.25) or (historic >= 3 and count(HISTORIC, top)) or (historic >= 2 and RUINS.search(intro or "")):
        m |= HERITAGE
    green, wild = count(GREEN, core), count(WILDLIFE, core)
    if not city and green + wild >= 3 and (green + wild) / n >= 0.25:
        m |= WILD
    return m


def mood_counts(text_items):
    """How many of a place's sights are of each kind (for checking the moods' thresholds)."""
    return {name: sum(1 for x in text_items if rx.search(x)) for name, rx in
            (("spirit", SPIRITUAL), ("historic", HISTORIC), ("wildlife", WILDLIFE), ("green", GREEN), ("beach", BEACH))}
