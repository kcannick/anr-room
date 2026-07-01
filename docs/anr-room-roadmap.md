# The A&R Room — Outstanding Work Roadmap

*Consolidated from: the system audit (`anr-room-audit.md`), the product brief
(`anr-room-product-brief.md`), the binary-poll spec, prior series-layer design, and the
June 27–29 outage debugging session. Organized by priority tier, not strict sequence —
within a tier, order is yours to set. Each item notes type (ops / data / code / product),
and whether it's blocking.*

*Legend: 🔴 do now · 🟡 soon · 🟢 when ready · ⚪ horizon*

---

## TIER 0 — Stabilize (post-outage hygiene) 🔴

*The site is back up. These close out the incident cleanly so it can't recur or leave loose risk.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 0.1 | **Rotate the DB password** | ops | Exposed in plaintext during debugging (twice). Neon→Roles→reset; the Vercel integration auto-syncs the new value. |
| 0.2 | **Clear stuck `live` sessions** | data | `UPDATE sessions SET status='completed' WHERE status='live' AND deleted_at IS NULL;` — scope to active only; deleted-but-live rows are inert. |
| 0.3 | **Archive demo/test sessions** | data | Run the classification query (participants/votes per session), archive the disposable demos. Storage is a non-issue; archive, don't hard-delete. |
| 0.4 | **Confirm the deploy is the patched code** | ops | Verify production deployment hash = the postMigrate-fix commit, not a stale build. (The recurring "is it actually deployed" gap from the incident.) |

---

## TIER 1 — Prevent recurrence (the lessons, codified) 🔴🟡

*The outage exposed structural weaknesses. These make the failure class impossible rather than patched.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 1.1 | ~~Migrations as a deploy step~~ | code/ops | ✅ **SHIPPED** — safe `buildCommand` in `vercel.json` (guarded: only runs when `DATABASE_URL` is build-visible, else skips loudly + boot path handles it). `tier1-recurrence-prevention.patch`. |
| 1.2 | ~~Harden `ensureInit`~~ | code | ✅ **SHIPPED** — self-healing init (failed init no longer poisons the memoized promise). Most of this was already done by the postMigrate fix (advisory lock, loud-throw, heavy-gating); this closed the last gap. Same patch. |
| 1.3 | ~~Pre-deploy checklist~~ | ops | ✅ **WRITTEN** — `anr-pre-deploy-checklist.md`. The 60-second list + the danger-zone (boot-path-scaling-with-rows) detail. |
| 1.4 | ~~Load-test the signup burst~~ | ops | ✅ **PLANNED** — `anr-load-test-plan.md`. Reproduce the QR-burst shape before an event; tools + pass criteria. *Operator runs this once before the next sizable event.* |

---

## TIER 2 — The cruft refactor (dissolve accumulated scaffolding) 🟡

*Captured in audit §E/§F and the design discussions. Deliberate cleanup now that the product shape is known — NOT under incident pressure. The postMigrate outage fix is the first piece; these complete it.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 2.1 | ~~Dissolve `postMigrate`~~ | code | ⏸️ **DEFERRED (deliberately).** Already neutralized (runs only under `--run-heavy`, never on boot). Deleting throws away useful restore/fresh-env self-healing for zero gain. Revisit with the identity refactor (4.5). |
| 2.2 | **First-user-is-admin** | code | ⏭️ **Deferred → profile build (3.5b).** Touches the auth path the registration simplification rewrites — don't do it twice. |
| 2.3 | ~~Unique index on `users.email`~~ | data | ✅ **SHIPPED** — migration `010_users_email_unique.sql`, idempotent. |
| 2.4 | **Remove `signup_prompt`/`signup_answer`** | code | ⏭️ **Deferred → profile build (3.5b).** The profile fields subsume the custom-question hack. (The inert 0–9 scale conversion is also left as historical cruft — harmless, gated.) |
| 2.5 | ~~Soft-delete clears `live` status~~ | code | ✅ **SHIPPED** — delete now flips `live`→`completed`; no more contradictory deleted-but-live rows. |
| 2.6 | ~~Internal "roomtone" renames~~ | code | ✅ **SHIPPED** — `roomtone`→`anr-room` in package name + dev SQLite default. (Fewer survived than audited; email From-name was already clean.) |
| 2.7 | ~~Fix pre-existing test failures~~ | code | ✅ **SHIPPED** — was one missing `ADMIN_EMAIL` in test setup. **Suite now 242/0.** |

---

## TIER 3 — The product build (the standalone-product features) 🟢

*The features that turn the live engine into the monthly-competition product. Series is the keystone — most else depends on it.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 3.1 | **Series layer** | code/product | THE keystone build. Migration (`series` table + `series_id` on sessions + index), 6 endpoints (create/edit series, tag/untag session, leaderboard, qualification cut), admin tagging UI (mockup-first), light player/overlay surfacing. Live-computed leaderboard (no rollup). Includes the `bumpSeriesTally` recompute-on-ratify/tag cache design. |
| 3.2 | **Binary poll full build** | code | Spec complete (`binary-poll-build-spec.md`), prototype validated. Schema done; server/UI/export branches pending. Needed before first online A&R Wars. |
| 3.3 | ~~Session delete/archive model~~ | code/product | ✅ **SHIPPED + TESTED** (2026-06-30). All audit §G behavior was already built (soft-delete + auto-flip live→completed; dependents check = votes OR verified participants OR ratified rounds; two-path archive/cascade dialog with live counts; type-name gate; transactional FK-ordered cascade; restore). This pass closed the one orphan gap — purge now NULLs `feedback.session_id` instead of leaving it dangling (keeps the feedback, drops the ref) — and added 13 e2e tests locking the destructive path: non-admin 403, wrong-name 400, survives-failed-purge, orphan-free cascade (rounds/votes/participants/otps/banners), feedback-kept-ref-nulled, and live series-board recompute after purge. Suite 242→255. |
| 3.4 | **Live→upcoming admin button** | code | Small gap; console-fetch workaround today. |
| 3.5 | **Notify-on-go-live** | code | 🟡 **PHASE 0 SHIPPED** (2026-07-01) — host-controlled SMS (Twilio) + email fan-out. Going live opens a **confirm dialog with per-channel checkboxes (Email / SMS / Push-disabled)**; only checked channels send (`notify:{email,sms,push}` on `/session/status`; no object = send nothing). Audience = that session's verified participants (registration = consent basis for the go-live notice; SMS additionally gated on `sms_marketing_consent`). Idempotent + audited via `notification_log` (015); inline concurrency-limited + capped (800) fan-out — moves to a queued drain at larger scale. `sms.js` mirrors `email.js` (console stub → `SMS_PROVIDER=twilio` + `TWILIO_*`). **Web Push deferred** → gated on the PWA shell / branding pin. iOS covered by SMS/email meanwhile. |

---

## TIER 4 — Scale & real-time (the 1,000-person path) 🟢

*The polling ceiling that the event traffic exposed. **Decision made: stay on managed
services (Vercel + Ably), do NOT migrate to a self-run server.** Rationale: operator is a
marketing person who wants a tool, not infrastructure to babysit; $200/mo budget has
ample room for managed services. See Decision Record at bottom.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 4.1 | **Cache the shared `playerState`** | code | Session/round/count/ranked-votes are identical for every player. On serverless, cache via a managed store (Upstash Redis, free tier) — not in-process. ~80% DB-load cut. |
| 4.2 | **Neon pooler in front** | ops | Transaction-mode pooler (Neon's pooled connection string — already in use). Removes the connection-ceiling wall. Mostly a connection-string setting, not infra to run. |
| 4.3 | **Back off / smarten poll cadence** | code | 2.5s → 4–5s, or fast-when-round-open / slow-when-idle. Halves request volume cheaply. Reduces the need for 4.4 at small scale. |
| 4.4 | **Live push via Ably (managed)** | code/integration | 🟡 **PHASE 1 SHIPPED** (2026-07-01) — `realtime.js` (key-gated, no-op without `ABLY_API_KEY`; stateless REST, serverless-safe). Server publishes a `change` signal per session on every material mutation (round open/close/ratify/extend/reopen/edit, go-live, broadcast); `/api/ably/token` mints subscribe-only tokens (key never leaves the server). **All four clients wired** — play.html, overlay.html, admin.html (per-session), and home.html (keyed to the live session's channel, re-subscribes on change) subscribe and refresh instantly on push (~0.5–1.4s verified end-to-end against the live key), dropping their poll to a 15s heartbeat when connected and **auto-reverting to normal polling** if disabled/disconnected — zero regression. Vote-count pushes intentionally skipped (hot path). **Leaderboard-payload push SHIPPED** (2026-07-01): on ratify the server computes the public series board ONCE (`homeSeriesBoard()`, shared with `/api/home`) and pushes it as a payload; every connected homepage applies it directly via the shared `lbCard()` template — **verified 0 refetches** (board 125→250 in ~1s with `loadCalls:0`). So series-board compute is now independent of viewer count — the celebrity-scale lever is in place. (Optional future: same payload treatment for the overlay's session board — low value, it's ~1 client.) |
| 4.5 | **Resolve dual-identity model** | code/arch | Audit §E #1 — `users` vs `participants` as the spine. The **profile feature forces this** (profiles live on `users`). Decide as part of the profile build, toward user-as-spine. |
| 4.6 | **Proximity location filter (admin Users)** | code | "A&Rs within X miles of Atlanta, GA." Needs lat/lng stored on the profile (geocode the chosen city on save — the city autocomplete already hits OpenStreetMap, so capture coords there) + a haversine/bounding-box filter on `/api/admin/users`. Today's Location filter is a text match; this is the geo upgrade. Parked. |

*Dropped: the Vercel→Render migration. The cold-start fragility it would have fixed was a
code bug (the postMigrate recompute), now fixed + prevented via deploy-step migrations
(1.1). Managed real-time (Ably) delivers the live features with zero ops burden.*

---

## TIER 5 — Legal / compliance 🟢 (mostly cleared)

*Status updated: attorney has cleared the prize/legal concerns; A2P 10DLC registered with Twilio.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 5.1 | ~~Lawyer pass before sponsored cash Wars~~ | legal | ✅ **CLEARED** — attorney has reviewed. |
| 5.2 | ~~SMS / A2P 10DLC registration~~ | ops | ✅ **DONE** — registered with Twilio. |
| 5.2b | ~~Confirm no-checkbox SMS-marketing consent model~~ | legal | ✅ **CLEARED** (operator, 2026-06-30) — typed phone number = recurring SMS consent, disclosed via helper text, is blessed for marketing SMS. No checkbox required. |
| 5.3 | **Keep the integrity wall enforced** | product | Artist placement $ ↔ viewer points never touch. Standing principle. |

---

## TIER 6 — Horizon (Hitmail & beyond) ⚪

*Explicitly downstream. A proven A&R Room justifies these; not dependencies of it.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 6.1 | **Sanctioned bonus-round network** | product | The largest growth lever (multi-tenant thesis). Rides on series + a sanctioning standard. After the single-operator loop is proven. |
| 6.2 | **Scoring curve steepening** | code | Parked pending a larger dataset. Both rating + binary curves are "ship reasonable, tune on data." |
| 6.4 | **A&R Wars tournament (bracket layer)** | product/code | **Format (operator, 2026-07-01):** online **single-elimination** tournament, **8 competitors** = curated mix (e.g. top 4 A&Rs from the month's series board + 4 invited Tastemakers — partly seeded, partly hand-picked; NOT a pure auto-seed). Competitors scout songs from a given **"service pack"** (zip) and play their picks head-to-head. Each matchup = a **binary (Versus) poll round** (Song A vs Song B); the **A&R Room audience votes**, majority side wins, winner advances. 8→4→2→1 = 7 matchups / 3 rounds. **Competitors are NOT session participants** — the regular audience does the voting. **What exists:** binary A/B voting + majority-winner (Versus). **New work (optional polish):** 8-competitor roster (seed top-4 from the board + add 4 Tastemakers), visual bracket + auto-advance the vote-winner, bracket display on the overlay. **Resolved (operator):** the service-pack zip + competitors' song-picks happen **outside the app** (host just enters the two songs per matchup — the existing binary "Queue a matchup" flow); viewers **earn points that count toward the current month's series**, so the Wars session is just **tagged into the active series** like any other. **Core is runnable TODAY** with binary Versus + series tagging; the bracket layer is UX/clarity, not required to run the first event. |
| 6.5 | **Celebrity invite-only sessions for top A&Rs** | product | Incentive lever: the top-N A&Rs in a month earn an invite to an exclusive, invite-gated listening session with a celebrity artist (e.g., "Top 50 this month → private session with [artist]"). Rides directly on the series leaderboard (qualifiers already computed) + the block/invite plumbing; a session would need an "invite-only" gate keyed to the series' top-N. Strong participation driver — parked for the horizon. |
| 6.3 | **Hitmail** | product | ✅ **Parked, 6+ months out, confirmed no rush.** Learning-mode: A&R Room teaches the model first. Separate, later bet. Not a dependency. |

---

## TIER 3.5 — Profile & liveness cluster (designed this session) 🟢

*New feature cluster, mockups built and refined. Three coupled features sharing the player
surface. Forces the dual-identity decision (4.5) toward user-as-spine.*

| # | Item | Type | Notes |
|---|------|------|-------|
| 3.5a | **User profiles** | code/product | Public (display name, photo, primary + all categories, location, IG, TikTok) / private (email, phone, notify opt-in). Two-step category (select-all → most-focused-on). Photo = fast-follow with managed object storage. |
| 3.5b | **Registration simplification** | code | Display Name (required, non-unique) + Phone (optional, typed = opt-in, disclosed helper text). Remove `signup_prompt`/`signup_answer`; host messaging → existing message fields. |
| 3.5c | **Qualification gate** | product | Complete profile → eligible for leaderboard, prizes, A&R Wars. Incomplete → play/vote only, not ranked. Doubles as prize-payout KYC. Prompted via dismissible dead-time modal. |
| 3.5d | **Liveness layer** | code | Join feed ("DJ Chain just joined", display-name-gated), participant + vote counters. Vote *count* only — room lean stays sealed until results. Wants Ably (4.4) for true real-time; works on polling first. |
| 3.5e | **Public homepage** | code/product | `anr.makinitmag.com` root becomes a real front door (currently drops into nothing — voting needs a session param). Single-page scroll, nav = section anchors. Session-aware, data-driven (self-updates from DB). **Between-sessions:** hero ("Got an ear for music?" + $500 hook), how-it-works, next session (with **Register** button — the real conversion, not "remind me"), live series leaderboard, past winners, submit→Service Pack. **Live:** red "Live right now" banner, screenshot of YouTube stream + watch-on-YouTube links (no embed here), "get in to vote." Needs one new public no-auth endpoint (public-safe session list + live leaderboard + winners). Mockups done (`anr-homepage-mockups.html`). |
| 3.5f | **Voting-page stream embed** | code | YouTube embed at top of voting page, **tap-to-start, never autoplay**. Makes the app self-sufficient on a single device (watch + vote in one place, no app-switching, no interrupted playback). Second-screen / already-listening users leave it un-tapped — ignorable, not forced. Placement: sticky-but-collapsible (lean). Tap-to-start is also the only reliable mobile behavior (autoplay-with-sound is blocked), so it's native, not a fight. *Not* a second-screen-only special case — it's the default single-device experience. |

---

## Decision Record

*Key calls made, with rationale, so they're not re-litigated.*

- **Infrastructure: stay managed (Vercel + Ably), do NOT self-host (Render).** Operator is
  a marketing person who wants a tool, not infrastructure to babysit. $200/mo budget has
  ample headroom for managed services (~$0–20 today, ~$138 all-in at 1,000 concurrent).
  The ~$60/mo saved by self-hosting isn't worth the operational burden. Cold-start
  fragility (the outage) was a code bug, now fixed — not an inherent serverless problem.
- **Real-time via Ably**, not SSE-on-a-server. Managed, nothing to run, free at current
  scale.
- **Profiles live on `users`** (resolves dual-identity toward user-as-spine).
- **Display names non-unique** — disambiguated by photo/location/socials, not enforced.
- **Public homepage = single-page scroll, session-aware, data-driven.** Root becomes a
  real front door (was dropping into nothing). "Register" not "remind me" on the next
  session — capture the contact at peak intent.
- **Voting page keeps the YouTube embed (tap-to-start, never autoplay).** The game is
  *playable on one device* by default — the embed makes watch + vote self-sufficient on a
  single screen. Second-screen is a real pattern but NOT universal; dropping the embed
  would force a second device as a requirement for everyone but live-event attendees.
  Tap-to-start serves both: single-screen taps it, second-screen/already-listening leaves
  it un-tapped (no competing audio). Homepage live block uses a screenshot + links (not an
  embed) since you don't vote there.
- **No stream embed beyond the voting page.** Watch-along formats (Grammys/Verzuz-style
  co-located events) are a possible per-event special case, not a v1 default.
- **Delete model:** archive default; cascade delete with type-name confirm; no orphan
  path (audit §G).
- **Admin:** first account created is admin (matches install flow); remove `ADMIN_EMAIL`.
- **Budget ceiling: $200/mo additional.** All current plans fit with large headroom.

---

## Suggested near-term sequence

1. **Tier 0** — close out the incident (today/this week): rotate password, clear stuck
   sessions, archive demos, confirm deploy.
2. **Tier 1.1 + 1.2** — deploy-step migrations + hardened init, so the outage class is
   dead. (Stays on Vercel — no migration needed.)
3. **Tier 2** — the cruft refactor as one deliberate pass (read the audit on the flight first).
4. **Tier 3.1 (Series)** — the keystone product build; everything competitive depends on it.
5. **Tier 3.5 (Profiles + liveness + homepage)** — mockups done; build the cluster.
   Resolves the identity model (4.5) along the way. The public homepage (3.5e) and
   voting-page embed (3.5f) can ship independently of profiles if you want a quick win.
6. **Tier 4.1 + 4.4** — managed cache (Upstash) + Ably for live push, added when liveness
   needs real-time. No infrastructure to run.
7. Then Tier 3.2 (binary), 3.3 (delete model), and the rest as the calendar and the first
   monthly A&R Wars dictate.

*No server migration in this plan — everything stays on managed services within the
$200/mo budget. The only "big" decision left is the dual-identity model (4.5), which the
profile build forces you to settle.*
EOF
