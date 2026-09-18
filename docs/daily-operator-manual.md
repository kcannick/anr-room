# Operator manual — A&R Daily

How to run the daily console day to day. One-time setup (env vars, Vercel Pro, the Drupal
token) lives in **[daily-setup.md](daily-setup.md)** — do that first, once. This document is
what you use afterwards.

**The short version:** the day runs on a clock, not on a button. Your real jobs are stacking
tomorrow's records, glancing at the flag counts, and running the 2:00 PM reveal stream off
this screen. Everything else on it exists for the days that are not normal.

---

## 1. The day, start to finish

| ET time | What happens | Who does it |
|---|---|---|
| Any time before noon | Tomorrow's records are staged (Drupal push, or you build them by hand) | Drupal / you |
| **12:00 PM** | The day opens. Every record goes live at once. A&Rs rate and predict | The cron |
| 12:00 PM → 12:00 PM | The 24-hour window. A&Rs play whenever they want | — |
| **12:00 PM** next day | Rating closes. The day tallies (may take a cron tick or two). The next day opens in the same minute | The cron |
| 12:00 PM → 3:00 PM | Results are **held**. The console shows every score; this is the livestream reveal window, and the time to reject any comment | You |
| **3:00 PM** | Results publish, graphics render, the Daily Blast (A&R digest) queues | The cron |
| **4:00 PM** (publish + 1 hour) | Artist reports and texts go out | The cron |

These times are settings, not code: **Platform → System settings → A&R Daily schedule**
(open, close, results, the completion-bonus steps, and how long artist reports wait after
the results — 60 minutes by default). Saving applies to every drop that has
not opened yet; a day already open keeps the window it started with. A closing time at or
before the opening time means the next day. Results never publish before the close.

The window is noon-to-noon, so **the close and the next open are the same moment**. The
three hours between the close and the publish exist for one reason: they are the runway for
the 2:00 PM stream, which has to happen while the results are still sealed.

The hour between publish and artist reports is your **only** window to reject an A&R
comment. After that there is no unsend.

### The five states

The pill at the top right of the console:

Each one is named for what is true, not for what the machine is doing:

| Pill | Meaning | Can you still…? |
|---|---|---|
| **Scheduled** | Staged; noon has not arrived | Add, remove, edit, re-date the whole day |
| **Open** | A&Rs are rating it | Fix a link or an amount. Not add, remove or re-date |
| **Processing** | Rating is over; votes are being scored | Wait — it moves on its own, a few records per cron tick |
| **Closed** | Scored, **not yet announced**; results are still sealed | Run the 2:00 PM stream. This is the state it happens in |
| **Published** | Terminal. Results are out and the sends are draining | Reject a comment, for one hour only |

Closed does not mean finished — it means the rating is finished and the scores exist. The day
card next to the pill reads **Results 3:00 PM** the whole time it sits there, which is the
reminder that nobody has seen them yet.

---

## 2. The console screen, card by card

The console opens on **A&R Daily**. The mode switch at the top left goes to **Live show**
(the weekly broadcast) and **Platform**.

### The day picker
Top right, next to the state pill. Defaults to **Running day** and lists the last 14 drops
with their state. Pick one to pull up that whole day — records, flags, queues, graphics.
This is how you check yesterday's send numbers after today's drop has opened and displaced
it on screen.

### "Nothing is staged" (red card)
No day exists. **This is an incident, not an empty state** — A&Rs open the app to nothing to
do. Either Drupal has not pushed, or the push failed. Build a day by hand in the builder card
below rather than waiting. (Picking a past day that was never built says so plainly instead;
that is not an alarm.)

### The day
Records · A&Rs playing · Finished · Closes/Results, plus the schedule line and the series.

**If the series line is red, stop and fix it.** An untagged day scores people into a void —
its points never reach the monthly board or the $500. This should be impossible (a day
refuses to be created untagged); if you ever see it, report it.

"Finished" counts A&Rs who completed the whole day and were paid the completion bonus.

### The hold (amber card)
Appears after publish, while artist reports are held: *"N A&R comments go to artists in M
minutes."* Comments ship **by default** with the artist's report, carrying the A&R's name —
your job is to reject the bad one, not approve the good ones. See §4.

### The records
One row per record: position, title/artist, **support**, play link, votes, **flags**,
**score**, and an Edit / **Fix link** button. Rows turn red when a record has no play link or
three or more flags. The day's top supporter gets a gold row and a pill.

**Order** (the select above the table, remembered per device):

| Sort | What it is for |
|---|---|
| As dropped | The day as it was staged |
| Score, highest first | Reading the day's result |
| **Countdown, lowest first** | **Running the 2:00 PM stream** |
| Support, highest first | Seeing who paid, top down |

Scores only exist once the day has tallied; before that everything sorts as unscored. Ties
rank by votes, then drop order. An unscored record has no rank and sits last.

**Support** is what the artist paid to submit: **Free**, or the amount. A dash means no
amount was reported for that record — the console does not guess.

**A flag is one A&R, not one click.** Three flags means three different people are telling
you that record will not play. That is the number worth checking every day.

### Sending
Sent / Failed / Pending for the A&R digest, artist reports, and artist texts, plus the two
manual buttons (§6). Nothing sends until the day publishes; after that the cron drains a
chunk every five minutes and these numbers move on their own. Texts obey the 10 AM–10:30 PM
ET window; outside it the pill tells you when the window reopens.

### The day's graphics
Three sets, all rendered at the 3:00 PM publish and all downloadable by clicking:

1. **Top 8 A&Rs and Top 8 Records** — the cards that ride the digest email, plus **Copy
   caption**.
2. **The A&R Meeting Recap** — the Instagram Live cover (9:16) and YouTube thumbnail (16:9)
   for the stream, dated for the day it airs, plus **Copy recap caption**. These render
   **live** before the day publishes, so there is always a cover to post — the A&Rs column
   fills in once the day tallies. Artists print in drop order, A&Rs alphabetically; **nothing
   on the cover is ranked**, because the stream is the reveal.
3. **Results carousels** — two Instagram sets to post *after* the stream: **Top Track** and
   **Top A&R**, each with its own caption button. Slide 1 is the winner, then the rest
   ranked, then the call to action. A bigger day gets more list slides.

If the Top 8 cards show amber ("did not render"), the day still published on purpose — a
stalled reveal is worse than a graphic-less email. Fix the cause and press **Publish the day**
to re-render.

### Build the next drop
Always visible, because stacking tomorrow and fixing today are different jobs on the same
screen. Add records one at a time; the day is created around the first one.

- **Required:** record title and a full http(s) play link. A record nobody can hear is a dead
  record for the whole 24-hour window.
- **Artist email** is what earns that artist their free report. The ⚠ in the list means no
  contact on file — that artist gets nothing.
- **Support ($)** — what they paid. `0` is free, blank is not reported.
- **Reference track** — a known record from a major artist, dropped in so A&Rs have something
  familiar to rate. Fully votable and scored, but kept out of the charts, the Top 8 card and
  the artist report queue. It also **survives a Drupal re-push**, which replaces the day's
  records wholesale; a non-reference hand-add does not.
- **Day** is blank by default, meaning "the next day being built". Only fill it to work on a
  specific date (`YYYY-MM-DD`, within 3 days of today).
- **Edit** / **Remove** work on any staged record right up until noon.
- A typical day is 4 free records plus up to 12 paid. The hard ceiling is 24; the counter
  shows where you are, not a target.

---

## 3. Running the 2:00 PM reveal stream

The day is tallied and sealed from noon; the stream is where the results come out. Run it off
this console:

1. Pull up the day (the picker defaults to it) and confirm the pill reads **Closed**. If it
   still says Processing, press **Run the lifecycle now** until it settles.
2. Set the order to **Countdown, lowest first** and work up to #1.
3. Use the **Support** column to decide how long each record plays: free records get about a
   minute, paid records play in full. Single out the day's **top supporter** — the gold row.
4. The play link in each row is a real link; open it straight from the table.
5. Close on the Top 8 A&Rs.
6. Post the results carousels after the stream, not before — they carry the rankings.

The cover and thumbnail for the stream are on the graphics card and render before publish, so
you can post them in the morning.

---

## 4. Rejecting an A&R comment

Comments ship by default and there is no unsend. The window is the hour between the 3:00 PM
publish and the first artist reports at 4:00 PM.

1. Mode switch → **Live show** → open the session named **A&R Daily — YYYY-MM-DD**.
2. **Rounds** tab → the 💬 badge on a record shows how many comments are going to that artist.
3. Click it, reject anything that should not ship.
4. A rejected comment stays rejected even if the A&R edits it.

---

## 5. Fixing a record mid-window

**Fix link** is the most useful button on this screen. A dead link at 12:05 PM is a dead
record for 24 hours, and nobody is watching the way a host watches a live show.

You can change the **play link**, the **from the artist** note, and the **support amount**.
That is all — descriptive fields only, never votes or scores. Every A&R sees the new link on
their next refresh. If the record came from Drupal, **Edit in Drupal ↗** opens the source
submission.

**You cannot add or remove a record once the day is open.** Adding one silently un-finishes
every A&R who already completed the day, including people already paid, who would suddenly
read 9 of 10. The server refuses it. If a record is unplayable and the link cannot be fixed,
leave it — A&Rs can flag it, and a flagged record counts as handled so it never blocks
anyone's bonus.

**Wrong date on a whole day?** A cold drop can be moved to another day — it re-times the
window and opens the drop immediately if that day's noon has already passed. There is no
button for it yet; ask and it runs against `/api/admin/daily/move`. Refused once the day has
opened or anyone has voted, and refused if the target day already has a drop.

---

## 6. The two buttons

Both are catch-up controls. Neither does anything the cron would not do on its own, and both
are safe to press more than once.

### Run the lifecycle now
Runs one tick of the same job the cron runs every five minutes. It does whatever is **due
right now** by the clock: opens a scheduled day at/after noon, closes and tallies at/after
noon the next day, publishes at/after 3:00 PM, drains the send queues, and retries the
results callback to makinitmag. If nothing is due, it does nothing.

Big tallies are capped at about 22 seconds per run and continue on the next press or tick, so
pressing it twice on a large day is normal and correct.

**Use it when:** a cron run was missed or late, the day needs to be tallied before the 2:00 PM
stream, or you want the queues drained now instead of within five minutes.

### Publish the day
Publishes the currently tallied day: renders the graphics, builds the captions, queues the
A&R digest, posts each record's outcome back to makinitmag, and flips the day to published —
**which is the moment results are revealed to everyone**. Then it runs a lifecycle tick.

- Refuses if the day has not finished tallying. Press **Run the lifecycle now** until it reads
  *Closed*, then publish.
- If the day is already published, it does not re-publish or re-send the digest — it drains
  what is still queued and re-renders the graphics.
- It does **not** send artist reports. Those are still held an hour.

**Use it when:** the 3:00 PM publish did not fire, or the graphics failed and you have fixed
the cause.

---

## 7. The emails

| Email | Who gets it | When |
|---|---|---|
| A&R digest | Everyone who chose **Daily Digest** in their notification settings | 3:00 PM publish |
| Artist report | Every artist whose record was rated and has an email on file | 4:00 PM |
| Artist text | Same, where there is a phone — inside the 10 AM–10:30 PM ET window | 4:00 PM or the next morning |

A&Rs pick their contact level in notification settings as **one choice**: None, Weekly, or
Daily Digest. It is not a pair of switches, so nobody can end up on both.

**Two things to know.** The daily digest is **off by default** — an A&R only gets it if they
picked it, which is why a low send count is usually correct rather than broken. And **Weekly
has no sender yet**: someone can choose it, but nothing goes out on that cadence.

> **Decided, not built.** The plan is to split this into three: a general **Daily Digest**
> (yesterday's scores plus the new drop, skipping anyone who voted), a transactional **A&R
> Results** email to everyone who voted (their own performance, no opt-in gate), and a
> **Weekly Digest** on Wednesdays with the week's top records and A&Rs plus a reminder of
> that night's live review. None of it exists yet — today the personal results still ride
> inside the daily digest, behind the opt-in.

---

## 8. Points, so you can answer the question when it is asked

- **Rating a record** scores on accuracy, exactly as in the live show (max 125 with a
  bullseye).
- **Completion bonus**, for handling every record in the day, tiered by when they finished:
  **100** within 6 hours of the open · **75** within 12 · **50** within 18 · **25** any time
  before the close (the steps are settings, see section 1). Paid once per person per day. Days with fewer than 3 records pay no bonus.
- **A flagged record counts as handled**, so reporting a dead link honestly never costs someone
  their bonus. Flags are capped at 3 per A&R per day (and always at least one below the day's
  size), so nobody can flag their way to the bonus.
- **Scouting** — an A&R who referred a record earns points scaled to how it scored: 250 per point
  of room average above 5.0, credited at tally. A record at or below 5.0 earns zero, never
  negative.
- **Live show bonus** — set `live_bonus` in the weekly room's settings (around **300**) or the
  broadcast barely registers next to a month of daily play. **Still unset.**

---

## 9. Troubleshooting

| Symptom | Do this |
|---|---|
| Console says **Nothing is staged** | Chase Drupal, and build the day by hand in the meantime. Do not wait |
| The day did not open at noon | **Run the lifecycle now**. If it stays scheduled, check `CRON_SECRET` and Vercel → Settings → Cron Jobs → View Logs |
| Stuck on **Processing** before the stream | **Run the lifecycle now** again — a large day takes several ticks by design |
| Results never published at 3 PM | **Run the lifecycle now**, then **Publish the day** |
| No cover for the stream | The recap graphics render live before publish — they are on the graphics card already |
| Digest emails have no graphics | `BLOB_READ_WRITE_TOKEN`, then **Publish the day** to re-render |
| A record has flags piling up | **Fix link**. If it cannot be fixed, leave it — flags do not block anyone |
| A whole day has the wrong date | Move it while it is still cold (§5) |
| Series line is red | Should be impossible. Report it; the day's points are reaching no board |
| Few people got the daily email | The daily digest is opt-in. That is intended — see §7 |
| Nobody has the Weekly option working | There is no weekly sender yet. Also intended, for now |
| An artist got their report twice | Report it. Every queue claims its rows; this is a bug, not a setting |

---

## 10. The rules that are enforced, not suggested

Worth knowing so a refusal is not a surprise:

- A day cannot be created without a series.
- A record cannot be added to a day that is already open.
- A day cannot be moved once it has opened or anyone has voted.
- A record with any votes cannot be deleted. Points on a cash-prize board are not undone.
- Records are never opened, closed or tallied one at a time on a daily drop — the whole day
  moves together.
- Support amounts are admin-only. They score nothing, rank nothing, and never reach a player.
- Only a platform admin can see or run this screen. A daily drop has no host owner, because
  the push carries every artist's email and phone number.
