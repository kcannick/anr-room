# Operator manual — A&R Daily

How to run the daily console day to day. One-time setup (env vars, Vercel Pro, the Drupal
token) lives in **[daily-setup.md](daily-setup.md)** — do that first, once. This document is
what you use afterwards.

**The short version:** the day runs on a clock, not on a button. On a normal day your only job
is to stack tomorrow's records and glance at the flag counts. Everything on this screen exists
for the days that are not normal.

---

## 1. The day, start to finish

| ET time | What happens | Who does it |
|---|---|---|
| Any time before noon | Tomorrow's records are staged (Drupal push, or you build them by hand) | Drupal / you |
| **12:00 PM** | The day opens. Every record goes live at once. A&Rs rate and predict | The cron |
| 12:00 PM → 9:00 AM | The 21-hour window. A&Rs play whenever they want | — |
| **9:00 AM** next day | Rating closes. The day tallies (may take several cron ticks) | The cron |
| 9:00 AM → 12:00 PM | Results are **held**. Tallied but sealed — nobody sees an average yet | — |
| **12:00 PM** next day | Results publish, graphics render, the A&R digest queues — and the next day opens in the same minute | The cron |
| **1:00 PM** (publish + 1 hour) | Artist reports and artist texts start going out | The cron |

That last coincidence is deliberate: the results email *is* the "come back and play" email.

The one-hour hold before artist reports is your **only** window to reject an A&R comment.
After that there is no unsend.

### The five states

The pill at the top right of the console:

| Pill | State | Meaning |
|---|---|---|
| Scheduled | `scheduled` | Staged, not open yet. Records can still be added or removed |
| Window open | `open` | A&Rs are playing. Records can be fixed but **not** added or removed |
| Tallying | `closing` | Scoring in progress, one record at a time across cron ticks |
| Tallied · results held | `ratified` | Scored, waiting for noon |
| Published | `published` | Results are out; the send queues are draining |

---

## 2. The console screen, card by card

The console opens on **A&R Daily**. The mode switch at the top left goes to **Live show** (the
weekly broadcast) and **Platform**.

### "Nothing is staged" (red card)
No day exists. **This is an incident, not an empty state** — A&Rs open the app to nothing to do.
Either Drupal has not pushed, or the push failed. Build a day by hand in the builder card below
rather than waiting.

### The day
Records · A&Rs playing · Finished · Closes/Results, plus the schedule line and the series.

**If the series line is red, stop and fix it.** An untagged day scores people into a void — its
points never reach the monthly board or the $500. This should be impossible (a day refuses to be
created untagged); if you ever see it, report it.

"Finished" counts A&Rs who completed the whole day and were paid the completion bonus.

### The hold (amber card)
Appears after publish, while artist reports are held: *"N A&R comments go to artists in M
minutes."* Comments ship **by default** with the artist's report, carrying the A&R's name — your
job is to reject the bad one, not approve the good ones. See §4.

### The records
One row per record: title/artist, play link, votes, **flags**, and an Edit / **Fix link** button.
Rows turn red when a record has no play link or three or more flags.

**A flag is one A&R, not one click.** Three flags means three different people are telling you
that record will not play. That is the number worth checking every day.

### Sending
Four columns — Sent / Failed / Pending — for the A&R digest, artist reports, and artist texts,
plus the two manual buttons (§5). Nothing sends until the day publishes; after that the cron
drains a chunk every five minutes and these numbers move on their own. Texts obey the
10 AM–10:30 PM ET window; outside it the pill tells you when the window reopens.

### The day's graphics
Top 8 A&Rs and Top 8 Songs, rendered at publish, plus **Copy caption** for the Instagram
carousel. If they show amber ("did not render"), the day still published on purpose — a stalled
reveal is worse than a graphic-less email. Fix the cause and press **Publish the day** to
re-render.

Below them, **The A&R Meeting Recap**: the noon stream's Instagram Live cover (9:16) and
YouTube thumbnail (16:9), with the stream date large, and the day's artists and A&Rs filled
in. Click either to open it full size; the download name carries the date. **Copy recap
caption** gives the stream's caption with the same names.

- Artists are in drop order and A&Rs are alphabetical. Nothing on the cover is ranked — the
  stream is the reveal, and the cover goes up before it.
- Artists print by Instagram handle when the submission had one, otherwise by name, so a
  name instead of a handle means nobody gave us the handle.
- Names are set like credits on a poster: small, muted, sized so the longest name fits. A
  name is never cut short unless it would not fit even at the smallest size.
- They are hosted at publish like the Top 8 cards. Before publish, or if hosting failed, the
  console renders them live instead, so there is always a cover to post. Before the day
  tallies the A&Rs column is empty.

### Build the next drop
Always visible, because stacking tomorrow and fixing today are different jobs on the same
screen. Add records one at a time; the day is created around the first one.

- **Required:** record title and a full http(s) play link. A record nobody can hear is a dead
  record for the whole 21-hour window.
- **Artist email** is what earns that artist their free report. The ⚠ in the list means no
  contact on file — that artist gets nothing.
- **Day** is blank by default, meaning "the next day being built". Only fill it to work on a
  specific date (`YYYY-MM-DD`, within 3 days of today).
- **Edit** / **Remove** work on any staged record right up until noon.
- **Pushed for the wrong day?** If the noon lock-in on the review site is pressed after 12:00,
  the push is dated tomorrow and today has no drop. Renaming the session or changing its
  scheduled start does nothing — a drop runs off its own day and window. A day that has not
  opened can be moved: `POST /api/admin/daily/move` with `{ "fromDay": "YYYY-MM-DD",
  "toDay": "YYYY-MM-DD" }` (platform admin). The open, close and results times move with it,
  and if the new day's noon has already passed the drop opens right away. A day that is
  already open never moves. (A console button for this is the next step.)
- A typical day is 4 free records plus up to 12 paid. The hard ceiling is 24; the counter shows
  where you are, not a target.

---

## 3. Fixing a record mid-window

**Fix link** is the most useful button on this screen. A dead link at 12:05 PM is a dead record
for 21 hours, and nobody is watching the way a host watches a live show.

You can change the **play link** and the **from the artist** note. That is all — descriptive
fields only, never votes or scores. Every A&R sees the new link on their next refresh. If the
record came from Drupal, **Edit in Drupal ↗** opens the source submission.

**You cannot add or remove a record once the day is open.** Adding one silently un-finishes
every A&R who already completed the day, including people already paid, who would suddenly read
9 of 10. The server refuses it. If a record is unplayable and the link cannot be fixed, leave it
— A&Rs can flag it, and a flagged record counts as handled so it never blocks anyone's bonus.

---

## 4. Rejecting an A&R comment

Comments ship by default and there is no unsend. The window is the hour between the noon publish
and the first artist reports.

1. Mode switch → **Live show** → open the session named **A&R Daily — YYYY-MM-DD**.
2. **Rounds** tab → the 💬 badge on a record shows how many comments are going to that artist.
3. Click it, reject anything that should not ship.
4. A rejected comment stays rejected even if the A&R edits it.

---

## 5. The two buttons

Both are catch-up controls. Neither does anything the cron would not do on its own, and both are
safe to press more than once.

### Run the lifecycle now
Runs one tick of the same job the cron runs every five minutes. It does whatever is **due right
now** by the clock: opens a scheduled day at/after noon, closes and tallies at/after 9 AM,
publishes at/after noon, and drains the send queues. If nothing is due, it does nothing.

Big tallies are capped at about 22 seconds per run and continue on the next press or tick, so
pressing it twice on a large day is normal and correct.

**Use it when:** a cron run was missed or late, or you want the queues drained now instead of
within five minutes.

### Publish the day
Publishes the currently tallied day: renders the Top 8 graphics and the Meeting Recap cover and
thumbnail, builds both captions, queues the A&R digest, and flips the day to published — **which is the moment results are revealed to
everyone**. Then it runs a lifecycle tick.

- Refuses if the day has not finished tallying ("the day is `closing` …"). Press **Run the
  lifecycle now** until it reads *Tallied · results held*, then publish.
- If the day is already published, it does not re-publish or re-send the digest — it just drains
  what is still queued and re-renders the graphics.
- It does **not** send artist reports. Those are still held an hour.

**Use it when:** the noon publish did not fire, or the graphics failed and you have fixed the
cause.

---

## 6. Points, so you can answer the question when it is asked

- **Rating a record** scores on accuracy, exactly as in the live show (max 125 with a bullseye).
- **Completion bonus**, for handling every record in the day, tiered by when they finished:
  **100** before 3 PM · **75** before 6 PM · **50** before 9 PM · **25** after that. Paid once
  per person per day. Days with fewer than 3 records pay no bonus.
- **A flagged record counts as handled**, so reporting a dead link honestly never costs someone
  their bonus. Flags are capped at 3 per A&R per day (and always at least one below the day's
  size), so nobody can flag their way to the bonus.
- **Scouting** — an A&R who referred a record earns points scaled to how it scored: 250 per point
  of room average above 5.0, credited at tally. A record at or below 5.0 earns zero, never
  negative.
- **Live show bonus** — set `live_bonus` in the weekly room's settings (around **300**) or the
  broadcast barely registers next to a month of daily play.

---

## 7. Troubleshooting

| Symptom | Do this |
|---|---|
| Console says **Nothing is staged** | Chase Drupal, and build the day by hand in the meantime. Do not wait |
| The day did not open at noon | **Run the lifecycle now**. If it stays scheduled, check `CRON_SECRET` and Vercel → Settings → Cron Jobs → View Logs |
| Stuck on **Tallying** | **Run the lifecycle now** again — a large day takes several ticks by design |
| Results never published | **Run the lifecycle now**, then **Publish the day** |
| Emails have no graphics | `BLOB_READ_WRITE_TOKEN`, then **Publish the day** to re-render |
| A record has flags piling up | **Fix link**. If it cannot be fixed, leave it — flags do not block anyone |
| Series line is red | Should be impossible. Report it; the day's points are reaching no board |
| Nobody got the daily email | `digest_daily` is opt-in and off by default. That is intended — see daily-setup.md §8 |
| An artist got their report twice | Report it. Every queue claims its rows; this is a bug, not a setting |

---

## 8. The rules that are enforced, not suggested

Worth knowing so a refusal is not a surprise:

- A day cannot be created without a series.
- A record cannot be added to a day that is already open.
- A record with any votes cannot be deleted. Points on a cash-prize board are not undone.
- Records are never opened, closed or tallied one at a time on a daily drop — the whole day
  moves together.
- Only a platform admin can see or run this screen. A daily drop has no host owner, because the
  push carries every artist's email and phone number.
