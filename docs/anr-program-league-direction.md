# The A&R Program as a league — direction note

*Operator direction, 2026-10-29 (planning conversation). Supersedes the host-role model of 2026-07-02
in `docs/multi-tenant-roadmap.md`. Nothing here is built. Mockup-first applies to every screen named.*

## The idea, in the operator's words

"I'm thinking of team like a league in fantasy football. Someone can officiate and they have their own
management of their team. So it's a multi-tenant A&R Program. Let's say we have our A&R program we're
running: Makin' It A&R Team, makinit.theanrdepartment.com, and it describes our A&R program. People can
apply, rate songs daily, and based on their accuracy and points eventually get promoted to an actual A&R
on the team. On the makinitmag page there's our logo, description of company, description of our
program: 'We're looking for go getters who have a great taste in music and can help curate concerts,
playlists, and music for our radio station.'"

## The mapping that makes it cheap

In fantasy football the games are shared and every league scores its own members off the same games.

| Fantasy football | The A&R platform |
|---|---|
| The NFL games | **The daily drop.** One drop a day, platform-wide, sourced as it is now. Every A&R in every program rates the same records. Scoring, the seal, points, grades: unchanged. |
| A league | **A program.** A branded page, a roster, a board that is the existing live-computed board filtered to its members, a promotion ladder, applications. |
| The commissioner | **The officiator.** Approves applications, promotes and demotes, posts to members, edits the page. Not a platform admin. |
| ESPN | **The platform owner (Makin' It).** Runs the drop, the HOT 100, the artist reports, the Instagram posts, Brevo and Asana. Those are platform operations, not program features. Makin' It A&R Team is program number one on its own platform, not a special case. |
| One ESPN account, many leagues | **One account, many programs.** Points and grade are the person's and read the same in every program. Rank is per program. |

What this is NOT: a program does not run sessions, source records, or get its own drop. (The host role was
about who runs sessions; the parked 2026-09-10 "teams" idea was team-vs-team scoring. This is neither.)

## What a program is

- **A page** at `<slug>.theanrdepartment.com` (or a path until the domain is set up): logo, company
  description, the program pitch in the commissioner's words, the ladder, the board, Apply.
- **A commissioner** and optional co-managers. They see members' names, grades, points, rounds and rank.
  They do not see other programs' members or anyone's email or phone. They message members through the
  platform.
- **Members.** Membership in one or more programs. A member's points and grade are the same number
  everywhere.
- **A ladder.** Rank names and gates per program, with a platform default (the 2026-10-25 repositioning
  draft: Intern → A&R → Senior → Exec → VP). Gates use the platform's promotion window (the latest 100
  rounds, a grade cut, days played; see `docs/specs/grade-curve-proposal.md`). A commissioner can tighten
  a gate; the measurement is the platform's, so a rank means the same thing in every program.
- **An application.** A few commissioner-defined questions, answered at signup or from the profile.
  Approve or decline.

## What stays the platform's, never a program setting

The drop schedule, the completion bonus, scoring and grade bands, the seal, the HOT 100, the Track
Report, the contact data. A program never gets its members' addresses: the platform keeps the audience
(the thesis from July, kept under a different roof).

## Why the data supports it

Prod, 2026-10-29 (shared-notes analysis): the regulars started only a little more accurate than the people
who quit (first-10-round miss +0.04 vs +0.26 relative to the room), then pulled ahead by playing (0.15–0.20
better than the room by round 50, still improving at 200). A program page with a ladder gives a person
a reason to reach 50 rounds, which is where the improvement is.

## Decisions before a spec

1. Shared drop only, or can a program add its own records later. Recommended: shared only until the first
   outside program has run.
2. Who can create a program: anyone, apply to the platform, or invited. Recommended: invited; Makin' It is
   the first commissioner.
3. The domain. `theanrdepartment.com` with wildcard subdomains = one Vercel domain setting and a tenant
   lookup on the Host header. `anr.makinitmag.com` becomes an alias of the Makin' It program or redirects.
4. Multiple programs per person. Recommended: yes.
5. Money: free, paid per program, or paid above a member count. Nothing in the first build depends on it;
   the page copy does.
6. The ladder gates: the grade-band decision and the promotion window come FIRST, because every program's
   ladder reads them.

## Build order (each step a mockup, then a spec, then code)

1. **Ladder + promotion on the existing site, for Makin' It only.** Needs the grade bands decided. No
   tenants yet.
2. **Tenant model + routing.** `programs` (slug, name, copy, logo, commissioner uid, join mode),
   `program_members (program_id, user_id, rank, joined_at)`, Host-header → program lookup, the page and the
   board scoped by membership. Makin' It is program #1.
3. **Commissioner console:** applications, roster, promote/demote, announcements (through the existing
   notify queue, program-scoped audience), page editor.
4. **A second, outside program** as the proof.

## Not decided

Program prizes (keep off any cash board), whether a program can ever have a private drop, what a program
sees about an applicant before approving (the public profile only, by default), and whether the Makin' It
program page replaces the current landing page or sits beside it.
