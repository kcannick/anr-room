# A&R Room — Multi-Tenant Roadmap

*Goal: turn the single-operator A&R Room into an **invite-only, multi-tenant platform** where
music-review streamers host their own events to boost stream retention/engagement — and every
registrant feeds Makin' It's master contact list. Tenants are **manually upgraded** (no public
sign-up, no billing). **Tenants get email notifications only** (SMS stays Makin'-It-only).*

*Grounded in a codebase audit (2026-07-02). Line refs are accurate as of migration 015.*

---

## The thesis (what shapes every decision)
1. **Engagement tool for streamers** — a reviewer drops the A&R Room link in their stream; viewers
   rate songs, read the room, climb a leaderboard → more watch-time and repeat viewers for the host.
2. **Contact-list engine for Makin' It** — every viewer who registers (for *any* tenant) becomes a
   contact in Makin' It's master list. Hosts see only *their* audience; Makin' It sees everyone.
3. **Invite-only** — Makin' It manually upgrades a user to `host`. No public host sign-up, no plans,
   no payments in v1.

---

## Current state — what's already tenant-ready vs. single-tenant-assumed

| Concern | Today | Verdict |
|---|---|---|
| **Session ownership** | `sessions.owner_uid` set on create; `canAdminSession` = admin OR owner OR legacy token | ✅ **Ready** |
| **Session list scope** | `/api/auth/sessions`: admin → all, else → `owner_uid = me` | ✅ **Ready** |
| **Realtime / overlay / play** | Keyed by session id; tenant-agnostic | ✅ **Ready** |
| **Notification dispatch** | Per-session participants; email (all) + SMS (consented) | ✅ scoped; needs email-only-for-hosts gate |
| **Email infra** | Resend/Mandrill, one shared from-name | 🟡 needs per-tenant from-name + compliance |
| **Vercel Blob** | Wired (profile photos) | ✅ reusable for tenant logos |
| **`host` role** | Declared in schema, **never assigned** | 🔴 must build assignment |
| **`series`** | **No owner**; all series endpoints admin-only + global | 🔴 add `owner_uid`, re-gate |
| **`settings`** | Fully global k/v (`global_banner_id`, `ingest_latest`) | 🔴 needs tenant scoping |
| **Public homepage `/api/home`** | Assumes ONE global live session + ONE active series | 🔴 core single-tenant assumption |
| **Branding** | "The A&R Room" / Makin' It hardcoded in ~23 places across 7 files + logo.png/mark.png | 🔴 make tenant-driven |
| **Drupal ingest, GA, Twilio** | Platform-global (single INGEST_TOKEN / GA id / Twilio acct) | 🟡 keep platform-only or make per-tenant |
| **nero.fan pull** | Per-session (reads session.submit_url) | ✅ works for any host |

**Bottom line:** ownership plumbing exists; the migration is mostly (a) extending ownership to
series/settings/branding, (b) removing "the one live session/series" global assumptions, and (c)
building the host role + a per-tenant public face.

---

## Key decisions (recommendations — confirm before building)

1. **Tenant = a `host` user (not a separate org).** `owner_uid` *is* the tenant id — reuses existing
   plumbing. A "host profile" (handle, brand name, logo, accent, from-name) lives on `users`. Multi-user
   teams (co-hosts/mods) are a later phase.
2. **Makin' It is tenant #1 + platform admin.** Dogfood: Makin' It runs as a normal tenant *and* holds
   the `platform_admin` role for cross-tenant powers. `/` stays Makin' It's front door for now.
3. **Public presence = path-based `/@handle`** (e.g. `anr.makinitmag.com/@crazybars`). Avoids wildcard
   DNS/cert complexity; custom domains/subdomains are a later upgrade. Play/overlay/admin already work
   cross-tenant (session-id scoped).
4. **Series & A&R Wars are host-owned.** Add `owner_uid`; each host has their own monthly series,
   leaderboard, and Wars.
5. **Email-only for hosts.** SMS + A2P stay Makin'-It-only. Host go-live dialog shows Email only.
   Shared verified sending domain, per-tenant from-name/reply-to.
6. **Contact list is dual-scoped.** Registrant → global `users` (Makin' It master list). A host sees
   only users who engaged with *their* sessions. Requires a **registration consent disclosure** +
   privacy policy (legal — parallels the SMS-consent clearance).
7. **Roles:** `platform_admin` (Makin' It) · `host` (tenant) · `player` (audience). Manual upgrade tool.

---

## What must be built — by area

### A. Tenancy data model & isolation (the backbone)
- **Migration 016:** `series.owner_uid` + index. Backfill existing series → Makin' It's uid.
- **Migration 017:** host-profile columns on `users`: `handle` (unique, URL-safe), `brand_name`,
  `host_logo_url`, `accent_color`, `email_from_name`, `ga_measurement_id` (optional), `host_status`
  (active/suspended). Backfill Makin' It.
- **Migration 018:** scope `settings` — add an `owner_uid` (nullable = platform-global) so a host's
  "default banner" etc. don't collide with Makin' It's. (Or split host prefs into the user profile.)
- **Backfill:** stamp `owner_uid` on legacy sessions that are null (assign to Makin' It).
- **Re-gate series endpoints** (`/api/admin/series/*`) from "admin-only" → "admin OR owns the series."
- **The isolation audit (critical):** every list/read/mutate endpoint must filter by `owner_uid` for
  hosts. Confirmed needing scope: series list + leaderboard, `/api/admin/users` (a host must see only
  *their* audience, not everyone), banners, feedback. A host must NEVER see another tenant's sessions,
  participants, emails, or series.

### B. Host role, upgrade & onboarding
- **Platform-admin upgrade tool:** in a platform console — list users, "Upgrade to host" (sets
  `role=host`, prompts for a unique `handle`), suspend/downgrade.
- **Host onboarding:** first host login → set brand (name, handle, logo upload via Blob, accent).
  A host **Settings** page to edit brand + view their public URL + overlay/play links.
- **Scope admin.html for hosts:** session picker already owner-scoped; extend to series. Hide
  platform-only tools from hosts (Drupal ingest, SMS test, cross-tenant users, global banner).

### C. Per-tenant public presence & branding
- **Path routing** `/@handle` → that host's homepage. New `/api/home?host=<handle>` (or resolve handle →
  owner_uid) that scopes live/next/series/winners to that owner — **removes the global "one live
  session/series" assumption** (server.js `/api/home`).
- **Theming layer:** replace the ~23 hardcoded "A&R Room / Makin' It" refs (home/play/admin/overlay/
  join + server email templates + email.js from-name) with tenant-driven values injected per request.
  Brand name, logo, accent color, footer URL. (Subsumes the pinned facelift/branding pass.)
- **Branded links:** session/overlay/play pages resolve session → owner → brand for their header/title.

### D. Email notifications (tenant-facing, email-only)
- Host go-live dialog: **Email only** (SMS hidden for non-platform-admins).
- Per-tenant **from-name + reply-to**; one shared verified sending domain (SPF/DKIM) for deliverability.
- Email templates use tenant branding + the tenant's session link.
- **CAN-SPAM compliance:** unsubscribe link + `List-Unsubscribe` header + physical mailing address;
  an unsubscribe endpoint + per-tenant suppression list; respect it in dispatch.

### E. Contact-list & audience tooling
- **Host audience view/export:** registrants of the host's sessions (name, email, opt-in, last seen).
- **Platform master list:** Makin' It exports all users across tenants (the core asset).
- **Consent + privacy:** registration disclosure ("registering joins {Host} and Makin' It"), a privacy
  policy page, and honoring unsubscribe/delete. Legal review before external launch.

### F. Per-tenant Series + A&R Wars
- Host-owned series (from A) + a host series-admin UI + per-host public standings.
- A&R Wars per host (reuses the binary/Versus + series tagging that already exists).

### G. Production hardening (what makes it "production-ready")
- **Isolation test suite:** e2e proving a host cannot read/mutate another tenant's data on *every*
  endpoint. This is the #1 safety item for going external.
- **Email guardrails:** per-tenant send caps + rate limits (a host must not blast harvested lists);
  bounce/complaint handling.
- **Abuse & moderation:** platform-admin can suspend a tenant (freezes their sessions/emails).
- **Scaling:** multiple simultaneous live sessions across tenants is the new normal — finish the Ably
  push + Upstash cache lever (partly done) and remove any remaining "one live room" assumptions.
- **Data lifecycle:** backups, retention policy, GDPR/CCPA delete-my-data across tenants.
- **Observability:** per-tenant usage metrics (sessions, registrants, emails) for Makin' It.

---

## Phased sequence

- **Phase 0 — Decisions.** Lock the 7 decisions above (routing, tenant=user, email-only, consent model).
- **Phase 1 — Tenancy backbone.** Migrations 016–018, backfill Makin' It ownership, re-gate series,
  **run the isolation audit + tests.** (Nothing user-visible; makes the data model safe.)
- **Phase 2 — Host role + upgrade + onboarding + scoped admin.** First real hosts can log in and manage
  only their own stuff. Platform console to upgrade users.
- **Phase 3 — Per-tenant homepage + branding.** `/@handle`, theming, branded links. Hosts get a real
  public front door.
- **Phase 4 — Email notifications (email-only) + compliance.** Hosts can notify their audience; CAN-SPAM.
- **Phase 5 — Contact-list tooling + consent/privacy.** Host audience export + Makin' It master list +
  the legal disclosure. (Unlocks the business thesis.)
- **Phase 6 — Per-tenant Series + A&R Wars.**
- **Phase 7 — Hardening & scale.** Isolation test suite, email caps, suspend-tenant, Ably/Upstash,
  backups, metrics.

**Recommended first shippable slice:** Phases 1–3 make a single invited host able to run branded events
end-to-end (sessions, play, overlay, homepage) fully isolated from Makin' It. Phases 4–5 turn on the
notifications + contact-list value. Phase 7 gates the *external* launch.

---

## Explicitly out of scope (v1)
- Public host sign-up, billing/plans/Stripe (invite-only, manual upgrade).
- Per-tenant SMS/A2P (email-only for tenants).
- Multi-user tenant teams (co-hosts/mods) — later.
- Custom domains / subdomains per tenant — path-based first.
- Per-tenant Drupal ingest — stays Makin'-It-only.
