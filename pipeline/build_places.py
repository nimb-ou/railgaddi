"""Build public/data/places.json: travel-guide snippets for stations, from Wikivoyage (CC BY-SA 4.0).

For every reasonably busy station we find the Wikivoyage guides (via Wikidata) within 10 km,
pick the one that is *about* that town (name match, else the closest), and keep a few
others as "nearby" (Hosapete station -> Hampi). Then we pull each article's intro, lead
image and its See / Do listings.

Responses are cached on disk, so re-runs only fetch what is new.
"""
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(sys.argv[1]) / "wv-cache"
CACHE.mkdir(parents=True, exist_ok=True)
NET = json.load(open(ROOT / "public" / "data" / "network.json"))
OUT = ROOT / "public" / "data" / "places.json"
API = "https://en.wikivoyage.org/w/api.php"
UA = "PatriPrototype/0.1 (personal non-commercial train-discovery prototype)"
MIN_HALTS = 8


def api(params):
    params = {**params, "format": "json", "formatversion": "2", "maxlag": "5"}
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(8):
        try:
            time.sleep(0.6)  # stay polite: serial requests, well under Wikimedia's limits
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            if "error" in data and data["error"].get("code") == "maxlag":
                time.sleep(5)
                continue
            f.write_text(json.dumps(data))
            return data
        except Exception as e:  # noqa: BLE001
            time.sleep(5 * (attempt + 1))
            err = e
    raise RuntimeError(f"failed {url}: {err}")


STOP = {"jn", "junction", "cantt", "cantonment", "city", "road", "halt", "railway", "station", "terminus",
        "town", "central", "east", "west", "north", "south", "new", "old", "main", "cant"}


def toks(s):
    s = unicodedata.normalize("NFKD", s).lower()
    s = re.sub(r"[^a-z ]", " ", s)
    return {t for t in s.split() if len(t) > 2 and t not in STOP}


S = NET["stations"]
n = len(S["code"])
city_by_station = {}
for c in NET["cities"]:
    for i in c["stations"]:
        city_by_station[i] = c

candidates = [i for i in range(n) if S["lat"][i] is not None and (S["halts"][i] >= MIN_HALTS or i in city_by_station)]
print("stations to look up:", len(candidates))


# Every Indian Wikidata item with an English Wikivoyage guide and coordinates, fetched once:
#   SELECT ?item ?article ?coord WHERE { ?article schema:about ?item ;
#     schema:isPartOf <https://en.wikivoyage.org/> . ?item wdt:P17 wd:Q668 ; wdt:P625 ?coord . }
GUIDES = []
for b in json.load(open(Path(sys.argv[1]) / "wv_india.json"))["results"]["bindings"]:
    title = urllib.parse.unquote(b["article"]["value"].rsplit("/wiki/", 1)[1]).replace("_", " ")
    m = re.search(r"Point\(([-\d.]+) ([-\d.]+)\)", b["coord"]["value"])
    if m and "entity/Q" not in b["coord"]["value"]:  # skip non-Earth globes
        GUIDES.append((title, float(m.group(2)), float(m.group(1))))


def dist_m(lat1, lon1, lat2, lon2):
    import math
    p = math.pi / 180
    x = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def lookup(i):
    lat, lon = S["lat"][i], S["lon"][i]
    hits = sorted((dist_m(lat, lon, glat, glon), t) for t, glat, glon in GUIDES
                  if abs(glat - lat) < 0.12 and abs(glon - lon) < 0.12)
    hits = [(d, t) for d, t in hits if d <= 10000]
    names = toks(S["name"][i])
    if i in city_by_station:
        c = city_by_station[i]
        names |= toks(c["name"]) | {t for a in c["aka"] for t in toks(a)}
    seen, arts = set(), []
    for d, t in hits:
        title = t.split("/")[0]  # district pages roll up to their city
        if title in seen:
            continue
        seen.add(title)
        arts.append((title, d))
    arts = [(t, d) for t, d in arts if not NOT_A_PLACE.search(t)]
    # exact name match beats partial overlap beats "closest guide within 5 km"
    ranked = []
    for title, dist in arts:
        tt = toks(title)
        rank = 0 if tt and tt <= names else 1 if tt & names else 2 if dist < 5000 else None
        if rank is not None:
            ranked.append((rank, dist, title))
    primary = min(ranked)[2] if ranked else None
    nearby = [t for t, d in arts if t != primary][:3]
    return i, primary, nearby


# Guide pages that are regions, itineraries or infrastructure rather than somewhere to go.
NOT_A_PLACE = re.compile(
    r"\b(district|division|region|pradesh|karnataka|kerala|goa$|rajasthan|gujarat|maharashtra|bengal|"
    r"walk|itinerary|station|airport|heritage|circuit|trail|township|college)\b"
    r"|^(north|south|east|west|central|northern|southern|eastern|western|north\w+|south\w+)\s",
    re.I,
)
GUIDE_TITLES = {t.lower(): t for t, _, _ in GUIDES if "/" not in t}


station_links = {}
for i in candidates:
    _, primary, nearby = lookup(i)
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
print("articles:", len(titles))

# ---------- article details ----------
articles = {}
for b in range(0, len(titles), 20):
    batch = titles[b:b + 20]
    r = api({"action": "query", "titles": "|".join(batch), "redirects": 1,
             "prop": "extracts|pageprops|coordinates|info", "exintro": 1, "explaintext": 1,
             "exsentences": 3, "exlimit": 20, "ppprop": "page_image_free|wikibase_item", "inprop": "url"})
    q = r.get("query", {})
    redirects = {x["from"]: x["to"] for x in q.get("redirects", [])} | {x["from"]: x["to"] for x in q.get("normalized", [])}
    for p in q.get("pages", []):
        if p.get("missing"):
            continue
        extract = re.sub(r"\s+", " ", p.get("extract", "")).strip()
        extract = re.sub(r"\s*\([^()]*[^\x00-\x7F][^()]*\)", "", extract)  # drop native-script parentheticals
        coords = (p.get("coordinates") or [{}])[0]
        articles[p["title"]] = {
            "x": extract,
            "img": p.get("pageprops", {}).get("page_image_free"),
            "lat": coords.get("lat"), "lon": coords.get("lon"),
        }
    for src, dst in redirects.items():
        if dst in articles:
            articles.setdefault(src, {"alias": dst})

# ---------- See / Do listings ----------
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
    out, depth, cur = {}, 0, ""
    parts = []
    for ch_i, ch in enumerate(body):
        if body.startswith("{{", ch_i) or body.startswith("[[", ch_i):
            depth += 1
        if body.startswith("}}", ch_i) or body.startswith("]]", ch_i):
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


def shorten(s, limit=190):
    if len(s) <= limit:
        return s
    cut = s[:limit]
    dot = cut.rfind(". ")
    return cut[:dot + 1] if dot > 80 else cut.rsplit(" ", 1)[0] + "…"


real = [t for t, a in articles.items() if "alias" not in a]
for b in range(0, len(real), 25):
    batch = real[b:b + 25]
    r = api({"action": "query", "titles": "|".join(batch), "prop": "revisions", "rvprop": "content", "rvslots": "main"})
    for p in r.get("query", {}).get("pages", []):
        if p["title"] not in articles or not p.get("revisions"):
            continue
        text = p["revisions"][0]["slots"]["main"]["content"]
        see, do = [], []
        for kind, body in templates(text):
            pr = params(body)
            if kind == "listing":
                kind = pr.get("type", "").lower()
            if kind not in ("see", "do"):
                continue
            name = clean(pr.get("name", ""))
            desc = clean(pr.get("content") or pr.get("description") or "")
            if not name or len(name) > 70:
                continue
            item = {"n": name, "d": shorten(desc)} if desc else {"n": name}
            (see if kind == "see" else do).append(item)
        # listings with a description first; they make better cards
        key = lambda it: 0 if it.get("d") else 1
        articles[p["title"]]["see"] = sorted(see, key=key)[:6]
        articles[p["title"]]["do"] = sorted(do, key=key)[:5]

doc = {
    "meta": {"source": "Wikivoyage (en), CC BY-SA 4.0", "fetched": time.strftime("%Y-%m-%d")},
    "articles": articles,
    "stations": station_links,
    "cities": city_links,
}
OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
with_listings = sum(1 for a in articles.values() if a.get("see") or a.get("do"))
print(f"stations linked: {len(station_links)}  articles: {len(real)} ({with_listings} with listings)  -> {OUT.stat().st_size / 1e6:.2f} MB")
