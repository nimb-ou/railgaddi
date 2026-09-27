#!/usr/bin/env bash
# Download Indian Railways' "Trains at a Glance" (the official all-India timetable) for one year
# into RAW/tag<year>/. The Railway Board publishes it as PDFs, one per route table.
# Reading it for checking is fine; publishing its timings needs written permission (SOURCES.md).
#
#   pipeline/fetch_tag.sh raw 2026
set -euo pipefail
RAW=${1:?raw folder}; YEAR=${2:?year, e.g. 2026}
OUT="$RAW/tag$YEAR"; mkdir -p "$OUT"
UA="Railgaddi/1.0 (https://github.com/nimb-ou/railgaddi)"
# the Railway Board's "Trains at a Glance" page, which links every table of the current edition
PAGE="https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,537,3143"
curl -fsSL -A "$UA" "$PAGE" \
  | grep -oE "[^\"' ]*TAG[_-]$YEAR/[^\"' ]+\.pdf" | sed -E 's#^/#https://indianrailways.gov.in/#; s#^http:#https:#' | sort -u > "$OUT/urls.txt"
echo "$(wc -l < "$OUT/urls.txt") files listed"
while read -r url; do
  f="$OUT/$(basename "$url")"
  [ -s "$f" ] || { curl -fsS -A "$UA" -o "$f" "$url" || echo "  failed: $url"; sleep 0.5; }
done < "$OUT/urls.txt"
echo "saved in $OUT"
