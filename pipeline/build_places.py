"""Build data/places/ (index.json + 32 shards): what each destination looks like and what to do there.

1. Match stations to Wikivoyage guides. Candidates are every Indian Wikivoyage guide
   (listed via Wikidata), within 10 km of the station. Prefer the guide *about* that
   town (name match, else the closest); keep a few others as "nearby"
   (Hosapete station -> Hampi).
2. For each guide, collect its intro and its See / Do listings (name, blurb, photo, position).
3. Photos: the place's Wikidata photo (P18) becomes its map bubble (Mysore -> the palace),
   and its Wikivoyage banner (P948) becomes the header. Listings take their own `image=`,
   else the photo of their Wikidata item.
4. Landmarks: every photographed heritage site, temple, fort, lake, waterfall… in India
   from one Wikidata query (RAW/wd_landmarks.json), ranked by how many Wikipedias cover
   it. They fill out each guide's sights, and give stations with no guide but real
   landmarks a place of their own (Shravanabelagola -> the Gommateshwara statue).
5. Thumbnails are computed from file names; credits (author, licence) come from Commons
   where known, otherwise the photo links to its Commons page, which carries them.

Text: Wikivoyage, CC BY-SA. Landmarks: Wikidata, CC0. Photos: Wikimedia Commons, per file.

Every API response is cached in RAW/wv-cache and indexed by title / item / file, so a
re-run only asks for what is genuinely new. `--quick` never calls an API at all and
builds from what is known (Wikimedia rate-limits unidentified clients hard).
"""
import hashlib
import html
import json
import math
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(sys.argv[1])
CACHE = RAW / "wv-cache"
CACHE.mkdir(parents=True, exist_ok=True)
NET = json.load(open(ROOT / "data" / "meta.json"))
OUT = ROOT / "data" / "places"
SHARDS = 32  # place details are split so opening a place fetches ~15 kB, not the whole guide
WV = "https://en.wikivoyage.org/w/api.php"
WD = "https://www.wikidata.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
UA = "Railgaddi/1.0 (https://github.com/nimb-ou/railgaddi; non-commercial train-discovery site)"
MIN_HALTS = 8
MAX_SIGHTS = 8
QUICK = "--quick" in sys.argv
CREDITS = "--credits" in sys.argv  # photo credits mean thousands of Commons lookups: opt in


def api(params, base=WV):
    params = {**params, "format": "json", "formatversion": "2", "maxlag": "5"}
    keyed = params if base == WV else {**params, "__base": base}
    key = hashlib.sha1(json.dumps(keyed, sort_keys=True).encode()).hexdigest()
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    url = base + "?" + urllib.parse.urlencode(params)
    err = None
    for attempt in range(12):
        try:
            time.sleep(1.2)  # polite: serial requests; Wikimedia rate-limits unidentified clients
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read())
            if "error" in data and data["error"].get("code") == "maxlag":
                time.sleep(5)
                continue
            f.write_text(json.dumps(data))
            return data
        except urllib.error.HTTPError as e:
            err = e
            wait = int(e.headers.get("Retry-After") or 30) if e.code == 429 else 5 * (attempt + 1)
            print(f"  {e.code}, waiting {wait}s", flush=True)
            time.sleep(wait + 1)
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed {url}: {err}")


def chunks(xs, n):
    xs = list(xs)
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def dist_m(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    x = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


STOP = {"jn", "junction", "cantt", "cantonment", "city", "road", "halt", "railway", "station", "terminus",
        "town", "central", "east", "west", "north", "south", "new", "old", "main", "cant"}


def toks(s):
    s = unicodedata.normalize("NFKD", s).lower()
    s = re.sub(r"[^a-z ]", " ", s)
    return {t for t in s.split() if len(t) > 2 and t not in STOP}


def squash(s):
    return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", s).lower())


# ---------------------------------------------------------------- cache index
# Everything we've ever fetched, by title / Wikidata item / Commons file.
EXTRACTS, REVISIONS, ALIASES, ENTITIES, IMAGEINFO = {}, {}, {}, {}, {}


def absorb(d):
    if "entities" in d:
        ENTITIES.update({k: v for k, v in d["entities"].items() if "missing" not in v})
        return
    q = d.get("query") or {}
    for x in q.get("redirects", []) + q.get("normalized", []):
        ALIASES.setdefault(x["from"], x["to"])
    for p in q.get("pages", []):
        if p.get("missing") or p.get("invalid"):
            continue
        if "imageinfo" in p:
            IMAGEINFO[p["title"].split(":", 1)[1]] = p["imageinfo"][0]
        elif "revisions" in p:
            REVISIONS[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
        elif "extract" in p:
            EXTRACTS[p["title"]] = p


for f in CACHE.glob("*.json"):
    try:
        absorb(json.loads(f.read_text()))
    except (ValueError, KeyError):
        pass
print(f"cache: {len(EXTRACTS)} guides, {len(REVISIONS)} guide texts, {len(ENTITIES)} items, {len(IMAGEINFO)} photo credits")


def resolve(t):
    seen = set()
    while t in ALIASES and t not in seen:
        seen.add(t)
        t = ALIASES[t]
    return t


def fetch_missing(kind, keys, size, params):
    keys = sorted(set(keys))
    if QUICK or not keys:
        return
    print(f"fetching {len(keys)} new {kind}", flush=True)
    for batch in chunks(keys, size):
        absorb(api(params(batch), base=COMMONS if kind == "credits" else WD if kind == "items" else WV))


# ---------------------------------------------------------------- 1. stations -> guides
S = NET["stations"]
city_by_station = {i: c for c in NET["cities"] for i in c["stations"]}
candidates = [i for i in range(len(S["code"])) if S["lat"][i] is not None and (S["halts"][i] >= MIN_HALTS or i in city_by_station)]
print("stations to look up:", len(candidates))

GUIDES = []
for b in json.load(open(RAW / "wv_india.json"))["results"]["bindings"]:
    title = urllib.parse.unquote(b["article"]["value"].rsplit("/wiki/", 1)[1]).replace("_", " ")
    m = re.search(r"Point\(([-\d.]+) ([-\d.]+)\)", b["coord"]["value"])
    if m and "entity/Q" not in b["coord"]["value"]:  # skip non-Earth globes
        GUIDES.append((title, float(m.group(2)), float(m.group(1))))
GUIDE_TITLES = {t.lower(): t for t, _, _ in GUIDES if "/" not in t}
GUIDE_LL = {t: (lat, lon) for t, lat, lon in GUIDES}

# Guide pages that are regions, itineraries or infrastructure rather than somewhere to go.
NOT_A_PLACE = re.compile(
    r"\b(district|division|region|pradesh|karnataka|kerala|goa$|rajasthan|gujarat|maharashtra|bengal|"
    r"telangana|punjab|haryana|bihar|odisha|jharkhand|chhattisgarh|uttarakhand|assam|tamil nadu|"
    r"phrasebook|walk|itinerary|station|airport|heritage|circuit|trail|township|college|parganas|"
    r"kongu nadu|saurashtra|bundelkhand|birbhum|nadia|malwa|marwar|mewar|konkan|malabar|doaba|"
    r"purvanchal|awadh|vidarbha|marathwada|khandesh|rayalaseema|tulu nadu)\b"
    r"|^(north|south|east|west|central|northern|southern|eastern|western|north\w+|south\w+|"
    r"purba|paschim|dakshin|uttar)\s",
    re.I,
)


def lookup(i):
    lat, lon = S["lat"][i], S["lon"][i]
    hits = sorted((dist_m(lat, lon, glat, glon), t) for t, glat, glon in GUIDES
                  if abs(glat - lat) < 0.12 and abs(glon - lon) < 0.12)
    names = toks(S["name"][i])
    if i in city_by_station:
        c = city_by_station[i]
        names |= toks(c["name"]) | {t for a in c["aka"] for t in toks(a)}
    seen, arts = set(), []
    for d, t in hits:
        title = t.split("/")[0]  # district pages roll up to their city
        if d <= 10000 and title not in seen and not NOT_A_PLACE.search(title):
            seen.add(title)
            arts.append((title, d))
    # exact name match beats partial overlap beats "closest guide within 5 km"
    ranked = []
    for title, d in arts:
        tt = toks(title)
        rank = 0 if tt and tt <= names else 1 if tt & names else 2 if d < 5000 else None
        if rank is not None:
            ranked.append((rank, d, title))
    primary = min(ranked)[2] if ranked else None
    return primary, [t for t, _ in arts if t != primary][:3]


station_links = {}
for i in candidates:
    primary, nearby = lookup(i)
    if primary or nearby:
        station_links[S["code"][i]] = [primary, nearby]

# Curated cities: a guide titled exactly like the city (or a well-known alias) wins outright.
city_links = {}
for c in NET["cities"]:
    for name in [c["name"], *c["aka"]]:
        if name.lower() in GUIDE_TITLES:
            city_links[c["id"]] = GUIDE_TITLES[name.lower()]
            break
    else:
        for i in c["stations"]:
            link = station_links.get(S["code"][i])
            if link and link[0]:
                city_links[c["id"]] = link[0]
                break

titles = sorted({t for p, nb in station_links.values() for t in ([p] if p else []) + nb} | set(city_links.values()))
print("guides wanted:", len(titles))

# ---------------------------------------------------------------- 2. guide text + listings
fetch_missing("guides", [t for t in titles if resolve(t) not in EXTRACTS], 20, lambda b: {
    "action": "query", "titles": "|".join(b), "redirects": 1, "prop": "extracts|pageprops|coordinates|info",
    "exintro": 1, "explaintext": 1, "exsentences": 3, "exlimit": 20, "ppprop": "page_image_free|wikibase_item", "inprop": "url"})

articles, aliases = {}, {}
for t in titles:
    r = resolve(t)
    p = EXTRACTS.get(r)
    if not p:
        continue
    if r != t:
        aliases[t] = r
    extract = re.sub(r"\s+", " ", p.get("extract", "")).strip()
    extract = re.sub(r"\s*\([^()]*[^\x00-\x7F][^()]*\)", "", extract)  # drop native-script parentheticals
    coords = (p.get("coordinates") or [{}])[0]
    lat, lon = coords.get("lat"), coords.get("lon")
    if lat is None and r in GUIDE_LL:
        lat, lon = GUIDE_LL[r]
    pp = p.get("pageprops", {})
    articles[r] = {"x": extract, "qid": pp.get("wikibase_item"), "lead": pp.get("page_image_free"), "lat": lat, "lon": lon}
print("guides known:", len(articles), "of", len(titles))

# forget links to guides we couldn't get, so those stations can still become places from landmarks
# a town's guide that Wikivoyage has merged into its district's ("Balurghat" -> "Dakshin
# Dinajpur") isn't a destination either
known = lambda t: t and resolve(t) in articles and not NOT_A_PLACE.search(resolve(t))  # noqa: E731
for code, (primary, nearby) in list(station_links.items()):
    primary = resolve(primary) if known(primary) else None
    nearby = [r for r in dict.fromkeys(resolve(t) for t in nearby if known(t)) if r != primary]
    if primary or nearby:
        station_links[code] = [primary, nearby]
    else:
        del station_links[code]
# a curated city keeps the guide named exactly like it, even one that also covers a state
# (Goa: the place people mean is the coast, and Wikivoyage's "Goa" is its guide, not Margao's)
exact = {c["id"] for c in NET["cities"] for n in [c["name"], *c["aka"]][:1] if n.lower() in GUIDE_TITLES}
city_links = {k: resolve(v) for k, v in city_links.items() if known(v) or (k in exact and resolve(v) in articles)}

LISTING = re.compile(r"\{\{\s*(see|do|listing)\s*\|", re.I)


def templates(text):
    for m in LISTING.finditer(text):
        depth, j = 0, m.start()
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1
                j += 2
            elif text.startswith("}}", j):
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        yield m.group(1).lower(), text[m.end():j - 2]


def params(body):
    out, depth, cur, parts = {}, 0, "", []
    for i, ch in enumerate(body):
        if body.startswith("{{", i) or body.startswith("[[", i):
            depth += 1
        if body.startswith("}}", i) or body.startswith("]]", i):
            depth -= 1
        if ch == "|" and depth <= 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    for p in parts:
        if "=" in p:
            k, v = p.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def clean(s):
    s = re.sub(r"<ref[^>]*/>|<ref.*?</ref>", "", s, flags=re.S)
    for _ in range(3):
        s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\s([^\]]+)\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\]", "", s)
    s = re.sub(r"'{2,}", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"^#\d+[.:)]?\s*", "", s.strip())  # map-legend numbers ("#23. Dedicated to ...")
    return re.sub(r"\s+", " ", s).strip()


def shorten(s, limit=170):
    if len(s) <= limit:
        return s
    cut = s[:limit]
    dot = cut.rfind(". ")
    return cut[:dot + 1] if dot > 70 else cut.rsplit(" ", 1)[0] + "…"


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def file_name(s):
    s = re.sub(r"^(file|image):", "", (s or "").strip(), flags=re.I).replace("_", " ").strip()
    return s if re.search(r"\.(jpe?g|png|webp|tiff?|gif)$", s, re.I) else None


fetch_missing("guide texts", [t for t in articles if t not in REVISIONS], 25, lambda b: {
    "action": "query", "titles": "|".join(b), "prop": "revisions", "rvprop": "content", "rvslots": "main"})

listings = {}
for title in articles:
    text = REVISIONS.get(title)
    if not text:
        continue
    items = []
    for kind, body in templates(text):
        pr = params(body)
        if kind == "listing":
            kind = pr.get("type", "").lower()
        if kind not in ("see", "do"):
            continue
        name = clean(pr.get("name", ""))
        if not name or len(name) > 70:
            continue
        qid = pr.get("wikidata", "").strip()
        items.append({
            "n": name,
            "d": shorten(clean(pr.get("content") or pr.get("description") or "")),
            "k": kind,
            "img": file_name(pr.get("image")),
            "qid": qid if re.fullmatch(r"Q\d+", qid) else None,
            "lat": num(pr.get("lat")), "lon": num(pr.get("long")),
        })
    listings[title] = items
print("listings parsed:", sum(len(v) for v in listings.values()))

# ---------------------------------------------------------------- 3. Wikidata photos
qids = {a["qid"] for a in articles.values() if a["qid"]} | {it["qid"] for v in listings.values() for it in v if it["qid"]}
fetch_missing("items", [q for q in qids if q not in ENTITIES], 50, lambda b: {
    "action": "wbgetentities", "ids": "|".join(b), "props": "claims"})


def claim(q, prop):
    for x in ENTITIES.get(q or "", {}).get("claims", {}).get(prop, []):
        v = x.get("mainsnak", {}).get("datavalue", {}).get("value")
        if v:
            return v
    return None


for items in listings.values():
    for it in items:
        it["img"] = it["img"] or claim(it["qid"], "P18")
        coord = claim(it["qid"], "P625")
        if it["lat"] is None and isinstance(coord, dict):
            it["lat"], it["lon"] = coord.get("latitude"), coord.get("longitude")

# ---------------------------------------------------------------- 4. landmarks
# heritage-listed, but not why anyone takes a train somewhere
NOT_A_SIGHT = re.compile(r"\b(railway station|station building|school|college|university|hospital|office|court|bank|"
                         r"police|secretariat|collectorate|circuit house|dak bungalow|residency building)\b", re.I)
LANDMARKS = {}
lm_file = RAW / "wd_landmarks.json"
if lm_file.exists():
    for b in json.load(open(lm_file))["results"]["bindings"]:
        q = b["item"]["value"].rsplit("/", 1)[1]
        m = re.search(r"Point\(([-\d.]+) ([-\d.]+)\)", b["coord"]["value"])
        img = file_name(urllib.parse.unquote(b["image"]["value"].rsplit("/", 1)[1]))
        label = b["label"]["value"].strip()
        if q in LANDMARKS or not m or not img or re.fullmatch(r"[A-Z0-9\-/ ]+", label) or NOT_A_SIGHT.search(label):
            continue
        desc = b.get("desc", {}).get("value", "")
        LANDMARKS[q] = {"q": q, "n": label, "d": desc[:1].upper() + desc[1:], "img": img,
                        "lat": float(m.group(2)), "lon": float(m.group(1)), "links": int(b["links"]["value"])}
print("landmarks:", len(LANDMARKS))

GRID = defaultdict(list)
for lm in LANDMARKS.values():
    GRID[(int(lm["lat"] * 10), int(lm["lon"] * 10))].append(lm)


def landmarks_near(lat, lon, km):
    """Photographed landmarks within `km`, most famous (most Wikipedia languages) first."""
    r = int(km / 10) + 1
    ci, cj = int(lat * 10), int(lon * 10)
    out = []
    for di in range(-r, r + 1):
        for dj in range(-r, r + 1):
            for lm in GRID.get((ci + di, cj + dj), ()):
                if dist_m(lat, lon, lm["lat"], lm["lon"]) <= km * 1000:
                    out.append(lm)
    return sorted(out, key=lambda lm: -lm["links"])


def as_sight(lm):
    return {"n": lm["n"], "d": lm["d"], "k": "see", "img": lm["img"], "lat": lm["lat"], "lon": lm["lon"], "q": lm["q"]}


sights = {}
for title, a in articles.items():
    items = listings.get(title, [])
    with_img = [it for it in items if it["img"]]
    without = [it for it in items if not it["img"] and it["d"]]
    have_q = {it["qid"] for it in items if it["qid"]}
    have_n = [squash(it["n"]) for it in items]

    def known(lm):
        n = squash(lm["n"])
        return lm["q"] in have_q or any(n == h or (min(len(n), len(h)) >= 6 and (n in h or h in n)) for h in have_n)

    chosen = with_img[:5]
    here = squash(title)
    if a["lat"] is not None:
        for lm in landmarks_near(a["lat"], a["lon"], 12):
            if len(chosen) >= MAX_SIGHTS:
                break
            if lm["links"] >= 2 and not known(lm) and squash(lm["n"]) != here:  # not "Hampi" as a sight of Hampi
                chosen.append(as_sight(lm))
                have_n.append(squash(lm["n"]))
    chosen += with_img[5:][: max(0, MAX_SIGHTS - len(chosen))]
    chosen += without[: max(0, 6 - len(chosen))]
    sights[title] = chosen

# Stations with no guide but real landmarks become places of their own.
TOWN = re.compile(r"\s*\(.*?\)|\s+(junction|jn\.?|halt|cantt|cantonment|town|city|railway station)$", re.I)
pseudo = {}
guide_pts = [(t, a["lat"], a["lon"]) for t, a in articles.items() if a["lat"] is not None and "/" not in t]
for i, code in enumerate(S["code"]):
    if code in station_links or S["lat"][i] is None or S["halts"][i] < 2:
        continue
    # a small station on the edge of a town with a guide belongs to that guide (Madurai East -> Madurai)
    lat, lon = S["lat"][i], S["lon"][i]
    close = min(((dist_m(lat, lon, glat, glon), t) for t, glat, glon in guide_pts
                 if abs(glat - lat) < 0.1 and abs(glon - lon) < 0.1), default=None)
    if close and close[0] <= 8000:
        station_links[code] = [close[1], []]
        continue
    lms = [lm for lm in landmarks_near(S["lat"][i], S["lon"][i], 7) if lm["links"] >= 3]
    if not lms or (lms[0]["links"] < 8 and len(lms) < 2):
        continue
    town = TOWN.sub("", S["name"][i]).strip() or code
    title = town if town not in articles and town not in pseudo else f"{town} ({code})"
    top = lms[0]
    pseudo[title] = {
        "x": f"Near the station: {top['n']}" + (f" ({top['d']})" if top["d"] else "") + ".",
        "qid": None, "lead": top["img"], "lat": S["lat"][i], "lon": S["lon"][i], "src": "wd",
        "appeal": sum(min(lm["links"], 40) for lm in lms[:5]) / 8 + min(len(lms), MAX_SIGHTS),
    }
    sights[title] = [as_sight(lm) for lm in lms[:MAX_SIGHTS]]
    station_links[code] = [title, []]
print("places made from landmarks:", len(pseudo), "e.g.", [t for t in pseudo if "Shravan" in t][:2])

# ---------------------------------------------------------------- 5. photos
# a map, a flag or a word in a script isn't a photo of somewhere to go
NOT_A_PHOTO = re.compile(r"\.svg$|\bmaps?\b|locator|outline|\bin [A-Z][^()]* \(India\)|\bflag\b|\bseal\b|\blogo\b|emblem", re.I)


def icon_of(a):
    for f in (claim(a["qid"], "P18"), a["lead"]):
        if f and not NOT_A_PHOTO.search(f):
            return f
    return None


files = set()
for title, a in list(articles.items()) + list(pseudo.items()):
    for f in (icon_of(a), claim(a["qid"], "P948")):
        if f:
            files.add(f.replace("_", " "))
    for s in sights[title]:
        if s.get("img"):
            files.add(s["img"].replace("_", " "))

fetch_missing("credits", [f for f in files if f not in IMAGEINFO] if CREDITS else [], 40, lambda b: {
    "action": "query", "titles": "|".join("File:" + f for f in b), "prop": "imageinfo",
    "iiprop": "url|size|extmetadata", "iiurlwidth": 330, "iiextmetadatafilter": "Artist|LicenseShortName"})


def commons_thumb(name, w=330):
    """Thumbnail URL computed from the file name, the way MediaWiki lays out upload.wikimedia.org."""
    fn = name.replace(" ", "_")
    h = hashlib.md5(fn.encode("utf-8")).hexdigest()
    q = urllib.parse.quote(fn)
    ext = fn.rsplit(".", 1)[-1].lower()
    thumb = f"{w}px-{q}" + (".png" if ext == "svg" else "")
    if ext in ("tif", "tiff"):
        thumb = f"lossy-page1-{w}px-{q}.jpg"
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{q}/{thumb}"


def strip_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


photos = {}
for f in files:
    ii = IMAGEINFO.get(f)
    page = "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(f.replace(" ", "_"))
    if ii and ii.get("thumburl"):
        md = ii.get("extmetadata", {})
        # the canonical upload.wikimedia.org path, not the API's thumburl (which now points at a
        # tracking-tagged host the app can't resize): the app picks the size per screen
        photos[f] = {"t": commons_thumb(f), "w": ii.get("width"), "h": ii.get("height"),
                     "by": strip_html(md.get("Artist", {}).get("value", ""))[:60],
                     "lic": md.get("LicenseShortName", {}).get("value", ""), "page": ii.get("descriptionurl") or page}
    else:  # no API needed: the file page carries author and licence
        photos[f] = {"t": commons_thumb(f), "by": "", "lic": "", "page": page}
print("photos:", len(photos), "with credits:", sum(1 for p in photos.values() if p["lic"]))


def photo_key(f):
    f = (f or "").replace("_", " ")
    return f if f in photos else None


# ---------------------------------------------------------------- output
def sight_out(s):
    it = {"n": s["n"], "k": s["k"]}
    if s.get("d"):
        it["d"] = s["d"][:1].upper() + s["d"][1:]  # Wikidata descriptions start lower-case
    if photo_key(s.get("img")):
        it["img"] = photo_key(s["img"])
    if s.get("lat") is not None and s.get("lon") is not None:
        it["ll"] = [round(s["lat"], 5), round(s["lon"], 5)]
    if s.get("q"):
        it["q"] = s["q"]
    return it


out_articles = {}
for title, a in articles.items():
    if "/" in title:  # district pages (Kolkata/East) reached through redirects aren't destinations
        continue
    items = [sight_out(s) for s in sights[title]]
    banner = claim(a["qid"], "P948")
    out_articles[title] = {
        "x": a["x"],
        # its own photo, else its best sight's
        "icon": photo_key(icon_of(a)) or next((s["img"] for s in items if s.get("img")), None),
        "banner": photo_key(banner),
        "ll": [a["lat"], a["lon"]] if a["lat"] is not None else None,
        "sights": items,
        # how much there is to do: drives which places get a photo bubble first
        "appeal": len(listings.get(title, [])) + 3 * sum(1 for s in items if s.get("img")) + (6 if banner else 0),
    }
for title, a in pseudo.items():
    out_articles[title] = {"x": a["x"], "icon": photo_key(a["lead"]) if a["lead"] and not NOT_A_PHOTO.search(a["lead"]) else None, "banner": None, "ll": [a["lat"], a["lon"]],
                           "sights": [sight_out(s) for s in sights[title]], "appeal": round(a["appeal"], 1), "src": "wd"}

# ---------------------------------------------------------------- write: an index for the map, details in shards
def fnv1a(text):
    """32-bit FNV-1a over UTF-8; the app computes the same to find a place's shard."""
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/"


def photo_out(key):
    p = photos[key]
    out = {"t": p["t"][len(THUMB):] if p["t"].startswith(THUMB) else p["t"]}  # the app restores the prefix
    for k in ("w", "h", "by", "lic"):
        if p.get(k):
            out[k] = p[k]
    return out


# every link must land on a place we actually publish
exists = lambda t: t in out_articles  # noqa: E731
station_links = {c: [p if exists(p) else None, [t for t in nb if exists(t)]] for c, (p, nb) in station_links.items()}
station_links = {c: v for c, v in station_links.items() if v[0] or v[1]}
city_links = {k: v for k, v in city_links.items() if exists(v)}

index = {
    "meta": {"text": "Wikivoyage, CC BY-SA 4.0; landmarks from Wikidata, CC0",
             "photos": "Wikimedia Commons, licence per photo", "fetched": time.strftime("%Y-%m-%d"), "shards": SHARDS},
    "stations": station_links,
    "cities": city_links,
    "articles": {},
    "photos": {},
}
shards = [{"articles": {}, "photos": {}} for _ in range(SHARDS)]
for title, a in out_articles.items():
    entry = {k: a[k] for k in ("icon", "banner", "ll", "appeal") if a.get(k) is not None}
    if a.get("src"):
        entry["src"] = a["src"]
    entry["n"] = len(a["sights"])
    index["articles"][title] = entry
    for k in (a["icon"], a["banner"]):
        if k:
            index["photos"][k] = photo_out(k)
    shard = shards[fnv1a(title) % SHARDS]
    shard["articles"][title] = {"x": a["x"], "sights": a["sights"]}
    for sight in a["sights"]:
        if sight.get("img"):
            shard["photos"][sight["img"]] = photo_out(sight["img"])

OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.json"):
    old.unlink()
dump = lambda path, obj: path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))  # noqa: E731
dump(OUT / "index.json", index)
for i, shard in enumerate(shards):
    dump(OUT / f"{i:02d}.json", shard)
sizes = [(OUT / f"{i:02d}.json").stat().st_size for i in range(SHARDS)]
print(f"places: {len(out_articles)} ({sum(1 for a in out_articles.values() if a['icon'])} with a bubble photo, "
      f"{sum(1 for a in out_articles.values() if a['banner'])} with a banner); stations linked: {len(station_links)}")
print(f"  index.json {(OUT / 'index.json').stat().st_size / 1e3:.0f} kB; shards {min(sizes) / 1e3:.0f}-{max(sizes) / 1e3:.0f} kB")
print("sights per place:", Counter(min(len(a["sights"]), 8) for a in out_articles.values()).most_common())
