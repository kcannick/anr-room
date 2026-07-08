# Build Spec — Mixed Rounds + Accuracy % / Absolute Grade

*Status: spec for a focused build session. Companion to `binary-poll-build-spec.md`
(which shipped) and the approved mockup `docs/mockups/anr-mixed-rounds-mockup.html`.
This makes poll type **per-round** instead of per-session, and replaces the rating-only
letter grade with a poll-type-agnostic **Accuracy %** + **absolute** grade. Additive —
pure-rating and pure-binary sessions stay a special case of the new mixed model and must
not regress.*

---

## 1. What this is

Today a session is locked to ONE poll type at creation (`sessions.poll_type`). This lets a
single room run **0–9 rating** and **binary (Versus A/B)** rounds side by side, chosen
**per round**. It also unifies the end-of-night readout so a mixed session has one coherent
recap.

**Locked design decisions (from the design session, 2026-07-08):**
- **Per-round poll type.** A new round defaults to the **previous round's** type; the host
  can switch it via a picker and the choice **persists** to the next round until changed.
  The room's creation type becomes the *first* round's default.
- **Accuracy %** — every prediction becomes a distance on a known scale, so it converts to
  `accuracy = max(0, 1 − error/scaleMax) × 100` (scaleMax = **9** rating, **100** binary),
  averaged over a player's rounds, **2-decimal** precision. This is a *display* metric;
  competitive **points** keep their existing curves unchanged.
- **Absolute grade** — the letter grade is an **absolute band of Accuracy %**, NOT a
  percentile curve. "If the sharpest read in the room is a B, it's a B." This lets players
  track progress across return visits. Bands are re-expressed from the existing
  `gradeForAvgError` thresholds so **pure-rating nights grade exactly as they do today.**
- **Rank/percentile stays** as the separate *"standing tonight"* signal (relative), distinct
  from the grade (absolute).
- **Separate Versus recap card**; **Top 8 Songs stays rating-only** (objective, rankable).
- **Hit/Miss binary sub-mode is DEFERRED** — ship Versus only; Hit/Miss is a later
  `rounds.binary_mode` add.

**Why per-round is a clean superset:** the storage layer was *already* built per-round
(rounds carry `option_b_title`/`option_b_artist`/`split_a`; votes carry both `taste`/`predict`
and `pick`/`predict_split`). Only the *flag* was session-scoped. This spec moves the flag to
the round and re-points the ~10 `isBinary = session.poll_type` derivations at the round.

---

## 2. Scoring & grading (the math)

**Points — unchanged.** `rankVotes` (rating) and `rankBinaryVotes` (binary) stay exactly as
they are. The resolver picks per **round** type instead of per session (§5).

**Accuracy % (new, display only).** Per ratified round a player voted in, with their absolute
prediction error `err` (already stored on the vote):
```
scaleMax        = 9   (rating round)  |  100 (binary round)
roundAccuracy   = max(0, 1 − err / scaleMax) × 100      // 0..100
sessionAccuracy = mean(roundAccuracy over the player's ratified rounds)   // 2-decimal
```
Note `mean(1 − err/9) = 1 − avgErr/9`, so for a pure-rating session `sessionAccuracy` is a
linear image of today's `avgErr` — the grade bands below reproduce today's grades exactly.
For a mixed session, each round contributes its own-scale accuracy and they average cleanly.

**Absolute grade (new mapping).** `gradeForAccuracy(acc)` — bands chosen to equal the current
`gradeForAvgError` at the rating scale (`acc = 100·(1 − avgErr/9)`):

| Grade | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F |
|-------|----|----|----|----|----|----|----|----|----|----|----|
| acc ≥ | 96.66 | 93.33 | 88.88 | 84.44 | 78.88 | 73.33 | 66.66 | 60.00 | 52.22 | 42.22 | else |

(Thresholds are `100·(1 − avgErr/9)` floored to 2 decimals so the old inclusive `≤` boundary
error-value lands in the better grade — verified equal to `gradeForAvgError` in the tests.)

- Grade is computed from the **rounded 2-dp** `sessionAccuracy` so display and grade never
  disagree (84.44% → B+).
- **No small-room suppression** — an absolute grade doesn't depend on the field size, so a
  five-person night grades normally and nobody gets a curved F.
- `gradeForAvgError` is **removed** (its bands are subsumed by `gradeForAccuracy`); the only
  caller is `buildRecap`.

**Per-type accuracy** (for the recap breakdown + the "up from B" progress framing): the same
mean, split into the player's rating rounds vs binary rounds (each `null` if they played none
of that type).

**Calibration note:** binary difficulty on the 0–100 scale is not proven equivalent to rating
difficulty on 0–9 — the accuracy numbers are mathematically unified but not difficulty-tuned.
Ship reasonable, tune on data (same discipline as `K_BIN`).

---

## 3. Schema changes

### rounds
Add one column — the round becomes the source of truth for poll type:
```sql
poll_type TEXT NOT NULL DEFAULT 'rating'   -- 'rating' | 'binary'  (per-round; was per-session)
```
`sessions.poll_type` is **kept** but demoted to "the default type for the FIRST round" + a
display hint. It is no longer authoritative once a round exists.

### Migration `024_round_poll_type.sql`
Additive + a single **set-based** backfill (bounded by row count of `rounds`, a small table;
NOT a per-user JS loop — safe as a light migration per the boot-path rule):
```sql
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS poll_type TEXT NOT NULL DEFAULT 'rating'
--->
UPDATE rounds SET poll_type = 'binary'
 WHERE session_id IN (SELECT id FROM sessions WHERE poll_type = 'binary')
```
Also add `poll_type` to the `rounds` block of the `SCHEMA` array in `db.js` (with the
`-- 'rating' | 'binary'` annotation) so fresh databases get it directly.

---

## 4. Scoring module (scoring.js)

Add alongside the existing functions (don't touch `rankVotes`/`rankBinaryVotes`):
```js
function roundAccuracy(err, scaleMax)      // max(0, 1 − err/scaleMax) * 100
function gradeForAccuracy(acc)             // the band table in §2; null only if acc == null
```
Export both. Remove `gradeForAvgError` from exports and the file once `buildRecap` is moved
over. Session-accuracy averaging lives in `buildRecap` (it needs the per-round scale), not in
scoring.js.

---

## 5. Server changes (server.js)

### Round creation — `POST /api/admin/round`
- Accept an optional `poll_type` in the body. Resolve the round's type as:
  `body.poll_type ∈ {rating,binary}` → else the **most recent round's** `poll_type` for this
  session → else `session.poll_type` → else `'rating'`. (Server-side default mirrors the
  client picker's "persist last type," so API callers behave too.)
- Validate `option_b_title` when the **round** is binary (not the session).
- Store `poll_type` in the INSERT. Keep writing `option_b_*` only for binary rounds.

### Vote — `POST /api/vote`
`activeRound()` already returns the full row, so use the **round's** type:
```js
const isBinary = (round.poll_type || session.poll_type) === 'binary';
```
The existing binary/rating validation + insert branches are unchanged below that line. (The
`session` lookup stays for `geo_mode`; `session.poll_type` is only a defensive fallback.)

### Ratify — `ratifyRound(round)`
Derive from the round: `const isBinary = (round.poll_type || <session fallback>) === 'binary'`.
Everything else (empty-round handling, `roomSplitA`/`rankBinaryVotes` vs
`roomAverage`/`rankVotes`, the poll-type-agnostic points rollup) is unchanged. Confirm callers
pass a round object carrying `poll_type` (they load the round row; `SELECT *` includes it).

### State payloads — player / admin / overlay
Each currently computes one session-level `isBinary` and stamps a session-level `poll_type`.
Change so the **current round** object carries its own `poll_type` (and `option_b_*` when
binary), and the client switches the widget on the **round**, not the session:
- **Player** (`/api/me/state`): put `poll_type` on the voting-round object and the
  results-round object (results already stamp it via the resolver). Keep a session-level
  `poll_type` as a hint only.
- **Admin** (`/api/admin/state`) and **Overlay** (`/api/overlay/state`): the live-round and
  ratified-round objects carry their own `poll_type`; the live split-preview seal stays gated
  on the round being binary + not-yet-ratified (unchanged rule, now per round).

### Recap — `buildRecap(participant)` (rework)
Replace the single-scale block:
- Pull the player's ratified rounds **with `r.poll_type`**. Compute `roundAccuracy` per round
  (scaleMax by type), then `sessionAccuracy` (2-dp) and `accuracyByType {rating, versus}`.
- `grade = gradeForAccuracy(sessionAccuracy)` — **always present** (drop the `grade = null`
  binary branch and the `gradeForAvgError` call).
- Drop the single `overallRoomAvg`/`overallSplitA` headline numbers (a mixed night has no one
  "room feel" number); per-type context lives in the breakdown + Versus card.
- Add `versusRounds[]` for the separate card **only when the session had binary rounds**:
  `{ idx, song_a, song_b, my_pick, my_split, actual_split_a, err }` per the player's binary
  rounds. Omit/empty on pure-rating nights.
- New recap shape: `{ name, accuracy, grade, accuracyByType, totalPoints, roundsPlayed,
  totalRounds, rank, fieldSize, percentile, bullseyes, best, versusRounds }`.

### Session type label
Derive a display label from the session's rounds: all rating → "Standard", all binary →
"Versus", both → **"Mixed"**. `sessions.poll_type` stays as the creation default only.

---

## 6. Admin UI (admin.html)

- **Round-type picker** on the create/manage-round card: a segmented **0–9 Rating · Versus**
  control. Its state (`roundType`) **defaults to the last round's type** on render and
  **persists** across adds until the host changes it (don't blow it away on `refresh()` unless
  the last round's type actually changed). The Song B fields + the A/B labels toggle on
  `roundType` — not on the session. `btnAddRound` sends `poll_type: roundType` and validates
  Song B when Versus.
- **Relabel (state-aware):** button = **"▶ Start Round"** when no round is live (opens
  immediately), **"+ Add Round"** when one is live (queues it). Section title
  "Add a song"/"Queue a song" → **"Start Round" / "Add Round"**. Rename "song" → "round"
  throughout this card (a Versus round is two songs).
- **Type chips per round:** queue rows, round history, and the live console show a
  `0–9` / `A/B` chip driven by **`r.poll_type`** (replacing the `!!option_b_title` sniff).
  The live-console `isBin` becomes per-current-round.
- Session-create: relabel the existing poll-type select to **"Starting round type"** (it seeds
  the first round's default). Session badge in the picker/list shows Standard / Versus /
  **Mixed** per the §5 label.

---

## 7. Player UI (play.html)

- **Per-round widget switch:** derive the live-vote widget from the **current round's**
  `poll_type` (`st.round.poll_type`), not the session-level `pollType`. The rating and binary
  flows already both exist and toggle via `isBin`; only the *source* of `isBin` changes. Reset
  on a fresh round already clears both.
- **Recap redesign** (build to the mockup): letter **grade hero** (from `accuracy`), a
  `▲ up from …` progress cue slot, the **Accuracy %** line + bar, the **per-type breakdown**
  (0–9 vs Versus), the stats grid (rounds, bullseyes, rank, percentile), and the **separate
  Versus card** rendered from `versusRounds[]` (only when present). Remove the
  binary-nulls-the-grade path and the "average A-share instead of grade" branch.

---

## 8. Export (server.js `/api/admin/export`)

A mixed session breaks the "one clean type per file" assumption. Move to a **union** shape:
- Add a `round_type` column to both the rounds table and the per-vote CSV/JSON rows.
- Rounds carry both `room_average` and `split_a` (each populated per the round's type; blank
  otherwise) plus both song-A and song-B fields.
- Vote rows carry both rating columns (`rating`, `prediction`, `room_average`) and binary
  columns (`pick`, `predict_split`, `split_a`), populated per the **round's** type, blank
  where N/A. `err`/`points`/`tier`/`rank` are shared (already type-agnostic).
- CSV header = the union; keep the anon/redact variants. A pure-type session still exports
  cleanly (the irrelevant columns are simply empty).

---

## 9. Tests

- **scoring.test.js:** `roundAccuracy` (rating scale 9, binary scale 100, the 0-floor, exact
  0-error → 100%); `gradeForAccuracy` band boundaries; an equivalence check that
  `gradeForAccuracy(100·(1−avgErr/9))` matches the old rating grades at representative points.
- **e2e.test.js — new MIXED session path:** create a session (default rating); add + open +
  vote + ratify a **rating** round; add a **binary** round via per-round `poll_type: 'binary'`
  (assert Song B required), vote (mix of picks/splits), ratify; assert both rounds resolve to
  the right result field; assert the recap returns one `accuracy`, an always-present `grade`,
  `accuracyByType` with both legs, and a `versusRounds[]` card; assert the **split stays sealed
  until ratify** on the binary round mid-session; assert the **export** carries `round_type`
  and the union columns with correct per-row population. Keep the existing single-type binary
  and rating e2e paths green (they're now the pure special cases).
- **migrate.test.js:** `024_round_poll_type` applies, `rounds.poll_type` exists and is
  idempotent, and the backfill sets a pre-existing binary session's rounds to `'binary'` while
  leaving rating sessions `'rating'`.

Target: full suite green (373 + the new cases).

---

## 10. Build order

Dependency order that keeps the suite green at each step:
1. **Schema + migration** (`023` + `db.js` SCHEMA). Migrate test.
2. **Scoring** (`roundAccuracy`, `gradeForAccuracy`; retire `gradeForAvgError`). Unit test.
3. **Server** (round-create per-round type + default resolution; vote/ratify/state from the
   round; `buildRecap` rework; session label). e2e mixed path.
4. **Admin UI** (round-type picker + persistence, Start/Add relabel, song→round, type chips).
5. **Player UI** (per-round widget switch, recap redesign to the mockup).
6. **Overlay** (per-round lower-third + reveal).
7. **Export** (union columns). Full suite green → deploy.

Steps 1–3 are the backend foundation (could ship as one patch); 4–7 the UI patch.

---

## 11. Risk / watch-items

- **#1 boot-path rule.** The backfill is a single set-based SQL `UPDATE` bounded by the small
  `rounds` table — NOT a per-user JS recompute. Safe as a light migration; do not turn it into
  a loop.
- **No regression to pure sessions.** Pure-rating and pure-binary are now special cases of
  mixed. The accuracy→grade bands are defined to reproduce today's rating grades exactly;
  verify the existing rating + binary e2e paths stay green untouched.
- **Sealed split is per-round.** The "never expose the A/B split until ratify" invariant now
  applies to each binary round inside a possibly-mixed session — re-verify in the mixed e2e
  that an open binary round mid-session never leaks `split_a`/`err`.
- **Every `isBinary` derivation must move to the round.** ~10 sites in server.js + 3 client
  globals. Missing one = a rating widget on a binary round (or vice versa). The mixed e2e +
  the per-round type chips are the guard.
- **Export consumers.** The union schema changes columns for downstream analysis — it's a
  host-facing export (low blast radius), but note it in the deploy patch.
- **Binary accuracy calibration** is prototype-tuned, not data-tuned (see §2). First mixed
  event is the calibration dataset.

---

## 12. Out of scope (explicitly deferred)

- **Hit/Miss binary sub-mode** (one song, Hit vs Miss verdict) — a later `rounds.binary_mode`
  add; the picker gains a third option then. Not in this build.
- **Cross-session accuracy trend** on the profile — the absolute grade makes this a natural
  next step (the recap's "▲ up from B" cue foreshadows it), but the history/store is a
  separate feature.
