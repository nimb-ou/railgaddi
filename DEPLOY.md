# Deploying Railgaddi

The build (`npm run build`) produces `dist/`, a folder of static files. Any static host works.
Two free options are set up; the only paid thing is the domain.

| | Cloudflare (recommended) | GitHub Pages (current) |
|---|---|---|
| Cost | free | free |
| Traffic | unlimited requests and bandwidth for static files | soft limit ~100 GB a month |
| CDN in India | yes (Mumbai, Delhi, Chennai, Bengaluru, Kolkata, Hyderabad…) | Fastly, fewer Indian locations |
| Security and caching headers (`public/_headers`) | applied | ignored |
| Unknown addresses | open the app with 200 | open the app, but with a 404 status |

GitHub Pages is live now at https://nimb-ou.github.io/railgaddi/ and redeploys on every push to
`main` (`.github/workflows/pages.yml`), after the tests pass.

## Move to your own domain on Cloudflare

1. **Buy the domain** (e.g. `railgaddi.in`). If Cloudflare Registrar offers it, buying there is
   simplest (at cost, and step 2 is already done). Otherwise any registrar works (Porkbun,
   Namecheap, GoDaddy…); decline their paid add-ons.
2. **Add it to Cloudflare** (free plan): dash.cloudflare.com → *Add a domain* → enter it → Free.
   Cloudflare shows two nameservers; set them at your registrar in place of theirs. It takes from
   minutes to a few hours to switch.
3. **Create the site from GitHub**: *Workers & Pages* → *Create* → *Import a repository* → pick
   `nimb-ou/railgaddi`.
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy` (reads `wrangler.jsonc`)
   - Environment variable: `SITE_URL` = `https://railgaddi.in`

   Every push to `main` now rebuilds and deploys.
4. **Attach the domain**: open the new Worker → *Settings* → *Domains & Routes* → *Add* →
   *Custom domain* → `railgaddi.in`. Add `www.railgaddi.in` too, then *Rules* → *Redirect Rules*
   → the "Redirect from WWW to root" template.
5. **Point GitHub Pages at the domain** (so both builds agree on the canonical address): GitHub →
   the repo → *Settings* → *Secrets and variables* → *Actions* → *Variables* → New variable
   `SITE_URL` = `https://railgaddi.in`. Or turn Pages off (*Settings* → *Pages* → *Unpublish*).
6. **Tell search engines**: [Google Search Console](https://search.google.com/search-console) →
   add the domain (it verifies through Cloudflare DNS in one click) → *Sitemaps* → submit
   `https://railgaddi.in/sitemap.xml`. Same at [Bing Webmaster Tools](https://www.bing.com/webmasters)
   (it can import from Google).

7. **Accounts (optional)**: to let people sign in with Google and keep their saved trips on
   every device, follow [docs/accounts.md](docs/accounts.md). Without it, saving works on each
   device only.

## Or keep GitHub Pages with your domain

1. GitHub → *Settings* → *Pages* → *Custom domain* → `railgaddi.in` → Save, then tick
   *Enforce HTTPS* once the certificate is issued.
2. At your registrar's DNS: `A` records for `@` → `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153`, and a `CNAME` for `www` → `nimb-ou.github.io`.
3. Add the repository variable `SITE_URL` = `https://railgaddi.in` (step 5 above); the workflow
   then builds for the domain root instead of `/railgaddi/`.

## Monthly data refresh

`.github/workflows/data-refresh.yml` re-reads Wikipedia on the 1st of each month and opens a pull
request when running days or newer trains change. For it to open pull requests, allow it once:
GitHub → the repo → *Settings* → *Actions* → *General* → *Workflow permissions* → tick
*Allow GitHub Actions to create and approve pull requests* → Save. Review the diff, then merge;
the site redeploys by itself.

## Optional, still free

- **Analytics without cookies**: Cloudflare *Web Analytics*. If you turn on its automatic setup,
  add `https://static.cloudflareinsights.com` to `script-src` and
  `https://cloudflareinsights.com` to `connect-src` in `public/_headers`.
- **Uptime alerts**: any free uptime monitor pointed at the home page.

## Before each release

```bash
npm run typecheck && npm test && npm run build
npm run preview                                  # the production build on localhost:4173
node scripts/make-icons.mjs                      # only if the icon or landing page changed
```
