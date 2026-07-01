# The A&R Room — Pre-Deploy Checklist

*Tier 1.3. Run this before any deploy. It's short on purpose — the goal is to catch the
specific things that caused (or could cause) an outage, not to bureaucratize shipping.
The whole list takes ~2 minutes.*

*Why this exists: the June outage wasn't a dramatic bug — it was a small change to data
volume crossing a threshold on a code path nobody was watching. Checklists beat memory for
exactly that kind of quiet, boring failure.*

---

## The 60-second version (every deploy)

1. **Does this change touch `db.js`, `ensureInit`, migrations, or anything that runs at
   startup?**
   - **No** → skip to step 4. Most deploys are safe.
   - **Yes** → do steps 2–3 carefully. This is the danger zone (it's where the outage lived).

2. **Does any startup/init code do work that grows with the number of rows?**
   (loops over all users, recomputes per-record, backfills, "for each ... await")
   - If yes: it **must** be gated behind `allowHeavy` (deploy-time only), never on the
     boot path. This is the rule the outage taught. The boot path must stay O(1) — a
     handful of cheap queries, nothing that scales with data.

3. **New migration?** Confirm it's:
   - Numbered correctly (next in sequence in `/migrations`)
   - Additive where possible (`ADD COLUMN`, new tables) — not a destructive rewrite
   - Heavy data conversion (re-scoring, mass updates)? → behind `allowHeavy`, with the
     loud "run me with `node migrate.js --run-heavy`" log.

4. **Run the tests.** `npm test` → expect **235 pass / 7 pre-existing failures** (the
   admin-role e2e ones). If the failure count *changed*, you broke something — stop.

5. **Deploy.**

6. **Verify it's actually live** (the gap that bit us repeatedly):
   - Open the site in an **incognito window** (static files cache aggressively — a normal
     window can show you the old version and hide a problem).
   - Confirm it loads fast and clean. The broken version 504'd on every page route, so
     "it loads" is strong proof.
   - If you touched migrations: glance at the **Vercel build log** — it shows whether the
     deploy-step migration ran against Postgres or skipped.

---

## The danger zone, expanded (only when step 1 = "yes")

The outage came from **one specific failure shape**, worth knowing by name so you recognize
it:

> Code on the request/boot path did work proportional to data size (a per-user recompute).
> It was fine at 30 users, fatal at 60 — it crossed the serverless 10-second timeout. No
> code "broke." The data grew past the line.

So the one question that matters in the danger zone is: **"Will this run on every request
or every cold start, and does it get slower as the database grows?"** If both are true,
it's the outage pattern. Move it to deploy-time (`allowHeavy`) or make it O(1).

Things that are SAFE on the boot path (don't grow with rows):
- `CREATE TABLE IF NOT EXISTS`, schema checks
- The advisory-locked migration runner (one instance migrates, others skip)
- A handful of constant-cost queries

Things that are NOT safe on the boot path (grow with rows):
- Looping over all users / all votes / all sessions
- Recompute/backfill "for every existing record"
- Anything you'd describe as "go through everything and fix it up"

---

## Env var sanity (when changing infra/config)

- Production `DATABASE_URL` is set in Vercel and current (rotate it if it's ever been
  exposed — it was, and you've rotated it).
- If you want deploy-step migrations: `DATABASE_URL` is scoped to **Build** in Vercel,
  not Runtime-only. (If not, migrations still run safely on boot — no harm.)
- Email provider keys (Resend/Mandrill) present if the deploy touches email.

---

## After a session/event (operational, not a deploy)

- No sessions stuck in `live` after they end. (A soft-delete should clear `live` once the
  Tier 2 fix lands; until then, check manually.)
- Stuck-live cleanup if needed:
  `UPDATE sessions SET status='completed' WHERE status='live' AND deleted_at IS NULL;`

---

*Keep this in the repo (e.g. `/docs`) so it's next to the code it protects. Update it when
a new failure teaches you something — a checklist is a living record of "things that bit
us once."*
