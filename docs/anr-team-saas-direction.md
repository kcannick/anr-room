# The A&R Team product — direction note

*Operator direction, planning conversations of 2026-11-04 and 2026-11-10. Supersedes
`docs/anr-program-league-direction.md` (2026-10-29). Nothing here is built. Mockup-first applies to
every screen named. Vocabulary: "Team", never "league".*

## The idea

The app is an **independent product that lets people manage their own A&R Team**: a pool of people who
do market research on music through the game (rate a record, predict the average, get scored).

**Makin' It is an end user.** It manages its own A&R Team through the product, the same as any other
customer. It is the first customer, not the platform owner in the copy.

## Why

The music review as the product was a race to the bottom: many review sites, each needing promotion.
Artists want to be near successful people, and they are the most motivated recruiters there are. The
research panel, kept active by the game, is the product. The review is one thing a team can sell.

## Two kinds of end user

| | Who | What they want | Status |
|---|---|---|---|
| **Group A** | Artists and labels | Their own focus group: their team rates their records and they get a report | **First build** |
| **Group B** | Organizations (Makin' It is one) | To monetize their team by taking submissions from outside artists | **Pending.** Needs submission intake inside the product |

## Group A: the minimum

1. **A team.** Name, page, owner, join link, roster.
2. **Owner-added records.** The owner puts in their own tracks and opens a session to their team.
3. **The game, unchanged.** Rate, predict, lock in, sealed until results, points and grades.
4. **The report.** The Track Report per record, delivered to the owner.
5. **An owner console.** Records, open and close, roster, results.

### What is reused

Scoring and the seal, grades, the hand-built drop and its lifecycle, private sessions with an access
code (`sessions.visibility`, `access_code`, `owner_uid`, `canAdminSession`), the Track Report, round
comments, notifications and prefs, referral attribution on the join link, the account page.

### What is new

The team entity and membership, team-scoped sessions and boards, the owner console (a cut-down daily
console with no contact data from other teams), the team page, owner onboarding, billing if it is paid.

### What stays Makin' It's own, outside the product core

The review-site push from Drupal, the Daily Countdown and Top A&Rs carousels, SocialBee, Brevo, Asana,
sales leads, the HOT 100, Pick the Hits. In Group B terms these are one customer's submission and
promotion workflow.

## Group B: what it waits on

Submission intake inside the product: a submit form per team, free and paid lanes, payment, the queue
into a drop, the artist's status and report. Today all of that is Makin' It's Drupal site. Not designed.

## Decisions before a spec

1. **Who owns members' contact details.** Since July the rule has been that the platform keeps the
   audience and owners message members through it. An independent product sold to labels points the
   other way. Biggest decision here.
2. **Is there a shared drop.** In this model the daily drop is the Makin' It team's drop. A member of an
   artist's team has nothing to rate between that artist's sessions unless teams can share records.
3. **One account across teams, or one per team.** One account keeps a person's grade portable.
4. **Buying outside raters.** Can an owner pay to have qualified A&Rs from other teams rate their
   records. The gap between a fan average and a qualified average is the strongest finding the product
   can sell, and it depends on decision 3.
5. **Name and domain.** The product cannot carry Makin' It's name if Makin' It is a customer.
6. **Price.** Free, paid per team, paid per session, or paid by member count.
7. **How owners get in.** Hand-onboarded first, self-serve later. Self-serve brings billing, support and
   other people's unreleased music on our servers, against the "tool, not infrastructure" rule.
8. **How a record is heard.** Hosted audio, a private link, or played only on a live stream. Established
   artists will not upload unreleased music without an answer.

## Suggested order

1. Decide 1 to 3 above. They set the data model.
2. Mockups: the team page, the member's first screen, the owner console.
3. Run Group A by hand for two or three owners on today's tooling (private session, hand-built records,
   Track Reports sent to the owner), with the operator as the console.
4. Spec the team model from those cases, then build.
5. Group B intake as its own program of work.

## Earlier steps in the same thread (history)

- **2026-11-04, artist partners.** Artists recruit an A&R Team toward a goal number, members practice on
  the daily drop on probation, and Makin' It runs a $750 Takeover for the artist when the goal is hit.
  Count activated members (registered and rated at least one drop), not signups. Still usable as a
  Makin' It promotion on top of the product.
- **2026-11-04, "no new container".** The artist's team as their referral tree, with no team entity.
  Reversed by the product framing: a managed team needs an owner and a roster.
- **2026-10-29, league model.** Programs as branded pages over one shared drop, with a commissioner.
  Superseded; the tenant ideas (page, roster, scoped board, application) carry over under "Team".
