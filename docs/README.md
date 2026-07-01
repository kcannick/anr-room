# The A&R Room — Project Docs

Reference material for development. The authoritative project context for Claude Code is
`/CLAUDE.md` at the repo root (read automatically each session). This folder holds the
deeper docs that CLAUDE.md points to.

## Start here
- **`../CLAUDE.md`** — project context, tech stack, commands, the settled architecture
  decisions, the critical workflow rules, and the roadmap. Read this first.
- **`anr-room-roadmap.md`** — the full roadmap with every decision recorded (the Decision
  Record at the bottom is the canonical "why we chose X"). Tier 0/1/2 are done & deployed;
  Tier 3.1 (Series) backend has landed (`0950aeb`) — its **admin UI is the active build**.

## Build specs
- **`specs/anr-room-product-brief.md`** — the product strategy & the series-layer design
  (source of truth for the series mechanic).
- **`specs/binary-poll-build-spec.md`** — full spec for the binary "Verzuz" poll (schema
  already in the codebase; UI + server branches pending).
- **`specs/hitmail-*.md`** — the separate later product. PARKED 6+ months. Not a dependency
  of the A&R Room; here for reference only.

## Mockups (the visual build spec for UI work — build to match these)
- **`mockups/anr-series-admin-mockups.html`** — series management, inline session tagging,
  leaderboard + configurable cut, "Close series". (Series backend is built; this is the UI.)
- **`mockups/anr-profile-mockups.html`** — registration, profile completion (two-step
  category), leaderboard qualification gate, liveness layer.
- **`mockups/anr-homepage-mockups.html`** — public single-page site, live + between-sessions
  states, Register CTA, screenshot-style live block.

## Operations
- **`anr-pre-deploy-checklist.md`** — run before every deploy (the 60-second list + the
  boot-path danger zone).
- **`anr-load-test-plan.md`** — how to reproduce the signup-burst load before a big event.
- **`anr-room-audit.md`** — system audit (endpoints, tables, the 7 assumptions to examine).

## Patches
- **`patches/series-layer-backend.patch`** + **`APPLY-series-layer-backend.md`** — ✅ **APPLIED**
  (commit `0950aeb`, on `main`). Historical record of the series-layer backend slice (schema +
  endpoints + qualify-count). Do NOT re-apply — `git log` already shows it in. Kept for reference
  only; no outstanding patches remain.

## Next build (per roadmap)
1. Series admin UI (match `mockups/anr-series-admin-mockups.html`; backend done)
2. Public series leaderboard (into the homepage)
3. Profile / liveness / homepage cluster (match the profile + homepage mockups; also clears
   the deferred first-user-admin + remove-signup_prompt items)
4. Binary poll UI (per the spec)
5. Push migration (Ably) — the real scaling lever for 2,000–5,000 concurrent
