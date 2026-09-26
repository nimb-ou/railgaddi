"""Fetch every photographed landmark in India from the Wikidata Query Service into RAW/wd_landmarks.json.

Split into small queries (the service times out long ones, and currently allows about one
request a minute), then merged. Usage: python3 pipeline/fetch_landmarks.py raw
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

RAW = Path(sys.argv[1])
UA = "RailgaddiPrototype/0.1 (personal non-commercial train-discovery project)"
GROUPS = {
    # start from India's own designations (Monument of National Importance, …): a handful of items
    "heritage sites": "?heritage wdt:P17 wd:Q668 . ?item wdt:P1435 ?heritage .",
    "temples": "?item wdt:P31 ?c . VALUES ?c { wd:Q44539 wd:Q842402 wd:Q5393308 }",
    "forts and monuments": "?item wdt:P31 ?c . VALUES ?c { wd:Q57821 wd:Q16560 wd:Q4989906 wd:Q179700 wd:Q839954 wd:Q1081138 wd:Q180987 wd:Q44613 }",
    "falls, beaches, caves": "?item wdt:P31 ?c . VALUES ?c { wd:Q34038 wd:Q40080 wd:Q35509 wd:Q2232001 }",
    "other sights": "?item wdt:P31 ?c . VALUES ?c { wd:Q33506 wd:Q16970 wd:Q2977 wd:Q108325 wd:Q32815 wd:Q39715 wd:Q570116 wd:Q1440300 }",
    "gardens and zoos": "?item wdt:P31 ?c . VALUES ?c { wd:Q1107656 wd:Q167346 wd:Q43501 }",
    "lakes": "?item wdt:P31 wd:Q23397 .",
    "national parks": "?item wdt:P31 wd:Q46169 .",
    # huge classes worldwide; may time out while the service is degraded, and that's fine
    "hills and dams": "?item wdt:P31 ?c . VALUES ?c { wd:Q8502 wd:Q12323 }",
}
QUERY = """SELECT ?item ?label ?desc ?coord ?image ?links WHERE {{
  {pattern}
  ?item wdt:P17 wd:Q668 ; wdt:P18 ?image ; wdt:P625 ?coord ; wikibase:sitelinks ?links .
  ?item rdfs:label ?label FILTER(lang(?label) = "en")
  OPTIONAL {{ ?item schema:description ?desc FILTER(lang(?desc) = "en") }}
}}"""

rows = []
for i, (name, pattern) in enumerate(GROUPS.items()):
    part = RAW / f"wd_landmarks.{i}.json"
    if not part.exists():
        for attempt in range(3):
            if i or attempt:
                time.sleep(65)  # the service allows about one query a minute right now
            req = urllib.request.Request(
                "https://query.wikidata.org/sparql",
                data=urllib.parse.urlencode({"query": QUERY.format(pattern=pattern)}).encode(),
                headers={"User-Agent": UA, "Accept": "application/sparql-results+json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    body = r.read()
                json.loads(body)
                part.write_bytes(body)
                break
            except Exception as e:  # noqa: BLE001
                print(f"  {name}: {e}; retrying", flush=True)
    if part.exists():
        got = json.loads(part.read_text())["results"]["bindings"]
        print(f"{name}: {len(got)} rows", flush=True)
        rows += got

(RAW / "wd_landmarks.json").write_text(json.dumps({"results": {"bindings": rows}}))
print("total:", len(rows))
