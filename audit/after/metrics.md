# After metrics, 25 October 2026, production build (vite preview, localhost:4173)

- Lighthouse, side by side with the old build, median of 3: lighthouse-compare.md
- Lighthouse single runs (all six pages): lighthouse-summary.txt and lighthouse-*.json
- Tap to paint, phone, 4x CPU: inp-phone.txt (scripts/perf.mjs, which now scrolls a target into
  view and lets it settle before tapping)
- axe-core 4.14 on 120 captures: 0 rules, 0 nodes; console errors: 0 (report.json)
- Targets, overflow, headings, keyboard: ux-check.json
- Bundles (gzip -9): JS 101.9 kB, CSS 12.9 kB
