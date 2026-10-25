#!/bin/sh
# Lighthouse (mobile, devtools throttling) on two builds side by side, alternating, N runs each;
# prints the median of each metric. Lighthouse's TBT swings a lot run to run on one machine, so a
# fair before/after needs the same conditions and more than one run.
#   sh scripts/lh-compare.sh <before base URL> <after base URL> [runs] > out.txt
set -e
A=$1; B=$2; N=${3:-3}
export PATH=/opt/homebrew/opt/node@20/bin:$PATH
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
T=$(mktemp -d)
for i in $(seq 1 "$N"); do
  for page in home:/ place:/from/bengaluru/to/hampi/ discover:/discover/; do
    name=${page%%:*}; path=${page#*:}
    for side in before after; do
      base=$A; [ $side = after ] && base=$B
      npx --yes lighthouse@12.8.2 "$base$path" --form-factor=mobile --throttling-method=devtools --quiet \
        --chrome-flags="--headless=new" --only-categories=performance,accessibility,best-practices,seo \
        --output=json --output-path="$T/$side-$name-$i.json" >/dev/null 2>&1 || true
    done
  done
done
node -e '
const fs = require("fs"), dir = process.argv[1], n = +process.argv[2];
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log("| Page | Build | Perf | LCP ms | TBT ms | CLS | FCP ms | Requests | KiB |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const page of ["home", "place", "discover"]) for (const side of ["before", "after"]) {
  const rs = []; for (let i = 1; i <= n; i++) { try { rs.push(JSON.parse(fs.readFileSync(`${dir}/${side}-${page}-${i}.json`))); } catch {} }
  if (!rs.length) continue;
  const m = (f) => med(rs.map(f));
  console.log(`| ${page} | ${side} | ${m((r) => Math.round(r.categories.performance.score * 100))} | ${m((r) => Math.round(r.audits["largest-contentful-paint"].numericValue))} | ${m((r) => Math.round(r.audits["total-blocking-time"].numericValue))} | ${m((r) => +r.audits["cumulative-layout-shift"].numericValue.toFixed(3))} | ${m((r) => Math.round(r.audits["first-contentful-paint"].numericValue))} | ${m((r) => r.audits["network-requests"].details.items.length)} | ${m((r) => Math.round(r.audits["total-byte-weight"].numericValue / 1024))} |`);
}' "$T" "$N"
