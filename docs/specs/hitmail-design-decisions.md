# Hitmail — Design Decisions: World, Labels & Marketing

_Session capture. Add to project documentation._

---

## 1. Concept frame: the blurred-line ARG

Hitmail is positioned as a self-contained world — an "exclusive music-industry Inbox" — that feels like a real product while being a game. North star: the **hoverboard from _Back to the Future_** — build the fiction so completely it reads as real.

- The **Inbox** is the setting, not a literal email service. Framing uses "Inbox," "Contacts," not "email."
- Core nav surfaces: **Inbox · Contacts · Slack Channel · Settings**.
- Positioning copy ("the industry's Inbox — no unsolicited submissions, no phishing, trusted messages from your network") refers to the **world inside Hitmail**, not protection of the user's real-world communications. Keep all such claims pointed inward (in-game), never as a functional security promise about real email.

### Open flag — trademark
"Hitmail" phonetically echoes Hotmail (Microsoft mark). The "Inbox" reframe (dropping "email") reduces but does not eliminate the resemblance. **Recommend a trademark clearance check before building the landing page or spending on domains.**

---

## 2. Three-tier site architecture

| Tier | Site | Role |
|------|------|------|
| Game | `hitmail.gg` | The product / front door / the Inbox |
| Parent label | `2DaTopRecords` | Shared world: company news feed, artist roster, staff page |
| Imprints | `RosePedalRecords.2DTR.com` | Player-spun sub-labels with custom page, founder profile, mission statement, roster |

- **2 Da Top Records** is the fictional label every player starts inside (think UMG). Players spin off their own imprints once they rank/earn enough.
- **Staff page = live leaderboard.** Top players (month/season) appear as "staff." The org chart of the fictional company *is* the ranking system.
- **Imprint pages** are player-customizable (founder profile, mission statement, roster) on `*.2DTR.com` subdomains — an ownable, shareable artifact players will post to their own socials (free distribution).

### Guardrails
- **News feed:** seed with clearly **fictional** characters (e.g., "Jeff Anders, promoter → VP Marketing"; "Kathy 23 leaves to launch Rose Pedal"). Do **not** attribute fictional moves to **real named** industry figures. Real artists may appear as rateable **content**; real people must not be characters in the fiction. As real players climb, their milestones graduate into the feed (a live leaderboard disguised as industry press) — covered by an onboarding consent line ("your milestones may appear in the Hitmail feed").
- **UGC moderation:** imprint pages (names, mission statements, rosters) are user-generated content on brand subdomains. Build a moderation hook + content policy from the start; ensure imprint pages can't be mistaken for endorsement by a real entity.
- **"It's a game" backstop:** keep a quiet, findable disclosure (footer / terms / about) identifying Hitmail as an entertainment product. Doesn't break immersion; makes the whole structure read as world-building rather than deception the moment anyone checks.

---

## 3. Label / roster economy

A salary-cap talent-management layer on top of the prediction game.

- **Solo or social.** Recruiting and hiring are **optional**. A player can level up solo, run a label, and compete without recruiting anyone. Inviting friends is an optional accelerant, not a requirement.
- **Rosters are capped** (competitive balance + reinforces curation over accumulation).
- **Per-slot salary cost.** Each roster member costs currency; the bet is that they produce more value (accuracy) than they cost. Drives real cut/bench/downsize decisions.
- **Earnings attach to active roster membership.** Owner earns based on the accuracy of current roster members + own predictions. **If a member leaves, quits, or spins off their own label, the owner stops earning from them.** Income follows the active employment relationship, not recruitment lineage.
- **Daily check-in as roster value:** inactive members drag a label's score, so owners cut them — outsourcing engagement pressure to the most-motivated party.
- **Seasonal label directory:** imprints ranked monthly/seasonally; labels compete against each other. Open-ended team-sport retention loop beyond individual ranking. Seasonal resets prevent entrenchment and create launch beats.

### Recruiting rewards
Recruiting is a celebrated **optional** dynamic, built around real-life network (friends, family, classmates, colleagues) surfaced as **Contacts** in the Inbox. Rewarded via:
- One-time signing **bounty** that scales with the recruit's proven accuracy.
- **Scout/track-record** stat on the founder profile.
- **First-signing rights** on people you brought in.

### Anti-superteam intent
Goal: prevent assembly of all-top-accuracy superteams. **Primary tool: salary cap + cost-scaling** (elite players cost proportionally more; an all-star roster blows the cap). Optional reinforcements: luxury tax on stacking, diminishing returns on homogeneous rosters, chemistry bonus for developing mid-tier players.

---

## 4. DECISION FLAGGED FOR LEGAL — recruit-restricted rostering

**Decision (owner):** Hiring will be **restricted to a player's own recruits.** Players may only roster people they personally brought into the game (recruits = Contacts in the Inbox). Stated design reasons: (a) prevent superteams, (b) keep the world contained in the Inbox, (c) make Contacts a meaningful gameplay surface.

**Status: NOT resolved as clean. Documented as the owner's decision, with an unresolved structural concern that must go to a lawyer before any real-money layer is introduced.**

Concern, recorded plainly so a future reviewer sees it:
- When the **only** path to an earning roster is people you personally recruited — and the design specifically targets recruiting your **friends, family, classmates, colleagues** — the resulting structure resembles a friends-and-family **downline**, even though earnings are roster-based and end when a member leaves. The *eligibility gate* (recruit-only) re-introduces recruitment-lineage dependence that the *earnings rule* (roster-based) had removed.
- "Restricted for competitive balance" is a true motivation but does **not** change the underlying structure a regulator would assess.
- Virtual currency limits exposure **only until** it touches anything of value. The roadmap includes **real cash prizes later**. At that point this gate must be re-examined.

Alternatives raised that achieve the same design goals without the gate (not adopted; recorded for the lawyer's context):
- Anti-superteam via **salary cap + cost-scaling** (works on an open pool; arguably stronger than gating).
- Inbox-containment via **inbox-native free agents** (signable players surfaced as incoming mail / a "Scouting" view) — keeps the world in the Inbox while allowing signing beyond personal recruits.

**Action item: legal review of the recruit-restricted rostering mechanic specifically, in the context of the planned real-money prize layer, before that layer ships.**

---

## 5. Marketing — gated-community / guerrilla strategy

- **Positioning:** Hitmail as an invite-only, "personally vetted" industry Inbox. Vouch / cosign mechanic to advance. Invite your network to climb network ranking. (Qualitative scarcity — "invite-only," "vetted," "approvals left this week.")
- **Queue number as identifier (OK):** "Your queue number is #24731," starting from a fixed offset and incrementing, presented as a **membership ID** — not a stated count of users. Do **not** pair with copy implying a headcount ("join 24,000+ others"). The distinction (identifier vs. asserted adoption figure) is the line that keeps it clear of deceptive-practices exposure.
- **Lead forms via the fictional label (OK with one condition):** "We're looking for A&Rs / promoters / marketing interns — request details" interest forms that route into Hitmail signup. Framed as the front door to a **real** opportunity Hitmail genuinely provides (the game's path to real artist-side reach), **not** a phantom job. The role/opportunity gestured at must be something the product actually delivers; otherwise it's the fake-job problem re-themed.
- **TCPA:** lead forms collect phone numbers. **Marketing-consent checkbox required at submission**, separate from any 2FA flag, before the SMS "You've got Hitmail" channel is used.

---

## 6. Data integrity

- **No in-app messaging** (by design) to limit coordination/collusion that would poison the crowd-average the scoring depends on.
- **Label Slack channel** is the **one** comms surface — accessible to label owner + employees only; owner moderates and can appoint employee-mods. **Fast-follow, not MVP.** Platform retains a backstop: a report path that reaches the platform and the ability to act (delegated moderation fails when the delegate is the problem).
- The messaging ban is a **partial** defense — friends-and-family labels will coordinate via real-life channels (group texts, Discord). **Add backend statistical collusion detection** (labels whose members rate suspiciously identically) regardless.

---

## 7. Currency & legal sequencing (carried from prior brief)

- Build the entire label/imprint economy in **virtual currency** now. Fully playable and motivating in points.
- **Skill-only ranking, free to participate, money cannot touch rank.** Status prizes first; **cash prizes later, behind a lawyer pass.**
- The lawyer pass should specifically cover: (1) the **recruit-restricted rostering** gate (§4), and (2) the cash-prize structure — these are the two riskiest dollars in the system and they interact.

---

## Open items
1. Trademark clearance on "Hitmail" / "Inbox" positioning (§1).
2. **Legal review of recruit-restricted rostering before any real-money layer** (§4).
3. Tune economy knobs — roster cap, per-slot salary, accuracy multiplier — via playtest.
4. UGC moderation layer for imprint pages (§2) and label Slack (§6).
5. Backend collusion detection (§6).
