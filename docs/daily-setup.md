# Setup guide — A&R Daily

A&R Daily runs on a clock, not on a button. Every day a set of records (4 to 16 — four drawn
at random from the free pool plus up to twelve paid) opens at **12:00 PM ET**, closes at
**9:00 AM ET** the next morning, tallies, and publishes results at **12:00 PM ET** — which is
also when the next day's records open. That coincidence is deliberate: the results email *is*
the "come back and play" email.

Nothing about that happens unless the pieces below are in place. This guide is the checklist.

---

## 1. Vercel Pro is required, and Hobby breaks the deploy

The lifecycle runs on a **five-minute** cron (`/api/cron/daily`).

> Hobby accounts are limited to daily cron jobs. This cron expression would run more than once per day.

Vercel does not quietly downgrade the schedule — it **fails the deployment**. If the project is
on Hobby, this will not deploy at all.

**Do this:** project → **Settings** → check the plan badge. On Hobby, upgrade to
[Pro](https://vercel.com/docs/plans/pro-plan).

Why five minutes and not hourly: it caps how late the noon open can be, and it is what sets
email throughput — the sends are governed by how *often* the job runs, not by how long each run
lasts (each run is capped at 30 seconds). Hourly would also mean the 9:00 AM close might not
happen until 9:59.

It is a separate cron from `/api/cron/artist-sms` **on purpose**. That handler returns early
whenever it is outside the 10 AM–10:30 PM ET text window, which would silently skip the whole
drop lifecycle for eleven and a half hours a day — including the 9:00 AM close.

---

## 2. `DAILY_INGEST_TOKEN` — the batch push from the review site

Drupal assembles and approves the day and pushes the approved set as one batch to
`POST /api/ingest/daily` with an `x-ingest-token` header.

**Without it the endpoint returns 503**, so Drupal cannot push a day. You can still stage one
by hand from the console (`POST /api/admin/daily/drop`, platform-admin only, same validation) —
which is also how you try the whole thing on a preview deployment, and what you reach for at
11:50 AM when Drupal is down.

It is a **separate secret** from `INGEST_TOKEN` because the blast radius is different: the
single-submission push stages one ignorable row, while this one creates a live day carrying up
to sixteen artists' email addresses and phone numbers. There is deliberately **no fallback** to
`INGEST_TOKEN` — sharing the secret would hand the lower-value integration this one's reach.

Generate one:

```bash
openssl rand -hex 32
```

Vercel → **Settings** → **Environment Variables** → add `DAILY_INGEST_TOKEN` for
**Production** (and Preview if you test there). Give the same value to whoever wires up the
Drupal side.

---

## 3. `CRON_SECRET`

Already needed for the artist texts (see `post-show-setup.md`). The daily cron uses the same
one. Without it, `/api/cron/daily` returns 503 and **the day never opens** — A&Rs see a
"records open at noon" screen forever.

---

## 4. `BLOB_READ_WRITE_TOKEN`

Hosts the Top 8 graphics that ride the daily results email.

If it is missing, the day **still publishes and results still reveal** — that is deliberate, a
stalled reveal is worse than a graphic-less email — but the digest goes out without its
graphics, and the console says so in amber on the "day's graphics" card. Fix it and press
**Publish the day** to re-render.

---

## 5. `NOTIFY_LINK_SECRET` — strongly recommended

Signs the one-click "manage your notifications" link in the footer of every daily email.
Without it, every footer degrades to a plain login link — tolerable on a weekly recap, bad on
something that sends every day.

```bash
openssl rand -hex 32
```

---

## 6. `PUBLIC_BASE_URL` — only if this is not the production host

Every link in a daily send is built by the cron, which has no incoming request to read a
hostname from, so it falls back to `https://anr.makinitmag.com`. On production that is correct
and you can skip this. On a preview or a staging deployment, set `PUBLIC_BASE_URL` or the
emails will point at production.

---

## 7. Tag the day into a series, or the points go nowhere

A drop **refuses to be created** untagged, and the console prints the series in red if it ever
ends up null. This is the whole unification premise: daily play feeds the same monthly board
and the same $500 as the live show. An untagged day would score people into a void.

Resolution order is explicit series → the active series → refuse.

---

## 8. Before you turn the daily email on for everyone

The `digest_daily` topic ships **default OFF**, and that is a decision, not an oversight.

Flipping the default to ON turns an opt-in list into a **daily** send to the entire registered
base — the largest sending change this project has ever made, and a daily unsolicited email is
how a sending domain gets throttled.

**Do it in this order:**

1. Run a week with a manual opt-in list (people who turned it on in their notification settings).
2. Confirm the Resend/Mandrill plan covers base size × 30 sends a month.
3. Watch the complaint rate.
4. Then flip the default — as its own one-line commit, so it is easy to see and easy to revert.

---

## 9. Set the live-show bonus, or the broadcast is decorative

A month of A&R Daily is roughly 15,000–45,000 points. One live show is a dozen records, around
2,900. Without `sessions.live_bonus`, the weekly broadcast barely registers on the leaderboard
it is supposed to headline.

**~300** makes one live show worth about three perfect async days. Set it per show in the room's
settings.

---

## Running the day

Almost never. The console opens on **A&R Daily** and the clock does the work.

| What you might do | Where |
|---|---|
| Fix a dead play link mid-window | **Fix link** on the record — the most useful button on the screen |
| Pull a record nobody has evaluated | Delete it; the numbering closes up behind it |
| Reject a comment before it reaches an artist | Within one hour of the noon publish — after that there is no unsend |
| A cron missed | **Run the lifecycle now** / **Publish the day** |
| Copy the caption for the Instagram carousel | **Copy caption** on the graphics card |

**The one thing worth checking daily:** the flag count next to each record. A flag is *one
A&R, not one click*, so three or four flags means three or four different people are telling
you the record will not play. Fix the link or pull the record.

---

## If something doesn't work

| Symptom | Cause | Fix |
|---|---|---|
| Deploy fails, "Hobby accounts are limited to daily cron jobs" | On Hobby | Section 1 |
| Console says **Nothing is staged** | Drupal has not pushed | Chase the review-site side. This is an incident — A&Rs open the app to an empty day |
| The day never opened at noon | `CRON_SECRET` missing, or the cron is not firing | Section 3; Vercel → Settings → Cron Jobs → **View Logs** |
| Records open but nobody can play one | Dead play link | The flag count will show it. **Fix link** |
| Results never published | Tally did not finish, or the cron stopped | Console → **Run the lifecycle now**, then **Publish the day** |
| Results published but the emails have no graphics | `BLOB_READ_WRITE_TOKEN` missing or the render failed | Section 4, then **Publish the day** to re-render |
| Nobody got the daily email | `digest_daily` is opt-in and nobody has opted in | Section 8 — that is the current, intended state |
| The series shows red on the console | The day is untagged; its points reach no board | Should be impossible (creation refuses) — tell me if you see it |
| An artist got their report twice | Should be impossible (every queue claims its rows) | Tell me — that is a bug, not a setting |
