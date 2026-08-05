# The A&R Room — Product & Business Overview

*A briefing for a prospective cofounder. Sourced from the product's strategy docs and current production codebase. **Contains no traction or financial figures** — those are for the operator to supply (see §11).*

- **Operator:** Makin' It Magazine — makinitmag.com
- **Live product:** anr.makinitmag.com
- **Status:** weekly show shipped; competition layer live
- **On air:** Wednesdays 7–11 PM ET, multi-streamed to 6 platforms

**Status legend:** `[LIVE]` in production · `[NEXT]` near-term build · `[HORIZON]` later bet

> **The thesis:** Two competitions in one room — **artists compete to make the chart**, and the **audience competes to read the room**. The live show is where they meet.

---

## 1. The one-liner

A live music-review broadcast with a game bolted to the audience.

Every week, records are submitted, played, and given live on-air feedback by a host and co-host, multi-streamed to six platforms at once. Artists pay for placement and exposure — **that is the existing business.**

The new layer turns viewers from spectators into competitors. As each record plays, viewers **rate it 0–9 and predict what the room's average will be**, scoring points on how well they *read the room* — a pure skill game, free to enter. Points accrue across a month of tagged shows onto a **Series** leaderboard. At month's end the top scorers are invited to **A&R Wars**, a head-to-head tournament for a cash prize.

The audience's competition isn't run for engagement's sake. **It is the thing that makes an artist's dollar worth spending** — a visibly real, active, competitive room is exactly what an artist is paying to be seen by. Audience attention becomes a product sold to artists; artist money becomes a prize that buys more audience. Both sides are in the competition.

---

## 2. The market it attacks — the squeezed middle

The review market has lost the ability to signal who actually delivers, and has sorted into two extremes:

- **The bottom floods the field.** Hobbyists with an $80 livestream setup do free or $5–20 reviews. Not worse — just so numerous that signal drowns in noise. Price and quality stop being legible.
- **The top sells borrowed clout.** Established names and platforms monetize the *appearance* of access — $100+ submissions that function as a high-priced lottery. They signal more; they don't deliver more.
- **The serious artist chases the names** — because a famous face is the only legible proxy for "this person can do something for me," even when it delivers nothing.

The middle — DJs, promoters, and platforms with a **real audience and real pathways** — delivers the most and signals the worst. "We have a real room" is harder to prove than a blue check. **That gap is the wedge.**

**Why the participation layer is the proof:** When an artist submits to a clout-merchant, there's a host and a void. When they submit here, there's a host, a co-host, *and a live audience actively rating the record and competing to read it right.* The room is visibly real — you can watch it rate. A hobbyist can't conjure a competing audience; a clout-merchant *won't* give the crowd a real voice, because their model depends on the artist not seeing the room is empty. Giving the crowd a visible, competitive stake is a costly signal — which is exactly what makes it credible.

> **The honest limit:** the moat is **the room and the operating quality, not the code.** Anyone can build a poll. Defensibility comes from the community, the real pathways (A&R Wars, the discovery funnel), and feedback quality — a position to be operated, not a patent to be held.

---

## 3. How it works — one mechanic, one weekly loop

The game is a single atomic move, used on every record: **rate the song (taste) and predict the room's average (the read)**, then lock in. Scoring is skill-based and server-computed — accuracy against the room's actual average, with an exact-hit "bullseye" bonus and exponential falloff as your read drifts. You're never wrong for your taste; you're scored on your read.

1. **Submissions open.** A free lottery (any registered user can submit; 10 are drawn — but you must be live in the room when called) plus paid Service Pack placement.
2. **The broadcast.** Wednesday 7–11 PM ET, six-platform multistream. Records play; host and co-host give live feedback.
3. **Live rating.** Viewers rate each record and predict the room's average, scoring on how well they read it.
4. **Series accrual.** Each week's show is tagged into the current monthly Series. Points roll up onto the Series leaderboard.
5. **The monthly cut.** At series close, the top scorers are invited to A&R Wars.
6. **A&R Wars.** A single-elimination tournament — 8 competitors scout songs and play them head-to-head; the audience votes each matchup, majority wins, winner advances. One cash prize.

**A word on A&R Wars, precisely:** The head-to-head mechanic — binary "Versus" polls where the audience picks a winner — **is live today.** The operator's current call is to **run the tournament manually on top of it**: the host enters each matchup through the existing Versus flow and tracks the bracket by hand, and the Wars show is just tagged into the active Series. So a full A&R Wars can run now with zero new software. A richer in-app tournament layer — visual bracket, auto-advancement, competitor rosters, an overlay bracket, a persisted winners archive — is a clearly-scoped *optional* future build, deliberately deferred, not a blocker.

---

## 4. What's live today

This is not a concept deck. The weekly show and its competition layer are built, tested, and in production.

### The game & the season

| Feature | Status | What it is |
|---|---|---|
| Rating game + Versus | `[LIVE]` | 0–9 rate-and-predict scoring, plus binary "Versus" (Song A vs B, predict the split). Room lean stays sealed until results — it's what players predict. |
| Series layer | `[LIVE]` | Monthly competition container; live-computed leaderboard summed across tagged shows; configurable qualifier cut; public series board on the homepage. |
| Profiles + qualification gate | `[LIVE]` | Public identity (name, photo, categories, city, socials); a complete profile is required to appear on the board and qualify for prizes — doubling as prize-payout KYC. |
| Liveness | `[LIVE]` | Join feed and live counters (count-only, never the sealed room lean), pushed in real time. |

### The broadcast & the front door

| Feature | Status | What it is |
|---|---|---|
| OBS stream overlay | `[LIVE]` | Broadcaster-ready graphics — horizontal and vertical, plus individual elements as separate sources — with QR calls-to-action (join to win, submit music) and a live leaderboard scoped to room / round / series. |
| Public homepage | `[LIVE]` | Session-aware front door: hero + $500 hook between shows, "live right now" state during, register CTA, series board, new-A&Rs ticker, submit-music funnel. |
| In-page stream embed | `[LIVE]` | Tap-to-start YouTube embed so watch + vote live on one device; resolves a permanent channel link to whatever's live now. |

### Growth, money & operations

| Feature | Status | What it is |
|---|---|---|
| Creator / host program | `[LIVE]` | Invite-only host role: other reviewers get a free engagement tool for their own stream. Everything stays A&R Room–branded; hosts never see viewer email/phone (server-side redaction) — the platform keeps the audience data. |
| Share cards + recap emails | `[LIVE]` | Auto-generated Score Card, Top 8 Songs, Top 8 A&Rs graphics; chunked recap-email fan-out with the Instagram-carousel growth play built in. |
| Song Report (paid) | `[LIVE]` | A 3-page per-record analytics graphic (distribution, perception gap, audience segments) — an upsell an artist pays for. |
| Ad server + platform panel | `[LIVE]` | Self-hosted Revive banner rotation in-app (lobby / gameplay), global + per-host default banners, house settings, and one-tap mass email/SMS to the whole audience. |
| Invite-only rooms + referrals | `[LIVE]` | Unlisted rooms with access codes; referral bonuses that pay a recruiter when the friends they bring keep playing. |

---

## 5. How it makes money — four lines, one integrity wall

The existing business is artist placement; the competition layer is what makes that placement worth more. Lines in rough order of current weight:

| Line | What it is | Indicative price |
|---|---|---|
| **Service Pack** *(the engine)* | Tiered paid placement sold as **exposure & distribution** — pool inclusion sent to DJs/tastemakers, guaranteed play & rating at higher tiers, promo graphics. These populate the A&R Wars pool. | ~$50 / $100 / $150 |
| **Review submissions** | Standard / priority / VIP paid review slots, capped per show (~10 each) to protect feedback quality, alongside the free lottery. Scarcity is deliberate. | per-slot |
| **MiMbership + services** | Existing membership and à-la-carte artist services (marketing/PR, playlisting, magazine) — monetizing the contact base the game grows. | recurring + à la carte |
| **A&R Wars sponsorship** *(the pivot unlocks it)* | Moving Wars to a recurring monthly online property makes it sponsorable — "A&R Wars, presented by [brand]," with a season, qualifiers, and a finale. | sponsor-funded |

Two smaller in-app lines already built on top: the paid **Song Report** upsell, and **in-app ad inventory** via the Revive integration.

> **The integrity wall — load-bearing, not compliance polish.** Paid placement buys a record **exposure, never a score and never a win.** The audience competition that awards the cash prize is **free to enter and ranked purely on skill.** Artist money and viewer points never touch. A leaderboard that could be bought is worth nothing to anyone — the moment money buys a score, this becomes the clout-tier it differentiates against. **The honesty is the product.**

---

## 6. The growth engine — three compounding loops

- **The free-lottery cold-start.** Anyone can submit free — but you must be *live in the room* when your song is called. That converts submission desire directly into live attendance, filling the room from the artists' own followings, and funnels free submitters toward becoming competing A&Rs.
- **The sanctioned bonus-round network — the largest lever.** Other reviewers' shows can be sanctioned as official bonus rounds in your Series. Their audience must *register on your platform* to earn points → those registrations become *your contacts* → and the partner gets to promote the cash prize *without funding it.* You trade cheap prize-marketing rights for valuable contact acquisition. This is the path to becoming the participation infrastructure the whole squeezed middle runs on.
- **The weekly social carousel.** One recurring post-show graphic doing four jobs: Top 8 Songs (sells the next submission), Top 8 A&Rs (status + FOMO fuel), A&R Wars promo (converts spectators to competitors), and a submit-music CTA (the revenue ask). The show generates next week's promo automatically.

---

## 7. Where it goes next — roadmap

| Item | Horizon | Notes |
|---|---|---|
| Richer A&R Wars tournament layer | `[NEXT]` | Optional: visual bracket, auto-advancement from poll results, competitor rosters, an overlay bracket, and a persisted winners archive. The manual version runs today. |
| Notification expansion | `[NEXT]` | "Room going live" and event pushes to opted-in A&Rs across SMS / email / web push (one-shot mass announcements already ship). |
| PWA install + iOS web push | `[NEXT]` | Gated behind a branding / site-facelift pass — a natural first project for a design-minded cofounder. |
| Sanctioned bonus-round network | `[HORIZON]` | The multi-tenant growth thesis, productized. The host role it rides on is already shipped. |
| Celebrity invite-only sessions | `[HORIZON]` | Top-N A&Rs each month earn an invite to a private listening session with a celebrity artist — a strong participation driver on top of the existing qualifier plumbing. |
| Hitmail | `[HORIZON]` | A separate, larger later bet — "fantasy football for music," a daily prediction game with a career ladder and friend leagues. A proven A&R Room is what would justify pursuing it. Not a dependency. |

---

## 8. Tech & operating posture — built to be operated, not babysat

A single Node/Express server, Postgres (Neon) in production, deployed serverless on Vercel, with a vanilla-JS frontend (no build step). Real-time is handled by a managed push service (Ably): the leaderboard recomputes only when a round is ratified and is **pushed to every connected client at once** — so compute cost is independent of audience size, which is the lever that makes a celebrity-scale night viable.

**Deliberately all-managed services.** The operator wants a reliable tool, not infrastructure to run. The stated budget ceiling is ~$200/mo of additional spend, with large headroom — roughly $0–20 today and ~$138 all-in even at a 1,000-concurrent event. A signup-burst load test has passed. The practical takeaway for a business plan: **infrastructure is not a meaningful cost line or a scaling risk** at any plausible near-term scale.

---

## 9. Brand direction — starting points

There's a working visual system already. It's a foundation to sharpen, not a mandate — the branding/facelift pass is genuinely open, and is one of the clearest places a cofounder can own real surface area.

**Current palette:**

| Role | Hex |
|---|---|
| Ground (purple-black) | `#0d0b16` |
| Signal / live (green) | `#4bb749` |
| Accent / brand (purple) | `#6d5fe0` |
| Money / prize (gold) | `#f5c518` |

**Current type:** DM Sans for body, Space Mono for data and labels.

**The naming system already has a point of view** and is worth protecting: players are **A&Rs** (you're a talent scout, not a "user"), shows are **Rooms**, the season is a **Series**, the tournament is **A&R Wars**, and the whole skill is **reading the room**. The copy is deliberately time- and tenant-neutral so partners can run it.

**Three worlds the brand can pull from:**

- **The label boardroom** — the A&R / executive fantasy: credibility, taste, "getting signed." Where the gold lives.
- **The live broadcast** — on-air energy, lower-thirds, the signal-green "we're live" moment.
- **The competitive game** — leaderboards, stakes, status, the screenshot-and-repost loop.

**Open questions for a brand pass:** how loud to make the *money* vs. the *craft*; whether A&R Wars gets its own sub-brand (it's the sponsorable property); and how the identity flexes when a partner host runs a Room under it.

---

## 10. Risks & open questions

- **The legal pass.** The structure is clean — free-entry, skill-only competition; placement buys exposure, not wins; SMS marketing consent is separated from 2FA; A2P 10DLC is registered and an attorney has cleared the current prize structure. But the A&R Wars pivot stacks a bigger cash prize, monthly cadence, cross-state online reach, and sponsor money — the profile that warrants a fresh counsel pass *before the first sponsored cash Wars.* Launch interim prizes as product/experience until the cash mechanics are papered.
- **The capacity ceiling.** Host attention is the product and it doesn't scale — roughly 40 records in a four-hour week is a hard ceiling, and quality feedback is the first casualty of volume. This is *why* the sanctioned-network play matters: you scale the system, not the person.
- **Defensibility is operational, not technical.** Anyone can build a poll. The head start holds only while the room, the pathways, and the feedback quality stay better than anyone who copies the mechanic.
- **Platform-surface dependency (mitigated).** The show lives on third-party livestream surfaces, but six-platform simultaneous multistream means no single platform can deplatform it out of existence — and the app + the audience data are owned.
- **Unit economics of the prize.** Decide deliberately whether the cash prize is an audience-acquisition subsidy or pot-funded, and whether it's fixed or scales with submissions — state the model rather than discovering it.

---

## 11. Early traction (measured) & remaining diligence

### Measured — first week in the app (8 shows, July 1–8, 2026)

Pulled directly from production; **raters only** (a subset of total livestream viewership across the six platforms — see the gap below):

- **85 unique A&Rs** cast **1,176 rated predictions** across the 8 shows.
- **Retention: 32% came back for 2+ of the 8 shows** — with a hardening core: **14 A&Rs played 3+ shows**, and the most loyal showed up for **7 of 8**. (Loyalty curve: 58 played once, 13 twice, 7×3, 2×4, 3×5, 1×6, 1×7.)
- **Activation: 30–89%** of a show's registrants actually voted (higher on smaller, tighter shows), and every A&R who voted also scored.
- **Engagement is deep:** on the full shows, active A&Rs rate **8–10 of ~16 rounds** each.
- **The room fills as the show runs** — votes/round rises from ~9.0 in the first third to ~10.6 in the last third, averaged across shows. No mid-show drop-off.
- **Accuracy:** 35% strong reads (5.6% bullseye + 29.7% sharp), 1.6% way-off — a satisfying, non-punishing curve.
- **Referrals** convert in the small: 6 joined via a code, 4 played.

*Caveats: this is a single week and 8 shows (early), a daily cadence, and — again — rating participants, not total viewership.*

### Still to get from Kelby (for a full plan/valuation)

- **Total livestream viewership** across the six platforms — the raters above are the engaged floor, not the ceiling.
- **Revenue & funnel** — Service Pack and review-slot volume and actual prices realized, monthly revenue and its trend, submission→attendance and free→paid conversion.
- **The Makin' It base** — the existing magazine/membership audience and contact list this launches into (the real cold-start asset), and how the A&R Room already cross-sells into MiMbership + services.
- **Cost structure** — prize funding to date, host/co-host and production costs, and any marketing spend — against the near-zero infrastructure cost.
- **The A&R Wars history** — how the physical version has performed at the monthly mixer, and any sponsor conversations already in motion.

---

## 12. The bet

It reduces to one question, answerable live every week:

> **Does a real, competitive, participating audience make the middle's review worth more than the clout it's losing to?**

The infrastructure to answer it is already running: the show, the game, the season, the creator program, the money surfaces. The open work is growth, brand, the richer A&R Wars layer, and the sanctioned-network expansion — which is precisely the surface a cofounder would own. Build the loop, run it, and read the answer off the leaderboard.

---

*Prepared as a cofounder briefing for The A&R Room · Makin' It Magazine. Sourced from the product's strategy docs and current production codebase. Traction and financial figures to be supplied by the operator.*
