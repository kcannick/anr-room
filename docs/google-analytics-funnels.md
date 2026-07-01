# Google Analytics (GA4) — setup & funnels

How analytics is wired into The A&R Room, and how to build the funnels that matter
(acquisition → registration → voting → qualification, plus the submission funnel).

Audience: the operator. Everything code-side is already built; the rest is a few
one-time clicks in the GA4 UI.

---

## 1. Turn it on (one-time)

Analytics is **env-gated and off by default** — it does nothing in dev/preview or until
you set the ID in production.

1. Create a **GA4 property** at [analytics.google.com](https://analytics.google.com) →
   Admin → Create property. Add a **Web data stream** for `anr.makinitmag.com`.
   Copy the **Measurement ID** — it looks like `G-XXXXXXXXXX`.
2. In **Vercel** → the `anr-room` project → **Settings → Environment Variables**, add:
   - `GA_MEASUREMENT_ID` = `G-XXXXXXXXXX`  (scope: Production)
3. **Redeploy** (env changes only apply to a new deployment — same gotcha as `INGEST_TOKEN`).
   Ask Claude to push a redeploy, or use Vercel's Deployments → ⋯ → Redeploy.

**How it works:** every public page loads `<script async src="/analytics.js">`. The server
generates that file from `GA_MEASUREMENT_ID` (GA4's standard gtag bootstrap). With no ID set
it returns a harmless no-op, so nothing tracks until you're ready.

**Where it runs:** the public pages only — **home, play (voting), join, profile**.
Deliberately **not** admin or overlay (those are host/OBS surfaces and would pollute the
audience data).

**Verify it's live:** open the site, then GA4 → **Reports → Realtime** — you should see
yourself as an active user within ~30s. (Or `curl https://anr.makinitmag.com/analytics.js`
— it should contain your `G-` id, not the "disabled" comment.)

---

## 2. What's already tracked

### Automatic (GA4 enhanced measurement)
`page_view`, `first_visit`, `session_start`, `user_engagement`, scrolls, outbound clicks —
on every public page, no code needed.

> Note: the voting page (`play`) is a single page that swaps *screens* (join → wait → vote →
> results) without navigating, so it fires **one** `page_view` on load. The in-page
> progression is captured by the **custom events** below, which is what the funnels use.

### Custom engagement events (already firing)

| Event | Fires when… | Parameters | Page |
|-------|-------------|------------|------|
| `register_click` | taps "Register to play" on the homepage | `from: home` | home |
| `session_register` | becomes a participant in a session | `method: account` \| `otp` | play |
| `vote_locked` | locks in a vote | `poll_type: rating` \| `binary` | play |
| `profile_complete` | profile crosses into "complete" (name+category+location) | `where: play` \| `join` \| `edit` | play, join |
| `account_signup` | creates a new A&R account (new accounts only) | `where: join` | join |
| `music_submit_click` | taps a "submit music" link / Share | `action: link` \| `share` | home |

All fire through a safe `track()` helper — if analytics is disabled they're silent no-ops.

---

## 3. Make the key events count (GA4 UI, one-time)

Custom events show up automatically, but two quick setup steps make them usable in reports
and funnels.

### a) Mark conversions ("Key events")
GA4 → **Admin → Key events** (formerly "Conversions") → **New key event** → type the exact
event name. Recommended to mark:
- `session_register` — the core conversion (someone joined a session)
- `vote_locked` — real engagement
- `account_signup` — audience growth
- `profile_complete` — qualification (prize/leaderboard eligibility)

(You can also toggle "Mark as key event" next to any event in **Reports → Engagement →
Events** once it has data.)

### b) Register the parameters as dimensions
So you can filter/segment by `poll_type`, `method`, etc.:
GA4 → **Admin → Custom definitions → Create custom dimensions**. For each, scope = **Event**:

| Dimension name | Event parameter |
|----------------|-----------------|
| Poll type | `poll_type` |
| Register method | `method` |
| Profile source | `where` |
| Submit action | `action` |

> Custom dimensions only apply going forward (not retroactively), so set them up early.

Events can take **up to 24h** to appear in standard reports. To see them **immediately**,
use **DebugView** (Admin → DebugView) or the **Realtime** report.

---

## 4. Build the funnels (Explore → Funnel exploration)

GA4 → **Explore** (left nav) → **Funnel exploration** template. Set the date range, then add
**Steps** — for each step, dimension = **Event name**, and pick the event. Toggle
**"Make open funnel"** off for a strict funnel (each step must follow the previous), or on to
count anyone who did the step regardless of order.

Here are the funnels worth building for this product.

### Funnel A — Homepage → playing (the core show funnel)
Measures how many homepage visitors actually end up voting.
1. `page_view` — filter: page location contains `makinitmag.com/` (homepage)
2. `register_click`
3. `session_register`
4. `vote_locked`

*Drop-off between 2→3 = link/OTP friction; 3→4 = registered but didn't vote (dead-time or
confusion).*

### Funnel B — Direct link → playing (QR / share / notification traffic)
Most voters arrive on `play` straight from a QR code, share link, or "session is live" text —
skipping the homepage. Measures conversion of that traffic.
1. `page_view` — filter: page location contains `/?s=` (the voting page)
2. `session_register`
3. `vote_locked`

*This is the funnel to watch on show night.*

### Funnel C — Qualification funnel
Of those who register, how many complete their profile (required for leaderboard/prizes)?
1. `session_register`
2. `profile_complete`

*Low completion here = the qualification gate/nudge needs work. Segment by `where` to see
whether people finish it in-room (`play`) vs on the join page.*

### Funnel D — Account signup (join page)
1. `page_view` — filter: page location contains `/join`
2. `account_signup`
3. `profile_complete`

### Funnel E — Submission funnel
How the homepage drives artist submissions (the Drupal `/review` pipeline lives outside GA,
but the intent click is tracked).
1. `page_view` — homepage
2. `music_submit_click`

*Segment by `action` (`link` vs `share`) to see whether people submit directly or share the
link with an artist.*

---

## 5. Handy extras

- **Retention per session:** compare `vote_locked` counts across nights (Reports → Engagement
  → Events → `vote_locked` over time). Votes-per-user is your engagement-depth signal.
- **Rating vs Versus:** in any `vote_locked` report, add the **Poll type** dimension to split
  standard vs A&R-Wars-style rounds.
- **Realtime on show night:** Reports → Realtime shows active users + a live event stream —
  good for watching a session fill up as the "we're live" notifications go out.
- **Consent note:** this is basic GA4 pageview + event analytics with no ad personalization.
  If you ever expand to ads/remarketing or need EU coverage, revisit consent-mode / a cookie
  banner with the attorney. Not required for the current setup.

---

## 6. Where the code lives (for reference)

- **Bootstrap:** `server.js` serves `GET /analytics.js`, generated from `GA_MEASUREMENT_ID`.
- **Includes:** `<script async src="/analytics.js">` in the `<head>` of `home.html`,
  `play.html`, `join.html`, `profile.html`.
- **Events:** a `track(name, params)` helper in each page calls `gtag('event', …)` at the
  moments in the table above. Search the `public/*.html` files for `track(` to see every call
  site. Adding a new event = one `track('my_event', {…})` line at the relevant spot.
