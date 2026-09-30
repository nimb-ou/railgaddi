// The binary timetable files, gzipped ahead of time (data/*.bin.gz, git-ignored). Hosts compress
// JSON and JS on the fly but not always "application/octet-stream" (Cloudflare doesn't, by
// default), so the app fetches these and unpacks them itself (DecompressionStream). Same bytes in,
// same bytes out: no timestamps in the gzip header.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

for (const f of ["timetable.bin", "paths.bin"]) {
  const raw = readFileSync(`data/${f}`);
  const gz = gzipSync(raw, { level: 9 });
  gz[4] = gz[5] = gz[6] = gz[7] = 0; // mtime: none
  writeFileSync(`data/${f}.gz`, gz);
  console.log(`data/${f}.gz: ${(raw.length / 1e3).toFixed(0)} kB -> ${(gz.length / 1e3).toFixed(0)} kB`);
}
