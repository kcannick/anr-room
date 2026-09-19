# Sales leads → Asana (040)

The top-scoring artists on the platform, one Asana task each, in a project the operator works
to sell Mimberships and performances. Platform panel → **Sales leads → Asana**.

## What it does

1. Takes **every ratified rating round** the platform has scored — live shows and daily drops
   alike. Reference tracks and Versus rounds are out. A record pushed twice counts once, at its
   best showing.
2. Drops every record under the **minimum A&Rs** floor (default 3; 0 turns it off). The floor
   excludes a record, it never reweights one — an 8.0 from a single A&R is not a lead, and the
   score printed is always the room's real average. Then ranks what is left on room average
   (ties: more A&Rs, then the earlier day) and keeps the **top N %** (default 30). Both dials
   are on the card.
3. Collapses the kept records to **artists** — one artist = one email address; without an email,
   one Instagram handle; without either, the artist name. An artist with two records in the cut
   gets **one task, on the higher score**, with the others listed in the notes.
4. Writes them to Asana, highest score first:
   - **Project:** `A&R Sales Leads`, created on the first press and remembered. To use a project
     you already have, paste its ID under System settings → *Asana sales-leads project*.
   - **Custom fields:** `Date played` (date) and `Average score` (number, one decimal). Both are
     created in the workspace if missing and added to the project. Custom fields are a paid
     Asana feature: on a plan without them the tasks still go out (the score is in the task
     name, the date in the notes) and the card says why the columns are missing.
   - **Task:** `Artist — “Title” · 7.4`. Notes carry artist, record, score + A&R count, date and
     session, support level (what they paid), email, phone, Instagram, play link, and their
     other rated records. No price, no upsell.

## Pressing it again

The sync is **re-runnable**. A ledger (`asana_leads`) remembers which artist has which task:
- an artist new to the top set → a task is created;
- an artist whose best record changed (a higher score, a new day) → their task is **updated**;
- everything else is skipped — no duplicates, no Asana calls;
- a task you deleted in Asana is recreated on the next press;
- an artist who drops out of the top set **keeps their task** — you may be mid-conversation.

Each press writes at most 12 tasks (one bounded request, inside Vercel's 30-second cap); the console presses again on its
own until the list is done.

## Needs

- `ASANA_TOKEN` in Vercel (same token as the post kit — see `post-show-setup.md` §3).
- Platform-admin role: the list spans every room and carries artist email and phone.

Endpoints: `GET /api/admin/leads?pct=30&minVotes=3` (preview + sync state),
`POST /api/admin/leads/asana` `{pct, minVotes}`. Settings keys: `asana_leads_project`, `asana_workspace`, `asana_leads_fields`.
