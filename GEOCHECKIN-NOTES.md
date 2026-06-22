# Location Check-in — design notes, privacy, and what's deferred

## The two-switch design (why your Saturday works)

"Set the venue" and "enforce check-in" are deliberately **separate**:

- **Venue pin** — set any time, any way: geocode an address (no need to be on-site),
  "use my location," or manual lat/lng. Set the LA venue this week.
- **Check-in mode** (`off | optional | required`) — a separate toggle flipped live.

So: create the session now, geocode the LA address, leave mode `off`. People register
and share in advance. Saturday at the venue, flip mode to `optional` (or `required`).
No need to be on-site to configure anything ahead of time.

## Check-in happens at first lock-in (not at the door)

Everyone rates + predicts freely. The first time a player taps **Lock it in** on a
geofenced session, the server returns `428 checkin_required` and the app shows the
check-in prompt. They share location once; the held vote then locks automatically.

- **optional mode:** in-radius → `in_person`; out-of-radius or "I'm watching remotely"
  → `online`. Both pools play the same event.
- **required mode:** out-of-radius can't lock in (in-room crowd only).

This means there's **no grandfathering problem** — flipping enforcement on doesn't evict
anyone; it just means the next lock-in asks for check-in. Pre-registered remote folks
become the `online` pool naturally.

## Accuracy-aware radius (don't false-reject real attendees)

Browser geolocation is imprecise — often *worse* indoors, i.e. for people actually in
the venue (20–100 m via wifi/cell). So:

- Default radius is **generous (200 yards)**, host-adjustable.
- Admission isn't strict "within X" — a reading is admitted if `distance <= radius`
  OR `(distance - accuracy) <= radius`. A low-confidence reading near the boundary is
  let in. Better to admit a few from the parking lot than reject someone on stage.

## Privacy (built in, not bolted on)

- Precise attendee coordinates are used **only** to compute distance, then **discarded**.
  We persist only `pool` (in_person/online) and a **coarse distance** for your auditing.
  No raw lat/long for any attendee is ever stored or exported (asserted in tests).
- The **venue pin** is stored — it's a place, not a person.
- The check-in prompt states the purpose plainly ("we use it once to check you in — we
  don't store where you are"). Keep this honest; precise location is a regulated
  category (GDPR / CCPA-CPRA sensitive data).

## Honest limitation

This is a **turnstile, not a vault.** A determined user can spoof geolocation; a web app
can't stop that. What it reliably stops is casual remote voting in a live event — which
is the actual crowd-integrity goal. For high-stakes events, the real backstop is the
statistical anomaly detection already noted in the Hitmail docs, not the geofence.

## Geocoding

Uses OpenStreetMap Nominatim (no API key, no billing) server-side. If it's unreachable
or returns no match, the endpoint fails gracefully with a clear message and the host can
use "📍 Use my location" or enter coordinates another way. (Nominatim has a light usage
policy; for heavy production use, swap in a keyed geocoder later — the endpoint is the
only thing that changes.)

## Deferred (documented, not built)

- **Dual-pool leaderboards + the room-vs-online split on the overlay.** The data exists
  now (`pool` on every participant); surfacing "the room says 7.2, the internet says
  5.8" on the overlay and as separate boards is the high-value next step. It's a
  `GROUP BY pool` on data we already capture — no new schema.
- **Re-check / leaving mid-event.** Check-in is once-per-participant by design; we don't
  re-verify if someone leaves. Probably not worth adding.
- **Pool-specific scoring / rewards.** If in-person votes should weight differently or
  win different prizes, that sits on top of `pool` — and any reward angle goes through
  the same non-cash / skill-contest review as the referral and Hitmail items.
