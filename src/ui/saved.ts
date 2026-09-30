// "Your trips": the bucket list (places, as postcards) and saved routes (as tickets), and the
// account that keeps them on every device.
import type { Photo } from "../core/places";
import type { Account } from "../app/saves";
import { esc } from "./esc";
import { img } from "./panel";
import { coverWidth } from "./photos";

export interface SavedPlace {
  key: string;
  title: string;
  state: string;
  photo: Photo | null;
  href: string | null; // null: this place isn't in the timetable any more
  slug: string;
  note: string; // "8h 40m from Bengaluru"
}

export interface SavedRoute {
  key: string;
  from: string;
  to: string;
  note: string; // "8h 40m · 5 trains", "1 change via Agra"
  href: string | null;
}

export interface SavedView {
  places: SavedPlace[];
  routes: SavedRoute[];
  account: Account | null;
  canSignIn: boolean;
}

const CLOSE = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>`;
const X = `<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg>`;
export const HEART = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 16.5s-6.5-3.9-6.5-8.4A3.6 3.6 0 0 1 10 6.1a3.6 3.6 0 0 1 6.5 2c0 4.5-6.5 8.4-6.5 8.4z"/></svg>`;
export const BOOKMARK = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 3.5h8a.5.5 0 0 1 .5.5v12.5L10 13.4l-4.5 3.1V4a.5.5 0 0 1 .5-.5z"/></svg>`;

function accountHtml(v: SavedView) {
  if (v.account) {
    return `<div class="acct">
      ${v.account.picture ? `<img class="acct-pic" src="${esc(v.account.picture)}" alt="" referrerpolicy="no-referrer" />` : `<i class="acct-pic" aria-hidden="true"></i>`}
      <div class="acct-text"><b>Signed in${v.account.name ? ` as ${esc(v.account.name)}` : ""}</b><span>Your trips are kept on every device you sign in on.</span></div>
      <div class="acct-actions">
        <button class="link-btn" type="button" data-act="sign-out">Sign out</button>
        <button class="link-btn quiet" type="button" data-act="delete-account">Delete account</button>
      </div>
    </div>`;
  }
  if (!v.canSignIn) return `<p class="acct-note">Saved on this device.</p>`;
  return `<div class="acct">
      <div class="acct-text"><b>Keep them on every device</b><span>Sign in with Google. We keep your name and picture to show it's you, never your email, and you can delete it all any time.</span></div>
      <div class="gsi" id="gsi-button" aria-live="polite"><span class="gsi-wait">Loading Google sign-in…</span></div>
    </div>`;
}

export function savedHtml(v: SavedView) {
  const places = v.places.length
    ? `<div class="bucket">${v.places
        .map(
          (p) => `<div class="bucket-card">
            <a class="sight" href="${esc(p.href ?? "#")}" data-act="nav" ${p.href ? "" : 'aria-disabled="true"'}>
              <span class="frame">${p.photo ? img(p.photo, `${coverWidth(p.photo, 184, 138)}px`, 250, 500, "") : `<i class="ph-none" aria-hidden="true">${esc(p.title.slice(0, 1))}</i>`}</span>
              <b>${esc(p.title)}</b>
              <span>${esc(p.note || p.state)}</span>
            </a>
            <button class="unsave" type="button" data-act="unsave" data-key="${esc(p.key)}" aria-label="Remove ${esc(p.title)} from your bucket list">${X}</button>
          </div>`,
        )
        .join("")}</div>`
    : `<p class="empty">Nothing here yet. On any place, tap ${HEART} to add it to your bucket list.</p>`;
  const routes = v.routes.length
    ? `<ol class="saved-routes">${v.routes
        .map(
          (r) => `<li>
            <a class="saved-route" href="${esc(r.href ?? "#")}" data-act="nav">
              <span class="sr-ends"><b>${esc(r.from)}</b><i aria-hidden="true">→</i><b>${esc(r.to)}</b></span>
              <span class="sr-note">${esc(r.note)}</span>
            </a>
            <button class="unsave" type="button" data-act="unsave" data-key="${esc(r.key)}" aria-label="Remove the route ${esc(r.from)} to ${esc(r.to)}">${X}</button>
          </li>`,
        )
        .join("")}</ol>`
    : `<p class="empty">No saved routes. Save one from a place's ticket (${BOOKMARK}) or from a journey with a change.</p>`;
  return `<div class="panel-scroll">
    <header class="list-head">
      <h2 id="panel-title" tabindex="-1" class="saved-title">Your trips</h2>
      <button class="round" type="button" data-act="close" aria-label="Close">${CLOSE}</button>
    </header>
    ${accountHtml(v)}
    <section aria-labelledby="bucket-h">
      <div class="section-head"><h3 id="bucket-h">Bucket list</h3><span class="count">${v.places.length || ""}</span></div>
      ${places}
    </section>
    <section aria-labelledby="routes-h">
      <div class="section-head"><h3 id="routes-h">Saved routes</h3><span class="count">${v.routes.length || ""}</span></div>
      ${routes}
    </section>
  </div>`;
}
