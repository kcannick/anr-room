# Instagram reach: follower counts for A&Rs and artists

Status: **SPEC, nothing built** (written 2026-10-19, parked 2026-11-22). Migration number:
**the next free one at build time** (055 was the last on main on 2026-11-22; 050 is taken).

> **Re-check before building (changed since this was written):** A&R Wars, the tournaments and
> the Wednesday show are retired, so drop §7.4 and the Wars/takeover examples in §1. The
> operator now checks handles on the day of scheduling with a browser-based IG handle checker
> (memory `ig-handle-checker`). The global rule bans Instagram's *web* endpoints (they return
> 429), not the Graph API this spec uses. A Meta API integration for posting is also planned
> ("own Meta API integration later"), and it could share the Meta app and token from §9.
Platform-admin only. Nothing here touches scoring, points, boards or anything public.

## 1. Why

We work with hundreds of A&Rs and artists and have no idea which of them can move an audience.
That matters every week:

- **Collab posts.** The Daily Countdown goes out with the top 3 artists as collaborators, the
  Top A&Rs carousel with the #1 A&R. A collab lands on the collaborator's feed, so their reach
  decides how far the post goes. Today nobody can see that reach.
- **Outreach.** Sales leads (Asana) and the Brevo lists treat a 200-follower artist the same as
  a 90,000-follower one. Big accounts deserve a personal message first.
- **Picking people.** Invited Tastemakers for A&R Wars, takeover guest hosts, who to feature:
  all picked by memory today.

The operator's ask: a lookup table of Instagram usernames, filled by asking Instagram for
followers, following, the ratio between them, and when we last checked. This spec builds on
that in four places (§2).

## 2. What this adds to the original idea

1. **A history, not just the latest number.** Every check also writes a snapshot row. Growth
   over 30 days says more than the count: an artist going 4k → 9k is a better bet than one
   sitting at 40k for a year. A sudden jump is also how bought followers show up.
2. **Engagement rate, not only the follower/following ratio.** The ratio is a weak signal (it
   mostly catches follow-for-follow accounts). The Instagram call that returns the counts can
   also return likes and comments on recent posts, so we get engagement for free:
   median (likes + comments) ÷ followers over the last 12 posts. That separates real audiences
   from bought ones. We keep the ratio too, as asked.
3. **Identity check.** A handle on our side is whatever someone typed into a form. Anyone can
   type `@drake`. If big numbers drive who gets a personal call or a collab invite, a wrong
   handle sends the operator after the wrong person. So we store Instagram's own name, bio and
   picture next to ours, and any account over a size threshold is marked **"confirm"** until
   the operator ticks it as the right person (§6).
4. **One row per handle, shared.** The same person can be an A&R (`users.instagram`) and an
   artist (`rounds.artist_instagram`), and one artist appears on many rounds. The table is keyed
   on the normalised handle and both sides join to it, so a handle is fetched once and everyone
   attached to it sees the same numbers. It also carries a `platform` column from day one so
   TikTok (`users.tiktok` already exists) can go in the same table later.

## 3. Where the numbers come from

### Chosen: Instagram Graph API, Business Discovery

From our own Instagram professional account, the Graph API can look up any other
**professional** (Business or Creator) account by username and return:

`username, name, biography, website, profile_picture_url, followers_count, follows_count,
media_count`, plus recent `media{timestamp, like_count, comments_count, media_type}`.

One call per handle returns everything in §4. It is the official route, free, and does not risk
our account.

**The limit to know about:** it only works on professional accounts. A personal account returns
an error and we cannot see its numbers. Many musicians run Creator accounts (it is free and
gives them insights), but not all. §8 covers what happens to the rest.

Also: if an account hides its like counts, `like_count` is missing on those posts. Engagement is
computed from the posts that have it, and left blank when fewer than 3 do.

### Rejected

- **Scraping instagram.com.** Against Instagram's terms, breaks without warning, and the risk
  lands on @makinit4indies, the account every post goes out on.
- **Paid data providers** (they cover personal accounts too). Not now: cost, a new vendor, and
  we don't yet know how many handles the free route misses. The table has a `source` column so a
  provider can fill the same rows later if the miss rate turns out high (§8).

### Rate limits

Graph API calls are rate-limited per app and account, and the limit is reported back on every
response (`X-Business-Use-Case-Usage` / `X-App-Usage`). The fetcher budgets low (**≤ 120
lookups an hour**), reads that header on every call, and stops for the hour once usage passes
75%. A few thousand handles refresh comfortably inside that (§5).

## 4. Data model (next free migration)

```sql
CREATE TABLE IF NOT EXISTS social_accounts (
  platform        TEXT NOT NULL DEFAULT 'instagram',
  handle          TEXT NOT NULL,          -- normalised, see igKey()
  status          TEXT NOT NULL DEFAULT 'pending',
                  -- pending | ok | not_professional | not_found | error
  source          TEXT NOT NULL DEFAULT 'graph',   -- graph | manual | <provider>
  ext_id          TEXT,                   -- Instagram's id (survives a username change)
  name            TEXT,                   -- Instagram's display name
  bio             TEXT,
  picture_url     TEXT,                   -- expires; display only, never stored on Blob
  followers       INTEGER,
  following       INTEGER,
  media_count     INTEGER,
  engagement_bp   INTEGER,                -- engagement rate in basis points (1.25% = 125)
  last_post_at    BIGINT,
  confirmed_at    BIGINT,                 -- operator ticked "this is the right person"
  confirmed_by    TEXT,
  first_seen_at   BIGINT NOT NULL,
  fetched_at      BIGINT,                 -- the timestamp the operator asked for
  next_check_at   BIGINT NOT NULL,
  claimed_at      BIGINT,                 -- cron claim, 10-minute staleness escape
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  PRIMARY KEY (platform, handle)
)
--->
CREATE INDEX IF NOT EXISTS idx_social_next ON social_accounts (next_check_at)
--->
CREATE TABLE IF NOT EXISTS social_snapshots (
  platform      TEXT NOT NULL,
  handle        TEXT NOT NULL,
  fetched_at    BIGINT NOT NULL,
  followers     INTEGER,
  following     INTEGER,
  media_count   INTEGER,
  engagement_bp INTEGER,
  PRIMARY KEY (platform, handle, fetched_at)
)
```

- **The ratio is not stored.** It is `followers / following`, computed at read time (a stored
  copy can only drift). Same for growth, tier and flags (§6).
- **No columns on `users` or `rounds`.** Both join on the normalised handle. Adding an indexed
  key column to those tables would need a backfill over every row, which is the kind of work
  the #1 rule keeps off the deploy. The joins only run on admin screens and the daily discovery
  step, over a few thousand rows.
- Integer basis points for engagement so SQLite and Postgres return the same number.

### Normalising handles: `igKey(s)`

One function, used for discovery, for the joins and in the tests: trim, strip leading `@`,
take the handle out of an `instagram.com/<handle>` URL (with or without `www.`, query, trailing
slash), lowercase, keep `[a-z0-9._]`, max 30 characters (Instagram's limit), null if empty.
The existing `igClean` (server.js ~3094) keeps case and allows URLs through; `igKey` replaces it
for matching and leaves display untouched.

## 5. The fetcher

Background work only. **Never on boot or on a request path** (the #1 rule).

**Discovery** (once a day, in the daily cron's existing once-a-day slot): one set-based
`INSERT … SELECT DISTINCT` of every normalised handle from `users.instagram` (active accounts
only, `activeUserSql`) and `rounds.artist_instagram` (reference tracks excluded) that is not
already in `social_accounts`, as `pending` with `next_check_at = now`. Nothing is ever deleted:
a handle that leaves our data just stops being refreshed (§5 cadence).

**Refresh** (every cron tick, `*/5`): claim up to **10** rows where `next_check_at <= now`,
ordered by `next_check_at` (conditional `UPDATE … SET claimed_at` like the other queues, since
Vercel can deliver a cron twice). Time-box at 15 seconds. For each: one Business Discovery call,
then update the row and write a snapshot. 10 a tick × 12 ticks = 120 an hour, the §3 budget.

**Cadence** (`next_check_at` after a check):

| Situation | Next check |
|---|---|
| New handle | right away (it is `pending`) |
| `ok`, person active in the last 30 days (A&R `last_seen`, or artist rated in the last 30 days) | 7 days |
| `ok`, inactive | 30 days |
| `confirm` flag (§6) or ≥ 100k followers | 7 days regardless |
| `not_professional` | 30 days (they may switch to a Creator account) |
| `not_found` | 30 days, then 90 after three in a row |
| `error` / rate-limited | backoff 1h, 4h, 24h; stop after 8 attempts, console shows it |

"Refresh now" on the console checks one handle immediately (one call, inside the request).

**A username change.** Instagram lets people rename. When the old handle comes back
`not_found` and a later handle returns the same `ext_id`, the console shows them as the same
account. No automatic merging in v1.

## 6. Reading the numbers

All computed at read time in a pure module, **`social-reach.js`** (unit-tested like
`scoring.js` and `bracket.js`).

- **Ratio** = followers ÷ following, one decimal. Blank when following is 0.
- **Engagement** = median of (likes + comments) ÷ followers across the last 12 posts that show
  likes. Blank under 3 such posts.
- **Growth** = followers change over 30 days, from snapshots (count and %). Blank until there
  are two snapshots at least 21 days apart.
- **Tier** (labels for filtering and Brevo, thresholds are a constant):
  `Under 1k` · `1k–10k` · `10k–50k` · `50k–250k` · `250k+`.
- **Flags.** Shown to the operator, never acted on automatically:
  - **Confirm**: 25k+ followers and not yet `confirmed_at`, or the same handle attached to two
    different people on our side. The console shows Instagram's name, bio and picture beside
    ours with a "This is them" button and a "Wrong account" button (which marks the handle on
    that person as wrong so it stops showing their numbers; it does not edit what they typed).
  - **Low engagement**: under 0.5% at 10k+ followers.
  - **Jump**: followers up more than 50% within 7 days.
  - **Follow-heavy**: ratio under 1.0 at 1k+ followers.
  - **Quiet**: no post in 90 days.

## 7. Where it shows up

Platform-admin only, every surface. **Mockup first** for the console pieces (project rule);
nothing below is UI-final.

1. **Reach screen** (new console screen): every handle with person (A&R / artist / both, linked
   to their profile or rounds), followers, following, ratio, engagement, 30-day growth, tier,
   flags, status, last checked. Sort on any column, filter by tier, flag, status and A&R vs
   artist. Row opens the history (a small followers-over-time line) with Refresh now /
   Confirm / Wrong account. CSV export.
2. **Daily console records table**: followers + tier beside each artist's handle. That is where
   the collab picks for the countdown are made.
3. **Users admin list**: a followers column, sortable.
4. **Tournament field picker** (Wars candidates, invited Tastemakers): followers beside each
   candidate.
5. **Sales leads → Asana**: a "IG followers" number custom field (falls back to the notes line
   when custom fields are unavailable, same as the existing fields), and leads sync order can
   take reach as a second sort if the operator wants it.
6. **Brevo**: `IG_FOLLOWERS` (number) and `IG_TIER` (text) attributes on both lists, so
   outreach can be segmented by size. Goes through the existing payload-hash ledger, so a
   follower change pushes on the next daily sync. Blank when unknown.

### What it never does

- **No public surface.** Not on `/u/<uid>`, the account page, leaderboards, cards or emails.
  It would turn the A&R community into a follower-count contest, and a number we fetched about
  someone is not theirs to see us displaying. (Revisit only if the operator wants it.)
- **No effect on scoring, points, ranks, the countdown order or any prize.** Reach decides who
  we reach out to and who we tag, never who wins.
- **No automatic outreach.** Nothing sends because a number crossed a line.

## 8. Accounts we can't read

Personal accounts (`not_professional`) and handles that don't exist (`not_found`) are listed on
the Reach screen with their status, so the miss rate is visible from day one. Three ways to cover
them, in order:

1. **Manual entry**: the operator types followers/following for a handle that matters
   (`source='manual'`, the fetcher leaves manual rows alone until the operator clears them).
2. **Ask them** (operator's call): a line on the profile edit page for A&Rs whose handle came
   back personal: switching to a free Creator account lets us feature them. Plain wording,
   no pressure.
3. **A paid provider** if the miss rate is high after the first full pass. Same table,
   `source='<provider>'`.

## 9. Setup (operator + me, before any build)

1. **Pick the account we query from.** It must be an Instagram professional account linked to a
   Facebook Page. @makinit4indies is the obvious one (already business, already the posting
   account).
2. **A Meta app** (Business type) in Meta for Developers, owned by the Makin' It business
   portfolio.
3. **Permissions**: `instagram_basic`, `pages_show_list`, `pages_read_engagement`
   (+ `business_management` for the token below). Accounts with a role on the app can use these
   without App Review; **verify this during setup**. If it does need review, that is a few days
   of waiting, not a blocker to the design.
4. **A system-user token** from Meta Business Settings, which does not expire. A normal user
   token lasts 60 days and would quietly stop the fetcher, which is exactly the
   babysitting the operator doesn't want.
5. **Env vars** on Vercel: `IG_GRAPH_TOKEN`, `IG_BUSINESS_ID` (our account's Instagram id). Test
   override `IG_GRAPH_API_BASE` (same pattern as `ASANA_API_BASE` / `BREVO_API_BASE`). With the
   token unset the fetcher is dormant and the Reach screen says so plainly.
6. **Feasibility check**: run the call by hand against 20 real handles (10 A&Rs, 10 artists)
   and count how many come back `ok`. That number decides whether §8.3 is needed up front.

## 10. Build order

1. Migration 050, `igKey`, `social-reach.js` + unit tests.
2. Discovery + refresh in the daily cron, mock Graph API in e2e.
3. Minimal admin readout (`GET /api/admin/social/accounts`) so the first full pass can be
   checked before any UI.
4. Mockup of the Reach screen + the console columns → operator approval.
5. Reach screen, console columns, Confirm / Wrong account / manual entry.
6. Brevo attributes, Asana field.

### Endpoints (all platform-admin)

- `GET /api/admin/social/accounts?tier=&flag=&status=&who=&sort=&format=csv`
- `GET /api/admin/social/account?handle=` (row + snapshots + who it's attached to)
- `POST /api/admin/social/refresh {handle}`
- `POST /api/admin/social/confirm {handle}` / `POST /api/admin/social/wrong {handle, uid|roundId}`
- `POST /api/admin/social/manual {handle, followers, following}` (empty body clears to graph)
- `GET /api/admin/social/status` (configured, last run, usage %, counts by status)

### Tests

- `igKey`: `@Name`, URLs with/without `www.`/query/slash, uppercase, junk characters, >30 chars.
- `social-reach.js`: ratio with 0 following, engagement with hidden likes and <3 posts, growth
  window, tier edges, each flag.
- e2e (mock Graph on `IG_GRAPH_API_BASE`): discovery picks up both columns once and skips
  reference tracks and closed accounts; claim prevents a double fetch; `not_professional`,
  `not_found` and rate-limit responses set the right status and `next_check_at`; manual rows are
  left alone; every endpoint refuses a non-admin; **no public route emits any of these fields**.

## 11. Open decisions (operator)

1. Which account we query from (default: @makinit4indies).
2. Tier thresholds and the 25k "confirm" line.
3. Whether A&Rs with personal accounts get the "switch to Creator" nudge (§8.2).
4. Whether reach should reorder sales leads, or only show as a column.
5. TikTok next, or only after Instagram has run a month.
