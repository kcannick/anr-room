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
- `npm test` — full suite (scoring.test.js + sidebet.test.js + migrate.test.js + e2e.test.js). **Expected: 0 failed** (1,630 passed as of 2026-09-19; the count grows with features — green is the invariant).
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
- **The Vercel function bundle only contains what `includeFiles` names.** The CDN serves
  `public/` directly, so `/landing.html` can be up while `/`, `/daily`, `/admin` and every
  other clean route (served by the function's own `serveStatic`) answer "Not found". That was
  the 2026-09-20 outage: `includeFiles` listed only `assets/**`. It is `{assets/**,public/*}`
  now — keep `public/*` in it, and keep `public/brand` (32MB) out of it.
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

## Current state (migrations through 040; suite green)
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
- **Growth + monetization + ops:** referral points (per accurate round in the invitee's first
  30 days — see the referral rework below; the 10/75 milestones are retired); invite-only rooms (unlisted + access code); share cards (Score Card, Top 8
  A&Rs, Top 8 Songs — Satori/Blob) + recap emails (chunked queue); host-only **Song
  Report** (per-round analytics PNGs — rebuilt as the **Track Report**, see below) + a Rounds-tab round-history browser; **Platform
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
  Song Report (now the Track Report, below) free by email + the replay link + carousel-post instructions (no price
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
  (≤500 chars — raised from 280 on 2026-09-02, operator's call: a tweet's length was too
  short to say what they heard AND why, which is the half the artist can use) on a rating round. Own table `round_comments`, never a column on `votes`
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

- **Delete a played round nobody evaluated** (no migration): `round/delete` used to only pull
  a PENDING song off the queue. It now also deletes a round that STARTED but drew ZERO votes
  — the accident one-button Advance makes easy: lean on the key and a record is opened, ended
  and ratified on an empty room, then sits in the numbering, the Rounds tab and the artist-
  notice surfaces forever with no way out (unopen only rescues a `listening` round). A round
  WITH votes is refused at the server: those points are somebody's score on a cash-prize
  board, and vaporising them is not an undo — soft-delete the room instead. The delete is one
  transaction (comments → notices → votes → round) and then **closes the gap in the
  numbering**, because idx is assigned at open as (started rounds)+1, so a hole makes the NEXT
  record reuse a number already on the board. It also clears an Advance arm pointing at the
  dead round (else it could tally the next song) and pushes `round` — deleting a started round
  changes what every player is looking at. Console: a red 🗑 in the Rounds tab, offered only
  when `votes === 0`.

- **A&R Wars side contest — "the sidebet"** (033): a free-entry prediction contest at
  **/sidebet**. Entrants pick which songs from the monthly A&R Service Pack will actually be
  **PLAYED** at A&R Wars, put them in order, and the most-right entry wins a sponsor-funded
  cash prize. **Set membership, not ratings** — nothing reads votes, room averages or the
  series board, and **no points are awarded**, so it never touches the $500 board.
  **18 = the bracket** (8 competitors → 4+2 matchups + a 3-poll final = 9 binary polls × 2
  songs), but it is `packs.picks_required`, never hardcoded — it moves if the format does.
  **Winner: most correct** (operator's call — perfect-or-nothing would leave the prize unpaid
  most months). Ties break on **order distance** (Spearman footrule) against the **consensus
  ranking**: the played songs ordered by how many entrants picked them, count-ties broken by
  **CSV row order**, which is why `pack_songs.row_no` is load-bearing and fixed before any
  entry exists. Last resort is earliest `updated_at` — the list that actually competed, NOT
  first submission, or an early throwaway rewritten at the deadline would keep the early
  timestamp as a free option.
  **SEALED like the vote split: pick counts are never emitted before settle.** The tiebreak
  ranking is built from the entries themselves, so a live "340 people picked this" would make
  copying the crowd dominant — every entry converges, every entry ties, and the winner is
  whoever submitted first. There is no public read path and no aggregate in the player payload.
  **Identity is the existing email OTP** (`/api/auth/request` + `/api/auth/verify` reused
  verbatim; phone collected, not verified — email is the unique key an entry attaches to, so
  verifying a phone would prove the wrong fact). An entrant becomes a `users` row with **no
  `participants` row**: a durable verified account that never played a session, which is the
  second job this does — **the contest seeds the audience**. `UNIQUE(pack_id, user_id)` is what
  makes "one entry per person" real rather than a rule in the copy.
  The form is **last** (they've done the picking, so it reads as keeping their work, not a
  toll) and picks stay client-side until the code verifies, so bailing leaves no half-entry.
  Entries are **editable until `closes_at`**, enforced server-side — editable past the first
  song would let someone submit a list they already know the answer to.
  **Admin (platform-admin only; a pack spans no room):** iterations list, create form (title ·
  picks · download link · Wars date · cut-off, plus prize/sponsor/banner), **CSV song loader**
  (row order shown and explained; blocked on blanks, duplicates, or fewer songs than picks),
  and a **settle checklist** that **refuses to run at anything but exactly `picks_required`** —
  a miscount doesn't error, it quietly crowns the wrong person. Settle is re-runnable while
  unsettled so a corrected checklist re-scores everyone.
  **The played set derives**: queuing a Versus matchup from the pack stamps
  `rounds.pack_song_a/b` (validated against the pack linked to THAT room — a foreign id is
  dropped, never stamped), so the 18 fall out of the 9 matchups; the host confirms rather than
  ticking 18 boxes. Hand-typed matchups still work — the checklist is confirm-or-correct.
  **The CSV cannot be replaced once entries exist** (every pick points at a `pack_songs` row),
  and `picks_required` freezes then too. **Sponsor banner reuses the `banners` table**
  (`packs.banner_id`) and play.html's `.ad-slot` treatment on every screen — with **no fallback
  to the global house banner**, because the page says "courtesy of our sponsor". Scoring lives
  in `sidebet.js` (pure, unit-tested like scoring.js). Spec:
  docs/specs/sidebet-contest-spec.md. Mockups: `public/_mock-sidebet.html` (player) and
  `public/_mock-sidebet-admin.html` (console).

- **A&R Daily — the async daily drop** (034 + 035). **SHIPPED and live** — pushed to origin
  2026-09-09 and running daily. (This line read "NOT YET PUSHED" for several days after the
  work actually went out, which is the exact failure the warning at the top of this section
  is about: the claim went stale in the direction that made the file *understate* what was
  live, and a session read it and planned against a deploy that had already happened.
  Re-check against `git log origin/main` before trusting any status word here.)
  This inverts the product: **the daily drop is the thing and
  the live show becomes a special event on top of it.** The bottleneck it fixes is
  post-authentication — someone converts and then has nothing to do until Wednesday, nobody
  can play at work, and artist slots are capped at whatever fits 7–11PM ET.
  **The day is 4–16 records, never a fixed 16** (4 drawn from the free pool + up to 12 paid).
  Nothing hardcodes a count, on either side of the wire.
  - **A drop is a `sessions` row**, not a new entity — `SERIES_POINTS_SRC`, `buildRecap`,
    `cardArsData`/`cardSongsData`, `ARTIST_ELIGIBLE_SQL` and the post kit are all session-keyed,
    so a separate table would mean re-plumbing all of it. `sessions.mode` is a new ORTHOGONAL
    axis, not a fifth `status` (nullable ⇒ every existing row keeps today's behaviour with zero
    backfill — the `visibility`/`ingest_auto` precedent). `sessions.async_state` earns its own
    column because the 9AM→noon gap (tallied but not published) cannot be expressed in `status`,
    and flipping to `completed` at 9AM would trip `playerState`'s recap branch and reveal every
    room average three hours early. It is also the cron's claim token.
  - **The window is absolute epochs, never a duration.** `clampMinutes` pins live windows to
    2–60 minutes; and `opens_at + 21h` would give an 8AM close in spring and a 10AM close in
    autumn. Both ends resolve from ET wall clock (`etEpoch`, two-pass so a DST guess converges).
  - **Per-A&R queue order is a seeded shuffle** (SHA-256 counter mode → unbiased Fisher–Yates),
    a pure function of (uid, session): nothing stored, resume is free, no cursor to go stale,
    and drop-off spreads across the whole day instead of starving whatever sits last.
    **`votes` IS the cursor** — the server returns every record with a `voted` flag.
  - **The seal is STRICTER here than on a live show: omit keys, don't null them.** A
    `room_average: null` is itself a tell once one record tallies. And **no per-record vote
    counts**: across a 21-hour window with everything open at once, "record 7 has 180
    evaluations" is a popularity signal, which is the direction-adjacent inference the rule
    forbids. Only the session-level participant count ships.
  - **Completion bonus** = a `point_events` row (100/75/50/25 by tier), never a multiplier on
    `votes.points` (which would make "max 125" untrue everywhere and multiply NEGATIVE rounds
    into a penalty). `source_uid` is the composite `${session}:${uid}` — a bare uid pays once
    ever, a bare session id pays once per day across all users — and `milestone` is a literal 1,
    never the tier, or two racers with different tiers defeat the index and pay twice. **Tier
    comes from when they FINISHED** (max of last vote and last report), not `now()`, so a 9AM
    sweep cannot pay 25 to someone who finished at 2PM.
  - **Report a record** (`round_reports`, `UNIQUE (round_id, participant_id)` so the count is
    PEOPLE not clicks). A reported record counts as HANDLED for the bonus — otherwise reporting
    a dead link honestly strands the reporter one short, which teaches everyone to stay quiet.
    **Capped at 3/day, floored at `min(3, total-1)`** (operator, 2026-09-02): there is no day
    size on which you can report your way to a bonus without rating at least one record.
  - **`/daily` is its own page** (`public/daily.html`), not a branch inside play.html, with the
    join plumbing extracted to **`public/auth.js`** as a pure refactor first. Built to the
    approved design canvas (Archivo 800/900 + Space Mono, the 13° device, gold = money and
    first place only). **No live count, join ticker, giveaway, host message, chime, countdown,
    banner, embedded player or Ably** — a live session is a notification with a link.
    Three mechanisms were ported deliberately: the composer is ONE appendChild-moved node so a
    half-typed note survives the reveal; `cmtPruneDrafts` keeps a SET of the whole day (guarded
    on empty, built as strings) instead of play.html's single key; and the reset edge guards on
    the round id and nothing else, or a background refetch wipes a half-set dial. Draft keys are
    now session-scoped (`anr_cmt_<sid>_<rid>`) because the flat namespace meant whichever
    surface pruned last destroyed the other's drafts.
  - **Noon publish → two INDEPENDENT emails.** The A&R digest (common Top 8 block + a
    personalised round-by-round table for anyone who played) is `notifyAudience()`'s first
    production caller — its `{sql, params}` fragment composes into one set-based
    `INSERT…SELECT`, and `toPg()` numbers `?` TEXTUALLY so the params bind by position in the
    final string. **No per-recipient PNG** (that is ~10 sends per invocation and would never
    finish); the table is HTML. The artist's Song Report is unchanged from 026 in shape —
    only the trigger becomes automatic — and stays separate because **artists are not users**:
    no uid, so no `notify_recipients` row, no `notify_prefs`, no signed manage link. Someone
    who is both gets both, deliberately. Artist notices are **held one hour** past publish
    (`ARTIST_NOTICE_DELAY_MIN`) because 029's reject-by-exception loses its human checkpoint
    under a cron and there is no unsend.
  - **`digest_daily` stays default OFF.** Flipping it turns an opt-in list into a daily send to
    the whole registered base — a deliverability decision disguised as a one-literal change.
    Run a week on a manual list first, then flip as its own commit.
  - **Every queue claims its rows.** `drainArtistEmail` is extracted out of the route WITH the
    `pending→sending` claim it never had (fine when a human clicks, a double-send bug under a
    cron), and the publish claims on `recap_jobs.claimed_at` with a 10-minute staleness escape.
  - **Cards are best-effort; the reveal is not.** The plan said skip the publish entirely
    without `BLOB_READ_WRITE_TOKEN`; that stalls the reveal indefinitely on an env var, which
    is worse than a graphic-less email. The day always publishes and the failure is logged.
  - **Console opens on A&R Daily**; the live-show tooling moves behind a mode switch (a change
    to which screen boots, not a rewrite). `round/edit` gains `play_url` + `artist_note` on its
    DESCRIPTIVE-only allowlist — **fixing a dead link mid-window is the most operationally
    important thing here**, and it cannot round-trip through a CMS. A missing drop renders as an
    incident, not an empty state. **The records table shows each record's score and sorts
    three ways** (drop order · score highest first · countdown lowest first, remembered per
    device) with the play link as a real link — this is how the live countdown show of the
    previous day's drop is run off the console. Ties rank by votes then drop order; an
    unscored record has no rank and sits last.
  - **The schedule moved to the afternoon (2026-09-20, operator's call, standing):** open
    **3:00 PM ET**, close 3:00 PM ET next day, reveal stream 5:00 PM, publish **6:00 PM**,
    artist reports 7:00 PM — `DAILY_SCHEDULE_DEFAULTS` moved with it (15/15/18) so a panel
    "reset to defaults" lands on the same clock. Reason: the
    deadline day gets a full working afternoon, the reminder carries day-of urgency, and
    results go live in the evening. The 9/19 drop that was open at the time was extended by
    a one-off SQL update (no route extends an OPEN day; the panel save only re-stamps cold and
    sealed days). `/api/home` now carries `schedule.{opens,closes,results}Label` and the
    landing page reads every "at <time>" off it — no hardcoded noon anywhere public.
  - **The schedule is a SETTING** (2026-09-15): `DAILY_SCHEDULE_DEFAULTS` (as of 2026-09-20:
    open 3:00 PM ET, close 3:00 PM ET next day = 24h, results 6:00 PM ET (a livestream reveal
    runs at 5PM off the console's post-tally scores), artist reports an hour after
    (`artistDelayMin` 60, the 1-hour hold is now that setting); bonus 100/75/50
    within 6/12/18 HOURS OF THE OPEN, 25 before close) overridden by `settings` rows
    `daily_open_min / daily_close_min / daily_results_min / daily_bonus_tiers`, read via
    `dailySchedule()` (30s per-instance cache). Platform panel → System settings. Saving
    RE-STAMPS every cold drop's window (a cold day is nothing but its window); an open day
    keeps the window it started with, but bonus steps are computed live off `window_opens_at`
    + hours, so a mid-day tier change does apply to finishes after the save. Close at or before
    open = next day; results clamp to ≥ close.
  - **A cold drop can be MOVED to another day** (`/api/admin/daily/move`, 2026-09-11): the
    review-site noon lock-in pressed at 12:01 pushes a day dated TOMORROW, and nothing on the
    console could fix it — a drop runs off `drop_day` + `window_opens_at/closes_at/results_at`,
    which the session-config screen never writes (it writes `scheduled_at` + name, which a drop
    never reads). The move rewrites the window and the rounds with it, restores
    `status='upcoming'`, and opens the drop in the same request when the target day's noon has
    passed (`openAsyncDrop()`, the lifecycle's open step extracted so ONE drop can open without
    running the tick over every day). Refused once `async_state <> 'scheduled'` or any vote
    exists, and when the target day already has a drop. **No console button yet** (mockup first).
  - Setup: **docs/daily-setup.md**. Needs Vercel **Pro** (a `*/5` cron fails a Hobby deploy),
    `DAILY_INGEST_TOKEN` (separate from `INGEST_TOKEN` — different blast radius), `CRON_SECRET`,
    and `PUBLIC_BASE_URL` on anything that is not the production host.
  - **Reference tracks** (035): the operator can hand-add a known record from a major artist
    so A&Rs have something familiar to rate. Fully votable and SCORED; excluded from the
    charts, the Top 8 card and the artist report queue — three separate queries, three
    predicates. A flag, not "has no artist_email": absence of contact already skips the
    report but says nothing about the charts, and a real submission whose artist typo'd
    their address would then vanish from the HOT 100 for the wrong reason. It also SURVIVES
    a Drupal re-push (which replaces the day's records wholesale), with survivors renumbered
    after the batch so idx stays 1..n; a NON-reference hand-add is still cleared, or a record
    typed in while Drupal was down would duplicate when the real day lands.
  - **Results callback** (035): at publish the app POSTs each record's outcome to
    makinitmag (`rated | not_playable | unrated`, plus rating and report counts) so the
    artist status page can confirm a review rather than promise one. **Fires at PUBLISH, not
    at the 9AM tally** — the other side asked for 9AM; the day is scored at 9 but results do
    not reach A&Rs until noon, and handing averages over in that window would put them on a
    public page three hours before the people who rated see them. Retried from its own probe
    (a published day has left the lifecycle's working set), their 404 terminal, gives up at
    24 attempts recorded as `failed` rather than `sent`. Dormant without
    `RESULTS_CALLBACK_URL` / `_TOKEN`, so a preview deploy cannot post into production
    Drupal. Wire contract: **docs/specs/daily-drop-integration-spec.md**.
    **Console readout + backlog re-send** (2026-09-16): dormant and MISCONFIGURED look
    identical from every screen — the day publishes, the A&Rs get their email, and nothing
    says the artists' status pages were never updated, which is how it ran wrong for weeks.
    The daily console's **Submission system** card (`GET /api/admin/daily/results`) prints
    configured / endpoint HOST (never the token) and every published day's result;
    `POST /api/admin/daily/results/resend` sends the backlog. The cron cannot do that
    catch-up: its probe is `results_status IS NULL` under the attempt cap, so a settled
    `failed`/`unknown_day` — or a day that aged past the cap while the URL was wrong — is
    invisible to it forever. The resend route is therefore the ONE place that clears a
    settled marker, safe only because their endpoint is idempotent. Bounded at 10 days a
    press (each is a 10s-timeout POST inside a request), oldest first; refuses 503 rather
    than settling days against an unset URL.
  - **The digest headline was the "no results" bug** (2026-09-09). A&Rs reported emails with
    no results while another replied with their rounds quoted underneath — both true at once.
    The personalised block was correctly absent for anyone who did not play, but the HEADLINE
    was unconditional, so a non-player got "Yesterday's results, <their name>." over the Top 8
    and nothing of their own. Fixed: personalise the greeting only when there is something
    personal beneath it, and say plainly why there isn't when there is not.
  - **Still open:** `sessions.live_bonus` has no value set (~300 makes one live show ≈ three
    perfect async days; without it the broadcast is decorative on the unified board), the
    scouting-points curve, and Nero retirement (`#btnNeroPull` + the scrape helper are still
    in admin.html — the plan calls for removing them as the first piece of the subtraction
    pass, deliberately not done here since it touches the live console).

- **The A&R Meeting Recap graphics** (036): the daily noon live stream (count down yesterday's
  records, reveal the Top 8 A&Rs, close on the top artists) gets an Instagram Live cover
  (9:16, 1080×1920) and a YouTube thumbnail (16:9, 1920×1080) plus a caption, rendered by the
  daily publish alongside the Top 8 cards and hosted at `daily/<day>/recap-{cover,thumb}.png`
  (`recap_jobs.recap_cover_url / recap_thumb_url / recap_caption`). The DATE is the hero
  field (MM.DD.YY of `results_at` — the day the stream AIRS, not `drop_day`) because it is
  what tells thirty near-identical videos apart. The names panel fills itself: the day's
  artists (IG handle where we have one, else the artist name; reference tracks never print)
  and the Top 8 A&Rs — **artists in DROP order, A&Rs ALPHABETISED, never ranked**, because
  the stream is the reveal and the cover goes up before it. Built to the brand
  (`anr-brand` skill: Archivo + Space Mono, green-only accent, the 13° block/rule/tick/cut)
  in Satori — the first cards on Archivo (`assets/fonts/archivo-v25-latin-{800,900}.ttf`;
  the older DM Sans cards are untouched). Console: the daily screen's graphics card shows
  both with download names, and falls back to a live admin-only render
  (`/api/card/recap-cover|recap-thumb?s=`) when Blob is unset or before publish, so there
  is always a cover; **Copy recap caption** reads the stored text or builds it live
  (`/api/admin/daily/recap-caption`). Same best-effort contract as the Top 8 cards: the
  caption is built first and kept when hosting fails. The Chrome-rendered original lives
  untracked in the main checkout at `public/graphics/` (a local design tool, not app code).

- **Support level on the daily console** (037): `rounds.support_cents` — what the artist paid
  to submit (0 = free, > 0 = paid, NULL = not reported). It arrives as `amount` (dollars) on
  the daily push song object, the hand-built round, and `round/edit` (PATCH-style; blank
  clears). **This is the one exception to "no amounts cross the wire"** (integration spec
  §1/§14), and it exists for exactly one job: on the live recap the operator plays free
  records for a minute, paid records in full, and singles out the day's **top supporter**.
  Top supporter is NOT stored — `/api/admin/daily/status` computes it at read time as the
  record(s) at the day's highest amount (ties all carry it; a day with nothing paid has
  none, so a $0 record is never crowned). NULL is printed as "—", never as Free: the
  console must not guess. Admin-only display — it scores nothing, ranks nothing on any
  board, and the player payload never carries it (tested). Console: a Support column on
  the records table and the builder queue, a gold row + "Top supporter" pill, an
  "Order: support, highest first" sort, and a Support ($) field on the builder form and
  the edit dialog. Drupal sends `amount` on the push (spec §14; `mim_anr_meeting.push.inc`),
  and `POST /api/ingest/daily/support` (same token) takes `{ref, amount}` pairs to backfill
  records pushed before the field existed — per-row reporting, re-runnable, touches
  support_cents only. Run from live Drupal with `terminus drush mim.live -- php-eval` (the
  token stays on the server). One-off on 2026-09-13.

- **Schedule change + results carousels** (038, 2026-09-13). **The daily schedule moved**: the drop
  opens at **12:00 PM ET and closes at 12:00 PM ET the next day** (a 24-hour window; the moment
  the next day opens), the operator runs the **reveal stream at 2:00 PM**, and results **publish
  at 3:00 PM** (digest, artist reports, social posts). Was open noon / close 9AM / publish noon.
  (The times are platform-panel settings — see the schedule bullet above; the carousel work
  here landed alongside that change.)
  **The results carousels**: two Instagram carousels posted after the reveal stream — the day's
  **top record** (trophy · "Top Track" · date; title, artist, handle → the other records
  **ranked WITHOUT scores**, six to a slide, split evenly across as many slides as the day needs
  → "Submit your music / Free Review by the A&R Team", closing line B) and the day's **top A&R**
  (name, city, handle, **the profile photo when there is one** → the other top A&Rs with points
  → "Join the A&R Team / Win $500 as the month's top A&R"). Rendered by the 3PM publish through
  Satori (`shareCards` type `resultsSlide`, 1080×1350) and hosted at
  `daily/<day>/results-{song,ar}-N.png`; `recap_jobs.results_{song,ar}_urls` (JSON arrays, null
  when any slide failed to host) + `results_{song,ar}_caption`. Live admin-only render at
  `/api/card/results?s=&set=&slide=`, captions at `/api/admin/daily/results-caption?s=&set=`,
  the daily status carries `cards.results`. The profile photo is fetched into a data URI at
  render (4s timeout, 3MB cap, best-effort) because Satori cannot fetch. Public surface: display
  name, city, handle, points. Mockup (approved through five rounds of operator comments):
  `public/brand/daily/carousel.html`. The promo brand system (marks, ads, key art, share
  graphics) lives in `public/brand/` — see `docs/promo-asset-list.md`.

- **The winner posts** (039, 2026-09-18): **Top Track of the Day / Top A&R of the Day**, one
  1080×1350 portrait graphic each, posted as Instagram **collab posts** so they land on the
  winner's own feed, and **Top Track / Top A&R of the Week** with a strap saying what the week
  earns ("Placed in the next $1,000 Tournament" / "Placed in the A&R Wars tournament for $500
  Cash"). One Satori element, `winnerPost`, built to `public/brand/winners/winner.html` after the
  operator's "flyers look too busy" pass: lockup, stacked title with its date, the person, ONE
  line of numbers (score; or the letter grade in the block device + points + bullseyes), the
  field. No trophy, no rank (TOP TRACK already says #1). **The day pair renders at the 3PM
  publish** (same best-effort contract: `recap_jobs.winner_{track,ar}_url` NULL on failure,
  captions kept) and hosts at `daily/<day>/winner-{track,ar}.png`; **the week pair renders on
  demand** (`/api/card/winner?week=&post=`, `/api/admin/weekly/winners?week=`) and stores
  nothing. **The weekly rule is a default the operator has not yet confirmed:** Top Track of the
  Week = highest room average across the week's PUBLISHED drops (ties: votes, earlier day, drop
  order); Top A&R of the Week = most points summed across them. A week runs Monday–Sunday and a
  week card is **dated by the week it tracks**, never the day it is announced (operator's call
  when asked). Day cards carry the DROP day. Grade and bullseyes come from the same vote rows
  the score card uses. Console: "Winner posts" + "Winners of the week" on the daily graphics
  card, with a week picker defaulting to the last completed week.


- **The Track Report** (no migration, 2026-09-15) — the artist's report, rebuilt around the
  decision. Spec: **docs/specs/track-report-spec.md** (built from the Room Report Redesign
  mockup). The old three pages opened with a big green number and buried the instruction on
  the last card; the report now opens with a sentence the artist can act on — "Release it.
  Don't put money behind it yet." — and the score sits under it as evidence. **Every headline
  is derived** in `track-report.js` (pure, `track-report.test.js`) from numbers `songReportData`
  already had: the BAND (edges 3 / 6, the chart key's cuts; `TRACK_BAND_EDGES=a,b` overrides),
  the histogram's SHAPE (consensus / divided / spread / thin — "Agreement, with three
  believers."), the record AGAINST THE ROOM (a marker on the real distribution of everything
  the Meeting has rated, bucketed at 0.5 — replaces "Top 61%", which only flatters below ~25%),
  WHO IT'S FOR (role/city segments as targeting — "Artists. Not managers."), SETUP VS RECORD
  (the prediction gap with a meaning: over-predicted = the packaging oversells), and WHAT NOW
  (three next actions from band + biggest segment gap + prediction direction). Comments get
  their own page(s), attributed name · role · city. The SHARE page carries the title, the
  artist and "N A&Rs heard it" with **no score** — postable at 2.1 or 8.4.
  **Cut on purpose:** "Room favorite · N% scored it 8+", "Top N%", the in-room/remote pool
  tile, the rank-in-session line, gold on medians and modes (gold is money and first place
  only). **The page list varies per record** (`trackReportPages`): a page whose data is
  missing drops out and the rest renumber, so the console fetches `?meta=1` first and the
  queue row's `report_urls` is the record of what went. One element type, `trackPage`
  (1080×1350, Archivo + Space Mono, the [A&R] MEETING / [A&R] ROOM lockup by `sessions.mode`,
  green = scoring, purple = the prediction game, the cut only on the share page). Reference
  tracks are excluded from every denominator. The comparison set is the Meeting's own history
  for a Meeting record (needs 20 rated records before the page shows), the series or every
  live show for a live one. Email rebuilt as a sibling of the site's template (mim
  `docs/mockups/email-template-round1.html`): decision first, the rating as evidence, the
  pages, the comments, the post instructions; still no price or upsell (tested). The SMS says
  "has been rated", never "evaluated live". **Still open (spec §2):** calibrating the band
  edges to the real quartiles — `?meta=1` returns them — and naming the 7+ raters with
  consent; and a hosted report page → `reportUrl` in the §12 callback.

- **The weekly report** (no migration, 2026-09-16) — the screen the Wednesday show is read off.
  `/api/admin/weekly/status` (platform-admin; it spans every host and carries artist handles and
  what they paid) over a **Wed → Tue window keyed on `drop_day`** — the day a record OPENED, not
  when it published, so the Tuesday drop's 3PM-Wednesday publish still lands inside the week the
  7PM show reads. The screen defaults to the **last COMPLETE week**, never the one that opened at
  noon the same day. `weekStartFor` / `weekWindow` / `lastCompleteWeekStart` in server.js are the
  only date logic; they anchor on ET noon like every other day helper, so a DST week is still
  seven ET days. Console: `#weekly` in admin.html, reached from the mode switch, reusing the
  daily `.dltable` — the host reads the same shapes on air seven days a week.
  **Top 8 Records**: title, artist, Instagram, day, support, play link, score, ratings. Ranked on
  room average; ties break on ratings, then the earlier drop. Reference tracks and Verzuz rounds
  never chart (same rule as `cardSongsData`). A record pushed on **two days charts once**, at its
  best showing, with `plays` / `alsoOn` keeping the repeat visible — the same title twice in a
  Top 8 read on air looks like the count is broken. **#1 is seeded into the Artist Tournament.**
  **Top 8 A&Rs**: points, rounds reviewed, bullseyes, days played, plus the one line the host says
  out loud. Points are **only what the window paid** — vote points on the week's rounds plus the
  completion bonus those drops paid (`point_events.source_uid` is `'<sessionId>:<uid>'`, the only
  bonus a day owns). **Referral milestones stay out**: series points with no week attached, and
  the seat must be won on the week's listening. Qualified A&Rs only (complete profile, not
  blocked), the $500 board's rule. **#1 takes a seat in A&R Wars.**
  A week whose drops have not all published reports `settled: false` and names the missing days —
  **do not hand out a seat off a week that is still settling.** "Copy the read sheet" on each
  table gives the same rows as plain text for the host's script. No cards, no cron, no send: this
  is a read-only screen, and every query is admin-triggered (CLAUDE.md #1 rule).

- **Referral rework — `/refer`, per-round referral points, 5× scouting, per-user graphics**
  (no migration, 2026-09-18). Two links per A&R, both carrying their `users.uid` (already
  public as the `/u/<uid>` profile URL): **join** = `anr.makinitmag.com/?ref=<uid>` and
  **submit** = `www.makinitmag.com/review?ref=<uid>`. The uid replaces the Drupal uid on the
  scouting link, so an A&R needs no Makin' It account; `creditScoutPoints` resolves by our uid
  first, `drupal_uid` second (older links). Drupal passes `scout.uid` back verbatim (spec §3).
  **A&R referral points** (`creditReferralRounds`, replacing `creditReferralMilestones`):
  the referrer earns **1 point per round the invitee lands within 1.5 of the average**
  (the `close` tier), **only in the invitee's first 30 days** (from `users.first_seen` — when
  the referral happened, not the first vote), **capped at 240 per invitee** for life. Binary
  rounds skipped. `point_events` reason `referral_round`, `source_uid` = `<invitee>:<round>`
  (cap counted with `substr`, not `LIKE` — uids are base64url and may contain `_`). Old
  `referral` milestone rows stay as paid history. The weekly report never sees these (its
  bonus filter is `<sessionId>:<uid>`), which is right: a seat is won on the week's listening.
  **Scouting** = `Math.round(avg × 5)` (7.1 → 36), no floor; the 250-per-point curve is gone.
  **Attribution** (`attributeReferral`): `ref` resolves to a users.uid first, then the older
  per-session participant code; only a brand-new account, never self, set once. Rides
  `/api/auth/verify` (the `/join` signup — new `ref` field) and `/api/join/verify`. Client:
  the landing page and join page stash `?ref=` under `rt_ref` (session-less — the old
  `rt_ref_<sid>` key died with the session, and a daily drop is a new session every day);
  auth.js sends the per-session key first, `rt_ref` second, and clears both on join.
  **`/refer` page** (`public/refer.html`, mockup `design/refer/`): links with copy buttons, the
  two lanes with totals and per-invitee / per-record rows, four graphics. Auth is EITHER token
  (`resolveUserId`) — a daily player holds only a per-session player token, so the page picks
  any `rt_token_*` on the device; with nothing it runs an email-code login. `GET
  /api/me/referrals` (display names only, never email/phone) and `GET /api/card/refer?kind=
  card|story|join|submit` (registered BEFORE the `/api/card/` prefix route, or it 404s;
  `private, no-store`). **The artist lane is sealed**: a scouted record shows its average and
  points only once ratified AND, for a daily drop, published — the 9AM–3PM gap leaks otherwise.
  **Graphics** (`share-cards.js` `refer*`): Satori, Archivo + Space Mono, the 13° cut kept
  BELOW the copy on the two flyers, gold on the $1,000 only, QR as a PNG data URI (rasterised
  from the `qrcode` SVG by resvg), profile photo fetched with a 5s timeout and retried without
  on a decode failure. Copy is the operator's verbatim: "Official A&R", "$1,000 Giveaway",
  "$1,000 Promo Budget". Satori has no inline runs, so the card's statement is laid as wrapped
  words with the money words gold.
  **Announcement merge tokens** (2026-09-18): `[first name]`, `[card link]`, `[submit link]`,
  `[join link]` in the mass announcement's subject and body (`renderNotifyTokens`, case and
  spacing forgiven, unknown brackets untouched; HTML escapes around them and makes link
  tokens anchors). `[card link]` is a **signed `rf1` deep link** into `/refer` (`mintReferLink`,
  same secret and TTL as the `np1` manage link, refer-scope only: `/api/me/referrals` +
  `/api/card/refer` via `X-Refer-Link` / `?rt=`, never `resolveUserId`); without
  `NOTIFY_LINK_SECRET` it degrades to the plain page, which asks for a code. The page keeps
  it in sessionStorage and scrubs the fragment. Console: click-to-insert chips under the
  composer.

- **Sales leads → Asana** (040, 2026-09-19, on main): the platform as a lead source for Mimberships and
  performances. Platform panel card: the **top N% of every ratified rating record** (live +
  daily; reference tracks and Versus out; a re-pushed record counted once at its best), ranked
  on room average, then **collapsed to one task per ARTIST** on their highest record. **Identity is
  transitive** (`leadGroups`, union-find over email / Instagram / name — the first prod run
  made a duplicate when one submission had an email and the next only the name); the ledger
  is looked up by ANY of the group's keys and an extra task the feature made is deleted on
  the next sync (`merged`). **The project is the truth** (2026-09-19, after two racing loops —
  a forgotten tab plus a fresh one — doubled ~115 tasks): every task's notes end in `Lead
  ref: <key>`, the first press of a run `reconcileLeadsProject`s (dedupe by ref keeping the
  newest, adopt unknown tasks, mark hand-deleted rows `task_gid='deleted'` — never
  recreated; an EMPTY project marks nothing), a settings-row lock (`asana_leads_lock`,
  conditional UPDATE) makes a concurrent press a 409, and changing the project setting
  clears the ledger. The cut is on RECORDS, then artists — an artist whose best sits
  below the cut is not a lead. `pct` is the operator's dial (default 30), never hardcoded past
  `salesLeadsData`. **A min-A&Rs floor (`minVotes`, default 3, 0 = off) is applied BEFORE the
  cut and EXCLUDES rather than reweights** — the charts' rule; the operator's first prod run
  had an 8.0 from one A&R at #1 (2026-09-19). Both dials are on the card. Writes to Asana highest first: project **"A&R Sales Leads"** created on
  the first press and remembered (`asana_leads_project`; an existing project id can be pasted
  in System settings), custom fields **Date played** (date) + **Average score** (number, 1dp)
  created in the workspace if missing and attached to the project. **Custom fields are a paid
  Asana feature** — without them the tasks still go out (score in the name, date in the notes)
  and `fieldsError` tells the card why the columns are missing. Task notes carry contact,
  support level, play link and the artist's other rated records; no price, no upsell (tested).
  **Re-runnable by design:** the `asana_leads` ledger (artist_key → task gid + the record it
  describes) means a second press creates only new artists, UPDATES a task whose artist scored
  higher, skips the rest without touching Asana, recreates a task deleted on their side, and
  never removes an artist who dropped out of the cut. 12 tasks per press AND a 16s write budget from request start (Vercel's 30s cap; the first press also creates the project + fields, and an overrun comes back as a gateway error the console cannot read), the console loops.
  Full scan of rounds, admin-triggered only (rule #1). Tests drive a mock Asana on
  `ASANA_API_BASE` (env override of the API base). Doc: **docs/sales-leads-asana.md**.

- **SMS discipline: conservative transactional texts + the SMS→MMS switch + "send test to
  me"** (no migration, 2026-09-20, operator's call). Carriers bill SMS per SEGMENT, and one
  emoji, em dash or curly quote turns the whole text UCS-2 (70 chars a segment instead of
  160). So: **(1) transactional texts are GSM-7 inside one 160-character segment** wherever
  the message allows — `artistNoticeSmsBody` trims a long title ("..." not "…"),
  `goLiveSmsBody` is plain text (its two links make it an MMS by LENGTH alone); the SMS test
  message is the plain default. **(2) sms.js decides the channel once, for every caller**
  (`shouldSendAsMms`: anything outside GSM-7, or > 160 characters → MMS; `SMS_MMS_AUTO=0`
  turns it off). Twilio sends MMS when a `MediaUrl` rides along, so the switch attaches the
  site mark (`SMS_MMS_MEDIA_URL`, default `<PUBLIC_BASE_URL>/mark-color.png`); the number /
  Messaging Service must be MMS-capable (US/CA). `sendSms` returns `channel`; `sms.test.js`
  (unit + a mock-Twilio wire check on `TWILIO_API_BASE`) is in `npm test`. **(3) The mass
  announcement composer has "Send test to me"** (`POST /api/admin/notify/test`): renders the
  announcement through the same `renderAnnouncement()` the real loop uses (tokens with the
  admin's own name/links, their own manage link), sends to the logged-in admin's own
  email/phone only, `[TEST]` subject prefix, no broadcast or recipient rows, consent gate not
  consulted (their own number), masked destinations in the reply. The composer shows a live
  SMS readout (characters / plain text / segments, or "will send as MMS" and why) that
  mirrors the sms.js rule; the per-recipient footer is not counted, so a message near 160 is
  already an MMS by the time it goes.

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
3. **Digest senders** — the DAILY one shipped with A&R Daily (033): `digest_daily` now has a
   real sender, a chunked drain and a `*/5` cron, and is `notifyAudience()`'s first production
   caller. **`digest_weekly` still has nothing behind it** — same shape, no sender. Its default
   is OFF and should stay off until there is one. Web push is a third channel on the same
   table, still gated behind the PWA shell.
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

## Copy voice (operator, 2026-08-30)
**Plain and direct. No hip, cultural, or slangy phrasing** in any user-facing text — it reads
as an outsider imitating the culture and costs credibility with exactly the audience the
product needs. Say what the thing is and what the person should do. When the operator supplies
wording, use it **verbatim** rather than improving it. Prefer the literal noun ("songs",
"picks", "entry") over an invented one. Rejected examples, for calibration: "Got a good ear for
music?", "Call all 18 and the money's yours", "surest bet", "dark horses", "your card".

## Design system + assets (match these)
The design system is extracted to `docs/design-system/` (also synced to Claude Design):
`tokens.css` + `ui.css` are the shared source of truth, loaded by all three surfaces.
Match the real tokens: dark purple-black (#0d0b16), green signal (#4bb749), purple accent
(#6d5fe0), DM Sans body + Space Mono for data/labels. For NEW UI, build/approve a visual
mockup first (mockup-first rule above). The original planning docs + approved mockups
(roadmap, audit, series/profile/homepage mockups, binary-poll spec, pre-deploy checklist,
load-test plan) live with the project and remain the reference for anything not yet built —
chiefly the A&R Wars tooling.
