#!/bin/sh
# Towns (GeoNames, CC BY 4.0) and airports (OurAirports, public domain) for places without a
# railway station: raw/geo/, read by pipeline/build_spots.py.
set -e
cd "$(dirname "$0")/.."
mkdir -p raw/geo
cd raw/geo
curl -sSfLO https://download.geonames.org/export/dump/cities1000.zip && unzip -o -q cities1000.zip
curl -sSfL -o admin1.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
curl -sSfL -o airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
echo "raw/geo: $(ls | tr '\n' ' ')"
