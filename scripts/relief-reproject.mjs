// Reproject the relief crop (plain lon/lat grid) into the map's own frame: the same conic, fitted
// the same way as src/map/map.ts, at SCALE times its 1000 x 1100 units. Bilinear sampling.
//   node scripts/relief-reproject.mjs <crop.rgb> <crop.json> <out.rgb> <scale>
// (pipeline/build_relief.py runs this between cropping the raster and writing the WebP.)
import { readFileSync, writeFileSync } from "node:fs";
import { geoConicConformal } from "d3";
import { feature } from "topojson-client";

const [, , cropFile, metaFile, outFile, scaleArg] = process.argv;
const meta = JSON.parse(readFileSync(metaFile, "utf8")); // { w, h, lon0, lon1, lat0, lat1 }
const src = readFileSync(cropFile);
const india = JSON.parse(readFileSync(new URL("../src/assets/geo/india.json", import.meta.url), "utf8"));
const land = feature(india, Object.values(india.objects)[0]);
const proj = geoConicConformal().parallels([12, 28]).rotate([-80, 0]).fitExtent([[0, 0], [1000, 1100]], land);

const S = Number(scaleArg || 2);
const W = Math.round(1000 * S), H = Math.round(1100 * S);
const out = Buffer.alloc(W * H * 3, 0);
const px = (lon) => ((lon - meta.lon0) / (meta.lon1 - meta.lon0)) * meta.w - 0.5;
const py = (lat) => ((meta.lat1 - lat) / (meta.lat1 - meta.lat0)) * meta.h - 0.5;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const ll = proj.invert([(x + 0.5) / S, (y + 0.5) / S]);
    if (!ll) continue;
    const fx = px(ll[0]), fy = py(ll[1]);
    if (fx < 0 || fy < 0 || fx >= meta.w - 1 || fy >= meta.h - 1) continue;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const i00 = (y0 * meta.w + x0) * 3, i10 = i00 + 3, i01 = i00 + meta.w * 3, i11 = i01 + 3;
    const o = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) {
      const top = src[i00 + c] * (1 - ax) + src[i10 + c] * ax;
      const bot = src[i01 + c] * (1 - ax) + src[i11 + c] * ax;
      out[o + c] = Math.round(top * (1 - ay) + bot * ay);
    }
  }
}
writeFileSync(outFile, out);
// India's outline in the same pixels, for the mask that flattens everything beyond it
const rings = [];
for (const poly of land.features ? land.features.flatMap((f) => f.geometry.coordinates) : land.geometry.coordinates) {
  for (const ring of poly) rings.push(ring.map((ll) => proj(ll).map((v) => Math.round(v * S * 10) / 10)));
}
writeFileSync(outFile.replace(/\.rgb$/, ".rings.json"), JSON.stringify(rings));
console.log(`relief: ${W} x ${H} in the map's frame`);
