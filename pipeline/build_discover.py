"""Discover: journeys worth taking and railway facts (content/discover.json, written for Railgaddi)
-> data/discover.json, with each story's photo from Wikimedia Commons (author and licence
included) and every station code and train checked against the timetable in data/.

    python3 pipeline/build_discover.py raw

A story's photo is the lead image of its Wikipedia article, unless it names a Commons file.
Everything fetched is cached in RAW/discover-cache/; data/discover.json is committed, so the site
build doesn't need the network.
"""
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "raw"
CACHE = RAW / "discover-cache"
CACHE.mkdir(parents=True, exist_ok=True)
UA = "Railgaddi/1.0 (https://github.com/nimb-ou/railgaddi; non-commercial train-discovery site)"

content = json.loads((ROOT / "content" / "discover.json").read_text())
meta = json.loads((ROOT / "data" / "meta.json").read_text())
codes = set(meta["stations"]["code"])
trains = {t[0] for t in meta["trains"]}
problems = []


def api(base, params):
    params = {**params, "format": "json", "formatversion": "2"}
    key = hashlib.sha1((base + json.dumps(params, sort_keys=True)).encode()).hexdigest()
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    for attempt in range(6):
        try:
            time.sleep(1)
            req = urllib.request.Request(f"{base}?{urllib.parse.urlencode(params)}", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = json.loads(r.read())
            f.write_text(json.dumps(data))
            return data
        except Exception as e:  # noqa: BLE001
            print(f"  {e}; retrying", flush=True)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed: {params}")


def lead_image(article):
    d = api("https://en.wikipedia.org/w/api.php", {"action": "query", "prop": "pageimages", "piprop": "name", "titles": article, "redirects": 1})
    page = d["query"]["pages"][0]
    return page.get("pageimage")


def commons_thumb(name, w=330):
    """Thumbnail URL computed from the file name, as pipeline/build_places.py does."""
    fn = name.replace(" ", "_")
    h = hashlib.md5(fn.encode("utf-8")).hexdigest()
    q = urllib.parse.quote(fn)
    ext = fn.rsplit(".", 1)[-1].lower()
    return f"https://upload.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{q}/{w}px-{q}" + (".png" if ext == "svg" else "")


def photo(name):
    d = api("https://commons.wikimedia.org/w/api.php", {"action": "query", "titles": f"File:{name}", "prop": "imageinfo",
                                                        "iiprop": "size|extmetadata", "iiextmetadatafilter": "Artist|LicenseShortName"})
    page = d["query"]["pages"][0]
    ii = (page.get("imageinfo") or [{}])[0]
    if not ii:
        return None
    md = ii.get("extmetadata", {})
    strip = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()  # noqa: E731
    return {"t": commons_thumb(name), "w": ii.get("width"), "h": ii.get("height"),
            "by": strip(md.get("Artist", {}).get("value", ""))[:60], "lic": md.get("LicenseShortName", {}).get("value", ""),
            "page": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(name.replace(" ", "_"))}


stories = []
for s in content["stories"]:
    rides = []
    for r in s["rides"]:
        if r["from"] not in codes or r["to"] not in codes:
            problems.append(f"story {s['slug']}: unknown station in ride {r}")
            continue
        if r.get("train") and r["train"] not in trains:
            print(f"  story {s['slug']}: train {r['train']} isn't in the timetable; the ride opens the route instead")
            r = {k: v for k, v in r.items() if k != "train"}
        rides.append(r)
    name = s.get("photo") or lead_image(s["article"])
    ph = photo(name) if name else None
    if not ph or (ph["w"] or 0) < 640:
        print(f"  story {s['slug']}: no good photo ({name}); pick one with \"photo\"")
    print(f"  {s['slug']}: {name}")
    stories.append({k: v for k, v in s.items() if k not in ("article", "photo")} | {"rides": rides, "photo": ph})

facts = []
for f in content["facts"]:
    known = [c for c in f.get("stations", []) if c in codes]
    for c in f.get("stations", []):
        if c not in codes:
            print(f"  fact {f['text'][:40]}…: station {c} isn't in the timetable (no place link)")
    facts.append({"id": hashlib.md5(f["text"].encode()).hexdigest()[:8], "cat": f["cat"], "text": f["text"], "source": f["source"],
                  **({"stations": known} if known else {})})

if problems:
    sys.exit("\n".join(problems))
out = ROOT / "data" / "discover.json"
out.write_text(json.dumps({"stories": stories, "facts": facts}, ensure_ascii=False, separators=(",", ":")))
print(f"{out}: {len(stories)} stories, {len(facts)} facts, {out.stat().st_size / 1e3:.0f} kB")
