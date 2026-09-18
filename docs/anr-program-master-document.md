# The A&R Program — Master Document

**Operator:** Makin' It Magazine (makinitmag.com) · **App:** anr.makinitmag.com
**Compiled:** 2026-09-14, updated 2026-09-15, from the repo docs, specs, operator manuals, the brand and service-pack skills, and the session memory. Includes the tournament restructure decided 2026-09-14 and refined 2026-09-15.

**How to read this.** Every statement is tagged where it matters:
- **LIVE** — built, pushed, running in production.
- **BUILT** — built and tested but not yet pushed (as of 2026-09-14 that is migration 038 and the brand assets).
- **DECIDED** — the operator has decided it; nothing is built.
- **PARKED** — discussed, deliberately not planned.
- **OPEN** — a question nobody has answered yet.

Section 8 records the tournament structure (decided 2026-09-14, refined 2026-09-15); Section 15 lists what is still open. Answer those first when refining.

---

## 1. The program in one page

Makin' It runs an A&R department that does two things at once: it gives independent artists a real, visible, participating audience that rates their records, and it turns that audience into a team of competing talent scouts who play for cash.

**The thesis:** two competitions in one room. Artists compete to make the chart; the audience competes to read the room. A demonstrably real, competitive audience is what makes an artist's dollar worth spending, and the artist's dollar funds the prize that buys more audience.

**The properties** (A&R is the master mark; Makin' It is the endorser; each property is a descriptor off it):

| Property | What it is | Where it lives | Status |
|---|---|---|---|
| **The A&R Team** | The membership. The app. You do not sign up for an app; you join the team. | anr.makinitmag.com | LIVE |
| **A&R Daily / The A&R Meeting** | The daily async review drop. 4–16 records open at noon ET, the team rates them for 24 hours, results at 3 PM the next day. The core of the product. | app `/daily`; submissions at makinitmag.com/review | LIVE |
| **A&R Room** | The weekly live broadcast. Wednesday 7–11 PM ET, six platforms. Now a special event on top of the daily. | makinitmag.com/live + app live play | LIVE |
| **A&R Service Pack** | The paid monthly promotional distribution pack (up to 100 records to 30,000+ industry contacts, DJs, tastemakers). | makinitmag.com/packs | LIVE (off-app) |
| **A&R Wars** | The A&R tournament. Monthly. 8 A&Rs (4 weekly seats by points + 4 monthly seats by accuracy), single elimination, audience votes each matchup, $500 cash. | YouTube live + app voting | Format DECIDED 2026-09-15; tooling deferred |
| **Makin' It $1,000 Music Review Tournament** | The artist tournament. The top track of each week earns a seat; when 8 seats are filled, 8 artists play their own catalog head-to-head live for a $1,000 Promo Budget. | Live stream | DECIDED 2026-09-15; nothing built |
| **Pick the Hits ("the sidebet")** | Free side contest: predict which Service Pack songs get played at A&R Wars. $150 sponsor-funded. | app `/sidebet` (makinitmag.com/TopPicks) | BUILT (033) |
| **Mimbership** | Makin' It's professional network. Members pay dues. Sold on the daily show's pitch. | makinitmag.com | LIVE (off-app) |

**Prizes, per the 2026-09-15 structure:** $500 cash monthly to the A&R Wars winner (DECIDED 2026-09-15: stays $500 for now, may change later) · $1,000 Promo Budget every 8 weeks (Music Review Tournament; a site credit, not cash) · $150 sponsor-funded (Pick the Hits). **"The month's Top A&R" is the A&R Wars champion** (DECIDED 2026-09-15): the board only decides who qualifies to compete, so the "$500 to the month's Top A&R" line on the approved graphics stays true as written.

**Cadence:** daily drop every day · live show every Wednesday (announces the week's top A&R and top track) · Service Pack every month · monthly Series · A&R Wars monthly · Music Review Tournament when 8 weekly seats fill (about every 8 weeks); each held 4 weeks after its window closes, on Sunday (recommended).

---

## 2. The business model

### 2.1 The market: the squeezed middle

The music-review market has lost the ability to signal who actually delivers.

- **The bottom floods the field.** Hobbyists with an $80 livestream setup do free or $5–20 reviews. Not worse, just so numerous that price and quality stop being legible.
- **The top sells borrowed clout.** Established names and platforms (Nero and the like) sell $100+ submissions that function as a high-priced lottery. They signal more; they do not deliver more.
- **The serious artist chases the names**, because a famous face is the only legible proxy for "this person can do something for me."

The middle (DJs, promoters, platforms with a real audience and real pathways) delivers the most and signals the worst. "We have a real room" is harder to prove than a blue check. That gap is the wedge.

### 2.2 The wedge: participation as proof

When an artist submits to a clout-merchant there is a host and a void. When they submit here there is a host, a co-host, and a live audience actively rating the record and competing to read it right. The artist can watch the room rate. A hobbyist cannot conjure a competing audience; a clout-merchant will not give the crowd a real voice, because their model depends on the artist not seeing the room is empty. Giving the crowd a visible competitive stake is a costly signal, which is what makes it credible.

**The honest limit:** the moat is the room and the operating quality, not the code. Anyone can build a poll. Defensibility comes from the community, the real pathways (bookings, playlist placements, the tournaments), and feedback quality. It is a position to be operated, not a patent to be held.

This market theory is internal reasoning. It is not the artist-facing pitch. Artists care that real people will hear their song and that there is a real path forward.

### 2.3 The flywheel

The audience competes free for cash by reading the room well → a competitive engaged audience makes the room demonstrably real → a demonstrably real room is what an artist pays for → artist revenue funds the prize and the operation → the prize and the promo pull more audience → repeat.

### 2.4 The integrity wall (load-bearing, not compliance polish)

- **Paid placement buys exposure, never a score and never a win.** The Service Pack is promotional distribution. The sales page says it: "The A&R Room is for feedback. The Record Pool is for exposure and activity."
- **The audience competition is free to enter and ranked purely on skill.** No payment qualifies anyone; no spend affects rank.
- **Artist money and A&R points never touch.** A leaderboard that could be bought is worth nothing to anyone.
- **Neither product earns the other.** An artist submits to the Meeting to find out if a record is any good; they buy the Service Pack to get it in front of people who can move it. No "top-scoring records get placed" module. No pack call-to-action on a results screen. A Meeting asset never mentions placement; a Pack asset never mentions scores.
- **Prizes have gone to A&Rs only** (standing rule through 2026-09-13). What an artist gets is exposure and feedback: the Song Report, the A&Rs' comments, the Top 8 graphic, the results carousel, and editorial bookings (performances, interviews, playlist placements) at the operator's discretion on the Makin' It side. The Music Review Tournament (2026-09-15) adds a $1,000 Promo Budget, won by audience vote and spent as promotion on the site; the rule reads better as "prizes are won by vote, never bought" (15.10).
- **The seal.** During any round, the room's average or A/B split is never shown. Vote count yes, vote direction never. It is what players are predicting. Round comments are readable only by their author and the host. Pick counts in the sidebet are sealed until settle for the same reason. Server-enforced everywhere.

### 2.5 The prize framing

The cash prize is a deliberate audience-acquisition cost, funded by the placement business; whether it is fixed or scales with submissions has never been decided (OPEN, from the product brief).

---

## 3. The core mechanic and the scoring system

Everything competitive rests on one atomic move, used on every record, live or daily:

1. **Rate** the song 0–9 (your taste; you are never wrong).
2. **Predict the Average** the room will land on, to one decimal (the skill that is scored).
3. **Lock in.** Both freeze.
4. **Reveal.** The room's average is computed; your prediction is scored on accuracy.

The mechanic is called **"Predict the Average"** in copy (replaced "read the room" 2026-08-31). The number is "the average".

### 3.1 Rating rounds (LIVE)

- Room average = mean of all ratings, rounded half-up to one decimal. The number shown on screen is the scoring target by construction.
- `points = 100 × e^(−error × 0.5)`, rounded.
- **Bullseye** (exact hit at the tenth): +25 bonus → always 125. The maximum per round.
- More than 5.0 off: −10 penalty. A single round can go negative; the cumulative total is floored at 0.
- Emotional tiers on the results screen: Bullseye (exact) · Sharp read (≤0.5) · Close (≤1.5) · Off (≤5.0) · Way off.
- **Letter grade** = absolute accuracy band (`accuracy = 100 × (1 − avgError/9)`), not a percentile. If the sharpest read in the room is a B, it is a B.
- **DECIDED, not built:** the scale moves 0–9 → 0–10 at the v1 official launch (base-10 intuition; "6.5" reads as "/10" universally). Forward-only; history is not rewritten; points stay comparable across scales because they are accuracy-derived.

### 3.2 Versus rounds (binary polls, LIVE)

Song A vs Song B. Pick a side, predict the split (0–100% for A), lock in. Majority wins the round. Scored on split accuracy (`K = 0.035`, bullseye within 3 points, penalty past 35 off). Versus rounds never chart, never appear in Top 8 Songs, and take no comments. Poll type is per round, so a session can mix rating and Versus rounds.

### 3.3 Bonuses on the same board

| Bonus | Amount | Trigger | Status |
|---|---|---|---|
| **Completion bonus** (daily) | 100 / 75 / 50 / 25 | Handling every record in the day, tiered by finish time. As built: 100 before 3 PM · 75 before 6 PM · 50 before 9 PM · 25 after. DECIDED 2026-09-13 to re-space across the new 24-hour window (100 before 6 PM · 75 before midnight · 50 before 9 AM · 25 before the noon close), not yet built. Paid once per person per day; days under 3 records pay nothing. A flagged (reported) record counts as handled. | LIVE (old tiers) |
| **Scouting points** | 250 per point of room average above 5.0 | An A&R referred the artist who submitted (attribution captured by Drupal; points credited at tally). A 7.0 record earns 500. At or below 5.0 earns zero, never negative. | LIVE |
| **Referral milestones** | +10 at the invitee's 10th scored round; +75 at their 50th | First-touch, brand-new accounts only. Lands on the series of the session where the milestone crossed. | LIVE |
| **Live show bonus** | `sessions.live_bonus`, intended ~300 | Rating every record in a live session. Without it one live show is worth less than a day of daily play on the unified board. | Built; **value never set** |

**One board, not two.** An A&R is measured on ear for music (accuracy) and eye for talent (scouting). Both feed the same monthly total and the same $500. A breakdown may live on a profile; there are never separate leaderboards.

### 3.4 The Series (the season container, LIVE)

- A Series is a container; membership is an explicit tag on each session (daily drop or live show). Dates are labels, never filters. A special Friday session counts only if tagged in.
- The board is **live-computed** (sum of points across tagged sessions, grouped by user), never stored, so it stays correct through retagging and re-ratification.
- Series are **numbered, not dated** in copy ("Series 3").
- Closing a series is a status flip; qualifiers are read live off the final board. `qualify_count` per series drives the cut.
- Every daily drop refuses to be created without a series tag (an untagged day scores people into a void).
- A month = a new Series. Last month's stays intact as history.

### 3.5 Eligibility (LIVE)

A **complete profile** (display name + at least one category + a primary category + location) is required to appear on the board and to qualify for prizes. Incomplete profiles can play and vote but are not ranked. This doubles as prize-payout identity. Display names are not unique; profiles carry photo, city, Instagram, TikTok.

---

## 4. The A&R Team (the membership, the app)

**What it is.** The durable identity every A&R holds. Email is the unique key; verification is a six-digit emailed code; phone is optional. An account outlives any session. Sidebet entrants become accounts too, which is how the contest seeds the audience.

**Join copy (operator, verbatim):** "Help pick the artists we book for shows, interviews, and playlist placements. $500 to the month's Top A&R."

**Registration.** Email → code → display name + optional phone → a "Notify me when this and future rooms go live" checkbox (checked by default). Three paths (play page, join page, one-tap register when logged in) all write the same consent.

**Profile.** Public: display name, photo, categories (select all, then the one most focused on), city, Instagram, TikTok. Private: email, phone, notification preferences.

**Notifications (LIVE, 028).** Per-topic preferences: `room_live` (email + SMS, default on), `digest_daily` (email, default off, has a sender), `digest_weekly` (email, default off, **no sender exists**). SMS consent is a separate explicit decision that survives re-joins. Signed manage/unsubscribe links ride every message. A global email opt-out kills everything including mass announcements.

**Referrals and invites.** Every A&R has an invite link. The referral bonus above pays the recruiter when the friends they bring keep playing.

**The vocabulary.** Players are **A&Rs** (never users, participants, voters). One instance of a show is a **Session** (reversed from "Room" on 2026-08-31; the back-sweep of ~320 strings is outstanding). Brand names are unaffected.

---

## 5. A&R Daily / The A&R Meeting (the daily drop)

**What it is.** The async listening session artists submit to. Every day a set of records opens and the team rates them at their own pace. This is the product; the live show is an event on top of it. It fixes the post-signup dead zone (nothing to do until Wednesday), lets people play at work, and lifts the artist cap off the four-hour broadcast.

Naming: **The A&R Meeting** is the artist-facing name of the review (what you submit to); **A&R Daily** is the A&R-facing name of the drop. Same thing, two doors.

### 5.1 The day (LIVE; schedule set 2026-09-13, built as 038)

| ET | What happens | Who |
|---|---|---|
| Before noon | Tomorrow's records are staged: Drupal pushes the approved day, or the operator builds it by hand | Drupal / operator |
| **12:00 PM** | Yesterday's set closes and tallies; today's set opens. Every record goes live at once. | machine |
| 12:00 → 12:00 next day | The 24-hour window. Rate and predict whenever. Everyone starts over at noon. | A&Rs |
| 12:00 → 3:00 PM | Results are tallied but **sealed**. Nobody sees an average. | — |
| **2:00 PM** | **The daily live show** (the reveal stream), run off the console | assistant host |
| **3:00 PM** | Publish: site reveal, A&R digest email, graphics, results callback to makinitmag | machine |
| **4:00 PM** | Artist Song Reports and artist texts start (the one-hour comment hold) | machine |

A&R-facing copy keeps one number: noon. "Results at 3 PM, revealed live at 2 PM" is the only other time in player copy. Days built before the 038 deploy keep the old window (close 9 AM, publish noon).

### 5.2 The records

- **4–16 per day, never a fixed count.** 4 drawn at random from the free pool + up to 12 paid. Hard ceiling 24.
- **Selection, pricing, the free pool and its aging live entirely in Drupal.** The app receives an approved list and runs the day. No shadow copy.
- **Submission on makinitmag.com/review:** pay-what-you-want **$10–$100** for a paid slot (weighted by amount); free submissions enter the pool. Submit copy (operator, verbatim): "Get feedback from up to 50 A&Rs and qualify for free performances, interviews, and playlist placements." / "Unfinished, Incomplete, and AI assisted songs are accepted."
- **The artist's note** is context, not a question: "Hey, this isn't mixed. Just recorded it on Bandlab last night." Shown above the rating as "From the artist". 500 characters.
- **Support level** (037): what the artist paid, stored per record, admin-only. Drives the reveal stream (free records play ~1 minute, paid records in full) and names the day's **top supporter**. Never shown to A&Rs or artists, scores nothing.
- **Reference tracks** (035): a known record from a major artist, hand-added so the team has something familiar to rate. Scored, but excluded from charts, the Top 8 card and the artist report queue.
- **Per-A&R order** is a seeded shuffle, so drop-off spreads across the whole day.
- **Report a record** (dead link): counts as handled for the bonus. Capped at 3 per person per day and always at least one below the day's size, so nobody flags their way to a bonus. Three flags from three people is the number worth checking.
- A record cannot be added or removed once the day is open. A dead link can be fixed mid-window (the most operationally important button on the console).

### 5.3 What the A&R does

Listen on the play link → rate 0–9 → predict the average → lock in → optionally leave **one note (≤500 characters)** for the artist → Follow button (Instagram) and Artist profile button (public makinitmag profile) after lock-in → next record. Finish the day for the completion bonus.

### 5.4 What the artist gets (all free, all editorial)

- The **Song Report**: a 3-page analytics graphic per record (the flex page with the score; the numbers page with histogram and the perception gap; the who-felt-it page by role, city and pool). Emailed to every artist whose record was rated and has an email on file. **No price is ever mentioned** (a test enforces it). VIP-gating (only VIP tiers get it; first-timers free once) is PARKED.
- **The A&Rs' comments**, attributed by name, role and city, riding the report. Comments ship by default; the host's job is rejecting the odd bad one in the hour after publish. There is no unsend.
- The replay link and carousel-post instructions (@Makinit4indies collaborator, #TheARoom).
- A heads-up **text** ("your song was played, check your email") inside the 10 AM–10:30 PM ET window.
- Their record on the **results carousel** (ranked, no scores) and, if #1, the Top Track slide.
- A **"Scheduled for review" share graphic** the moment they submit, so artists promote the submissions.
- The results posted back to makinitmag so their artist status page can confirm the review (`rated | not_playable | unrated`, with counts and the average).

### 5.5 The daily live show at 2:00 PM ET (DECIDED 2026-09-13; runs today off the console)

**Hosted by the operator's assistant**, not the operator (whose daily-involvement target is zero). Format as it runs today: count down every record 30–90 seconds each, read audience comments on air, play #1 in full, count down the Top 8 A&Rs, then the pitch (submissions, Mimberships, opportunities, deadlines). The overlay carries a comments panel, viewer count, an ad slot ("Advertise here · $100 for 8 weeks") and a lower third ("Text REVIEW to submit music" / "Text A&R to join the A&R Team").

**Why the show stays (the operator's insight):** the audience are impulse buyers who submit while a stream is live because they believe the record can be played right then. The site cold does not convert the same way. **The show is a sales floor, not a marketing channel.** Decide after four weeks of paid-submissions-per-day data whether 2 PM is the right hour; move it later rather than drop it.

Planned additions (DECIDED, not built): an optional **live lane** segment ("submit now, hear it now") using the existing live-session tooling; an **urgency layer** (noon submission lock as a visible countdown; "N of 12 slots left" from a Drupal `slots.json`) on the landing page, the artist report email, the reveal screen and a show overlay variant; auto-created daily live session for the assistant; a scoped `show_host` role (PARKED until the real permission set is known; today the assistant needs a platform-admin account).

### 5.6 Graphics the day produces (LIVE / BUILT)

- **Top 8 A&Rs** and **Top 8 Records** cards (ride the digest email).
- **The A&R Meeting Recap cover** (IG Live, 9:16) and **YouTube thumbnail** (16:9) plus caption. Date is the hero (MM.DD.YY of the day the stream airs). Artists in drop order, A&Rs alphabetised, **never ranked**: the stream is the reveal.
- **Results carousels** (038, BUILT): two Instagram carousels posted after the stream. **Top Track** (trophy · "Top Track" · date; title, artist, handle → the other records ranked without scores, six a slide → "Submit your music / Free Review by the A&R Team"). **Top A&R** (name, city, handle, profile photo → the other top A&Rs with points → "Join the A&R Team / Win $500 as the month's top A&R"). $500 prints only on the A&R deck. Instagram auto-posting via the Graph API is DECIDED, not built; the assistant posts from the console meanwhile.

### 5.7 The emails

| Email | Who | When |
|---|---|---|
| A&R digest (common Top 8 block + a personal round-by-round table for anyone who played, with a plain line when there is nothing personal) | Everyone who chose Daily Digest (opt-in, default off) | 3 PM |
| Artist Song Report | Every rated artist with an email on file | 4 PM |
| Artist text | Same, with a phone, inside 10 AM–10:30 PM ET | 4 PM or next morning |

DECIDED, not built: split into a general Daily Digest, a transactional A&R Results email to everyone who voted (no opt-in gate), and a Wednesday Weekly Digest with the week's top records and A&Rs plus a reminder of that night's live review.

### 5.8 Console (LIVE)

Opens on A&R Daily; the live show tooling sits behind a mode switch. Day picker, state pill (Scheduled / Open / Processing / Closed / Published), the records table (score, support, flags, play link, three sort orders including "Countdown, lowest first" for running the show), send counters, the graphics card, the next-drop builder, "Run the lifecycle now" and "Publish the day". A cold drop can be moved to another day via the API (no button yet). Operator manual: `docs/daily-operator-manual.md`. Setup: `docs/daily-setup.md`.

---

## 6. A&R Room (the weekly live broadcast)

**What it is.** Wednesday 7–11 PM ET, host and co-host give live on-air feedback on submitted records, multistreamed to six platforms (no single platform can deplatform it). The original product; now a special event layered on the daily.

**The show loop (LIVE):**
1. Submissions: paid review slots (standard / priority / VIP, capped ~10 each to protect feedback quality) plus a free lottery (any registered user can submit; 10 drawn; you must be live in the room when called, which converts submission desire into attendance). Pushed from makinitmag.com/review straight into the host queue.
2. Each record is **staged**: opens into `listening` (on the overlay and in every hand, no dial, no clock) → host opens voting (everyone's window is identical) → clock → ratify (reveal). One **Advance** button drives the whole show, on screen and on a Stream Deck. Ratify is double-pressed. A host buzzer marks the last five seconds.
3. Viewers rate and predict on their phone; the tap-to-start YouTube embed lets watch + vote live on one device.
4. Points accrue to the active Series like any other session (`live_bonus` intended to make a live night worth roughly three perfect daily days; still unset).
5. Post-show: Score Cards, Top 8 Songs, Top 8 A&Rs, recap emails, artist Song Reports + texts, an Asana post kit with a 16-handle caption.

**Capacity:** roughly 40 records in a four-hour show is a hard ceiling; expert feedback is the first casualty of volume. The caps are deliberate scarcity.

**Stream overlay (LIVE):** now-playing card, countdown, vote-count card, lower thirds, starting-soon; horizontal and vertical; QR calls to action; leaderboard scoped to room / round / series. Seal rule applies. No LIVE pill (platforms badge their own).

**Invite-only sessions:** unlisted rooms with an access code. Points still count toward the series (OPEN whether they should).

**The host program (LIVE, invite-only).** Other music-review streamers get the engagement tool free for their own stream (voting, points, leaderboard). Everything stays A&R-branded; hosts never see viewer email or phone (server-side redaction); Makin' It keeps the audience data, like a Facebook Page. Host incentive: inclusion in the monthly $500 giveaway (per-host flag). Hosts get email-only go-live notices, per-host defaults, a Stream Deck control key. Not a branded SaaS, no billing.

**Weekly graphics (BUILT, approved):** key art and a date-parameterised weekly post (MM.DD.YY in Space Mono, "Wednesday · 7PM ET · Live music review", guest as "FEATURING:" over the name), thumbnails in three ratios, the "Watch the broadcast" ad, be-right-back / end screens and a 20-second starting-soon OBS loop (awaiting approval).

---

## 7. A&R Service Pack (the paid promotional product)

**What it is.** A monthly campaign distributing new records to over 30,000 industry contacts (DJs, tastemakers, promoters). Artists buy a placement. It is **not** the review queue and nothing in it is earned by rating. Two separate products, two separate forms.

**Pack ad (operator, verbatim):** headline "Break Your Record"; body "The A&R Service Pack is a monthly campaign distributing new records to over 30,000 industry contacts. Placements start at $49 (for a limited time)." The $49 is set in mono, never gold (gold marks prizes).

**Tiers:** Featured (pinned 1–10, full directory page each, artwork) · Priority (four to a page) · Standard (compact rows, monogram). Standing intent ~$50 / $100 / $150; the live sales page has run $49/$99/$149 off $99/$199/$349 list.

**Capacity:** up to 100 songs a month. Ships on USB drives and as a download, with a Spotify playlist.

**One edition produces four things that must agree** (built by the `anr-service-pack` skill from the Drupal webform CSV, Drupal node 14002): tagged MP3s (`Songs/`, ID3v2.3, FAT-safe names, non-MP3 transcoded to 320k for CDJs), the M3U playlist, the artist directory PDF (paper palette, Featured/Priority/Standard structure, contact details for tastemakers), and the Spotify tracklist (a two-pass resolution; accept a match only when the artist name agrees).

**Artist share graphic (approved 2026-09-13), sent to each placed artist at pack release, four lines verbatim:** "Win $150 Cash" / "Check out the latest A&R Service Pack featuring "SONG" by ARTIST" / "And Submit your top picks to win" / "Free to Enter at makinitmag.com/TopPicks". No score on it. Placed artists promote the side bet, which drives pack downloads.

**Relationship to the tournaments:** the pack is the pool A&R Wars competitors scout from, and the song list the side bet is played against (confirmed 2026-09-15). The artist tournament plays catalog, never the pack.

Colour: purple. Links: makinitmag.com/packs.

---

## 8. The tournaments (DECIDED 2026-09-14, refined 2026-09-15)

Two separate tournaments, each with its own prize, cadence and field. This supersedes the 2026-07-01 format (top 4 from the monthly board + 4 invited Tastemakers, bracket tracked by hand) except for the mechanic, which carries forward: single elimination, 8 → 4 → 2 → 1, every matchup a binary Versus poll, **the audience votes, majority advances**. Competitors are not session participants.

### 8.1 The week (DECIDED 2026-09-15: Wednesday through Tuesday)

**Wednesday through Tuesday.** The Tuesday-dated drop closes Wednesday noon and publishes at 3 PM, so the week's top A&R and top track are final before the 7 PM A&R Room show. The show **announces both weekly winners live**, and its own records open the new week. The alternative (Monday–Sunday, announced Wednesday) leaves the winner known on a public board for two days before it is announced.

- **Weekly top A&R** = most points in the week (daily accuracy, completion, scouting, live). Earns the A&R Wars seat.
- **Weekly top track** = the **highest-rated song from Wednesday to Tuesday** (DECIDED). Earns the Music Review Tournament seat. Still to settle in the build: the min-vote floor (the Charts logic) and whether Wednesday-show records and daily records share one pool; reference tracks and Versus rounds never count.
- **The daily top A&R and daily top track continue** (the results carousels already name them).
- **Repeat winners:** if the same person or record tops more than one week, the seat **passes to the runner-up**. One seat per person per tournament.

### 8.2 Makin' It $1,000 Music Review Tournament (artists)

- **Purpose:** increase artist participation beyond research, and give promotional graphics and messaging a stronger hook.
- **Field:** the top track of each week earns a seat. **When all 8 seats are filled, the tournament is held.** So the qualifying window is about 8 weeks, spanning two monthly Series (see 8.4).
- **Prize: $1,000 Promo Budget.** Exact wording, always. Promo Budget is an existing makinitmag.com feature: money a user earns and spends on promo, submissions and services on the site, at their discretion. **It is not a cash prize**, but it spends like cash on the site.
- **What the artist plays:** **any records from their own catalog**, matchup by matchup. Not the submitted record only, and never the Service Pack.
- **Seeding:** OPEN (by the winning song's rating, or the order the seats were earned).
- **Name:** "Makin' It $1,000 Music Review Tournament" (DECIDED).
- **When:** 4 weeks after the qualifying Series closes (prep and promo time). Tournament night: **Sunday recommended** (Wednesday is a sales night; a tournament plays no submissions).

### 8.3 A&R Wars (A&Rs)

- **Cadence: monthly** (DECIDED 2026-09-15).
- **Prize: $500 cash** (DECIDED 2026-09-15: continue with $500 for now; revisit if participation and sales do not justify it).
- **The title "Top A&R of the month" is won in the tournament, not on the board** (DECIDED 2026-09-15). The Series board is the qualifier: it fills the seats and seeds them. So the promise already printed everywhere, "$500 to the month's Top A&R", stays exactly as written. The hierarchy of the word: daily Top A&R (the results carousel) → weekly Top A&R (a Wars seat, announced Wednesday) → the month's Top A&R (the A&R Wars champion, $500).
- **Field, 8 seats (DECIDED):** **4 weekly seats** = the weekly top A&R **by points**, one per week of the month; **4 monthly seats** = the most **accurate** A&Rs over the full month **with a minimum number of rounds voted** (the threshold is to set; the absolute accuracy grade already exists as the read). A weekly winner cannot also take a monthly seat; seats pass down.
- **Seeding:** total Series score.
- **What the competitor plays:** picks scouted from the month's **A&R Service Pack** (carried forward). The artist tournament plays catalog and Wars plays the pack, which is what keeps Pick the Hits ("which 18 pack songs get played") intact; letting Wars competitors pick from both would undercut the side bet.
- **When:** 4 weeks after the month closes. Sunday recommended.

### 8.4 Series length and the calendar

- **Series length follows the A&R Wars cadence** (DECIDED 2026-09-15). With Wars monthly, a Series stays **4 weeks / one month** and gets real start and end dates. Series membership stays the explicit session tag; the dates label the window.
- **The Music Review Tournament is not tied to a Series.** Its qualifying window is simply "8 weekly seats filled", which spans two monthly Series; the seat is earned by the week, not by the board.
- Each tournament is held **4 weeks after its window closes**: A&R Wars roughly monthly, offset a month behind the Series it seats; the Music Review Tournament roughly every 8 weeks, 4 weeks after the 8th seat is earned. Some months will hold both.

### 8.5 Points during tournaments

- Viewers **earn Series points on every tournament matchup** (both tournaments), the session tagged into the active Series like any other.
- **Bonus for voting on all rounds:** possibly. The `sessions.live_bonus` mechanism (pays an A&R who rated every record in a live session; value never set) is exactly this, so it is a setting, not a build.

### 8.6 Tooling

Expanded tooling to moderate, organise and manage tournaments (weekly-winner computation and announcement, roster and seats, seeding, bracket advancement from poll results, overlay bracket, winners archive on the homepage) **will be built once the format is set in stone, not before.** Today: binary polls, matchup queuing from a pack, the sealed split and series qualify count are LIVE; nothing computes a weekly winner.

---

## 9. Pick the Hits (the sidebet, BUILT 033)

A free-entry prediction contest at `/sidebet` (makinitmag.com/TopPicks redirect needed). Entrants pick which 18 songs from the month's Service Pack will actually be **played** at A&R Wars and put them in order. Most correct wins the sponsor-funded prize ($150 at launch). Ties break on order distance against the consensus ranking, then earliest final edit.

- **Set membership, not ratings.** Nothing reads votes, averages or the board; no points are awarded.
- **18 = the bracket** (9 binary polls × 2 songs), stored per pack, never hardcoded. A past month ran 14.
- **Pick counts are sealed until settle** (they are the tiebreak; a live count would make copying the crowd dominant).
- Identity is the same email code as the app; an entrant becomes an A&R Team account with no session history: **the contest seeds the audience.**
- Entries are editable until the cut-off, which must be before the show.
- Sponsor banner on every screen, no fallback to a house ad ("courtesy of our sponsor" must be true).
- Settle derives the played 18 from the Wars matchups queued from the pack and asks the host to confirm.
- Approved copy: "Pick the hits. Win $150." then the four numbered steps (see the brand voice section).
- OPEN: the full-rules page copy and how the prize gets paid.

---

## 10. Artists: the full journey and the offers

| Stage | Artist experience | Offer / revenue |
|---|---|---|
| Discover | Ads ("Submit your music"), the daily show's pitch, "Text REVIEW", artist share posts, results carousels | — |
| Submit (Meeting) | makinitmag.com/review; free pool or pay-what-you-want $10–$100; unfinished and AI-assisted songs accepted; add a note on how to hear it | Paid submission |
| Submit (Room) | Paid review slots (standard / priority / VIP, ~10 each) or the free lottery (be live when called) | Paid slot |
| Scheduled | "Scheduled for review" share graphic at submission | — |
| Reviewed | Rated by up to 50 A&Rs in the daily, or live on the Wednesday show; played on the 2 PM reveal (free ~1 minute, paid in full; top supporter singled out) | — |
| Results | Song Report + comments emailed free, text heads-up, ranked on the carousel, status confirmed on their makinitmag page | No upsell in the email |
| Chart | The Makin' It HOT 100 (records ranked by room average with a min-vote floor; bands: 0–2.9 Keep it in the studio · 3–5.9 Release Ready · 6+ Potential Single) | — |
| Bookings | Top songs "qualify for free performances, interviews, and playlist placements" (operator's words), at Makin' It's discretion, off-app | — |
| Weekly winner → Tournament | 8 weekly winners compete live for the $1,000 Promo Budget | — |
| Promote | Buy a Service Pack placement (separate product, never earned by rating); "I'm in this month's pack" share graphic | Placement $49+ |
| Belong | Mimbership: a professional network; members pay dues (never "subscribe"); tiers, standing, honorary, lapsed, reinstate | Dues $1,000–$15,000/yr |
| Services | Marketing/PR, playlisting, magazine coverage, à la carte | à la carte |

**Artists are not users.** They have no app account, no notification preferences, no manage link. Someone who is both an A&R and an artist gets both sets of messages, deliberately.

---

## 11. Revenue lines and pricing (as recorded)

| Line | What | Price on record |
|---|---|---|
| Service Pack placement | Monthly promotional distribution to 30,000+ contacts | From $49 (limited time); tiers ~$50 / $100 / $150; list $99 / $199 / $349 |
| Daily review submission | Pay-what-you-want paid slot in the daily drop (up to 12/day) | $10–$100 |
| Weekly review slots | Standard / priority / VIP live review, ~10 each | per slot (not on record here) |
| Mimbership dues | Professional network membership | $1,000–$15,000 annual (tiers) |
| Artist services | Marketing/PR, playlisting, magazine | à la carte |
| Advertising | Revive ad server in the app (lobby + game zones); overlay slot "Advertise here · $100 for 8 weeks"; sidebet sponsor banner | $100 / 8 weeks (overlay) |
| Sponsorship | "Presented by" on A&R Wars, the recap graphics and carousels; the sidebet's $150 is sponsor-funded | sponsor-funded (line PARKED for graphics) |
| Song Report | Built as a paid tier; currently given free to every artist for visibility | Pricing OPEN; VIP-gating PARKED |

**Infrastructure cost is not a line:** all managed services (Vercel Pro, Neon, Ably, Resend/Mandrill, Twilio, Vercel Blob), ~$0–20/month today, ~$138 all-in at 1,000 concurrent, under a $200/month ceiling. A signup-burst load test passed 2026-07-02.

---

## 12. Marketing, content and brand

### 12.1 The content engine (what generates itself)

- **Daily:** recap cover + thumbnail + caption (morning), the 2 PM stream, two results carousels (after), the digest, the artist reports and share graphics.
- **Weekly:** the date-parameterised Wednesday post and thumbnails, Top 8 Songs, Top 8 A&Rs, Score Cards (A&R-generated), the Asana post kit.
- **Monthly:** the Service Pack (playlist covers, directory PDF, per-artist pack graphic), the HOT 100 chart carousel (records or A&Rs; series, date range, last N sessions), the series winner announcement (NEEDED), the tournament.
- **Evergreen ads (approved):** Join the A&R Team · Submit your music · Watch the broadcast · Break Your Record (pack). Feed 1080×1350 and story 1080×1920.
- **Motion (mocked up, awaiting approval):** logo bumper, show open/close, 15-second typographic teaser, the starting-soon OBS loop.
- The full inventory (65 assets, four properties, status per asset) is `docs/promo-asset-list.md`.

### 12.2 Links printed on graphics

| Property | Printed link |
|---|---|
| Join the A&R Team | makinitmag.com/ANR |
| Submit music (the Meeting) | makinitmag.com/review |
| Watch the Room | makinitmag.com/live |
| Service Pack | makinitmag.com/packs |
| Pick the Hits | makinitmag.com/TopPicks (redirect to anr.makinitmag.com/sidebet still needed) |

The app is served at anr.makinitmag.com; the printed form is marketing only.

### 12.3 The brand system (the `anr-brand` skill)

- **One master mark, A&R**, in a 13° skewed block. Lockups: [A&R] TEAM, [A&R] MEETING, [A&R] ROOM, [A&R] SERVICE PACK. **No article in a mark** ("The" stays in copy). Spelling: A&R Wars, never Warz.
- **Colour has a job:** signal green `#4BB749` = live, scoring, go, the Team and the Room · contest purple `#6D5FE0` = head-to-head, the bracket, the Service Pack · prize gold `#F5C518` = money and first place only · deadline red `#FF5D6C` = rare. Ground `#0E0C1A`. Paper palette on light grounds.
- **Type:** Archivo 800/900 for display (tight, heavy); Space Mono for every number, label, price, date, score.
- **The 13° diagonal:** block, ticks, rule, cut. Never a full-bleed cut behind type.
- Design for the smallest size the thing is seen at. No emoji, no exclamation marks, no dingbats as icons.
- Seal, PII (display name, city, points only) and wall rules apply to every graphic.

### 12.4 Copy voice (operator, 2026-08-30)

**Plain and direct.** Say what the thing is and what the person should do. No slang, no music-industry affect, no borrowed cultural voice ("You come off like a poser"). When the operator supplies wording, use it verbatim. Prefer the literal noun (songs, picks, entry) over an invented one. Rejected for calibration: "Got a good ear for music?", "Call all 18 and the money's yours", "surest bet", "dark horses", "your card". Approved reference:

> **Pick the hits. Win $150.**
> Pick the top 18 songs from this month's A&R Service Pack for a chance to win $150 cash.
> 1. Check out this month's A&R Service Pack.
> 2. Pick your top 18 songs.
> 3. Tune into the A&R Wars tournament to see if your picks get played.
> 4. Person with the most right selections wins.

Copy is time-of-day-neutral and tenant-neutral (other hosts run sessions). Every user-facing string is inventoried in `docs/copy-inventory.md` / `.xlsx`; a Room→Session terminology reconciliation against the operator's revised spreadsheet is outstanding.

### 12.5 Growth loops

- **The free lottery** fills the room from artists' own followings.
- **Scouting:** A&Rs recruit artists with a personal link (`makinitmag.com/opportunities/anr-meeting?a=<uid>`); Drupal counts every scouted submission (ambassador tiers, promo budget); the app pays points only for records that make a drop and score above 5.0. The two counts differ on purpose.
- **Referrals:** invite links with milestone bonuses.
- **The side bet** seeds verified accounts from a $150 hook.
- **Artists promote the program**: the scheduled-for-review post, the pack post, the results carousel, the report's carousel instructions.
- **The sanctioned bonus-round network** (HORIZON): partner reviewers' sessions tagged into the Series; their audience registers on the platform; the partner markets the prize without funding it.
- **Celebrity invite-only sessions** for the month's top N A&Rs (HORIZON).
- **Analytics:** GA4 (env-gated) with custom events for register, session register, vote locked, profile complete, account signup, submit click; an admin Analytics screen for cross-session engagement and retention. First-week baseline (8 shows, July 2026): 85 A&Rs, 1,176 predictions, 32% returned for 2+ shows, 35% strong reads.

---

## 13. Operations

### 13.1 Roles

| Role | Does | Sees |
|---|---|---|
| Operator (platform admin) | Series, packs, platform panel, charts, announcements, the daily console, Wars | Everything, including artist contact details |
| Assistant (2 PM host) | Runs the reveal stream off the daily console; posts carousels | Today: a platform-admin account (trusted). A scoped `show_host` role is PARKED |
| Host (invited creator) | Their own live sessions, overlay, email go-live | Names, points, counts, socials. Never email/phone |
| A&R | Plays, comments, scouts, refers | Their own record and public boards |
| Drupal (makinitmag.com) | Submission forms, payment, pool, selection, the daily push, scouting links, artist status pages, results intake | Its own submitters |

### 13.2 The clocks

| Cadence | Event |
|---|---|
| Every 5 min | Daily lifecycle cron (open, close/tally, publish, drain sends, callback retries). Vercel Pro required. |
| Hourly | Artist SMS drain, inside 10 AM–10:30 PM ET |
| Daily 12:00 PM | Drop closes/opens; Drupal's submission lock for the day |
| Daily 2:00 PM | Reveal stream |
| Daily 3:00 PM | Publish |
| Daily 4:00 PM | Artist notices |
| Wednesday 7–11 PM | A&R Room |
| Monthly | Series close; Service Pack release; the tournament |

### 13.3 Integrations

- **Drupal → app:** daily batch push (all-or-nothing validation, `amount` per record, scouting `{uid, email}`), single-submission push for the live show (auto-fills the host queue), support backfill.
- **App → Drupal:** results callback at publish (never at tally; averages must not reach a public page before the A&Rs who rated see them). Retried, terminal on 404 or 24 attempts.
- **Email** Resend + Mandrill; **SMS** Twilio (A2P 10DLC registered); **realtime** Ably (board pushed on ratify, so compute cost is independent of viewer count); **graphics** Satori + Vercel Blob; **ads** Revive (ads.cannick.com); **tasks** Asana post kit; **control** Stream Deck via a per-host key.
- **Vocabulary rule for the wire:** no amounts cross except the support level, which exists for one job (the reveal stream).

### 13.4 Engineering posture (for context, not for refinement)

Node/Express, Postgres (Neon) in prod, Vercel serverless, vanilla HTML/JS. All managed; the operator wants a tool, not infrastructure to babysit. Hard rules: nothing that scales with row count on the boot path (a multi-day outage came from that); migrations additive; the seal server-enforced; public surfaces emit display name and points only; mockup-first for UI; the test suite green (1,352 tests). "Shipped" means pushed to origin, not merely built.

---

## 14. Decisions of record (compliance and policy, as stated by the operator/counsel)

- Free-entry, skill-only audience competition; attorney has cleared the prize structure; A2P 10DLC registered; a typed phone number with disclosed helper text is the SMS marketing consent model (cleared 2026-06-30); SMS consent is separate from verification codes.
- Items the operator has listed for counsel: referral bonus points on the cash board and whether they count toward the Wars cut; the artist-text consent line on the submission form at volume, and the 10:30 PM ET window; the sponsored cash mechanics before the first sponsored Wars.
- Private-room points count toward the $500 today (OPEN whether they should).
- No points for round comments (decided 2026-07-26; recognition is the reward).
- Comments ship by default; the host rejects by exception (029).
- The daily digest stays default-off until a week has run on a manual list.
- Not built, deliberately: a bracket layer (2026-07-01), teams (PARKED 2026-09-10), per-host branding, Hitmail (the separate "fantasy football for music" bet, 6+ months out).

---

## 15. Open questions (after the 2026-09-15 answers)

Settled 2026-09-15 and folded into Section 8: the $500 prize, "Top A&R of the month" = the Wars champion (the printed $500 line stands), the artist prize and its exact wording (Promo Budget), the tournament name, catalog play, seat-passing on repeat wins, Wars on the pack, the Wednesday–Tuesday week, top track = highest-rated song of the week, weekly seats by points and monthly seats by accuracy with a minimum rounds voted, monthly Series and monthly Wars, tournaments 4 weeks after close, eligibility (a weekly top A&R needs a complete profile; an artist who is also an A&R can hold a seat in both), points during tournaments, tooling deferred.

Still open:

1. **Tournament night** (Sunday recommended).
2. **The minimum rounds voted** for a monthly accuracy seat (a number, or a share of the month's rounds).
3. **Top track details:** the min-vote floor, and whether the Wednesday show's records and the daily records share one weekly pool.
4. **Seeding the artist bracket** (winning song's rating vs order the seats were earned).
5. **Promo Budget mechanics on the site:** how the $1,000 is credited, expiry, and whether it can buy a Service Pack placement (which would be the first time the pack sits on the prize side of the wall).
6. **Announcement graphics:** the Wednesday weekly winners post (A&R + track), tournament key art, bracket graphics, the "seat earned" artist share graphic. None exist.
7. **The brand rule.** "Prizes go to A&Rs only" and "gold = money and first place only" need rewording to "prizes are won by vote, never bought", with gold allowed on the $1,000 Promo Budget.

---

## 16. Glossary

- **A&R** — a member of the team; a player. Never "user", "participant", "voter".
- **The A&R Team** — the membership and the app.
- **A&R Daily** — the daily drop, A&R-facing. **The A&R Meeting** — the same review, artist-facing.
- **A&R Room** — the weekly Wednesday live broadcast.
- **A&R Service Pack** — the paid monthly promotional pack.
- **Top A&R** — daily: the carousel winner; weekly: a Wars seat; of the month: the A&R Wars champion. The board qualifies, the tournament crowns.
- **A&R Wars** — the monthly A&R tournament; 4 weekly seats (points) + 4 monthly seats (accuracy, minimum rounds); picks from the Service Pack; $500 cash.
- **Makin' It $1,000 Music Review Tournament** — the artist tournament; 8 weekly top tracks; artists play their own catalog; $1,000 Promo Budget.
- **Promo Budget** — a makinitmag.com feature: earned credit spent on promo, submissions and services on the site. Not cash. Always this exact wording.
- **The week** — Wednesday through Tuesday; the weekly top A&R (points) and top track (highest rating) are announced on the Wednesday show.
- **Pick the Hits / the sidebet** — the free $150 prediction contest.
- **Session** — one instance of a show or drop.
- **Series** — the numbered monthly competition container and its board.
- **Round** — one record (rating) or one matchup (Versus).
- **Predict the Average** — the mechanic. **Bullseye** — an exact hit, 125 points.
- **Versus** — a binary Song A vs Song B poll.
- **The seal** — vote direction hidden until results.
- **The wall** — placement money and A&R points never touch; neither product earns the other.
- **Scouting** — an A&R referring an artist; points scale with how the record scores.
- **Support level** — what an artist paid to submit; admin-only; drives the reveal stream.
- **Reference track** — a known major-artist record added for calibration.
- **Top supporter** — the day's highest-paying record, singled out on the stream.
- **Completion bonus** — points for handling every record in a day.
- **Live bonus** — points for rating every record in a live session (unset).
- **HOT 100** — the Makin' It chart of records or A&Rs.
- **Song Report** — the 3-page per-record analytics graphic.
- **Mimbership** — Makin' It's professional network; members pay dues.
- **Host** — an invited creator running their own sessions on the platform.
- **Platform admin** — the operator role.

---

## 17. Source index

- `CLAUDE.md` — settled architecture, shipped features, workflow rules.
- `docs/specs/anr-room-product-brief.md` — strategy, market, the Series design.
- `docs/anr-room-cofounder-briefing.md` — the business overview, revenue lines, traction.
- `docs/anr-room-roadmap.md` — every tier and the decision record.
- `docs/daily-operator-manual.md`, `docs/daily-setup.md` — running A&R Daily.
- `docs/specs/daily-drop-integration-spec.md`, `daily-drop-drupal-prompt.md` — the Drupal contract.
- `docs/specs/sidebet-contest-spec.md` — Pick the Hits.
- `docs/specs/binary-poll-build-spec.md`, `mixed-rounds-build-spec.md` — Versus and mixed rounds.
- `docs/multi-tenant-roadmap.md` — the host program.
- `docs/promo-asset-list.md`, `public/brand/` — the promo inventory and masters.
- `docs/copy-inventory.md` — every user-facing string.
- `docs/post-show-setup.md`, `docs/google-analytics-funnels.md` — ops and analytics.
- `docs/specs/hitmail-*.md` — the parked later product.
- Skills: `anr-brand` (brand system and voice), `anr-service-pack` (monthly pack build).
- Plan: `~/.claude/plans/i-m-considering-changing-the-frolicking-teapot.md` — the 2 PM show decision.
