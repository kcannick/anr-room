# Integration spec — makinitmag.com → A&R Daily

**Audience:** the session building the submission system on makinitmag.com (Drupal).
**Status of the other side:** **LIVE on anr.makinitmag.com** as of 2026-09-09, including the
§12 results callback and §13 reference tracks. Everything below is what the deployed code does;
every field name, limit and status code was read out of `server.js`, not out of a plan.

**What you are integrating with:** A&R Daily — a set of 4–16 records opens at 12:00 PM ET, A&Rs
rate each one 0–9 and predict the average, the window closes 9:00 AM ET the next day, and
results publish at 12:00 PM ET. The app has no idea how submissions are collected, priced, or
chosen. **That is entirely yours.**

---

## 1. The boundary — who owns what

| Drupal owns | The app owns |
|---|---|
| Submission form, payment, pay-what-you-want ($10–$100) | The day, once pushed |
| The free pool and its aging | Rating, prediction, scoring |
| Choosing the day's records (4 random free + up to 12 paid, weighted by amount) | The tally, the leaderboard, the $500 board |
| The operator's approve-the-day screen | Both result emails and the artist's Song Report |
| Issuing scouting links and administering non-points rewards | Scouting **points** |
| The public artist profile page | Nothing about artists beyond what you push |

**No selection, pricing or pool logic exists in the app and none should be added.** A shadow copy
is how two systems stop agreeing. The app receives an approved list and runs the day.

---

## 2. The daily batch push — the main integration

### Request

```
POST https://anr.makinitmag.com/api/ingest/daily
Content-Type: application/json
X-Ingest-Token: <DAILY_INGEST_TOKEN>
```

**Server-to-server only.** No CORS headers and no `OPTIONS` handler on this route — it is not
callable from a browser. Call it from PHP.

**Auth is the header only.** `?token=` and `body.token` are not read here (they exist on the
older single-submission route; not on this one). The token is compared in constant time.

**It does NOT fall back to `INGEST_TOKEN`.** That fallback existed and was removed deliberately:
`INGEST_TOKEN` guards a push that stages one row a host can ignore, while this one creates a live
room carrying up to sixteen artists' email addresses and phone numbers. Sharing the secret gives
the lower-value integration this one's blast radius.

- `DAILY_INGEST_TOKEN` unset on the app → **503** `{"error":"Daily ingest not configured…"}`
- Wrong or missing token → **401** `{"error":"Bad token"}`

### Body

```json
{
  "day": "2026-09-08",
  "name": "A&R Daily — Sep 8",
  "seriesId": "ser_abc123",
  "songs": [ /* 1..24 song objects, see below */ ]
}
```

| Field | Required | Notes |
|---|---|---|
| `day` | no | `YYYY-MM-DD`, **ET calendar day**. Defaults to ET today. Must be within 3 days of ET today — a typo that would create a drop in 2027 is rejected rather than sitting invisible until it opened. |
| `name` | no | Display name. Defaults to `A&R Daily — <day>`. |
| `seriesId` | no | Resolves explicit → the one `status='active'` series → **409 refuse**. See §6; this one bites. |
| `songs` | **yes** | Array, 1–24. **The norm is 4–16**; 24 is a sanity ceiling on a bad push, not a target. |
| `opensAt` / `closesAt` / `resultsAt` | no | Epoch ms overrides for the window. **For testing only** — omit in production and let the ET schedule apply. |

### The song object

```json
{
  "ref": "node/9182",
  "url": "https://makinitmag.com/node/9182",
  "title": "Neon Skyline",
  "artist": "The Verge",
  "instagram": "theverge",
  "profileUrl": "https://makinitmag.com/artist/the-verge",
  "email": "verge@band.com",
  "phone": "(305) 555-0142",
  "note": "Hey, this isn't mixed. Just recorded it on Bandlab last night.",
  "playUrl": "https://cdn.makinitmag.com/review/9182.mp3",
  "scout": { "uid": "4471", "email": "andre@example.com" }
}
```

| Field | Required | Limit | Behaviour |
|---|---|---|---|
| `title` | **YES** | 200 | Missing → the whole batch is rejected. |
| `playUrl` | **YES** | 500, `http(s)://` only | Missing or non-http → the whole batch is rejected. A record with no playable link is dead for the entire 21-hour window. Also accepted as `play_url`. |
| `artist` | no | 200 | |
| `instagram` | no | 60 | Leading `@` stripped. Drives the **Follow** button after an A&R locks in. |
| `profileUrl` | no | 500, http(s) | **PUBLIC** artist profile. Drives the **Artist profile** button. Absent → the button is not rendered. Also `profile_url`. |
| `email` | no | 200 | Must look like an email or it nulls out (see warnings). Without it the artist gets no Song Report. |
| `phone` | no | 7–15 digits | Same — nulls out rather than failing the row. |
| `note` | no | 500 | **The artist's own CONTEXT, not a question.** See §4. Also accepted as `ask`. |
| `ref` | no | 100 | Your node/submission id. **Must be unique within the batch** or the batch is rejected. Stored for audit and for update-by-ref. |
| `url` | no | 500, http(s) | Deep link back to the submission node. **PRIVATE — platform-admin only.** See §5. |
| `scout.uid` | no | 60 | The referring A&R's **Drupal uid**. See §3. |
| `scout.email` | no | 200 | The referring A&R's email, used once to link accounts. See §3. |

Unknown fields are ignored. Field names are accepted in both camelCase and snake_case where
noted; prefer camelCase.

### Validation is ALL-OR-NOTHING

One bad row rejects the entire batch and **creates nothing**:

```
400 {"error":"Batch rejected","rejected":[{"index":4,"field":"playUrl","reason":"required, must be http(s)"}]}
```

`index` is the zero-based position in your `songs` array. Render these inline on the approval
screen. The operator approved a specific set and is looking at that page — a silently short day
that nobody notices until noon is worse than a red error they can act on.

Unusable contact is **not** fatal. It nulls out and comes back as advisory:

```
200 {"ok":true,…,"warnings":[{"index":2,"field":"email","reason":"unusable"}]}
```

Surface those too — an artist with a mistyped address gets no report and nobody finds out.

### Success

```json
{ "ok": true, "replaced": false, "sessionId": "e7iOi_Su2dnf", "day": "2026-09-08",
  "rounds": 11, "opensAt": 1757347200000, "closesAt": 1757422800000,
  "resultsAt": 1757433600000, "seriesId": "ser_abc123", "warnings": [] }
```

**Artist email and phone are never echoed back.** They arrived over this wire; that does not make
them safe to reflect. Titles and artists only.

### Re-pushing the same day

| State of that day | Result |
|---|---|
| No drop exists | Created. `replaced: false` |
| Exists, still `upcoming`/`scheduled`, **zero votes** | **Record set replaced in place.** `replaced: true`, same `sessionId`. Newest push wins. |
| Exists and is open, or anyone has voted | **409** `{"error":"Today's drop is already in play","sessionId":"…","votes":3}` |

So the approval screen can be pressed repeatedly before noon and stays correct. After the window
opens, it is refused — those points are somebody's score on a cash-prize board.

**The operator's escape hatch:** soft-deleting the room in the app frees the day, and a fresh push
then succeeds. A partial unique index on `drop_day` (excluding soft-deleted rows) is the real
guard, so two simultaneous pushes race on the constraint and the loser gets the same 409.

---

## 3. Scouting attribution — what you must build

A&Rs recruit artists. The referral is the **Drupal uid**, and **Drupal issues the link**, because
the A&R is logged in on your side and no account linking is needed for a link to exist:

```
https://makinitmag.com/opportunities/anr-meeting?a=<drupal_uid>
```

### Capture, in priority order

1. **URL parameter** — `?a=<drupal_uid>` for an artist who submits without ever registering.
2. **Cookie** — set when the `?a=` link is first followed, so an artist who comes back later is
   still attributed to the A&R who invited them.
3. **The submitting account's own referrer** — for a registered artist arriving with no link,
   using the `referred_by` on their Makin' It account.

**Source 3 applies only when the referring user is an A&R.** A regular user inviting a friend is
not scouting, and without this condition every ordinary account referral silently becomes
scouting credit.

The referral is **permanent**: an account created through an A&R's link stays attached to that
A&R, shows "invited by" on the artist's profile, and every future submission attributes back.

### What to send, and why both fields

Send `scout.uid` **and** `scout.email` on every song that has a referrer.

- `scout.uid` is stored on the round **unconditionally**, even when no A&R Team account matches.
  Your ambassador and promo-budget reporting reads it and must not depend on the app having
  resolved the person.
- `scout.email` bootstraps the account link: the app matches it against its own `users.email` and,
  on first match, writes `users.drupal_uid` permanently. No handshake, no connect UI — the mapping
  accumulates through normal use. Without the email, an A&R who has never been linked earns no
  points (attribution still records).

### Two counts that will differ, deliberately

Drupal should count **every submission** an A&R scouted — that measures promotional effort and is
the right basis for ambassador tiers and promo budget. The app awards points only for records that
**make a drop and score well** (floor 5.0, 250 points per point above it) — that measures taste.
They will not match. Do not reconcile them.

---

## 4. The artist's note is context, not a question

This field is the differentiator of the whole review, and it is easy to build the wrong form
control for it. It is **context that tells an A&R how to hear the record**:

> "Hey, this isn't mixed. Just recorded it on Bandlab last night."
> "I've been working on this for 7 months. We've mixed it 5 times. I think this is the one."

It is **not** a question the A&R is answering. The app labels it "From the artist", shows it above
the rating, and keeps the comment prompt general. Label your form field accordingly — a prompt
reading "What would you like feedback on?" produces the wrong kind of text.

500 characters. Sent as `note` (`ask` is accepted for backward compatibility).

---

## 5. Two URLs that look interchangeable and are not

- **`url`** — the deep link to the submission node. It reaches a page carrying the submitter's
  contact details, so the app treats it as **platform-admin only** and surfaces it as an
  "Edit in Drupal" affordance in the console. Never rendered to a player.
- **`profileUrl`** — the artist's **public** profile page. Rendered as a button to every A&R after
  they lock in a rating.

Sending an admin URL in `profileUrl` would publish artist contact details to every player. Keep
them separate on your side and make sure the profile page is genuinely public.

---

## 6. `seriesId` — the failure that is silent

A drop **must** be tagged into a series or its points never reach the $500 board. That is the
whole premise of the daily drop, and it fails quietly: the day runs, records get rated, points
compute, and none of it reaches the leaderboard.

Resolution: explicit `seriesId` → the app's one `status='active'` series → **409 refuse to create
the day**. Refusing is deliberate — an untagged day is worse than no day.

Simplest correct integration: **omit `seriesId`** and let the app resolve the active series. Send
it explicitly only if the operator runs overlapping series. Either way, **echo `seriesId` back on
the approval screen** so a null is visible before noon rather than after.

---

## 7. Play links — what makes a good one

The play link is the product. An A&R listens there, not on a stream.

- **A bare audio file plays inline.** Detected by extension on the URL **pathname**
  (`.mp3 .m4a .aac .wav .ogg .oga .opus .flac .weba`), so a signed CDN link like
  `…/song.mp3?X-Amz-Signature=…` still works. Anything else opens in a new tab.
- **Serve audio files inline, not as a download.** `Content-Disposition: attachment` makes the
  browser download the file and play nothing.
- **An extensionless audio URL falls back to opening out.** It still works; it is just a worse
  experience. Add the extension if you control the path.
- **Signed URLs must outlive the window.** Minimum 24 hours from the noon open; 36 is safer.
  A link that expires at 9 PM kills the record for everyone who plays after that.
- **The link must not change or disappear mid-window.** Half the A&Rs rating a record and half
  hitting a 404 corrupts the average. If artists can delete or unpublish a submission, freeze the
  asset when the day is approved.
- DSP pages (Spotify, SoundCloud, Apple, Audiomack, Bandcamp) are fine and open out. Note the
  artist can see play counts and can pull the track — a hosted file avoids both.

The app has a **Report a track** control (`not_playable` / `other`, capped at 3 per A&R per day)
that surfaces dead links in the console, and the operator can fix a `play_url` mid-window. That is
a safety net, not a substitute for links that hold.

---

## 8. The single-submission push (live show) — already built, now carries more

`POST /api/ingest/submission` is the **existing** route for the Wednesday broadcast: it stages one
record into the host's console. It is unchanged in shape but now accepts the same descriptive
fields, and **should be updated to send them**:

`title`, `artist`, `instagram`, `email`, `phone`, **`note`**, **`playUrl`**, **`profileUrl`**,
**`ref`**, **`url`**, **`scout.uid`**

Auth: `X-Ingest-Token: <INGEST_TOKEN>` (the *other* secret) or `body.token`. CORS is allowed from
`makinitmag.com` / `www.makinitmag.com`, because this one is called from a browser button.

**Why it matters:** the artist's note has never reached the room at all. The host reads it on air
so the room listens from an informed perspective, and until now it only existed on your form.

Note `scout.email` is **not** read on this route — account linking happens on the daily batch only.

---

## 9. Secrets

| Name | Where | Notes |
|---|---|---|
| `DAILY_INGEST_TOKEN` | Vercel env on the app; your side stores the same value | Batch push. Separate from `INGEST_TOKEN` by design. Unset → 503. |
| `INGEST_TOKEN` | already configured | Single-submission push. Unchanged. |

Generate with `openssl rand -base64 32`. Store on your side wherever you keep API credentials —
**not** in the app's settings table, and not in a repo.

---

## 10. How to test without touching a real day

1. **Push a day dated tomorrow** with 4–5 records. It is created `upcoming` and opens at noon ET —
   nothing is visible to A&Rs before then.
2. **Push it again** with a different set. Expect `replaced: true` and the same `sessionId`.
3. **Push a deliberately bad batch** — one row with no `title`, one with `playUrl: "ftp://x"` —
   and confirm you render `rejected[]` inline and that nothing was created.
4. **Push a duplicate `ref`** twice in one batch and confirm rejection.
5. **Check the response for `@`** — assert your logs never contain an artist address echoed back.
6. Ask the operator to soft-delete the test day when you are done, which frees the date.

If the app's staging deployment is available, point at that host first. The operator can also
hand-stage a day in the console (`/api/admin/daily/drop`, same validation, same idempotency), so
your push can be compared against a known-good day.

---

## 11. Failure modes, and what each looks like

| Symptom | Cause |
|---|---|
| 503 "Daily ingest not configured" | `DAILY_INGEST_TOKEN` unset on the app. Operator, not you. |
| 401 "Bad token" | Wrong secret, or sent as `body.token` instead of the header. |
| 400 "day must be YYYY-MM-DD" | Sending a timestamp or a localized date. It is an **ET calendar day**. |
| 400 "day is too far from today" | More than 3 days out — usually a year typo. |
| 400 "Batch rejected" | Read `rejected[]`. Almost always a missing `playUrl`. |
| 409 "already in play" | The window opened or someone voted. Operator must soft-delete to rebuild. |
| 409 "No active series" | No `status='active'` series on the app. Operator, not you — but you will see it. |
| Day runs, nobody scores on the board | The day was tagged into no series. Check the echoed `seriesId`. |
| Records rated but the artist got nothing | `email` was unusable. Check `warnings[]` from that push. |

---

## 12. Results callback — app → Drupal (BUILT)

Requested by the makinitmag side 2026-09-08, accepted, and **built 2026-09-09**. Reason it is right: without it the only
way your side learns a record was reviewed is the clock passing 9 AM, so a rated record and one
that sat behind a dead link look identical, and the artist status page can only promise a report
rather than confirm one.

### The one change: it fires at NOON (publish), not 9 AM (ratification)

You offered either. **Take noon.** The reason is not visible from your side:

**The day tallies at 9:00 AM but results do not reach the A&Rs until 12:00 PM.** That three-hour
gap is deliberate — `sessions.async_state` has a whole state (`ratified`, distinct from
`published`) that exists only to hold it. Handing you room averages at 9 AM means the numbers are
live on an artist status page three hours before the people who *did the rating* receive them.
Any A&R who also submits a record would see the day's results early, and that is the same seal
that keeps vote direction hidden during the window.

Sending at noon also lines up with reality on our side: the artist's Song Report is queued at
publish and held one hour, so "report sent" and the callback describe the same moment.

**One call, not two.** A 9 AM status-only call plus a noon call with averages is more moving parts
for three hours of lead time on a page nobody is watching at 9 AM.

### Request we will send

```
POST https://makinitmag.com/api/anr-meeting/results
Content-Type: application/json
X-ANR-Key: <RESULTS_TOKEN>
```

```json
{
  "day": "2026-09-09",
  "sessionId": "e7iOi_Su2dnf",
  "publishedAt": 1757433600000,
  "records": [
    { "ref": "entry/88213", "status": "rated",         "ratings": 23, "reports": 0, "average": 6.4 },
    { "ref": "entry/88217", "status": "not_playable",  "ratings": 0,  "reports": 3 },
    { "ref": "entry/88220", "status": "unrated",       "ratings": 0,  "reports": 0 }
  ]
}
```

### Status is derived, and here is exactly how

So neither side has to guess:

| `status` | Condition |
|---|---|
| `rated` | `room_average` is not null — which requires at least one locked-in rating |
| `not_playable` | no `room_average` **and** at least one A&R filed a `not_playable` report |
| `unrated` | no `room_average` and no reports — it was simply never rated |

`ratings` is the count of locked-in ratings (votes with a taste value). `average` is the room
average to one decimal, sent only on `rated`. `reports` is the count of A&Rs who reported the
record as not playable — sent always, because a record can be **both** rated and reported (the
link died partway through the day) and that is worth showing on your side.

### Two absences you must handle

- **Records with no `ref` are omitted.** The operator can hand-add a record in the console when
  Drupal is down; those have no `ingest_ref` and cannot be matched to anything on your side.
- **A record the operator PULLED mid-window is absent entirely.** Fixing a dead link is the most
  common intervention, but pulling the record is the fallback, and a deleted round is gone.

So: **match on `ref`, and treat "was in the day I pushed but absent from the callback" as pulled,
not as pending.** If you would rather not infer that, say so and we will keep a tombstone and send
an explicit fourth status — it is a small change but it is not free, so we would rather you ask
for it than have us guess.

### `reportUrl`: no, omit it

There is no web version of the Song Report. It is rendered as PNGs and emailed to the artist —
`songReportData()` feeds image generation only, behind host auth. Nothing to link to. If a public
report page is ever built, this field is where it goes.

### Delivery semantics on our side

Your side is idempotent and returns `200 {"ok":true,"updated":N}` / `404` — good, that is what
makes the rest of this safe.

- **The callback runs AFTER the publish completes, never before it.** The day publishing must not
  depend on makinitmag being reachable; a daily job that stalls on an external host is exactly the
  coupling worth avoiding.
- **Short timeout (10s), and failure is non-fatal.** Logged, not thrown.
- **Retried on the next cron tick** until it succeeds, from a `results_pushed_at` marker on the
  session. The cron runs `*/5`, so a transient outage costs minutes.
- **We stop retrying after ~2 hours** and log loudly rather than hammering you all day.
- A `404` from you is treated as terminal, not retryable — it means the day is unknown on your
  side, which retrying cannot fix.

### What the operator must set

| Env var | Value |
|---|---|
| `RESULTS_CALLBACK_URL` | `https://makinitmag.com/api/anr-meeting/results` |
| `RESULTS_CALLBACK_TOKEN` | the `RESULTS_TOKEN` you supply |

**Unset ⇒ the callback is simply not attempted** and the day publishes exactly as it does now.
That is deliberate: a preview deployment with no token must not post into production Drupal.

---

## 13. Reference tracks — records that will never appear in your data

The operator can hand-add a **reference track**: a known record from a major artist, dropped into
a day so A&Rs have something familiar to rate. It is fully votable and fully scored — that is the
point — but it is not a submission under review, so it is excluded from every chart, the Top 8
card, the Instagram carousel, and the artist report queue.

**Nothing changes on your side, and that is the point.** A reference track is added in the console
and carries no `ref`, so:

- it is never in a batch you push,
- it never appears in the §12 callback,
- your record count for a day may be **smaller than the number of records A&Rs actually rated**.

Do not treat that gap as an error. If you show "N records reviewed today" anywhere public, count
what you pushed, not what the day contained.

One behaviour worth knowing: **a reference track survives a re-push.** A re-push replaces every
record that came from you and leaves hand-added reference tracks in place, renumbered to sit after
your batch. So the operator can add one at any point and your "push again" button stays safe.

---

## 14. Open items — who owns each

**Confirmed by makinitmag 2026-09-08, nothing further needed:** one POST from PHP at 10:00 AM ET
with `day` = ET today; `rejected[]`/`warnings[]` rendered inline plus a pre-flight of the same
rules; 409 handled; public profiles at `makinitmag.com/@username` with `profileUrl` omitted for
guest submitters; MP3s public, inline, `.mp3` on the pathname, no expiry, undeletable once
submitted; DSP links pass through and the MP3 wins when both exist; `scout` as `{uid, email}` on
referred records only; `ref` = `entry/<id>`, stable across re-pushes; `url` private and
`profileUrl` public; no amounts, lane or weight sent. Note capped at 320 chars — inside our 500,
so nothing to change.

**On us (this repo):** done.
- §12 callback built (migration 035), with the retry semantics above and 1,266 tests green.
- Reference tracks built (§13).
- `docs/daily-setup.md` still needs the two callback env vars written up for the operator.

**On the operator (not a code change):**
- **Staging.** There is no standing staging host. The branch is not pushed, so there is no Vercel
  preview URL for it yet. Getting one means pushing the branch and setting `DAILY_INGEST_TOKEN`
  (and a series — see below) on the Preview environment. Until then the honest answer to
  "what host do we test against" is: none exists.
- **A `status='active'` series must exist on whichever host is tested against**, or every push
  gets 409 "No active series". This is the single most likely first-test failure.
- **Generate and share `DAILY_INGEST_TOKEN`** (`openssl rand -base64 32`), stored in makinitmag's
  private secrets file and set on the app's Vercel env. Different values for Preview and
  Production.
- **Soft-deleting a test day** is done in the console — ask any time, it takes a moment and frees
  the date immediately.
