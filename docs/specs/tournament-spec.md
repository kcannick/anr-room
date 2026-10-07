# Tournament tooling — A&R Wars and the $1,000 Music Review Tournament

Status: BUILT 2026-10-07 (migration 045, tournament.js, bracket.js, public/tournament.html, the console Tournaments mode, Satori graphics). Mockups approved by the operator the same day. Operator brief: "make A&R Wars as automated as possible;
a management dashboard; reusable for the artist tournament; 8 competitors, 3 rounds; I pick the
competitors; graphics (general flyer story + feed, livestream thumbnail) that update as winners
advance; a landing page where people join an email list for a tune-in reminder."

This supersedes the 2026-07-01 "no bracket layer" decision (roadmap §6.4) — the operator asked
for the layer. Format per the master calendar (2026-10-03): a tournament every 4 weeks,
alternating brands; A&R Wars #1 on Sunday 2026-10-25 is hand-picked.

## 1. One model, two kinds

A `tournament` has a `kind`: `ar` (A&R Wars) or `artist` (Makin' It $1,000 Music Review
Tournament). Everything — the bracket, the live control, the graphics, the landing page, the
reminder list — is keyed on the tournament, and only three things differ by kind:

| | `ar` — A&R Wars | `artist` — $1,000 Music Review Tournament |
|---|---|---|
| Lockup / title | `[A&R] WARS` | set as type: "Makin' It $1,000 Music Review Tournament" |
| Prize line | "$500 Cash Prize" | "$1,000 Promo Budget" |
| Where competitors come from | A&Rs: weekly Top A&R (`weeklyReportData.ars[0]`) or any complete profile | artists: weekly Top Track (`weeklyReportData.songs[0]`) or typed in |
| What a matchup plays | the Service Pack linked to the tournament (`pack_songs` picker) | the artist's own catalog (typed titles) |

A competitor is a row, not a user: `{seed, name, handle, city, photo_url, user_id?, source}`.
For an A&R the row is filled from `users` (name, instagram, location, photo_url) and keeps
`user_id`; for an artist it is filled from the week's #1 record (artist, Instagram) and the
operator uploads a photo (artists have none on file). Every field is editable on the row, so a
missing photo or a wrong handle never blocks a graphic.

## 2. Schema (migration 045, additive)

```
tournaments            id, kind, name, number, slug UNIQUE, prize_text, status
                       (draft|promo|live|complete), event_at, session_id, pack_id,
                       watch_url, final_polls (3), winner_competitor_id, graphics (JSON),
                       caption, remind_min (120), created_at, created_by
tournament_competitors id, tournament_id, seed (1..8, the bracket), seat (1..8, the order the
                       seats were filled — drives the weekly flyers), qualified_label ("Week 3"),
                       user_id, name, handle, city, photo_url, source, UNIQUE(tournament_id, seed)
tournament_matches     id, tournament_id, round_no (1..3), slot (1..4), a_id, b_id,
                       winner_id, decided_by (polls|host), decided_at,
                       UNIQUE(tournament_id, round_no, slot)
tournament_subscribers id, tournament_id, email, name, created_at, reminded_at,
                       unsub_token, UNIQUE(tournament_id, email)
rounds                 + tournament_match_id (which match a Versus poll belongs to)
```

Status lifecycle: `draft` (building the field) → `promo` (8 seats filled + date set; landing
page public, graphics posted, list open) → `live` (the linked session is live; set by the
console on event day, or automatically when the session flips live) → `complete` (final decided).

## 3. Bracket (`bracket.js`, pure, unit-tested)

- 8 seeds → round 1 slots `1v8 · 4v5 · 3v6 · 2v7`; round 2 = winners of slots (1,2) and (3,4);
  round 3 = the final. Seeds are editable on the console; the operator can also "seed by Series
  points" (A&R kind) in one press. The bracket is (re)generated from the seeds only while no
  match has a winner.
- A match is decided from its polls: a poll's side A wins when `split_a > 50`, B when `< 50`,
  `50` is a tie. Rounds 1–2 are one poll; the final is `final_polls` (default 3 — the number
  Pick the Hits counts on: 4 + 2 + 3 = 9 polls = 18 songs). The final is DECIDED when one side
  holds a majority of `final_polls`, but the console keeps saying "poll 3 of 3 still to play"
  because the side bet needs all 18 played. Never hardcoded: `final_polls` is on the tournament.
- A tie, or a poll with zero votes, leaves the match undecided and the console shows a
  **Decide** control (host picks the winner; recorded `decided_by='host'`). The host can
  override any decided match the same way; overriding clears everything downstream.
- When a match is decided the winner is written into the next match's slot. When the final is
  decided the tournament is `complete`, `winner_competitor_id` is set, and `/api/home.winners`
  (hardcoded `[]` today) lists complete tournaments: kind, name, number, champion
  {name, handle, photo}, event date. Public surface: display name, handle, photo, city only.

## 4. Running the event — what the console does

The tournament links ONE live session (a Versus room, tagged into the active Series so viewer
points count, per §8.5). Each match card has **Queue matchup**: two song pickers (pack songs
for `ar`, free text for `artist`) → `POST /api/admin/round` with `poll_type: 'binary'`,
`pack_song_a/b` (existing stamping) and the new `tournamentMatchId`. The round takes the normal
Advance path (listening → voting → ratify). `ratifyAndPublish` then calls
`settleTournamentMatch(matchId)` — recompute from every poll on the match, write the winner,
fill the next slot, push `tournament` on the session's Ably channel so the console and the
landing page bracket update without a reload. Nothing scales with viewers (one query per ratify).

The console bracket shows, per match: the two competitors, the poll(s) with vote count while
open (the split stays SEALED until ratify — same rule as everywhere), the result once ratified,
and the next action (Queue / Decide / Done). The whole night is: queue → Advance ×3 → the
bracket fills itself.

## 5. Graphics (Satori, share-cards.js) — a WEEKLY qualifier series, then the event

Operator (2026-10-07): the graphics iterate **weekly as seats fill**, not during the show. Each
week one more competitor qualifies and gets a flyer; everyone picked before is on it too.

**Layout: one BIG slot + eight SMALL seat slots.** The big slot is that week's qualifier
(photo, name, @handle, "Qualified · Week N"); the eight small seats show everyone selected so far
(photo + name) and the unfilled seats are numbered **silhouettes**. So the first person picked
appears on all seven later flyers. The **final promo** (all 8 filled): the big slot is a
silhouette / question mark with **"Who has the Best Ear?"** (operator's wording) and the date/time
big. Every state carries the one-line premise for people who do not know the format ("8 A&Rs play
the songs they scouted. You vote on every matchup. The winner takes $500.") and prints **$500
once per graphic** (operator: it was repetitive).
After the event the **champion** graphic puts the winner in the big slot with the gold ring.

Rendered live and admin-only at `/api/card/tournament?t=<id>&kind=feed|story|thumb|bracket
&filled=N` (N defaults to the current seat count; `stage=final|champion` for the two end
states). The console's Graphics card lists one row per qualifier week (Week 1 … Week 8), then
Final promo, then Champion, each with the three promo pieces shown as images, and **Publish**
hosts that row's set to Blob at `tournaments/<slug>/<row>-<kind>.png` and makes ONE Asana task
("A&R Wars #1 — Week 3 · Jalen Brooks qualified"; notes = caption + who to tag). The bracket
graphic is event-night only: it renders off the match results and is published from the Wrap.

| kind | size | use |
|---|---|---|
| feed | 1080×1350 | qualifier flyer (weekly), final promo, champion |
| story | 1080×1920 | same, story safe zones |
| thumb | 1920×1080 | livestream thumbnail; reads at 180px |
| bracket | 1080×1350 | event night: the bracket, winners filled as they come |

Mockups: `public/brand/wars/` (`?filled=1..8`, `?stage=final|champion`). Caption per the SEO
rule: plain words, "A&R Wars", "qualified", "vote live", "A&R Team" in the first line; no topic
hashtags; the qualifier tagged on the graphic and the post is a collab with them; "Comment #ANR
to join the A&R Team" rather than a link.

## 6. Landing page + reminder list

`/wars` → the latest A&R Wars; `/tournament/<slug>` → any tournament (`public/tournament.html`,
`GET /api/tournament?slug=`). Sections: lockup + number · date/time (ET) + prize · the 8
competitors (photo, name, @handle, city — nothing private) · **Get a reminder** (email + name,
no account: `POST /api/tournament/remind`, one row per email per tournament, rate-limited; the
reminder email carries a one-click unsubscribe) · **Join the A&R Team to vote** (the real
signup; an A&R with `room_live` ON is already notified by the go-live fan-out) · Pick the Hits
link when the `ar` tournament's pack is open · Watch live (`watch_url`) once `live` · the bracket
with results once `live`/`complete` · the champion.

The reminder goes out automatically `remind_min` minutes before `event_at` from the existing
daily cron tick (`runAsyncDropLifecycle` → `drainTournamentReminders`, claimed rows, chunked,
tagged `tournament_reminder`) and can be sent by hand from the console ("Send reminder now").
The landing page is public once `status ≥ promo`; a draft returns 404.

## 7. Picking the field (console, Competitors section)

- **Add from weekly winners**: the last 8 complete weeks' #1 A&R (or #1 track for `artist`),
  with photo/handle and the week label, tick to add; a repeat winner is flagged and the week's
  #2 offered instead (§8.1 "seat passes to the runner-up").
- **Search**: any A&R with a complete, unblocked profile (`ar`), or type an artist in (`artist`).
- Seats 1–8 with seed numbers; "Seed by Series points"; every field editable; photo upload
  (Vercel Blob, the profile-photo path). Status cannot leave `draft` with fewer than 8.

## 8. Reuse map (what exists and is reused as-is)

Versus polls + seal + `pack_song_a/b` stamping (`/api/admin/round`), `weeklyReportData`,
`photoDataUri`, `uploadPng`, the Asana task pattern, `sendEmail(tag, unsubscribe)`, the Ably
room channel, `isProfileComplete`, the series tag, `sessions.live_bonus` (a setting).

## 9. Out of scope here (follow-ons)

Overlay bracket for the stream; a "Pick the Hits" settle button on the tournament (it stays on
the sidebet screen; the played set still derives from `pack_song_a/b`); Promo Budget crediting;
the Series `qualify_count` cut (superseded by weekly seats; left as is).

## 10. API contract (build, 2026-10-07) — the landing page, console and graphics build against this

Timestamps are epoch **milliseconds** (`now()` in server.js). Labels are rendered server-side
in ET and shipped as strings; no page converts an epoch to a wall clock.

### Public

`GET /api/tournament?slug=<slug>` · or `?kind=ar|artist` (the latest with status ≥ promo,
else the latest complete). A draft is 404.
```
{ tournament: {
    id, kind: 'ar'|'artist', name, number, slug, prizeText: '$500 Cash Prize',
    prizeAmount: '$500', lockupWord: 'WARS'|'TOURNAMENT', status: 'promo'|'live'|'complete',
    eventAt, dateLabel: 'Sunday, October 25', timeLabel: '7:00 PM ET', watchUrl|null,
    finalPolls, premise: '8 A&Rs play the songs they scouted. You vote on every matchup. The winner takes the cash prize.',
    filled: 8, packOpen: { slug, prize, closesLabel }|null,   // ar only, while the side bet is open
    liveSession: { id, url: '/?s=<id>' }|null,                 // when status = live
    competitors: [{ id, seed, seat, name, handle|null, city|null, photoUrl|null,
                    qualifiedLabel: 'Week 3'|'Selected', out: bool }],  // seat order
    matches: [{ id, round_no, slot, a_id, b_id, winner_id, decided_by, live: bool,
                polls: [{ status, votes, split_a|null }] }],  // [] unless live|complete
    champion: { id, name, handle, photoUrl }|null,
    subscribers: 214 } }
```
A poll's `split_a` is **null until the round is ratified** (the seal). `votes` is the count.

`POST /api/tournament/remind { slug, email, name? }` → `{ ok: true }` (idempotent per email;
rate-limited; 404 for draft; 409 once the event has started).
`GET /api/tournament/unsubscribe?u=<unsub_token>` → a plain HTML "You're off the list" page.

### Admin (platform admin, `X-Auth-Token`)

- `GET /api/admin/tournaments` → `{ tournaments: [{ id, kind, name, number, slug, status, eventAt, dateLabel, timeLabel, filled, champion: name|null }] }`
- `POST /api/admin/tournament` create/update → `{ id }`. Body: `{ id?, kind, number, name?,
  prizeText?, eventLocal: 'YYYY-MM-DDTHH:MM' (ET), sessionId?, packId?, watchUrl?, finalPolls?,
  remindMin? }`. slug is derived (`wars-1`, `artist-1`), name defaults by kind.
- `GET /api/admin/tournament?id=` → `{ tournament: <public shape, draft allowed, plus
  sessionId, packId, remindMin, remindAt, remindLabel>, sessions: [{ id, name, status }],
  packs: [{ id, name, status }], candidates: [{ week, label, userId|null, name, handle, city,
  photoUrl, points|score, record|null, repeat: bool, seated: bool }], subscribers: { count,
  ars, reminded }, graphics: [{ key: 'seat1'…'seat8'|'final'|'champion'|'bracket', label,
  ready: bool, urls: { feed, story, thumb } | { bracket } | null, publishedAt|null,
  asanaTaskId|null, asanaUrl|null }] }`
- `GET /api/admin/tournament/search?id=&q=` → `{ results: [{ userId, name, handle, city, photoUrl, points }] }` (ar kind: complete, unblocked profiles)
- `POST /api/admin/tournament/competitor { tournamentId, competitorId?, userId?, name, handle?, city?, photoUrl?, qualifiedLabel?, source?, seed? }` → `{ competitorId }` (a new row takes the next seat and seed; 409 when 8 are seated)
- `POST /api/admin/tournament/competitor/photo { tournamentId, competitorId, image: dataURL }` → `{ photoUrl }`
- `POST /api/admin/tournament/competitor/remove { tournamentId, competitorId }` (409 once the bracket has a decided match)
- `POST /api/admin/tournament/seed { tournamentId, order: [competitorId…] }` or `{ tournamentId, byPoints: true }` → rebuilds the bracket (409 once any match is decided)
- `POST /api/admin/tournament/status { tournamentId, status: 'draft'|'promo'|'live' }` (promo needs 8 seats + a date; live needs a session; `complete` is only ever set by the final)
- `POST /api/admin/tournament/queue { tournamentId, matchId, a: { packSongId } | { title, artist }, b: … }` → `{ roundId, opened }` (a binary round in the linked session with `tournament_match_id`, `pack_song_a/b` stamped for a pack pick)
- `POST /api/admin/tournament/decide { tournamentId, matchId, winnerId|null }` (null clears the match and everything downstream)
- `POST /api/admin/tournament/publish { tournamentId, key }` → `{ ok, urls, asana: { taskId, url }|null, caption }` (renders, hosts to Blob, makes the Asana task; without Blob the urls are null and the caption still comes back)
- `GET /api/admin/tournament/caption?id=&key=` → `{ caption, comments: [string] }`
- `GET /api/admin/tournament/subscribers?id=&format=csv` → CSV (email, name, joined, reminded)
- `POST /api/admin/tournament/remind-now { tournamentId }` → `{ sent, remaining }` (chunked; press again while `remaining`)
- `GET /api/card/tournament?t=<id>&kind=feed|story|thumb|bracket&filled=N&stage=seat|final|champion`
  → PNG, `private, no-store` (admin). `filled` defaults to the seat count; `stage` defaults from
  the tournament (champion when complete, final when 8 are seated, else seat).

### Satori data shapes (share-cards.js)

`tournamentFeed` (1080×1350), `tournamentStory` (1080×1920), `tournamentThumb` (1920×1080):
```
{ lockupWord: 'WARS'|'TOURNAMENT', eyebrow: 'A&R Wars #1', dateLabel, timeLabel,
  stage: 'seat'|'final'|'champion', headline: 'Bryce Holloway qualified.'|'Who has the Best Ear?'|'Deja Simone wins $500.',
  premise, prizeAmount: '$500', prizeLabel: 'Cash Prize',
  big: { name, handle|null, photo: dataURI|null, tag: 'Qualified · Week 4'|'Champion'|null }|null,  // null = the question mark (final)
  seats: [{ n, name|null, photo: dataURI|null, filled, ring: 'qualifier'|'champion'|null }] ×8,  // seat order
  cta: { label: 'Watch live at'|'Vote live at'|'Watch the replay', url: 'makinitmag.com/ANR' } }
```
`tournamentBracket` (1080×1350):
```
{ lockupWord, eyebrow, dateLabel, timeLabel, prizeAmount,
  r1: [{ a: { name, seed, sub, photo }, b: {…}, winner: 'a'|'b'|null }] ×4,
  r2: [{ a|null, b|null, winner }] ×2, final: { a|null, b|null, winner },
  champion: { name, photo }|null, cta }
```
Photos arrive as data URIs (`photoDataUri`, best effort, null on failure → the silhouette).
