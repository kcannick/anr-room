# The A&R Room — Load-Test Plan: The Signup Burst

*Tier 1.4. The point of this is narrow and specific: **reproduce the exact load shape that
caused the outage, on purpose, before an event — not during one.** This is not generic
"can it handle traffic" testing; it's "can it handle the thundering herd of a QR-code
signup rush at a live event," which is the one pattern that actually broke us.*

---

## What the real load looks like (and why it's unusual)

The outage happened at "The Linq Up": a crowd scanned a QR code at roughly the same moment
and all tried to register at once. That's a **burst of concurrent cold-start traffic**, not
steady load. It's spiky and synchronized — everyone arrives in the same 30–60 seconds.
That shape stresses three things at once:

1. **Cold starts** — many serverless instances spin up simultaneously, each running init.
2. **The boot path** — whatever init does, it does N times in parallel under time pressure.
3. **DB connections** — each new instance opens connections; a burst can exhaust the pool.

The fix already shipped (heavy work off the boot path + self-healing init) should make this
fine. **This test confirms it before you're betting an event on it.**

---

## What "passing" means

After the fixes, a signup burst should:
- Return **200s** (registration succeeds), not 504s.
- Stay **under the 10-second function limit** on every request.
- Not leave any instance bricked (the self-healing init guards this).
- Recover cleanly if the DB momentarily strains.

If you see 504s, timeouts climbing toward 10s, or 500s that persist after the burst ends,
that's a real finding to fix *before* the event.

---

## How to run it (three options, easiest first)

### Option 1 — Manual, zero tools (good enough for a first pass)
Get 5–10 people (or 5–10 browser tabs / phones) to hit the registration flow within the
same ~10 seconds. Crude, but it reproduces the *synchronized* nature better than a single
tester. Watch: does everyone get in? Any spinner-of-death? Check the Vercel logs after for
any 504/500.

### Option 2 — A simple load-test tool (the real test)
Use a lightweight HTTP load tester to fire concurrent requests at the registration
endpoint. Good free options: **k6**, **autocannon**, or **hey**. Example shape (autocannon,
the simplest to install — `npm i -g autocannon`):

```bash
# 50 concurrent connections, 30 seconds, against the registration/join endpoint
autocannon -c 50 -d 30 -m POST \
  -H "Content-Type: application/json" \
  -b '{"name":"LoadTest","sessionId":"<a-real-test-session-id>"}' \
  https://anr.makinitmag.com/api/<join-or-register-endpoint>
```

**Important:** point it at a **test session**, not a live one — and ideally a test deploy
or a quiet time, so you're not polluting real data or disrupting a real room. Ramp the
concurrency: try `-c 10`, then `-c 50`, then `-c 100`. The numbers that matter in the
output: **non-2xx responses (should be ~0)** and **latency p99 (should stay well under
10s)**.

### Option 3 — k6 (most realistic, models the burst)
k6 lets you model a *spike* — ramp from 0 to many users in a few seconds, hold, drop. That
matches the QR-scan reality better than steady load. Worth it once if you expect large
events; overkill for a first check.

---

## What to watch while it runs

- **Vercel dashboard → Functions/Logs:** look for 504s, timeouts, or 500s. The build/runtime
  logs show init behavior.
- **Neon dashboard → Monitoring:** watch active connections. If they spike to the pool
  ceiling and requests start failing, that's the connection-exhaustion path — the fix for
  which is the Neon pooler (roadmap 4.2), mostly a connection-string change.
- **Response codes:** the single clearest signal. All 2xx = pass. Any sustained 504 = the
  outage pattern is still reachable.

---

## What a finding would mean (and the fix already on the roadmap)

| Symptom under load | Likely cause | Fix (already planned) |
|---|---|---|
| 504s on burst | something heavy still on boot path | re-check against pre-deploy checklist danger zone |
| Connections maxed in Neon | pool exhaustion under concurrent cold starts | Neon pooler (roadmap 4.2) |
| Slow but not failing | per-request work that could be cached | cache shared `playerState` (roadmap 4.1) |
| Instances stay broken after burst | (should be fixed) init poisoning | self-healing `ensureInit` (shipped) |

---

## When to do this

**Once, before the next sizable event** — not on the morning of. A quiet weekday, against a
test session, ramping concurrency until you're satisfied it holds at a number comfortably
above your expected crowd. Then you walk into the event knowing the burst is handled, rather
than discovering it live (which is how you found out last time).

You don't need to repeat it every week — only when (a) the crowd size jumps materially, or
(b) you've changed anything in the danger zone (init/migrations/boot path). Otherwise the
result holds.
