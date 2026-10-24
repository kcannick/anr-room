# Live sessions: blind results + Takeover mode

> **Saved 2026-10-23 as a draft for later — not approved, not built.** Mockup:
> `public/_mock-live-blind-takeover.html`. Since this was written the $500 prize and the
> tournaments were retired (2026-10-19), so read "Series board (homepage, $500)" as just the
> series board. Takeover email: one per track or one combined is still the operator's choice
> (my recommendation: combined).

Status: DRAFT from the operator's direction of 2026-10-15. Nothing built. Mockups before code.

## 1. Blind results (optional, per session)

**Why:** in a live session each round's average is revealed as soon as it is scored, and the
operator has seen the next votes lean toward what the room just did. Blind results hide every
round's outcome until the end and reveal them all at once.

**Setting:** "Blind results" on the session (create + edit room settings, and as a host
default). Off = today's behaviour. Fits the session states (Upcoming → Live → Closed →
Published): a blind session is Live while records are rated, **Closed** when the host ends
voting (nothing revealed), and **Published** when the host presses **Reveal results**. That
gives the host a moment on stream for the reveal instead of it happening on its own.

**While Live (sealed, server-enforced — the same rule as the daily drop: omit keys, don't null them):**

| Surface | Today | Blind |
|---|---|---|
| Player after a round is scored | the average, their points, their tier | "Locked in. Results at the end of the session." |
| Overlay | the round's result + Top A&Rs board | vote count only; no board until the reveal |
| Leaderboard push on each scored round | sent | held |
| Series board (homepage, $500) | includes the session's points as each round scores | **excludes the session until Published** — otherwise the board's movement leaks the results |
| Host console | averages per round | averages per round — **the host keeps them** (operator, 2026-10-15) |
| Round comments | open | open (already sealed) |

**At the reveal (Published):** every player gets the recap screen with their **score card** and
**round-by-round results** (the daily page's table: rating, guess, average, points); the overlay
runs the final board; the results email/recap goes out as it does today.

**The reveal (operator, 2026-10-15/17): everyone finds out at once, two ways.** The host picks
**Countdown** (one record at a time, below) or **Full list** (every record ranked on one screen,
also usable as the closing screen after a countdown). Countdown detail: Records from
last to first, then the A&Rs. Each Advance reveals the next one on the stream AND on every A&R's
phone at the same moment (pushed over Ably like a ratify), so nobody learns a result from
someone else first. The score card and full round-by-round arrive when the countdown ends.

## 2. Takeover mode

**Why:** a Takeover reviews several records by ONE artist. Today the host retypes the artist on
every record and fills the contact fields every time.

**Setting:** "Takeover" on the session, with the artist set once: name, Instagram, email, phone
(the contact fields the Track Report and artist email already use).

- **Queue form:** only the track title (and play link) is asked for; the artist fields are
  filled from the session and locked.
- **Every round still stores the artist** (copied from the session when it is added), so the
  Track Report, artist email, charts, sales leads and weekly report work unchanged. Editing the
  session's artist updates rounds not yet scored.
- **Session name** follows the naming rule: "Takeover - <Artist> - Oct 21, 2026".
- **Blind results default ON** for a Takeover (operator: "better for Takeover"), changeable.
- **One email per track or one combined email:** both are mocked up for the operator to choose.

## 3. Build order (after mockups)

1. Blind results: the setting, the sealed player/overlay/board, Closed → Reveal results.
2. The reveal screen and the series-board exclusion.
3. Takeover: session artist, title-only queue form, naming.
