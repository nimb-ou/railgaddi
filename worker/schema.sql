-- Railgaddi accounts (Cloudflare D1). Apply with:
--   npx wrangler d1 execute railgaddi --remote --file worker/schema.sql
-- Only what sync needs: Google's account id (never the email), a name and picture to show who's
-- signed in, and each saved place or route.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,          -- Google's "sub": stable, not an email address
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,     -- ms since 1970
  seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS saves (
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,            -- "place:hampi", "route:bengaluru>amritsar"
  kind TEXT NOT NULL,           -- place | route | trip
  data TEXT NOT NULL,           -- small JSON: titles, the journey's trains
  at INTEGER NOT NULL,          -- when it was saved or removed, ms; the latest wins
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user, key)
);
