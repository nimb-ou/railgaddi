#!/bin/sh
# Lighthouse on three kinds of page, as a phone (4x slower CPU, slow 4G) and as a laptop, saving the
# reports and a one-line summary of each. For the audit (audit/AUDIT.md).
#   sh scripts/lighthouse.sh [before|after] [base URL]   (default: after, the production preview on :4173)
set -e
SET=${1:-after}
BASE=${2:-http://localhost:4173}
OUT=audit/$SET
mkdir -p "$OUT"
export PATH=/opt/homebrew/opt/node@20/bin:$PATH
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for page in home:/ place:/from/bengaluru/to/hampi/ discover:/discover/; do
  name=${page%%:*}
  path=${page#*:}
  for form in mobile desktop; do
    if [ $form = desktop ]; then preset="--preset=desktop"; else preset="--form-factor=mobile"; fi
    npx --yes lighthouse@12.8.2 "$BASE$path" $preset --throttling-method=devtools --quiet \
      --chrome-flags="--headless=new" --output=json --output-path="$OUT/lighthouse-$name-$form.json" >/dev/null 2>&1 || echo "lighthouse failed: $name $form"
    node -e '
      const r = require(process.argv[1]);
      const c = r.categories, a = r.audits;
      const s = (k) => Math.round(c[k].score * 100);
      const req = a["network-requests"]?.details?.items ?? [];
      console.log([process.argv[2], "perf " + s("performance"), "a11y " + s("accessibility"), "bp " + s("best-practices"), "seo " + s("seo"),
        "LCP " + Math.round(a["largest-contentful-paint"].numericValue) + "ms", "CLS " + a["cumulative-layout-shift"].numericValue.toFixed(3),
        "TBT " + Math.round(a["total-blocking-time"].numericValue) + "ms", "FCP " + Math.round(a["first-contentful-paint"].numericValue) + "ms",
        "requests " + req.length, "bytes " + Math.round(a["total-byte-weight"].numericValue / 1024) + "KiB",
        "images " + Math.round(req.filter((x) => x.resourceType === "Image").reduce((t, x) => t + x.transferSize, 0) / 1024) + "KiB"].join(" | "));
    ' "$PWD/$OUT/lighthouse-$name-$form.json" "$name-$form" | tee -a "$OUT/lighthouse-summary.txt"
  done
done
