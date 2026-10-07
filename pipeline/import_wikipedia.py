"""Add what Wikipedia knows about Indian trains to Railgaddi's database (db/).

English Wikipedia has an article, with an infobox, for most named Indian trains: train numbers,
end stations, how often it runs, distance, journey time and number of stops (CC BY-SA 4.0).
It doesn't list halts or times, so it can't put a train on the map, but it does tell us:

  1. running days for trains already in db/trains.csv (only where Wikipedia is unambiguous:
     "Daily", "except Wednesday", or days given per train number); and
  2. trains introduced since our timetable (every Vande Bharat, Amrit Bharat…), written to
     db/newer_trains.csv so the site can mention them between the right places.

Responses are cached in RAW/wp-cache; pass --refresh to ask Wikipedia again.

    python3 pipeline/import_wikipedia.py raw
"""
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

from db import DAYS, days_text, read_table, write_table

RAW = Path(sys.argv[1])
CITIES = json.loads((Path(__file__).parent / "cities.json").read_text())
CACHE = RAW / "wp-cache"
REFRESH = "--refresh" in sys.argv
API = "https://en.wikipedia.org/w/api.php"
UA = "Railgaddi/1.0 (https://github.com/nimb-ou/railgaddi; non-commercial train-discovery site)"
CACHE.mkdir(parents=True, exist_ok=True)


def api(params, key):
    path = CACHE / f"{key}.json"
    if path.exists() and not REFRESH:
        return json.loads(path.read_text())
    params = {**params, "format": "json", "formatversion": "2", "maxlag": "5"}
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                data = json.loads(r.read())
            if data.get("error", {}).get("code") == "maxlag":
                raise RuntimeError("maxlag")
            path.write_text(json.dumps(data))
            time.sleep(1)
            return data
        except Exception as e:  # noqa: BLE001 - network hiccups and throttling: back off and retry
            wait = 5 * 2 ** attempt
            print(f"  {key}: {e}; retrying in {wait}s")
            time.sleep(wait)
    raise SystemExit(f"Wikipedia API unreachable for {key}")


# ---------------------------------------------------------------- which articles
titles = []
offset = 0
while True:
    d = api({"action": "query", "list": "search", "srsearch": 'hastemplate:"Infobox rail service" insource:"trainnumber"',
             "srlimit": "500", "sroffset": str(offset), "srprop": ""}, f"search-{offset}")
    titles += [h["title"] for h in d["query"]["search"]]
    if "continue" not in d:
        break
    offset = d["continue"]["sroffset"]
titles = sorted(set(titles))
print("articles with a train-number infobox:", len(titles))

texts = {}
for i in range(0, len(titles), 50):
    batch = titles[i:i + 50]
    d = api({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "titles": "|".join(batch)},
            "text-" + hashlib.md5("|".join(batch).encode()).hexdigest()[:12])
    for p in d["query"]["pages"]:
        if p.get("revisions"):
            texts[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
print("fetched:", len(texts))


# ---------------------------------------------------------------- reading an infobox
def infobox(text):
    m = re.search(r"\{\{\s*Infobox rail service", text, re.I)
    if not m:
        return {}
    depth, i, start = 0, m.start(), m.start()
    while i < len(text):
        if text.startswith("{{", i):
            depth += 1
            i += 2
        elif text.startswith("}}", i):
            depth -= 1
            i += 2
            if depth == 0:
                break
        else:
            i += 1
    body = text[start + 2:i - 2]
    fields, depth, cur = [], 0, ""
    for j, ch in enumerate(body):  # split on top-level "|"
        if body.startswith("{{", j) or body.startswith("[[", j):
            depth += 1
        elif body.startswith("}}", j) or body.startswith("]]", j):
            depth -= 1
        if ch == "|" and depth <= 0:
            fields.append(cur)
            cur = ""
        else:
            cur += ch
    fields.append(cur)
    out = {}
    for f in fields[1:]:
        if "=" in f:
            k, v = f.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def plain(s):
    s = re.sub(r"<ref[^>]*/>|<ref[\s\S]*?</ref>", "", s or "")
    s = re.sub(r"\{\{\s*(?:efn|refn|ref label|note)\s*\|([^{}]*)\}\}", r" (\1)", s, flags=re.I)  # keep footnote text
    s = re.sub(r"\{\{\s*(?:convert|cvt)\s*\|\s*([\d.,]+)\s*\|\s*(\w+)[^{}]*\}\}", r"\1 \2", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:stnlnk|stn|rws|rwsa)\s*\|\s*([^|{}]+)[^{}]*\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:start date(?: and age)?)\s*\|\s*(\d{4})[^{}]*\}\}", r"\1", s, flags=re.I)
    for _ in range(3):
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", " / ", s, flags=re.I)
    s = re.sub(r"<[^>]+>|'{2,}", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


DAY_WORDS = {d.lower(): i for i, d in enumerate(DAYS)} | {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
    "tues": 1, "wednes": 2, "thur": 3, "thurs": 3}
DAY_RE = re.compile(r"\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b", re.I)


def day_index(w):
    return DAYS.index(w[:3].title())


def running_days(freq, numbers):
    """{train number: mask} where the text is unambiguous, plus trips a week (0 = unknown)."""
    f = freq.lower()
    per_week = 7 if "daily" in f else 0
    for word, n in (("weekly", 1), ("bi-weekly", 2), ("biweekly", 2), ("tri-weekly", 3), ("triweekly", 3),
                    ("four days", 4), ("4 days", 4), ("five days", 5), ("5 days", 5), ("six days", 6), ("6 days", 6)):
        if word in f:
            per_week = n
    out = {}
    if re.fullmatch(r"\s*daily\s*(\(.*\))?\s*", f) and "except" not in f:
        return {n: 127 for n in numbers}, 7
    # days given per train number: "12345: Mon, Thu / 12346: Tue, Fri"
    parts = re.split(r"(\b\d{5}\b)", freq)
    if sum(1 for p in parts if re.fullmatch(r"\d{5}", p)) >= 2:
        for k in range(1, len(parts) - 1, 2):
            no, text = parts[k], parts[k + 1]
            if "except" in text.lower():
                continue
            days = {day_index(w) for w in DAY_RE.findall(text)}
            if no in numbers and days and (not per_week or len(days) == per_week):
                out[no] = sum(1 << d for d in days)
        return out, per_week
    # one rule for both directions: "six days a week (except Wednesday)"
    m = re.search(r"except\s+(?:on\s+)?([a-z]+)", f)
    if m and DAY_RE.fullmatch(m.group(1)) and per_week in (0, 6) and len(DAY_RE.findall(f)) == 1:
        mask = 127 & ~(1 << day_index(m.group(1)))
        return {n: mask for n in numbers}, 6
    return out, per_week


def minutes(s):
    s = s.lower()
    h = re.search(r"(\d+)\s*(?:h|hr|hrs|hour|hours)\b", s)
    m = re.search(r"(\d+)\s*(?:m|min|mins|minute|minutes)\b", s)
    if not h and not m:
        hm = re.search(r"\b(\d{1,2}):(\d{2})\b", s)
        return int(hm.group(1)) * 60 + int(hm.group(2)) if hm else 0
    return (int(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0)


def number(s):
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)", s or "")
    return float(m.group(1).replace(",", "")) if m else 0


# ---------------------------------------------------------------- stations, to place new trains' ends
stations = read_table("stations")
codes = {s["code"] for s in stations}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(railway station|station|junction|jn|terminus|terminal|cantonment|cantt|central|city)\b|[^a-z ]", " ", s)
    return " ".join(s.split())


by_name = {}
for s in stations:
    by_name.setdefault(norm(s["name"]), set()).add(s["code"])


def station_code(raw):
    m = re.search(r"\(\s*([A-Z]{2,5})\s*\)", re.sub(r"'{2,}", "", raw))
    if m and m.group(1) in codes:
        return m.group(1)
    hits = by_name.get(norm(plain(raw).split("/")[0]))
    return next(iter(hits)) if hits and len(hits) == 1 else ""


# ---------------------------------------------------------------- read every article
trains = {r["number"]: r for r in read_table("trains")}
ends = {}  # our timetable's first and last station for each train
for h in read_table("halts"):
    e = ends.setdefault(h["number"], [None, None, 0])
    seq = int(h["seq"])
    if seq == 1:
        e[0] = h["station"]
    if seq > e[2]:
        e[1], e[2] = h["station"], seq


def city_of(code):
    return next((c["id"] for c in CITIES if code in c["codes"]), code)


def same_ends(no, a, b):
    """Does the article describe the train we have under this number? Numbers get reused."""
    if no not in ends or not a or not b:
        return None  # can't tell
    ours = {city_of(ends[no][0]), city_of(ends[no][1])}
    return ours == {city_of(a), city_of(b)}

INDIA = re.compile(r"indian railways|railway zone|\b(northern|southern|eastern|western|central|north|south|east|west)[a-z ]*railway", re.I)
stats = Counter()
newer = []
days_for = {}  # number -> {(mask, title, verdict)}
for title, text in texts.items():
    box = infobox(text)
    nos = re.findall(r"\b\d{5}\b", plain(box.get("trainnumber", "")))
    if not nos or not INDIA.search(box.get("operator", "") + " " + text[:3000]):
        continue
    stats["indian"] += 1
    if plain(box.get("last", "")) or re.search(r"\b(discontinued|cancelled permanently|withdrawn)\b", plain(box.get("status", "")), re.I):
        stats["no longer runs"] += 1
        continue
    freq = plain(box.get("frequency", ""))
    masks, per_week = running_days(freq, set(nos))
    a, b = station_code(box.get("start", "")), station_code(box.get("end", ""))
    for no in nos:
        if no in masks:
            days_for.setdefault(no, set()).add((masks[no], title, same_ends(no, a, b)))
    known = [n for n in nos if n in trains]
    if known:
        stats["already in timetable"] += 1
        continue
    if nos[0].startswith("0"):
        stats["new, special (0xxxx) skipped"] += 1  # specials come and go; their articles go stale
        continue
    if not a or not b or a == b:
        stats["new, ends not matched"] += 1
        continue
    name = re.sub(r"\s*\([^)]*\)$", "", title)  # the article title is the tidiest name: "Mumbai CSMT–Gadag Express"
    kind = "VB" if "vande bharat" in (name + box.get("type", "")).lower() else "AB" if "amrit bharat" in (name + box.get("type", "")).lower() else ""
    common = {m for m in masks.values()}
    newer.append({
        "numbers": "/".join(nos[:2]), "name": name, "type": kind, "from": a, "to": b,
        "days": days_text(common.pop()) if len(common) == 1 and len(masks) == len(nos[:2]) else "",
        "per_week": per_week or "", "minutes": minutes(plain(box.get("journeytime", ""))) or "",
        "km": int(number(plain(box.get("distance", "")))) or "", "stops": int(number(plain(box.get("stops", "")))) or "",
        "src": f"wikipedia:{title}",
    })
    stats["new, added"] += 1

# ---------------------------------------------------------------- write
def pick(no):
    """One running-days answer per train, or none when articles disagree or describe another train."""
    claims = days_for.get(no, set())
    matching = {c for c in claims if c[2] is True}
    if matching:
        claims = matching
    elif any(c[2] is False for c in claims):
        stats["days: number now used by another train"] += 1
        return 0, ""
    masks = {c[0] for c in claims}
    if len(masks) > 1:
        stats["days: articles disagree"] += 1
        return 0, ""
    return (masks.pop(), next(iter(claims))[1]) if masks else (0, "")


updated = 0
for no, t in trains.items():
    if t["days_src"] == "override" or (t["days"] and t["days_src"] != "wikipedia"):
        continue  # never overwrite a hand correction or a better source
    if t["days"] and not days_for.get(no):
        # no article speaks for this train this time (moved, retitled, its infobox rewritten): keep
        # what an earlier read found, rather than forget it; articles that now disagree still clear it
        stats["days: kept, no article this time"] += 1
        continue
    mask, title = pick(no)
    new_days, new_src = (days_text(mask), "wikipedia") if mask else ("", "")
    if (t["days"], t["days_src"]) != (new_days, new_src):
        t["days"], t["days_src"] = new_days, new_src
        updated += 1
write_table("trains", sorted(trains.values(), key=lambda t: t["number"]))
write_table("newer_trains", sorted(newer, key=lambda n: n["numbers"]))
print(dict(stats))
print(f"running days: {sum(1 for t in trains.values() if t['days'])} of {len(trains)} trains ({updated} changed); "
      f"newer trains: {len(newer)}")
