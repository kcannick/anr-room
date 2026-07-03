# Load test — the signup burst (runbook)

Reproduces the one load shape that actually broke the app: a **synchronized QR-scan signup
rush** (a crowd registering in the same ~30s → many simultaneous cold starts + DB
connections). See [../anr-load-test-plan.md](../anr-load-test-plan.md) for the *why*; this is
the *how*, turnkey.

Run it **once before a sizable event**, on a quiet weekday, against a throwaway test session.

---

## Before you start (5-minute prep)

1. **Verify `DATABASE_URL` uses the Neon *pooled* connection string** — the host contains
   `-pooler`. This is the single most important prep: the app opens `max: 5` connections per
   serverless instance, and a burst spins up many instances at once. The pooled string
   (PgBouncer) is what stops connection exhaustion — a config change, not code. If prod isn't
   already on the pooler, switch it before testing, or you may fail on a 2-minute fix.
2. **Install a tool** — `npm i -g autocannon` (simplest) and/or `brew install k6` (models the
   spike better).
3. **Open two dashboards** to watch while it runs:
   - **Vercel → your project → Functions / Logs** — look for 504s, timeouts, 500s.
   - **Neon → Monitoring** — watch **active connections vs the pool ceiling**.

---

## Track A — read-path burst (do this first: safe, hits prod, zero side effects)

Bursts `/api/session/info`, which exercises the outage mechanism (cold starts + DB
connection acquisition) **without writing rows or sending OTP emails**.

```bash
# 1. Create a throwaway test session in PROD's database
DATABASE_URL='postgres://...-pooler...' node docs/loadtest/session.js create
#    -> prints SID, e.g.  lt9f3a21

# 2a. k6 (models the real spike: 0 -> 100 req/s in 10s, hold 30s)
k6 run -e SID=lt9f3a21 docs/loadtest/spike.js
#     ramp higher if you expect a big crowd:
k6 run -e SID=lt9f3a21 -e PEAK=200 docs/loadtest/spike.js

# 2b. …or autocannon (ramps concurrency 10 -> 50 -> 100)
SID=lt9f3a21 bash docs/loadtest/autocannon.sh

# 3. Clean up when done
DATABASE_URL='postgres://...-pooler...' node docs/loadtest/session.js delete lt9f3a21
```

**Pass:** non-2xx ≈ 0, p99 latency well under 10s, Neon connections don't slam the ceiling,
no instance stays broken after the burst. (k6 exits non-zero if the thresholds are breached.)

---

## Track B — full registration write path (most faithful; needs isolation)

The real join flow (`POST /api/join/request` → `/api/join/verify`) **emails an OTP per
request** — so never burst it on prod (you'd send hundreds of real codes and pollute data).
To test the writes + connection-holding faithfully:

1. Create a **Vercel preview deployment** (a branch deploy) with **`EMAIL_PROVIDER=console`**
   (codes log instead of send) — ideally pointed at a **staging DB**, or prod with a plan to
   delete the test session after.
2. Point the burst at that preview URL and the join endpoint:
   ```bash
   k6 run -e BASE_URL=https://<preview>.vercel.app \
          -e PATH='/api/join/request' \
          docs/loadtest/spike.js
   ```
   (For POST bodies / the two-step verify flow you'll extend `spike.js`'s default function —
   `http.post(TARGET, JSON.stringify({sessionId, email}), {headers})`.)
3. Delete the throwaway session afterward: `node docs/loadtest/session.js delete <sid>`.

Track A is enough for a confident go/no-go; Track B is for when you want to stress the exact
INSERT path too.

---

## Reading the result

| Symptom | Cause | Fix |
|---|---|---|
| Sustained **504s** on the burst | something heavy back on the boot path | re-check `docs/anr-pre-deploy-checklist.md` danger zone |
| **Neon connections maxed** | pool exhaustion under concurrent cold starts | confirm the **pooled** connection string (prep #1) |
| Slow but not failing | per-request work worth caching | short-lived `playerState` cache |
| Instances stay broken after burst | init poisoning | already fixed (self-healing `ensureInit`) |

You don't repeat this weekly — only when the crowd size jumps materially, or you change
anything in the danger zone (init / migrations / boot path).
