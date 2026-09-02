# Build Spec — A&R Wars side contest ("the sidebet")

*Status: spec, not built. Landing page at `anr.makinitmag.com/sidebet`. Companion to the
binary-poll spec — this contest is scored off the Versus rounds that A&R Wars already runs,
and adds no new poll type.*

---

## 1. What this is

A free-entry prediction contest that runs alongside A&R Wars, for a **sponsor-funded cash
prize** ($150 at launch).

An entrant predicts **which 18 records from the monthly A&R Service Pack will actually be
played** at A&R Wars, and puts them in order. Entries close before the show. After the show,
the entry that predicted the most of the real 18 wins.

It is **not** a rating contest. Nothing about the room's scores, averages, or opinions enters
the result — the truth is set membership: was this record played, yes or no. That makes it
exactly computable, independent of how the room reacts, and immune to a thin room or an
unplayed song skewing anything.

**The second job this does is seed the user base.** An entrant becomes a `users` row with no
`participants` row — a real, durable, verified account that has never played a session. They
arrive for a $150 prize and land in the contactable audience for every room after it.

---

## 2. Why 18

The A&R Wars bracket is 8 competitors, single elimination, every matchup a binary poll:

| Stage | Matchups | Songs |
|---|---|---|
| Round 1 | 4 | 8 |
| Semifinals | 2 | 4 |
| Final (3 separate polls, 3 songs per finalist) | 3 | 6 |
| **Total** | **9 polls** | **18 songs** |

Every song in the tournament enters through a two-song binary round, and 9 × 2 = 18 exactly.

**18 is stored as `packs.picks_required`, not hardcoded.** It is derived from the bracket
shape (competitor count + final length); either changing moves it. One config value keeps the
screens, the rules copy and the scoring from ever disagreeing about what a complete entry is.

---

## 3. How the winner is determined

### 3.1 The truth set

The 18 pack songs marked `played = 1`. Settle refuses to run unless exactly
`picks_required` songs are marked — a miscount silently produces a wrong winner, so it fails
loudly instead.

### 3.2 The consensus ranking (the tiebreak axis)

The 18 played songs, ordered by **how many entrants predicted them** — most-predicted first.
Counted across every entry in the pack, at any position.

Ties in the count are broken by **`pack_songs.row_no`, the CSV row order** — deterministic,
fixed before a single entry exists, and unarguable after the fact. Without this the metric is
not reproducible, and it decides cash.

### 3.3 The chain

1. **Most correct** — how many of your 18 were actually played. Highest wins.
2. **Order distance** — Spearman footrule: for each of your correct picks, the absolute gap
   between your position and its consensus position; summed. **Lowest wins.** Only ever
   compares entries with the same correct count, so the sums are always like-for-like.
3. **Earliest** — the timestamp of the list that actually competed (see 6.3).

Rules-page phrasing (operator's voice — plain and direct, no slang):
*"The person with the most right selections wins. If two people get the same number right,
we compare the order they put their songs in. Closest order wins."*

**DECIDED (operator, 2026-08-30): most correct wins** — not all 18. Picking 18 of 60 exactly
is long odds, so most months will have nobody with a perfect entry; perfect-or-nothing would
leave the prize unpaid and read as unwinnable within a few months.

---

## 4. Sealed quantities

**Pick counts are sealed until the pack is settled.** The consensus ranking is built from the
entries themselves, so exposing a running "most popular picks" makes mirroring the crowd the
dominant strategy — it maximizes your correct count *and* nails the tiebreak. Everyone
converges on one list, every entry ties, and the contest decays into a timestamp race.

This is the same posture as the live vote split, and it forbids the same class of feature: no
popularity teaser, no "you and 340 others picked this," no aggregate anything on the entry
page or in any email before settle. Enforce server-side, not just in the UI.

The **returning-entrant view shows the entrant their own list and nothing about anyone
else's.** There is no live standing to show — the truth set does not exist until the show is
over — so this is a state readout, not a leaderboard.

---

## 5. Data model

New tables. Nothing is added to `votes`, and the series board is untouched — this contest
awards no points and never appears on the $500 board.

```
packs (
  id, name, slug UNIQUE,            -- name = "September 2026 A&R Service Pack"
  picks_required INTEGER NOT NULL DEFAULT 18,
  download_url, prize_text, sponsor_text,
  banner_id,                        -- FK banners.id — the sponsor banner; null = no slot
  wars_at BIGINT NOT NULL,          -- tournament date/time, ET — shown on the page
  closes_at BIGINT NOT NULL,        -- entries freeze; must be < wars_at
  session_id,                       -- the A&R Wars room; linked when it exists, null before
  opens_at,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | open | closed | settled
  settled_at, created_at
)

pack_songs (
  id, pack_id NOT NULL,
  row_no INTEGER NOT NULL,          -- CSV order; the consensus tiebreak
  title NOT NULL, artist,
  played INTEGER NOT NULL DEFAULT 0,
  UNIQUE (pack_id, row_no)
)

sidebet_entries (
  id, pack_id NOT NULL, user_id NOT NULL,   -- users.uid
  entry_no INTEGER,                 -- the "#0147" on the confirmation screen
  first_submitted_at, updated_at BIGINT NOT NULL,
  correct, distance, rank,          -- null until settle
  UNIQUE (pack_id, user_id)         -- one entry per person per pack
)

sidebet_picks (
  entry_id NOT NULL, pack_song_id NOT NULL,
  position INTEGER NOT NULL,        -- 1..picks_required
  PRIMARY KEY (entry_id, pack_song_id)
)
```

Plus two additive columns on `rounds` for the derivation in §8:
`pack_song_a`, `pack_song_b` (nullable; a binary round's two songs, when queued from a pack).

`UNIQUE (pack_id, user_id)` is what makes "one entry per person" real rather than a promise in
the rules — and it is why identity has to be verified before an entry is written.

---

## 6. Entry flow

Six screens, phone-first. Mockup: `public/_mock-sidebet.html`.

1. **The offer** — $150, the sponsor, and the method stated up front (a cash prize needs the
   rules before entry, not after).
2. **The pack** — download link, as a fork rather than a gate. Nobody who already knows the
   pack gets blocked, and the requirement is unenforceable anyway.
3. **Pick 18** — filterable alphabetical checklist. At 40–100 songs this beats autocomplete:
   the entrant is scanning a list they half-remember, and a box that hides everything until
   you type makes recall harder. At `picks_required` the unpicked rows **dim rather than
   disappear**, so swapping stays possible.
4. **Order them** — arrives **pre-ordered by pick order**, so every entry has a ranking even
   from someone who taps straight through. Otherwise the tiebreak cannot separate two people
   who both skipped it. Arrows are the real control; drag is unreliable on mobile Safari
   inside a scroll container.
5. **Identify** — first name, last name, email, phone. Then an emailed OTP.
6. **Locked in** — recap, deadline, and the YouTube subscribe ask.

### 6.1 Why the form is last

The entrant has already spent real effort on 18 picks, so the form reads as the cost of
keeping work they've done rather than a toll before they see anything.

### 6.2 Identity

**Email OTP, reusing `/api/auth/request` + `/api/auth/verify` verbatim.** Phone is collected
but not verified.

Email is the unique key on `users` and therefore the thing an entry attaches to; verifying a
phone instead would prove the wrong fact and let someone claim any email. A phone-OTP path
does not exist in this codebase today (`sms.js` is send-only) and would add a new code scope,
new rate limiting, and per-entry Twilio cost to verify something the entry does not key on.

An existing account is matched by email and the entry attaches to that `uid` — silently, with
no "you already have an account" interruption. A new entrant gets a `users` row and **no
`participants` row**.

**Picks are held client-side until the code verifies.** People who bail at the form leave no
half-entries.

**Consent:** the SMS box is its own unchecked checkbox with its own wording, separate
from the `room_live` topic. The room-live email subscribe follows the 028
registration pattern and is checked by default.

### 6.3 Editing

Editable until `closes_at`, then frozen. Returning to `/sidebet` loads the list back.

**The final tiebreak is `updated_at`, not first submission** — the timestamp of the list that
actually competed. First-submission would hand out a free option: enter a throwaway entry
early, rewrite it at the deadline, keep the early timestamp. The confirmation-screen copy
should say "earliest final entry," not "earliest entry."

---

## 7. Admin

Mockup: `public/_mock-sidebet-admin.html` (real console chrome — drops into `admin.html` as a
screen).

### 7.1 Creating an iteration

Operator-facing fields, in order: **service pack title · number of songs to predict ·
download link · A&R Wars tournament date · cut-off to submit/edit picks**, plus **prize** and
**sponsor line** (the landing page prints both, so they cannot be hardcoded against a sponsor
change).

- **`closes_at` must be earlier than `wars_at`.** Enforced in the form *and* server-side.
  Entries editable after the first song plays would let someone submit a list they already
  know the answer to.
- **`wars_at` and `session_id` are separate.** The date is what the page tells people to tune
  in for and exists from creation; the room link is only needed at settle and often does not
  exist yet when the iteration opens.
- **Only one pack may be `open` at a time.** `/sidebet` has to resolve to a single pack
  without asking; opening a second is refused rather than silently shadowing the first.
- `picks_required` is per iteration — a past month ran 14.

### 7.2 The sponsor banner

`packs.banner_id` points at the **existing `banners` table** — same library, same uploader,
same `/api/banner/image` route and `link_url` click-through as a room banner. No new table, no
second image path, no new storage.

Rendered on **every screen of the entry flow**, using play.html's `.ad-slot` treatment
(full-width, `max-height:120px`, `object-fit:contain`, whole slot hidden when unset). Every
screen matches the room's own ad slot, which renders in every phase because banner ads fund
the show. On the pick and order screens it sits below the list so it never competes with the
task.

**No fallback to the global house banner.** A room's banner cascade ends at the global default,
but this page says "courtesy of our sponsor" — putting an unrelated advertiser under that line
would be a false claim. Unset means no slot at all.

### 7.3 Loading the songs

**CSV upload**, columns `title, artist`, header row optional. Row order becomes `row_no` and
is the consensus tiebreak (§3.2), so the loader shows row numbers and says on screen that the
order is load-bearing.

Validated before save, all blocking: rows with no title, duplicate title+artist, and a song
count below `picks_required` (you cannot pick 18 out of 4).

**The CSV cannot be replaced once the pack has its first entry.** Every pick points at a
`pack_songs` row; re-uploading would repoint or orphan every entry already submitted. After
that point the loader offers per-row edits (fix a typo) and nothing else.

---

## 8. Settling

The played set is **derived, then confirmed**. When the host queues an A&R Wars matchup, both
songs are chosen from the pack rather than typed, populating `rounds.pack_song_a/b`. Because
all 9 matchups are binary rounds, the 18 songs fall out with no extra host work on show night.
Settle then presents them as a checklist for the host to confirm or correct — a swapped song
or an off-script matchup has to be fixable, and a cash result should not depend on nobody
having typed anything by hand.

Settle computes §3.2 and §3.3 in one pass, writes `correct` / `distance` / `rank` onto every
entry, flips `packs.status = 'settled'`, and only then unseals pick counts.

**Settle is idempotent and re-runnable** while the status is `closed` — a corrected checklist
must be able to produce a corrected result. Once results have been announced, re-running is a
deliberate act; log it.

---

## 9. Out of scope

- **No points, no series impact.** Contest results never touch `votes`, the series board, or
  the A&R Wars cut. Points on that board are accuracy-derived, and this is a sweepstakes-shaped
  prediction game — the same reasoning that kept comments unpaid (CLAUDE.md).
- **No live standings**, per §4.
- **No public entry list.** Entries carry PII and predictions; neither has a public read path.

---

## 10. Open items

1. **Rules page content** — the text that sits behind the "Full rules" link on screen 1.
   Operator-supplied copy; the page itself is a static template.
2. **Winner notification and payout** — not specified. How the $150 is delivered, and what
   the winner is asked to provide, is an operator process, not code.
