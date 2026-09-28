// After `vite build`: write a real page for every view worth finding on its own (each origin, each
// place with a guide, and the most-travelled pairs from big cities), with its own title,
// description, preview photo and canonical address, plus a sitemap. The app boots on every page as
// usual; the head is for search engines and link previews (WhatsApp, X, iMessage don't run
// scripts), and the <noscript> article is the same information as plain, linked text.
//
//   SITE_URL   public address including any sub-path (default: the GitHub Pages address)
//   SPA_404=1  also write 404.html = the app shell, for hosts without SPA fallback (GitHub Pages)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { daysLabel, fmtKm, fmtMins, fmtTime, plural, shiftDays } from "../src/core/format";
import { decodeNetwork, type MetaFile, type Place } from "../src/core/network";
import { buildGuideIndex, type ArticleDetail, type GuideView, type PlacesIndex } from "../src/core/places";
import { rankPlaces } from "../src/core/rank";
import { buildSlugs, titleOf } from "../src/core/slugs";
import { arrivals, departures, newerBetween, type Leg } from "../src/core/trips";
import { photoUrl } from "../src/ui/photos";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SITE = (process.env.SITE_URL ?? "https://nimb-ou.github.io/railgaddi").replace(/\/$/, "");
const PAIRS_PER_CITY = 30;

// ---------------------------------------------------------------- the data, as the app sees it
const read = (f: string) => readFileSync(join(ROOT, "data", f));
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const meta = JSON.parse(read("meta.json").toString()) as MetaFile;
const net = decodeNetwork(meta, buf(read("timetable.bin")));
const ix = JSON.parse(read("places/index.json").toString()) as PlacesIndex;
const guides = buildGuideIndex(ix, net);
const slugs = buildSlugs(net, guides);
const details = new Map<string, ArticleDetail>();
for (const f of readdirSync(join(ROOT, "data/places")).filter((f) => /^\d\d\.json$/.test(f))) {
  const shard = JSON.parse(read(`places/${f}`).toString()) as { articles: Record<string, ArticleDetail> };
  for (const [t, a] of Object.entries(shard.articles)) details.set(t, a);
}

// ---------------------------------------------------------------- which pages
const pref = (p: Place) => Number(p.isCity) * 1e6 + p.halts;
const guidePlace = new Map<string, Place>(); // one page per guide: the city's own station, else the busiest
for (const [p, gv] of guides) {
  const prev = guidePlace.get(gv.title);
  if (!prev || pref(p) > pref(prev)) guidePlace.set(gv.title, p);
}
const placePages = new Set(guidePlace.values());
const origins = new Set([...net.places.values()].filter((p) => p.isCity || placePages.has(p)));
const destsOf = new Map([...origins].map((o) => [o, departures(net, o)]));
for (const o of origins) if (!destsOf.get(o)!.size) origins.delete(o);

const pairs = new Map<Place, Place[]>();
for (const o of origins) {
  if (!o.isCity) continue;
  const reach = new Map([...destsOf.get(o)!].map(([p, d]) => [p, d.legs]));
  pairs.set(
    o,
    rankPlaces(guides, reach)
      .slice(0, PAIRS_PER_CITY)
      .map((c) => c.place),
  );
}
const hasPair = (o: Place, p: Place) => pairs.get(o)?.includes(p) ?? false;

// ---------------------------------------------------------------- page shell
const shell = readFileSync(join(DIST, "index.html"), "utf8");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const path = (o?: Place, p?: Place) => `${o ? `/from/${slugs.of(o)}` : ""}${p ? `/to/${slugs.of(p)}` : ""}/`;
const link = (href: string, text: string) => `<a href="${esc(SITE + href)}">${esc(text)}</a>`;
const clip = (s: string, n = 158) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n - 1))}…`);
const firstSentence = (s: string) => s.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? s;
const cover = (gv: GuideView | null | undefined) => (gv?.icon ? photoUrl(gv.icon, 1280) : null);

interface Page {
  path: string;
  title: string;
  description: string;
  image?: string | null;
  imageAlt?: string;
  body: string; // the <noscript> article
  jsonld?: object;
}

function render(pg: Page) {
  const url = SITE + pg.path;
  const image = pg.image ?? `${SITE}/og.jpg`;
  const head = [
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    pg.jsonld ? `<script type="application/ld+json">${JSON.stringify(pg.jsonld).replace(/</g, "\\u003c")}</script>` : "",
  ].join("\n    ");
  let html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(pg.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(pg.description)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(pg.title.replace(/ · Railgaddi$/, ""))}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(pg.description)}`)
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${esc(image)}`)
    .replace(/(<meta property="og:image:alt" content=")[^"]*/, `$1${esc(pg.imageAlt ?? "A map of India with photos of places you can reach by train")}`)
    .replace("</head>", `    ${head}\n  </head>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript><article class="static">${pg.body}${FOOT}</article></noscript>`);
  if (pg.image) {
    // a place photo isn't 1200×630: let platforms read its real size
    html = html.replace(/\s*<meta property="og:image:width"[^>]*>\s*<meta property="og:image:height"[^>]*>/, "");
  }
  const file = join(DIST, pg.path, "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const FOOT = `<p class="static-foot">Railgaddi shows Indian Railways' timetable (Trains at a Glance 2026, and the 2017
  timetable on data.gov.in for trains it doesn't cover), with running days and newer trains from Wikipedia, travel guides from Wikivoyage and photos from Wikimedia Commons. It needs JavaScript
  for the map; check <a href="https://enquiry.indianrail.gov.in/mntes/">NTES</a> before you travel.</p>`;

const byFastest = (a: [Place, { fastest: number }], b: [Place, { fastest: number }]) => a[1].fastest - b[1].fastest;
const trainRows = (legs: Leg[]) =>
  [...legs]
    .sort((a, b) => a.dep - b.dep)
    .map((l) => {
      const days = daysLabel(shiftDays(l.train.days, Math.floor(l.train.dep[l.from] / 1440)));
      return `<tr><td>${esc(l.train.no)}</td><td>${esc(l.train.name)}</td><td>${fmtTime(l.dep)}</td><td>${fmtMins(l.dur)}</td><td>${days || "–"}</td></tr>`;
    })
    .join("");
const newerList = (a: Place, b: Place) => {
  const list = newerBetween(net, a, b);
  return list.length
    ? `<h2>Newer trains</h2><ul>${list.map((n) => `<li>${esc(n.name)} (${esc(n.numbers)})${daysLabel(n.days) ? `: ${daysLabel(n.days)}` : ""}${n.minutes ? `, ${fmtMins(n.minutes)}` : ""}</li>`).join("")}</ul>`
    : "";
};
const sightsList = (d: ArticleDetail | undefined) =>
  d?.sights.length
    ? `<h2>Places to visit</h2><ul>${d.sights.map((s) => `<li><b>${esc(s.n)}</b>${s.d ? `: ${esc(s.d)}` : ""}</li>`).join("")}</ul>`
    : "";

// ---------------------------------------------------------------- write
let count = 0;
const urls: string[] = ["/"];

// the landing page: canonical and absolute preview image
render({
  path: "/",
  title: "Railgaddi · where can the train take you?",
  description: "Pick your station and see every place in India a train can take you without changing, with photos and what to see when you get there.",
  body: `<h1>Where can the train take you?</h1><p>Pick your station and see every place in India a train can take you without changing.</p>
    <h2>Start from</h2><ul>${[...origins].filter((o) => o.isCity).sort((a, b) => b.halts - a.halts).map((o) => `<li>${link(path(o), titleOf(o, null))}</li>`).join("")}</ul>`,
  jsonld: { "@context": "https://schema.org", "@type": "WebSite", name: "Railgaddi", url: `${SITE}/`, inLanguage: "en-IN" },
});

for (const o of origins) {
  const from = titleOf(o, null);
  const dests = [...destsOf.get(o)!].sort(byFastest);
  const withGuide = dests.filter(([p]) => guides.has(p) && guides.get(p)!.title !== guides.get(o)?.title);
  const famous = rankPlaces(guides, new Map(dests.map(([p, d]) => [p, d.legs])))
    .slice(0, 4)
    .map((c) => c.title);
  const items = withGuide.slice(0, 120).map(([p, d]) => {
    const name = titleOf(p, guides.get(p));
    const href = hasPair(o, p) ? path(o, p) : placePages.has(p) ? path(undefined, p) : null;
    return `<li>${href ? link(href, name) : esc(name)}: ${fmtMins(d.fastest)}, ${plural(d.legs.length, "train")}</li>`;
  });
  render({
    path: path(o),
    title: `Trains from ${from}: ${plural(dests.length, "place")} without changing · Railgaddi`,
    description: clip(
      `${plural(dests.length, "place")} you can reach from ${from} by train without changing${famous.length ? `, including ${famous.join(", ")}` : ""}. Photos, what to see, and every direct train.`,
    ),
    image: o.isCity ? null : cover(guides.get(o)),
    body: `<h1>Trains from ${esc(from)}</h1><p>${plural(dests.length, "place")} you can reach without changing trains, nearest first.</p><ol>${items.join("")}</ol>`,
  });
  urls.push(path(o));
  count++;
}

for (const p of placePages) {
  const gv = guides.get(p)!;
  const name = titleOf(p, gv);
  const d = details.get(gv.title);
  const fromCities = [...origins]
    .filter((o) => o.isCity && o !== p && destsOf.get(o)!.has(p))
    .map((o) => [o, destsOf.get(o)!.get(p)!] as const)
    .sort((a, b) => a[1].fastest - b[1].fastest);
  const intro = d?.x ?? "";
  const ways = arrivals(net, p).size; // as the app titles this view
  render({
    path: path(undefined, p),
    title: ways ? `${name} by train: direct from ${plural(ways, "place")} · Railgaddi` : `${name} by train · Railgaddi`,
    description: clip(
      intro
        ? `${firstSentence(intro)} Direct trains from ${plural(ways, "place")}, and ${plural(d!.sights.length, "place")} to see.`
        : `${name}, ${p.state}: direct trains from ${plural(ways, "place")}, and what to see.`,
    ),
    image: cover(gv),
    imageAlt: name,
    body: `<h1>${esc(name)}</h1><p>${esc(p.state)}${gv.featured ? ` · nearest station ${esc(titleOf(p, null))}` : ""}</p>${intro ? `<p>${esc(intro)}</p>` : ""}${sightsList(d)}
      ${fromCities.length ? `<h2>Direct trains from</h2><ul>${fromCities.map(([o, dd]) => `<li>${hasPair(o, p) ? link(path(o, p), titleOf(o, null)) : link(path(o), titleOf(o, null))}: ${fmtMins(dd.fastest)}, ${plural(dd.legs.length, "train")}</li>`).join("")}</ul>` : ""}`,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "TouristDestination",
      name,
      description: intro ? firstSentence(intro) : undefined,
      image: cover(gv) ?? undefined,
      url: SITE + path(undefined, p),
      geo: gv.entry.ll ? { "@type": "GeoCoordinates", latitude: gv.entry.ll[0], longitude: gv.entry.ll[1] } : undefined,
    },
  });
  urls.push(path(undefined, p));
  count++;
}

for (const [o, list] of pairs) {
  const from = titleOf(o, null);
  for (const p of list) {
    const gv = guides.get(p);
    const name = titleOf(p, gv);
    const dest = destsOf.get(o)!.get(p)!;
    const d = gv ? details.get(gv.title) : undefined;
    const km = Math.min(...dest.legs.map((l) => l.km));
    render({
      path: path(o, p),
      title: `${name} by train from ${from} · Railgaddi`,
      description: clip(
        `${plural(dest.legs.length, "direct train")} from ${from} to ${name}, the fastest in ${fmtMins(dest.fastest)} over ${fmtKm(km)} km. ${d?.x ? firstSentence(d.x) : ""}`.trim(),
      ),
      image: cover(gv),
      imageAlt: name,
      body: `<h1>${esc(name)} by train from ${esc(from)}</h1>
        <p>${plural(dest.legs.length, "direct train")} · fastest ${fmtMins(dest.fastest)} · ${fmtKm(km)} km</p>
        <table><thead><tr><th>No.</th><th>Train</th><th>Leaves ${esc(from)}</th><th>Takes</th><th>Runs</th></tr></thead><tbody>${trainRows(dest.legs)}</tbody></table>
        ${newerList(o, p)}
        ${d?.x ? `<h2>About ${esc(name)}</h2><p>${esc(d.x)}</p>` : ""}${sightsList(d)}
        <p>${link(path(o), `Everywhere else from ${from}`)} · ${placePages.has(p) ? link(path(undefined, p), `${name} from other cities`) : ""}</p>`,
    });
    urls.push(path(o, p));
    count++;
  }
}

// ---------------------------------------------------------------- sitemap, robots, 404
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(SITE + u)}</loc><lastmod>${today}</lastmod></url>`)
    .join("\n")}\n</urlset>\n`,
);
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
if (process.env.SPA_404 === "1") writeFileSync(join(DIST, "404.html"), shell); // the bare shell: no canonical
if (!existsSync(join(DIST, "og.jpg"))) console.warn("warning: dist/og.jpg is missing (run scripts/make-icons.mjs)");
console.log(`prerendered ${count} pages (+ landing) for ${SITE}; sitemap has ${urls.length} addresses`);
