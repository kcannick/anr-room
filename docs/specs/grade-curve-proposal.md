# A&R grade: a new curve (proposal, not built)

Status: **planning only, 2026-10-27.** Nothing in `scoring.js`, `server.js` or any page changes
until the operator says "build it". Every number below comes from one read-only pull of prod
taken on 2026-10-27.

## 1. The problem in one paragraph

Today's grade turns the average miss into an "accuracy %" (`100 × (1 − miss / 9)`) and bands it
(`scoring.js` `roundAccuracy` + `gradeForAccuracy`). Dividing by 9 assumes a miss can be anywhere
from 0 to 9. It can't, in practice: room averages cluster (median 4.5, 10th percentile 3.1, 90th
6.0), so even a player who always guesses 4.5 misses by only **0.92** on average, which is
89.8% accuracy and an **A-**. The scale is graded on a range nobody uses, so everyone lands at
the top of it.

The data does separate players. It is the cut points that don't:

- Players genuinely differ. Split each regular's rounds into odd and even halves and the two
  halves' average miss correlate at **0.92** (25+ rounds) and **0.97** (50+ rounds). Grading off
  the average miss is not grading noise.
- The typical regular (50+ rounds) misses by **0.76**. The best miss by **~0.49**. The worst
  10% miss by **1.30 or more**.
- **21 of the 59 players with 50+ rounds do worse than always guessing the middle.** On average,
  across every vote ever cast, A&Rs miss by 0.886, the same as the middle guess (0.888). Most of
  that is players predicting their own taste (predicting your own rating would miss by 1.25).

## 2. Data used

| | |
|---|---|
| Rating votes | 14,637 (Versus votes left out: 65 in total, see §7) |
| Records | 1,116 ratified, 105 sessions (392 records are daily drops) |
| A&Rs graded | 424 (25+ rounds: 101 · 50+: 59 · 100+: 32; median 8 rounds) |
| Rules | ratified rounds, session not deleted, a daily drop only once `async_state='published'`, blocked / deactivated / deleted accounts out |
| Voters per record | median 12 (10th percentile 7, 90th 20) |
| Spread of ratings on a record | standard deviation median 1.54 (0.95 to 2.06) |

Scripts (scratchpad, not in the repo): `pull.js` (the read-only pull), `base.js`, `rel.js`,
`noise.js`, `sim.js`, `sim2.js`, `sim3.js`, `cminus.js` (the C- re-cut), `bloc.js`.

## 3. The target shape

A bell with the bulk at C, **and always guessing 4.5 earns a C-** (operator, 2026-10-27:
guessing the middle is below average, not average). The scale has 7 grades above C and only 3
below it, so the bell leans: a long gentle climb to A+, a short steep drop to F. The target
shares for established players:

| A+ | A | A- | B+ | B | B- | C+ | **C** | C- | D | F |
|---|---|---|---|---|---|---|---|---|---|---|
| 1% | 2% | 4% | 7% | 10% | 13% | 15% | **18%** | 13% | 10% | 7% |

C-, C and C+ together hold 46%. In practice the two goals pull against each other: the
typical A&R misses by about as much as the middle guess (§1), so once the middle guess is a C-,
C- is where most regulars land too. §6 says how the recommended cuts handle that.

## 4. The candidates

Every method below adds the same **starting allowance** for small samples (§5): each A&R starts
as if they had already played 10 rounds at "middle-guess" quality (0.92 off, a C-). That is what stops one lucky
day from making a new player an A.

### M0 — today (for comparison)

Accuracy % with today's absolute bands. Always-4.5 → **A-**.

### M1 — skill against the middle guess

For each record, compare your miss with the miss of a "middle guesser" who predicts the median
of every earlier record's room average (no hindsight; 4.5 until 20 records exist). Skill =
1 − (your total miss ÷ the middle guesser's total miss on the same records). 0 = as good as the
middle guess, 0.5 = you miss half as much. Cut points (lower edge): A+ 0.50 · A 0.45 · A- 0.40 ·
B+ 0.33 · B 0.25 · B- 0.15 · C+ 0.05 · C −0.15 · C- −0.35 · D −0.50.

- Always-4.5 → **C** by construction.
- Adjusts for hard days automatically (a day of extreme records makes the middle guess miss too).
- Less stable: a player's first half and second half agree at only 0.50, against 0.71 for the
  plain average miss. The baseline itself drifts as records accumulate, and on a record that
  lands at 4.5 the middle guess misses by 0, so that record counts against everyone.
- Hard to say on a card: "your misses were 33% smaller than the middle guess's".

### M2 — miss scaled by how split the room was

Divide each miss by the spread (standard deviation) of that record's ratings, floored at 0.75.
Missing a divided record costs less than missing a record everyone agreed on. Cut points (upper
edge): A+ 0.37 · A 0.39 · A- 0.41 · B+ 0.45 · B 0.49 · B- 0.53 · C+ 0.58 · C 0.65 · C- 0.72 ·
D 0.84.

- Always-4.5 → **C-**.
- Halves agree at 0.69, about as stable as M4, but it buys nothing in separation (0.87 split-half
  vs 0.92 for M4).
- The biggest swings for new players (a good day moves a 25–40-round player +2.2 steps, a bad
  day −2.8; see the swing table).
- The unit is meaningless to a player ("0.45 standard deviations").
- A bloc of fans on one record makes that record LOOK split (high spread), which then excuses
  everyone's miss on it. The wrong direction for promotion.

### M3 — percentile curve (rank among players)

On every record, rank each voter's miss against the others who rated it (0 = closest, 1 =
furthest), average that per player, then hand out grades by share: top 1% A+, next 2% A, and so
on, re-cut against everyone with 25+ rounds.

- Matches the target shape exactly, by definition. Always-4.5 → **C**.
- **Not stable as the pool changes.** Your grade moves when other people improve, join or leave,
  even on weeks you don't play. Invite-only is designed to change the pool: as weak players are
  filtered out, a good player's grade falls without them doing anything different.
- Least reliable of the four (split-half 0.78) and the biggest jump from one good day for a new
  player (+3.3 steps).
- A grade that is a rank is also a public rank in disguise; the operator decided on 2026-10-02
  that rank is revealed by the weekly announcement, not by daily surfaces.

### M4 — average miss, with the bands re-cut on the real data (recommended)

Grade on the average miss itself (how far your prediction landed from the room average, in
rating points), with fixed cut points set once from today's data. No conversion to a percent.

- Always-4.5 → **C-** (0.89–0.92 sits in the C- band, 0.88–1.05). The no-hindsight middle
  guesser (0.92–0.94) → C-.
- The most reliable measure (split-half 0.92 / 0.97) and the most stable over time (0.71).
- **Stable as the pool changes:** the cut points are fixed numbers, so a grade only moves when
  that player plays. If the whole pool gets better, more people earn B's, which is the truth.
- **A player can understand it:** "On average you were 0.6 off the room average. That's an A-."
  It is the same number they already see on every result ("guess 5.6 · average 5.7 · off 0.1").

## 5. Results

Distributions are standing grades (all of a player's rounds, with the 10-round allowance),
except "100+ last 100", which is the plain average miss of their latest 100 rounds with no
allowance (the promotion window).

### M0 — today

| group | n | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| everyone | 424 | 6 | 43 | 128 | 104 | 68 | 37 | 19 | 10 | 4 | 2 | 3 |
| 25+ | 101 | 0 | 14 | 48 | 30 | 6 | 1 | 0 | 1 | 1 | 0 | 0 |
| 50+ | 59 | 0 | 12 | 27 | 16 | 2 | 1 | 0 | 1 | 0 | 0 | 0 |
| 100+ | 32 | 0 | 10 | 14 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 100+ last 100 | 32 | 0 | 8 | 13 | 10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |

### M1 — skill against the middle guess

| group | n | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| everyone | 424 | 2 | 3 | 3 | 12 | 10 | 32 | 52 | 127 | 100 | 42 | 41 |
| 25+ | 101 | 2 | 2 | 3 | 10 | 6 | 12 | 17 | 18 | 15 | 8 | 8 |
| 50+ | 59 | 2 | 1 | 3 | 7 | 4 | 9 | 9 | 8 | 9 | 4 | 3 |
| 100+ | 32 | 1 | 1 | 3 | 5 | 3 | 5 | 4 | 5 | 3 | 2 | 0 |
| 100+ last 100 | 32 | 0 | 2 | 3 | 8 | 2 | 0 | 5 | 8 | 1 | 2 | 1 |

### M2 — miss scaled by the room's spread

| group | n | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| everyone | 424 | 1 | 3 | 3 | 8 | 23 | 29 | 52 | 113 | 83 | 70 | 39 |
| 25+ | 101 | 1 | 3 | 3 | 7 | 11 | 12 | 17 | 17 | 11 | 12 | 7 |
| 50+ | 59 | 1 | 2 | 3 | 7 | 8 | 5 | 6 | 13 | 6 | 4 | 4 |
| 100+ | 32 | 0 | 2 | 3 | 5 | 6 | 2 | 2 | 10 | 2 | 0 | 0 |
| 100+ last 100 | 32 | 0 | 2 | 5 | 4 | 4 | 3 | 3 | 6 | 2 | 2 | 1 |

### M3 — percentile curve

| group | n | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| everyone | 424 | 1 | 3 | 5 | 14 | 22 | 32 | 70 | 109 | 88 | 52 | 28 |
| 25+ | 101 | 1 | 2 | 4 | 7 | 10 | 13 | 16 | 18 | 13 | 10 | 7 |
| 50+ | 59 | 1 | 1 | 4 | 6 | 6 | 7 | 6 | 12 | 7 | 6 | 3 |
| 100+ | 32 | 1 | 1 | 2 | 4 | 5 | 5 | 4 | 6 | 2 | 2 | 0 |
| 100+ last 100 | 32 | 2 | 2 | 0 | 7 | 2 | 4 | 4 | 4 | 4 | 1 | 2 |

### M4 — average miss, re-cut bands (the 10-27 cuts; the current 10-29 cuts and their table are in §5b)

| group | n | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| everyone | 424 | 2 | 4 | 4 | 8 | 13 | 23 | 24 | 34 | 151 | 96 | 65 |
| 25+ | 101 | 2 | 4 | 4 | 6 | 8 | 13 | 10 | 7 | 21 | 14 | 12 |
| 50+ | 59 | 2 | 4 | 4 | 4 | 5 | 7 | 4 | 4 | 10 | 9 | 6 |
| 100+ | 32 | 2 | 2 | 4 | 4 | 2 | 2 | 3 | 2 | 6 | 4 | 1 |
| 100+ last 100 | 32 | 2 | 5 | 1 | 4 | 3 | 1 | 1 | 3 | 3 | 5 | 4 |

For comparison, the first draft's cuts (C+ ≤0.85 · C ≤1.00 · C- ≤1.15 · D ≤1.40) put the
middle guess at C and the 25+ group at C+ 12 · C 18 · C- 14 · D 11 · F 9. Moving the middle
guess down to C- moves everyone who plays like it down with it.

"Everyone" piles up at C- because most accounts have only a handful of rounds, and the starting
allowance holds them at the middle guess until they have played enough to show otherwise. That
is intended: a new player starts at C- and plays their way up.

### The always-4.5 guesser

| M0 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|
| A- | C | C- | C | **C-** |

### How much one day moves a grade

A day of 10 records added to real players' histories, in grade steps (positive = up).

Extreme days (every record a Bullseye / every record 3.0 off):

| | M0 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|---|
| 25–40 rounds, perfect day | +0.9 | +1.6 | +2.2 | +3.3 | +1.6 |
| 25–40 rounds, terrible day | −1.0 | −2.2 | −2.8 | −2.2 | −2.3 |
| 100+ rounds, perfect day | +0.1 | +0.4 | +0.4 | +0.8 | +0.4 |
| 100+ rounds, terrible day | −0.4 | −1.0 | −1.4 | −0.8 | −1.0 |

Realistic days under M4 (a good day = 0.3 off on average, a bad day = 1.8 off, both roughly the
best and worst 10% of player-days), by size of the starting allowance:

| allowance | 5–15 rounds: good / bad | 25–40 rounds: good / bad |
|---|---|---|
| none | +3.3 / −1.9 | +1.1 / −1.7 |
| 5 rounds | +2.5 / −1.7 | +1.2 / −1.3 |
| **10 rounds** | **+2.1 / −1.5** | **+1.0 / −1.2** |
| 20 rounds | +1.5 / −1.3 | +0.9 / −1.0 |

(These swing figures were measured on the first draft's cuts. The top half is unchanged; in the
C+/C range, where the bands are now narrower, a day moves a player slightly more steps.)

Any honest grade moves about one step on a strong day for someone with 30 rounds; it should.
Ten rounds of allowance roughly halves the jump for brand-new players without burying real
regulars (the allowance is under 2% of a 674-round player's history and changes nothing for
them). Twenty rounds would hold about 190 of 424 accounts at the starting grade, which reads as "the grade is broken".

Statistically the allowance only needs to be about 2–3 rounds (the gap between players is large
compared with round-to-round noise: within-player variance 0.53, between-player 0.23). Ten is a
deliberate choice for the promotion use: a newcomer has to prove it, not get lucky.

## 5b. How grades are reported: by day and overall (2026-10-29)

Operator: people should feel good about playing and strive for higher grades. **No easy A's,
easy C's.** Grades are reported two ways, never per round:

- **Day grade:** one A&R's average miss on one drop or live session (5-round starting
  allowance at 0.92). This is the grade card, the digest subject, the day row in My results.
- **Overall grade:** one A&R's average miss across every round they have played (10-round
  allowance). This is the standing card and the account page.

Distribution of average miss (rating points):

| | n | 5% | 10% | 25% | median | 75% | 90% | 95% |
|---|---|---|---|---|---|---|---|---|
| Days (allowance 5) | 1,798 | 0.55 | 0.61 | 0.71 | 0.87 | 1.08 | 1.35 | 1.56 |
| Days, no allowance | 1,798 | 0.35 | 0.42 | 0.56 | 0.82 | 1.26 | 1.90 | 2.39 |
| Overall, everyone (allowance 10) | 424 | 0.67 | 0.73 | 0.86 | 0.99 | 1.15 | 1.35 | 1.48 |
| Overall, 25+ rounds | 101 | 0.54 | 0.60 | 0.71 | 0.86 | 1.06 | 1.27 | 1.54 |

(Median day is 8 records. Without an allowance a 4-record day swings from 0.2 to 2.4, which is
luck, so the allowance stays.)

Histogram, by day and overall, 0.05 bins starting at the value shown (A ≤0.55 · B ≤0.70 · C
≤1.10 · D ≤1.50 · F):

| bin | 0.40 | 0.45 | 0.50 | 0.55 | 0.60 | 0.65 | 0.70 | 0.75 | 0.80 | 0.85 | 0.90 | 0.95 | 1.00 | 1.05 | 1.10 | 1.15 | 1.20 | 1.25 | 1.30 | 1.35 | 1.40 | 1.45 | 1.50+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| days | 7 | 22 | 55 | 79 | 107 | 142 | 133 | 136 | 164 | 141 | 128 | 107 | 85 | 69 | 67 | 52 | 44 | 40 | 37 | 26 | 17 | 26 | 136 |
| overall | 0 | 2 | 4 | 4 | 7 | 14 | 23 | 23 | 19 | 37 | 45 | 48 | 36 | 37 | 20 | 25 | 15 | 12 | 11 | 9 | 7 | 5 |21 |

**The first cut points this led to (superseded by §5c the same day):** keep A's for genuinely sharp
reads, make the C range wide enough that ordinary play lands in it, and keep D and F for the
tails.

| | n | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F | A's | B's | C's | D | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Days | 1,798 | 8 | 22 | 54 | 86 | 102 | 145 | 221 | 274 | 469 | 303 | 114 | 5% | 19% | 53% | 17% | 6% |
| Overall, everyone | 424 | 0 | 2 | 4 | 4 | 8 | 13 | 38 | 43 | 188 | 103 | 21 | 1% | 6% | 64% | 24% | 5% |
| Overall, 25+ | 101 | 0 | 2 | 4 | 4 | 6 | 8 | 22 | 8 | 24 | 17 | 6 | 6% | 18% | 54% | 17% | 6% |
| Overall, 100+ | 32 | 0 | 2 | 2 | 4 | 4 | 2 | 5 | 2 | 8 | 3 | 0 | 13% | 31% | 47% | 9% | 0% |
| Promotion window (100+, last 100, no allowance) | 32 | 0 | 2 | 5 | 1 | 4 | 3 | 2 | 3 | 4 | 7 | 1 | | | | | |

What that means for a player:

- **A C is the normal result.** About half of all days and half of regulars land in C+/C/C-.
  Always guessing 4.5 (0.89–0.92) is a C-, and so is a new player before they have shown
  anything.
- **An A is rare and earned.** 1 day in 20 is an A-range day; 6 of 101 regulars hold an A
  overall. A+ is a day-only grade in practice (8 days ever, no player overall), the thing to
  screenshot.
- **F is rare.** 6% of days, mostly short days that went badly. A D or F overall means
  consistently further off than guessing the middle.
- **B is the thing to strive for.** It is one band up from where most people sit, and it is
  where promotion starts (below).

Promotion at B- moves with these cuts: B- is now 0.70, and **15 of 32** players with 100+
rounds pass on their last 100 (B: 12, A-: 7, C+: 17).

## 5c. Fitted to the operator's shares (2026-10-29, current)

Operator target: **15% A's, 20% B's, 45% C's, 15% D's, 5% F's.** The cut points in §6 are
fitted to that on DAY grades, and regulars (25+ rounds) land on almost the same shares, because
the two distributions are nearly the same (§5b). The A, B, C and D edges sit at the 15th, 35th,
80th and 95th percentile of days: 0.65, 0.77, 1.15, 1.55.

| | n | A+ | A | A- | B+ | B | B- | C+ | C | C- | D | F | A's | B's | C's | D | F |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Days | 1,798 | 30 | 64 | 178 | 112 | 107 | 116 | 153 | 152 | 530 | 262 | 94 | 15% | 19% | 46% | 15% | 5% |
| Overall, 25+ | 101 | 2 | 5 | 9 | 6 | 8 | 10 | 8 | 6 | 27 | 15 | 5 | 16% | 24% | 41% | 15% | 5% |
| Overall, 50+ | 59 | 2 | 5 | 7 | 4 | 4 | 6 | 3 | 3 | 15 | 8 | 2 | 24% | 24% | 36% | 14% | 3% |
| Overall, 100+ | 32 | 2 | 3 | 7 | 2 | 0 | 4 | 1 | 2 | 8 | 3 | 0 | 38% | 19% | 34% | 9% | 0% |
| Overall, everyone | 424 | 2 | 5 | 11 | 9 | 15 | 19 | 23 | 28 | 207 | 87 | 18 | 4% | 10% | 61% | 21% | 4% |
| Promotion window (100+, last 100) | 32 | 2 | 5 | 5 | 2 | 1 | 2 | 1 | 2 | 6 | 5 | 1 | 38% | 16% | 28% | 16% | 3% |

- **"Everyone" sits heavier in the C's** because most accounts have a few rounds and the
  starting allowance holds them at the middle guess (C-) until they show otherwise. Heavy
  players skew up: people who play a lot get better, which is the reward working.
- **Within the C's, C- is the big one** (30% of days). That is the 10-27 rule: always guessing
  4.5 (0.89–0.92) and a brand-new player are C-, so C- has to start at 0.88, which is the
  median day. If the C's should split evenly (15% each: C+ ≤0.82 · C ≤0.97 · C- ≤1.15), the
  middle guess becomes a C instead. Operator's call.
- **Promotion at B-** is now 0.77 or less over the last 100 rounds: **17 of 32** pass (B 0.73:
  15 · B+ 0.69: 14 · A- 0.65: 12).

## 6. Recommendation: M4, with these cut points

**Grade = average miss**, where miss = |your prediction − the room average| on a rating record,
in rating points (the same 0.1-resolution error `errTenths` already stores in `votes.err`).

| Grade | Average miss | Accuracy % today would print |
|---|---|---|
| A+ | 0.50 or less | 94.4+ |
| A | 0.51 – 0.56 | 93.8 |
| A- | 0.57 – 0.65 | 92.8 |
| B+ | 0.66 – 0.69 | 92.3 |
| B | 0.70 – 0.73 | 91.9 |
| B- | 0.74 – 0.77 | 91.4 |
| C+ | 0.78 – 0.82 | 90.9 |
| C | 0.83 – 0.87 | 90.3 |
| C- | 0.88 – 1.15 | 87.2 |
| D | 1.16 – 1.55 | 82.8 |
| F | over 1.55 | — |

(Edges are inclusive at the better grade; compare in hundredths of a point so 0.70 lands in B.)

**Where the middle guess lands:** always guessing 4.5 misses by 0.888 per vote cast (records
weighted by how many rated them) and 0.923 per record; the no-hindsight middle guesser misses
by 0.923 / 0.938. All four are **C-**. The C edge sits at 0.87 rather than 0.90 so the
per-vote figure (0.888) clears it with room to spare. The top half (A+ through B-) is unchanged
from the first draft in the 10-27 version; see §5b for the 10-29 re-cut. In the 10-29 cuts the A's and B's
each moved 0.05 tighter (hard A's) and the bottom moved out (C- to 1.10, D to 1.50) so C is the
common grade and F is rare. C- is the wide band (0.88–1.10), which is where "about as good as
guessing the middle" lives.

The right-hand column is why the percent has to go: a B+ would print 92.8% and a C 90.3%, and
every reader takes both for an A.

**Three ways the grade is computed off the same rule:**

| Where | Rounds | Allowance |
|---|---|---|
| Day grade (daily grade card, the day row in My results, the digest subject, the live recap) | that day's records | 5 rounds at 0.92 |
| Standing grade (standing card, My results week and all-time stat, admin) | every round | 10 rounds at 0.92 |
| Promotion | the latest 100 rounds, 100 required | none (the 100-round minimum does that job) |

Formula: `(sum of misses + allowance × 0.92) ÷ (rounds + allowance)`, then the table.

The day grade gets a smaller allowance so a strong day can still earn an A or A+ card
(1,798 real player-days: A+ 30, A 64, A- 178, B+ 112, B 107, B- 116, C+ 153, C 152, C- 530,
D 262, F 94). With no allowance at all, 4-record days produce 13% A+ days and 20% F days,
which is mostly luck.

**Why 0.92 is the starting point:** it is what the middle guess earns, so a new player starts
at C-. "Until you show otherwise, we assume you're as good as guessing the middle" is a sentence
a player can read.

**Re-cutting:** the cut points are fixed numbers, not a curve. Review them once a quarter
against the 25+ group, and change them only on purpose, announced, because every past grade
moves with them.

**Promotion gate:** the 2026-10-27 decision is B- or better over the latest 100 rounds. Under
these cut points that is an average miss of 0.77 or less: **17 of today's 32 players with 100+
rounds** pass (B, 0.73: 15; B+, 0.69: 14; A-, 0.65: 12).

**What a card says:** "Off by 0.62 on average" (or "0.6 off the average") beside the grade,
instead of "93% accuracy". Same fact, honest scale. The good-three counts (Bullseye / Sharp /
Close) are unchanged.

## 7. Points stay as they are

`pointsForError`, `accuracyPoints`, the Bullseye 125 and the −10 penalty stay. Points reward
each round; the grade describes a player. They agree already: points fall smoothly with the miss,
so a better M4 grade means more points per round. No change to the $500 board, the weekly
report, referral or scouting points.

**Versus rounds:** convert the split miss to rating points (`miss × 9 / 100`) so a mixed day
has one average. There are only 65 Versus votes ever, so this changes no one's grade today;
the cut points above were set on rating rounds only.

**One scoring change I'd argue for, but it is about the target, not the curve:** see §8.

## 8. A bloc of fans

Scenario: a group of fans joins to push one artist. They rate 9 and predict 9.

Simulated on the last 10 published daily drops (101 records, median 9 real voters a record):

| Fans rating 9 / predicting 9 on every record for 10 days | Fans' grade if they move the average (today's rule) | Fans' grade if graded against official A&Rs only | How much worse real A&Rs' miss gets |
|---|---|---|---|
| 5 fans | F (2.44 off) | F (3.78) | +0.49 |
| 12 fans | F (1.66) | F (3.78) | +1.08 |
| 25 fans | C- (1.05, the bottom edge of C-) | F (3.78) | +1.62 |
| **50 fans** | **B+ (0.62)** | F (3.78) | +2.04 |

Other shapes of the same attack:

- **One record only** (9 / 9 on their artist, nothing else): one round, standing grade D (1.25
  with the allowance), and no promotion before 100 rounds.
- **The careful fan** (9 / 9 on their artist, the middle guess on everything else, for 100
  rounds): 1.42 off, **F**. The middle guess by itself only earns a C-, and the gate is B-.

The weak point is the first table: **when everyone's rating moves the room average, a big
enough bloc makes its own prediction come true.** Fifty fans in a 9-voter room set the average
near 8; predicting 9 then looks like skill, and every real A&R on that day looks bad. No curve
fixes that, because the curve is not the problem; the target is.

**So: grade (and score) against the official A&Rs' average.** Once there is an official team,
the room average a record is scored against (and that the countdown ranks on) is the average of
OFFICIAL A&Rs' ratings only. Probation players still rate and predict, and are scored and graded
against that same official average, but their ratings do not move it. A fan bloc then predicts
9 against a 4.5 and grades F however many of them there are, and real A&Rs' scores are
untouched. This keeps `pointsForError` as it is; only which votes feed `roomAverage` changes, so
it belongs in the invite-only build, not in this grade change.

Two cautions on that:

- **Thin rooms.** With a median of 9 voters a record today and about 16 who would pass the gate,
  some records would have 3–5 official ratings. Need a floor (for example, fall back to all
  voters' average when a record has fewer than 5 official ratings, and mark it).
- **The grade checks prediction, not taste.** A promoted A&R who genuinely reads the room well
  can still rate a friend's record a 9. The gate keeps out crowds; it does not stop one honest
  player's biased rating. One rating among many official voters is the defence, plus the
  operator's eye.

## 9. Every surface that prints a grade

All call one of three code paths, so the change is three functions plus copy:

| Surface | Code path | Today |
|---|---|---|
| Live recap screen ("Room-reading accuracy" + the big grade) | `buildRecap` → `gradeForAccuracy` (`server.js:1178`), shown in `public/play.html:535–548, 1138` | grade + accuracy %, rating / Versus accuracy split |
| Daily recap screen ("Grade" stat) | `buildRecap`, `public/daily.html:1007` | grade |
| Daily grade card (A photo / C stats, feed + story, the email `<img>`) | `gradeCardFacts` reads `recap.grade` / `recap.accuracy` (`server.js:3010–3024`), drawn in `share-cards.js:459–519` | grade + "N% accuracy" |
| Standing card | `standingFacts` (`server.js:3031–3046`), same Satori elements | grade + accuracy % + "Standing · N drops" |
| Daily digest email: subject "Your A&R grade for <day>: <grade>" | `server.js:4199` | grade |
| Daily digest email body ("Grade" stat, card alt text, text version) | `dailyDigestEmailHtml/Text`, `server.js:3921, 3941, 3967` | grade |
| My results: day row badge, day stats, week stat | `arResultsData` (`server.js:5109, 5130`), `public/account.html:553, 557, 596` | grade |
| Account page grade card header ("Grade B+ · Oct 27" / "· N drops") | `/api/me/grade-card/latest` (`server.js:10487`), `public/account.html:631–632` | grade |
| Admin → Users → Edit profile → grade card | `adminGradeCardInfo`, `public/admin.html:5162` | grade |

Not grades, but they print accuracy % from the same idea and should move with it so two numbers
never disagree: the Charts A&R ranking's Accuracy column (`chartAcc`, the "closest to the
average" ranking and its CSV) and the accuracy line on the grade cards.

**Not affected:** the Track Report prints no A&R grade (its verdicts are about the record), and
the live session recap email sends the score card image, which carries no grade.

## 10. If it is built

1. `scoring.js`: `gradeForMiss(avgMiss)` with the table in §6, and `shrunkMiss(sum, n, allowance)`.
   Keep `roundAccuracy` only if the percent stays anywhere.
2. `buildRecap`, `standingFacts`, `arResultsData`: compute the average miss (each is already one
   bounded read of one A&R's votes, on demand, so nothing new on a fan-out or boot path).
3. Cards and pages: replace "N% accuracy" with "Off by X on average". Card copy and layout need
   a quick mockup first (mockup-first rule).
4. Tests: the always-4.5 guesser grades C- (both 0.888 and 0.923); the boundary values; Versus
   conversion.
5. No migration: the grade is computed, never stored.

Past grade cards already emailed keep their old letter; anything rendered after the change
shows the new one. Expect "I was an A- yesterday and a C- today" — the release note should say
the scale changed for everyone, and that a C- means about as good as guessing the middle.

## 11. Decisions for the operator

1. M4 and the cut points in §6 (always-4.5 = C-, 2026-10-27; 15/20/45/15/5, 2026-10-29)?
2. Replace the accuracy % with "off by X on average" on the cards and pages?
3. Promotion at B- (0.77; 17 of 32 regulars) or stricter?
4. Score and grade against the official A&Rs' average once the team exists (§8), and the
   floor for thin records?
5. Keep C- as the middle guess (C- = 30% of days), or split the C's evenly so the middle guess is a C?
