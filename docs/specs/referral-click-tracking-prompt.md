# Task: count clicks on A&R referral links (`/r/<uid>`)

Repo: `anr-room` (this checkout). Server: `server.js`. DB: `db.js` (SQLite locally, Postgres
when `DATABASE_URL` is set — anything you write must work on both). Migrations: `migrations/`,
next number is **041**. Contract with makinitmag.com: `docs/specs/daily-drop-integration-spec.md`
§3. Read this whole prompt before editing.

## Why

A&Rs share a submit link from their `/refer` page. Today `referralLinks(uid)` (server.js, next
to `SUBMIT_REVIEW_URL`, ~line 2160) builds it as:

    https://www.makinitmag.com/review?ref=<uid>

The click goes straight to makinitmag.com, so this app never sees it. We know how many
**submissions** each A&R brings in (Drupal stores the ref and hands it back as `scout.uid` on the
daily push), but not how many people **opened** the link. Without that number we can't tell a
link nobody shares from a link people open but don't submit through.

Also, `makinitmag.com/review` isn't a real page. It reaches the submit form through two old
redirects (`/review` → `/dmr` → `/opportunities/anr-meeting`). The query string survives both,
but nobody set those redirects up for this, and removing either one would break every A&R link
without any error. Sending the click through this app lets us go straight to the final URL in
one hop that we control.

## Build

**1. Route `GET /r/<uid>`** (model it on the existing `/submit` 302 handler):

- Validate `uid` against `^[A-Za-z0-9_-]{8,40}$`. It is case-sensitive; never change its case,
  trim it, or parse it as a number.
- Record the click (step 2), then reply `302` with `Cache-Control: no-store` and
  `Location: https://www.makinitmag.com/opportunities/anr-meeting?ref=<uid>` (uid URL-encoded).
  **Keep the `www.`**: the bare domain 301s to www, and that extra redirect already caused a
  silent failure in the results callback for nine days.
- If the uid is invalid, still `302` to the same URL **without** `ref`. Never 404 a link
  someone has already posted.
- Counting is best-effort. If the insert throws or the DB is unreachable, catch it, log it, and
  redirect anyway. A tracking failure must never stop an artist from reaching the form.
- Count only `GET`. Don't count `HEAD` (link previewers often send it), but still redirect it.

**2. Storage — migration `041_referral_clicks.sql`:**

```
referral_clicks(
  day        TEXT    -- YYYY-MM-DD in America/New_York
  user_id    TEXT    -- the A&R's uid, verbatim
  visitor    TEXT    -- sha256(ip + '|' + user_agent + '|' + day), hex, first 32 chars
  kind       TEXT    -- 'human' | 'bot'
  created_at INTEGER
  UNIQUE (day, user_id, visitor)
)
```

- Insert with `ON CONFLICT (day, user_id, visitor) DO NOTHING`. The same person clicking five
  times in one day counts once. (This conflict form already works on both engines here.)
- Store the hash, never the raw IP or full user agent. Those count as personal data, and the
  hash is all the dedupe needs.
- Only record clicks for a uid that matches a `users` row. Unknown or blocked uids still get
  redirected; they just aren't counted.
- Take the client IP the same way the rest of the server does behind Vercel. Don't add a
  second way of doing it.

**3. Bot filtering.** About 99.5% of international traffic to makinitmag.com is bots. Every
chat app that shows a link preview also fetches the URL the moment someone pastes it. Without
filtering, an A&R who posts once in a group chat gets several "clicks" that no person made.

- Mark a click `kind = 'bot'` when the user agent is empty or matches (case-insensitive):
  `bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|discord|slack|skype|
  linkedin|pinterest|embedly|preview|curl|wget|python-|go-http|okhttp|headless|lighthouse`.
- Keep bot rows in the table. They show how much noise was filtered out, which lets us check
  the filter is working. Everything shown to A&Rs counts **human** rows only.
- The filter won't be perfect. Some previewers use normal browser user agents. Don't try to
  catch those; a small overcount is fine.

**4. Issue the new link.** Change `referralLinks(uid).submit` to
`${publicBase()}/r/${encodeURIComponent(uid)}`. Then check that everything that builds or
shows a submit link gets it from `referralLinks`: the `/refer` page, `/api/card/refer`, and the
QR codes (`qrPngDataUri`). If anything builds the URL separately, switch it over too.

- Check what `publicBase()` returns on a Vercel **preview** deploy. If it returns the preview
  host, links issued from a preview would count into the preview DB. Decide whether that's OK
  and write down the decision.
- Don't change `share-cards.js` `SUBMIT_URL` (`makinitmag.com/review`, printed on images).
  It's display text that a person types in by hand, so it never carried a ref. Leave it.

**5. Show it on `/refer`.** Add one plain line near the A&R's submit link, e.g. "12 people
opened your link this week · 48 all time", using human rows only. **Show Kelby a mockup of
this before changing the page.**

## Do not

- **Don't touch the credit path.** `creditScoutPoints()`, `point_events`, and anything that
  gives points, ranking, or standing stay exactly as they are. Clicks are for diagnosis only.
  They never award anything, because anyone can generate clicks. Credit still comes only from
  a submission that makinitmag.com attributes to the ref.
- Don't change the `?ref=` handoff to makinitmag.com. Drupal reads `?ref=` from the query
  string on whatever page it lands on, so the redirect only has to keep passing it through.
- Don't break links already out there. Every `makinitmag.com/review?ref=<uid>` link that's
  already been posted keeps working, because it never touches this app. Those clicks will
  never be counted, which is expected. Only links issued after this change are counted.
- Don't add Google Analytics or any third-party script for this.
- Don't redirect to bare `makinitmag.com`.

## Verify before finishing

- `curl -sI /r/<valid uid>` → `302`, `Cache-Control: no-store`,
  `Location: https://www.makinitmag.com/opportunities/anr-meeting?ref=<uid>`.
  Follow it with `curl -sL -D- … | grep -i set-cookie`. The final makinitmag.com response
  should set the `mim_anr_scout_ref` cookie to the same uid with the same case.
- Invalid uid (`/r/bad%20value`, `/r/short`) → `302` to the same URL without `ref`, and no row.
- Same IP + UA three times in one day → one `human` row.
- `User-Agent: facebookexternalhit/1.1` → one `bot` row, not included in the human count.
- `HEAD /r/<uid>` → `302`, no row.
- Force the insert to throw → still `302`.
- `/refer` shows the `/r/<uid>` link, and its QR code decodes to that link.
- The migration applies on SQLite locally and on Postgres. Add tests next to the existing
  `/submit` tests in `e2e.test.js` and run the full suite.
- **Deploy check:** the Vercel function bundle only contains the files listed in
  `vercel.json` `includeFiles` (see the 2026-09-20 outage notes in CLAUDE.md). If you add a new
  file the route needs at runtime, make sure it's listed there.

## Report back

The route, the migration number, what `/refer` shows (with the mockup), human/bot counts from
a test run, and every place that previously built a submit link without `referralLinks`.

## Later, not now

To get a real "N opened → M submitted" ratio, the app needs submission counts from
makinitmag.com. It only sees `scout.uid` for records that get onto a meeting agenda, not for
ones still waiting in the pool. That will take a small read endpoint on the Drupal side, keyed
by ref. Don't build it until the click count exists and someone asks for the ratio.
