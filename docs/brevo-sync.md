# Brevo contact sync

The platform keeps these Brevo lists up to date:

| List | Who | What is sent |
|---|---|---|
| **Artists** (your existing list **119**) | Every artist whose record was played (live shows and the daily drop; reference tracks left out) | Email, phone and their best score (below) — never a name: the name on a submission is whatever was typed |
| **A&Rs** (your existing list **11**) | Every registered account with an email — blocked and opted-out accounts included | Email, phone, first/last name, and the profile (see below) |
| **Side Bet #1, #2, …** (one per sidebet iteration, created automatically) | Everyone who entered that Side Bet | Email only — they are A&Rs, so their profile is already on the contact |

Opt-outs are **not** a filter. Brevo's own unsubscribe governs Brevo's sends. Whether an A&R
has turned off our emails, is blocked, or has SMS consent is sent as data
(`ANR_EMAIL_OPT_OUT`, `ANR_BLOCKED`, `ANR_SMS_CONSENT`), so you can build segments on it in Brevo.

## Setup (once)

1. In Brevo: **Settings → SMTP & API → API keys → Generate a new API key**.
2. In Vercel → anr-room → Settings → Environment Variables: add **`BREVO_API_KEY`** (Production), then redeploy.
3. Console → **Platform** → **Brevo contacts** card → **Sync now**.
   The first press adds the attributes and sends everyone: artists to list **119**, A&Rs to list
   **11**. A **Side Bet #N** list is created (in a folder called **A&R Program**) when that
   iteration's first entrant is synced — numbered by the order the Side Bets were created. It keeps pressing by itself until everything is sent.

After that it runs **once a day** on its own (from the daily cron, after 4 AM ET) and sends only
contacts that are new or have changed. Nobody is ever removed from a list.

To point artists or A&Rs at a different list, type its ID on the card and press **Save** (blank goes back to 119 / 11). A
changed list is sent in full on the next sync.

## Artist score

One number on each artist contact, **`ARTIST_TOP_SCORE`** — the room average of their best
record, one decimal — so good artists can be segmented for select opportunities and
communications (e.g. `ARTIST_TOP_SCORE` ≥ 6).

**Ratings floor (default 5):** a record counts only if at least this many A&Rs rated it. An
artist with no record over the floor gets **no score** (blank = unproven, not low). Change it on
the Brevo card; the next sync re-sends just the artists whose score moved. Daily-drop scores
appear only once that day's results have published.

## A&R attributes

`FIRSTNAME`, `LASTNAME`, `SMS`, and: `ANR_NAME`, `ANR_UID`, `ANR_PROFILE_URL`, `ANR_ROLE`,
`ANR_CITY`, `ANR_INSTAGRAM`, `ANR_TIKTOK`, `ANR_CATEGORIES`, `ANR_PRIMARY_CATEGORY`,
`ANR_PROFILE_COMPLETE`, `ANR_POINTS`, `ANR_SESSIONS_PLAYED`, `ANR_ROUNDS_VOTED`, `ANR_JOINED`,
`ANR_LAST_SEEN`, `ANR_SMS_CONSENT`, `ANR_EMAIL_OPT_OUT`, `ANR_BLOCKED`.

## Things to know

- **One phone number per Brevo contact.** If an artist's phone is already on an A&R (or on an
  earlier artist with a different email), it is left off the second contact so the row is not
  rejected.
- Phones are sent as `+1…` (E.164). A stored number that cannot be read as one is left off.
- Brevo imports in the background. The card shows the state of the last imports; if one
  failed, its report link is there.
- Existing fields in Brevo are never blanked by the sync (`emptyContactsAttributes: false`).
