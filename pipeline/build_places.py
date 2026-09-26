"""Build public/data/places.json: what each destination looks like and what to do there.

1. Match stations to Wikivoyage guides. Candidates are every Indian Wikivoyage guide
   (listed via Wikidata), within 10 km of the station. Prefer the guide *about* that
   town (name match, else the closest); keep a few others as "nearby"
   (Hosapete station -> Hampi).
2. For each guide, collect its intro and its See / Do listings (name, blurb, photo, position).
3. Photos: the place's Wikidata photo (P18) becomes its map bubble (Mysore -> the palace),
   and its Wikivoyage banner (P948) becomes the header. Listings take their own `image=`,
   else the photo of their Wikidata item.
4. Where a guide has few photographed sights (small towns), add notable landmarks from
   Wikipedia near the place: temples, forts, lakes, falls and the like.
5. Fetch credit (author, licence) and a thumbnail URL for every photo from Wikimedia Commons.

Text: Wikivoyage / Wikipedia, CC BY-SA. Photos: Wikimedia Commons, licence per file.
All responses are cached on disk (RAW/wv-cache), so re-runs only fetch what's new.
"""
import hashlib
import json
import math
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(sys.argv[1])
CACHE = RAW / "wv-cache"
CACHE.mkdir(parents=True, exist_ok=True)
NET = json.load(open(ROOT / "public" / "data" / "network.json"))
OUT = ROOT / "public" / "data" / "places.json"
WV = "https://en.wikivoyage.org/w/api.php"
WP = "https://en.wikipedia.org/w/api.php"
WD = "https://www.wikidata.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
UA = "PatriPrototype/0.1 (personal non-commercial train-discovery prototype)"
MIN_HALTS = 8
MAX_SIGHTS = 8
# --quick: use only what is cached or needs no API (Wikimedia rate-limits unidentified clients hard).
# Skips new Wikipedia landmark lookups and photo-credit lookups; thumbnails are computed from file names.
QUICK = "--quick" in sys.argv


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

# Guide pages that are regions, itineraries or infrastructure rather than somewhere to go.
NOT_A_PLACE = re.compile(
    r"\b(district|division|region|pradesh|karnataka|kerala|goa$|rajasthan|gujarat|maharashtra|bengal|"
    r"walk|itinerary|station|airport|heritage|circuit|trail|township|college)\b"
    r"|^(north|south|east|west|central|northern|southern|eastern|western|north\w+|south\w+)\s",
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
print("guides:", len(titles))

# ---------------------------------------------------------------- 2. guide text + listings
articles = {}
aliases = {}
for batch in chunks(titles, 20):
    r = api({"action": "query", "titles": "|".join(batch), "redirects": 1,
             "prop": "extracts|pageprops|coordinates|info", "exintro": 1, "explaintext": 1,
             "exsentences": 3, "exlimit": 20, "ppprop": "page_image_free|wikibase_item", "inprop": "url"})
    q = r.get("query", {})
    for x in q.get("redirects", []) + q.get("normalized", []):
        aliases[x["from"]] = x["to"]
    for p in q.get("pages", []):
        if p.get("missing"):
            continue
        extract = re.sub(r"\s+", " ", p.get("extract", "")).strip()
        extract = re.sub(r"\s*\([^()]*[^\x00-\x7F][^()]*\)", "", extract)  # drop native-script parentheticals
        coords = (p.get("coordinates") or [{}])[0]
        pp = p.get("pageprops", {})
        articles[p["title"]] = {"x": extract, "qid": pp.get("wikibase_item"), "lead": pp.get("page_image_free"),
                                "lat": coords.get("lat"), "lon": coords.get("lon")}

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


listings = {}
for batch in chunks(articles, 25):
    r = api({"action": "query", "titles": "|".join(batch), "prop": "revisions", "rvprop": "content", "rvslots": "main"})
    for p in r.get("query", {}).get("pages", []):
        if p["title"] not in articles or not p.get("revisions"):
            continue
        text = p["revisions"][0]["slots"]["main"]["content"]
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
        listings[p["title"]] = items
print("listings parsed:", sum(len(v) for v in listings.values()))

# ---------------------------------------------------------------- 3. Wikidata photos
qids = {a["qid"] for a in articles.values() if a["qid"]} | {it["qid"] for v in listings.values() for it in v if it["qid"]}
claims = {}
for batch in chunks(sorted(qids), 50):
    r = api({"action": "wbgetentities", "ids": "|".join(batch), "props": "claims"}, base=WD)
    for q, ent in r.get("entities", {}).items():
        c = ent.get("claims", {})

        def first(prop):
            for x in c.get(prop, []):
                v = x.get("mainsnak", {}).get("datavalue", {}).get("value")
                if v:
                    return v
            return None
        coord = first("P625")
        claims[q] = {"p18": first("P18"), "p948": first("P948"),
                     "lat": coord.get("latitude") if isinstance(coord, dict) else None,
                     "lon": coord.get("longitude") if isinstance(coord, dict) else None}
print("wikidata items:", len(claims))

for items in listings.values():
    for it in items:
        cl = claims.get(it["qid"] or "", {})
        it["img"] = it["img"] or cl.get("p18")
        if it["lat"] is None and cl.get("lat") is not None:
            it["lat"], it["lon"] = cl["lat"], cl["lon"]

# ---------------------------------------------------------------- 4. Wikipedia landmarks for thin guides
LANDMARK = re.compile(
    r"\b(temple|mandir|fort|fortress|palace|lake|falls|waterfall|museum|beach|hill|peak|national park|"
    r"sanctuary|reserve|church|cathedral|basilica|mosque|masjid|dargah|tomb|mausoleum|cave|garden|dam|"
    r"monument|stupa|monastery|gurdwara|basadi|jain|ghat|island|zoo|statue|shrine|archaeological|"
    r"ruins|lighthouse|backwater|viewpoint|haveli|step ?well|baori|memorial|tea estate|valley)\b", re.I)
EXCLUDE = re.compile(r"\b(railway station|school|college|university|village|constituency|hospital|company|"
                     r"neighbourhood|suburb|district|taluk|mandal|panchayat|film|politician|born)\b", re.I)


def cached_only(params, base):
    params = {**params, "format": "json", "formatversion": "2", "maxlag": "5"}
    keyed = params if base == WV else {**params, "__base": base}
    f = CACHE / f"{hashlib.sha1(json.dumps(keyed, sort_keys=True).encode()).hexdigest()}.json"
    return json.loads(f.read_text()) if f.exists() else {}


def wikipedia_landmarks(lat, lon, skip):
    r = (cached_only if QUICK else api)({"action": "query", "generator": "geosearch", "ggscoord": f"{lat}|{lon}", "ggsradius": 10000,
             "ggslimit": 50, "prop": "pageimages|description|coordinates", "piprop": "name", "coprimary": "primary"}, WP)
    out = []
    for p in r.get("query", {}).get("pages", []):
        desc = p.get("description", "")
        text = f"{p['title']} {desc}"
        if not p.get("pageimage") or not LANDMARK.search(text) or EXCLUDE.search(text):
            continue
        if p["title"].lower() in skip:
            continue
        c = (p.get("coordinates") or [{}])[0]
        out.append({"n": p["title"], "d": desc[:1].upper() + desc[1:] if desc else "", "k": "see",
                    "img": file_name(p["pageimage"]), "lat": c.get("lat"), "lon": c.get("lon"), "wp": 1,
                    "rank": p.get("index", 99)})  # geosearch order: nearest first
    out.sort(key=lambda o: o.pop("rank"))
    return out


sights = {}
for title, a in articles.items():
    items = listings.get(title, [])
    with_img = [it for it in items if it["img"]]
    without = [it for it in items if not it["img"] and it["d"]]
    chosen = with_img[:MAX_SIGHTS]
    has_bubble = claims.get(a["qid"] or "", {}).get("p18") or a["lead"]
    if len(chosen) < 4 and a["lat"] is not None and has_bubble:
        names = {it["n"].lower() for it in items}
        chosen += wikipedia_landmarks(a["lat"], a["lon"], names)[:MAX_SIGHTS - len(chosen)]
    chosen += without[:max(0, 6 - len(chosen))]
    sights[title] = chosen
print("guides with 4+ photographed sights:", sum(1 for v in sights.values() if sum(1 for s in v if s.get("img")) >= 4))

# ---------------------------------------------------------------- 5. photo credits + thumbnails
def icon_of(a):
    cl = claims.get(a["qid"] or "", {})
    return cl.get("p18") or a["lead"]


files = set()
for title, a in articles.items():
    cl = claims.get(a["qid"] or "", {})
    for f in (icon_of(a), cl.get("p948")):
        if f:
            files.add(f.replace("_", " "))
    for s in sights[title]:
        if s.get("img"):
            files.add(s["img"])
print("photos:", len(files))


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


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


photos = {}
for f in files:  # baseline: no API needed; credits get filled in below when available
    photos[f] = {"t": commons_thumb(f), "by": "", "lic": "",
                 "page": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(f.replace(" ", "_"))}
for batch in chunks(sorted(files), 40):
    r = (cached_only if QUICK else api)({"action": "query", "titles": "|".join("File:" + f for f in batch), "prop": "imageinfo",
             "iiprop": "url|size|extmetadata", "iiurlwidth": 330,
             "iiextmetadatafilter": "Artist|LicenseShortName"}, COMMONS)
    q = r.get("query", {})
    norm = {x["to"]: x["from"] for x in q.get("normalized", [])}
    for p in q.get("pages", []):
        ii = (p.get("imageinfo") or [None])[0]
        if not ii or not ii.get("thumburl"):
            continue
        name = norm.get(p["title"], p["title"]).split(":", 1)[1]
        md = ii.get("extmetadata", {})
        artist = strip_html(md.get("Artist", {}).get("value", ""))
        photos[name] = {
            "t": ii["thumburl"],  # 330px; the app swaps the width for other sizes
            "w": ii.get("width"), "h": ii.get("height"),
            "by": artist[:60],
            "lic": md.get("LicenseShortName", {}).get("value", ""),
            "page": ii.get("descriptionurl"),
        }
print("photos:", len(photos), "with credits:", sum(1 for p in photos.values() if p["lic"]))


def photo_key(f):
    f = (f or "").replace("_", " ")
    return f if f in photos else None


# ---------------------------------------------------------------- output
out_articles = {}
for title, a in articles.items():
    if "/" in title:  # district pages (Kolkata/East) reached through redirects aren't destinations
        continue
    cl = claims.get(a["qid"] or "", {})
    items = []
    for s in sights[title]:
        it = {"n": s["n"], "k": s["k"]}
        if s.get("d"):
            it["d"] = s["d"]
        if photo_key(s.get("img")):
            it["img"] = photo_key(s["img"])
        if s.get("lat") is not None and s.get("lon") is not None:
            it["ll"] = [round(s["lat"], 5), round(s["lon"], 5)]
        if s.get("wp"):
            it["wp"] = 1
        items.append(it)
    all_listings = listings.get(title, [])
    out_articles[title] = {
        "x": a["x"],
        "icon": photo_key(icon_of(a)),
        "banner": photo_key(cl.get("p948")),
        "ll": [a["lat"], a["lon"]] if a["lat"] is not None else None,
        "sights": items,
        # how much there is to do: drives which places get a photo bubble first
        "appeal": len(all_listings) + 3 * sum(1 for s in items if s.get("img")) + (6 if cl.get("p948") else 0),
    }
for src, dst in aliases.items():
    if dst in out_articles and src not in out_articles:
        out_articles[src] = {"alias": dst}

doc = {
    "meta": {"text": "Wikivoyage & Wikipedia, CC BY-SA 4.0", "photos": "Wikimedia Commons, licence per photo",
             "fetched": time.strftime("%Y-%m-%d")},
    "articles": out_articles,
    "photos": photos,
    "stations": station_links,
    "cities": city_links,
}
OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
real = [a for a in out_articles.values() if "alias" not in a]
print(f"stations linked: {len(station_links)}  guides: {len(real)}  with bubble photo: {sum(1 for a in real if a['icon'])}"
      f"  with banner: {sum(1 for a in real if a['banner'])}  -> {OUT.stat().st_size / 1e6:.2f} MB")
print("sights per guide:", Counter(min(len(a["sights"]), 8) for a in real).most_common())
