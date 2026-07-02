# A&R Room — Host Role (creator program)

*Chosen model (operator, 2026-07-02): **not** a branded multi-tenant SaaS. Instead, an invite-only
`host` role that gives music-review streamers a **free engagement tool** for their stream — audience
voting, points, leaderboard. Everything stays **A&R Room / Makin' It branded**. The host's incentive
is inclusion in Makin' It's **monthly $500 giveaway** (promo for them). **Makin' It keeps the data** —
hosts never see viewer emails/contacts. Think "Facebook Page": you build the engagement, the platform
owns the audience data. No branding, no per-host pages, no charging.*

*(This supersedes the heavier multi-tenant plan previously drafted here. Grounded in a codebase audit.)*

---

## Why this is small — most of it already exists
- `sessions.owner_uid` is set to the creator; `canAdminSession` = **admin OR owner**; the session picker
  already shows non-admins **only their own** sessions. → A host can already create + manage only their
  own sessions.
- Every per-session action (open/close/ratify rounds, broadcast, config, overlay) goes through
  `canAdminSession` → owner-scoped. A host can't touch another host's session.
- Platform-only endpoints (`/api/admin/users` = the contact list, series, Drupal ingest, block/delete,
  SMS test) are already gated to `role === 'admin'`. A non-admin host is **already excluded**.

**So the model mostly falls out of existing role logic — provided hosts are a NON-admin role and
Makin' It stays `admin`.**

---

## The actual work

### 1. Gate session creation (the invite-only lock) 🔴
`POST /api/session` is currently open to anyone. Add: creation requires `role in (host, admin)`.
That single check turns "anyone can create a room" into "only invited hosts + Makin' It can."

### 2. `host` role assignment 🔴
The `host` value exists in the schema but is never assigned. Build:
- `POST /api/admin/users/role` (platform-admin only): set a user's role to `host` / back to `player`.
- A "Make host / Remove host" button on the existing admin **Users** panel.
No migration needed (the `role` column + `host` value already exist).

### 3. Role-aware admin UI 🔴
A host logs into the same admin console but sees **only the session tools**. Using the `role` already
returned by `/api/auth/me`, hide from hosts: the **Users/contacts** panel, **Series** management, the
**Drupal ingest** button, the **SMS test** tool, and global-banner controls. They keep: create session,
queue/rounds, broadcast, overlay/play links, event config, geo check-in.

### 4. Redact PII from what hosts see 🔴 (the data-protection core)
`adminState` currently returns the participants list **with emails/phones** (server.js ~454). For a host
caller, **strip email/phone** — hosts see engagement only: display names, points, counts, live vote
tallies, leaderboard (same PII rule the public/overlay surfaces already follow). Emails never reach a
host; Makin' It keeps them. Email go-live sends still work (the server reads addresses to send; the host
never sees them).

### 5. Email-only for hosts 🟡
Host go-live dialog hides the **SMS** option (SMS + A2P stay Makin'-It-only). Hosts can still email their
session's registrants — sent by the platform on their behalf, addresses never exposed.

### 6. Isolation tests 🔴 (production-readiness gate)
e2e proving: a host can create + manage their **own** session; a host is **403'd** from every
platform-only endpoint (`/api/admin/users`, series/*, ingest, block/delete, SMS test); a host **cannot**
act on another host's session; and host `adminState` carries **no emails/phones**.

### 7. Giveaway integration 🟢
The $500 giveaway = Makin' It's monthly **series**. Makin' It (admin, sees all sessions) **tags host
sessions into the giveaway series** — works today, no change. Surface a "**Top A&Rs this month → $500**"
hook on the play page so a host's viewers see the incentive they're promoting.

### 8. Host onboarding 🟢
A light "you're a host" flow: how to create a session, share the play/overlay link in your stream, and
promote the $500. One short page or modal — no branding setup needed.

---

## Phases
- **Phase 1 (the toolset) — ✅ DONE:** items 1–6 — gate creation, assign role, role-aware UI,
  **PII redaction**, email-only, isolation tests. Plus per-host feature permissions
  (SMS/Ads/Export/Broadcast, default NONE). Ships a safe, invite-only host engagement tool.
- **Phase 2 (the incentive) — ✅ DONE:** items 7–8.
  - **Per-host giveaway flag** (migration 017 `users.giveaway_eligible`, opt-out; admin toggle
    on the Users panel; server helper `giveawayContext`). A session surfaces the $500 hook only
    when it's series-tagged AND its owner is eligible.
  - **$500 hook on the play page** — a lobby card ("Playing for $500 this month" + the series'
    top board), plus the third step of the new-A&R onboarding adapts to it.
  - **Host onboarding** — a first-run "you're a host" modal in the admin console (create a
    session → share Play/Overlay links → promote the $500), once per device.
  - Also shipped alongside: **standard-user onboarding** — a first-run "how to play" modal on
    the play page (Rate/Pick → Read the Room → Climb for the $500), copy adapts to rating vs
    Versus and to whether the session plays for the giveaway; once per device.

Phase 1 is the whole product; Phase 2 is polish + the promo hook. Both are now live.

---

## Explicitly out of scope (vs. a real multi-tenant SaaS)
- ❌ Per-host branding / themes / logos — everything stays A&R Room branded.
- ❌ Per-host public homepage / `@handle`.
- ❌ Per-host series / email-from — the giveaway series stays Makin'-It-controlled.
- ❌ Contact export to hosts — **Makin' It owns the audience data** (the whole point).
- ❌ Billing / plans — free, invite-only, manually upgraded.
- ❌ Per-tenant SMS — email-only for hosts.

---

## Decisions (operator, 2026-07-02)
1. **Host email notify:** ✅ Yes — a host can trigger a go-live **email** to their registrants;
   platform-sent, addresses never shown to the host.
2. **Giveaway inclusion:** **per-host configurable** — a flag Makin' It sets per host controlling
   whether that host's sessions count toward the monthly $500 (Phase 2).
3. **Host visibility line:** hosts see display name, points, counts, leaderboard, **+ Instagram/TikTok**
   (the useful public bits) — but **never email/phone**. Server-side redaction, not just UI hiding.

## Build note — the invite-only gate is a behavior change
Today **any logged-in user (even a `player`) can create + own a session** (e2e verifies this). "Invite-
only" = gate `POST /api/session` to `role in (host, admin)`. This removes hosting from regular viewers and
requires updating the ~23 unauthenticated session-creations in the e2e suite to authenticate. Done as
increment **1b** after the non-breaking pieces (1a).
