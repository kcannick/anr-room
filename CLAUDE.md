# Project: The A&R Room

A weekly live music-review broadcast (Wed 7–11 PM ET, multistreamed to 6 platforms) with a
participation layer: viewers rate songs 0–9 and predict the room average, scoring on how
well they "read the room." Points accrue across a monthly **Series**, whose top A&Rs help
populate **A&R Wars**: an 8-competitor single-elimination tournament (curated — e.g. top 4
from the board + 4 invited Tastemakers) where competitors scout songs from a "service pack"
and play them head-to-head; the A&R Room audience votes each matchup via binary ("Verzuz")
polls, majority wins, winner advances. Competitors aren't session participants — the audience
votes. Cash prize. (See docs/anr-room-roadmap.md 6.4 for the full format.)

Operator: Makin' It Magazine (makinitmag.com). The operator is a marketing person and
ex-coder (NOT a developer) who wants a reliable tool, not infrastructure to babysit.

## Tech stack
- Node.js + Express (single server, no framework beyond Express)
- SQLite in dev (`SQLITE_PATH`, default `./anr-room.db`) / Neon Postgres in prod (`DATABASE_URL`)
- Vercel serverless deployment (api/index.js wraps server.js)
- GitHub: kcannick/anr-room
- Email: Resend + Mandrill via email.js
- Frontend: vanilla HTML/CSS/JS (public/play.html, admin.html, overlay.html) — no build step

## Commands
- `node server.js` — run locally (persistent server; this is also how a non-serverless host would run it)
- `npm test` — full suite (scoring.test.js + migrate.test.js + e2e.test.js). **Expected: 0 failed** (373 passed as of 2026-07; the count grows with features — green is the invariant).
- `node migrate.js` — apply migrations (light, boot-safe)
- `node migrate.js --run-heavy` — apply migrations INCLUDING heavy data work (deploy-time only)
- `node migrate.js --status` — show migration state

## CRITICAL workflow rules (hard-won; do not violate)
- **Never put work that scales with row count on the boot/request path.** A per-user recompute
  in postMigrate on every cold start caused a multi-day production outage. Heavy work is gated
  behind `allowHeavy` (true only from `migrate.js --run-heavy`). This is the #1 rule.
- **Migrations:** numbered sequentially in /migrations, additive (`ADD COLUMN IF NOT EXISTS`),
  statements separated by a line of exactly `--->`. Heavy/destructive conversion goes behind
  the allowHeavy gate. Indexes that depend on a migration-added column belong in the migration,
  NOT the base SCHEMA array in db.js (SCHEMA runs before migrations).
- **Test before delivering.** Keep the suite green (0 failures). Run `npm test` after changes.
- **Mockup-first for UI.** Build/approve a visual mockup before writing front-end code.
  Approved mockups exist (see Design assets below) — build to match them.
- **Live vote split/lean is SEALED until results.** Never expose the room's average or A/B
  split on the overlay or in any liveness feature during an active round — it's what players
  are predicting. Vote COUNT is OK; vote DIRECTION is not. Server-enforced.
- **Static files cache aggressively** — test in incognito after deploy.
- **PII discipline:** public/leaderboard/overlay endpoints emit display name + points only.
  Email/phone never leave via a public surface.

## Architecture decisions (settled — don't re-litigate)
- **Stay on managed services (Vercel + Ably when live-push is needed). Do NOT self-host.**
  The operator wants a tool, not ops. $200/mo budget has ample room. Cold-start fragility
  was a code bug (fixed), not an inherent serverless problem.
- **Identity:** `users` is the durable spine (uid, email unique, role). `participants` links a
  user to a session (participant.user_id → users.uid). Votes link via participant_id. The
  profile feature lives on `users`. Display names are NON-unique (disambiguated by photo/
  location/socials).
- **Series leaderboard is LIVE-COMPUTED**, never stored — sum votes.points across a series'
  tagged (non-deleted) sessions, grouped by user. Stays correct through retroactive tagging
  and re-ratification. Never denormalize into a stored rollup.
- **Scaling the leaderboard = PUSH, not caching.** The target is 2,000–5,000 concurrent (a
  celebrity-reviewer scenario). The mechanism is the push migration (Ably): the board
  recomputes only when it actually CHANGES (a round is ratified, ~10x/hour), then is pushed
  to all connected clients at once — so compute cost is independent of viewer count. This
  replaces today's polling (where cost = viewers × poll-rate). Under push, a leaderboard
  cache is unnecessary. STATUS: the push migration (Ably) has SHIPPED — the board recomputes
  on ratify and is pushed to all connected clients, so no leaderboard cache is needed.
- **Series membership = the explicit `sessions.series_id` tag.** Dates/target_sessions are
  DISPLAY ONLY, never filters. qualify_count (per-series) drives the A&R Wars cut.
- **Closing a series is a status flip** (`series.status = 'closed'`); qualifiers are read live
  off the final board. No snapshot/lock needed (the board only moves when tagged sessions get
  new votes).
- **Legal:** free-entry, skill-only audience competition; artist placement $ and viewer points
  stay walled. SMS marketing consent separate from 2FA (TCPA). Attorney has cleared the prize
  structure; A2P 10DLC registered.
- **Admin:** first account on a fresh install becomes admin (`maybePromoteFirstAdmin`, at
  auth/verify), replacing reliance on `ADMIN_EMAIL` — which stays as a fallback/override.
  SHIPPED (with the profile build).

## Current state (migrations through 026; suite 490 green)
The **weekly show is feature-complete and prod-verified.** Everything below has SHIPPED to
`main` and is live on anr.makinitmag.com:
- **Reliability spine:** outage fix + self-healing ensureInit + boot-safe deploy-step
  migrations; soft-delete clears live; unique email index. Neon TLS now fully verified
  (`rejectUnauthorized: true`; `PGSSL=no-verify` is the escape hatch). pg BIGINT/NUMERIC
  parsed as JS numbers at the driver (SQLite returns numbers, PG returned strings — the
  mismatch was invisible to the SQLite test suite and produced nonsense share-card ranks).
- **Series layer** (011): series table + `sessions.series_id` + qualify_count; admin UI
  (management panel, inline session tagging, configurable cut, Close series) + public series
  leaderboard on the homepage. Live-computed, never stored (see architecture below).
- **Profile / liveness / homepage** (3.5): profiles on `users` (display name, categories,
  location, IG/TikTok, photo via Vercel Blob; private email/phone/notify opt-in), the
  completeness gate (name + ≥1 category + primary category + location, via
  `isProfileComplete()`), join feed + count-only liveness, single-page session-aware
  homepage, tap-to-start YouTube
  embed. Watch-embed resolves a channel `/live` link to the current live video (or the
  channel-id `live_stream` fallback); the embed shows for live rooms only.
- **Binary ("Verzuz") polls:** full player + overlay + export; split SEALED until ratify.
- **Push migration (Ably):** board recomputes on ratify and pushes to all clients; polling
  drops to a 15s heartbeat when connected, 2s fallback otherwise. No leaderboard cache needed.
- **Growth + monetization + ops:** referral milestones (invitee's 10th scored round → +10,
  50th → +75); invite-only rooms (unlisted + access code); share cards (Score Card, Top 8
  A&Rs, Top 8 Songs — Satori/Blob) + recap emails (chunked queue); host-only paid **Song
  Report** (3-page per-round analytics PNG) + a Rounds-tab round-history browser; **Platform
  control panel** (global banners, allowlisted system settings, SMS test) + host defaults
  (per-host watch/submit/description/banner prefills); **Revive ad server** (ads.cannick.com,
  zones 8=lobby/9=game, phase-aware cascade room→Revive→global, iframe-only); **mass
  announcements** (email/SMS to all A&Rs, chunked queue, SMS consent-gated).
- **Scoring (re-locked 2026-07-06):** compare at one decimal, round-HALF-UP via integer math
  (`Math.round((sum*10)/n)/10`); exact-tenths error; BULLSEYE = exact hit only → always 125;
  a 5.65 room average rounds to 5.7 so a 5.7 prediction earns the 100 + 25 bonus.
  **NOTE — rating scale moves 0-9 → 0-10 at v1 launch** (decided 2026-07-09; not built).
  Do it FORWARD-ONLY (per-round scale marker, e.g. `rounds.rating_max` default 10; legacy
  rounds stay 9) — points are accuracy-derived so leaderboards don't break across scales;
  do NOT rewrite history (avoids the heavy per-row migration the #1 rule warns against).
  Scale-relative bits: scoring.js `FAR=5.0` + the grade `acc=100*(1-avgErr/9)`; Song Report
  `Array(10)`/"out of 9"; all "0–9" copy. See the `scoring-scale-0-10` memory for the full plan.

- **Post-show artist workflow** (026): every artist whose record was rated gets their FULL
  3-page Song Report free by email + the replay link + carousel-post instructions (no price
  / no upsell — operator's call, visibility first; a test asserts the copy stays clean), plus
  a heads-up SMS **queued to a 10AM–8PM ET window** (TCPA; the show ends at 11PM so texts
  drain the next morning via the `/api/cron/artist-sms` Vercel Cron — needs `CRON_SECRET`,
  and hourly cron needs Vercel **Pro**). Artist email/phone lands on `rounds` three ways:
  the Drupal ingest payload, the host queue form, or **retroactively** — `round/edit` now
  accepts RATIFIED rounds (descriptive fields + contact ONLY; votes/score/points are never
  writable there). Rounds tab flags ⚠ on any rated round with no contact. Also: an **Asana
  post kit** button (one task/show: Top 8 A&Rs + Top 8 Songs + the top record's report pages
  as real attachments, plus a 16-handle caption) — `ASANA_TOKEN` in env (never the settings
  table), project id in the Platform panel; caption is copyable even when unconfigured.
  `/api/admin/ingest/latest` tightened to platform-admin (it now carries submitter PII).
  Cron drains CLAIM rows (`pending`→`sending`) before sending — Vercel documents that cron
  delivery can double-invoke, and the hourly job overlaps the host's own wrap-up drain.
  **Operator setup: docs/post-show-setup.md** (env vars, the Hobby-cron deploy trap, Asana).

## What's next (roadmap order)
1. **A&R Wars tournament tooling — the one big unbuilt feature.** The format is designed
   (docs/anr-room-roadmap.md 6.4) and its substrate exists (binary polls; series qualify_count
   for the cut), but NONE of the tournament machinery is built: the 8-competitor bracket +
   seeding (top-N from the series board + invited Tastemakers), the matchup→advancement flow
   wiring binary-poll outcomes to the bracket, the service-pack / scouting workflow, and a
   **winners model** (the homepage `winners[]` is still an empty array — nothing writes it).
   This is the largest remaining build; not started.
2. **Multi-tenant** (docs/multi-tenant-roadmap.md): invite-only hosts, email-only, the
   contact-list thesis. A program of work, not a single task — the next horizon after Wars.
3. **Notification expansion beyond announcements:** "room going live" and event pushes to
   opted-in A&Rs across SMS/email/web push, phased.
4. **PWA install + iOS web push** — DEFERRED behind a branding / site facelift pass (which
   gates the install prompt work).
5. **Parked ideas:** host→series default (new rooms auto-tag into the host's active series);
   Versus matchup infographic + a Versus flavor of the Song Report.

## Open product decisions (operator/legal — not code)
- **Artist SMS consent (TCPA):** the review/submission form needs an explicit "you agree to
  a text when your song is played" line before artist texts go out at volume. The 10AM–8PM
  ET window is built; the consent basis is not. Attorney item.
- **VIP gating for the Song Report** (parked): later, only VIP submissions get the report;
  first-timers get it free once with a notice upselling VIP. NOT built — today every artist
  gets it free. See the `postshow-artist-workflow` memory.
- Attorney re-check: referral bonus points sitting on the CASH-prize board; whether referral
  points count toward the A&R Wars cut.
- Do private-room points count toward the $500? (Today they do.)
- Song Report pricing / which submission tier bundles it.
- Copy-inventory spreadsheet: reconcile the Room/A&Rs terminology sweep against the operator's
  revised docs/copy-inventory.xlsx when returned.
- Before a celebrity-scale event: upgrade Revive's shared hosting (fine at current traffic).

## Design system + assets (match these)
The design system is extracted to `docs/design-system/` (also synced to Claude Design):
`tokens.css` + `ui.css` are the shared source of truth, loaded by all three surfaces.
Match the real tokens: dark purple-black (#0d0b16), green signal (#4bb749), purple accent
(#6d5fe0), DM Sans body + Space Mono for data/labels. For NEW UI, build/approve a visual
mockup first (mockup-first rule above). The original planning docs + approved mockups
(roadmap, audit, series/profile/homepage mockups, binary-poll spec, pre-deploy checklist,
load-test plan) live with the project and remain the reference for anything not yet built —
chiefly the A&R Wars tooling.
