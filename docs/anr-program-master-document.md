# The A&R Program — Master Document

**Operator:** Makin' It Magazine (makinitmag.com) · **App:** anr.makinitmag.com
**Compiled:** 2026-09-14 · **Updated:** 2026-10-17, against `anr-room` `origin/main` (through PR #55, migrations through 047 + 049), the `mim` (makinitmag.com) repo's specs and runbooks, the operator manuals, the brand and service-pack skills, and the session memory.

> **SNAPSHOT, 2026-10-17. Superseded in part.** Decisions after this date that this document does not reflect: tournaments, prizes and the Wednesday show retired (2026-10-19/23); the $25 submission pivot and the HOT 100 umbrella (2026-10-19/20); the evening clock live (2026-10-17); Pick the Hits live with a weighted tally (2026-11-17); the A&R Team invite-only repositioning (2026-10-25); live review on close night (2026-11-22). Sections 2, 3, 4, 7, 10 to 13 and 18 remain the reference for mechanics. Sections 1, 5.1, 8, 9 and 15 are history.

**How to read this.** Every statement is tagged where it matters:
- **LIVE** — built, pushed, running in production.
- **BUILT** — built and tested but not yet on production (as of 2026-10-17: the 6 PM schedule in PR #54, the session state model in PR #43, the "$500 never monthly" sweep in PR #41).
- **DECIDED** — the operator has decided it; nothing is built.
- **PARKED** — discussed, deliberately not planned.
- **OPEN** — a question nobody has answered yet.

Section 8 is the tournament structure and calendar. Section 18 is the makinitmag.com side (intake, Promo Budget, Mimbership, services, payments, social). Section 15 is what is still open.

---

## 1. The program in one page

Makin' It runs an A&R department that does two things at once: it gives independent artists a real, visible, participating audience that rates their records, and it turns that audience into a team of competing talent scouts who play for cash.

**The thesis:** two competitions in one room. Artists compete to make the chart; the audience competes to read the room. A demonstrably real, competitive audience is what makes an artist's dollar worth spending, and the artist's dollar funds the prize that buys more audience.

**The name of the whole thing is The A&R Program** (operator, 2026-09-20). It is the umbrella, not a replacement: every property keeps its name, and "the Program" is what you say when the subject is all of it at once. The app, emails and rendered graphics have not been swept for the word.

**Two businesses, one bridge.** *Makin' It* is an open media and culture platform (no membership needed). *The Mimbership* is a paid professional network ($20 a month and up). The A&R Program is the bridge: free review and the daily game acquire artists and A&Rs; the Mimbership, services and placements monetise them. There is no free Mimbership tier; a free account is operational only.

**The properties** (A&R is the master mark; Makin' It is the endorser; each property is a descriptor off it):

| Property | What it is | Where it lives | Status |
|---|---|---|---|
| **The A&R Team** | The membership. The app. You do not sign up for an app; you join the team. | anr.makinitmag.com | LIVE |
| **A&R Daily / The A&R Meeting** | The daily async review. Records open for 24 hours; the ranked **Makin' It Daily Countdown** carousel posts two days later; results publish at noon that day. The core product. | app `/daily`; submissions at makinitmag.com/review | LIVE |
| **A&R Room** ("The A&R Room - Weekly Live Music Review") | The only livestream: Wednesday 7–11 PM ET, six platforms. Announces the week's Top 8 and the week's tournament qualifiers. | makinitmag.com/live + app live play | LIVE |
| **A&R Service Pack** | The paid promotional distribution pack (up to 100 records to 30,000+ industry contacts). Drops with each A&R Wars announcement; sold as a 60-day promo offer. | makinitmag.com/packs · delivery and tracking on makinitmag.com/push | LIVE (off-app) |
| **A&R Wars** | The A&R tournament. 8 weekly Top A&Rs, single elimination, the audience votes each matchup, **$500 Cash Prize** + a magazine feature. #1 is Sunday 2026-10-25. | `/wars` + YouTube live + app voting | Tooling LIVE (045); #1 field hand-picked, competitor packages sent |
| **Makin' It $1,000 Music Review Tournament** | The artist tournament. 8 weekly Top Tracks; artists play their own catalog head-to-head; **$1,000 Promo Budget**. #1 is Sunday 2026-11-22. Urban genres only. | `/tournament/<slug>` + live stream | Tooling LIVE (045) |
| **Top Picks** (was "the Side Bet" / "Pick the Hits") | Free side contest: predict which Service Pack songs get played at A&R Wars. $150 sponsor-funded. | app `/sidebet` (makinitmag.com/TopPicks) | LIVE (Service Pack 12, 60 songs); rename pending |
| **The Mimbership** | Makin' It's paid professional network. Members pay dues. The platform feeds it sales leads. | makinitmag.com | LIVE |

**Prizes:** $500 Cash Prize (+ a magazine feature) to the A&R Wars champion · $1,000 Promo Budget to the Music Review Tournament champion (site credit, not cash; "Received, never won" is the copy rule) · $150 sponsor-funded for Top Picks. **The $500 is never "monthly" and never carries a date** (operator, 2026-10-03). "Top A&R" is the Wars champion; the weekly board only decides who competes.

**Cadence:** a drop every day · the Countdown carousel every day · the A&R Room every Wednesday · the HOT 100 every month · a Service Pack with every A&R Wars announcement · **a tournament every 4 weeks on a Sunday**, alternating A&R Wars and the Music Review Tournament.

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

**The honest limit:** the moat is the room and the operating quality, not the code. Anyone can build a poll. Defensibility comes from the community, the real pathways (bookings, playlist placements, the tournaments), and feedback quality.

This market theory is internal reasoning, not the artist-facing pitch. Artists care that real people will hear their song and that there is a real path forward.

### 2.3 The flywheel, with the numbers behind it

The audience competes free for cash by reading the room well → a competitive engaged audience makes the room demonstrably real → a demonstrably real room is what an artist pays for → artist revenue funds the prize and the operation → the prize and the promo pull more audience.

What the submission lane actually earns (makinitmag.com, Live, pulled 2026-10-15, last 30 days): 94 paid submissions, $1,640, $17.40 average; 240 free submissions; 5% of account-holding entrants later bought a Mimbership. September: 98 paid / $1,805 / 293 free; October 1–15 ran at half that pace. Half of paid entries sat at the $10 floor because it was the pre-selected amount (the default has since moved to $50). The campaign brief's rule: a paid entry has to cost under about $17 in ad spend on its own, or about $25 counting the Mimbership follow-on; judge ads on 7-day click, never view-through.

### 2.4 The integrity wall (load-bearing, not compliance polish)

- **Paid placement buys exposure, never a score and never a win.** The Service Pack is promotional distribution. A paid daily submission buys a place in the Express line, never a rating.
- **The audience competition is free to enter and ranked purely on skill.** No payment qualifies anyone; no spend affects rank.
- **Artist money and A&R points never touch.** A leaderboard that could be bought is worth nothing to anyone.
- **Prizes are won by vote, never bought.** An artist's prize is the Music Review Tournament's $1,000 Promo Budget, won by audience vote and spent on the site. Gold prints on the $500, the $1,000, the $150 and rank 1, nowhere else.
- **Scores are private to the artist.** No public graphic prints a room average: the Countdown, the HOT 100 and the winner posts are rank only (the HOT 100 has an admin "Show scores" switch, off by default). The score lives in the artist's Track Report.
- **The seal.** During any round, the room's average or A/B split is never shown. Vote count yes, vote direction never. Round comments are readable only by their author and the host. Top Picks counts are sealed until settle. A tournament poll's split is null on the public page until ratified. Server-enforced everywhere.
- **The upsell wall is being lowered deliberately** (release-day emails, DECIDED 2026-10-15/17, Section 5.4): the artist's noon email will carry Mimbership and promo offers for records scoring 3+, and free submissions will get a "Get your Track Report" upsell. This reverses the 2026-07-15 no-upsell rule and its test; confirm before building.

### 2.5 The prize framing

The cash prize is a deliberate audience-acquisition cost, funded by the placement business; whether it is fixed or scales with submissions has never been decided (OPEN).

---

## 3. The core mechanic and the scoring system

One atomic move, used on every record, live or daily:

1. **Rate it** 0–9 (your taste; you are never wrong).
2. **Predict the Average** the room will land on, to one decimal (the skill that is scored).
3. **Lock it in.** Both freeze.
4. **Reveal.** The room's average is computed; your prediction is scored on accuracy.

### 3.1 What each rating means (operator, verbatim, 2026-10-14)

| Rating | Meaning |
|---|---|
| 0 | Scrap it! |
| 1 | Take the best ideas... Scrap the rest. |
| 2 | There's something there but it needs significant work |
| 3 | Potential release |
| 4 | Solid release |
| 5 | Strong release |
| 6 | Potential Single |
| 7 | Single |
| 8 | Strong Single |
| 9 | It's a Hit! |

The list is the shared scale for raters and the artist's **verdict**: the Track Report and the artist's email print the meaning of the average's whole number (6.4 and 6.9 are both "Potential Single"; never rounded up) in place of "out of 9 · band" (LIVE 2026-10-15). A meaning line under the rating dial and a "What the numbers mean" list are mocked up, awaiting approval. The band edges 3 and 6 match. The 0–10 switch decided in July is now in doubt (operator: "what do we gain?").

### 3.2 Rating rounds (LIVE)

- Room average = mean of all ratings, rounded half-up to one decimal.
- `points = 100 × e^(−error × 0.5)`, rounded. **Bullseye** (exact hit): +25 → always 125, the maximum. More than 5.0 off: −10. A round can go negative; the cumulative total is floored at 0.
- Tiers on the results screen: Bullseye · Sharp read (≤0.5) · Close (≤1.5) · Off (≤5.0) · Way off.
- **Letter grade** = absolute accuracy band (`accuracy = 100 × (1 − avgError/9)`), not a percentile.

### 3.3 Versus rounds (binary polls, LIVE)

Song A vs Song B. Pick a side, predict the split, lock in. Majority wins. Scored on split accuracy. Versus rounds never chart and take no comments. Every tournament matchup is an ordinary Versus round tagged to its bracket match.

### 3.4 Bonuses on the same board

| Bonus | Amount | Trigger | Status |
|---|---|---|---|
| **Completion bonus** (daily) | 100 / 75 / 50 / 25 | Handling every record in the day; steps are hours from the open, a panel setting (6/12/18 today; 6/16/21 with the 6 PM schedule). Days under 3 records pay nothing; a flagged record counts as handled. | LIVE |
| **Scouting points** | `round(5 × room average)` | The A&R referred the artist (the submit link carries their uid; Drupal echoes it back). 7.1 → 36. | LIVE |
| **Referral points** | 1 per accurate round, cap 240 per invitee | Each round the invitee lands within 1.5 of the average, during their first 30 days. Self-referrals excluded. | LIVE |
| **Live show bonus** | `sessions.live_bonus`, intended ~300 | Rating every record in a live session or tournament. | Built; value never set; operator will re-evaluate in the subtraction pass |

**The weekly report and the tournament seats count only what the week's listening paid** (vote points + that week's completion bonuses). Referral and scouting points never win a seat. **One board, not two:** ear for music (accuracy) and eye for talent (scouting) feed one Series total.

### 3.5 The Series (LIVE)

A Series is a container; membership is an explicit tag on each session. The board is live-computed, never stored. Series are numbered. **BETA** = every session closed before Monday 2026-09-28 (75 sessions). **Series 2** (active; renamed from "Series 3" on 2026-10-11) starts with the drop that opened 2026-09-27; only two Series exist. The qualifier cut is superseded by the weekly seats; "Seed by Series points" remains a tournament-console option.

### 3.6 Eligibility (LIVE)

A **complete profile** (display name + a category + a primary category + location) is required to appear on any board, to win a week and to qualify for a prize. A closed or deactivated account leaves every board. An artist who is also an A&R may hold a seat in both tournaments.

---

## 4. The A&R Team (the membership, the app)

**What it is.** The durable identity every A&R holds. Email is the key; a six-digit emailed code verifies; phone is optional. Top Picks entrants become accounts too. Every entry link lands on the open drop.

**Join copy (operator, verbatim):** "Help pick the artists we book for shows, interviews, and playlist placements."

**The account page (`/account`, LIVE).** Earn points (default, scouting first: the submit link, the $1,000 strip, then Recruit A&Rs), My results (one week at a time, points only, no rank by decision; a missed day is listed and closed), My profile, Edit profile. Four generated graphics with QR codes: Official A&R Card (feed and story), the Join flyer, the Submit flyer. The scout link is now `anr.makinitmag.com/r/<uid>` and the page shows "N people opened your link this week · M all time" (LIVE 2026-10-17; clicks are diagnosis only and award nothing). The homepage names the top three talent scouts.

**The grade card (047, LIVE 2026-10-15).** "Do you have a better ear than <name>?" with the grade, accuracy and the Bullseye / Sharp / Close counts (Off and Way off never print), "$500 cash" in gold, makinitmag.com/ANR. Two looks (big photo, or stats-led) chosen by the A&R; a large crop is kept for it. A **standing card** shows the same all-time, no rank. Doors: the daily email image, the account page, the admin's Edit profile. All 404 until the day publishes.

**Notifications (LIVE; rules re-set 2026-10-15):**

| Message | Who, by default |
|---|---|
| "Voting is open" (`daily_open`) | Retired except a new account's first 7 days until they play |
| The daily results email + grade card ("Your A&R grade for <day>: <grade>") | Everyone who rated the published drop; or who rated none of it but rated the one before ("you missed yesterday's drop, but you have time to rate the new ones now"). Missed two in a row = no daily mail |
| The weekly update (names and ranks, no scores; Wednesday ≥1 PM) | Everyone outside the daily reach; sunsets after 4 unopened |
| `room_live` (email + SMS) | A live session is starting |
| Tournament reminder | The landing page's list |

Every mail carries one-click unsubscribe and a "Subscribe on YouTube and hit the bell" line (makinitmag.com/live). Bounced addresses are stamped and skipped. Transactional texts are plain GSM-7 inside one segment; longer or emoji texts go as MMS automatically.

**Contact sync (LIVE, 044).** Every account with an email is upserted daily to Brevo list **111** with name, phone, the Official A&R Card as a public image URL, and the two referral links. Closed accounts are removed from Brevo.

**Account closure (LIVE 2026-10-13).** "Delete" = anonymize: the person is removed (name, email tombstoned, phone, photo, handles, prefs); the history stays (votes, points, comments as "A&R · role · city", role, city) so published reports do not shift. Deactivate is reversible by logging in. Both leave every board. Admins can open and edit any A&R's profile and pull their latest grade card.

**The vocabulary.** Players are **A&Rs**. One instance is a **Session**. Console sections (operator, 2026-10-13): **Daily Drops · Live Sessions · Tournaments · Top Picks** (the nav reorg mockup is pending approval).

---

## 5. A&R Daily / The A&R Meeting (the daily review)

**What it is.** The async listening session artists submit to. This is the product; the live show is a weekly event on top of it. **The A&R Meeting** is the artist-facing name; **A&R Daily** the A&R-facing name; the public results post is the **Makin' It Daily Countdown**.

### 5.1 The clock

**As built (LIVE 2026-10-01, the 69-hour schedule):** the day opens at 3 PM ET, closes 3 PM the next day, the Countdown graphics render at 3 PM the day after that, and results publish at noon on the third day. Three drops are in flight at once.

**The 6 PM schedule (BUILT 2026-10-16, migration 048, open in PR #54):** research on 40 drops showed raters follow the open email (46% start within three hours), with a second natural window 7–11 PM ET, and that Wednesday opens draw the most raters. The operator chose to test a **6 PM ET open** for two weeks: open 6 PM, close 6 PM next day, Countdown graphics 10 AM two days after the open, results noon three days after the open; bonus steps 6/16/21 hours. After deploy the schedule must be saved once on the panel and the Drupal lock moved to 5 PM ET.

Every time is a platform-panel setting. The seal holds until results. The hours between close and results are the window to reject an A&R comment; after results there is no unsend.

**Naming a set (operator, 2026-10-14):** a daily set is named for its **release date**, the day its Countdown posts ("Daily Drop - Oct 16, 2026" / "October 16th Results"). The drop opens two days before release. The code still dates posts by the close day; switching it is pending (PR #41 carries the rule). Everything before 2026-09-28 is the BETA series.

### 5.2 The records

- **4–16 per day, never a fixed count**: up to 4 from the free pool + at least 4 from the Express line. Hard ceiling 24. Selection, pricing, the pool and its aging live entirely on makinitmag.com (Section 18.2).
- **The artist's note** is context, not a question ("Hey, this isn't mixed."). 500 characters.
- **Support level**: what the artist paid, per record, admin-only; names the day's top supporter; never shown to A&Rs or artists.
- **Reference tracks**: a known major-artist record, hand-added for calibration; scored, excluded from every public surface.
- **Report a record** (dead link) counts as handled; capped at 3 a day. A dead link can be fixed mid-window; a record cannot be added or removed once open.
- The page carries the sponsor banner at the top.

### 5.3 What the A&R does

Listen on the play link → Rate it → Predict the Average → Lock it in → optionally one note (≤500 characters) → Follow and Artist profile buttons → next record. Finish the day for the completion bonus. Results and the grade card come at noon on release day.

### 5.4 What the artist gets

- **Today (LIVE):** a heads-up email and text at the close ("rated · Track Report by email on <day> · Top 8 of the week on The A&R Room live, Wed 7PM ET"); their slide on the Countdown (rank only); the **Track Report** at noon on release day; their status confirmed on their makinitmag page via the results callback, now with a per-record results link; a "Scheduled for review" share graphic at submission; the qualifying email at submission (follow @makinit4indies + @makinitmag, post the flyer, complete your profile).
- **The Track Report (LIVE; spend tiers and verdict 2026-10-15):** opens with **what to spend** off the room average (under 3 don't invest · 3–4 up to $300 over the first 3 months · 4–5 at least $300 · 5–6 worth putting some money behind, not over $1,000 in 3 months without a response · 6–7 invest at least $1,500 · 7–8 work out what you can afford and how long to push it as a single · 8+ the same, with an investor or consultant), the **verdict** (the rating meaning of the average's whole number), the histogram's shape, the record against everything the Meeting has rated, who it is for, **expected vs delivered** (the prediction gap), what now, the A&Rs' comments attributed by name · role · city, and a share page with no score. Dollar amounts are advice on the artist's own release; nothing sells ours (tested).
- **Release-day emails (DECIDED 2026-10-14/17, spec written, not built):** the Countdown posts at 10 AM on release day; every automated email goes at noon. The artist's noon email: score + number of A&Rs + verdict, the report link, the Countdown post link with one ask at the top (share the countdown post to your Story; the text carries it best), submit another, and for 3+ the Mimbership line verbatim ("Get a team behind your music. Marketing, Promo, Booking, and PR.") and promo offers. **Track Reports for paid submissions only**; free submissions get a "Get your Track Report" upsell (price still needed). The #1 artist: a #1 block at noon and a dedicated email the next day: "Purchase 60 Day promo campaign within 72 hours and get $50 off with promo code ANR723". The #1 A&R: 50% off a one-year Mimbership, 72 hours; every Top A&R gets a code for a free one-month Mimbership ($20, new Mimbers). Ties: #1 artist → Mimber wins (the app has no Mimber data; Drupal must send it), then submission order; #1 A&R → whoever completed the drop first. The heads-up at close is retired in this plan.

### 5.5 The daily livestream is retired (2026-10-02; every communication swept 2026-10-15)

The only livestream is The A&R Room on Wednesday. Every mail, text and page that once said "tune in" now points at the Wednesday show or Instagram. The 2PM-plan leftovers were settled 2026-10-11: live "play my song" became the CashApp-and-email flow on Wednesday; the urgency layer lives on the makinitmag.com submit page only; the paid-submissions-per-day revenue readout is to be built.

### 5.6 Graphics the day produces (LIVE)

- **Makin' It Daily Countdown** carousel (1080×1350): cover · one slide per record from #N up to #1 · the A&R Team slide · the artists slide. Rank only; a slide never shows the field size; the caption names nobody (artists are tagged on their slides and mentioned four to a comment). **DECIDED 2026-10-11: reformat to fit Instagram's 10-slide cap and post through the paid SocialBee pipeline** (under 8 records a slide per track; 8+ = cover + list slides for the lower ranks + #3, #2, #1 + closing). Not built.
- **Top A&Rs** carousel: the top 8 by placement, no points; a collab with the #1 A&R; closing slide "Qualify to win $500 Cash!" / "Rate records and Predict the hits".
- One Asana task per post is made automatically by the cron once the slides render.
- **"HOT 100" is the monthly post only** (Section 12).

### 5.7 Console (LIVE)

Opens on A&R Daily. Day picker, state pill, the records table (score, support, flags, play link, Instagram and note, a "Now playing" comment button, four sorts), send counters, the graphics card with Asana task state, the Submission system card (callback delivery + backlog resend), the next-drop builder, "Run the lifecycle now", "Publish the day". The **session state model** (Upcoming → Live → Closed → Published, + Archived; derived, never stored) is BUILT in PR #43 so in-flight drops stop reading as Live. Manual: `docs/daily-operator-manual.md`.

---

## 6. A&R Room (the weekly live broadcast)

**What it is.** "The A&R Room - Weekly Live Music Review": Wednesday 7–11 PM ET, host and co-host give live on-air feedback, multistreamed to six platforms. The only livestream. Two jobs now: review records live, and **announce the preceding Monday–Sunday week's Top 8 and its two tournament qualifiers** (Top Track → the $1,000 tournament; Top A&R → A&R Wars).

**The show loop (LIVE):**
1. Submissions: paid review slots (standard / priority / VIP, ~10 each) plus the free lottery; pushed from makinitmag.com straight into the host queue. **Live "play my song now" (operator, 2026-10-11):** anyone who wants a record played live sends **$20–50 by CashApp and emails the song**. No account, no form. Banner rotation in the A&R Room is a sold service.
2. Each record is staged: `listening` → voting → clock → ratify. One **Advance** button, on screen and on a Stream Deck. Host buzzer at five seconds.
3. Viewers rate and predict on their phone (same step wording as the daily); the tap-to-start YouTube embed lets watch + vote live on one device.
4. Points accrue to the active Series.
5. **The weekly announcement** off the **weekly report** screen: Top 8 Records (now linked to each submission and artist profile on makinitmag.com) and Top 8 A&Rs, 16 weeks in the picker, live shows counted. A week still settling is marked; no seat is handed out off it.
6. Post-show: Score Cards, Top 8 cards, recap emails, Track Reports, the Asana post kit, and the **Top Track / Top A&R of the Week** collab posts.

**Takeovers (sold service, 1 or 2 hours):** a guest hosts the Wednesday show. The `anr-takeover` skill runs it end to end (guest name, handle, photos, date → feed, story, 16:9, YouTube and stream-header graphics from the brand template → captions → SocialBee with the guest and @theanrteam as collaborators). Template LIVE 2026-10-15. **Takeover mode + blind results (DECIDED 2026-10-15, spec written):** one artist set once on the session; an optional one-reveal-at-the-end mode because revealed averages were anchoring later votes; the series board must exclude a blind session until published.

**Versus Challenge** (sold service, best of 5 / 9 / 15) runs on the same Versus polls.

**Capacity:** roughly 40 records in a four-hour show is a hard ceiling. **Stream overlay:** now-playing, countdown, vote-count card, lower thirds, starting-soon, horizontal and vertical; seal rule applies; an overlay bracket for tournament night is a follow-on. **The host program** (invite-only creators, A&R-branded, no PII, no billing) is LIVE.

---

## 7. A&R Service Pack (the paid promotional product)

**What it is.** A campaign distributing new records to over 30,000 industry contacts (DJs, tastemakers, promoters). Artists buy a placement. Not the review queue; nothing in it is earned by rating.

**Pack ad (operator, verbatim):** "Break Your Record" / "The A&R Service Pack is a monthly campaign distributing new records to over 30,000 industry contacts. Placements start at $49 (for a limited time)." The $49 is set in mono, never gold.

**Tiers:** Featured (pinned 1–10, full directory page, artwork) · Priority · Standard. Placement form levels $51 / $101 / $151 (list $99 / $199 / $349; intro pricing at 50% for everyone today, which the Mimber-discount standard proposes ending as a marketing event). Up to 100 songs. Ships as a download (tracked `/pack/N` links), USB drives and a Spotify playlist; **each placed artist also gets a placement video** delivered by makinitmag.com/push with a caption to post and a text with a second door to the download (70 videos, 150 pack downloads to date). The **Tastemaker Tier 1 mailing list is the pack's target list**; growing it is how Makin' It fulfils its obligation to placement buyers.

**Cadence (DECIDED 2026-10-11):** a pack drops with each A&R Wars announcement, so its campaign runs the 8 weeks to the tournament and placement is sold as a **60-day promo offer**. That pack is the pool Wars competitors pick from and the song list Top Picks is played against. The artist tournament plays catalog, never the pack.

**Build:** the `anr-service-pack` skill, from the Drupal webform CSV: tagged MP3s, M3U, the artist directory PDF, the Spotify tracklist. **Artist share graphic** at pack release: "Win $150 Cash" / "Check out the latest A&R Service Pack featuring "SONG" by ARTIST" / "And Submit your top picks to win" / "Free to Enter at makinitmag.com/TopPicks".

---

## 8. The tournaments

Two tournaments on one model. Mechanic for both: single elimination, 8 → 4 → 2 → 1 (seeds 1v8 · 4v5 · 3v6 · 2v7), every matchup a Versus poll in a live session, the audience votes, majority advances, the final is best of three polls. Competitors are not session participants.

### 8.1 The master calendar (operator, 2026-10-03)

- **The review week is Monday–Sunday.** The week's **Top A&R** (most points from the week's listening) and **Top Track** (highest room average) are announced as qualifiers on the **following Wednesday's** show.
- **Each tournament = 8 consecutive weekly qualifiers.** Field complete on the 8th Wednesday; ~4 weeks of promo; the tournament on a **Sunday** (last qualifying Sunday + 28 days).
- **Each brand runs every 8 weeks, alternating → a tournament every 4 weeks.**
- **Anchors:** A&R Wars #1 **Sunday 2026-10-25** (weeks Aug 3–Sep 27). Music Review Tournament #1 **Sunday 2026-11-22** (weeks Aug 31–Oct 25). Derived: Wars #2 → 2026-12-20; Artist #2 → 2027-01-17; Wars #3 → 2027-02-14.
- **Wars #1 is hand-picked** from the BETA period; weekly A&R seats start with the week of Sep 28 = Wars #2 seat 1. Top Tracks from Aug 3–30 qualify for nothing (OPEN).
- Holidays are flagged, never moved (Feb 14 2027, May 9 2027, Jul 4 2027).
- A repeat winner keeps one seat; the console offers the week's #2.
- Calendar page: https://claude.ai/artifact/E8wfxbHC2uvXf27NNCPR5X.

### 8.2 A&R Wars (kind `ar`)

- **Field:** 8 weekly Top A&Rs (complete profile required). **Seeding: hand-picked, with auto-seed by Series points today and by rating or seat order as the build** (operator, 2026-10-11).
- **Plays:** songs picked from the Service Pack linked to the tournament. The briefing (operator's words, verbatim in the package email): on camera; download the Service Pack and pick 18; 3 rounds = 90 seconds / a full song / 3 full songs; 5 songs, no repeats; ties by current-Series points; $500 + a magazine feature.
- **Prize: $500 Cash Prize** + a magazine feature. The title "Top A&R" is won here.
- **Premise line:** "8 A&Rs play the songs they scouted. You vote on every matchup. The winner takes $500." Lockup [A&R] WARS, purple. Spelling A&R Wars, never Warz.
- **The final package (LIVE 2026-10-15):** once 8 seats are filled, each competitor gets their own feed + story ("<Name> plays for $500.", all 8 seats, purple ring on theirs, "RSVP to watch live · anr.makinitmag.com/wars" and "Join the A&R Team · makinitmag.com/ANR"), emailed with the briefing, their personal join and artist referral links, a Bonus Points block, the caption and the PNGs attached; a heads-up text follows; the email asks for their makinitmag.com username so a Win can be added to their account. "Send test to me" mails the admin their own copy.
- **Top Picks** runs against this pack and settles off the 18 songs the 9 matchups play.

### 8.3 Makin' It $1,000 Music Review Tournament (kind `artist`)

- **Purpose:** artist participation beyond the review, and a stronger hook for graphics and messaging.
- **Field:** 8 weekly Top Tracks → their artists (the operator uploads a photo). **Urban genres only** (Hip Hop, Pop, R&B, Afrobeats; the review takes all genres, the tournament does not; set 2026-09-23).
- **Plays:** any record from the artist's own catalog, typed in per matchup.
- **Prize: $1,000 Promo Budget.** Exact wording. Site credit spent at the artist's discretion on **anything in Services and any submission for opportunities**, the Service Pack included (operator, 2026-10-11). Not cash. Copy rule on makinitmag.com: Promo Budget is "received", never "won"; "Qualify for $1,000 Promo Budget" is the approved frame. Crediting the champion is a follow-on on the Makin' It side.
- **Seeding:** hand-picked, with auto-seed by rating or seat order as the option.

### 8.4 Tooling (LIVE 2026-10-07, migration 045; spec `docs/specs/tournament-spec.md`)

One model, two kinds: competitors (rows copied from a profile, editable), 7 matches, a linked live Versus session tagged into the Series, an optional pack, a reminder list, graphics and captions. Status draft → promo → live → complete. **Running the night:** Queue matchup → Advance ×3 → ratify decides the match (a tie or zero-vote poll goes to the host's Decide button) → the winner fills the next slot and pushes to the console and the landing page; the final's winner feeds the homepage's winners list. **Landing page:** `/wars` and `/tournament/<slug>`: date, prize, the 8 competitors, **Get a reminder** (email only, no account; stays in the app, never Brevo), Join the A&R Team, the Top Picks link, Watch live, the bracket, the champion. **Graphics are a weekly qualifier series:** one big slot + 8 small seats (silhouettes for the unfilled), the final promo with a question mark and "Who has the Best Ear?", the champion graphic, the event-night bracket; feed, story, thumbnail; one Asana task per row; a zip of every ready graphic. Console: setup · field (the last 8 weeks' #1s offered, repeats flagged) · live bracket · graphics · reminder list · wrap.

### 8.5 The weekly winner posts (LIVE)

After each Wednesday: **Top Track of the Week** and **Top A&R of the Week**, posted as Instagram collab posts on the winner's own feed. Congratulations · the NAME · "$1,000 Music Tournament" or "A&R Wars Tournament · $500 Cash Prize!" · the @handle. No song title, score, rank or date on the card.

### 8.6 Follow-ons

Overlay bracket · Promo Budget crediting on makinitmag.com · auto-seed by rating / seat order · the Top Picks rename.

---

## 9. Top Picks (the Side Bet, LIVE)

A free-entry prediction contest at `/sidebet` (makinitmag.com/TopPicks). Pick which 18 songs from the Service Pack will be **played** at A&R Wars and order them. Most correct wins $150 (sponsor-funded). Running on Service Pack 12 (60 songs).

- Set membership, not ratings; no points. 18 = the bracket (9 polls × 2), stored per pack; the tournament console asks for the final's third poll even once decided, because Top Picks needs all 18 played.
- Pick counts are sealed until settle. Entries editable until the cut-off. An entrant becomes an A&R Team account and lands on a Brevo "Side Bet #N" list.
- **Rules (APPROVED 2026-10-11, page to build):** "The person with the most right selections wins. If two people get the same number right, we compare the order they put their songs in. Closest order wins. If that is also a tie, the earlier final entry wins." **Payout within 3–5 business days after the winner provides payment details.**
- **Rename (operator, 2026-10-13):** "Top Picks" everywhere a person reads it (it had three names: Side Bet, Pick the Hits, /sidebet). Public copy, the URL (with a redirect) and the Brevo list naming once the operator confirms scope; DB and route names stay.

---

## 10. Artists: the full journey and the offers

| Stage | Artist experience | Offer / revenue |
|---|---|---|
| Discover | Meta ads ("Qualify for $1,000 Promo Budget", "Serious about your music?"), the Countdown's closing slide, the winner posts, "Text REVIEW to 678.336.5204", scouting A&Rs' flyers | — |
| Submit | makinitmag.com/review → "Send Music to A&R Team for FREE Review": free lane (Trusted account, one song at a time, lottery) or the **Express line** ($10–$100, default $50, guest checkout, multiple songs); note on how to hear it; `?ref=` credits the scout | Paid submission |
| Receipt | The qualifying email: follow both accounts, post the "Scheduled for review" flyer, complete the profile | — |
| Reviewed | Rated by the A&R Team in the daily drop, or live on Wednesday | — |
| Announced | Their slide on the Daily Countdown; status page "in today's meeting" → "Reviewed … rated by N A&Rs" | — |
| Results | Track Report with the verdict, the spend tier and attributed comments; the per-record results link | Upsells DECIDED (5.4) |
| Chart | The Makin' It HOT 100 monthly carousel (rank only) + the Brevo email and SMS "Did your song make the list?" | — |
| Week winner | Top Track of the Week: collab post, a tournament seat, the #1 offers (DECIDED) | $50 off the 60-day promo campaign |
| Tournament | 8 artists play their catalog live; the champion receives the $1,000 Promo Budget | — |
| Promote | Service Pack placement (60-day offer; delivery video via /push), the 60-day promo campaign, banner rotation, Takeover or Versus Challenge bookings, playlist features, magazine ads | Services |
| Belong | The Mimbership (Section 18.4) | Dues |
| Pay over time | Makin' It Pay (Section 18.6) for $250+ purchases | — |

**The platform as a lead source (LIVE).** The top 30% of rated records (floor 3 ratings), one Asana task per artist, go to the **A&R Sales Leads** project with Date played and Average score. Every played artist is on Brevo list **119** with `ARTIST_TOP_SCORE` for segmenting. The October campaign brief adds: ask "How much did you invest in your music over the last 12 months?" on the submit form and route it to Brevo, because prior spend predicts a Mimbership 8–12×; the target lead is an urban artist spending $3,000+ a year.

**Artists are not app users.** No app account, no preferences, no manage link. On makinitmag.com they are Users, Trusted accounts or Mimbers.

---

## 11. Revenue lines and pricing (as recorded)

| Line | What | Price on record |
|---|---|---|
| Daily review submission (Express line) | Pay-what-you-want seat in the daily drop, sorted by amount; climbs with waiting | $10–$100 in $5 steps; default $50; "front of the line" from $25; $17.40 average (Oct 2026) |
| Weekly review slots | Standard / priority / VIP live review | per slot |
| Live "play my song now" | On the Wednesday show, CashApp + email | $20–50 |
| Service Pack placement | Distribution to 30,000+ contacts + placement video | $51 / $101 / $151 (list $99 / $199 / $349); 60-day offer |
| 60-day promo campaign | The artist promo product referenced in the #1 offer and the pack campaign | $50 off for the week's #1 (code ANR723) |
| A&R Room Takeover | Guest-hosts the Wednesday show, 1 or 2 hours | list price; 50% intro today; Makin' It Pay eligible |
| Versus Challenge | Best of 5 / 9 / 15 | list price; 50% intro today; Makin' It Pay eligible |
| Banner rotation in the A&R Room | Ads on the show | 50% intro today |
| Consultation | 15-minute $200 option and longer | per booking; Makin' It Pay eligible |
| Magazine ad (Issue 34) | Print | per placement; Makin' It Pay eligible |
| Playlist features | Makin' It Approved, Adult Bopz, Serato Flamerz | Mimber-gated, rotation |
| Mimbership dues | Core $20/mo or $200/yr · Silver $100/mo or $1,000/yr · Gold $250/mo or $2,500/yr · Platinum $15,000/yr (invite) | Mimbers pay for submissions at 5× the rate of non-Mimbers |
| In-app advertising | Revive zones; overlay slot "Advertise here · $100 for 8 weeks"; Top Picks sponsor banner | $100 / 8 weeks (overlay) |
| Sponsorship | "Presented by" on the tournaments; Top Picks' $150 | sponsor-funded |
| Track Report | Free today; DECIDED to become paid-submissions-only with an upsell for free entries (price needed) | OPEN |

**Infrastructure is not a line:** managed services under $200/month (app) plus Pantheon for the site.

---

## 12. Marketing, content and brand

### 12.1 The content engine

- **Daily:** the Daily Countdown carousel and the Top A&Rs carousel (Asana task each, automatic; posting via SocialBee is the decided next step), the artist emails with the share ask.
- **Weekly:** the Wednesday show post and thumbnails, the weekly report read on air, the Top Track / Top A&R of the Week collab posts, the tournament qualifier flyer, the weekly update email, the Takeover template when there is a guest.
- **Monthly:** the Service Pack (covers, directory PDF, per-artist pack graphic, placement videos via /push), the **Makin' It HOT 100** carousel (rebuilt to the brand, rank only, "Show scores" switch; tested and in use) followed by the **HOT 100 announcement process** (a Brevo email and a one-segment SMS to the Artists list; first run 2026-10-14: email to 619, SMS to 546; doc in `docs/process/`), the Hot 100 newsletter (2nd Wednesday, planned).
- **Every 4 weeks:** a tournament: qualifier flyers, the final promo, each competitor's package, the thumbnail, the bracket, the champion, the landing page and reminder list.
- **Evergreen ads:** Join the A&R Team · Submit your music · Watch the broadcast · Break Your Record. **Meta campaign (October 2026 brief):** Advantage+ sales campaign on makinitmag.com/review; run concepts A ("Qualify for $1,000 Promo Budget"), E ("Serious about your music?") and an edited B; "Rappers, Singers, Producers & Songwriters", never "Artists" (Advantage+ drifted to rock and country); add a photo creative with Black rappers and singers; $30–40/day; read-outs at day 3, 7, 14, 30.
- **Member-generated:** every A&R's Official A&R Card, Join and Submit flyers, and the grade card ("Do you have a better ear than <name>?").
- **Makin' It social pipes already running (Zapier → SocialBee):** new Mimber cards, win testimonial videos (the social pack), Service Pack placement videos. The site's social-post inventory lists 15 more post families with their volume and what each still needs.
- The promo inventory (66 assets) is `docs/promo-asset-list.md`.

### 12.2 Links and keywords

| Property | Printed link | On Instagram |
|---|---|---|
| Join the A&R Team | makinitmag.com/ANR | "Comment #ANR to join the A&R Team" |
| Submit music | makinitmag.com/review (lands on /opportunities/anr-meeting) | "Comment #REVIEW to Submit Music"; "Text REVIEW to 678.336.5204" |
| Watch / subscribe | makinitmag.com/live (→ the YouTube live page with the subscribe prompt) | |
| Service Pack | makinitmag.com/packs; delivery makinitmag.com/push | |
| Top Picks | makinitmag.com/TopPicks | |
| A&R Wars | anr.makinitmag.com/wars | |
| A scout's link | anr.makinitmag.com/r/<uid> | |

### 12.3 Caption rules (operator; global rule 2026-10-06)

Captions are SEO copy: plain words the audience searches, keyword in the first line. Hashtags sparingly and only to name a campaign; never a pile. Never mention a crowd (past 10 mentions Instagram stops notifying); tag people on their slide and mention four to a comment. Comment keywords instead of links. Threads takes one topic tag ("Independent Artists"). On makinitmag.com's own captions: Mimber never "member", what the reader gets, never the mechanics.

### 12.4 The brand system (the `anr-brand` skill)

One master mark, A&R, in a 13° block; lockups [A&R] TEAM / MEETING / ROOM / SERVICE PACK / WARS; no article in a mark. Colour has a job: signal green = live, scoring, the Team and the Room; contest purple = head-to-head, the tournaments, the Service Pack; prize gold = money and first place only; red rare. Archivo display, Space Mono for every number. Rank only on public graphics. Seal, PII and wall rules on every graphic. Makin' It's own site uses its purple `#403694` and Montserrat; the A&R line does not borrow them.

### 12.5 Copy voice

**App (operator, 2026-08-30):** plain and direct; no slang, no borrowed cultural voice; the operator's wording verbatim; the literal noun. **Site (operator, 2026-08-25):** write for a 6th-grade reading level; the audience is rappers; do not try to be street; **STATE IT** (every instruction a verb and a complete thought); American English; "Mimber" never "member"; an Update's link is "the main link". The $500 never carries "monthly" or a date. A fresh CSV of every user-facing app string is the next copy deliverable (Section 15).

### 12.6 Growth loops

- **Scouting** (the primary secondary game): every A&R's submit link; Drupal attributes the submission (`?ref=` → 90-day cookie → the account's referrer when that referrer is an A&R); the app pays 5× the record's average. Opens of the link are now counted for diagnosis.
- **Recruiting:** the join link pays a point per accurate round in the invitee's first 30 days.
- **Artists promote the program:** the qualifying email's flyer ask, the Countdown slide and the noon share ask, the winner collab posts, the pack post and placement video, the win testimonial videos.
- **Top Picks** and the **tournament reminder lists** seed contacts; the Wars competitors carry personal referral links in their packages.
- **Makin' It's own loops:** referral awards paid in Promo Budget, Tastemakers becoming ambassadors on commission (`mim_referrals`), new-Mimber cards posted automatically.
- **Analytics:** GA4 and the admin Analytics screen (a paid-submissions-per-day readout is to be added); the site's Meta Conversions API; the weekly timing research (raters follow the open email; audience ~70% Eastern, ~20% Central; Wednesday opens strongest).

---

## 13. Operations

### 13.1 Roles

| Role | Does | Sees |
|---|---|---|
| Operator (platform admin) | Series, packs, tournaments, platform panel, charts, announcements, the daily console, Brevo and Asana syncs | Everything |
| Staff being added (operator, 2026-10-11) | Keep the program on schedule now that the calendar and workflow are fixed | As assigned |
| Host (invited creator) / Takeover guest | Their own live session, overlay, email go-live | Names, points, counts, socials; never email/phone |
| A&R | Plays, comments, scouts, recruits | Their account page and public boards |
| makinitmag.com (Drupal) | Intake, payment, the two queues, the daily lock and push, scouting attribution, status pages, results intake, Promo Budget, Mimbership, services, Makin' It Pay, the social pipes, the Submit Music page's urgency layer | Its own submitters |

### 13.2 The clocks (as built; the 6 PM test shifts the daily ones)

| Cadence | Event |
|---|---|
| Every 5 min | App lifecycle cron (open, close/tally, graphics + Asana tasks, publish, sends, callback retries, tournament reminders, the daily Brevo sync) |
| Daily, before the open | makinitmag.com locks the day's track list (today 2 PM; 5 PM once the 6 PM open is live) and pushes the set |
| Daily 3 PM (6 PM in the test) | A drop opens; yesterday's closes and tallies; artist heads-ups go |
| Daily (release day) | Countdown graphics render (10 AM with the 6 PM schedule); results and all automated emails at noon |
| Wednesday ≥1 PM | Weekly update email; the weekly report is ready |
| Wednesday 7–11 PM | A&R Room; Top 8 and the two qualifiers announced; winner posts after |
| Every 4 weeks, Sunday | A tournament (Wars 10-25, Artist 11-22, Wars 12-20, …) |
| Monthly | HOT 100 post + the Brevo email/SMS; the Hot 100 newsletter (planned) |
| Site newsletters | Opportunities Weekly (Tuesday, live), Industry Events (Thursday, drafted), Community Monthly (1st Wednesday, planned) |

### 13.3 Integrations

- **makinitmag.com → app:** the daily batch push (all-or-nothing; `amount`, `scout.uid`; retried until the open), the single-submission push for the live show, support backfill.
- **App → makinitmag.com:** the results callback at publish (per record `rated | not_playable | unrated`, the average, a results link); the console shows delivery and re-sends the backlog.
- **Brevo:** artists 119, A&Rs 111, Side Bet #N, the "Let's Work" leads list; the monthly HOT 100 sends; the US SMS sender is a phone number.
- **Asana:** the live post kit, the automatic daily tasks, the tournament graphics tasks, the Sales Leads project.
- **SocialBee** (via Zapier on the site; direct hand-off decided for the app's carousels): Mimber cards, win videos, pack videos, Takeover posts.
- **Stripe** (site): submissions, services, Mimbership, Makin' It Pay; webhooks carry charge refund/dispute events. **Email** Resend + Mandrill (app), Mandrill + Mailchimp RSS-to-email (site); **SMS/MMS** Twilio and the site's SMS inbox; **realtime** Ably; **graphics** Satori + Blob (app), GD + Abyssale (site); **ads** Revive; **DB** Neon direct.

### 13.4 Engineering posture (for context)

App: Node/Express, Postgres (Neon), Vercel serverless, vanilla HTML/JS, all managed; the suite is about 1,900 tests. Site: Drupal 7 on Pantheon, PHP 8.3, git-mode deploys Dev → Test → Live. Hard rules on the app: nothing that scales with row count on the boot path; migrations additive; the seal server-enforced; public surfaces emit display name, handle, city and points only; mockup-first; "shipped" means pushed to origin.

---

## 14. Decisions of record

- Free-entry, skill-only audience competition; attorney has cleared the prize structure; A2P 10DLC registered; typed phone number = SMS marketing consent (cleared 2026-06-30).
- Items the operator has listed for counsel: referral points on the cash board; the artist-text consent line at volume; sponsored cash mechanics; Makin' It Pay's terms (the operator's open legal item).
- The $500 is never "monthly" and never dated (2026-10-03). "Top A&R" is won in the tournament.
- Public graphics print rank, never scores (2026-10-02). A rank slide never shows the field size.
- Captions are SEO copy; hashtags only name a campaign; comment keywords instead of links (2026-10-02/06).
- Results live on the site; the email brings people back; no rank on the account page or the grade card (2026-10-02/15).
- Delete = anonymize; the history stays (2026-10-06).
- The daily livestream is deprecated; the weekly show is the only livestream (2026-10-11/15). The tournament RSVP list stays in the app, never Brevo (2026-10-11).
- The Service Pack drops with each A&R Wars announcement as a 60-day promo offer; Promo Budget buys anything in Services and any submission (2026-10-11).
- The Countdown fits 10 slides and posts through SocialBee (2026-10-11). Live "play my song" is CashApp + email on Wednesday (2026-10-11). Urgency lives on the Drupal submit page (2026-10-11).
- The rating meanings are the shared scale and the artist's verdict (2026-10-14). Spend tiers tell every artist at 3+ what to invest (2026-10-15).
- A daily set is named for its release date (2026-10-14). The daily email goes to who rated; the open notice only to new accounts (2026-10-15).
- The upsell wall comes down on release day: paid-only Track Reports, Mimbership and promo offers, #1 offers with code ANR723 (2026-10-15/17; not built).
- Console vocabulary: Daily Drops · Live Sessions · Tournaments · Top Picks (2026-10-13).
- Review takes all genres; the $1,000 tournament and its ads are urban only (2026-09-23).
- A subtraction pass is planned; `live_bonus` is re-evaluated inside it (2026-10-11).
- PARKED: teams, per-host branding, Hitmail, Zapier auto-posting of the app's carousels (SocialBee hand-off chosen instead).

---

## 15. Open questions and the build list (as of 2026-10-17)

**Unanswered:**
1. **Rank on the daily page's end-of-day screen and the account header pill**: does the no-rank rule apply to them too? (Explained on the review page; the grade card and standing card already hide rank.)
2. **Top Tracks from the weeks of Aug 3–30 qualify for nothing** under the calendar rule.
3. **Release-day emails, Q1–Q6 in the spec** and the two prices it needs: the Track Report price for free submissions, and the free-one-month-Mimbership code for Top A&Rs. Also whether the no-upsell test is dropped outright.
4. **The 0–10 scale**: the operator is now unsure. Decide, or close it.
5. **Top Picks rename scope**: public copy only, or also the URL and the Brevo list names.
6. **Meta campaign decisions** from the October brief: which creatives, the budget, the pre-selected amount, the investment question on the form, moving the Express line button up beside Submit for free.
7. **Makin' It Pay** legal review; Stripe Link showing bank/Klarna on plan checkouts (an account-level setting).

**To build, app (decided):** the 6 PM schedule deploy + panel save (PR #54); the session state model (PR #43); the "$500 never monthly" sweep and the release-date naming (PR #41); the 10-slide Countdown + SocialBee hand-off; the paid-submissions-per-day readout; the Top Picks rules page; the rating-meaning line and list (mockup pending approval); release-day emails (mockups first); blind results + Takeover mode; auto-seed by rating / seat order; the overlay bracket; the fresh copy CSV; the Top Picks rename; the Mimber flag on the push (for the #1 tie-break).
**To build, site (decided):** move the lock to 5 PM ET with the 6 PM open; the Submit Music page's ticking clock and scarcity; Promo Budget crediting for the champion; the investment question + Brevo attribute (if approved); the genre sentence on the landing page; sending `isMimber` on the push.
**Still open on the Track Report:** band edges to the real quartiles; naming the 7+ raters with consent; a hosted report page (the results link now exists).
**Housekeeping:** the subtraction pass inventory; "The A&R Program" naming sweep; `DAILY_STREAM_NAME`; the Countdown code still emits hashtags; the mim repo's A&R Meeting runbook still describes the noon/2PM/3PM clock.

---

## 16. Glossary

- **The A&R Program** — the umbrella. **Makin' It** — the open media platform. **The Mimbership** — the paid professional network; members are Mimbers and pay dues.
- **A&R** — a member of the team; a player. **The A&R Team** — the membership and the app. **Official A&R Card / grade card** — a member's generated share graphics.
- **A&R Daily** — the daily drop, A&R-facing. **The A&R Meeting** — the same review, artist-facing. **Makin' It Daily Countdown** — the daily results carousel, named for its release date.
- **Express line** — the paid lane of the daily submission (front-facing name); **the pool** — the free lane (lottery, Trusted accounts).
- **A&R Room** — the weekly Wednesday livestream, the only one; **Takeover** — a guest-hosted Wednesday (sold); **Versus Challenge** — a sold head-to-head session.
- **The week** — Monday through Sunday by the day a drop opened; announced the following Wednesday. **Top A&R / Top Track of the Week** — the weekly report's #1s; a tournament seat each.
- **A&R Wars** — the A&R tournament; 8 weekly Top A&Rs; Service Pack picks; $500 Cash Prize + a magazine feature; every 8 weeks.
- **Makin' It $1,000 Music Review Tournament** — the artist tournament; 8 weekly Top Tracks; own catalog; urban genres; $1,000 Promo Budget; every 8 weeks, offset 4 from Wars.
- **Promo Budget** — makinitmag.com credit, earned through referral awards and received as the tournament prize, spent on submissions, services and digital products. "Received", never "won".
- **A&R Service Pack** — the paid distribution pack, dropped with each Wars announcement; **/push** — its delivery and placement videos. **Top Picks** — the free $150 prediction contest on it (formerly the Side Bet).
- **Makin' It HOT 100** — the monthly chart carousel (rank only). **Makin' It Pay** — the site's layaway plan for $250+ purchases.
- **Session · Series · Round · Predict the Average · Bullseye · Versus · the seal · the wall · scouting · recruiting · support level · reference track · Track Report · verdict · spend tier · engaged account · Tastemaker · Win** — as defined in the sections above.

---

## 17. Source index (app)

- `CLAUDE.md` (origin/main) — settled architecture, shipped features, workflow rules.
- `docs/specs/tournament-spec.md`, `track-report-spec.md`, `daily-drop-integration-spec.md`, `referral-click-tracking-prompt.md`, `sidebet-contest-spec.md`.
- `docs/daily-operator-manual.md`, `docs/daily-setup.md`, `docs/brevo-sync.md`, `docs/sales-leads-asana.md`, `docs/process/hot100-announcement.md`.
- `docs/promo-asset-list.md`, `public/brand/`. Skills: `anr-brand`, `anr-service-pack`, `anr-takeover`.
- Master calendar: https://claude.ai/artifact/E8wfxbHC2uvXf27NNCPR5X. Review page: https://claude.ai/artifact/UW58ruGGdLCFREVEFQLVpB.

---

## 18. The makinitmag.com side

The site (Drupal 7 on Pantheon, repo `mim`) owns everything the app does not: who submits, what they pay, which records make the day, the artist's status page, the Promo Budget, the Mimbership, the services catalog, payments, and the social pipes. The app receives an approved day and runs it; it never duplicates selection, pricing or pool logic.

### 18.1 Two products

| | Makin' It | The Mimbership |
|---|---|---|
| What it is | An open media and culture platform | A paid professional network |
| Mission | Spotlight the next wave of creatives | Connect serious artists and professionals to opportunities, help them grow a team and attract business |
| Delivered through | Media, events, opportunities | Network access, status, visibility, exclusive opportunity tiers |
| Requires payment | No | Yes; there is no free tier (a free account is operational only: login, purchases, applications) |

Opportunities bridge them: the acquisition engine for the Mimbership and a core benefit of it. **There is one opportunity type, Submission** (operator, 2026-08-29): anything delivered to everyone who pays is a Service; an Opportunity is something you apply to and can lose.

### 18.2 The A&R Meeting intake (`mim_anr_meeting`, LIVE)

- **Landing:** makinitmag.com/review → `/opportunities/anr-meeting`, titled "Send Music to A&R Team for FREE Review", pills A&R Feedback · Track Report · Promo Budget, "200+ members on the A&R Team", the line "Send your music for a full track report and qualify to receive $1,000 Promo Budget". The page leads with the free review (the tournament-first copy was reversed 2026-10-05). It says "We accept all genres"; the tournament and its ads are urban only (a sentence naming the tournament genres is the proposed fix).
- **Two lanes, one door:** the **free lane** (Trusted accounts: email, photo, phone; one live free entry at a time; a pure lottery, up to 4 drawn a day; the artist is notified when selected; "Lottery" no longer appears in copy, the raw count of songs waiting does) and the **Express line** (titled "Paid submission"; guest checkout allowed; multiple songs; $10–$100 in $5 steps, default $50; at least 4 pulled a day). The door hint: "$X puts you at the front of the Express line."
- **Weight** = amount + (weeks waiting beyond a 4-week head start) × a climb (~$11.875/week on the default ladder), computed at read time, so a $10 record reaches the front by week 12 and nobody sits in limbo. Money is what Stripe charged. No tier discounts or vouchers on this form. The "front of the line" quote is the line's highest amount plus a step, or $25, whichever is more.
- **One record an artist a day** (by artist name); a paid seat still blocks a free record from the same person.
- **The daily lock:** cron, once a day at the lock time (a morning-hour select; today's clock puts it at 2 PM, the 6 PM open moves it to 5 PM): close the previous meeting, assemble the agenda (Express line by weight then arrival, free at random), freeze it, **push it to A&R Daily** as one all-or-nothing POST (`ref`, title, artist, Instagram, public profile URL for accounts, email, phone, note, play URL, `scout {uid,email}`, `amount` in dollars; never lane or weight), retry a refused push every 10 minutes until the open, email staff on the first refusal only. A late lock can be dated tomorrow.
- **The results callback** writes `rated | not_playable | unrated` with ratings, reports, the average and the results link onto each entry; a record absent from the callback was pulled mid-window. The status page reads "Reviewed <day>. Rated by N A&Rs. Your Track Report went to <masked email>."
- **Scouting:** the recruiting link carries the A&R's uid (`?ref=`, formerly `?a=`); attribution order URL → 90-day cookie → the account's referrer when that referrer holds the **A&R Team role**; stored as `scout_uid` and sent on the push. Drupal counts every scouted submission (ambassador reporting); the app pays points only for records that make a drop.
- **Receipt and card:** every submission gets a "Scheduled for review" card (option A, "Get free feedback from the A&R Team" + the $1,000 line, Submit music · makinitmag.com/review) and the qualifying email (follow @makinit4indies and @makinitmag, post the flyer "to support the platform", complete the profile). Cards are drawn once and cached.
- **v1.1 (decided, not built):** the ladder that raises seats as paid inflow grows is a dial on the desk; SMS notices are scaffolded and disarmed.
- Runbook: `docs/ANR_MEETING_RUNBOOK.md` (its clock table still shows noon/2PM/3PM).

### 18.3 Promo Budget (`mim_referrals`, LIVE)

Site credit. **Earned** through one-time awards for finishing things (profile complete, a B grade, first referral and the 10th and 25th, follower milestones, first review and the 50th, first share and 50 share clicks, first Win, networking ranks, an accepted collab; each fires once per person, ever; amounts are configurable and small). **Received** as the Music Review Tournament's $1,000 prize and as the forfeit credit from a lapsed Makin' It Pay plan. **Spent** at checkout ("Pay with Promo Budget") on submissions, promo services and digital products; per the operator, anything in Services and any submission. The member page `/promo-budget` shows Available / Expiring soon / history; the "award board" is a staff screen, there is no member leaderboard. Copy rule: Promo Budget is received, never won; referral copy promises attribution and "Influence", never ranking. Ambassadors (Tastemakers who refer Mimbers) earn a commission that keeps accruing while they bring a new Mimber every N months.

### 18.4 The Mimbership (`mim_mimbership`, LIVE)

| Tier | Price | Positioning |
|---|---|---|
| Core (was "Standard") | $20/mo or $200/yr | "Ready to be seen" |
| Silver | $100/mo or $1,000/yr | Professional, "Ready to be invested in" |
| Gold | $250/mo or $2,500/yr | Professional |
| Platinum | $15,000/yr, invite-only | Professional |
| Legacy | lifetime status for anyone who ever held an annual Professional Mimbership | profile and Updates stay visible for life |

Members pay **dues**, are **in good standing**, **past due**, **honorary** (comped), **lapsed** or **reinstated**; never "subscribe", "billing" or "cancel service". Benefits: the public profile and Updates (the "main link" to their music), Networking (Looks on Updates), Discovery/scouting by Tastemakers for Professional Mimbers, exclusive opportunities, Mimber discounts (a standard being applied across services: Core 10%, monthly Professional 25%, annual 50%; today most services run a 50% intro price for everyone, so Mimbership adds nothing on them until intro pricing ends, which the standard frames as a marketing event), Perks, Wins, the Benefit Catalog of micro-reveals (drafted), newsletters, a new-Mimber card posted to social automatically. Tier state is event-driven off Stripe. The A&R Program's sales pitch for it, verbatim: "Get a team behind your music. Marketing, Promo, Booking, and PR." / "Join our FREE community connecting independent artists, creatives, and professionals with real opportunities. Join #TheMimbership professional network for 12 months of help with your Marketing, Promo, Booking and Public Relations for as little as $200 per year."

### 18.5 Services and opportunities (LIVE)

Services sold through priced webforms with Stripe: A&R Room Takeover (1 or 2 hours), Versus Challenge (best of 5/9/15), banner rotation in the A&R Room, the Service Pack placement, the 60-day promo campaign (`/push` carries its videos), consultations, magazine ads, partnership packages, playlist features (Makin' It Approved, Adult Bopz, Serato Flamerz), performances (Art Basel, SXSW, Radio Connect Awards, Mixaholic Mondays). Opportunities (submissions you can lose) get promo cards and a staff campaign desk, a Tuesday newsletter, and a submission-review layer for partners. Promo codes (`mim_promos_codes`, spec only) are separate from vouchers and from Promo Budget.

### 18.6 Makin' It Pay (`mim_pay`, LIVE 2026-10-16)

A layaway "open invoice" for purchases of **$250 or more**, never submissions: the buyer locks today's price and perks with a down payment (15%, minimum $100), pays any amount any time through Stripe, and the service starts only when the balance hits $0 by the deadline (60 days under $500, 90 days from $500; 14-day cutoff before a dated event). No refunds; a missed deadline forfeits the payments, which can be applied as a **Promo Budget grant** at the operator's discretion, or the plan reopened. Chooser at checkout: Pay · Klarna/Affirm (immediate) · Makin' It Pay (no credit check, delivered at payoff). Buyers see `user/%/plans`. Enabled on Live for the Takeover, the Versus Challenge, the Issue 34 magazine ad and consultations, and the Silver/Gold/Platinum annual Mimberships; the first real plan (a Silver Mimbership) was started on 2026-10-16. Legal review is the operator's open item.

### 18.7 Tastemakers, Wins and the social pipes

- **Tastemaker program:** Tier 1 is a mailing list only (no site surface) and doubles as the **Service Pack's target list**, with a goal of 3+ emails a month; Discovery is the section and scouting the action (Professional Mimbers only, recency-sorted, notes private to staff by default, shared notes never locked); Support logs organic coverage by Tastemakers for Professional Mimbers ("Money never flows FROM the artist"); the end state is Tastemakers as commissioned ambassadors. Makin' It is short-staffed; everything must be automated and simplified.
- **Wins** (`success_story`): testimonials; win **videos** go through a desk (send to Stream, trim, Abyssale renders the branding, approve and publish) and then to social via the social pack and SocialBee, with @TheMimbership and the winner as real collaborators and "Comment JOIN" instead of a link.
- **Social pipes running:** new-Mimber cards, win videos, Service Pack placement videos (Zapier → SocialBee). **Ready or needed:** win graphic cards, opportunity promo cards and countdowns, A&R Meeting open/closes-tonight/results posts, event roundups, featured Updates, perks, blog posts, magazine issues.
- **Newsletters** (Mailchimp RSS-to-email, 10 AM ET): Opportunities Weekly (Tuesday, live), Industry Events (Thursday, drafted), Community Monthly (1st Wednesday, new), Makin' It Hot 100 (2nd Wednesday, new, fed by the app).
- **Conversions:** Meta Conversions API, UTM capture, a Trusted-account event; the SMS inbox ("Text REVIEW to 678.336.5204" / "Text A&R to join").

### 18.8 Source index (site)

`docs/ANR_MEETING_RUNBOOK.md` · `OPPORTUNITIES_CONSOLIDATED_SPEC.md` · `MIM_MIMBERSHIP_SPEC.md` and `briefings/mimbership-architecture-briefing.md` · `MIMBER_DISCOUNT_STANDARD.md` · `MAKIN_IT_PAY_SPEC.md` · `BENEFIT_CATALOG.md` · `TASTEMAKER_PROGRAM_HANDOFF.md` · `SUPPORT_SPEC.md` · `SUCCESS_STORIES_SPEC.md` · `NEWSLETTER_PROGRAM.md` · `OPPORTUNITY_PROMO_SPEC.md` · `SUBMISSION_REVIEW_SPEC.md` · `MIM_PROMO_CODES_SPEC.md` · `COPY_CONVENTIONS.md` · `social-post-inventory-2026-10.md` · `briefings/anr-submission-campaign-oct-2026.html` · `briefings/MiM_Opportunities_Master_v5.md`.
