# Accounts: sign in with Google

Saving places (the bucket list) and routes works without an account: saves stay on the device.
Signing in keeps them on every device. It runs on the same Cloudflare Worker that serves the
site (`worker/`), with Cloudflare's database (D1). Both are free at Railgaddi's scale.

Until the steps below are done, the site simply doesn't offer sign-in. GitHub Pages can't run the
Worker, so sign-in needs the move to Cloudflare in [DEPLOY.md](../DEPLOY.md) first.

## What is stored

For each account: Google's account id (a number, not the email address), the first name and
the profile picture's address (to show who's signed in), and each saved place or route. Nothing
else: no email, no location, no browsing. Anyone can delete their account and everything in it
from "Your trips". The session is a signed, HttpOnly cookie; the site has no analytics.

## Set it up (about 20 minutes)

### 1. A Google sign-in client

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project named
   `Railgaddi`.
2. *APIs & Services* → *OAuth consent screen* (called *Google Auth Platform* → *Branding* in newer
   consoles):
   - User type: **External**
   - App name: `Railgaddi`; support email: yours
   - App domain: home page `https://railgaddi.in`, privacy policy `https://railgaddi.in/privacy/`
   - Authorized domain: `railgaddi.in`
   - Scopes: leave the defaults (`openid`, `email`, `profile`). These don't need Google's review.
   - Then *Publish app* (*Audience* → *In production*), so anyone can sign in, not only test users.
3. *Credentials* → *Create credentials* → *OAuth client ID*:
   - Application type: **Web application**, name `Railgaddi web`
   - Authorized JavaScript origins: `https://railgaddi.in` (and `https://www.railgaddi.in` if you
     serve that too). No redirect URIs are needed.
   - Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). It isn't a secret.

### 2. The database and settings on Cloudflare

From the project folder, signed in to Cloudflare (`npx wrangler login` once):

```bash
npx wrangler d1 create railgaddi
```

It prints a `database_id`. In `wrangler.jsonc`, uncomment the `d1_databases` line and paste the id
in, and set `GOOGLE_CLIENT_ID` to the Client ID from step 1. Then:

```bash
npx wrangler d1 execute railgaddi --remote --file worker/schema.sql
openssl rand -base64 48
npx wrangler secret put SESSION_SECRET
```

Paste the random string from `openssl` when `secret put` asks. It signs the session cookies:
keep it out of the repository, and changing it signs everyone out.

Commit `wrangler.jsonc` and push: Cloudflare redeploys. (Or `npm run build && npx wrangler deploy`.)

### 3. Check it

Open the site, tap the heart on any place, then the heart in the top bar: "Your trips" now has a
*Sign in with Google* button. Sign in, save something, and open the site on another device.

## How it works

- `worker/auth.ts` checks Google's ID token (RS256 signature against Google's published keys,
  issuer, audience = your client id, expiry), then issues the session cookie.
- `worker/index.ts` is the API: `GET /api/config`, `POST /api/session`, `GET /api/me`,
  `GET` and `PUT /api/saves`, `POST /api/logout`, `DELETE /api/account`. Requests that change
  something need a same-site header and origin.
- `src/app/saves.ts` keeps saves on the device and merges them with the account's copy: per item,
  the latest change wins, removals included.
- Tests: `test/worker.test.ts` (real RSA-signed tokens, tampering, expiry, the whole flow).

## If something goes wrong

- *The button doesn't appear*: `/api/config` must say `{"signIn":{"google":"…"}}`. If it says
  `null`, the database binding, `GOOGLE_CLIENT_ID` or `SESSION_SECRET` is missing.
- *"Couldn't sign you in"*: the site's address must be listed exactly under Authorized JavaScript
  origins, and the client id in `wrangler.jsonc` must be that client's.
- *Logs*: `npx wrangler tail` shows the Worker's errors live.
