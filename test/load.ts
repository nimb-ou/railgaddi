// The real data files, decoded the way the app decodes them (tests run against what ships).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPaths, decodeNetwork, type MetaFile } from "../src/core/network";
import { buildGuideIndex, type PlacesIndex } from "../src/core/places";
import { buildSlugs } from "../src/core/slugs";

const file = (f: string) => readFileSync(join(__dirname, "..", "data", f));
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export const meta = JSON.parse(file("meta.json").toString()) as MetaFile;
export const net = decodeNetwork(meta, buf(file("timetable.bin")));
applyPaths(net, buf(file("paths.bin")));
export const index = JSON.parse(file("places/index.json").toString()) as PlacesIndex;
export const guides = buildGuideIndex(index, net);
export const slugs = buildSlugs(net, guides);
export const place = (slug: string) => {
  const p = slugs.find(slug);
  if (!p) throw new Error(`no place ${slug}`);
  return p;
};
