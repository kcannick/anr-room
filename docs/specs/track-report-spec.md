# Track Report — rebuild spec (A&R Team app)

**For:** a new session in this repo (`anr-room`) rebuilding the artist's report for
**The A&R Meeting** (A&R Daily). **From:** the makinitmag.com side, 2026-09-15, collecting
every recommendation, mockup and artifact made on the way here.

**Status — BUILT 2026-09-15** (order of work §9 steps 1–4, plus the data for 5): the report
is now the page list in `trackReportPages()` (server.js) rendered by the `trackPage` element
(share-cards.js), every sentence derived in `track-report.js`. Still open: §2's two
decisions (band edges — `/api/card/song-report?r=…&meta=1` returns the comparison set's
quartiles; named high raters with consent) and §7's hosted page / `reportUrl`.

**What existed before:** the artist got three PNG pages ("Official Room Report") plus the
approved A&R comments in an email at 3:00 PM ET the day after the meeting. It was designed for
the live A&R Room; the Meeting is a different product and the report was rebuilt around
what a Meeting artist was promised and needs.

---

## 1. What the artist was promised

The landing page (makinitmag.com/opportunities/anr-meeting, node 24314) sells exactly three
things — these are the report's contract:

- **an official track rating** — the room's 0–9 score,
- **a report** — "to help you decide what needs work and what's worth investing in",
- **comments from the team** — private, attributed A&R notes.

Perks on the opportunity card: **Record Report · Private Feedback · Promo Budget** ("standout
records get booked for performances, playlist placements and interviews, and can qualify for
promo budget").

The artist's status page on makinitmag says, after the day: *"Reviewed Fri Sep 12. Rated by 23
A&Rs. Your Song Report went to j***@gmail.com."* — so the report **is** the deliverable; the site
only promises it.

---

## 2. The one design decision (Room Report v2)

Read this first: **Room Report Redesign** —
https://claude.ai/code/artifact/995eb6b0-041b-40aa-bd3c-94ac86ff8abb (same file in the mim repo:
`docs/mockups/anr-room-report-v2.html`). Built from the real Jul 21 "Get Well Soon" report; every
number is live data. Its thesis:

> The current report opens with a number and buries the instruction on card five. An artist
> doesn't need a grade — they need to know what to do with the record on Monday.

**Seven cards, every line derived from numbers already computed — nothing hand-written per
record:**

| # | Card | Headline example | Derived from |
|---|---|---|---|
| 1 | **The decision** | "Release it. Don't put money behind it yet." Score underneath as evidence. | the score band |
| 2 | **How it split** | "Agreement, with three believers." Histogram, average, middle score, count of 7+. | histogram shape: consensus / divided / thin |
| 3 | **Against the room** | A marker on the series' real score curve. Replaces "Top 61%". | series distribution |
| 4 | **Who it's for** | "Artists and DJs. Not managers." Segments reframed as targeting. | role/city segments (≥3 voters) |
| 5 | **Setup vs record** | "It promised a little more than it gave." Predicted 4.6 → delivered 4.3. | prediction gap, with a *meaning* |
| 6 | **What now** | Three next actions. | band + biggest segment gap + prediction direction |
| 7 | **Share** | Title, artist, "30 A&Rs heard it". **No score.** | postable at 2.1 or 8.4 |

**Cut:** "Room favorite · 7% scored it 8+" (two people, and card 2 disproves it). "Top 61%"
(flatters only below ~25%). Gold on medians and modes — **gold is money and first place only**
(brand rule). "Who connected" as a title (promised names, delivered averages).

**Two decisions the mockup left open, still open:**
1. **Calibrate the bands to the real series** — set band edges at the series' quartiles so
   "Solid release" stops covering a third of everything. Data exists (`rounds.room_average`
   across ratified rounds in the series).
2. **Name the tail, with consent** — the A&Rs who scored it 7+ are the most valuable fact in the
   report. The comment consent model already exists (`round_comments.status = 'shared'`); extend
   the same opt-in to "may be named as a high rater".

---

## 3. What is different about a Meeting report (vs the Room)

- **No live room.** "Evaluated live in The A&R Room · date" → "Rated by N A&Rs in the A&R
  Meeting · date". No in-room vs remote pools (every Meeting vote is async) — drop that tile.
- **Every record is rated by the whole day's A&Rs**, so the vote count is the credibility
  number. Put it where the score used to be prominent.
- **The prediction is the Meeting's own game** (A&Rs predict the average and score on
  accuracy). Card 5 is therefore the Meeting's most distinctive page; keep it, with the
  "packaging vs record" reading.
- **Free vs paid is invisible to A&Rs and must be invisible in the report.** `amount` /
  `support_cents` (037) is operator-only. Never on a card, never in the email.
- **Reference tracks** (035) are excluded from the artist queue already; also exclude them from
  "against the room" and rank-in-day denominators, or say "of N submitted records".
- **The day's Top Track** already gets a results carousel (038). The report's share card should
  not compete with it — see §5.
- **Comments are the private feedback** and are the second thing promised. Today they ride in
  the email body only. Give them a page (or two) in the report itself, attributed the way the
  email already attributes them (name · role · city), shared-status only, blocked accounts
  excluded.

---

## 4. Data already available (no new capture needed)

From `songReportData(round, session)` (`server.js` ~2374): `votes`, `mean`, `median`, `modes`,
`hist[10]`, `heatPct`, `predictMean`, `gap` (+ `gapWord`), `roles[]` and `cities[]` (segments
with ≥3 voters, top 4), `pools`, `rankInRoom`, `seriesPct` (≥5 ratified rounds), `dateLabel`.
Comments: `round_comments` (027/029) joined to participants/users for name, role, location.
Support level: `rounds.support_cents` (037) — operator only.

**Needed for v2 and cheap:** the series' score distribution (for card 3's curve and the band
calibration), a "shape" classifier for card 2 (consensus / divided / thin from `hist`), and the
three next-action rules for card 6. All server-side; no schema change unless the "named high
rater" consent is added.

---

## 5. Share graphics — keep the wall

The share side is already designed and partly built; the report should reuse it, not invent a
fourth style:

- **A&R Artist Share Graphics** — https://claude.ai/code/artifact/b84904f2-fdab-4339-b609-9c1d4dcb5274
  (`public/brand/artist/artist.html`, `render.sh`, `badge.py`). Rule that holds: the Meeting
  graphic never carries a pack call to action; the pack graphic never carries a score. The
  "Rated at the A&R Meeting · date" **badge is parked** — the report's share card is the place
  it could come back, with **no score on it** (card 7 above).
- **A&R Meeting Results Carousels** — https://claude.ai/code/artifact/1103ddc7-6f9c-4785-891d-09830e52245f
  (built, 038): Top Track / Top A&R, ranked without scores, 3 PM daily. The report is per artist;
  the carousel is per day. Don't duplicate the Top Track slide inside the report.
- Brand system: **Signal — the A&R Brand Kit**
  https://claude.ai/code/artifact/33da6fc3-0227-42ca-a623-3146e8d1b44a and **A&R Marks and
  Icons** https://claude.ai/code/artifact/fd5f45c0-4ac8-4625-aab7-3b206f981203; the `anr-brand`
  skill in the mim workspace carries the rules (green = the Meeting/scoring; gold = money and
  first place only; Archivo/Space Mono; 13° device; no emoji in rendered cards — Satori has no
  emoji font).

---

## 6. Copy rules (these are enforced, not suggestions)

- **Say what the artist gets, never how the machine works.** No "pool", "lottery", "queue",
  "submission" as a thing, "finalizer", "ratified". (Kelby, 2026-09-12: *"Same song, same
  submission" is meaningless to the artist.*)
- **Reader is an independent artist, ~24.** Plain, concrete, no jargon, no "build reps".
- **A number stands alone.** Never pair a money figure with a headcount on one line.
- Bands are sentences the artist can act on, not grades: "Release it. Don't put money behind it
  yet." beats "Solid release".
- Comments are attributed (name · role · city) — attribution is the whole point.

---

## 7. Delivery — what makinitmag expects

- The report goes out from the app at **3:00 PM ET** the day after the meeting (publish), by
  email to the address pushed on the record (`email`), held one hour with the comments.
- At the same time the app POSTs results to `https://makinitmag.com/api/anr-meeting/results`
  (spec §12): `rated | not_playable | unrated`, `ratings`, `reports`, `average`. The site marks
  the record reviewed and the artist's status page says the report went to their address. There
  is **no report URL** today (§12: "reportUrl: no, omit it"). **If the rebuild produces a hosted
  report page, add `reportUrl` to the callback** — the site is ready to link it.
- The artist's public profile (`profileUrl`) and Instagram handle come on the push; the report
  can use them for the share card.

---

## 8. Every related artifact and mockup

**Artifacts (claude.ai):**
- Room Report Redesign — https://claude.ai/code/artifact/995eb6b0-041b-40aa-bd3c-94ac86ff8abb — **the design**
- A&R Artist Share Graphics — https://claude.ai/code/artifact/b84904f2-fdab-4339-b609-9c1d4dcb5274
- A&R Meeting Results Carousels (built, 038) — https://claude.ai/code/artifact/1103ddc7-6f9c-4785-891d-09830e52245f
- Signal — the A&R Brand Kit — https://claude.ai/code/artifact/33da6fc3-0227-42ca-a623-3146e8d1b44a
- A&R Marks and Icons — https://claude.ai/code/artifact/fd5f45c0-4ac8-4625-aab7-3b206f981203
- A&R Promo Asset Inventory — https://claude.ai/code/artifact/0f918759-7b34-4cdc-b2c0-6fcd118f6503
- The A&R Meeting (product decision: private, daily, free + pay-what-you-want) — https://claude.ai/code/artifact/96030936-b9d8-435a-b5e3-619ef885f60a
- Meeting and Room (the two-product split) — https://claude.ai/code/artifact/22bbed05-6567-4f10-8bb9-fe9f667c634f
- Private Feedback Versus Airtime — https://claude.ai/code/artifact/c3babe35-aac5-4bea-b93e-de7f4979464f
- A&R Room Session Earnings (the data that reshaped the product) — https://claude.ai/code/artifact/a9858ba1-1fb3-44f0-b98b-637c7daa0410
- A&R Meeting Landing Page — https://claude.ai/code/artifact/7712e9b6-3194-4950-b15a-ca16c31446d0
- A&R Meeting Submit Form — https://claude.ai/code/artifact/e2b8f9a6-7d4b-4de8-b98a-fd77cbeb9cf9
- The AR Team App — https://claude.ai/code/artifact/581c0456-49f8-414a-bc5f-32828003ea0e

**Mockups in this repo (`anr-room/docs/mockups/`):**
`song-report-v1.html` (what ships today), `anr-share-graphics-mockups.html`,
`anr-session-cards-mockup.html`, `anr-brand-marks-mockup.html`.

**Mockups in the mim repo (`makinitmag.com`, `docs/mockups/`):**
`anr-room-report-v2.html` (the design above), `anr-meeting-round2.html` … `round9-upgrade.html`
(the Meeting's product rounds: economics, top-slot pricing, landing copy, two-product split,
differentiation, final form, the push, upgrade/add support), `anr-room-session-earnings.html`,
`anr-team-submission-round1.html`, `email-template-round1.html` (the branded email wrapper the
site uses — the report email should feel like a sibling, not a cousin).

**Code in this repo:** `server.js` `songReportData()`, `sendArtistReportEmail()`
(`artist/<session>/<round>-p<n>.png` upload, 3 pages, page 3 needs 8+ votes),
`artistEmailHtml()` / `artistCommentsText()`; `share-cards.js` `bodyReport1/2/3`, `frame()`
(3:4, 1080×1440); `email.js`; migrations 026 (artist notices, `report_urls`), 027/029
(comments), 035 (results callback), 037 (support level), 038 (carousels).

**The wire:** `docs/specs/daily-drop-integration-spec.md` (§12 results callback, §14 `amount`).

---

## 9. Suggested order of work

1. Card 1 + card 6 (the decision and the next actions) — the report becomes a report.
2. Card 2 shape classifier; card 3 curve from the series distribution; drop pools.
3. Comments as report pages, attributed.
4. Share card with no score; retire "Room favorite" and "Top N%".
5. Band calibration from the series (operator decision on the edges).
6. Optional: hosted report page → `reportUrl` in the §12 callback; named high raters with consent.
