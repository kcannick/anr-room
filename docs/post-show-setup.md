# Setup guide — post-show artist workflow + Asana post kit

Everything below is **already built and tested**. This is the wiring you do once, in the
dashboards, to turn it on. Roughly 20 minutes, plus a Drupal change you can do later.

Do them in order — **step 1 can block your deploy**, so check it first.

| # | Step | Where | Blocks what |
|---|------|-------|-------------|
| 1 | Confirm Vercel plan is **Pro** | Vercel | The whole deploy |
| 2 | Add `CRON_SECRET` | Vercel | Artist texts |
| 3 | Add `ASANA_TOKEN` | Vercel | Asana button |
| 4 | Confirm `BLOB_READ_WRITE_TOKEN` exists | Vercel | Report cards |
| 5 | Deploy | GitHub / Vercel | Everything |
| 6 | Paste the Asana project ID | A&R Room admin | Asana button |
| 7 | Send a test | A&R Room admin | — |
| 8 | Consent line + Drupal contact | Attorney / mim repo | Texts at volume |

---

## 1. Check your Vercel plan first — this one can break the deploy

The artist-text queue runs on an hourly [Vercel Cron job](https://vercel.com/docs/cron-jobs).
**Hobby accounts only allow one cron run per day**, and Vercel doesn't just downgrade the
schedule — an hourly expression **fails the deployment** with:

> Hobby accounts are limited to daily cron jobs. This cron expression would run more than once per day.

So if the project is on Hobby, deploying this will error out until you either upgrade or
remove the cron block.

**Do this:** open your project → **Settings** → check the plan badge.

- **On Pro?** Nothing to do. Continue to step 2.
- **On Hobby?** Either upgrade to [Pro](https://vercel.com/docs/plans/pro-plan), or tell me and
  I'll switch the schedule to once-daily — texts would then go out at a fuzzy time each morning
  (Hobby fires anywhere inside the hour), which is workable but worse.

Why hourly at all: the show ends at 11 PM, texts are held until 10 AM ET, and the cron is what
wakes up and releases them. It's a no-op every other hour of the day.

Reference: [Cron job usage & pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)

---

## 2. Add `CRON_SECRET` — this is what lets the texts send

Without it the queue endpoint returns 503 and **texts silently never go out**. Emails still work.

1. Generate a random string, 16+ characters — a
   [password generator](https://1password.com/password-generator/) is fine. It's not a password
   you'll ever type; you just need it to be unguessable.
2. Vercel → your project → **Settings** → **Environment Variables**
   ([docs](https://vercel.com/docs/environment-variables/managing-environment-variables))
3. Add:
   - **Key:** `CRON_SECRET`
   - **Value:** the random string
   - **Environments:** tick **Production**
4. Save.

You don't paste this anywhere else. Vercel automatically sends it as an `Authorization` header
when it triggers the job, and the endpoint checks it — that's the whole handshake. It exists so
nobody on the internet can hit the URL and flush your text queue.

Reference: [Securing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)

---

## 3. Add `ASANA_TOKEN`

1. Open the Asana developer console: **https://app.asana.com/0/my-apps**
   (or: profile photo → **My Settings** → **Apps** → **Manage Developer Apps**)
2. Create a **Personal Access Token**. Give it a description like `A&R Room post kit`.
3. **Copy it immediately — Asana shows it exactly once.** If you lose it, just create another.
4. Vercel → **Settings** → **Environment Variables** → add:
   - **Key:** `ASANA_TOKEN`
   - **Value:** the token
   - **Environments:** **Production**

Treat it like a password — it acts as *you* in Asana. That's exactly why it lives in Vercel's
environment variables (encrypted at rest) and **not** in the A&R Room's own settings screen: a
token stored there would be readable by any admin who opens the Platform panel.

Reference: [Asana personal access tokens](https://developers.asana.com/docs/personal-access-token)

---

## 4. Confirm `BLOB_READ_WRITE_TOKEN` is already there

This should already exist — it's what recap emails use to host graphics. The artist report cards
use the same thing.

Vercel → **Settings** → **Environment Variables** → confirm `BLOB_READ_WRITE_TOKEN` is listed.

If it's missing, **Send artist notices** stays greyed out and tells you so.

---

## 5. Deploy

Environment variables **only apply to new deployments** — adding them does nothing to what's
already running. (This is the same thing that bit us with `ANALYTICS_TOKEN`.) So deploy *after*
steps 2–4, not before.

Merge to `main`, or hit **Redeploy** on the latest deployment in Vercel.

The deploy runs migration `026`, which adds artist email/phone to songs and creates the text
queue. It's additive — nothing existing changes.

**Check it worked:** Vercel → **Settings** → **Cron Jobs**. You should see
`/api/cron/artist-sms` running hourly. If the deploy failed, re-read step 1.

---

## 6. Paste the Asana project ID

1. Open the Asana project you want the tasks to land in.
2. Look at the URL: `https://app.asana.com/0/1209876543210987/list` — the long number is the
   project ID.
3. A&R Room admin → **Platform** → **System settings** → **Asana post task** → paste it → **Save settings**.

You'll get a green **"Asana post task: ON — project …"** readout. If it's amber, it tells you
exactly which half is missing (token vs project).

---

## 7. Send a test

On any completed room, the **Room** panel now has two new blocks.

**Artist notices** shows you, before you send:

```
email · 2 of 11 artists reachable   9 missing
text  · 6 reachable — 6 queued, holds until 10 AM ET
status · 0 sent / 0 pending
```

Click **📨 Send artist notices**. Each artist with an email gets their full 3-page report card,
the replay link, and post instructions. Texts queue for the window.

**A good first test:** put your own email and phone on one song (see below), send, and check
what lands.

### Missing contact? Add it after the show

This is the part to know. In the **Rounds** tab, every played round now has an **✎** button —
including ratified ones. Rounds with no contact are flagged **⚠**.

Click **✎**, add the artist's email/phone, **Save**, then send (or re-send) notices. Already-sent
artists are skipped automatically, so re-sending is safe.

Editing a ratified round only touches the description and contact — **votes, scores and points
are locked and cannot be changed there.**

---

## 8. Two things still open

**a) Text consent (attorney).** The 10 AM–8 PM ET window is built and enforced. What's *not*
built is the legal basis for texting artists at all. The submission form needs an explicit line
like *"you agree to receive a text and email when your song is played."* Worth bundling with the
other open attorney items. Emails are unaffected — send those today.

**b) Drupal contact hand-off (mim repo).** The review site's "Send to A&R Room" button can pass
the submitter's email and phone along with the song, so contact is already filled in before the
song is played. Until then you type it in the queue form or add it retroactively. Small change —
say the word and I'll do it.

---

## If something doesn't work

| Symptom | Cause | Fix |
|---|---|---|
| Deploy fails, "Hobby accounts are limited to daily cron jobs" | On Hobby | Step 1 |
| **Send artist notices** greyed out | No Blob token, or no artist has contact | Step 4, or add contact in **Rounds** |
| Emails sent, texts never arrive | `CRON_SECRET` missing, or still before 10 AM ET | Step 2; check Vercel → Settings → Cron Jobs → **View Logs** |
| **Create Asana task** greyed out | Missing token or project ID | The amber line under it names which |
| Artist says they got nothing | They had no contact on file | **Rounds** tab → ⚠ → **✎** → add → re-send |
| Caption has names instead of @handles | That A&R has no Instagram on their profile | Expected — it falls back to their name so you can see who to chase |

Text queue stuck? Vercel → **Settings** → **Cron Jobs** → **View Logs**. A healthy run outside the
window logs `{"skipped":"outside the ET send window"}` — that's correct, not an error.
