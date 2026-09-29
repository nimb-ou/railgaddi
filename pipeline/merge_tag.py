"""Merge a parsed *Trains at a Glance* timetable (RAW/tag<year>/parsed.json, from import_tag.py)
into Railgaddi's database.

It refuses to run until a decision to use that edition is recorded in
docs/permissions/tag<year>.md: Indian Railways' written permission, or the owner's decision to
use it while that permission is requested (see docs/permission-requests.md). To try it without
touching the real database, point it at a copy:

    cp -r db /tmp/db-try && RAILGADDI_DB=/tmp/db-try python3 pipeline/merge_tag.py raw 2026 --try

What it does, for every train that passed all of import_tag.py's checks:
  1. stations renamed since 2017 take their new code everywhere (Allahabad ALD -> Prayagraj
     PRYJ), found through OpenStreetMap's old_ref tags or an identical position; stations new
     since 2017 are added from OpenStreetMap;
  2. the train's halts, times and running days are replaced by the 2026 ones (new trains added);
  3. the line between halts follows the track: the shortest route through the rail network
     that db/ already knows (TAG prints main halts only, which would otherwise draw chords);
  4. trains that now have halts leave newer_trains.csv.
Trains TAG doesn't cover (mostly passenger and local trains) keep their 2017 timetable.
"""
import heapq
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

from db import DB, days_mask, fmt_time, parse_time, read_table, write_table

RAW = Path(sys.argv[1])
YEAR = sys.argv[2]
TRY = "--try" in sys.argv
ROOT = Path(__file__).resolve().parent.parent
SRC = f"tag{YEAR}"

if not (ROOT / "docs" / "permissions" / f"tag{YEAR}.md").exists() and not (TRY and DB != ROOT / "db"):
    sys.exit(f"No decision recorded (docs/permissions/tag{YEAR}.md). Use --try with RAILGADDI_DB set to a copy of db/.")

parsed = json.loads((RAW / f"tag{YEAR}" / "parsed.json").read_text())
good = {n: t for n, t in parsed.items() if t["ok"]}
print(f"trains that passed every check: {len(good)} of {len(parsed)}")


def hav(a, b):
    p = math.pi / 180
    x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(x))


# ---------------------------------------------------------------- stations: renamed and new
stations = {r["code"]: r for r in read_table("stations")}
pos = {c: (float(s["lat"]), float(s["lon"])) for c, s in stations.items() if s["lat"]}
osm = {}
for e in json.loads((RAW / "osm_stations.json").read_text())["elements"]:
    t = e.get("tags", {})
    for ref in t.get("ref", "").upper().split(";"):
        if re.fullmatch(r"[A-Z]{1,5}", ref.strip()):
            osm.setdefault(ref.strip(), (e, t))

halts = read_table("halts")
used_2017 = {h["station"] for h in halts}
used_tag = {h["station"] for t in good.values() for h in t["halts"]}
alias = {}  # old code -> new code
for new in used_tag - set(stations):
    e, t = osm.get(new, (None, {}))
    if not e:
        continue
    old = (t.get("old_ref") or "").upper()
    if old not in stations:  # no old_ref: the 2017 station at the very same spot, unused in 2026
        near = [c for c in used_2017 - used_tag if c in pos and hav(pos[c], (e["lat"], e["lon"])) < 1.0]
        old = near[0] if len(near) == 1 else ""
    if old and old not in used_tag:
        alias[old] = new
renames = {r["old"]: r for r in read_table("renames")}
for old, new in alias.items():
    e, t = osm[new]
    renames[old] = {"old": old, "new": new, "old_name": stations[old]["name"], "since": SRC}
    row = dict(stations.pop(old))
    row.update(code=new, name=re.sub(r"\s+(Junction|railway station)$", "", t.get("name:en") or t.get("name") or row["name"], flags=re.I),
               lat=f"{e['lat']:.5f}", lon=f"{e['lon']:.5f}", coord="osm")
    stations[new] = row
    pos[new] = (e["lat"], e["lon"])
    pos.pop(old, None)
added = 0
for new in used_tag - set(stations):
    e, t = osm.get(new, (None, {}))
    if not e:
        continue
    nearest = min((s for s in stations.values() if s["lat"] and s["state"]),
                  key=lambda s: hav((float(s["lat"]), float(s["lon"])), (e["lat"], e["lon"])))
    stations[new] = {"code": new, "name": t.get("name:en") or t.get("name") or new, "state": nearest["state"],
                     "lat": f"{e['lat']:.5f}", "lon": f"{e['lon']:.5f}", "coord": "osm", "hi": t.get("name:hi", ""), "local": ""}
    pos[new] = (e["lat"], e["lon"])
    added += 1
print(f"stations: {len(alias)} renamed ({', '.join(f'{a}->{b}' for a, b in list(alias.items())[:8])}…), {added} added")


def code(c):
    return alias.get(c, c)


# ---------------------------------------------------------------- the rail network db/ knows
paths = read_table("paths")
via = {(p["number"], int(p["after"])): p["via"].split() for p in paths}
by_train = defaultdict(list)
for h in halts:
    by_train[h["number"]].append(h)
graph = defaultdict(dict)
for no, hs in by_train.items():
    hs.sort(key=lambda h: int(h["seq"]))
    seq = []
    for h in hs:
        seq.append(code(h["station"]))
        seq += [code(c) for c in via.get((no, int(h["seq"])), [])]
    seq = [c for c in seq if c in pos]  # stations without a position: link across them
    for a, b in zip(seq, seq[1:]):
        d = hav(pos[a], pos[b]) if a != b else 0
        if 0 < d <= 60:  # neighbouring stations on a line; longer hops are trains without track data
            graph[a][b] = graph[b][a] = min(d, graph[a].get(b, 1e9))


def track(a, b):
    """Stations passed between two halts: the shortest known route, if it isn't a detour."""
    if a not in graph or b not in graph or a not in pos or b not in pos:
        return []
    direct = hav(pos[a], pos[b])
    limit = direct * 1.6 + 30
    dist, prev, heap = {a: 0.0}, {}, [(0.0, a)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == b:
            break
        if d > dist.get(u, 1e18) or d > limit:
            continue
        for v, w in graph[u].items():
            nd = d + w
            if nd < dist.get(v, 1e18) and nd <= limit:
                dist[v], prev[v] = nd, u
                heapq.heappush(heap, (nd, v))
    if b not in prev:
        return []
    out, u = [], prev[b]
    while u != a:
        out.append(u)
        u = prev[u]
    return out[::-1]


# ---------------------------------------------------------------- the track, from OpenStreetMap
osm_track = None
if (RAW / "osm-rail").exists() and any((RAW / "osm-rail").glob("*.json")):
    from track import Track
    osm_track = Track(RAW, pos)
    print(f"OpenStreetMap track: {len(osm_track.adj)} junctions and stations, {len(osm_track.node_of)} stations on it")


def line_between(a, b):
    """Stations passed between two halts: along OpenStreetMap's track, else the network db/ knows."""
    if osm_track:
        r = osm_track.route(a, b)
        if r is not None:
            return r, "osm"
    r = track(a, b)
    return r, "db" if r else "none"


# ---------------------------------------------------------------- small stops the book doesn't print
def with_small_stops(no, hs):
    """Trains at a Glance prints principal halts only. Where our older timetable ran the same
    train along the same line, put its small stops back between the two printed halts around
    them, at times scaled from where they fell in the older schedule, marked approximate."""
    old = sorted(by_train.get(no, []), key=lambda h: int(h["seq"]))
    if len(old) < 3:
        return hs
    oc = [code(h["station"]) for h in old]
    at = {c: i for i, c in enumerate(oc)}
    printed = [at.get(h["station"]) for h in hs]
    known = [i for i in printed if i is not None]
    # the same service: most printed halts are on the old list, and in the same order
    if len(known) < max(2, 0.6 * len(hs)) or known != sorted(known):
        stats["small stops: route changed"] += 1
        return hs
    ot = lambda h, k: parse_time(h[k])  # noqa: E731
    out = []
    for j, h in enumerate(hs):
        out.append(dict(h, approx=""))
        if j + 1 == len(hs):
            break
        ia, ib = printed[j], printed[j + 1]
        if ia is None or ib is None or ib - ia < 2:
            continue
        a_old, b_old = ot(old[ia], "dep"), ot(old[ib], "arr")
        a_new, b_new = parse_time(h["dep"]), parse_time(hs[j + 1]["arr"])
        if None in (a_old, b_old, a_new, b_new) or b_old <= a_old or b_new <= a_new:
            continue
        scale = (b_new - a_new) / (b_old - a_old)
        last = a_new
        for k in range(ia + 1, ib):
            x_arr, x_dep = ot(old[k], "arr"), ot(old[k], "dep")
            if x_arr is None or x_dep is None:
                continue
            arr = max(last + 1, round(a_new + (x_arr - a_old) * scale))
            dep = min(arr + max(0, min(5, x_dep - x_arr)), b_new - 1)
            if dep < arr or arr >= b_new:
                continue
            out.append({"station": oc[k], "name": old[k]["station"], "arr": fmt_time(arr), "dep": fmt_time(dep),
                        "page": None, "table_km": None, "approx": "1"})
            last = dep
            stats["small stops kept"] += 1
    return out


# ---------------------------------------------------------------- trains
stats = defaultdict(int)
trains = {r["number"]: r for r in read_table("trains")}
new_halts = [dict(h, station=code(h["station"])) for h in halts if h["number"] not in good]
new_paths = [dict(p, via=" ".join(code(c) for c in p["via"].split())) for p in paths if p["number"] not in good]
TYPES = (("VANDE BHARAT", "VB"), ("AMRIT BHARAT", "AB"), ("JAN SHATABDI", "JShtb"), ("RAJDHANI", "Raj"), ("SHATABDI", "Shtb"),
         ("DURONTO", "Drnt"), ("GARIB", "GR"), ("SAMPARK", "SKr"), ("MEMU", "MEMU"), ("DEMU", "DEMU"))
for no, t in sorted(good.items()):
    row = trains.get(no) or {"number": no, "name": t["name"] or no, "days": "", "days_src": ""}
    book = re.sub(r"\bSuper ?Fast\b", "Superfast", (t["name"] or "").strip())
    # the book's name goes with the book's route; ours stays only when it's plainly the same
    # train ("Karnataka Express" in "KSR Bengaluru New Delhi Karnataka Express"). A number
    # reused for another train, or a name made up from the ends, takes the book's.
    words = lambda n: set(re.findall(r"[a-z]{4,}", (n or "").lower())) - {"express", "superfast", "mail", "special", "junction"}  # noqa: E731
    if book and not (row["name"] and words(row["name"]) and words(row["name"]) <= words(book)):
        row["name"] = book
    upper = (row["name"] or "").upper()
    row["type"] = next((ty for k, ty in TYPES if k in upper), row.get("type") or ("SF" if no[:2] in ("12", "20", "22") else "Exp"))
    if row.get("days_src") != "override" and days_mask(t["days"]):
        row["days"], row["days_src"] = t["days"], SRC
    row["src"] = SRC
    trains[no] = row
    hs = with_small_stops(no, [dict(h, station=code(h["station"])) for h in t["halts"]])
    km = 0.0
    for j, h in enumerate(hs):
        if j:
            a, b = hs[j - 1], h
            same_page = a["page"] is not None and a["page"] == b["page"] and a["table_km"] is not None and b["table_km"] is not None
            passed, how = line_between(a["station"], b["station"])
            stats[f"stretches: {how}"] += 1
            line = [a["station"], *passed, b["station"]]
            along = sum(hav(pos[x], pos[y]) for x, y in zip(line, line[1:]) if x in pos and y in pos)
            printed = abs(b["table_km"] - a["table_km"]) if same_page else None
            if printed is not None and along > 0 and not (0.8 * along - 5 <= printed <= 1.6 * along + 20):
                stats["printed km misread, line length used"] += 1
                printed = None
            km += printed if printed is not None else along
            if passed:
                new_paths.append({"number": no, "after": j, "via": " ".join(passed)})
        new_halts.append({"number": no, "seq": j + 1, "station": h["station"], "arr": h["arr"], "dep": h["dep"],
                          "km": f"{km:.0f}", "approx": h.get("approx", "")})
print(dict(stats))

# trains whose stops couldn't all be read still have their running days printed: take those when
# the book's first and last halts it could place are the ends our timetable has for that number
# (numbers get reused for other trains)
days_only = 0
for no, t in parsed.items():
    if t["ok"] or no not in trains or not days_mask(t["days"]) or trains[no].get("days_src") == "override":
        continue
    ours = sorted(by_train.get(no, []), key=lambda h: int(h["seq"]))
    placed = [code(h["station"]) for h in t["halts"] if h["station"]]
    if len(ours) < 2 or len(placed) < 2:
        continue
    ends = [code(ours[0]["station"]), code(ours[-1]["station"])]
    near = lambda a, b: a == b or (a in pos and b in pos and hav(pos[a], pos[b]) < 30)  # noqa: E731
    if near(placed[0], ends[0]) and near(placed[-1], ends[1]):
        trains[no]["days"], trains[no]["days_src"] = t["days"], SRC
        days_only += 1
print(f"running days only (stops not readable): {days_only}")

have = set(trains)
newer = [n for n in read_table("newer_trains") if not any(x in have for x in n["numbers"].split("/"))]
newer = [dict(n, **{"from": code(n["from"]), "to": code(n["to"])}) for n in newer]

write_table("stations", sorted(stations.values(), key=lambda s: s["code"]))
write_table("trains", sorted(trains.values(), key=lambda t: t["number"]))
write_table("halts", sorted(new_halts, key=lambda h: (h["number"], int(h["seq"]))))
write_table("paths", sorted(new_paths, key=lambda p: (p["number"], int(p["after"]))))
write_table("newer_trains", newer)
write_table("renames", sorted(renames.values(), key=lambda r: r["old"]))

# Mail/Express trains of the older timetable that the book doesn't list under their old number:
# renumbered since, or withdrawn. The book's Train Name Index says which: the same end stations
# under a new number is the same service. If the new number has 2026 times, the old one is a
# duplicate and goes; if not, the old halts stay under the new number and name (times still
# 2017's). No match at all: withdrawn, or changed too much to tell; kept, and flagged on the
# site. (The book covers Mail/Express trains;
# passenger and local trains aren't in it and stay as they are.)
EXPRESS = {"Exp", "SF", "Mail", "Raj", "Shtb", "Drnt", "GR", "SKr", "JShtb", "VB", "AB"}
numbers_file = RAW / f"tag{YEAR}" / "numbers.json"
index_file = RAW / f"tag{YEAR}" / "index.json"
retired, renumbered = [], []
if numbers_file.exists():
    in_book = set(json.loads(numbers_file.read_text()))
    index = json.loads(index_file.read_text()) if index_file.exists() else []
    halts_of = defaultdict(list)
    for h in new_halts:
        halts_of[h["number"]].append(h)
    near = lambda a, b: bool(a and b) and (a == b or (a in pos and b in pos and hav(pos[a], pos[b]) < 30))  # noqa: E731
    words = lambda n: set(re.findall(r"[a-z]{4,}", (n or "").lower())) - {"express", "superfast", "mail", "exp", "special"}  # noqa: E731
    taken = set(trains)
    for no, t in sorted(trains.items()):
        if t.get("src") != "ogd2017" or t.get("type") not in EXPRESS or no in in_book or no[0] == "0":
            continue
        hs = sorted(halts_of.get(no, []), key=lambda h: int(h["seq"]))
        a, b = (code(hs[0]["station"]), code(hs[-1]["station"])) if hs else ("", "")
        cands = []
        for e in index:
            f, to = code(e["from_code"]), code(e["to_code"])
            if near(a, f) and near(b, to):
                cands.append((e, e["numbers"][0]))
            elif len(e["numbers"]) > 1 and near(a, to) and near(b, f):
                cands.append((e, e["numbers"][1]))
        if len(cands) > 1:  # several trains between the same ends: the one whose name matches
            named = [c for c in cands if words(c[0]["name"]) & words(t["name"])]
            cands = named if len(named) == 1 else []
        if len(cands) == 1:
            e, new = cands[0]
            if new in trains or new in taken:
                retired.append({"number": no, "name": t["name"], "status": "duplicate", "reason": f"renumbered {new}, which has {YEAR} times"})
            else:
                name = re.sub(r"\bExp\.?$", "Express", e["name"]).strip()
                renumbered.append({"old": no, "new": new, "name": name, "since": SRC})
                taken.add(new)
            continue
        # kept (a train may still run under a number whose ends have changed) but flagged on the site
        retired.append({"number": no, "name": t["name"], "status": "unlisted", "reason": f"not in Trains at a Glance {YEAR} under this number"})
    # the renumbered keep their 2017 halts, under the number and name they run with now
    for r in renumbered:
        row = trains.pop(r["old"])
        trains[r["new"]] = dict(row, number=r["new"], name=r["name"])
        for h in new_halts:
            if h["number"] == r["old"]:
                h["number"] = r["new"]
        for pth in new_paths:
            if pth["number"] == r["old"]:
                pth["number"] = r["new"]
    write_table("trains", sorted(trains.values(), key=lambda t: t["number"]))
    write_table("halts", sorted(new_halts, key=lambda h: (h["number"], int(h["seq"]))))
    write_table("paths", sorted(new_paths, key=lambda p: (p["number"], int(p["after"]))))
    newer = [n for n in newer if not any(x in trains for x in n["numbers"].split("/"))]  # now with halts
    write_table("newer_trains", newer)
    write_table("retired", retired)
    write_table("renumbered", renumbered)
    print(f"renumbered since 2017, kept under the new number: {len(renumbered)}")
    print(f"2017 trains the book doesn't list: {sum(r['status'] == 'duplicate' for r in retired)} duplicates of renumbered trains (left out), "
          f"{sum(r['status'] == 'unlisted' for r in retired)} unmatched (kept, flagged)")
replaced = sum(1 for n in good if n in by_train)
print(f"{DB}: {replaced} trains now on the {YEAR} timetable, {len(good) - replaced} added; "
      f"{len(trains) - len(good)} keep 2017 times; newer trains left: {len(newer)}")
# sanity: every time parses
for h in new_halts:
    parse_time(h["arr"]), parse_time(h["dep"])
