'use strict';
// ═══ PICK THE HITS (055) ═════════════════════════════════════════════════════════════════
// The side bet without the tournament (operator, 2026-11-11). Same tables as 033 (packs,
// pack_songs, sidebet_entries, sidebet_picks) and the same entry flow on /hits (= /sidebet):
// pick N songs from the Service Pack, put them in order, confirm an email code.
//
// What changed:
//   • SCORING. Nothing is "played" any more. #1 on a ballot = N points to that song … #N = 1.
//     Songs rank by total; the ballot closest to that order wins (sidebet.js weightedTally /
//     ballotDistance / rankByDistance).
//   • ELIGIBILITY. Only ballots whose A&R Team profile is complete count, for the winner AND
//     for the song ranking (operator: "unfinished do not count").
//   • THE NOTIFY LIST. The pack is not always open. The page collects name, email and phone
//     (all required, operator 2026-11-13) into hits_subscribers, and two admin presses send:
//       'open'    — the pack is open (email + text), and
//       'results' — the public results email (winner, top songs, Pick the Hits, get featured).
//     Every past entrant is folded into the list at send time (email only; their phone was
//     never given for this).
//
// The seal still holds: nothing about pick counts or song points is public before settle,
// and after settle the public sees RANKS ONLY (no points, no number of entrants).
// Every query here is admin-triggered or a single signup — CLAUDE.md rule #1.

const { weightedTally, ballotDistance, rankByDistance } = require('./sidebet');

const PUSH_URL = 'https://www.makinitmag.com/push';
const SEND_BATCH = 60;

module.exports = function installHits(ctx) {
  const { db, id, now, send, bad, readBody, platformAdmin, sendEmail, escapeHtml, sendSms,
    smsNormalize, maskEmail, maskPhone, publicBase, activeUserSql, dispName, noteEmailOutcome } = ctx;
  const e = escapeHtml;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const str = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);

  const hitsUrl = () => publicBase() + '/hits';
  const hitsShort = () => hitsUrl().replace(/^https?:\/\//, '');
  const unsubUrl = (tok) => `${publicBase()}/api/hits/unsubscribe?u=${encodeURIComponent(tok)}`;
  // "$150" out of the pack's prize line ("$150 cash" → "$150"); null when there is no amount.
  const prizeOf = (pack) => { const m = /\$\s?[\d,]+/.exec((pack && pack.prize_text) || ''); return m ? m[0].replace(/\s/g, '') : null; };

  // ── the tally ──────────────────────────────────────────────────────────────────────
  // Eligible = complete A&R Team profile on an active account. One predicate, used by the
  // settle and by the entry screens, so "your entry counts" can never disagree with the tally.
  const ELIGIBLE_SQL = `u.profile_complete = 1 AND ${activeUserSql('u')}`;

  async function computeTally(pack) {
    const n = Number(pack.picks_required);
    const songs = await db.all('SELECT id, row_no FROM pack_songs WHERE pack_id = ?', [pack.id]);
    const entries = await db.all(
      `SELECT e.id, e.updated_at FROM sidebet_entries e JOIN users u ON u.uid = e.user_id
        WHERE e.pack_id = ? AND ${ELIGIBLE_SQL}`, [pack.id]);
    const ballots = [];
    for (const en of entries) {
      const picks = await db.all('SELECT pack_song_id, position FROM sidebet_picks WHERE entry_id = ?', [en.id]);
      ballots.push({ id: en.id, updated_at: Number(en.updated_at), picks });
    }
    const songsRanked = weightedTally(ballots, songs, n);
    const finalTop = songsRanked.filter(s => s.rank && s.rank <= n).map(s => s.id);
    const ranked = rankByDistance(ballots.map(b => ({ id: b.id, updated_at: b.updated_at, ...ballotDistance(b.picks, finalTop, n) })));
    return { n, songsRanked, finalTop, ranked };
  }

  // Score and publish. Re-runnable (a corrected profile, a removed test entry), so every
  // column it writes is written for EVERY row, not just the ones that changed.
  async function settle(pack) {
    const t = await computeTally(pack);
    await db.tx(async (tx) => {
      for (const s of t.songsRanked) {
        await tx.run('UPDATE pack_songs SET points = ?, pickers = ?, final_rank = ?, played = ? WHERE id = ?',
          [s.points, s.pickers, s.rank, s.rank && s.rank <= t.n ? 1 : 0, s.id]);
      }
      await tx.run('UPDATE sidebet_entries SET correct = NULL, distance = NULL, exact = NULL, rank = NULL WHERE pack_id = ?', [pack.id]);
      for (const r of t.ranked) {
        await tx.run('UPDATE sidebet_entries SET correct = ?, distance = ?, exact = ?, rank = ? WHERE id = ?',
          [r.hits, r.distance, r.exact, r.rank, r.id]);
      }
      await tx.run("UPDATE packs SET status = 'settled', settled_at = ?, scoring = 'weighted' WHERE id = ?", [now(), pack.id]);
    });
    return t;
  }

  // The public results of a settled Pick the Hits pack: the winner(s) and the top N, ranks
  // only. No points, no pick counts, no number of entrants (operator: never print the
  // denominator). Display name only for the winner.
  async function publicResults(pack) {
    const songs = await db.all(
      `SELECT id, title, artist, final_rank FROM pack_songs WHERE pack_id = ? AND final_rank IS NOT NULL AND final_rank <= ?
        ORDER BY final_rank ASC`, [pack.id, Number(pack.picks_required)]);
    const winners = await db.all(
      `SELECT u.name FROM sidebet_entries se JOIN users u ON u.uid = se.user_id
        WHERE se.pack_id = ? AND se.rank = 1 ORDER BY se.entry_no ASC`, [pack.id]);
    return {
      packId: pack.id, packName: pack.name, prize: prizeOf(pack),
      winners: winners.map(w => ({ name: dispName(w.name) })),
      songs: songs.map(s => ({ rank: Number(s.final_rank), title: s.title, artist: s.artist || null })),
    };
  }

  // One entrant's own result, for the page (their entry only, never anyone else's).
  async function entryResult(pack, entry) {
    const out = {
      rank: entry.rank == null ? null : Number(entry.rank),
      hits: entry.correct == null ? null : Number(entry.correct),
      exact: entry.exact == null ? null : Number(entry.exact),
      counted: entry.rank != null,
    };
    if (pack.status === 'settled') {
      const rows = await db.all(
        `SELECT sp.position, ps.final_rank FROM sidebet_picks sp JOIN pack_songs ps ON ps.id = sp.pack_song_id
          WHERE sp.entry_id = ? ORDER BY sp.position`, [entry.id]);
      out.finals = rows.map(r => (r.final_rank != null && Number(r.final_rank) <= Number(pack.picks_required)) ? Number(r.final_rank) : null);
    }
    return out;
  }

  async function isEligible(uid) {
    const r = await db.get(`SELECT 1 AS ok FROM users u WHERE u.uid = ? AND ${ELIGIBLE_SQL}`, [uid]);
    return !!r;
  }

  // ── the notify list ────────────────────────────────────────────────────────────────
  async function subscribe({ name, email, phone, source }) {
    email = str(email, 200).toLowerCase();
    name = str(name, 80);
    const ph = smsNormalize(phone);
    if (!name) return { error: 'Enter your name' };
    if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address' };
    if (!ph) return { error: 'Enter a valid mobile number' };
    const existing = await db.get('SELECT id FROM hits_subscribers WHERE email = ?', [email]);
    if (existing) {
      await db.run('UPDATE hits_subscribers SET name = ?, phone = ?, unsubscribed_at = NULL WHERE id = ?', [name, ph, existing.id]);
    } else {
      await db.run('INSERT INTO hits_subscribers (id, email, name, phone, unsub_token, source, created_at) VALUES (?,?,?,?,?,?,?)',
        [id(10), email, name, ph, id(20), str(source, 40) || 'page', now()]);
    }
    return { ok: true };
  }

  // Every past entrant joins the list (email only) the first time a send runs. A row that
  // already exists — a signup, or someone who unsubscribed — is left exactly as it is.
  async function foldInEntrants() {
    const rows = await db.all(
      `SELECT DISTINCT LOWER(u.email) AS email, u.name FROM sidebet_entries se JOIN users u ON u.uid = se.user_id
        WHERE ${activeUserSql('u')} AND COALESCE(u.email_opt_out, 0) = 0 AND u.email_bounced_at IS NULL
          AND u.email IS NOT NULL AND u.email NOT LIKE '%@deleted.invalid'
          AND NOT EXISTS (SELECT 1 FROM hits_subscribers h WHERE h.email = LOWER(u.email))`, []);
    for (const r of rows) {
      if (!EMAIL_RE.test(r.email || '')) continue;
      await db.run(
        `INSERT INTO hits_subscribers (id, email, name, phone, unsub_token, source, created_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (email) DO NOTHING`, [id(10), r.email, r.name || null, null, id(20), 'entrant', now()]);
    }
    return rows.length;
  }

  async function audience() {
    return db.all(
      `SELECT h.* FROM hits_subscribers h WHERE h.unsubscribed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = h.email AND u.email_bounced_at IS NOT NULL)
       ORDER BY h.created_at ASC`, []);
  }

  // ── messages ───────────────────────────────────────────────────────────────────────
  // Light email, the same shape as the approved mockup (public/_mock-pick-the-hits-landing.html).
  function shell({ eyebrow, body, unsub }) {
    return `<div style="background:#f1f0f6;padding:24px 12px;font-family:Archivo,Helvetica,Arial,sans-serif;color:#1b1830">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
<div style="background:#0e0c1a;padding:18px 24px"><span style="font-family:'Space Mono',Menlo,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9793b4;font-weight:bold">Makin' It · ${e(eyebrow)}</span></div>
<div style="padding:26px 24px">${body}</div>
<div style="padding:16px 24px 22px;border-top:1px solid #ecebf3;font-size:12px;line-height:1.5;color:#8a86a3">You're getting this because you signed up for Pick the Hits or entered a past pack.<br><a href="${e(unsub)}" style="color:#6b6788">Unsubscribe</a> · Makin' It Magazine</div>
</div></div>`;
  }
  const btn = (href, label, bg) => `<a href="${e(href)}" style="display:block;text-align:center;background:${bg};color:#ffffff;border-radius:10px;padding:14px;font-weight:800;font-size:16px;text-decoration:none;margin-top:14px">${e(label)}</a>`;
  const h1 = (t) => `<h1 style="font-size:30px;line-height:1.05;letter-spacing:-1px;margin:0 0 4px;font-weight:900">${e(t)}</h1>`;
  const para = (t) => `<p style="font-size:15.5px;line-height:1.55;color:#47435f;margin:12px 0 0">${t}</p>`;
  const firstName = (n) => (str(n, 80).split(/\s+/)[0] || '');
  const closesLabel = (ms) => ms ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(Number(ms))) + ' ET' : null;

  function openMessage(pack, sub) {
    const prize = prizeOf(pack);
    const win = prize ? ` for a chance to win ${prize}` : '';
    const subject = `${pack.name} is open. Pick the hits${prize ? `, win ${prize}` : ''}.`;
    const hi = firstName(sub.name) ? `Hi ${e(firstName(sub.name))}, ` : '';
    const closes = closesLabel(pack.closes_at);
    const html = shell({ eyebrow: 'Pick the Hits', unsub: unsubUrl(sub.unsub_token), body:
      h1(`${pack.name} is open.`) +
      para(`${hi}${e(pack.name)} is ready. Download it and pick your top ${Number(pack.picks_required)} songs${e(win)}${prize ? ' cash' : ''}.`) +
      (closes ? para(`Picks close ${e(closes)}.`) : '') +
      btn(hitsUrl(), 'Pick the Hits', '#2f8f2e') });
    const text = [`${pack.name} is open.`, '',
      `${firstName(sub.name) ? `Hi ${firstName(sub.name)}, ` : ''}${pack.name} is ready. Download it and pick your top ${Number(pack.picks_required)} songs${win}${prize ? ' cash' : ''}.`,
      closes ? `Picks close ${closes}.` : '', '', `Pick the Hits: ${hitsUrl()}`, '', `Unsubscribe: ${unsubUrl(sub.unsub_token)}`]
      .filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
    return { subject, html, text };
  }
  // Plain GSM-7, one segment where the pack name allows (sms.js switches to MMS if not).
  function openSms(pack) {
    const prize = prizeOf(pack);
    return `Makin' It: ${pack.name} is open. Download it and pick your top ${Number(pack.picks_required)}${prize ? ` for a chance to win ${prize}` : ''}: ${hitsShort()} Reply STOP to opt out`;
  }

  // The public results email. `openPack` = a pack open RIGHT NOW (the next one), which turns
  // the Pick the Hits box from "Notify me" into "Pick the Hits".
  function resultsMessage(R, sub, openPack) {
    const prize = R.prize;
    const winner = R.winners[0] ? R.winners.map(w => w.name).join(' and ') : null;
    const subject = winner ? `Pick the Hits results: ${winner} ${R.winners.length > 1 ? 'win' : 'wins'}${prize ? ` ${prize}` : ''}` : `Pick the Hits results: ${R.packName}`;
    const top = R.songs.slice(0, 10);
    const rows = top.map(s => `<tr><td style="width:40px;padding:9px 0;border-top:1px solid #ecebf3;font-family:'Space Mono',Menlo,monospace;font-weight:bold;color:${s.rank === 1 ? '#1a1400' : '#6b6788'}">${s.rank === 1 ? `<span style="background:#f5c518;padding:2px 7px;border-radius:3px">1</span>` : s.rank}</td><td style="padding:9px 0;border-top:1px solid #ecebf3;font-size:15px"><b>${e(s.title)}</b>${s.artist ? `<br><span style="color:#6b6788;font-size:13px">${e(s.artist)}</span>` : ''}</td></tr>`).join('');
    const nextBox = openPack
      ? `<h3 style="font-size:19px;margin:0;font-weight:900">${e(openPack.name)} is open now.</h3>${para(`Download it and pick your top ${Number(openPack.picks_required)}${prizeOf(openPack) ? ` for a chance to win ${e(prizeOf(openPack))}` : ''}.`)}${btn(hitsUrl(), 'Pick the Hits', '#2f8f2e')}`
      : `<h3 style="font-size:19px;margin:0;font-weight:900">Pick the Hits returns with the next Service Pack.</h3>${para(`Get notified when it opens and pick your top ${Number(R.n)}${prize ? ` for a chance to win ${e(prize)}` : ''}.`)}${btn(hitsUrl(), 'Notify me', '#2f8f2e')}`;
    const html = shell({ eyebrow: `Pick the Hits · ${R.packName}`, unsub: unsubUrl(sub.unsub_token), body:
      h1('The listeners picked the hits.') +
      para(`Listeners ranked their top ${Number(R.n)} songs from ${e(R.packName)}. Here is the final order${winner ? ' and the entry that came closest' : ''}.`) +
      (winner ? `<div style="margin-top:20px;border:1px solid #e3e1ee;border-radius:12px;padding:16px"><div style="font-family:'Space Mono',Menlo,monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6b6788;font-weight:bold">Winner</div><div style="font-size:22px;font-weight:900;letter-spacing:-.5px;margin-top:4px">${e(winner)}</div>${prize ? `<span style="display:inline-block;margin-top:6px;background:#f5c518;color:#1a1400;font-family:'Space Mono',Menlo,monospace;font-weight:bold;font-size:12px;padding:3px 8px;border-radius:4px">WINS ${e(prize)}</span>` : ''}</div>` : '') +
      `<h2 style="font-size:20px;font-weight:900;margin:26px 0 0">The top songs from ${e(R.packName)}</h2>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px">${rows}</table>` +
      `<p style="font-size:13.5px;margin:10px 0 0"><a href="${e(hitsUrl() + '?pack=' + encodeURIComponent(R.packId))}" style="color:#2f8f2e;font-weight:bold">See the full Top ${Number(R.n)}</a></p>` +
      `<div style="margin-top:24px;border-radius:12px;padding:18px;background:#f6f5fb;border:1px solid #e3e1ee;border-left:4px solid #2f8f2e">${nextBox}</div>` +
      `<div style="margin-top:16px;border-radius:12px;padding:18px;background:#f6f5fb;border:1px solid #e3e1ee;border-left:4px solid #4c3fbd"><h3 style="font-size:19px;margin:0;font-weight:900">Artists: get featured in the next Service Pack.</h3><ul style="margin:10px 0 0;padding-left:18px;color:#47435f;font-size:14.5px;line-height:1.6"><li>A&amp;R Service Pack placement · 450+ downloads</li><li>Spotify playlist placement</li><li>Promo video and collab post with @MakinIt4Indies</li></ul>${btn(PUSH_URL, 'Get featured', '#4c3fbd')}</div>` });
    const text = [
      'The listeners picked the hits.', '',
      `Listeners ranked their top ${R.n} songs from ${R.packName}.`,
      winner ? `Winner: ${winner}${prize ? ` wins ${prize}` : ''}` : '', '',
      `The top songs from ${R.packName}:`,
      ...top.map(s => `${s.rank}. ${s.title}${s.artist ? ` - ${s.artist}` : ''}`),
      `Full Top ${R.n}: ${hitsUrl()}?pack=${encodeURIComponent(R.packId)}`, '',
      openPack ? `${openPack.name} is open now. Pick the Hits: ${hitsUrl()}` : `Pick the Hits returns with the next Service Pack. Get notified: ${hitsUrl()}`, '',
      `Artists: get featured in the next Service Pack (A&R Service Pack placement, 450+ downloads; Spotify playlist placement; promo video and collab post with @MakinIt4Indies): ${PUSH_URL}`, '',
      `Unsubscribe: ${unsubUrl(sub.unsub_token)}`,
    ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
    return { subject, html, text };
  }

  // ── the sends ──────────────────────────────────────────────────────────────────────
  // A press writes one row per (channel, address) it has not written before for this pack and
  // kind, then drains with a claim (pending → sending). A second press therefore reaches only
  // who signed up since; the console loops the drain until nothing is pending.
  async function enqueue(pack, kind) {
    await foldInEntrants();
    const list = await audience();
    const t = now();
    let emails = 0, texts = 0;
    for (const s of list) {
      const r = await db.run(
        `INSERT INTO hits_sends (id, pack_id, kind, channel, dest, name, unsub_token, status, created_at)
         VALUES (?,?,?,?,?,?,?, 'pending', ?) ON CONFLICT (pack_id, kind, channel, dest) DO NOTHING`,
        [id(12), pack.id, kind, 'email', s.email, s.name || null, s.unsub_token, t]);
      if (r.changes) emails++;
      // Texts only for the "it's open" notice, and only to numbers given on the signup form.
      if (kind === 'open' && s.phone) {
        const r2 = await db.run(
          `INSERT INTO hits_sends (id, pack_id, kind, channel, dest, name, unsub_token, status, created_at)
           VALUES (?,?,?,?,?,?,?, 'pending', ?) ON CONFLICT (pack_id, kind, channel, dest) DO NOTHING`,
          [id(12), pack.id, kind, 'sms', s.phone, s.name || null, s.unsub_token, t]);
        if (r2.changes) texts++;
      }
    }
    return { emails, texts };
  }

  async function openPackNow() {
    return db.get("SELECT * FROM packs WHERE status = 'open' AND closes_at > ? ORDER BY created_at DESC LIMIT 1", [now()]);
  }

  async function drain(pack, kind, deadline) {
    let sent = 0, failed = 0;
    let R = null, openPack = null;
    if (kind === 'results') { R = { ...(await publicResults(pack)), n: Number(pack.picks_required) }; openPack = await openPackNow(); }
    for (;;) {
      if (Date.now() > deadline) break;
      const rows = await db.all("SELECT * FROM hits_sends WHERE pack_id = ? AND kind = ? AND status = 'pending' ORDER BY channel ASC, created_at ASC LIMIT ?", [pack.id, kind, SEND_BATCH]);
      if (!rows.length) break;
      for (const row of rows) {
        if (Date.now() > deadline) break;
        const claim = await db.run("UPDATE hits_sends SET status = 'sending' WHERE id = ? AND status = 'pending'", [row.id]);
        if (!claim.changes) continue;
        let r;
        try {
          if (row.channel === 'sms') r = await sendSms(row.dest, openSms(pack));
          else {
            const m = kind === 'open' ? openMessage(pack, row) : resultsMessage(R, row, openPack);
            r = await sendEmail(row.dest, m.subject, m.html, m.text, { tag: kind === 'open' ? 'hits_open' : 'hits_results', unsubscribe: unsubUrl(row.unsub_token) });
            if (noteEmailOutcome) { try { await noteEmailOutcome(row.dest, r); } catch (_) {} }
          }
        } catch (err) { r = { ok: false, error: err.message || 'error' }; }
        if (r && r.ok) { await db.run("UPDATE hits_sends SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", [now(), row.id]); sent++; }
        else { await db.run("UPDATE hits_sends SET status = 'failed', sent_at = ?, error = ? WHERE id = ?", [now(), String((r && r.error) || 'send failed').slice(0, 300), row.id]); failed++; }
      }
    }
    return { sent, failed };
  }

  async function sendState(packId) {
    const rows = await db.all('SELECT kind, channel, status, COUNT(*) AS c FROM hits_sends WHERE pack_id = ? GROUP BY kind, channel, status', [packId]);
    const out = {};
    for (const k of ['open', 'results']) out[k] = { email: { sent: 0, failed: 0, pending: 0 }, sms: { sent: 0, failed: 0, pending: 0 } };
    for (const r of rows) {
      const b = out[r.kind] && out[r.kind][r.channel]; if (!b) continue;
      const st = r.status === 'sending' ? 'pending' : r.status;
      if (b[st] != null) b[st] += Number(r.c);
    }
    return out;
  }

  // ── routes ─────────────────────────────────────────────────────────────────────────
  const ipHits = new Map();
  function tooMany(ip, max = 20, windowMs = 3600000) {
    const t = Date.now();
    const arr = (ipHits.get(ip) || []).filter(x => x > t - windowMs);
    arr.push(t); ipHits.set(ip, arr);
    if (ipHits.size > 5000) ipHits.clear();
    return arr.length > max;
  }

  async function handle(req, res, url) {
    const p = url.pathname, method = req.method;

    if (p === '/api/hits/notify' && method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      if (tooMany(ip)) return bad(res, 'Too many requests. Try again later.', 429);
      const b = await readBody(req);
      const r = await subscribe(b);
      if (r.error) return bad(res, r.error);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/hits/unsubscribe' && (method === 'GET' || method === 'POST')) {
      const tok = str(url.searchParams.get('u'), 64);
      if (tok) await db.run('UPDATE hits_subscribers SET unsubscribed_at = ? WHERE unsub_token = ? AND unsubscribed_at IS NULL', [now(), tok]);
      if (method === 'POST') return send(res, 200, { ok: true });   // the inbox's one-click button
      return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="background:#0e0c1a;color:#eae9f2;font-family:Archivo,Helvetica,Arial,sans-serif;padding:40px"><h1 style="font-size:24px">You're off the list.</h1><p style="color:#bdb6d8">You won't get Pick the Hits emails or texts any more.</p></body>`);
    }

    if (!p.startsWith('/api/admin/hits')) return false;
    const admin = await platformAdmin(req);
    if (!admin) return bad(res, 'Admin only', 403);
    const body = method === 'POST' ? await readBody(req) : {};
    const packId = method === 'POST' ? body.packId : url.searchParams.get('packId');
    const loadPack = async () => packId ? db.get('SELECT * FROM packs WHERE id = ?', [packId]) : null;

    // The card: list size, what each send has done, and (once settled) the standings.
    if (p === '/api/admin/hits' && method === 'GET') {
      const subs = await db.get('SELECT COUNT(*) AS c, SUM(CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END) AS ph FROM hits_subscribers WHERE unsubscribed_at IS NULL', []);
      const out = { list: { subscribed: Number(subs.c) || 0, withPhone: Number(subs.ph) || 0 }, pack: null };
      const pack = await loadPack();
      if (pack) {
        const counts = await db.get(
          `SELECT COUNT(*) AS c, SUM(CASE WHEN ${ELIGIBLE_SQL} THEN 1 ELSE 0 END) AS ok
             FROM sidebet_entries e JOIN users u ON u.uid = e.user_id WHERE e.pack_id = ?`, [pack.id]);
        out.pack = { id: pack.id, name: pack.name, status: pack.status, scoring: pack.scoring || null,
          open: pack.status === 'open' && now() < Number(pack.closes_at), closesAt: Number(pack.closes_at),
          entries: Number(counts.c) || 0, counting: Number(counts.ok) || 0, sends: await sendState(pack.id) };
        if (pack.status === 'settled' && pack.scoring === 'weighted') {
          out.songs = (await db.all('SELECT title, artist, points, pickers, final_rank FROM pack_songs WHERE pack_id = ? ORDER BY CASE WHEN final_rank IS NULL THEN 1 ELSE 0 END, final_rank ASC, row_no ASC', [pack.id]))
            .map(s => ({ rank: s.final_rank == null ? null : Number(s.final_rank), title: s.title, artist: s.artist || null, points: Number(s.points) || 0, pickers: Number(s.pickers) || 0 }));
          out.standings = (await db.all(
            `SELECT se.rank, se.distance, se.correct, se.exact, u.name, u.location FROM sidebet_entries se JOIN users u ON u.uid = se.user_id
              WHERE se.pack_id = ? AND se.rank IS NOT NULL ORDER BY se.rank ASC, se.entry_no ASC`, [pack.id]))
            .map(r => ({ rank: Number(r.rank), name: dispName(r.name), location: r.location || null, distance: Number(r.distance), hits: Number(r.correct), exact: Number(r.exact) }));
          out.notCounted = (await db.all(
            `SELECT u.name FROM sidebet_entries se JOIN users u ON u.uid = se.user_id WHERE se.pack_id = ? AND se.rank IS NULL ORDER BY se.entry_no`, [pack.id]))
            .map(r => dispName(r.name));
        }
      }
      return send(res, 200, out);
    }

    if (p === '/api/admin/hits/subscribers.csv' && method === 'GET') {
      const rows = await db.all('SELECT name, email, phone, source, created_at, unsubscribed_at FROM hits_subscribers ORDER BY created_at ASC', []);
      const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const iso = v => v ? new Date(Number(v)).toISOString() : '';
      const csv = ['name,email,phone,source,signed_up,unsubscribed', ...rows.map(r => [r.name, r.email, r.phone, r.source, iso(r.created_at), iso(r.unsubscribed_at)].map(q).join(','))].join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pick-the-hits-list.csv"', 'Cache-Control': 'no-store' });
      return res.end(csv);
    }

    if (p === '/api/admin/hits/settle' && method === 'POST') {
      const pack = await loadPack();
      if (!pack) return bad(res, 'Unknown pack', 404);
      if (pack.status === 'draft') return bad(res, 'This pack was never opened');
      if (pack.status === 'open' && now() < Number(pack.closes_at)) return bad(res, 'Picks are still open. Tally after they close.');
      const t = await settle(pack);
      if (!t.ranked.length) return send(res, 200, { ok: true, counted: 0, warning: 'No entry has a finished profile, so nothing counted.' });
      return send(res, 200, { ok: true, counted: t.ranked.length });
    }

    if (p === '/api/admin/hits/send' && method === 'POST') {
      const kind = body.kind === 'results' ? 'results' : body.kind === 'open' ? 'open' : null;
      if (!kind) return bad(res, 'Unknown send');
      const pack = await loadPack();
      if (!pack) return bad(res, 'Unknown pack', 404);
      if (kind === 'open' && !(pack.status === 'open' && now() < Number(pack.closes_at))) return bad(res, 'This pack is not open, so there is nothing to announce.');
      if (kind === 'results' && !(pack.status === 'settled' && pack.scoring === 'weighted')) return bad(res, 'Tally the results first.');
      const queued = body.drainOnly ? { emails: 0, texts: 0 } : await enqueue(pack, kind);
      const d = await drain(pack, kind, Date.now() + 20000);
      const st = await sendState(pack.id);
      const remaining = st[kind].email.pending + st[kind].sms.pending;
      return send(res, 200, { ok: true, queued, ...d, remaining, sends: st });
    }

    // A copy to the admin's own email (and phone, for the "open" text). Records nothing.
    if (p === '/api/admin/hits/test' && method === 'POST') {
      const kind = body.kind === 'results' ? 'results' : 'open';
      const pack = await loadPack();
      if (!pack) return bad(res, 'Unknown pack', 404);
      if (kind === 'results' && !(pack.status === 'settled' && pack.scoring === 'weighted')) return bad(res, 'Tally the results first.');
      const me = { name: admin.name, unsub_token: 'test' };
      const m = kind === 'open' ? openMessage(pack, me)
        : resultsMessage({ ...(await publicResults(pack)), n: Number(pack.picks_required) }, me, await openPackNow());
      const out = { ok: true };
      if (admin.email) {
        const r = await sendEmail(admin.email, '[TEST] ' + m.subject, m.html, m.text, { tag: 'hits_test' });
        out.email = r.ok ? maskEmail(admin.email) : null;
        if (!r.ok) out.emailError = r.error || 'send failed';
      }
      if (kind === 'open' && admin.phone) {
        const r = await sendSms(admin.phone, openSms(pack));
        out.sms = r.ok ? maskPhone(admin.phone) : null;
        if (!r.ok) out.smsError = r.error || 'send failed';
      }
      return send(res, 200, out);
    }
    return false;
  }

  return { handle, settle, publicResults, entryResult, isEligible, subscribe, _openSms: openSms, _openMessage: openMessage, _resultsMessage: resultsMessage, _computeTally: computeTally };
};
