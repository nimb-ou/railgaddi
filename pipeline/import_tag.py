"""Read the official Indian Railways timetable, *Trains at a Glance* (TAG), into Railgaddi's database.

⚠ The timetable says: "No part of the Timetable including the Train Timings should be reproduced
without the written permission of the publishers." Until Railgaddi has that permission (see
docs/permission-requests.md) this importer only writes to RAW/tag<year>/parsed.json and a report
for checking; nothing reaches db/ or the site. merge_tag.py does that, once permission is
recorded in docs/permissions/.

TAG is 97 route tables of PDF, trains as columns and stations as rows. For each page this reads
the drawn grid (column rules), the train-number and running-days rows, and every station row's
'a' (arrival) / 'd' (departure) markers, then stitches each train's pieces across tables using
the "From Table No." / "To Table No." rows. Station names become codes through TAG's own
station index, then db/stations.csv, choosing by distance from the neighbouring halts.

    pipeline/fetch_tag.sh raw 2026              # download the PDFs
    python3 pipeline/import_tag.py raw 2026     # parse, check, report (RAW/tag2026/)
    python3 pipeline/merge_tag.py raw 2026      # into db/ (only once permission is recorded)
"""
import difflib
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import fitz  # PyMuPDF

from db import days_text, fmt_time, read_table

RAW = Path(sys.argv[1])
YEAR = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].isdigit() else "2026"
SRC = RAW / f"tag{YEAR}"
TIME = re.compile(r"^(\d{1,2})[.:](\d{2})$")
NUMBER = re.compile(r"^(\d{5})\D{0,3}$")
DAY_ABBR = {"m": 0, "mon": 0, "tu": 1, "tue": 1, "w": 2, "wed": 2, "th": 3, "thu": 3, "f": 4, "fri": 4,
            "sa": 5, "sat": 5, "su": 6, "sun": 6}


# ---------------------------------------------------------------- one page
def rules(page):
    """x positions of the vertical rules that separate the train columns (drawn in pieces)."""
    segs = []
    for g in page.get_drawings():
        for it in g["items"]:
            if it[0] == "l" and abs(it[1].x - it[2].x) < 0.6:
                segs.append((it[1].x, abs(it[1].y - it[2].y)))
            elif it[0] == "re" and it[1].width < 1.5:
                segs.append((it[1].x0, it[1].height))
    total = defaultdict(float)
    for x, length in segs:
        total[round(x)] += length
    out = []
    for x in sorted(x for x, length in total.items() if length > 150):
        if not out or x - out[-1] > 3:
            out.append(x)
    return out


def hsegments(page):
    out = []
    for g in page.get_drawings():
        for it in g["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.6:
                a, b = sorted((it[1].x, it[2].x))
                out.append((it[1].y, a, b))
            elif it[0] == "re" and it[1].height < 1.5:
                out.append((it[1].y0, it[1].x0, it[1].x1))
    return out


def join_name(words):
    """Header words, top to bottom, into a name: "Mahan-" + "anda" -> "Mahananda"."""
    out = ""
    for w in words:
        w = w.replace("\u00ad", "")
        if out.endswith("-") and w[:1].islower():
            out = out[:-1] + w
        else:
            out += (" " if out else "") + w
    return re.sub(r"\s+", " ", out).strip()


def row_rules(page, x0, x1):
    """y positions of the horizontal rules crossing the station-name column."""
    ys = set()
    for g in page.get_drawings():
        for it in g["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 0.6:
                a, b = sorted((it[1].x, it[2].x))
            elif it[0] == "re" and it[1].height < 1.5:
                a, b = it[1].x0, it[1].x1
            else:
                continue
            if a < x0 + 4 and b > x1 - 4:
                ys.add(round(it[1].y if it[0] == "l" else it[1].y0, 1))
    return sorted(ys)


def label_y(words, marker_x, *needles):
    """y of a row label in the left column ("Train Number", "Days of departure", …)."""
    for w in words:
        if w[2] < marker_x and w[4].lower() in needles:
            return (w[1] + w[3]) / 2
    return None


def parse_days(text):
    t = text.replace("–", "-").replace(" ", "").lower()
    if not t:
        return 0
    if "daily" in t:
        return 127
    m = re.match(r"except(.+)", t)
    body = m.group(1) if m else t
    mask = 0
    for part in re.split(r"[,&/]+|-(?=[a-z])", body):
        part = part.strip(".-")
        if part in DAY_ABBR:
            mask |= 1 << DAY_ABBR[part]
        elif part:
            return 0  # something we don't understand: leave the days unknown
    return (127 & ~mask) if m else mask


def parse_page(page, table):
    words = page.get_text("words")
    marks = [w for w in words if w[4] in ("a", "d") and (w[2] - w[0]) < 6]
    if len(marks) < 3:
        return []
    marker_x = Counter(round(w[0]) for w in marks).most_common(1)[0][0]
    marks = [w for w in marks if abs(w[0] - marker_x) < 3]
    cols = [x for x in rules(page) if x > marker_x + 2]
    if len(cols) < 2:
        return []
    bands = list(zip(cols, cols[1:]))

    y_no = label_y(words, marker_x, "number")
    y_days = label_y(words, marker_x, "departure")
    y_from = next((((w[1] + w[3]) / 2) for w in words if w[2] < marker_x and w[4] == "From"), None)
    y_to = next((((w[1] + w[3]) / 2) for w in words if w[2] < marker_x and w[4] == "To"
                 and any(v[4] == "Table" and abs(v[1] - w[1]) < 2 for v in words)), None)
    y_arrival = label_y(words, marker_x, "arrival")
    if y_no is None:
        return []
    top = max(y for y in (y_no, y_days, y_from) if y is not None) + 4
    bottom = min(y for y in (y_arrival, y_to, page.rect.height) if y is not None) - 3

    def in_band(w, b):
        cx = (w[0] + w[2]) / 2
        return b[0] < cx < b[1]

    def cell(b, y, dy=4.5):
        return " ".join(w[4] for w in sorted(words, key=lambda w: (round(w[1]), w[0]))
                        if in_band(w, b) and abs((w[1] + w[3]) / 2 - y) < dy)

    hsegs = hsegments(page)
    columns = []
    for b in bands:
        m = next((NUMBER.match(w[4]) for w in words if in_band(w, b) and abs((w[1] + w[3]) / 2 - y_no) < 4 and NUMBER.match(w[4])), None)
        if not m:
            columns.append(None)
            continue
        # the days cell can wrap onto two lines
        days = cell(b, y_days, 7) if y_days is not None else ""
        # the name cell: between the two rules above the train-number row
        rules_here = sorted(y for y, a, c in hsegs if a <= b[0] + 3 and c >= b[1] - 3 and y < y_no - 2)
        r1 = rules_here[-1] if rules_here else y_no - 4
        r0 = next((y for y in reversed(rules_here) if y < r1 - 4), r1 - 45)
        name = join_name(w[4] for w in sorted(words, key=lambda w: (round(w[1]), w[0]))
                         if in_band(w, b) and r0 < (w[1] + w[3]) / 2 < r1)
        columns.append({"no": m.group(1), "name": name, "table": table, "days": parse_days(days), "days_text": days,
                        "from": cell(b, y_from) if y_from else "", "to": cell(b, y_to) if y_to else "", "halts": []})

    # station rows: an 'a', a 'd', or an 'a' directly above a 'd'
    marks = sorted((w for w in marks if top < w[1] < bottom), key=lambda w: w[1])
    groups, i = [], 0
    while i < len(marks):
        w = marks[i]
        if w[4] == "a" and i + 1 < len(marks) and marks[i + 1][4] == "d" and marks[i + 1][1] - w[1] < 9:
            groups.append({"a": (w[1] + w[3]) / 2, "d": (marks[i + 1][1] + marks[i + 1][3]) / 2})
            i += 2
        else:
            groups.append({w[4]: (w[1] + w[3]) / 2})
            i += 1
    name_x0 = min((w[0] for w in words if w[2] < marker_x - 1 and w[4] in ("Km.", "Km")), default=0)
    hrules = row_rules(page, name_x0 + 12, marker_x - 2)
    for k, g in enumerate(groups):
        y0, y1 = min(g.values()) - 5.5, max(g.values()) + 5.5
        # never reach into the neighbouring rows: stop at the printed rules, else halfway
        if k > 0:
            y0 = max(y0, (max(groups[k - 1].values()) + min(g.values())) / 2)
        if k + 1 < len(groups):
            y1 = min(y1, (max(g.values()) + min(groups[k + 1].values())) / 2)
        above = [y for y in hrules if y <= min(g.values()) - 1]
        below = [y for y in hrules if y >= max(g.values()) + 1]
        if above:
            y0 = max(y0, above[-1])
        if below:
            y1 = min(y1, below[0])
        left = [w for w in words if w[2] < marker_x - 1 and y0 < (w[1] + w[3]) / 2 < y1 and w[0] >= name_x0 - 1]
        km = next((float(w[4]) for w in left if re.fullmatch(r"\d+", w[4]) and w[0] < name_x0 + 12), None)
        name = " ".join(w[4] for w in sorted(left, key=lambda w: (round(w[1]), w[0]))
                        if not (re.fullmatch(r"\d+", w[4]) and w[0] < name_x0 + 12) and w[4] not in ("Km.", "Km"))
        name = re.sub(r"\s*\u00ad\s*", "", name).replace("- ", "-").strip()  # soft hyphens where names wrap
        name = re.sub(r"(?<=[A-Za-z])\d+\s+(?=[a-z])", "", name)  # a km figure printed inside a wrapped name
        name = " ".join(t for t in name.split() if not re.search(r"\d", t) and t not in ("a", "d"))
        if not name:
            continue
        for b, col in zip(bands, columns):
            if col is None:
                continue
            toks = sorted((w for w in words if in_band(w, b) and y0 < (w[1] + w[3]) / 2 < y1), key=lambda w: w[1])
            times = [((w[1] + w[3]) / 2, TIME.match(w[4])) for w in toks if TIME.match(w[4])]
            times = [(y, int(m.group(1)) * 60 + int(m.group(2))) for y, m in times]
            other = [w[4] for w in toks if not TIME.match(w[4]) and w[4] not in ("...", "..", "…")]
            if not times:
                continue
            col["halts"].append({"name": name, "km": km, "times": times, "marks": g, "alt": " ".join(other)})
    return [c for c in columns if c and c["halts"]]


def resolve_times(col):
    """Turn each halt's (y, minutes) readings into arrival/departure."""
    n = len(col["halts"])
    for j, h in enumerate(col["halts"]):
        g, ts = h["marks"], h["times"]
        arr = dep = None
        if len(ts) >= 2:
            arr, dep = ts[0][1], ts[-1][1]
        elif "a" in g and "d" in g:
            y, t = ts[0]
            first, last = j == 0 and not col["from"], j == n - 1 and not col["to"]
            if first:
                dep = t
            elif last:
                arr = t
            elif abs(y - g["a"]) < abs(y - g["d"]):
                arr = t
            else:
                dep = t
        elif "a" in g:
            arr = ts[0][1]
        else:
            dep = ts[0][1]
        h["arr"], h["dep"] = arr, dep


# ---------------------------------------------------------------- station names -> codes
# spellings that differ between TAG, the 2017 timetable and OpenStreetMap
SPELLING = {"BANGALORE": "BENGALURU", "CANT": "CANTT", "SUBHASH": "SUBHAS", "LAXMIBAI": "LAKSHMIBAI",
            "VIRANGNA": "VIRANGANA", "VISHVESVARAYA": "VISVESVARAYA", "VISHWESHWARAIAH": "VISVESVARAYA",
            "VISVESVARAIAH": "VISVESVARAYA", "PT": "", "PANDIT": "", "KM": ""}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().upper()
    s = s.split("/")[0]  # "Lucknow/ Lucknow Jn." -> the first name
    s = s.replace("(T)", " TERMINUS ").replace("(NR)", " LUCKNOW CHARBAGH ").replace("(NER)", " LUCKNOW JN ")
    s = s.replace("CANTONMENT", "CANTT").replace("CANTT", " CANTT ")
    s = re.sub(r"\bTERMINAL\b", "TERMINUS", s)
    s = re.sub(r"\b(JN|JUNCTION|RLY|RAILWAY|STATION|HALT)\b|[^A-Z ]", " ", s)
    words = [("TERMINUS" if w == "T" and i else SPELLING.get(w, w)) for i, w in enumerate(s.split())]  # "… T. Bengaluru", not "T. Nagar"
    words = [w for i, w in enumerate(words) if w and w not in words[:i]]  # "Lucknow (NR)" -> LUCKNOW CHARBAGH once
    return " ".join(words)


def station_index(stations, pos):
    """Every name we know a station by (2017 name, OpenStreetMap's current and old names, TAG's
    own index) -> codes. OpenStreetMap also fills in positions for codes new since 2017."""
    idx = defaultdict(set)
    for code, s in stations.items():
        idx[norm(s["name"])].add(code)
    osm = RAW / "osm_stations.json"
    if osm.exists():
        for e in json.loads(osm.read_text())["elements"]:
            t = e.get("tags", {})
            if t.get("station") in {"subway", "light_rail", "monorail"}:
                continue
            for ref in t.get("ref", "").upper().split(";"):
                ref = ref.strip()
                if not re.fullmatch(r"[A-Z]{1,5}", ref):
                    continue
                pos.setdefault(ref, (e["lat"], e["lon"]))
                for k in ("name", "name:en", "alt_name", "old_name", "official_name", "old_name:en", "name:long"):
                    for n in t.get(k, "").split(";"):
                        if n and n.isascii():
                            idx[norm(n)].add(ref)
    path = SRC / "Station_Code_Index.pdf"
    if path.exists():
        for page in fitz.open(path):
            ws = page.get_text("words")
            # four "Station Name | Code" column pairs per page
            heads = sorted(w[0] for w in ws if w[4] == "Station")
            codes = sorted(w[0] for w in ws if w[4] == "Code")
            pairs = [(sx, min((cx for cx in codes if 60 < cx - sx < 130), default=None)) for sx in heads]
            pairs = [(sx, cx) for sx, cx in pairs if cx is not None]
            for i, (sx, cx) in enumerate(pairs):
                x_end = pairs[i + 1][0] - 3 if i + 1 < len(pairs) else page.rect.width
                lines = defaultdict(lambda: ([], []))
                for w in ws:
                    if sx - 3 <= w[0] < x_end and w[4] not in ("Station", "Name", "Code"):
                        lines[round(w[1])][1 if w[0] >= cx - 8 else 0].append(w[4])
                for name, code in lines.values():
                    code = "".join(code).replace("0", "O")
                    if name and re.fullmatch(r"[A-Z]{1,5}", code):
                        idx[norm(" ".join(name))].add(code)
    return idx


ABBR = {"PT": "PANDIT", "NSCB": "NETAJI SUBHAS CHANDRA BOSE", "SSS": "SHREE SIDDHAROODHA SWAMIJI",
        "KSR": "KRANTIVIRA SANGOLLI RAYANNA", "MGR": "PURATCHI THALAIVAR DR M G RAMACHANDRAN"}


def resolve(name, idx, pos, near_to, rail_km=None, expected=()):
    """A station code for a printed name. With a neighbouring halt already placed, the answer must
    lie within the rail distance TAG prints between them (straight lines are never longer than the
    track). Tries the exact name; then stations whose name contains every word ("Nizamuddin" ->
    Hazrat Nizamuddin); then the closest spelling nearby (TAG has typos). Among several, stations
    this train served before win, then the nearest."""
    key = norm(name)
    if not key:
        return ""
    keys = {key, " ".join(ABBR.get(w, w) for w in key.split())}
    exact = set().union(*(idx.get(k, set()) for k in keys))
    loose = set()
    for k in keys:
        words = set(k.split())
        loose |= {c for n, cs in idx.items() if words <= set(n.split()) for c in cs}
    anchor = pos.get(near_to)
    reach = (rail_km * 1.08 + 6) if rail_km is not None else 400

    def fits(c):
        return c in pos and (anchor is None or hav(anchor, pos[c]) <= reach)

    # "Sir M Visvesvaraya Terminal Bengaluru": a known name (2+ words) inside the printed one
    words = set(key.split())
    inner = [(len(n.split()), c) for n, cs in idx.items() if len(n.split()) >= 2 and set(n.split()) <= words for c in cs]
    longest = max((n for n, _ in inner), default=0)
    inside = {c for n, c in inner if n == longest}
    for cands in (exact, loose, inside):
        ok = [c for c in cands if fits(c)]
        if ok:
            known = [c for c in ok if c in expected]
            pick = known or ok
            return min(pick, key=lambda c: hav(anchor, pos[c])) if anchor else (pick[0] if len(pick) == 1 else "")
    if anchor:
        def squash(n):  # "RAJENDRA NAGAR TERMINUS" ~ "RAJENDRANAGAR"
            return "".join(w for w in n.split() if w not in GENERIC)
        close = [(n, c) for n, cs in idx.items() for c in cs if fits(c) and hav(anchor, pos[c]) < min(reach, 150)]
        score = lambda nc: difflib.SequenceMatcher(None, squash(key), squash(nc[0])).ratio()  # noqa: E731
        best = max(close, key=score, default=None)
        if best and score(best) >= 0.82:
            return best[1]
    return ""


GENERIC = {"TERMINUS", "CANTT", "CITY", "ROAD", "TOWN", "HALT", "JUNCTION"}


def hav(a, b):
    p = math.pi / 180
    x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


# ---------------------------------------------------------------- run
stations = {r["code"]: r for r in read_table("stations")}
ours = defaultdict(list)
for h in read_table("halts"):
    ours[h["number"]].append(h["station"])
pos = {c: (float(s["lat"]), float(s["lon"])) for c, s in stations.items() if s["lat"]}
names = station_index(stations, pos)
pages, segments = 0, defaultdict(list)
for pdf in sorted(SRC.glob("*.pdf"), key=lambda p: (len(p.stem), p.stem)):
    if not re.fullmatch(r"\d+(-\d+)?", pdf.stem):
        continue
    try:
        doc = fitz.open(pdf)
    except Exception:  # noqa: BLE001 - a failed download is an HTML page
        print("  not a PDF:", pdf.name)
        continue
    for page in doc:
        pages += 1
        for col in parse_page(page, pdf.stem):
            resolve_times(col)
            col["page"] = pages
            for h in col["halts"]:
                h["page"] = pages
            segments[col["no"]].append(col)
print(f"pages read: {pages}; train numbers found: {len(segments)}")

report = Counter()
trains = {}


def rail(a, b):
    """Official km between two halts of one table page, else unknown."""
    return abs(b["km"] - a["km"]) if a["km"] is not None and b["km"] is not None else None


def place_segment(seg, expected):
    """Station codes for one table page's halts (distances are comparable within a page)."""
    # junctions can be printed twice in one table (Nagda on the Mumbai–Delhi table): one halt
    seg["halts"] = [h for k, h in enumerate(seg["halts"])
                    if not (k and h["name"] == seg["halts"][k - 1]["name"]
                            and [t for _, t in h["times"]] == [t for _, t in seg["halts"][k - 1]["times"]])]
    halts = seg["halts"]
    for h in halts:
        alt = re.fullmatch(r"[A-Z]{2,5}", h["alt"] or "")  # a code printed in the cell: another station of that city
        h["code"] = h["alt"] if alt and h["alt"] in pos else ""
    for h in halts:  # names that are unambiguous on their own anchor the rest
        if not h["code"]:
            h["code"] = resolve(h["name"], names, pos, None, None, expected)
    def outward():
        for seq in (halts, halts[::-1]):  # outward from what's placed, within the printed distances
            prev = None
            for h in seq:
                if not h["code"] and prev is not None:
                    h["code"] = resolve(h["name"], names, pos, prev["code"], rail(prev, h), expected)
                prev = h if h["code"] else prev

    def implausible(a, b):
        km = rail(a, b)
        return a["code"] in pos and b["code"] in pos and km is not None and hav(pos[a["code"]], pos[b["code"]]) > km * 1.1 + 10

    outward()
    # a name that matched on its own can still be the wrong station of that name: check it against
    # both neighbours' printed distances, drop it if it fits neither, and place it again
    for _ in range(2):
        placed = [h for h in halts if h["code"]]
        wrong = [b for a, b, c in zip([None] + placed, placed, placed[1:] + [None])
                 if (a is None or implausible(a, b)) and (c is None or implausible(b, c)) and (a or c)]
        if not wrong:
            break
        for h in wrong:
            h["code"] = ""
        outward()
    # clock times -> minutes since this page's first time, rolling past midnight
    last = None
    for h in halts:
        for k in ("arr", "dep"):
            if h[k] is not None:
                if last is not None:
                    while h[k] < last:
                        h[k] += 1440
                last = h[k]


def when(h):
    return h["arr"] if h["arr"] is not None else h["dep"]


def merge(segs):
    """One train's pages from different tables, joined where they print the same station at the
    same clock time (tables overlap at junctions); pages with no overlap follow in "To Table" order."""
    # the order the book gives: start where "From Table" is empty, follow "To Table" links
    segs = sorted(segs, key=lambda s: s["page"])
    first = next((s for s in segs if not re.search(r"\d", s["from"])), segs[0])
    chain, cur = [first], first
    while True:
        links = [t.rstrip("A") for t in re.findall(r"\d+A?", cur["to"])]
        nxt = next((s for t in links for s in segs if s["table"] == t and s not in chain), None)
        if nxt is None:
            break
        chain.append(nxt)
        cur = nxt
    segs = chain + [s for s in segs if s not in chain]
    merged = [dict(h) for h in segs[0]["halts"]]
    rest = segs[1:]
    while rest:
        for s in rest:
            shift = None
            for h in s["halts"]:
                for m in merged:
                    if h["code"] and h["code"] == m["code"]:
                        for k in ("dep", "arr"):
                            if h[k] is not None and m[k] is not None and (m[k] - h[k]) % 1440 == 0:
                                shift = m[k] - h[k]
                                break
                    if shift is not None:
                        break
                if shift is not None:
                    break
            if shift is not None:
                break
        else:  # nothing overlaps: the next page continues after the end
            s = rest[0]
            shift = 0
            end = max(when(m) for m in merged)
            while when(s["halts"][0]) + shift < end:
                shift += 1440
            report["pages joined without overlap"] += 1
        rest.remove(s)
        for h in s["halts"]:
            h = dict(h, arr=None if h["arr"] is None else h["arr"] + shift, dep=None if h["dep"] is None else h["dep"] + shift)
            same = next((m for m in merged if m["code"] and m["code"] == h["code"]), None)
            if same:
                same["arr"] = same["arr"] if same["arr"] is not None else h["arr"]
                same["dep"] = same["dep"] if same["dep"] is not None else h["dep"]
            else:
                merged.append(h)
    merged.sort(key=when)
    out = []
    for h in merged:  # a station printed twice at the same moment is one halt
        if out and h["code"] and h["code"] == out[-1]["code"]:
            out[-1]["dep"] = h["dep"] if h["dep"] is not None else out[-1]["dep"]
            continue
        out.append(h)
    return out


def check(halts):
    """Why this train can't be trusted as read, or "" if it passes: every halt placed, a departure
    at the start and an arrival at the end, time never running backwards, and no stretch that
    would need a train faster than 160 km/h or slower than 12 hours for under 400 km, and no halt
    longer than 6 hours (a day read twice)."""
    if not all(h["code"] for h in halts):
        return "station not identified"
    if halts[0]["dep"] is None or halts[-1]["arr"] is None:
        return "no start or end time"
    times = [v for h in halts for v in (h["arr"], h["dep"]) if v is not None]
    if any(b < a for a, b in zip(times, times[1:])):
        return "time runs backwards"
    if any(h["arr"] is not None and h["dep"] is not None and h["dep"] - h["arr"] > 360 for h in halts):
        return "halt of more than 6 hours"
    for a, b in zip(halts, halts[1:]):
        if a["code"] == b["code"]:
            return "same station twice"
        if a["code"] in pos and b["code"] in pos:
            km = hav(pos[a["code"]], pos[b["code"]])
            mins = b["arr"] - a["dep"]
            if mins <= 0 or km / (mins / 60) > 160:
                return "impossible speed"
            if mins > 720 and km < 400:
                return "long gap"
    return ""


def fault(halts):
    """The first stretch (index of its later halt) that breaks a rule check() applies, or None.
    A halt that's too long comes back as ("halt", index)."""
    for j, h in enumerate(halts):
        if h["arr"] is not None and h["dep"] is not None and h["dep"] - h["arr"] > 360:
            return ("halt", j)
    last = None
    for j, h in enumerate(halts):
        for k in ("arr", "dep"):
            if h[k] is not None:
                if last is not None and h[k] < last:
                    return j
                last = h[k]
    for j in range(1, len(halts)):
        a, b = halts[j - 1], halts[j]
        if a["code"] == b["code"]:
            return j
        if a["code"] in pos and b["code"] in pos and a["dep"] is not None and b["arr"] is not None:
            km = hav(pos[a["code"]], pos[b["code"]])
            mins = b["arr"] - a["dep"]
            if mins <= 0 or km / (mins / 60) > 160 or (mins > 720 and km < 400):
                return j
    return None


def repair(halts):
    """A train that fails only because of a few misread rows (a route label read as a station, a
    junction row from another page, a day rolled over twice) is worth keeping. Drop unplaced
    middle rows; then, one at a time, drop the middle row at a broken stretch or undo a spurious
    extra day, and re-check. Never touches the first or last halt, never drops more than two
    rows or a sixth of them. Returns (halts, what was changed) or (None, "")."""
    if not halts[0]["code"] or not halts[-1]["code"] or halts[0]["dep"] is None or halts[-1]["arr"] is None:
        return None, ""
    hs = [dict(h) for h in halts if h["code"] or h is halts[0] or h is halts[-1]]
    dropped = len(halts) - len(hs)
    budget = max(2, len(halts) // 6)
    fixes = []
    for _ in range(6):
        j = fault(hs)
        if j is None:
            break
        if isinstance(j, tuple):
            # a whole extra day inside one halt: the clock rolled over twice
            _, j = j
            if hs[j]["dep"] - hs[j]["arr"] < 1440 - 360:
                return None, ""
            hs[j]["dep"] -= 1440
            for h in hs[j + 1:]:
                for k in ("arr", "dep"):
                    if h[k] is not None:
                        h[k] -= 1440
            fixes.append("day")
            continue
        a, b = hs[j - 1], hs[j]
        # a whole extra day between two halts that are close: the page merge rolled the clock twice
        gap = (b["arr"] if b["arr"] is not None else b["dep"]) - (a["dep"] if a["dep"] is not None else a["arr"])
        if gap > 720 and a["code"] in pos and b["code"] in pos and hav(pos[a["code"]], pos[b["code"]]) < 400:
            for h in hs[j:]:
                for k in ("arr", "dep"):
                    if h[k] is not None:
                        h[k] -= 1440
            fixes.append("day")
            continue
        # otherwise drop the middle one of the two, preferring the later
        k = j if j < len(hs) - 1 else j - 1
        if k == 0 or dropped >= budget:
            return None, ""
        del hs[k]
        dropped += 1
    if dropped > budget or check(hs):
        return None, ""
    return hs, ", ".join(([f"{dropped} row{'s' * (dropped > 1)} dropped"] if dropped else []) + (["day fixed"] if fixes else []))


for no, segs in segments.items():
    expected = set(ours.get(no, []))
    for seg in segs:
        place_segment(seg, expected)
    halts = merge(segs)
    if len(halts) < 2:
        report["too short"] += 1
        continue
    # short halts print only a departure (or only an arrival): the train stops, dwell unknown
    for h in halts[1:-1]:
        h["arr"] = h["arr"] if h["arr"] is not None else h["dep"]
        h["dep"] = h["dep"] if h["dep"] is not None else h["arr"]
    halts[0]["arr"] = None
    halts[-1]["dep"] = None
    base = (halts[0]["dep"] // 1440) * 1440 if halts[0]["dep"] is not None else 0
    for h in halts:
        for k in ("arr", "dep"):
            if h[k] is not None:
                h[k] -= base
        report["halts"] += 1
        report["halts without a code"] += not h["code"]
    problem = check(halts)
    repaired = ""
    if problem:
        fixed, repaired = repair(halts)
        if fixed:
            halts, problem = fixed, ""
            report["repaired (misread rows dropped or day fixed)"] += 1
    report[f"rejected: {problem}" if problem else "trains that pass every check"] += 1
    ok = not problem
    days = next((s["days"] for s in segs if s["days"]), 0)
    report["with running days"] += bool(days)
    trains[no] = {"number": no, "name": next((s["name"] for s in segs if s.get("name")), ""), "days": days_text(days),
                  "tables": sorted({s["table"] for s in segs}), "ok": ok, "problem": problem, "repaired": repaired,
                  "halts": [{"station": h["code"], "name": h["name"], "arr": fmt_time(h["arr"]), "dep": fmt_time(h["dep"]),
                             "page": h.get("page"), "table_km": h["km"]} for h in halts]}

out = SRC / "parsed.json"
out.write_text(json.dumps(trains, ensure_ascii=False, indent=1))
print(dict(report))
print(f"wrote {out} ({len(trains)} trains)")

# ---------------------------------------------------------------- compare with db/
both = [n for n in trains if n in ours and trains[n]["ok"]]
same = [n for n in both if [h["station"] for h in trains[n]["halts"]] == ours[n]]
print(f"in both TAG {YEAR} and db/: {len(both)} good trains; identical stop lists: {len(same)}; "
      f"new in TAG: {sum(1 for n in trains if n not in ours)} ({sum(1 for n in trains if n not in ours and trains[n]['ok'])} good)")

# ---------------------------------------------------------------- report
reasons = Counter(t["problem"] for t in trains.values() if t["problem"])
lines = [f"# Trains at a Glance {YEAR}: what the importer read", "",
         f"- pages read: {pages}; train numbers: {len(trains)}",
         f"- pass every check: {sum(t['ok'] for t in trains.values())} "
         f"({sum(1 for n, t in trains.items() if t['ok'] and n not in ours)} not in db/)",
         f"- with running days: {sum(1 for t in trains.values() if t['days'])}",
         f"- station names placed: {100 - 100 * report['halts without a code'] / max(1, report['halts']):.1f}%", "",
         "## Held back, by reason", ""]
lines += [f"- {r}: {n}" for r, n in reasons.most_common()]
lines += ["", "## Names not placed (most frequent)", ""]
unplaced = Counter(h["name"] for t in trains.values() for h in t["halts"] if not h["station"])
lines += [f"- {n} ({k})" for n, k in unplaced.most_common(40)]
(SRC / "report.md").write_text("\n".join(lines) + "\n")
print(f"report: {SRC / 'report.md'}")
