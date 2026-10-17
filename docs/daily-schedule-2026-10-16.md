# The evening clock — A&R Daily schedule (operator, 2026-10-17)

The daily drop opens at **6:00 PM ET**, results publish when the Daily Countdown **posts at
6:00 AM** two mornings later, and the emails follow at **3:00 PM**. This page is the schedule,
the reasoning, and the deploy checklist. It supersedes the 69-hour clock of 2026-09-27.

## The chain (Day 1 = the day a drop opens)

| Day | ET time | Event | Who / channel |
|---|---|---|---|
| 1 | 5:00 PM | Review site locks the day's track list and pushes it | makinitmag (Drupal) |
| 1 | 6:00 PM | **Drop opens.** "Voting is open" email | new A&Rs, first 7 days / email |
| 2 | 12:00 AM | Completion bonus steps 100 → 75 | shown on /daily |
| 2 | 10:00 AM | Bonus 75 → 50 | shown on /daily |
| 2 | 3:00 PM | Bonus 50 → 25 | shown on /daily |
| 2 | 6:00 PM | **Voting closes and tallies.** The next drop opens at the same moment. No heads-up to artists. | system |
| 2 | after the tally | Both Instagram carousels render; the Asana post tasks are made. The operator's job schedules both posts in SocialBee for 6:00 AM and 9:00 AM. Nothing is revealed. | system / Asana / SocialBee |
| 3 | 6:00 AM | **Daily Countdown posts** from @makinit4indies (the operator's scheduled job, through SocialBee). @TheAnRTeam and the top 3 artists are collaborators; every artist is tagged on their slide. **This is the publish:** scores appear on /daily and My results, the results callback goes to makinitmag. | public / Instagram |
| 3 | 9:00 AM | **Top A&Rs carousel posts**, collab with the #1 A&R, seven tagged | public / Instagram |
| 3 | 3:00 PM | **Artist email:** the Track Report, to every artist whose record was reviewed | artists / email |
| 3 | 3:00 PM | **A&R email,** one of three: Your results · You missed yesterday's drop · You've missed the last two drops. Each carries the Wednesday show line. | A&Rs / email |
| 3 | 4:00 PM | Brevo sync (the day's new artist top scores) | system |

Two drops are in flight at any moment. The chain is 36 hours from open to publish, 45 to the
emails.

**Weekly:** Wednesday 7:00 PM ET the show. **Thursday noon** the weekly results email to every
subscribed A&R: the results of Wednesday's show, the Top 8 records and A&Rs, the two seats, the
replay link. It used to go Wednesday 1 PM, before the show, to the non-engaged only.

## Why 6 PM

Six weeks of production votes (40 drops, Sept 2 – Oct 15, about 4,000 ratings):

- **A&Rs rate when the open email lands, not at a natural hour.** Under the noon open the busiest
  hours were 12–1 PM; when the open moved to 3 PM the peak moved to 3–5 PM. Since Oct 1, 46% of
  a day's raters start within three hours of the open (33% under noon).
- **The only time people come on their own is 7–11 PM ET.** Nothing happens 11 PM–10 AM.
- **The audience is about 70% Eastern, 20% Central.** 6 PM ET is 5 PM Central, 3 PM Pacific.
- 7 PM was ruled out because it collides with the Wednesday show.
- Day of the week matters more than the hour: raters per drop by the day it opens were
  Wednesday 20, Monday 17, Thursday 16, Tuesday 15, Sunday 15, Saturday 14, Friday 13.

Treat it as a two-week test. Compare raters per drop and the share who start within three hours.

## The emails (operator, 2026-10-17)

- **Artists hear from the program once**, with the Track Report at 3 PM on Day 3, after the
  countdown has posted. The heads-up at the close (email + SMS) is retired; the cron queues none.
  The console's manual send still works.
- **A&Rs get one of three mails** at 3 PM: results (rated this drop), missed a day (rated the
  one before), missed two in a row (rated the one before that). After the third they get no daily
  mail until they rate again. Every one carries the Wednesday show line and link.
- **The weekly results mail** goes Thursday noon to every subscribed A&R. The non-engaged
  narrowing and the four-send sunset are off; an explicit OFF and a bounced address are the only
  ways out.

## The completion bonus

Steps are 6 / 16 / 21 hours: 100 by midnight, 75 by 10 AM, 50 by 3 PM, 25 before the 6 PM close.
Measured over the two October weeks before the change: the bonus was 8–25% of a top-10 total and
the 100-point tier was 68% of what was paid. With a 6 PM open most same-night finishers will take
100, so watch that share; past about 85% the tiers no longer separate the top finishers.

## The Instagram posts

Both carousels go through the Instagram API, which caps a carousel at **10 slides**. The rule:
if cover + one slide per record + the two closing slides fits in 10, everyone keeps their own
slide. Otherwise #3, #2 and #1 keep individual slides and the rest are grouped, four to a slide at
most, from the lowest rank up. Mockup: `public/brand/countdown/group.html` (awaiting approval;
the Satori build follows it).

## Deploy checklist

1. Deploy. Migration 048 deletes the stored 2026-09-27 times so the new defaults apply.
2. **Platform panel → System settings → A&R Daily schedule → Save once.** That re-stamps every
   cold drop. The drop open at deploy keeps the window it started with.
3. **makinitmag (Drupal):** move the review-site lock-in and push to **5:00 PM ET**.
4. **The scheduling job:** runs once each evening after the close (about 7:00 PM ET), reads the
   day's two Asana tasks (slides in order, caption, collaborators, who to tag on which slide, the
   comments) and schedules both posts in SocialBee with their post times set: countdown 6:00 AM
   ET, Top A&Rs 9:00 AM ET on the results day.
