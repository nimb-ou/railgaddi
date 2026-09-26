#!/usr/bin/env bash
# Download every raw source the pipeline reads into ./raw (git-ignored, ~170 MB).
# Usage: pipeline/fetch_raw.sh [raw-dir]
set -euo pipefail
RAW="${1:-raw}"
UA="PatriPrototype/0.1 (personal non-commercial train-discovery project)"
mkdir -p "$RAW"
cd "$RAW"

# Official timetable, data.gov.in (Dec 2017), via a GitHub mirror
curl -sSL -o ogd_timetable_2017.csv \
  https://raw.githubusercontent.com/itzmeanjan/indian-railway/master/data/Train_details_22122017.csv

# datameet railways (2016): train names/types and the path between halts
for f in stations trains schedules; do
  curl -sSL -o "$f.json" "https://raw.githubusercontent.com/datameet/railways/master/$f.json"
done

# India outline (Survey of India boundary) and state borders
curl -sSL -o india-composite.geojson https://raw.githubusercontent.com/datameet/maps/master/Country/india-composite.geojson
for e in shp shx dbf prj cpg; do
  curl -sSL -o "Admin2.$e" "https://raw.githubusercontent.com/datameet/maps/master/States/Admin2.$e"
done

# OpenStreetMap stations (positions + names in Indian scripts)
curl -sS --max-time 300 -A "$UA" https://overpass-api.de/api/interpreter \
  --data-urlencode 'data=[out:json][timeout:280];area["ISO3166-1"="IN"][admin_level=2]->.in;node["railway"~"^(station|halt)$"](area.in);out body;' \
  -o osm_stations.json

# Every Indian place with an English Wikivoyage guide
curl -sS -A "$UA" -H "Accept: application/sparql-results+json" https://query.wikidata.org/sparql \
  --data-urlencode 'query=SELECT ?item ?article ?coord WHERE { ?article schema:about ?item ; schema:isPartOf <https://en.wikivoyage.org/> . ?item wdt:P17 wd:Q668 ; wdt:P625 ?coord . }' \
  -o wv_india.json

echo "Now simplify the map shapes (once):"
echo "  npx mapshaper $RAW/india-composite.geojson -simplify 4% keep-shapes -filter-islands min-area=20km2 -o public/data/india.json format=topojson quantization=1e5"
echo "  npx mapshaper $RAW/Admin2.shp -simplify 3% keep-shapes -innerlines -o public/data/state-lines.json format=topojson quantization=1e5"
