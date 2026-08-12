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
  are predicting. Vote COUNT is OK; vote DIRECTION is not. Server-enforced. **Round comments
  fall under this rule too** — "this one's a 9 for me" leaks direction just as surely, so a
  comment body is readable ONLY by its author and the host. There is no public read path.
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
- **No points for round comments** (decided 2026-07-26). Points on this board are
  accuracy-derived; paying for free text puts non-accuracy points on a CASH-prize board
  (compounding the open attorney item on referral points), rewards volume over quality, and
  scales the host's approval queue with room size. The reward is recognition instead — the
  A&R's name goes to the artist. If it's ever revisited, the only defensible version is
  points when the HOST SHARES a comment (merit-gated, unfarmable), and it belongs in the
  same attorney question as referral points.
- **Legal:** free-entry, skill-only audience competition; artist placement $ and viewer points
  stay walled. SMS marketing consent separate from 2FA (TCPA). Attorney has cleared the prize
  structure; A2P 10DLC registered.
- **Admin:** first account on a fresh install becomes admin (`maybePromoteFirstAdmin`, at
  auth/verify), replacing reliance on `ADMIN_EMAIL` — which stays as a fallback/override.
  SHIPPED (with the profile build).

## Current state (migrations through 031; suite 863 green)
The **weekly show is feature-complete and prod-verified.** Everything below is on `main` and
live on anr.makinitmag.com.
> **Keep this section honest against git, not against intent.** On 2026-08-05 this file
> claimed 028 had shipped while the migration was still untracked locally and `main` was
> level with `origin/main` — a whole feature, and a migration prod had never run, sitting
> unpushed. "SHIPPED" here must mean pushed to origin, not merely built and green.
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
  a heads-up SMS **queued to a 10AM–10:30PM ET window** (TCPA; the show ends at 11PM so texts
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
  **Per-round resend** (`artist-notices/resend`, Rounds-tab 📨): the room-wide queue is
  idempotent by design, so it can NEVER re-send a round that already went out — which is
  right for "run the batch twice" and useless when one address had a typo or bounced. This
  is the only intentional re-send path. It re-reads the destination off the round every
  time (reusing the queued row's stale dest would defeat the point), re-renders the report
  (so comments shared since are included), and UPSERTs the one `uniq_artist_notice` row
  back to pending rather than creating a second. Eligibility is re-checked server-side.
  SMS still obeys the ET window — a resend is not a reason to text at 2AM. `/api/admin/rounds`
  carries per-round `notice.{email,sms}` state (colours the button, labels it send vs
  resend) plus `smsWindow` so the dialog never hardcodes the hours.
  **Operator setup: docs/post-show-setup.md** (env vars, the Hobby-cron deploy trap, Asana).
- **Optional round comments** (027): after locking in, an A&R may leave ONE short note
  (≤280 chars) on a rating round. Own table `round_comments`, never a column on `votes`
  (that table is read by every board sum and ratify recompute). SEALED like the split.
  **REJECT-BY-EXCEPTION as of 029** (operator's call — 027 originally shipped approve-in):
  comments default to `status='shared'` and ride the artist's report email attributed by
  A&R name + role + city; the host's job in the Rounds tab is REJECTING the odd bad one,
  not approving each good one. Approve-in was reversed because host inaction meant nothing
  ever shipped, which kills the feature on any week the queue doesn't get worked. 029
  retired `pending` entirely rather than leaving it as an unused third state — a status
  that still gates sends but nothing produces reads as "held for review" while meaning
  "unreachable". Exactly two states: `shared | hidden`. `hidden` is STICKY across an A&R's
  edit (else editing is a one-click undo of the host's rejection); editing a shared comment
  keeps it shared. **The tradeoff to remember: inaction now ships everything**, and there
  is no unsend — so the artist-notices send panel prints how many comments are about to go
  out, with a link into the Rounds tab, and the confirm dialog repeats it.
  The write window deliberately stays open past ratify and the composer is ONE DOM node
  moved between the locked and results screens (plus a localStorage mirror) — the reveal
  must never eat half-typed work. Versus rounds take no comments. **No points** (see below).

- **Notification contact center** (028): A&Rs choose how they're contacted. Own table
  `notify_prefs (uid, topic, channel, enabled)` — never columns on `users`, because topics
  and channels grow and the audience query must be one set-based `INSERT…SELECT` on BOTH
  dialects (JSON-on-users is where SQLite and PG diverge). **Sparse by design:** a row
  exists only where someone chose, absent rows resolve to the `NOTIFY_TOPICS` catalog
  default via `LEFT JOIN … COALESCE(p.enabled, <literal>)` — so it shipped with **zero
  backfill**, and adding a topic is a constant edit. (Inline the default as a literal;
  `COALESCE(int_col, $n)` can make PG fail to infer a param type.) Topics: `room_live`
  (email+sms, default ON), `digest_daily` / `digest_weekly` (email, default OFF, **no
  sender built** — prefs only). Invite-only rooms deliberately use `room_live` too: an
  unexposed topic that still gates sends is a trap.
  **The bug it fixes:** phone presence *was* consent, re-derived at THREE sites
  (`/api/auth/verify`, `/api/join/verify`, `/api/join/account`), so you could not have a
  number on file and be opted out, and any opt-out was silently reversed by the next join.
  `users.sms_pref_set_at` (non-null = explicit decision) freezes the derivation for that
  user in BOTH directions; `sms_marketing_consent` + `sms_consent_at` stay the TCPA record
  (`sms_consent_at` is never cleared — `sms_optout_at` records the withdrawal). The go-live
  fan-out now reads live consent off `users`, not the per-session participant snapshot,
  which could claim a consent since revoked. **The subscribe moment is a checkbox at
  registration** (all three paths, checked by default); an absent `notifyRooms` writes
  nothing, so older clients never unsubscribe anyone. Manage/unsubscribe links ride the
  go-live, recap and announcement messages, signed with `NOTIFY_LINK_SECRET`
  (`np1.<uid>.<exp>` HMAC, 30d, fragment `#nt=`): **prefs-scope only** — never wired into
  `resolveUserId`/`userFromAuth`, masked contact on read, and it cannot change the phone
  number (a leaked link must not redirect someone's texts). Fails closed when unset;
  minting returns null and footers fall back to a login link. `email_opt_out` is the
  global kill switch and now gates the mass announcement, which previously honored nothing.
  Platform panel has a per-topic audience readout.

- **Charts / "Makin' It HOT 100"** (no migration — pure read layer): an admin-only Charts
  screen that ranks **records** or **A&Rs** over a series, a date range, the last N rooms,
  or all time, and emits three things off ONE query string (so the screen, the CSV and the
  carousel can never disagree): a ranked table, a CSV, and an Instagram carousel of 1080×1440
  PNGs (cover + list slides, 10–20 rows each) through the existing Satori pipeline, plus a
  copyable caption. **Ranking = room average with a MIN-VOTE FLOOR** (operator's call): a 9.0
  from 4 voters must not outrank an 8.6 from 200, but the number PRINTED stays the room's real
  average — so the floor EXCLUDES rows rather than reweighting them into a score nobody voted.
  Excluded rounds come back in their own list and render below a cut line, because a chart
  that silently truncates reads as "this is everything" when it isn't. Versus rounds never
  chart (a split isn't an average). A record replayed in a later room charts once at its best
  showing, with a `plays` count kept in the CSV (`dedupe=0` turns it off). "Room #1s" is the
  top record from each of the last N rooms; a room whose best is under the floor reports null
  rather than dropping out. A SERIES A&R chart reads `SERIES_POINTS_SRC` verbatim so it can
  never disagree with the public $500 board. **Platform-admin only** — it spans every room
  regardless of owner; a per-host flavour would need the scope query filtered by `owner_uid`.
  Endpoints: `/api/admin/charts` (`?format=csv|caption`) + `/api/card/chart?slide=N`.
  Band key printed on the graphics: `0–2.9 Keep it in the studio` / `3–5.9 Release Ready` /
  `6+ Potential Single` — the operator's original "0-3 / 3-6 / 6+" double-counted both edges,
  so the shipped bands are half-open. `CHART_SCALE_MAX` in share-cards.js is the 0–9 ceiling
  and the band cuts move with the 0–10 switch.

- **Staged rounds + one-button show control + host buzzer** (030): a round now opens into a
  new **`listening`** status — the record is on the overlay and in everyone's hands while it
  plays, with NO dial and NO clock — and the host explicitly opens voting when it ends. That
  makes every A&R's voting window identical and stops anyone rating three bars in. The guard
  is real: `/api/vote` requires `status='voting'`, so listening rounds are refused at the
  server, not just hidden in the UI. `listening` needed no schema change (rounds.status is
  free TEXT; a listening round simply has `closes_at = NULL`).
  **One Advance action drives the whole show** — Open Round → Open Voting → Ratify → Open
  Round — implemented ONCE in `advanceRoom()` and called by both the console's big button
  and the Stream Deck, so a physical key and the screen can't drift. **Ratify is
  double-pressed**: first press arms, second commits. The arm lives in the DB
  (`sessions.advance_armed_at` + `advance_armed_round`, 8s window) precisely because Vercel
  may route the two presses to different instances — an in-memory arm would never fire. The
  round id is stored with it so a stale arm can't tally the NEXT song.
  **Stream Deck / external control:** `users.control_key` (per HOST, not per room) →
  `/api/control/{advance,extend,state}`. The key resolves to whichever room that host has
  live (same live-then-upcoming resolution as the host-keyed overlay), so a deck is
  configured ONCE and never re-pointed. GET is accepted deliberately — Stream Deck's built-in
  action and most of its plugins only do GET. **Scope is round control only**: it cannot read
  A&R contact details, change settings, or delete anything, so a leaked key costs a disrupted
  show, not a breach. Revocable + regenerable from the console (rolling invalidates instantly).
  **Host buzzer:** WebAudio in admin.html (no asset files), edge-triggered on the ROUND id so
  it fires once — the clock sits at 0:00 for as long as the host takes to tally and a plain
  `<=0` test would re-fire on every 250ms tick. Last 5s tick; sticky per-device mute. It does
  NOT auto-close the round. Note browsers block audio until the tab is interacted with, so
  the context is primed on first click.
  Tests use a `startVoting()` helper (idempotent — a no-op unless something is listening)
  after each add-round, since adding a record now puts it on deck rather than starting a clock.

- **Review-site submissions straight to the fields** (031): `sessions.ingest_auto` = 1 makes
  the console fill the queue form the moment a push from makinitmag.com/review lands, instead
  of lighting up "Pull latest submission" — one press per song instead of two. Set per room
  (Edit room settings) AND as a **host default** (My rooms → Defaults): the show spins up a
  NEW room every week, so a per-room-only flag is off the week you forget. **Platform-admin
  only to arm** (per room and as a default, re-checked against the live role at creation
  rather than trusted from the stored blob) because the staged payload carries the artist's
  email/phone; turning it OFF is not privileged. It fills the FORM, never the room — "Add &
  open round" still gates what the room sees. **It does NOT make a song openable from the
  Stream Deck**: Advance drives off the server-side queue (`nextStage()` → `none` → 400
  "Nothing queued"), and a filled form is browser text the server has never seen. Delivering
  the push into the QUEUE instead would fix that; the operator chose the form (2026-08-12).
  The newest push always wins (operator's call), so auto-fill can replace a record staged but
  not added — hence the one-press undo, the 2s field flash, and no `focus()` steal. It
  baselines on console open so a record staged before you got there stays behind the button,
  and baselines even when the slot is EMPTY (or the first push of the night gets eaten as the
  baseline). **No submit-link heuristic**: the link decides which pull BUTTON shows, but it
  must never silently override the explicit room toggle — the first pass skipped
  nero.fan-linked rooms and would have read as broken rather than off. The ingest POST
  publishes to live auto rooms on the room's existing Ably channel so it lands in ~1s instead
  of on the console's 15s connected-poll heartbeat. The staging slot is still ONE GLOBAL
  settings row: two pushes before you add = the first is gone, and two auto rooms would draw
  from the same slot — fine for a one-operator show, a per-room queue is a different change.

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
3. **Digest senders** — the daily/weekly update emails. The subscription layer, the
   audience helper (`notifyAudience(topic, channel)`) and the prefs UI all shipped with
   028; **nothing sends**. Needs the content (reuse `cardArsData` / `cardSongsData` /
   `homeSeriesBoard`), a chunked-queue drain like `recap_emails`, and a cron entry —
   note a second cron alongside the hourly artist job still requires Vercel **Pro**.
   Operator's note: recaps draw from the previous day's show. Web push is a third channel
   on the same table, still gated behind the PWA shell.
4. **PWA install + iOS web push** — DEFERRED behind a branding / site facelift pass (which
   gates the install prompt work).
5. **Parked ideas:** host→series default (new rooms auto-tag into the host's active series);
   Versus matchup infographic + a Versus flavor of the Song Report.

## Open product decisions (operator/legal — not code)
- **Artist SMS consent (TCPA):** the review/submission form needs an explicit "you agree to
  a text when your song is played" line before artist texts go out at volume. The 10AM–10:30PM
  ET window is built; the consent basis is not. Attorney item. **Ask the attorney about the
  window itself too** — the TCPA safe harbor is 8AM–9PM in the *recipient's* local time, and a
  10:30PM ET close sends past 9PM to anyone in ET/CT (set 2026-08-01 at the operator's request).
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
