# The A&R Room

A live, in-room song-rating prediction game. The host plays a song; everyone in the room rates it 1–10 **and** predicts the room's average. Closest prediction wins the round (ties broken by who locked in first). Rounds run **fully blind** — nobody sees the room's actual score until the session ends, when each player gets a **shareable recap card** (total points, letter grade, rank, and the big reveal of the room's average).

No long-term loop — built to run inside a single session at an event.

## Branding

Themed in the Makin' It palette (green `#4bb749`, purple `#403694`) with the Makin' It logos built in. The white primary wordmark sits in the player header and host bar; the white secondary emblem appears on the lobby and the recap card; the full-color mark is the favicon. The bundled files live in `public/` as `logo.png` (primary wordmark), `mark.png` (secondary emblem), and `mark-color.png` (favicon) — swap any of them to update the look. If a file is missing, a pulsing dot stands in.

Ad banners show in the lobby, during voting, and on the "locked in" screen — never on the results or recap (those stay clean for the reveal). Upload banners from the host console's **Ads** card. There's a three-level cascade, most specific wins:

1. **Per-song** — attach a banner to the song that's currently playing (shows during voting + locked for that round).
2. **Session** — one banner for the whole room.
3. **Global default** — your house banner, persists across every session until changed.

If none is set, the slot collapses (no empty box). Banners are uploaded as image files (PNG/JPG/GIF/WebP, recommended **320×100**, under 500KB) and stored in the database — so they persist on Vercel, no separate file hosting needed. An optional click-through URL opens in a new tab.

---

## What happens, start to finish

1. **Host** opens `/admin`, names the session → gets a QR code + link.
2. **Players** scan the QR → enter email → get a 6-digit code → enter it + their name → they're in the room.
3. Host **queues songs** (just a title, optionally artist / a note / a giveaway) — they stack in an "Up next" list you can reorder, **edit** (✎), or trim.
4. Host **opens** the next song with a countdown **in minutes**.
5. Players' phones flip to the song + a 1–10 rating dial + a "predict the room average" slider → they **lock in**.
6. Host can **extend** the timer, **close early**, **reopen** an accidentally-closed round (↺), or let it run out.
7. Host hits **tally** → reviews the ranked results and winner (the host *does* see the room average here, to announce winners), then pushes results to players — but players see only their points + reaction, never the room's number.
8. Open the next song from the queue. Repeat. Leaderboard accrues across rounds.
9. Host **ends the session** → every player gets a **shareable recap card** with the full reveal.

**Scoring:** room average = the mean of everyone's 1–10 ratings. Your points come from how close your *prediction* was to that average, on an exponential curve:

- **Exact / bullseye** (within 0.1): 100 points **+ a 25 bonus** = 125. 🎯
- The further off you are, the steeper the drop (≈61 at 1.0 off, ≈37 at 2.0 off).
- **More than 5.0 off**: a flat **−10 penalty** on top — a bad guess genuinely costs you, and a round score can go negative. 💀
- Your **lifetime total never drops below 0**, so a rough round stings without sinking you.

Winner of a round = smallest prediction error; exact ties go to whoever locked in earliest.

**Blind rounds + recap:** during the session players see their points, rank, and a reaction tier (bullseye / sharp / close / off / way off) — but **not** the room average or their exact error. When the host ends the session, each player gets a recap card: total points, a **letter grade** (from average read accuracy), their **rank + percentile** in the room, bullseye count, best round, and the **revealed room average**, with a Share button.

**Queue:** songs you add stack in a visible "Up next" list. Open the top one (or any one), reorder with the arrows, **edit** a song's details, or remove one. A song doesn't get a round number until you actually open it, and you can't open a new round while one is still mid-vote.

---

## Run it — two modes, same code

You need **Node.js 22.5+** (uses the built-in SQLite module — no native build step).

### Mode A — Local laptop (simplest; good for testing or same-WiFi rooms)

> **Upgrading from an earlier copy?** The scoring + queue update changed the database schema. Delete your old `roomtone.db` (and `roomtone.db-wal`, `roomtone.db-shm`) once before starting — a fresh one is created automatically. Your sessions are per-event anyway, so nothing of value is lost.

```bash
npm install
npm start
```

Open **http://localhost:3000/admin** to host. Players use **http://localhost:3000/** — but on a phone they need your laptop's LAN address, e.g. `http://192.168.1.40:3000/?s=SESSIONID` (the admin QR encodes this automatically if you open admin via your LAN IP instead of `localhost`).

- Email codes print to the **terminal** and also show on the player's screen (no real email needed). Set `EMAIL_PROVIDER` to send real ones.
- Data lives in `roomtone.db` next to the server. Delete it to wipe everything.

> ⚠️ Venue/guest WiFi often blocks phone-to-laptop traffic ("AP isolation"). If players can't reach your laptop, use Mode B.

### Mode B — Deployed (recommended for real events: a real URL anyone can scan over cellular)

1. Create a free Postgres DB (Neon or Supabase). Copy its connection string.
2. Deploy this folder to **Vercel** (`vercel` CLI or Git import).
3. Set env vars in Vercel:
   - `DATABASE_URL` = your Postgres string (this switches the app from SQLite → Postgres automatically)
   - `EMAIL_PROVIDER` = `resend` (or `mandrill`, or `console` to show codes on screen)
   - `EMAIL_FROM`, and `RESEND_API_KEY` **or** `MANDRILL_API_KEY` if sending real email
4. Open `https://yourapp.vercel.app/admin`, create a session, project the QR.

The QR encodes the deployed URL, so players join from any network.

---

## Email / OTP options

Set `EMAIL_PROVIDER`:

| Value | Behavior | Needs |
|---|---|---|
| `console` *(default)* | Code prints to server log **and** shows on the player's screen. Zero setup. | — |
| `resend` | Real email, fast, free tier, self-serve. **Easiest real email.** | `RESEND_API_KEY`, `EMAIL_FROM` |
| `mandrill` | Real email via Mailchimp Transactional. | `MANDRILL_API_KEY`, `EMAIL_FROM` |

If a real send fails, the code falls back to the server log + the player's screen so **a slow or blocked email never stalls the round**. See `.env.example`.

> Note: your **Mailchimp Marketing** account is not the same as Mailchimp Transactional (Mandrill) — Mandrill is a separate paid add-on. For a live event, `resend` or `console` is usually less hassle.

---

## Tests

```bash
npm test     # scoring unit tests + full HTTP end-to-end flow
```

---

## Files

- `server.js` — HTTP server, all API routes, round/scoring engine wiring
- `db.js` — picks SQLite (local) or Postgres (deployed) automatically
- `email.js` — swappable OTP sender (console / resend / mandrill)
- `scoring.js` — pure scoring (room average, points, ranking + tie-break)
- `public/play.html` — the player phone app
- `public/admin.html` — the host console
- `api/index.js`, `vercel.json` — deployment glue

---

## Running an event smoothly

- **Project the admin screen** (or keep it on a second device) — the QR and live vote feed are designed to be shown.
- **Pick a short voting window** (45–60s) and use **+30s** if the room needs more time.
- **Review before you ratify:** "Close & tally" shows you the ranked table and winner *before* results hit players' phones, so you can spot the giveaway winner first.
- Codes show on screen in `console` mode — fine for a trusted room; switch to `resend` if you want real verified emails for a follow-up.
