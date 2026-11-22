# Console navigation reorg — status and remaining steps

Mockup: `public/_mock-admin-nav.html` (drawn 2026-10-09, checked against main 2026-10-17).
Status 2026-11-22: **mockup only, not approved, not built.** `admin.html` on main still has the
old two-menu structure (5-button mode switch on Daily/Weekly/Tournaments + a 10-button row on
the room picker, seven "← My rooms" back buttons, Platform as a catch-all).

## The problem (still true on main)
1. Two menus; Charts, Users, Series, Analytics and Sidebet are reachable only from the room picker.
2. "Live show" opens the room picker, which is where the unrelated tools live.
3. Every back button says "← My rooms" though the console opens on A&R Daily.
4. Platform holds banners, the daily schedule, Asana, Brevo, the contact backfill, the mass message, the SMS test.
5. No hash addresses: refresh and browser Back lose your place.
6. Log out in three places.

## The proposal
One always-visible sidebar, grouped by job (Run the show · Results · A&Rs & artists · Settings),
Platform split by purpose, hash addresses (`/admin#weekly`), no back buttons, problems badged in the
sidebar. Front end only (`admin.html`): no server change, no migration, no button changes behaviour.

## Out of date since the mockup — fix the mockup first
- Tournaments retired 2026-10-19 (feature code stays behind a switch): drop or hide the Tournaments page.
- "Top Picks" superseded by **"Pick the Hits"** (2026-11-11), a standalone Service Pack contest.
- The Wednesday live show was deprecated 2026-10-23: re-check whether Live Sessions and the Weekly
  report still earn top-level places, and what the live-on-close-night work (PR #98) adds to Daily Drops.
- Re-check every card against `git show origin/main:public/admin.html` (many PRs since 10-17).

## Steps to finish
1. Refresh the mockup for the points above; send it to the operator.
2. Operator answers: (a) is the grouping approved; (b) do the new names (Daily Drops, Live Sessions,
   Pick the Hits) reach public pages and emails, or only the console; (c) split the session console
   into tabs now or later.
3. On "build it": cut a fresh branch from origin/main and add the sidebar + hash router; route every
   `showScreen()` call through it.
4. Remove the three mode-switch copies, the picker's button row, the "← My rooms" buttons and the
   extra Log outs.
5. Split the Platform screen into its pages (cards move unchanged).
6. Keep hosts limited to Live Sessions + My session defaults.
7. `env -u ASANA_TOKEN npm test` green; verify in the browser on a worktree port (see the
   preview-pane-worktree memory); deliver as a PR.
