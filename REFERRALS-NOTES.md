# Referrals & Access — built now vs. deferred (with legal flags)

This documents what shipped in the referral/sharing pass and what was deliberately
deferred, so the deferred items carry their context (especially the legal ones) the
same way the Hitmail design docs flag the recruit-restricted rostering mechanic.

## Built now (low-risk, attribution-only)

- **Referral tracking.** Every verified player gets a short share code (`ref_code`).
  Their invite link carries it (`/?s=SESSION&ref=CODE`). When someone joins via that
  link, we record `referred_by` (the inviter's participant id).
- **Anti-farming gate.** A referral only *counts* (`ref_credited = 1`) once the
  referred player actually verifies AND plays a round. A fake account that never plays
  never counts. Self-referral (same email) and unknown codes resolve to organic. This
  mirrors the Hitmail principle that value attaches to active participation, not to
  recruitment lineage.
- **Friendlier sharing.** Personal invite link + warmer share-sheet copy + an
  informational "you've brought N" counter on the invite button. **No reward** is
  attached — the counter is just feedback.
- **Host visibility.** The admin leaderboard shows "brought N" under names; the export
  includes `referred_by` (mapped to the anon-safe "Player N" label) and
  `referral_credited`. Anon export keeps the attribution but carries no PII.

Nothing here touches money, ranking, or eligibility, so it sits squarely in the
free-to-play / skill-contest lane that the Hitmail brief establishes.

## Deferred — referral REWARDS (needs a decision + likely a lawyer pass)

The moment a referral earns anything of value, the structure starts to resemble the
recruit-restricted rostering concern already flagged in `hitmail-design-decisions.md`
§4 (friends-and-family downline resemblance once real money enters).

Guidance for when this is built:
- **Status/points rewards are the safe path.** Award points or cosmetic status for
  credited referrals; never cash, never anything redeemable for cash, and never let a
  referral reward affect competitive *rank* (ranking stays skill-only, per the Hitmail
  §8 guardrail). Players must never have to pay or recruit to compete.
- **Write it down, don't resolve it silently.** If/when rewards are added, add the
  "rewards stay non-cash and rank-neutral until a lawyer pass" note to the design doc,
  exactly as the recruit-rostering item is documented as an open action.
- The credited-on-play gate already built is the right foundation — it's the same
  anti-abuse posture a reward layer would need.

## Deferred — INVITE-ONLY sessions (access control)

Two genuinely different products were identified; only the schema seam is worth
reserving now, not the operational build.

- **Soft gate (link-only).** Session is simply unlisted — anyone with the link gets in.
  Covers most *private listening party* needs. Cheap; effectively already true since
  sessions aren't discoverable without the link. If/when a discovery surface is added,
  add an `access` flag (`open | link`) so `link` sessions stay hidden from it.
- **Hard gate (allowlist).** Entry requires a valid invite token tied to a real
  inviter; a bare link is rejected. This is what *exclusive/celeb events* need (access
  is the product). It's more to build (invite tokens, per-inviter caps, revocation, a
  bouncer at join) and more to operate (support load: "my link won't work"). Recommend
  building this only when a concrete event needs it — not on spec.

Suggested schema seam when the time comes: `sessions.access TEXT DEFAULT 'open'`
(`open | link | invite`), plus an `invites` table for the hard path (token, inviter,
max_uses, used_count, revoked). The referral plumbing already shipped (codes +
`referred_by`) is reusable as the invite-token substrate.

## Anti-abuse notes carried forward

- Referrals credited only on real play — keep this gate on any future reward.
- Self-referral blocked by email; unknown codes ignored.
- If rewards are ever added, add device/IP heuristics and a per-referrer cap before
  launch — farming pressure scales with reward value.
