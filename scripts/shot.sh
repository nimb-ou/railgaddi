#!/usr/bin/env bash
# Screenshot the dev server with headless Chrome: scripts/shot.sh <url-path> <out.png> [width] [height]
set -euo pipefail
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROF="${TMPDIR:-/tmp}/railgaddi-shot-profile"
"$CH" --headless=new --hide-scrollbars --user-data-dir="$PROF" --window-size="${3:-1366},${4:-820}" \
  --timeout="${TIMEOUT:-12000}" --screenshot="$2" "http://localhost:5173/$1" >/dev/null 2>&1 &
pid=$!
sleep $(( ${TIMEOUT:-12000} / 1000 + 8 ))
kill $pid 2>/dev/null || true
ls -la "$2"
