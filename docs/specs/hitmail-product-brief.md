# Hitmail — Product Brief & V1 Spec

*Working name: Hitmail (verify trademark/domain before committing). Source-of-truth document. Everything here is either V1 scope or a deliberately-deferred later layer — the distinction is the whole point of the doc.*

---

## 1. The one-line concept

**Fantasy football for music.** A daily game where fans rate a new track and predict how the crowd will rate it, earn a score on how well they read the room, and climb a music-industry career ladder — competing in leagues with friends. Players are *fans with a stake*, not critics or curators.

## 2. What the game actually is

The atomic loop, used for every drop, always:

1. A daily **drop** arrives (a song, framed as a casual note from the "home office" — could be an unknown artist or a real established name referenced as news).
2. Player **listens** via a smart link out to their DSP of choice (real stream lands on the artist's real platform; we log the click).
3. Player gives two inputs:
   - **Taste** — rate it 1–10 (their opinion; never "wrong").
   - **Read** — predict the room's average, 0.0–10.0 (the skill that's scored).
4. Player **locks in** (commitment is final; both inputs freeze).
5. **Resolution** (same-day / next-morning): the room's average is computed, each player's Read is scored on accuracy.
6. **Results** are delivered as identity, not just points (see §4).

One mechanic. One resolution path. Verbiage is flexible; the engine is fixed.

## 3. The core emotional hook: identity, not points

The score is evidence; the **identity** is the product. People return to keep being the person the score says they are. Two scores feed this (see §7): **accuracy** (skill — did you read the room) and **alignment** (identity — is your own taste in tune with the room). The results moment must *tell players who they are*:

- **In tune** — high alignment; your Taste matches where the room lands.
- **Outlier** — low alignment; your Taste diverges from the room (a feature, not a flaw).
- **Sharp read** — high accuracy; you predict the room well regardless of your own taste.
- **Perceptive contrarian** — high accuracy + low alignment; you call the room correctly even when you personally disagree.
- **Early adopter** — you rated it high before the room caught up.
- **Specialist vs. generalist** — strong in one genre vs. even across many.

This identity payoff is cheap (pure copy on top of math we already compute) and is the highest-leverage thing in V1.

## 4. Progression: the career ladder

Everyone starts as a **Fan**. XP from playing drives promotions. Each level is a real unlock and a data moment.

```
Fan → Intern → Stream Team → Marketing → VP → CEO → Mogul
```

(Titles flexible; arc is "enter at the bottom, rise to running your own operation.")

**Key mechanic — diegetic onboarding:** the first promotion (Fan → Intern) *is* the onboarding moment. Once a player has proven they like the game, getting "hired" triggers:
- **Job onboarding** → collect demographics ("new-hire paperwork").
- **Virtual interview** → collect musical taste/genre preferences ("tell us about your taste so we can place you").

This collects the data we need organically, from already-engaged users, wrapped in fiction that makes it feel like progression rather than a survey.

**Rules for diegetic data collection (non-negotiable):**
- Never collect data you don't *immediately and visibly* use for the player's benefit.
- The fiction normalizes *reasonable* asks; it is never cover to extract data a player wouldn't knowingly give. Test: "would the player feel fine if I described this collection plainly?"
- A real, compliant privacy layer exists underneath the fiction: real privacy policy, real consent, honest disclosure of use (including that aggregate data informs artist targeting). Extra caution if any users may be under 18.

Later levels unlock later features (The Bank, signing, etc.) — which turns our build roadmap into the player's progression. Locked features are aspirational, not absent.

## 5. Leagues — the container that does four jobs

Leagues are a lightweight container, **not** a heavy new system. They:
1. **Incentivize invites** — "start your league / invite your friends" is the natural, non-spammy recruit loop.
2. **Create peer leaderboards** — ranking against 8 friends is far more motivating than against 1,000 strangers.
3. **Group content by genre** (later) — a league can map to a genre lane.
4. **Are the monetizable audience unit** (later) — artists buy reach *into* leagues; brands sponsor leagues.

**V1 decision:** ship **shared daily drops** (everyone rates the same song, Wordle-style) with leagues as **social filters** (your friends, your standings) — NOT yet as content containers (per-league/genre drops). This delivers the invite loop + peer leaderboards at near-zero added build cost. Per-league/genre content is a fast-follow once volume makes per-genre samples non-noisy.

## 6. Genre — a derived dimension, not a new object

Every drop is tagged with **one primary genre** (hand-tagged by the curator at MVP scale — human tags are far cleaner than DSP metadata). Every result inherits its drop's genre. Therefore:
- Per-genre scores and rankings = `GROUP BY genre` on existing data. No new object.
- Genre leaderboards = the existing leaderboard + one filter.
- Taste "fingerprint" (per-genre identity) emerges from behavior for free.
- Artist targeting gets **revealed-preference** data (what you engage well with), complementing the **stated-preference** data from the interview.

**Critical discipline:** tag *every drop with genre from drop #1*, even if genre views aren't surfaced in V1. Failing to tag early means genre history can't be reconstructed. Tagging is the only infrastructure cost; the views are deferred optionality preserved for free.

Use a fixed set of ~8–15 top-level genres. One genre per drop in V1. Require a minimum count of genre-tagged results before a user appears on a genre board (small-sample noise control; can be framed as "unlock your genre rank by playing enough in that lane").

## 7. The lean data model (V1)

Four core tables. Almost every "feature" is a *view* on these — prefer derived dimensions over new objects.

**users**
- id, handle, email, recovery_email, phone (optional), invite_code_used
- sms_2fa_consent (bool), sms_marketing_consent (bool, separate + explicit), consent_timestamps
- level (Fan…Mogul), xp, streak_count, streak_last_date
- demographics (collected at Intern onboarding), taste_prefs (collected at interview)
- created_at

**leagues**
- id, name, owner_user_id, created_at
- (membership) league_members: league_id, user_id, joined_at
- (genre mapping + sponsorship fields exist as nullable columns for later, not built in V1)

**drops**
- id, title, artist_name, is_established (bool), home_office_note (the boss's copy)
- smart_link_url, genre (primary, required), tags (optional)
- opens_at, closes_at, resolved_at, room_average (null until resolved)

**results**
- id, user_id, drop_id, taste (1–10), read (0.0–10.0)
- locked_at, accuracy_score (null until resolved), alignment_score (null until resolved), genre (inherited from drop)
- click_logged (bool / timestamp — the smart-link click)

*Two distinct scores, two distinct axes:*
- **accuracy_score** — how close `read` was to `room_average`. The **skill** axis (are you a good forecaster?).
- **alignment_score** — how close `taste` was to `room_average`. The **identity** axis (are you in tune with the room, or an outlier?). Stored so that **higher = more in tune** (low deviation → high alignment); "outlier" is simply low alignment.

These are independent: a player can have high accuracy + low alignment (the perceptive contrarian — "I knew everyone would love it; I personally didn't") or the reverse. Splitting them is what lets the identity labels in §3 be precise rather than muddled.

Views/queries (not new objects): global leaderboard, per-league leaderboard, per-genre leaderboard, user taste fingerprint, identity labels, XP/level state.

## 8. V1 scope — ruthless

**Ships in V1:**
- Invite-gated signup (waitlist + scarcity), **framed as setting up a new email account** (diegetic). The email-service fiction makes the data asks native: a **recovery/backup email** ("so you don't get locked out of your Hitmail") and a **phone number** (framed as 2FA — *and*, with explicit separate consent, daily drop notifications). See §10 for the hard SMS-consent rules.
- **SMS as the core retention channel:** "You've got Hitmail 📩 [deep link]" texts drive daily return (SMS ~98% open vs. email) — this is the product's version of the blinking-light push. Deep links go straight to the day's drop/inbox.
- Shared daily drop with home-office framing + smart link.
- Listen (tracked click) → rate + predict → lock.
- Overnight resolution + accuracy scoring.
- Identity-rich results ("you're an outlier / early adopter / in tune").
- Streak (single best retention mechanic; nearly free).
- Global + within-league ranking.
- Leagues as invite-and-friends container (social filter on shared drops).
- Fan→Intern promotion triggering diegetic onboarding (demographics + taste).
- Shareable result card (the only acquisition surface — earns its place).
- Genre tag on every drop (captured, even if views deferred).
- Admin tool (for the founder) to load + tag drops and trigger resolution.

**Deferred (deliberate later layers — all additive, none require re-architecting):**
- The Bank + Scenes currency.
- The Charts (full standalone leaderboard app).
- Signing / sealed-bid auction / alpha mechanic / discovery royalties.
- The Wire (artist updates / gossip).
- Roster.
- Per-league/genre content delivery.
- Full BlackBerry skeuomorphic aesthetic (capture the *feeling* in V1; build the device world once retention is proven).
- All artist-facing billing + brand sponsorship.

**The MVP's only job:** measure whether people come back. Success = D1/D7 return + streak length. Until that's known, no monetization or deferred layer matters.

## 9. Monetization (timeline-sequenced; NOT in V1)

Revenue is a function of engaged user scale. Prove retention first.

**Artist-facing (small, early, volume):**
Selling **guaranteed reach to real fans** (not "tastemakers," not "guaranteed streams"). Tiered by audience size (in front of 100 / 500 / 1,000 fans). Real clicks to DSPs are the proof of value; resulting streams are organic. Value ladder:
1. Submit (cheap/free entry — funnel).
2. Paid reach placement (guaranteed fans, tiered).
3. Premium showcase (deep pitch: bio, video, photo, personal note, socials).
4. Data report (rating + prediction + the under/over-valuation signal + click-through + segments).
5. The Wire channel (recurring — artist posts promoted updates to fans who rated them).

*Signability = a consequence of performing well in-app, never a paid SKU. Invoice says "showcase / consideration," never "pay to be wagered on."*

**Brand-facing (large, later, relationship — scale-gated):**
A league is a pre-sorted, opted-in, genre-native audience segment. Fits: DSPs, audio brands, festivals, ticketing, music-lifestyle brands.
- **Sponsored leagues / seasons** — brand's name on a container fans are invested in.
- **Sponsored drops** — "today's drop, presented by [brand]," diegetic + labeled.
- **Branded challenges/activations** — brand provides prize (tickets/gear/experiences).
- **Aggregate, anonymized trend insights** — never individual user data.

**Sponsored-league-with-prize (the closed loop):**
Brand funds the prize → solves prize-funding (cost becomes revenue+marketing) → players get a real reason to compete the whole season → brand gets a credible, integrity-backed association. Prizes can be brand *product* (tickets, gear, experiences) rather than cash — cheaper for brand, better for players, lighter compliance.

**Interim before brands exist:** run early seasons with cheap/free status + experience prizes to validate "seasons with prizes drive engagement," then upgrade to brand-funded prizes at scale.

## 10. Legal & integrity guardrails (load-bearing — design in from day one)

These are not optional polish; several mechanics are *only* legal because of them.

**Closed-loop virtual currency (Scenes, when introduced):**
- Earned only by playing; spent only on in-world status/access.
- **Never** purchasable with real money. **Never** cashable out.
- This single rule is what keeps signing/auction/alpha/discovery-royalty mechanics a *skill game* rather than gambling or a financial product. It is the most important rule in the design.

**Prizes / seasons / cash:**
- Ranking is **skill-only**; money/spending can never affect rank. Enforce in the schema, not by remembering to be careful.
- **Free to participate** — any player can compete and win without spending. No paid gate on ranked play or prize eligibility (no consideration → free-entry skill contest, the precedented path).
- Future paid player features (subscription, etc.) must be cosmetic/convenience only — never required to compete, never a ranking advantage.
- Cash prizes require: published official rules before the season, the free-entry path, state registration/bonding awareness above value thresholds (NY/FL notably), 1099s for winners >$600, jurisdiction exclusions. **Lawyer it before announcing.** Do NOT put cash prizes in launch/waitlist marketing yet — launch seasons with status/experience prizes (zero compliance overhead, on-brand), add lawyered free-entry cash later.

**Established-artist framing:**
- Home office talks *about* real artists (true, public news) — never *for* them, never fabricated quotes/endorsements/participation, never implying partnership.
- Be factually accurate about real events. Hand-curated at MVP scale makes this easy.

**Artist placement integrity:**
- Paid placement buys *exposure + an honest rating* — never a *good* rating. Honest scores are the product; juicing them kills the credibility that makes placement worth buying.

**Brand integrity:**
- Sponsorship must stay diegetic + trust-preserving. Brand money must never visibly distort the game (no inflated scores, no bought leaderboards). The audience is sellable *because* it trusts the game.

**Data/privacy:**
- Diegetic collection sits on top of a compliant real layer (policy, consent, disclosure). Aggregate + anonymized only when selling insights. Sharp extra caution for any under-18 users.

**SMS consent (TCPA — high-liability, treat as hard rules):**
- The email-service signup fiction normalizes the phone ask; it must **never obscure what's actually consented to.** Test: would the user, if told plainly, agree they knowingly opted into daily notification texts?
- **2FA/transactional SMS and promotional/notification SMS are separate consent categories.** Collecting a number "for 2FA" then sending daily "come play" texts without a *separate, explicit, affirmative* marketing opt-in is the exact pattern that triggers TCPA suits (statutory $500–$1,500 *per message*).
- Marketing/notification opt-in must be a distinct affirmative choice (no pre-checked boxes, no burying it in the 2FA ask). Friendly framing is fine ("📩 Get a text when your daily Hitmail arrives") as long as it's its own clear consent.
- Disclose near the opt-in: message frequency (daily), msg/data rates apply, STOP-to-unsubscribe + HELP. Honor STOP instantly; keep consent records.
- Requires **A2P 10DLC registration** (carrier process for app-to-person SMS) before sending at volume — start early, approval isn't instant.
- Own the SMS deep-link/short-link layer (like the smart link) for reliable deep-linking into specific drops and for the click telemetry (SMS-tap-into-drop is a prime engagement signal).

**Streams language:**
- Sell *guaranteed reach to real fans* + *real click-throughs*, never *guaranteed streams* (the latter reads as bot/artificial streaming, which DSPs police and which contradicts the brand). "Every listen is a real fan who chose to hit play" is the pitch.

## 11. Build & launch sequencing

1. **Branding + waitlist landing page first** (ship in ~days–1 week). Internship-application framing ("apply to the label"), position-on-list number, referral-to-move-up (pre-launch viral loop), email/SMS capture. Doubles as cheapest concept validation — if people won't join the waitlist, the loop doesn't matter yet.

   **Waitlist confirmation + SMS opt-in (reference copy — single combined consent, covers approval text + daily drops honestly):**
   > *Your account is set up. You're **#433 in line.***
   > *Want a text the moment you're approved — plus a heads-up when your daily Hitmail arrives? Tap to turn on messages.*
   > **[ 📩 Text me ]**
   > *Daily-ish. Msg & data rates apply. Reply STOP to opt out, HELP for help.*

   The affirmative tap **is** the consent (no pre-checked state; log it with timestamp). The disclosure line ("plus a heads-up when your daily Hitmail arrives") is what makes this one consent legitimately cover both the transactional approval text *and* the daily marketing drops — without it, the approval-only framing can't carry daily promo. The fine print (frequency, rates, STOP/HELP) is required, not optional.

   **Approval text = your single best activation moment.** When a user clears the waitlist: "🎉 You're in. Your first Hitmail is waiting → [deep link]" — highest-open-rate beat in the funnel, dropping them straight into the loop the instant they're eligible. Design it deliberately.

2. **V1 game loop in parallel** (~2–4 weeks, vibe-coded with Claude Code / Codex). Real web app stack (e.g. Next.js + Postgres/Supabase + scheduled job for resolution + Vercel). The two pieces needing care: the overnight resolution job (timezones, streak edge cases) and click-logging.
3. Launch V1 into the waiting waitlist audience.
4. Measure D1/D7 + streak. Only then add deferred layers, in the order the data justifies.

**Smart link / click logging is core even at V1** — own the redirect+log layer (don't bury it in a third party); the click is both your best engagement signal and your future sellable metric.

## 12. The north star, restated

The entire business is a function of **one number: engaged retention.** If the daily loop retains like Wordle, the revenue math (artists → brands → sponsored seasons) follows mechanically and the TAM conversation becomes real. If it doesn't, no monetization, league, or auction saves it. The MVP exists to find that number cheaply. Build the loop, prove the return, then layer the world on top.
