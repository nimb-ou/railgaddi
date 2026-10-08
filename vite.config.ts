import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// BASE_PATH lets the same build serve from a sub-path (GitHub Pages: /railgaddi/) or a domain root.
const base = process.env.BASE_PATH ?? "/";

/** The landing page's first words are set in Hind and Tiro: fetch those two files with the page. */
function preloadFonts(): Plugin {
  return {
    name: "railgaddi-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => /\/(hind-latin-400-normal|tiro-devanagari-hindi-latin-400-normal)-[\w-]+\.woff2$/.test(f));
        return files.map((f) => ({ tag: "link", attrs: { rel: "preload", href: base + f, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" as const }));
      },
    },
  };
}

export default defineConfig({
  base,
  server: { port: 5173 },
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 0, // data files stay separate, cacheable assets
    reportCompressedSize: false,
  },
  plugins: [
    preloadFonts(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Railgaddi",
        short_name: "Railgaddi",
        description: "Chalo! Pick your station and watch every line you can ride light up across India, with what to see and when to go.",
        lang: "en-IN",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#f8f2e7",
        theme_color: "#f8f2e7",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // the app, the whole timetable and every place guide: about 1 MB compressed
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2,json,gz}"], // the timetable as its gzipped copy
        // Indian-script fonts load when a name in that script appears, then stay (runtime cache below)
        globIgnores: ["**/og.jpg", "**/noto-sans-*.woff2", "**/*-vietnamese-*.woff2"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/[^/?]+\.[^/]+$/, /\/api\//], // real files and the API, not app routes
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // photos from Wikimedia Commons (served with CORS, so cached as real responses)
            urlPattern: ({ url }) => url.origin === "https://upload.wikimedia.org",
            handler: "CacheFirst",
            options: {
              cacheName: "photos",
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === "font",
            handler: "CacheFirst", // content-hashed: a name never changes meaning
            options: { cacheName: "fonts", expiration: { maxEntries: 30 } },
          },
        ],
      },
    }),
  ],
});
