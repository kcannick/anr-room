# The evening clock — A&R Daily schedule (2026-10-16)

The daily drop moves from a 3:00 PM ET open to a **6:00 PM ET open**. Everything downstream
moves with it. This page is the schedule, the reasoning, and the deploy checklist.

## The schedule

| Hours after open | ET time | What happens | Who is told |
|---|---|---|---|
| −1 | 5:00 PM | Review site locks the day's track list and pushes the drop | — (Drupal's side, see below) |
| 0 | **6:00 PM** | Drop opens | A&Rs: "voting is open" email (`daily_open`) |
| +6 | midnight | Completion bonus steps 100 → 75 | shown on /daily |
| +16 | 10:00 AM | Bonus steps 75 → 50 | shown on /daily |
| +21 | 3:00 PM | Bonus steps 50 → 25 | shown on /daily |
| 24 | **6:00 PM next day** | Voting closes and tallies. The next drop opens at the same moment. | Artists whose record was rated: heads-up email + SMS (inside the 10AM–10:30PM text window) |
| 40 | 10:00 AM | Daily Countdown graphics render; the Asana post task is made | Operator (Asana) |
| 66 | **12:00 PM** | Results publish: seal lifts on /daily, A&R digest, artist Track Reports, makinitmag callback | A&Rs who rated (digest), artists (report), Drupal |

Three drops are in flight at any moment. The Wednesday show (7:00 PM ET) now starts an hour
after that day's drop opens, so the open email is the show's warm-up rather than a separate
afternoon event. The weekly update (Wednesday 1:00 PM ET) and the Monday–Sunday week by
`drop_day` are unchanged.

## Why 6 PM

Six weeks of production votes (40 drops, Sept 2 – Oct 15, about 4,000 ratings):

- **A&Rs rate when the open email lands, not at a natural hour.** Under the noon open the busiest
  hours were 12–1 PM; when the open moved to 3 PM the peak moved to 3–5 PM. Since Oct 1, 46% of
  a day's raters start within three hours of the open (33% under noon).
- **The only time people come on their own is 7–11 PM ET.** It shows up under both schedules.
  Nothing happens 11 PM–10 AM.
- **The audience is about 70% Eastern, 20% Central.** A 3 PM ET open landed at 2 PM Central and
  noon Pacific, mid-workday. 6 PM ET is 5 PM Central and 3 PM Pacific.
- **A deadline bump at noon–3 PM** the next day came from the digest's "today's records close
  at 3:00 PM" line. That line is computed live and now reads "6:00 PM ET — in 6 hours".
- Outside research agrees on the direction: push and app engagement peaks 6–9 PM; Spotify's
  hourly listening peaks at 4 PM and 8 PM. Nothing music-audience-specific exists.
- 7 PM was ruled out because it collides with the Wednesday show.

Day of the week matters more than the hour: average raters per drop by the day it opens were
Wednesday 20, Monday 17, Thursday 16, Tuesday 15, Sunday 15, Saturday 14, Friday 13. If drop
size ever varies, put the paid records on Monday–Thursday.

**Treat this as a two-week test** (Monday to Sunday twice). Compare raters per drop and the
share who start within three hours against the last two weeks of October. The October rise in
raters (about 10 to about 21 per drop) coincided with the email engagement gate and new signups,
not with the 3 PM move, so the 3 PM slot was never shown to work on its own.

## Bonus steps

The old steps were 6 / 12 / 18 hours. With a 6 PM open the 12-hour step would fall at 6 AM,
inside the dead zone, so it would pay nobody the 18-hour step did not. The new steps are
**6 / 16 / 21 hours**: 100 by midnight, 75 by 10 AM, 50 by 3 PM, 25 before the 6 PM close.

## Deploy checklist

1. Deploy. Migration 048 deletes the stored 2026-09-27 times so the new defaults apply.
2. **Open the platform panel → System settings → A&R Daily schedule and press Save once.**
   The save re-stamps every cold drop's window. The drop that is open at deploy keeps the window
   it started with (it closes at 3 PM as announced); the first 6 PM open is the next cold day.
3. **makinitmag (Drupal):** the noon/3 PM lock-in on the review site moves to **5:00 PM ET**,
   and the daily push should fire then. The ingest refuses days more than three out, so the
   push time is the only thing to move. This is outside this repository.
4. Tell the A&Rs once: the open email itself says the time, and the landing and daily pages read
   it off the API, so no copy edit is needed anywhere public.

## What did not change

- The 24-hour window, the noon results time, the Monday–Sunday week, the Wednesday show and the
  weekly update time.
- The seal: results stay sealed until the noon publish.
- The artist SMS window (10 AM – 10:30 PM ET); the 6 PM heads-up sits inside it.
