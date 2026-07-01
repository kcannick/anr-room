# APPLY — Series Layer (backend slice)

> ✅ **ALREADY APPLIED** — landed on `main` as commit `0950aeb`. This file is a historical
> record; do **not** re-run the apply steps below. Migration 011 and the six endpoints are
> already in the tree. The active build is now the **Series admin UI**.


*Patch: `series-layer-backend.patch` · 3 files, +182 · verified `git apply --check` clean on
your deployed state (pristine + Tier 1 + Tier 2) · suite **242 pass / 0 fail**. Leaderboard
math separately proven (cross-session sum + untagged exclusion). **Includes per-series
qualify-count.**

This is the **backend foundation** of the Series layer — schema, migration, and the six
endpoints. The admin tagging UI and leaderboard view come next as a separate patch, after
you approve the mockups (mockup-first, per your preference).

---

## What's in it

### Schema (db.js + migration `011_series.sql`)
- New `series` table: `id, title, description, status (upcoming|active|closed),
  target_sessions, qualify_count (top-N → A&R Wars, default 8, per-series), start_date,
  end_date, created_at`. Per the brief, `target_sessions` and the dates are **display-only**
  — they never filter membership. `qualify_count` drives the leaderboard cut line.
- New `sessions.series_id` column — the explicit **tag** that determines membership.
- Indexes on `sessions(series_id)` and `votes(round_id)` for the live leaderboard join.
  (These live in the migration, not the base schema, because they depend on the
  migration-added column — putting them in the base schema would fail when upgrading an
  existing sessions table.)

### Endpoints (server.js)
| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/admin/series/create` | admin | Create a series |
| `GET /api/admin/series/list` | admin | List series + tagged-session counts |
| `POST /api/admin/series/edit` | admin | Edit metadata/status (only provided fields) |
| `POST /api/admin/series/tag` | admin | Tag/untag a session (`seriesId` null clears) |
| `GET /api/admin/series/leaderboard` | admin | Live leaderboard, full identity, `?limit=` for the cut |
| `GET /api/series/leaderboard` | **public** | PII-safe board (first name + points only) for the homepage |

### The leaderboard is live-computed (the core design)
Points are summed from `votes.points` across the series' tagged, non-deleted sessions,
grouped by the durable user behind each participant:

```
votes → participants (user_id) → users
  └─ rounds → sessions (series_id = ?)
```

**Proven correct:** a user's points sum across *all* their tagged sessions; votes in
*untagged* sessions are excluded; the board stays right through retroactive tagging and
re-ratification (nothing stored to drift). The qualification cut is just `ORDER BY points
DESC LIMIT N` on this query.

---

## To apply

```bash
git apply /path/to/series-layer-backend.patch
npm test            # expect: 242 passed, 0 failed
git add -A && git commit -m "Series layer: schema + endpoints (backend slice)"
# deploy — migration 011 applies automatically (boot path or deploy-step)
```

---

## What's NOT in it yet (next, after mockups)

- **Admin tagging UI** — a control in the admin panel to create series + tag sessions into
  them (the brief calls for mockup-first here).
- **Series leaderboard view** — the admin-facing standings + the public homepage standings
  that consume `/api/series/leaderboard`.
- **Qualification cut UI** — surfacing "top N qualify for A&R Wars" at series close.

These are the front-end half. The endpoints they'll call are all live in this patch, so the
UI build is purely presentational — no more backend needed.

---

## Roadmap

This is **Tier 3.1 (the keystone)**, backend done. Next: its UI (mockup-first), then the
profile/liveness/homepage cluster (3.5) which shares the leaderboard surface.
