# Build Spec — Binary Poll Type ("Verzuz" mode)

*Status: spec for a focused build session. Prototype validated. Source-of-truth for the
implementation. Companion to the existing 0–9 rating mechanic — this adds a SECOND
poll type, not a replacement.*

---

## 1. What this is

A second poll type for The A&R Room, for head-to-head events (Verzuz watch parties).
Each round pits **Song A vs Song B**. Players pick a side, then predict how the *room*
will split between the two, and score on how close their predicted split is to the
actual room split. Same emotional loop as the rating game ("read the room"), new shape.

**Validated design decisions (locked):**
- **Session-level poll type.** A session is *either* a `rating` session (the existing
  0–9 game) *or* a `binary` session (Verzuz), set once at creation. Rounds inherit it.
  No mixing types within a session.
- **Pure read-the-room scoring.** Only the predicted split earns points. Picking a side
  is *required* (it's the engagement + the A/B tally input) but is **not** itself scored.
- **Split reads A% on the left, B% on the right**, always summing to 100.
- **Two-step flow:** ① Pick a side → Next → ② Read the Room! (dial the split) → Lock.
  Mirrors the rating game's Rate → Predict flow exactly (same muscle memory).

**Why session-level (not per-round):** simpler everywhere (one flag on the session, UI
branches once, clean single-type exports), and it matches how Verzuz actually works (the
whole night is A-vs-B). Upgrading to per-round later is a clean superset if ever needed —
this choice doesn't paint us into a corner.

---

## 2. Scoring (the math)

The existing scoring philosophy transfers directly. A binary split is **one number**
(A's %, since B = 100 − A). So "predict the split" is the same shape as "predict the
average" — a single value scored on distance from the actual. We reuse the exponential
falloff, re-tuned for a 0–100 scale instead of 0–9.

**Actual room split:** of all locked votes in the round, the percentage that picked A.
`actual_A = round( 100 * (votes_for_A / total_votes) )`.

**Player error:** `error = |predicted_A − actual_A|` (in percentage points, 0–100).

**Points:** same curve family as `scoring.js`, new constants:
```
base   = 100 * e^(-error * K_BIN)        K_BIN ≈ 0.035  (tuned in prototype)
bonus  = +25 when error <= BULLSEYE_BIN  (BULLSEYE_BIN ≈ 3 points)
penalty= -10 when error  > FAR_BIN       (FAR_BIN ≈ 35 points)
points = max(0, round(base + bonus - penalty))
```
Tiers (for the results reaction), by error in points:
`<=3 bullseye · <=8 sharp · <=18 close · <=30 off · else wayoff`

These constants are the binary analog of the rating game's `K=0.5 / BULLSEYE=0.1 /
FAR=5.0`. **Tune against real event data later**, exactly as we're doing with the rating
curve — ship with the prototype values, refine once a Verzuz night produces a dataset.

**Edge cases:**
- A round with 0 votes resolves to no scores (skip, like an empty rating round).
- A unanimous room (everyone picks A → actual_A = 100) still scores normally; predicting
  100 = bullseye.
- Ties (50/50) are fine — they're just `actual_A = 50`.

---

## 3. Schema changes

### sessions
Add one column:
```sql
poll_type TEXT NOT NULL DEFAULT 'rating'   -- 'rating' | 'binary'
```

### rounds
A binary round needs two options instead of one song. Add:
```sql
option_b_title  TEXT          -- Song B title (Song A reuses existing song_title)
option_b_artist TEXT          -- Song B artist (Song A reuses existing song_artist)
split_a REAL                  -- resolved: actual % that picked A (null until ratified)
```
Reuse `song_title` / `song_artist` for **Song A** (no new columns needed for A). For a
rating round these new columns stay null — harmless.

### votes
A binary vote needs the pick + the predicted split. Add:
```sql
pick TEXT          -- 'A' | 'B' (which side the player chose); null for rating votes
predict_split REAL -- predicted % for A, 0..100; null for rating votes
```
Keep `taste` / `predict` as-is for rating votes. A binary vote leaves `taste`/`predict`
null and fills `pick`/`predict_split`. (Alternative considered: overload `predict` to
hold the split. Rejected — separate columns keep the two mechanics legible in the data
and the export clean.)

### Migration
New numbered migration `003_binary_poll.sql` — pure `ADD COLUMN IF NOT EXISTS`, all
additive, no data conversion. **Light/fast — runs safely on boot** (no heavy-conversion
guard needed; nothing to recompute). Statements separated by `--->` per the runner's
convention.
```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS poll_type TEXT NOT NULL DEFAULT 'rating'
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS option_b_title TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS option_b_artist TEXT
--->
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS split_a REAL
--->
ALTER TABLE votes ADD COLUMN IF NOT EXISTS pick TEXT
--->
ALTER TABLE votes ADD COLUMN IF NOT EXISTS predict_split REAL
```
Also add the three new columns to the `SCHEMA` array in `db.js` so fresh databases get
them directly (with the `-- comment` annotations, matching the existing style).

---

## 4. Scoring module (scoring.js)

Add binary functions alongside the existing rating ones (don't modify the rating
functions). New exports:
```js
function roomSplitA(votes)           // % of votes with pick==='A', rounded 0..100
function splitPoints(predictSplit, actualA)   // the e^(-error*K_BIN) curve + bonus/penalty
function splitTier(error)            // bullseye|sharp|close|off|wayoff for 0..100 scale
function rankBinaryVotes(votes, actualA)  // sets points/err/tier/rank on each binary vote
```
Plus constants `K_BIN`, `BULLSEYE_BIN`, `FAR_BIN`, `BONUS` (reuse), `PENALTY` (reuse).

The resolver picks `rankVotes` (rating) or `rankBinaryVotes` (binary) based on the
session's `poll_type`.

---

## 5. Server changes (server.js)

### Session creation
`/api/admin/session/create` (or wherever sessions are made) accepts an optional
`pollType` ('rating' default | 'binary'), stored on the session.

### Round creation
The round-create endpoint, when the session is binary, accepts and stores
`optionBTitle` / `optionBArtist` (Song A still uses the existing `songTitle`/`songArtist`
fields). Validation: binary rounds require both A and B titles.

### Vote endpoint (`/api/vote`)
Branch on the session's poll type:
- **rating** (unchanged): validate `taste` 0–9, `predict` 0–9.
- **binary**: validate `pick` ∈ {'A','B'} and `predict_split` 0–100 (number). Store both;
  leave taste/predict null.

Reject a binary-shaped vote on a rating session and vice versa (clear error message).

### Resolution (`/api/admin/round/ratify`)
Branch on poll type:
- **rating** (unchanged): compute `room_average`, call `rankVotes`.
- **binary**: compute `actual_A = roomSplitA(votes)`, store on `rounds.split_a`, call
  `rankBinaryVotes`, write points/err/tier/rank to each vote. Roll up `total_points` /
  `lifetime_points` / `rounds_voted` exactly as the rating path does (that rollup is
  poll-type-agnostic — it just sums vote points — so it needs no change).

### State endpoint (`/api/me/state` or equivalent)
Include `poll_type` and, for a binary round, `option_b_title`/`option_b_artist` (and Song
A from existing fields) so the player UI knows which widget to render and what to label
the two sides. On resolution, include `split_a` and the player's own pick + predicted
split for the results screen.

---

## 6. Admin UI (admin.html)

- **Session creation:** a poll-type toggle (Rating · Binary) when making a session. Show
  the chosen type as a badge on the session in the picker/list so the host always knows
  which kind they're running.
- **Round entry (binary sessions):** the round form shows **two** song fields — "Song A
  (title / artist)" and "Song B (title / artist)" — instead of the single song field.
  For rating sessions the form is unchanged.
- **Live console / tally:** the "tally the room" / results view shows the A/B split
  (e.g. "Song A 62% · Song B 38%") instead of an average. Reuse the existing
  ratify/results flow; just swap what's displayed.
- Everything else (round lifecycle, open/close, queue, timers) is **identical** — binary
  changes only what a "song" is and what "the result" looks like, not how rounds run.

---

## 7. Player UI (play.html)

The voting screen branches on `poll_type`. Build the binary widget to mirror the
two-step rating flow (already shipped), reusing its structure:

**Step ① Pick a side** (analog of Rate):
- Big "① Pick a side" header + help ("Which one are you riding with?").
- Two big option buttons: Song A (title + artist) and Song B. Tapping selects (visual
  on-state). The validated prototype styling: a lettered circle (A/B) + title + artist.
- **Next →** button, disabled until a side is picked.

**Step ② Read the Room!** (analog of Predict):
- Big "② Read the Room!" header + help ("Predict how the room will split between the two").
- The split slider: 0–100, shows `A __%` (left) and `__% B` (right) live, with a
  proportional bar. Starts unset (shows "–") and requires a touch before Lock enables —
  same engagement guard as the rating slider.
- **Lock it in** (full-width primary) stacked above **← Back** (ghost) — the same
  stacked-button layout we fixed for the rating flow (no side-by-side overflow).
- Back preserves the pick; forward preserves the slider position.

**Results screen (binary):** show the actual A/B split bar, the player's own predicted
split, error in points, and points earned + tier — the prototype's reveal layout. The
existing rating results screen stays for rating sessions.

**Reset on fresh round:** clear pick + split, return to step ①, disable Next/Lock — same
as the rating reset.

**The prototype** (`verzuz_binary_poll_prototype`, validated this session) is the
reference for layout, slider behavior, and the reveal — port its structure into
play.html's real styling/state system.

---

## 8. Export

The CSV/JSON export gains binary columns. For a binary session's votes, emit `pick`,
`predict_split`, the round's `split_a`, and the existing `points`/`err`/`tier`/`rank`
(which work identically). Because poll type is per-session, each export file is a single
clean type — no mixed-column mess. Keep the anonymized variant logic unchanged.

---

## 9. Tests

- **scoring.test.js:** add cases for `roomSplitA` (various A/B mixes, unanimous, tie,
  empty), `splitPoints` (bullseye, mid, far, the 0-floor), `splitTier`, and
  `rankBinaryVotes` (ranking + tier assignment).
- **e2e.test.js:** add a binary-session path — create a binary session, create a round
  with A/B options, cast binary votes (mix of picks + splits), ratify, assert `split_a`
  is computed correctly and points are scored. Mirror the existing rating e2e flow.
- **migrate.test.js:** assert `003_binary_poll` applies and the new columns exist; assert
  it's idempotent.

Target: keep the suite fully green (current 171 + the new binary cases).

---

## 10. Build order (for the focused session)

A clean dependency order that keeps the suite green at each step:

1. **Schema + migration** (`003_binary_poll.sql` + `db.js` SCHEMA additions). Verify
   migrate test.
2. **Scoring** (`scoring.js` binary functions + constants). Unit-test in isolation.
3. **Server** (vote validation branch, round-create A/B, ratify branch, state payload).
   e2e binary path.
4. **Player UI** (`play.html` binary widget, porting the prototype). Compile + visual.
5. **Admin UI** (`admin.html` poll-type toggle, A/B round entry, split tally).
6. **Export** (binary columns).
7. Full suite green → patch(es) → deploy.

Each step is independently testable; steps 1–3 are the backend foundation and could ship
as one patch, 4–6 as the UI patch, if splitting delivery.

---

## 11. Risk / watch-items

- **Two mechanics = more branching.** Every place that assumes "a round has a rating and
  an average" now has a binary counterpart. The session-level flag keeps branches to one
  decision point each (poll_type), but the resolver, vote endpoint, state payload, player
  UI, and export each need their branch. Don't miss one — the test matrix above is the
  guard.
- **Don't regress the rating game.** All rating-path code stays untouched; binary is
  additive. The e2e suite for rating must stay green throughout.
- **Scoring constants are placeholders.** `K_BIN` etc. are prototype-tuned, not
  data-tuned. Treat the first Verzuz event as the calibration dataset, same discipline as
  the rating curve (which is parked pending data).
- **Curve steepening (rating) is still parked** — unrelated, but note both curves are
  "ship reasonable, tune on data."

---

## 12. SHORTEST PATH if a Verzuz event is needed BEFORE this is built

If time pressure forces a binary event before the full build lands, options in order of
preference:

1. **Run it on the rating game as-is**, reframed: "rate Song A 0–9" in one round, "rate
   Song B 0–9" in the next, highest average wins the matchup. Crude (no split prediction)
   but zero build, uses what's live today.
2. **Backend-first slice:** build steps 1–3 (schema, scoring, server) + a minimal binary
   player widget (skip the polished reveal, admin toggle via direct value) — a rough but
   functional binary round. Faster than the full spec, rougher UX.
3. **Full build** per this spec — best experience, most work.

Recommend deciding which the moment a date is set. If the event is more than a build
session away, do the full thing; if it's imminent, option 1 buys time without risk.
