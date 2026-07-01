# The A&R Room — System & Assumptions Audit

*Working document. Purpose: inventory what exists, what's planned, and the model — then
surface the buried assumptions that the original build made, so we can decide
deliberately what to refactor now (vs. what's portable and fine as-is). This is an
audit, not a teardown. A rebuild is a possible conclusion, not the starting premise.*

*Status columns to fill in together: **KEEP** (portable, no change) · **REFACTOR** (change
the implementation, keep the intent) · **RECONSIDER** (the decision itself may be wrong) ·
**CUT** (no longer wanted).*

---

## A. Built — what exists today (ground truth from the codebase)

*Source: `server.js` (36 endpoints), `db.js` + 9 migrations (11 tables), `public/*.html`.*

### Core loop
| Feature | Where | Notes | Status |
|---|---|---|---|
| Session lifecycle (create / status / config / end / delete) | `/api/admin/session/*` | upcoming → live → ended; soft-delete via `deleted_at` | |
| Round lifecycle (open / close / extend / reopen / move / edit / delete / ratify) | `/api/admin/round/*` | full host control; ratify is the results-reveal trigger | |
| Rating vote (taste 0–9 + predict 0–9) | `/api/vote` | the original mechanic | |
| Binary / Verzuz vote (pick A/B + predict split) | `/api/vote` (spec'd, migration 003) | session-level `poll_type` | |
| Scoring engine (exponential falloff + bonus/penalty/tiers) | `scoring.js` | rating live; binary spec'd | |
| Player state (the hot path) | `/api/me/state` | **polled every 2.5s**; ~6 DB queries/call | |
| Results / rank / winner reveal | in `playerState` + ratify | closest-guess, earliest-lock tiebreak | |

### Identity & auth
| Feature | Where | Notes | Status |
|---|---|---|---|
| Email OTP auth | `/api/auth/request` `/verify` | `otps`, `auth_tokens` tables | |
| Per-session participant join | `/api/join/request` `/verify` | `participants` table | |
| Persistent user accounts | `users` table + `owner_uid`/`user_id` (added later) | **see Assumption #1 — dual identity model** | |
| Name capture / edit | `/api/me/name` | | |
| Admin role | `participants.role` (migration 001) | | |

### Engagement & growth
| Feature | Where | Notes | Status |
|---|---|---|---|
| Referrals (ref_code, referred_by, credit) | migration 005 | | |
| SMS consent (phone = opt-in, server-derived) | migrations 001/002, consent columns | TCPA-shaped; hard-won design | |
| Geo check-in (mode/lat/lng/radius/label, distance) | migration 006, `/api/checkin` | **the location feature — see context** | |
| Beta feedback + screenshot | migration 008, `/api/feedback` | emails admin, logs to DB | |

### Broadcast / presentation
| Feature | Where | Notes | Status |
|---|---|---|---|
| OBS overlay (now-playing, winner, broadcast states) | `public/overlay.html`, `/api/overlay/state` | **polls every 2s** | |
| Broadcast overlay toggle + text | migrations 007/009 | live A/B split sealed until ratify | |
| Banners (upload / assign / delete / image serve) | `/api/admin/banner/*`, `banners` table | | |
| Lobby message / signup prompt / watch URL | migration 007 | | |
| Per-session config (venue, default ad, etc.) | `/api/admin/session/config` | | |

### Ops
| Feature | Where | Notes | Status |
|---|---|---|---|
| CSV/JSON export (+ anonymized) | `/api/admin/export` | | |
| Migration system (versioned, gated) | `db.js` + `migrate.js` | **just hardened post-Linq-Up** | |

---

## B. To-be-built — planned, specced, or scoped (not yet shipped)

| Feature | State | Notes | Status |
|---|---|---|---|
| Binary poll full build | spec'd (`binary-poll-build-spec.md`) | schema done; server/UI/export branches pending | |
| Push notifications | scoped, mapped to 3 trigger sites | iOS PWA-only coverage gap flagged | |
| Series layer (multi-session leaderboard → A&R Wars funnel) | designed (`series_id` tagging, live-compute) | the standalone-product funnel | |
| Scoring curve steepening | validated, **parked** pending dataset | | |
| Admin live→upcoming revert button | small, needed | console-fetch workaround today | |

---

## C. Current model — how it works / makes sense today

*To fill in together. Seed from what the code and prior sessions imply:*

- **Live-event voting game**, hosted at anr.makinitmag.com, run at watch parties / events.
- **Artists pay to submit** music for review; **viewer points stay walled off** from artist revenue (legal cleanliness).
- **Series → A&R Wars funnel**: points accumulate across tagged sessions → top scorers invited to a free-entry, skill-only cash competition.
- Relationship to **Hitmail**: shared rate+predict DNA; A&R Room is the live/event product, Hitmail the daily-habit product. *(Is A&R Room standalone, a funnel into Hitmail, or both? — open.)*

---

## D. Desired — what you want next (to fill in together)

*Empty by design. This is where the conversation goes.*

---

## E. Assumptions to examine — the point of the audit

*The buried decisions the original build baked in, surfaced for deliberate review. Each
is "examine," not "wrong" — the job is to decide consciously.*

**#1 — Dual identity model (`users` + `participants`).**
Schema shows an evolution from anonymous per-session `participants` toward persistent
`users` accounts (the later `owner_uid` / `user_id` columns). For a broad-web audience
with durable cross-event identity (series leaderboards, referrals, Hitmail bridge), which
is the spine — the account, or the participant? Right now it's half-and-half. This is the
highest-leverage thing to settle, because a lot hangs off it.

**#2 — Polling as the real-time transport.**
`/api/me/state` every 2.5s, overlay every 2s. Correct for the original "laptop on venue
WiFi" MVP; expensive on serverless and the ceiling for the 1,000-player goal (~400 req/s,
~2,400 queries/s sustained). Examine: SSE / pub-sub vs. cache-in-front-of-polling.

**#3 — Pure Vercel serverless as the deployment model.**
Per-invocation cost scales with polling; cold-start surface is what caused the Linq Up
504. Persistent connections (SSE) don't fit it cleanly. Examine: stay serverless + cache,
or add a small always-on real-time service.

**#4 — Recompute-everything read model.**
`playerState` recomputes 6 queries per poll per player, ~99% returning identical data.
No cache layer. Examine: cache the shared (per-session/round) portion; only per-player
data needs to be live.

**#5 — Connection pool ceiling (`max: 5`, no pooler).**
Neon connection limit is the hard wall at 1,000 concurrent. Examine: add a transaction-mode
pooler so instance count stops mapping 1:1 to DB connections.

**#6 — "Local scenario" was about geo, not deployment.**
*(Your correction, captured.)* The original local-laptop framing was really about the
unfinished location feature, not a deployment target. The true north star was always
broad web. This recontextualizes #2/#3: the web-scale path was always the goal, so the
real-time foundation is the legitimate thing to invest in now.

**#7 — One mechanic assumed (rating) → now two (rating + binary).**
Every read path branched on `poll_type`. Examine whether the abstraction is clean or
whether a third poll type later would force another round of branching — i.e. is "poll
type" the right seam, or should the round/vote model be more generic?

---

## F. Portable regardless of any rebuild decision

*The hard-won domain knowledge that must survive, whatever the foundation becomes. These
are KEEP by default:*

- Scoring math (curve, bonus/penalty, tiers) — `scoring.js`
- Overlay integrity rule (live A/B split sealed server-side until ratification)
- SMS consent design (server-derived from phone presence; client flags ignored; masked-echo rejection; withdrawal-retains-number)
- Heavy-migration-off-boot-path discipline (+ the hardened migration runner)
- Two-step Rate→Predict (and Pick→Read) UI flow + reset/engagement guards
- Tiebreak rule (closest guess; earliest lock wins ties)
- Artist-revenue ↔ viewer-points wall (legal posture)
- Series-as-display-metadata (tagging, live-compute, no rollup)
```

---

## G. Design note — Session delete / archive model (for the refactor pass)

*Captured from working session. Refactor-pass item, not an outage fix. Build mockup-first
per standing preference (the two-path dialog is exactly the kind of UI to see before building).*

### The decision

Collapse the redundant hide mechanisms (`status='archived'` and `deleted_at` both mean
"hidden") and make the everyday action safe, the destructive action deliberate. The user
is never blocked — always a path forward — but the *easy* path is safe and the
*destructive* path requires intention.

### Delete-flow decision tree

On Delete, check dependents, then branch:

- **No dependents** → delete immediately, no ceremony. (Test/demo sessions hit this —
  clean and instant. This is the common case for the experimental clutter.)
- **Dependents exist** → dialog with two paths:
  - **Archive instead** (recommended, one-click) — soft-delete; row + all data intact,
    recoverable, hidden from active views.
  - **Cascade delete** (type the session name to enable) — permanently removes the whole
    dependent tree. Irreversible.

### "Dependents" definition (decide precisely)

A session has dependents if it has **any votes OR any verified participants OR any
ratified rounds.** Empty rounds with no votes do NOT count — a session where rounds were
created but nobody voted is still a disposable demo. The check is for
*participant-generated data*, not any child row. (Otherwise clicking around making empty
rounds wrongly trips the heavy-confirmation path.)

### Dialog requirements

- Show **actual counts**: "This session has 23 participants and 87 votes" — not a generic
  "has dependents." The specific number makes archive the obvious choice and cascade
  appropriately weighty.
- Type-the-name confirmation: display the exact name ("Type **Blizm VS Smooth** to
  confirm"), case-sensitive exact match enables the destroy button. Show it (names can be
  long / odd characters) — don't make them remember it.

### Cascade implementation (the part that can bite)

- Delete in FK order: votes → rounds → participants → session-scoped banners → session row.
- **Wrap in a transaction** — all-or-nothing. A non-transactional cascade that fails
  mid-way leaves exactly the orphan inconsistency the whole model exists to prevent.

### Explicitly NOT supported: leave-orphan

Deleting a session while leaving its rounds/votes pointing at a missing `session_id` is a
*broken* delete, not a gentle one. It manufactures dangling references that every
consumer (series leaderboard join, participant history) must defensively handle and
currently doesn't. No real use case wants meaningless orphaned votes. Two intentions only:
**archive** (recoverable) or **cascade delete** (clean + complete). No third path.

### Series / leaderboard consideration

Cascade-deleting a session removes its votes, which **changes any series leaderboard or
A&R Wars qualification that summed them** (the series layer live-computes
`votes → rounds → sessions WHERE series_id`). This is probably acceptable (it's deleted,
shouldn't count) but should be a *conscious* decision, not a later surprise. The
type-the-name gate is part of what makes it acceptable — the operator is confirming they
understand the consequence.

### Storage context

Storage is a non-issue at current scale (~0.03/0.5 GB). Hard delete buys almost nothing
except a pristine table; archive is reversible and free. Recommendation: **archive is the
default for everything; hard delete (cascade) is the rare, intentional exception.** A bulk
"archive these" action in the admin UI serves the real workflow (make demos → clear them
after) better than hard delete, and barely needs the cascade path at all.
