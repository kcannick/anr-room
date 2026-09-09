# Prompt for the makinitmag.com session — build the A&R Daily push

Paste everything below the line into that session.

---

You are building the makinitmag.com (Drupal) side of the A&R Daily integration. The other side
is **already live** at `anr.makinitmag.com` and has been running daily drops for several days —
so this is you catching up to a contract that already exists, not a design conversation. Do not
propose changes to the wire format without saying why; it is deployed and other things depend
on it.

**Read `docs/specs/daily-drop-integration-spec.md` first** (in the anr-room repo, or ask for it).
It is the source of truth: every field name, limit and status code in it was read out of the
running `server.js`. This prompt is the build order; the spec is the reference.

## What A&R Daily is, in one paragraph

Every day at 12:00 PM ET a set of **4–16 records** opens. A&Rs rate each one 0–9 and predict
what the average will be; scoring is on how close the prediction lands. The window closes at
9:00 AM ET the next day, everything tallies, and results publish at 12:00 PM ET. Your job is to
choose the day's records and hand them over. **All submission logic — the form, payment,
pay-what-you-want ($10–$100), the free pool and its aging, the 4-random-free + up-to-12-paid
selection, the weighting by amount — lives entirely on your side and must never be duplicated in
the app.** The app receives an approved list and runs the day.

## Build these five things

**1. The daily push.** One `POST` to `https://anr.makinitmag.com/api/ingest/daily` from PHP,
carrying the whole approved day, with `X-Ingest-Token: <DAILY_INGEST_TOKEN>` in the header.
Server-to-server: there is no CORS on that route and it is not callable from a browser. The
token is header-only — `body.token` is not read there — and it does **not** fall back to
`INGEST_TOKEN`, which guards a different, lower-value integration.

**2. The approval screen.** The operator reviews the day and presses push. It must render
`rejected[]` and `warnings[]` from the response **inline**, not swallow them. Pre-flighting the
same validation locally before pushing is good; it does not replace showing what came back.

**3. Scouting capture.** A&Rs recruit artists with a link carrying their Drupal uid:
`https://makinitmag.com/opportunities/anr-meeting?a=<uid>`. Attribute a submission from three
sources, in this order: the **URL parameter**; a **cookie** set when that link was first
followed, so a returning artist is still attributed; and the submitting account's own
**`referred_by`** — but **that third source only when the referring user is an A&R.** A regular
user inviting a friend is not scouting, and without that condition every ordinary account
referral silently becomes scouting credit. Send it as `scout: { uid, email }` on records that
have a referrer. Both fields: the uid is stored regardless so your own ambassador reporting
works, and the email is what lets the app link the accounts and actually award points.

**4. The results endpoint.** `POST /api/anr-meeting/results` on your side, guarded by
`X-ANR-Key`. **This is built and live on our side already** and will start calling you the
moment the operator sets the env vars. Shape and semantics are in spec §12. Respond
`200 {"ok":true,"updated":N}`, or `404` if the day is unknown to you. Be idempotent — we retry.

**5. Public artist profiles.** You confirmed these exist at `makinitmag.com/@username` for
accounts, with `profileUrl` omitted for guest submitters. Keep it omitted rather than sending a
placeholder — an absent `profileUrl` correctly renders no button; a broken one renders a dead
button to every A&R.

## Five things that will bite

**`seriesId` fails silently and it is the most likely first failure.** A drop must be tagged
into a series or its points reach no leaderboard — the day runs, records get rated, and none of
it counts. The app refuses to create an untagged day (409), but whichever host you test against
needs a `status='active'` series to exist. Simplest correct integration: **omit `seriesId`** and
let the app resolve the active one. Either way, **echo the returned `seriesId` on the approval
screen** so a null is visible before noon rather than after.

**Validation is all-or-nothing.** One bad row rejects the entire batch and creates nothing. In
practice that is almost always a missing or non-http `playUrl`, which is required because a
record nobody can play is dead for the whole 21-hour window.

**The two URLs are not interchangeable.** `url` is the deep link to the submission node — it
reaches a page with the submitter's contact details, and the app treats it as platform-admin
only. `profileUrl` is the **public** artist page shown as a button to every A&R. Putting an
admin URL in `profileUrl` publishes artist contact details.

**The note is context, not a question.** It is the artist telling A&Rs how to hear the record —
*"Hey, this isn't mixed. Just recorded it on Bandlab last night."* Label your form field so it
produces that, not answers to "what would you like feedback on?" Your 320-character cap is fine;
the app accepts 500.

**Your record count will be smaller than the day.** The operator can hand-add a **reference
track** — a known record from a major artist, for A&Rs to rate — which carries no `ref`, never
appears in the results callback, and is excluded from every chart. Do not treat that gap as an
error. If you display "N records reviewed today" anywhere public, count what you pushed.

Also: a record the operator **pulls** mid-window (usually a dead link) disappears entirely. So
"was in my push, absent from the callback" means pulled, not pending. Say so if you would rather
have an explicit status than infer it — we will add one.

## What changed since your last reply

- **The results callback is BUILT and deployed.** You offered 9 AM at ratification or noon at
  publish; **we took noon**, for a reason not visible from your side: the day tallies at 9 but
  results do not reach A&Rs until noon, and handing you room averages in that window would put
  them on a public artist page three hours before the people who did the rating see them.
- **`reportUrl`: dropped.** There is no web version of the Song Report — it is images emailed to
  the artist. If a public report page is ever built, that field is where it goes.
- **Status is derived and written down** so neither side guesses: `rated` (has a room average),
  `not_playable` (no average and at least one A&R reported it), `unrated` (neither). A `reports`
  count always rides along, because a record can be both rated and reported when a link dies
  partway through the day.
- **Reference tracks now exist** (see above).

## Acceptance criteria — run these before calling it done

Against a test day, not a real one. Push a day dated **tomorrow** so it is created but never
opens, and ask the operator to soft-delete it afterwards (that frees the date immediately).

1. Push 4–5 records → `200`, `replaced: false`, and the returned `rounds` matches what you sent.
2. Push the same day again with a different set → `200`, **`replaced: true`, same `sessionId`**,
   and the round count is the new set's, not the sum.
3. Push a batch with one row missing `title` → `400`, `rejected[0].index` points at that row,
   and **nothing was created**.
4. Push a row with `playUrl: "ftp://x"` → `400`, `rejected[0].field === "playUrl"`.
5. Push the same `ref` twice in one batch → `400`.
6. Push 25 records → `400`.
7. Push a row with a mistyped email → `200` with a `warnings[]` entry, and your screen shows it.
8. **Assert your logs contain no `@`** from the response body — artist email and phone are never
   echoed back, and nothing should be reintroducing them.
9. Confirm the response's `seriesId` is non-null and rendered on your screen.
10. Scouting: submit through `?a=<uid>`, close the browser, return without the link, submit
    again — both should carry the same `scout.uid`.
11. Scouting negative case: a submission referred by a **non-A&R** account carries no `scout`.

## What we still owe you

- **`DAILY_INGEST_TOKEN`** — the operator generates it (`openssl rand -base64 32`), sets it on
  the app's Vercel env, and shares it. Store it in your private secrets file; not the repo, not
  a settings table. Different values for staging and production.
- **A staging host.** There is no standing one. The branch is live on production now, so the
  honest options are: test against production with a tomorrow-dated day and a soft-delete after,
  or ask the operator to stand up a Vercel preview with its own token and series.
- **`RESULTS_TOKEN`** — you generate this one and give it to the operator, along with your
  endpoint URL. Until both are set on our side the callback stays dormant, which is deliberate:
  a preview deployment must not be able to post into production Drupal.

If anything here does not match what you have already built, say so rather than working around
it. Our side is deployed but the wire format is still cheap to change with a reason.
