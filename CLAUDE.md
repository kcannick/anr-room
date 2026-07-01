# Project: The A&R Room

A weekly live music-review broadcast (Wed 7–11 PM ET, multistreamed to 6 platforms) with a
participation layer: viewers rate songs 0–9 and predict the room average, scoring on how
well they "read the room." Points accrue across a monthly **Series**; the top N qualify for
**A&R Wars**, a head-to-head tournament (binary "Verzuz" poll) for a cash prize.

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
- `npm test` — full suite (scoring.test.js + migrate.test.js + e2e.test.js). **Expected: 261 passed, 0 failed.**
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
- **Test before delivering.** Keep the suite green (242/0). Run `npm test` after changes.
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
  cache is optional/unnecessary. NOTE: the current code still POLLS; until the push migration
  ships, a short-lived leaderboard cache (Upstash) is the stopgap if a large event lands
  first. But the plan is push.
- **Series membership = the explicit `sessions.series_id` tag.** Dates/target_sessions are
  DISPLAY ONLY, never filters. qualify_count (per-series) drives the A&R Wars cut.
- **Closing a series is a status flip** (`series.status = 'closed'`); qualifiers are read live
  off the final board. No snapshot/lock needed (the board only moves when tagged sessions get
  new votes). [2.0 idea: auto-seed an A&R Wars session with the top N.]
- **Legal:** free-entry, skill-only audience competition; artist placement $ and viewer points
  stay walled. SMS marketing consent separate from 2FA (TCPA). Attorney has cleared the prize
  structure; A2P 10DLC registered.
- **Admin:** first account created should be admin (replacing ADMIN_EMAIL) — DEFERRED to the
  profile build, since it touches the auth path that build rewrites.

## Current state (as of this writing)
- Deployed: outage fix + Tier 1 (self-healing ensureInit, safe deploy-step migration) +
  Tier 2 (green suite, soft-delete clears live, unique email index, roomtone→anr-room renames).
- Landed on `main` (commit 0950aeb): **Series layer backend** (migration 011_series:
  series table + sessions.series_id + qualify_count + indexes; 6 endpoints: create/list/edit
  series, tag session, admin + public leaderboards). Backend only — the admin UI is the next
  build. (The `docs/patches/series-layer-backend.patch` that introduced this is now applied;
  the patch dir is historical.)

## What's next (roadmap order)
1. **Series admin UI** — into admin.html: series management panel, inline session tagging
   (dropdown on each session + "+ Add new series"), leaderboard view with configurable cut +
   "Close series". Build to match the series admin mockup.
2. **Public series leaderboard** — into the public homepage.
3. **Profile / liveness / homepage cluster** — profiles on users (public: display name, photo
   [object storage, fast-follow], categories [two-step: select-all → most-focused-on], location,
   IG, TikTok; private: email, phone, notify opt-in), qualification gate (complete profile →
   eligible for leaderboard/prizes), liveness (join feed + counters, count-only), public homepage
   (single-page scroll, session-aware, Register CTA), voting-page YouTube embed (tap-to-start,
   never autoplay). This build also clears the deferred first-user-admin + remove-signup_prompt
   items. Build to match the profile + homepage mockups.
4. **Binary poll UI** — per binary-poll-build-spec.md (schema already in place).
5. **Push migration (Ably) — the real scaling lever for 2,000–5,000 concurrent.** Replaces
   polling: clients subscribe instead of asking every 2.5s. Server pushes round state + the
   recomputed leaderboard on actual change. This is what makes a celebrity-scale event work;
   managed (no ops), within budget. Upstash cache only as a pre-push stopgap if needed.

## Design assets (build to match these)
Approved mockups + planning docs from the design sessions live with the project (roadmap,
audit, series/profile/homepage mockups, binary-poll spec, pre-deploy checklist, load-test
plan). The mockups are the build spec for the UI work. Match the app's real design tokens:
dark purple-black (#0d0b16), green signal (#4bb749), purple accent (#6d5fe0), DM Sans body +
Space Mono for data/labels.
