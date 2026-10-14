# Session naming by release date — rename table

Status: PROPOSAL for the session renames (not applied). Rebuilt 2026-10-14 from a read-only
list of production sessions. Replaces the close-date proposal of 2026-10-03.

## The rule (operator, 2026-10-14)

A daily set is named for its **RELEASE date**, the day its countdown is posted. The drop
opens two days before: a full day for A&Rs to review, then a full day to prepare the
announcement.

| Step | Day and time (ET) | Example |
|---|---|---|
| Drop opens | release day − 2, 3:00 PM | Wed Oct 14 |
| Voting closes | release day − 1, 3:00 PM | Thu Oct 15 |
| Prep day | release day − 1 → release day | Thu → Fri |
| Release (countdown posted) | release day, 3:00 PM | **Fri Oct 16** |
| Internal session name | | **Daily Drop - Oct 16, 2026** |
| Public title | | **Makin' It Daily Countdown** / **October 16th Results** |

This is the timing production runs on today (`stream_at` = close + 1 day, 3:00 PM). Results
(the seal lifting on /daily, the A&R email, the Track Reports) still go out the day after
release, at noon (`results_at` = close + 2 days). See the open question below.

Older sets released on the day they closed (the clock before 2026-10-01), so their name is
their close date. Live sessions take the date they ran.

Every surface prints this one date. Open and close appear only as labelled times
("closes tomorrow at 3:00 PM").

## Series (as in production since 2026-10-11)

| Series | Holds |
|---|---|
| BETA (closed) | the 75 sessions that closed before Mon Sep 28, numbered Show 1 – Show 75 |
| Series 2 (active) | from the drop that opened Sep 27 onward |

## Open question

**Should results go out at release?** Today the countdown posts Friday 3:00 PM and results
follow Saturday at noon. Moving `daily_results_days` to 1 and `daily_results_min` to 3:00 PM
on the platform panel would make release one moment. It is a setting, not code.

## Sessions

| Opened | Closed | Released | Type | Records | Name now | Series | Name after | Series after |
|---|---|---|---|---|---|---|---|---|
| 2026-07-01 | 2026-07-01 | 2026-07-01 | Live | 11 | Weekly Music Review | BETA | **Show 1 — Weekly Music Review - Jul 1, 2026** | BETA |
| 2026-07-03 | 2026-07-03 | 2026-07-03 | Live | 6 | Daily Review | BETA | **Show 2 — Live Review - Jul 3, 2026** | BETA |
| 2026-07-04 | 2026-07-04 | 2026-07-04 | Live | 10 | Daily Review | BETA | **Show 3 — Live Review - Jul 4, 2026** | BETA |
| 2026-07-04 | 2026-07-04 | 2026-07-04 | Live | 16 | Daily Review - 7/4/26 | BETA | **Show 4 — Live Review - Jul 4, 2026** | BETA |
| 2026-07-05 | 2026-07-05 | 2026-07-05 | Live | 16 | Daily Review - 7/5/26 | BETA | **Show 5 — Live Review - Jul 5, 2026** | BETA |
| 2026-07-06 | 2026-07-06 | 2026-07-06 | Live | 16 | Daily Review - 7/6/26 | BETA | **Show 6 — Live Review - Jul 6, 2026** | BETA |
| 2026-07-07 | 2026-07-07 | 2026-07-07 | Live | 18 | Daily Review - 7/7/26 | BETA | **Show 7 — Live Review - Jul 7, 2026** | BETA |
| 2026-07-08 | 2026-07-08 | 2026-07-08 | Live | 13 | Weekly Music Review | BETA | **Show 8 — Weekly Music Review - Jul 8, 2026** | BETA |
| 2026-07-09 | 2026-07-09 | 2026-07-09 | Live | 7 | Daily Review - 7/9/26 | BETA | **Show 9 — Live Review - Jul 9, 2026** | BETA |
| 2026-07-11 | 2026-07-11 | 2026-07-11 | Live | 16 | Daily Review - 7/11/26 | BETA | **Show 10 — Live Review - Jul 11, 2026** | BETA |
| 2026-07-12 | 2026-07-12 | 2026-07-12 | Live | 16 | Daily Review - 7/12/26 | BETA | **Show 11 — Live Review - Jul 12, 2026** | BETA |
| 2026-07-13 | 2026-07-13 | 2026-07-13 | Live | 22 | Daily Review - 7/13/26 | BETA | **Show 12 — Live Review - Jul 13, 2026** | BETA |
| 2026-07-14 | 2026-07-14 | 2026-07-14 | Live | 19 | Daily Review - 7/14/26 | BETA | **Show 13 — Live Review - Jul 14, 2026** | BETA |
| 2026-07-15 | 2026-07-15 | 2026-07-15 | Live | 18 | Daily Review - 7/15/26 | BETA | **Show 14 — Live Review - Jul 15, 2026** | BETA |
| 2026-07-16 | 2026-07-16 | 2026-07-16 | Live | 18 | Daily Review - 7/16/26 | BETA | **Show 15 — Live Review - Jul 16, 2026** | BETA |
| 2026-07-17 | 2026-07-17 | 2026-07-17 | Live | 16 | Daily Review - 7/17/26 | BETA | **Show 16 — Live Review - Jul 17, 2026** | BETA |
| 2026-07-18 | 2026-07-18 | 2026-07-18 | Live | 17 | Daily Review - 7/18/26 | BETA | **Show 17 — Live Review - Jul 18, 2026** | BETA |
| 2026-07-19 | 2026-07-19 | 2026-07-19 | Live | 16 | Daily Review - 7/19/26 | BETA | **Show 18 — Live Review - Jul 19, 2026** | BETA |
| 2026-07-20 | 2026-07-20 | 2026-07-20 | Live | 16 | Daily Review - 7/20/26 | BETA | **Show 19 — Live Review - Jul 20, 2026** | BETA |
| 2026-07-21 | 2026-07-21 | 2026-07-21 | Live | 16 | Daily Review - 7/21/26 | BETA | **Show 20 — Live Review - Jul 21, 2026** | BETA |
| 2026-07-22 | 2026-07-22 | 2026-07-22 | Live | 18 | Daily Review - 7/22/26 | BETA | **Show 21 — Live Review - Jul 22, 2026** | BETA |
| 2026-07-23 | 2026-07-23 | 2026-07-23 | Live | 16 | Daily Review - 7/23/26 🎂🎈 | BETA | **Show 22 — Live Review - Jul 23, 2026** | BETA |
| 2026-07-24 | 2026-07-24 | 2026-07-24 | Live | 16 | Daily Review - 7/24/26 | BETA | **Show 23 — Live Review - Jul 24, 2026** | BETA |
| 2026-07-25 | 2026-07-25 | 2026-07-25 | Live | 16 | Daily Review - 7/25/26 | BETA | **Show 24 — Live Review - Jul 25, 2026** | BETA |
| 2026-07-26 | 2026-07-26 | 2026-07-26 | Live | 4 | ATL Record Pool | BETA | **Show 25 — ATL Record Pool - Jul 26, 2026** | BETA |
| 2026-07-27 | 2026-07-27 | 2026-07-27 | Live | 16 | Daily Review - 7/27/26 | BETA | **Show 26 — Live Review - Jul 27, 2026** | BETA |
| 2026-07-28 | 2026-07-28 | 2026-07-28 | Live | 16 | Daily Review - 7/28/26 | BETA | **Show 27 — Live Review - Jul 28, 2026** | BETA |
| 2026-07-29 | 2026-07-29 | 2026-07-29 | Live | 17 | Daily Review - 7/29/26 | BETA | **Show 28 — Live Review - Jul 29, 2026** | BETA |
| 2026-07-30 | 2026-07-30 | 2026-07-30 | Live | 17 | Daily Review - 7/30/26 | BETA | **Show 29 — Live Review - Jul 30, 2026** | BETA |
| 2026-07-31 | 2026-07-31 | 2026-07-31 | Live | 17 | Daily Review - 7/31/26 | BETA | **Show 30 — Live Review - Jul 31, 2026** | BETA |
| 2026-08-01 | 2026-08-01 | 2026-08-01 | Live | 16 | Daily Review - 8/1/26 | BETA | **Show 31 — Live Review - Aug 1, 2026** | BETA |
| 2026-08-02 | 2026-08-02 | 2026-08-02 | Live | 16 | Daily Review - 8/2/26 | BETA | **Show 32 — Live Review - Aug 2, 2026** | BETA |
| 2026-08-04 | 2026-08-04 | 2026-08-03 | Live | 17 | Daily Review - 8/3/26 | BETA | **Show 33 — Live Review - Aug 3, 2026** | BETA |
| 2026-08-04 | 2026-08-04 | 2026-08-04 | Live | 16 | Daily Review - 8/4/26 | BETA | **Show 34 — Live Review - Aug 4, 2026** | BETA |
| 2026-08-06 | 2026-08-06 | 2026-08-06 | Live | 16 | Daily Review - 8/6/26 | BETA | **Show 35 — Live Review - Aug 6, 2026** | BETA |
| 2026-08-07 | 2026-08-07 | 2026-08-07 | Live | 16 | Daily Review - 8/7/26 | BETA | **Show 36 — Live Review - Aug 7, 2026** | BETA |
| 2026-08-08 | 2026-08-08 | 2026-08-08 | Live | 16 | Daily Review - 8/8/26 | BETA | **Show 37 — Live Review - Aug 8, 2026** | BETA |
| 2026-08-09 | 2026-08-09 | 2026-08-09 | Live | 16 | Daily Review - 8/9/26 | BETA | **Show 38 — Live Review - Aug 9, 2026** | BETA |
| 2026-08-10 | 2026-08-10 | 2026-08-10 | Live | 16 | Daily Review - 8/10/26 | BETA | **Show 39 — Live Review - Aug 10, 2026** | BETA |
| 2026-08-11 | 2026-08-11 | 2026-08-11 | Live | 16 | Daily Review - 8/11/26 | BETA | **Show 40 — Live Review - Aug 11, 2026** | BETA |
| 2026-08-12 | 2026-08-12 | 2026-08-12 | Live | 10 | Daily Review - 8/12/26 | BETA | **Show 41 — Live Review - Aug 12, 2026** | BETA |
| 2026-08-13 | 2026-08-13 | 2026-08-13 | Live | 12 | Daily Review - 8/13/26 | BETA | **Show 42 — Live Review - Aug 13, 2026** | BETA |
| 2026-08-15 | 2026-08-15 | 2026-08-15 | Live | 10 | Daily Review - 8/15/26 | BETA | **Show 43 — Live Review - Aug 15, 2026** | BETA |
| 2026-08-16 | 2026-08-16 | 2026-08-16 | Live | 10 | Daily Review - 8/16/26 | BETA | **Show 44 — Live Review - Aug 16, 2026** | BETA |
| 2026-08-17 | 2026-08-17 | 2026-08-17 | Live | 10 | Daily Review - 8/17/26 | BETA | **Show 45 — Live Review - Aug 17, 2026** | BETA |
| 2026-08-18 | 2026-08-18 | 2026-08-18 | Live | 3 | Daily Review - 8/18/26 | BETA | **Show 46 — Live Review - Aug 18, 2026** | BETA |
| 2026-08-20 | 2026-08-20 | 2026-08-20 | Live | 2 | Daily Review - 8/20/26 | BETA | **Show 47 — Live Review - Aug 20, 2026** | BETA |
| 2026-08-21 | 2026-08-21 | 2026-08-21 | Live | 5 | Daily Review - 8/21/26 | BETA | **Show 48 — Live Review - Aug 21, 2026** | BETA |
| 2026-08-24 | 2026-08-24 | 2026-08-24 | Live | 10 | Daily Review - 8/24/26 | BETA | **Show 49 — Live Review - Aug 24, 2026** | BETA |
| 2026-08-25 | 2026-08-25 | 2026-08-25 | Live | 4 | Daily Review - 8/25/2026 | BETA | **Show 50 — Live Review - Aug 25, 2026** | BETA |
| 2026-08-26 | 2026-08-26 | 2026-08-26 | Live | 10 | Daily Review - 8/26/2026 | BETA | **Show 51 — Live Review - Aug 26, 2026** | BETA |
| 2026-08-27 | 2026-08-27 | 2026-08-27 | Live | 7 | Daily Review - 8/27/2026 | BETA | **Show 52 — Live Review - Aug 27, 2026** | BETA |
| 2026-08-28 | 2026-08-28 | 2026-08-28 | Live | 1 | Daily Review - 8/28/2026 | BETA | **Show 53 — Live Review - Aug 28, 2026** | BETA |
| 2026-09-02 | 2026-09-03 | 2026-09-03 | Daily | 5 | A&R Daily — 2026-09-02 | BETA | **Show 54 — Daily Drop - Sep 3, 2026** | BETA |
| 2026-09-03 | 2026-09-03 | 2026-09-03 | Live | 14 | A&R Room Takeover with Tasha Scott | BETA | **Show 55 — A&R Room Takeover with Tasha Scott - Sep 3, 2026** | BETA |
| 2026-09-03 | 2026-09-04 | 2026-09-04 | Daily | 6 | A&R Daily — 2026-09-03 | BETA | **Show 56 — Daily Drop - Sep 4, 2026** | BETA |
| 2026-09-04 | 2026-09-05 | 2026-09-05 | Daily | 5 | A&R Daily — 2026-09-04 | BETA | **Show 57 — Daily Drop - Sep 5, 2026** | BETA |
| 2026-09-09 | 2026-09-10 | 2026-09-10 | Daily | 5 | A&R Daily — Sep 9 | BETA | **Show 58 — Daily Drop - Sep 10, 2026** | BETA |
| 2026-09-10 | 2026-09-11 | 2026-09-11 | Daily | 8 | A&R Daily — Sep 10 | BETA | **Show 59 — Daily Drop - Sep 11, 2026** | BETA |
| 2026-09-11 | 2026-09-12 | 2026-09-12 | Daily | 8 | A&R Daily — Sep 11 | BETA | **Show 60 — Daily Drop - Sep 12, 2026** | BETA |
| 2026-09-12 | 2026-09-13 | 2026-09-13 | Daily | 8 | A&R Daily — Sep 12 | BETA | **Show 61 — Daily Drop - Sep 13, 2026** | BETA |
| 2026-09-13 | 2026-09-14 | 2026-09-14 | Daily | 8 | A&R Daily — Sep 13 | BETA | **Show 62 — Daily Drop - Sep 14, 2026** | BETA |
| 2026-09-14 | 2026-09-15 | 2026-09-15 | Daily | 8 | A&R Daily — Sep 14 | BETA | **Show 63 — Daily Drop - Sep 15, 2026** | BETA |
| 2026-09-15 | 2026-09-16 | 2026-09-16 | Daily | 8 | A&R Daily — Sep 15 | BETA | **Show 64 — Daily Drop - Sep 16, 2026** | BETA |
| 2026-09-16 | 2026-09-17 | 2026-09-17 | Daily | 8 | A&R Daily — Sep 16 | BETA | **Show 65 — Daily Drop - Sep 17, 2026** | BETA |
| 2026-09-17 | 2026-09-18 | 2026-09-18 | Daily | 8 | A&R Daily — Sep 17 | BETA | **Show 66 — Daily Drop - Sep 18, 2026** | BETA |
| 2026-09-18 | 2026-09-19 | 2026-09-19 | Daily | 8 | A&R Daily — Sep 18 | BETA | **Show 67 — Daily Drop - Sep 19, 2026** | BETA |
| 2026-09-19 | 2026-09-20 | 2026-09-20 | Daily | 8 | A&R Daily — Sep 19 | BETA | **Show 68 — Daily Drop - Sep 20, 2026** | BETA |
| 2026-09-20 | 2026-09-21 | 2026-09-21 | Daily | 8 | A&R Daily — Sep 20 | BETA | **Show 69 — Daily Drop - Sep 21, 2026** | BETA |
| 2026-09-21 | 2026-09-22 | 2026-09-22 | Daily | 8 | A&R Daily — Sep 21 | BETA | **Show 70 — Daily Drop - Sep 22, 2026** | BETA |
| 2026-09-22 | 2026-09-23 | 2026-09-23 | Daily | 8 | A&R Daily — Sep 22 | BETA | **Show 71 — Daily Drop - Sep 23, 2026** | BETA |
| 2026-09-23 | 2026-09-24 | 2026-09-24 | Daily | 8 | A&R Daily — Sep 23 | BETA | **Show 72 — Daily Drop - Sep 24, 2026** | BETA |
| 2026-09-24 | 2026-09-25 | 2026-09-25 | Daily | 8 | A&R Daily — Sep 24 | BETA | **Show 73 — Daily Drop - Sep 25, 2026** | BETA |
| 2026-09-25 | 2026-09-26 | 2026-09-26 | Daily | 8 | A&R Daily — Sep 25 | BETA | **Show 74 — Daily Drop - Sep 26, 2026** | BETA |
| 2026-09-26 | 2026-09-27 | 2026-09-27 | Daily | 8 | A&R Daily — Sep 26 | BETA | **Show 75 — Daily Drop - Sep 27, 2026** | BETA |
| 2026-09-27 | 2026-09-28 | 2026-09-28 | Daily | 8 | A&R Daily — Sep 27 | Series 2 | **Daily Drop - Sep 28, 2026** | Series 2 |
| 2026-09-28 | 2026-09-29 | 2026-09-29 | Daily | 8 | A&R Daily — Sep 28 | Series 2 | **Daily Drop - Sep 29, 2026** | Series 2 |
| 2026-09-29 | 2026-09-30 | 2026-09-30 | Daily | 8 | A&R Daily — Sep 29 | Series 2 | **Daily Drop - Sep 30, 2026** | Series 2 |
| 2026-09-30 | 2026-10-01 | 2026-10-01 | Daily | 8 | A&R Daily — Sep 30 | Series 2 | **Daily Drop - Oct 1, 2026** | Series 2 |
| 2026-10-01 | 2026-10-02 | 2026-10-03 | Daily | 8 | A&R Daily — Oct 1 | Series 2 | **Daily Drop - Oct 3, 2026** | Series 2 |
| 2026-10-02 | 2026-10-03 | 2026-10-04 | Daily | 8 | A&R Daily — Oct 2 | Series 2 | **Daily Drop - Oct 4, 2026** | Series 2 |
| 2026-10-03 | 2026-10-04 | 2026-10-05 | Daily | 8 | A&R Daily — Oct 3 | Series 2 | **Daily Drop - Oct 5, 2026** | Series 2 |
| 2026-10-04 | 2026-10-05 | 2026-10-06 | Daily | 7 | A&R Daily — Oct 4 | Series 2 | **Daily Drop - Oct 6, 2026** | Series 2 |
| 2026-10-05 | 2026-10-06 | 2026-10-07 | Daily | 5 | A&R Daily — Oct 5 | Series 2 | **Daily Drop - Oct 7, 2026** | Series 2 |
| 2026-10-06 | 2026-10-07 | 2026-10-08 | Daily | 5 | A&R Daily — Oct 6 | Series 2 | **Daily Drop - Oct 8, 2026** | Series 2 |
| 2026-10-07 | 2026-10-08 | 2026-10-09 | Daily | 7 | A&R Daily — Oct 7 | Series 2 | **Daily Drop - Oct 9, 2026** | Series 2 |
| 2026-10-08 | 2026-10-09 | 2026-10-10 | Daily | 7 | A&R Daily — Oct 8 | Series 2 | **Daily Drop - Oct 10, 2026** | Series 2 |
| 2026-10-09 | 2026-10-10 | 2026-10-11 | Daily | 6 | A&R Daily — Oct 9 | Series 2 | **Daily Drop - Oct 11, 2026** | Series 2 |
| 2026-10-10 | 2026-10-11 | 2026-10-12 | Daily | 5 | A&R Daily — Oct 10 | Series 2 | **Daily Drop - Oct 12, 2026** | Series 2 |
| 2026-10-11 | 2026-10-12 | 2026-10-13 | Daily | 6 | A&R Daily — Oct 11 | Series 2 | **Daily Drop - Oct 13, 2026** | Series 2 |
| 2026-10-12 | 2026-10-13 | 2026-10-14 | Daily | 6 | A&R Daily — Oct 12 | Series 2 | **Daily Drop - Oct 14, 2026** | Series 2 |
| 2026-10-13 | 2026-10-14 | 2026-10-15 | Daily | 8 | A&R Daily — Oct 13 | Series 2 | **Daily Drop - Oct 15, 2026** | Series 2 |
| 2026-10-14 | 2026-10-15 | 2026-10-16 | Daily | 8 | A&R Daily — Oct 14 | Series 2 | **Daily Drop - Oct 16, 2026** | Series 2 |
