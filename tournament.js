'use strict';
// Tournament tooling — A&R Wars and the $1,000 Music Review Tournament on ONE model.
// Spec: docs/specs/tournament-spec.md. Pure bracket rules live in bracket.js; this file is the
// data layer + routes, installed by server.js with the helpers it needs (so the 11k-line
// server grows by a few lines, not a few hundred).

const B = require('./bracket');

const KINDS = {
  ar: {
    name: 'A&R Wars', slug: 'wars', lockupWord: 'WARS',
    prizeText: '$500 Cash Prize', prizeAmount: '$500', prizeLabel: 'Cash Prize',
    premise: '8 A&Rs play the songs they scouted. You vote on every matchup. The winner takes the cash prize.',
    question: 'Who has the Best Ear?',
  },
  artist: {
    name: "Makin' It $1,000 Music Review Tournament", slug: 'artist', lockupWord: 'TOURNAMENT',
    prizeText: '$1,000 Promo Budget', prizeAmount: '$1,000', prizeLabel: 'Promo Budget',
    premise: '8 artists play songs from their own catalog. You vote on every matchup. The winner takes the Promo Budget.',
    question: 'Who has the best record?',
  },
};
const STATUSES = ['draft', 'promo', 'live', 'complete'];
const REMIND_BATCH = 40;
const CTA_URL = 'makinitmag.com/ANR';
const CANDIDATE_WEEKS = 8;
const CANDIDATE_TTL_MS = 60000;

module.exports = function installTournaments(ctx) {
  const { db, id, now, send, bad, readBody, platformAdmin, realtime, shareCards, photoDataUri,
    uploadPng, sendEmail, escapeHtml, asanaFetch, asanaProject, weeklyReportData,
    lastCompleteWeekStart, etNextDay, etClockLabel, etEpoch, igClean, publicBase, queueRound,
    canAdminSession } = ctx;

  // ── labels ──────────────────────────────────────────────────────────────────────────
  const dateLabel = ts => ts ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(Number(ts))) : null;
  const timeLabel = ts => ts ? etClockLabel(ts) : null;   // etClockLabel already says ET
  const shortDate = ts => ts ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Number(ts))) : 'no date';
  function parseEventLocal(s) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return etEpoch(m[1], Number(m[2]), Number(m[3]));
  }
  function eventLocal(ts) {
    if (!ts) return '';
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = Object.fromEntries(f.formatToParts(new Date(Number(ts))).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  }
  const kindOf = t => KINDS[t.kind] || KINDS.ar;
  const cleanHandle = h => { const c = igClean ? igClean(h) : String(h || '').replace(/^@/, '').trim(); return c || null; };
  const str = (v, n = 200) => (v == null ? '' : String(v)).trim().slice(0, n);

  // ── loading ─────────────────────────────────────────────────────────────────────────
  async function loadById(tid) {
    const t = await db.get('SELECT * FROM tournaments WHERE id = ?', [tid]);
    return t ? hydrate(t) : null;
  }
  async function loadBySlug(slug) {
    const t = await db.get('SELECT * FROM tournaments WHERE slug = ?', [slug]);
    return t ? hydrate(t) : null;
  }
  async function loadLatest(kind) {
    const k = KINDS[kind] ? kind : 'ar';
    const t = await db.get(`SELECT * FROM tournaments WHERE kind = ? AND status IN ('promo','live') ORDER BY event_at ASC LIMIT 1`, [k])
      || await db.get(`SELECT * FROM tournaments WHERE kind = ? AND status = 'complete' ORDER BY event_at DESC LIMIT 1`, [k]);
    return t ? hydrate(t) : null;
  }
  async function hydrate(t) {
    const competitors = await db.all('SELECT * FROM tournament_competitors WHERE tournament_id = ? ORDER BY COALESCE(seat, seed) ASC, seed ASC', [t.id]);
    const matches = await db.all('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round_no ASC, slot ASC', [t.id]);
    const polls = matches.length
      ? await db.all(
        `SELECT r.id, r.tournament_match_id, r.status, r.split_a, r.created_at, r.song_title, r.song_artist, r.option_b_title, r.option_b_artist,
                (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id) AS votes
           FROM rounds r WHERE r.tournament_match_id IN (${matches.map(() => '?').join(',')}) ORDER BY r.created_at ASC`,
        matches.map(m => m.id))
      : [];
    let graphics = {};
    try { graphics = t.graphics ? JSON.parse(t.graphics) : {}; } catch { graphics = {}; }
    return { ...t, competitors, matches, polls, graphicsMap: graphics, photoCache: new Map() };
  }
  const pollsOf = (T, m) => T.polls.filter(p => p.tournament_match_id === m.id);
  const compById = (T, cid) => T.competitors.find(c => c.id === cid) || null;
  const anyDecided = T => T.matches.some(m => m.winner_id);
  const filledCount = T => T.competitors.length;
  function stageOf(T) {
    if (T.status === 'complete' && T.winner_competitor_id) return 'champion';
    if (filledCount(T) >= B.FIELD) return 'final';
    return 'seat';
  }
  function losers(T) {
    const out = new Set();
    for (const m of T.matches) if (m.winner_id) out.add(m.winner_id === m.a_id ? m.b_id : m.a_id);
    return out;
  }

  // ── public shape ────────────────────────────────────────────────────────────────────
  async function publicShape(T, { admin = false } = {}) {
    const K = kindOf(T);
    const out = losers(T);
    const showMatches = T.status === 'live' || T.status === 'complete' || admin;
    const champ = T.winner_competitor_id ? compById(T, T.winner_competitor_id) : null;
    let packOpen = null, liveSession = null;
    if (T.kind === 'ar' && T.pack_id) {
      const pk = await db.get("SELECT slug, prize_text, closes_at, status FROM packs WHERE id = ? AND status = 'open'", [T.pack_id]);
      if (pk) packOpen = { slug: pk.slug, prize: pk.prize_text || null, closesLabel: pk.closes_at ? `${shortDate(pk.closes_at)} · ${timeLabel(pk.closes_at)}` : null };
    }
    if (T.session_id && (T.status === 'live' || admin)) liveSession = { id: T.session_id, url: `/?s=${T.session_id}` };
    const subs = (await db.get('SELECT COUNT(*) AS c FROM tournament_subscribers WHERE tournament_id = ? AND unsubscribed_at IS NULL', [T.id])).c;
    return {
      id: T.id, kind: T.kind, name: T.name, number: T.number, slug: T.slug,
      prizeText: T.prize_text || K.prizeText, prizeAmount: K.prizeAmount, lockupWord: K.lockupWord,
      status: T.status, eventAt: T.event_at ? Number(T.event_at) : null,
      dateLabel: dateLabel(T.event_at), timeLabel: timeLabel(T.event_at), watchUrl: T.watch_url || null,
      finalPolls: Number(T.final_polls) || 3, premise: K.premise, question: K.question,
      filled: filledCount(T), packOpen, liveSession,
      competitors: T.competitors.map(c => ({
        id: c.id, seed: c.seed, seat: c.seat, name: c.name, handle: c.handle || null, city: c.city || null,
        photoUrl: c.photo_url || null, qualifiedLabel: c.qualified_label || null, out: out.has(c.id),
      })),
      matches: showMatches ? T.matches.map(m => ({
        id: m.id, round_no: m.round_no, slot: m.slot, a_id: m.a_id, b_id: m.b_id, winner_id: m.winner_id,
        decided_by: m.decided_by || null,
        live: pollsOf(T, m).some(p => ['listening', 'voting', 'closed'].includes(p.status)),
        polls: pollsOf(T, m).map(p => ({
          id: p.id, status: p.status, votes: Number(p.votes) || 0,
          split_a: p.status === 'ratified' && p.split_a != null ? Number(p.split_a) : null,   // THE SEAL
          songA: p.song_title ? `${p.song_title}${p.song_artist ? ' — ' + p.song_artist : ''}` : null,
          songB: p.option_b_title ? `${p.option_b_title}${p.option_b_artist ? ' — ' + p.option_b_artist : ''}` : null,
        })),
      })) : [],
      champion: champ ? { id: champ.id, name: champ.name, handle: champ.handle || null, photoUrl: champ.photo_url || null } : null,
      subscribers: Number(subs) || 0,
    };
  }

  // ── candidates: the weekly winners the seats come from ───────────────────────────────
  const candCache = new Map();
  async function candidates(T) {
    const hit = candCache.get(T.id);
    if (hit && hit.at > now() - CANDIDATE_TTL_MS) return hit.rows;
    const rows = [];
    const seatedUsers = new Set(T.competitors.map(c => c.user_id).filter(Boolean));
    const seatedNames = new Set(T.competitors.map(c => c.name.toLowerCase()));
    const seen = new Set();
    let week = lastCompleteWeekStart();
    for (let i = 0; i < CANDIDATE_WEEKS && week; i++, week = etNextDay(week, -7)) {
      let rep = null;
      try { rep = await weeklyReportData(week, { limit: 2 }); } catch (e) { console.error('[tournament] weekly read failed:', e.message); }
      if (!rep) continue;
      const label = `Week of ${rep.week.startLabel || week}`;
      if (T.kind === 'ar') {
        const list = rep.ars || [];
        const top = list[0];
        if (!top) continue;
        const repeat = seen.has(top.id);
        const pick = repeat && list[1] ? list[1] : top;
        seen.add(pick.id);
        rows.push({ week, label, userId: pick.id, name: pick.name, handle: cleanHandle(pick.ig), city: pick.location || null,
          photoUrl: null, points: pick.points, record: null, repeat, repeatOf: repeat ? top.name : null,
          seated: seatedUsers.has(pick.id), settled: rep.settled !== false });
      } else {
        const list = rep.songs || [];
        const top = list[0];
        if (!top) continue;
        const key = (top.artist || top.title || '').toLowerCase();
        const repeat = seen.has(key);
        const pick = repeat && list[1] ? list[1] : top;
        seen.add((pick.artist || pick.title || '').toLowerCase());
        rows.push({ week, label, userId: null, name: pick.artist || pick.title, handle: cleanHandle(pick.ig), city: null,
          photoUrl: null, score: pick.score, record: pick.title, repeat, repeatOf: repeat ? (top.artist || top.title) : null,
          seated: seatedNames.has((pick.artist || pick.title || '').toLowerCase()), settled: rep.settled !== false });
      }
    }
    // photos for the A&R rows, one query
    const uids = rows.map(r => r.userId).filter(Boolean);
    if (uids.length) {
      const us = await db.all(`SELECT uid, photo_url, location FROM users WHERE uid IN (${uids.map(() => '?').join(',')})`, uids);
      const by = new Map(us.map(u => [u.uid, u]));
      for (const r of rows) { const u = r.userId && by.get(r.userId); if (u) { r.photoUrl = u.photo_url || null; r.city = r.city || u.location || null; } }
    }
    candCache.set(T.id, { at: now(), rows });
    return rows;
  }

  // ── graphics rows ───────────────────────────────────────────────────────────────────
  function graphicRows(T) {
    const n = filledCount(T);
    const rows = [];
    const seats = [...T.competitors].sort((a, b) => (a.seat || a.seed) - (b.seat || b.seed));
    for (let i = 1; i <= B.FIELD; i++) {
      const c = seats[i - 1];
      rows.push({ key: `seat${i}`, label: c ? `Seat ${i} · ${c.name}` : `Seat ${i}`, ready: !!c, kinds: ['feed', 'story', 'thumb'] });
    }
    rows.push({ key: 'final', label: 'Final promo · all 8 seats', ready: n >= B.FIELD, kinds: ['feed', 'story', 'thumb'] });
    rows.push({ key: 'champion', label: 'Champion', ready: !!T.winner_competitor_id, kinds: ['feed', 'story', 'thumb'] });
    rows.push({ key: 'bracket', label: 'Bracket (event night)', ready: T.matches.length > 0, kinds: ['bracket'] });
    return rows.map(r => {
      const g = T.graphicsMap[r.key] || null;
      return { ...r, urls: g && g.urls ? g.urls : null, publishedAt: g ? g.publishedAt || null : null,
        asanaTaskId: g ? g.asanaTaskId || null : null, asanaUrl: g ? g.asanaUrl || null : null };
    });
  }
  function keyToRender(T, key) {
    // → { stage, filled } for the flyers, or { bracket: true }
    if (key === 'bracket') return { bracket: true };
    if (key === 'champion') return { stage: 'champion', filled: filledCount(T) };
    if (key === 'final') return { stage: 'final', filled: B.FIELD };
    const m = /^seat(\d)$/.exec(key || '');
    if (m) return { stage: 'seat', filled: Number(m[1]) };
    return null;
  }

  // ── Satori data ─────────────────────────────────────────────────────────────────────
  const SIL = null; // photo null → the element draws the silhouette
  // One fetch per competitor per hydrated tournament — the zip renders ~30 graphics off one T.
  async function photoOf(T, c) {
    if (!c.photo_url) return SIL;
    if (!T.photoCache) T.photoCache = new Map();
    if (!T.photoCache.has(c.id)) T.photoCache.set(c.id, await photoDataUri(c.photo_url));
    return T.photoCache.get(c.id);
  }
  async function flyerData(T, { stage, filled } = {}) {
    const K = kindOf(T);
    const seats = [...T.competitors].sort((a, b) => (a.seat || a.seed) - (b.seat || b.seed));
    const n = Math.max(0, Math.min(B.FIELD, filled != null ? Number(filled) : seats.length));
    const st = stage || stageOf(T);
    const champ = T.winner_competitor_id ? compById(T, T.winner_competitor_id) : null;
    const qualifier = st === 'seat' ? seats[n - 1] || null : null;
    const bigC = st === 'champion' ? champ : qualifier;
    const photos = new Map();
    for (const c of seats.slice(0, st === 'seat' ? n : B.FIELD)) photos.set(c.id, await photoOf(T, c));
    const eyebrow = `${K.name === KINDS.ar.name ? 'A&R Wars' : "$1,000 Music Review Tournament"} #${T.number || 1}`;
    let headline, big, cta;
    if (st === 'champion') {
      headline = champ ? `${champ.name} wins ${K.prizeAmount}.` : `${K.name} champion`;
      big = champ ? { name: champ.name, handle: champ.handle || null, photo: photos.get(champ.id) || SIL, tag: 'Champion' } : null;
      cta = { label: 'Watch the replay', url: CTA_URL };
    } else if (st === 'final') {
      headline = K.question; big = null; cta = { label: 'Vote live at', url: CTA_URL };
    } else {
      headline = qualifier ? `${qualifier.name} qualified.` : `${K.name} #${T.number || 1}`;
      big = qualifier ? { name: qualifier.name, handle: qualifier.handle || null, photo: photos.get(qualifier.id) || SIL,
        tag: qualifier.qualified_label ? `Qualified · ${qualifier.qualified_label}` : `Qualified · Seat ${n}` } : null;
      cta = { label: 'Watch live at', url: CTA_URL };
    }
    const shown = st === 'seat' ? n : B.FIELD;
    const seatRows = [];
    for (let i = 0; i < B.FIELD; i++) {
      const c = i < shown ? seats[i] : null;
      seatRows.push({ n: i + 1, name: c ? c.name : null, photo: c ? (photos.get(c.id) || SIL) : SIL, filled: !!c,
        ring: c && champ && st === 'champion' && c.id === champ.id ? 'champion' : (c && qualifier && c.id === qualifier.id ? 'qualifier' : null) });
    }
    return { lockupWord: K.lockupWord, eyebrow, dateLabel: dateLabel(T.event_at) || 'Date to be announced', timeLabel: timeLabel(T.event_at) || '',
      stage: st, headline, premise: K.premise, prizeAmount: K.prizeAmount, prizeLabel: K.prizeLabel, big, seats: seatRows, cta, bigC };
  }
  async function bracketData(T) {
    const K = kindOf(T);
    const photos = new Map();
    for (const c of T.competitors) photos.set(c.id, await photoOf(T, c));
    const side = cid => { const c = cid ? compById(T, cid) : null; return c ? { name: c.name, seed: c.seed, sub: c.handle ? '@' + c.handle : (c.city || ''), photo: photos.get(c.id) || null } : null; };
    const mm = m => ({ a: side(m.a_id), b: side(m.b_id), winner: m.winner_id ? (m.winner_id === m.a_id ? 'a' : 'b') : null });
    const r1 = T.matches.filter(m => m.round_no === 1).map(mm);
    const r2 = T.matches.filter(m => m.round_no === 2).map(mm);
    const fm = T.matches.find(m => m.round_no === 3);
    const champ = T.winner_competitor_id ? compById(T, T.winner_competitor_id) : null;
    const eyebrow = `${T.kind === 'ar' ? 'A&R Wars' : "$1,000 Music Review Tournament"} #${T.number || 1}`;
    return { lockupWord: K.lockupWord, eyebrow, dateLabel: dateLabel(T.event_at) || '', timeLabel: timeLabel(T.event_at) || '', prizeAmount: K.prizeAmount,
      r1, r2, final: fm ? mm(fm) : { a: null, b: null, winner: null },
      champion: champ ? { name: champ.name, photo: photos.get(champ.id) || null } : null,
      cta: { label: champ ? 'Watch the replay' : 'Vote live at', url: CTA_URL } };
  }
  async function renderKey(T, key, kind) {
    const r = keyToRender(T, key);
    if (!r) throw new Error('Unknown graphic');
    if (r.bracket) return shareCards.renderPng('tournamentBracket', await bracketData(T));
    const d = await flyerData(T, r);
    const type = kind === 'story' ? 'tournamentStory' : kind === 'thumb' ? 'tournamentThumb' : 'tournamentFeed';
    return shareCards.renderPng(type, d);
  }

  // ── caption (SEO rule: plain words, first line carries the terms, no topic hashtags) ──
  async function caption(T, key) {
    const K = kindOf(T);
    const r = keyToRender(T, key) || { stage: stageOf(T), filled: filledCount(T) };
    const seats = [...T.competitors].sort((a, b) => (a.seat || a.seed) - (b.seat || b.seed));
    const when = `${dateLabel(T.event_at) || 'date to be announced'}${T.event_at ? ' at ' + timeLabel(T.event_at) : ''}`;
    const tag = c => c.handle ? '@' + c.handle : c.name;
    const who = T.kind === 'ar' ? 'A&Rs' : 'artists';
    const join = T.kind === 'ar' ? 'Comment #ANR to join the A&R Team and vote.' : 'Comment #REVIEW to submit your music.';
    let lines = [], comments = [];
    if (r.bracket) {
      lines = [`${K.name} #${T.number || 1} bracket. ${who === 'A&Rs' ? 'Eight A&Rs' : 'Eight artists'}, single elimination, every matchup decided by the A&R Team's vote.`, `${when}. ${K.premise}`, join];
    } else if (r.stage === 'champion') {
      const champ = T.winner_competitor_id ? compById(T, T.winner_competitor_id) : null;
      lines = [`${champ ? champ.name : 'The champion'} wins ${K.name} #${T.number || 1} and the ${K.prizeText}.`,
        `${champ && champ.handle ? '@' + champ.handle + ' ' : ''}${K.premise}`, join];
    } else if (r.stage === 'final') {
      lines = [`${K.name} #${T.number || 1} is ${when}. ${K.question}`, K.premise, `Vote live at ${CTA_URL}.`, join];
      comments = chunk(seats.map(tag), 4).map(g => `The ${who} in the tournament: ${g.join(', ')}`);
    } else {
      const q = seats[r.filled - 1];
      lines = [`${q ? q.name : 'A new competitor'} qualified for ${K.name} #${T.number || 1}${q && q.qualified_label ? ' (' + q.qualified_label + ')' : ''}.`,
        `${q && q.handle ? '@' + q.handle + ' ' : ''}${K.premise} ${when}.`, `Vote live at ${CTA_URL}.`, join];
      const others = seats.slice(0, r.filled - 1);
      if (others.length) comments = chunk(others.map(tag), 4).map(g => `Also in the tournament: ${g.join(', ')}`);
    }
    return { caption: lines.join('\n\n'), comments, tagOnGraphic: seats.slice(0, r.bracket ? B.FIELD : (r.stage === 'seat' ? r.filled : B.FIELD)).map(tag) };
  }
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

  // ── bracket writes ──────────────────────────────────────────────────────────────────
  async function writeMatches(T, matches) {
    for (const m of matches) {
      const cur = T.matches.find(x => x.round_no === m.round_no && x.slot === m.slot);
      if (!cur) continue;
      if (cur.a_id === m.a_id && cur.b_id === m.b_id && cur.winner_id === m.winner_id && (cur.decided_by || null) === (m.decided_by || null)) continue;
      await db.run('UPDATE tournament_matches SET a_id = ?, b_id = ?, winner_id = ?, decided_by = ?, decided_at = ? WHERE id = ?',
        [m.a_id, m.b_id, m.winner_id, m.winner_id ? (m.decided_by || null) : null, m.winner_id ? (m.decided_at || now()) : null, cur.id]);
    }
  }
  async function rebuildBracket(T) {
    if (anyDecided(T)) throw new Error('The bracket has a decided match — it can no longer be rebuilt');
    await db.run('DELETE FROM tournament_matches WHERE tournament_id = ?', [T.id]);
    if (filledCount(T) < B.FIELD) return;
    const ms = B.buildBracket(T.competitors.map(c => ({ id: c.id, seed: c.seed })));
    for (const m of ms) {
      await db.run('INSERT INTO tournament_matches (id, tournament_id, round_no, slot, a_id, b_id, winner_id) VALUES (?,?,?,?,?,?,NULL)',
        [id(9), T.id, m.round_no, m.slot, m.a_id, m.b_id]);
    }
  }
  async function finishIfChampion(T, matches) {
    const champ = B.champion(matches);
    if (champ) {
      await db.run("UPDATE tournaments SET status = 'complete', winner_competitor_id = ? WHERE id = ?", [champ, T.id]);
    } else if (T.status === 'complete') {
      await db.run("UPDATE tournaments SET status = 'live', winner_competitor_id = NULL WHERE id = ?", [T.id]);
    }
  }
  // Called by ratifyAndPublish for every ratified round. Only tournament polls do anything.
  async function onRoundRatified(round) {
    if (!round || !round.tournament_match_id) return;
    const m = await db.get('SELECT * FROM tournament_matches WHERE id = ?', [round.tournament_match_id]);
    if (!m || m.winner_id) return;                       // a host decision is sticky
    const T = await loadById(m.tournament_id);
    if (!T) return;
    const needed = m.round_no === 3 ? (Number(T.final_polls) || 3) : 1;
    const polls = pollsOf(T, m).filter(p => p.status === 'ratified');
    const d = B.decideMatch(polls, needed);
    if (!d.winner) return;
    const winnerId = d.winner === 'A' ? m.a_id : m.b_id;
    const next = B.applyWinner(T.matches, m.round_no, m.slot, winnerId).map(x => ({ ...x, decided_by: x.round_no === m.round_no && x.slot === m.slot ? 'polls' : x.decided_by }));
    await writeMatches(T, next);
    await finishIfChampion(T, next);
    if (T.session_id) { try { await realtime.publish(T.session_id, 'tournament'); } catch {} }
  }

  // ── reminders ───────────────────────────────────────────────────────────────────────
  function reminderEmail(T, sub) {
    const K = kindOf(T);
    const base = publicBase();
    const watch = T.watch_url || `${base}/tournament/${T.slug}`;
    const unsub = `${base}/api/tournament/unsubscribe?u=${encodeURIComponent(sub.unsub_token)}`;
    const when = `${dateLabel(T.event_at)} at ${timeLabel(T.event_at)}`;
    const hi = sub.name ? `Hi ${escapeHtml(sub.name)},` : 'Hi,';
    const subject = `${K.name} #${T.number || 1} is today — ${timeLabel(T.event_at)}`;
    const text = `${sub.name ? 'Hi ' + sub.name + ',' : 'Hi,'}\n\n${K.name} #${T.number || 1} goes live ${when}.\n\n${K.premise}\n\nWatch and vote: ${watch}\n\nYou asked for this one reminder at ${base}/tournament/${T.slug}. Unsubscribe: ${unsub}`;
    const html = `<div style="font-family:Archivo,Helvetica,Arial,sans-serif;background:#0e0c1a;color:#eae9f2;padding:28px;max-width:560px;margin:0 auto">
<p style="font-family:'Space Mono',Menlo,monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#9793b4;margin:0 0 14px">Makin' It Magazine presents</p>
<h1 style="font-size:30px;line-height:1.05;letter-spacing:-.03em;margin:0 0 16px">${escapeHtml(K.name)} #${T.number || 1}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 10px">${hi}</p>
<p style="font-size:16px;line-height:1.5;margin:0 0 10px">It goes live <b>${escapeHtml(when)}</b>.</p>
<p style="font-size:15px;line-height:1.5;color:#bdb6d8;margin:0 0 22px">${escapeHtml(K.premise)}</p>
<p style="margin:0 0 26px"><a href="${escapeHtml(watch)}" style="display:inline-block;background:#4bb749;color:#06210b;font-weight:800;font-size:16px;padding:14px 22px;border-radius:12px;text-decoration:none">Watch and vote</a></p>
<p style="font-size:12px;line-height:1.5;color:#8c84ad;margin:0">You asked for this one reminder on the tournament page. <a href="${escapeHtml(unsub)}" style="color:#8c84ad">Unsubscribe</a></p></div>`;
    return { subject, html, text, unsub };
  }
  // Send up to `limit` reminders for one tournament. Rows are CLAIMED (reminded_at stamped)
  // before the send so a double-invoked cron can never send twice; a failed send is logged.
  async function sendReminders(T, { limit = REMIND_BATCH, deadline = Infinity } = {}) {
    if (!T.event_at) return { sent: 0, remaining: 0 };
    let sent = 0;
    while (sent < limit && Date.now() < deadline) {
      const sub = await db.get('SELECT * FROM tournament_subscribers WHERE tournament_id = ? AND reminded_at IS NULL AND unsubscribed_at IS NULL ORDER BY created_at ASC LIMIT 1', [T.id]);
      if (!sub) break;
      const claimed = await db.run('UPDATE tournament_subscribers SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL', [now(), sub.id]);
      if (claimed && claimed.changes === 0) continue;
      const m = reminderEmail(T, sub);
      const r = await sendEmail(sub.email, m.subject, m.html, m.text, { tag: 'tournament_reminder', unsubscribe: m.unsub });
      if (!r.ok) console.error('[tournament] reminder failed:', sub.email, r.error);
      sent++;
    }
    const remaining = (await db.get('SELECT COUNT(*) AS c FROM tournament_subscribers WHERE tournament_id = ? AND reminded_at IS NULL AND unsubscribed_at IS NULL', [T.id])).c;
    return { sent, remaining: Number(remaining) || 0 };
  }
  // The cron step: tournaments whose reminder time has come (remind_min before event_at,
  // up to an hour after — a cron that was down for the window must not text at midnight).
  async function drainReminders({ deadline = Date.now() + 8000, ts = now() } = {}) {
    const rows = await db.all(`SELECT * FROM tournaments WHERE status IN ('promo','live') AND remind_min > 0 AND event_at IS NOT NULL
      AND event_at - remind_min * 60000 <= ? AND event_at + 3600000 >= ?`, [ts, ts]);
    let sent = 0;
    for (const t of rows) {
      if (Date.now() >= deadline) break;
      const T = await hydrate(t);
      const r = await sendReminders(T, { limit: REMIND_BATCH, deadline });
      sent += r.sent;
    }
    return { sent };
  }

  // ── homepage winners ────────────────────────────────────────────────────────────────
  async function homeWinners(limit = 6) {
    const rows = await db.all(`SELECT t.id, t.kind, t.name, t.number, t.slug, t.event_at, c.name AS cname, c.handle, c.photo_url
      FROM tournaments t JOIN tournament_competitors c ON c.id = t.winner_competitor_id
      WHERE t.status = 'complete' ORDER BY t.event_at DESC LIMIT ?`, [limit]);
    return rows.map(r => ({ id: r.id, kind: r.kind, name: r.name, number: r.number, slug: r.slug, dateLabel: dateLabel(r.event_at),
      champion: { name: r.cname, handle: r.handle || null, photoUrl: r.photo_url || null } }));
  }

  // ── rate limit for the public reminder form (per instance, good enough for a form) ──
  const hits = new Map();
  function tooMany(ip, max = 20, windowMs = 3600000) {
    const t = Date.now();
    const arr = (hits.get(ip) || []).filter(x => x > t - windowMs);
    arr.push(t); hits.set(ip, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length > max;
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ── routes ──────────────────────────────────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname, method = req.method;

    // ---------- public ----------
    if (p === '/api/tournament' && method === 'GET') {
      const slug = url.searchParams.get('slug');
      const T = slug ? await loadBySlug(slug) : await loadLatest(url.searchParams.get('kind') || 'ar');
      if (!T || T.status === 'draft') return bad(res, 'No tournament is scheduled', 404);
      return send(res, 200, { tournament: await publicShape(T) }, { 'Cache-Control': 'no-store' });
    }
    if (p === '/api/tournament/remind' && method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      if (tooMany(ip)) return bad(res, 'Too many requests — try again later', 429);
      const body = await readBody(req);
      const email = str(body.email, 200).toLowerCase();
      if (!EMAIL_RE.test(email)) return bad(res, 'Enter a valid email address');
      const T = body.slug ? await loadBySlug(str(body.slug, 80)) : null;
      if (!T || T.status === 'draft') return bad(res, 'No tournament is scheduled', 404);
      if (T.status === 'complete' || (T.event_at && Number(T.event_at) < now())) return bad(res, 'This tournament has already started', 409);
      const existing = await db.get('SELECT id FROM tournament_subscribers WHERE tournament_id = ? AND email = ?', [T.id, email]);
      if (existing) await db.run('UPDATE tournament_subscribers SET unsubscribed_at = NULL, name = COALESCE(NULLIF(?, \'\'), name) WHERE id = ?', [str(body.name, 80), existing.id]);
      else await db.run('INSERT INTO tournament_subscribers (id, tournament_id, email, name, unsub_token, created_at) VALUES (?,?,?,?,?,?)',
        [id(9), T.id, email, str(body.name, 80) || null, id(18), now()]);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/tournament/unsubscribe' && (method === 'GET' || method === 'POST')) {
      const tok = str(url.searchParams.get('u'), 64);
      if (tok) await db.run('UPDATE tournament_subscribers SET unsubscribed_at = ? WHERE unsub_token = ? AND unsubscribed_at IS NULL', [now(), tok]);
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><body style="background:#0e0c1a;color:#eae9f2;font-family:Archivo,Helvetica,Arial,sans-serif;padding:40px"><h1 style="font-size:24px">You're off the list.</h1><p style="color:#bdb6d8">You will not get a reminder for this tournament.</p></body>`);
    }

    if (!p.startsWith('/api/admin/tournament')) return false;
    // ---------- admin (platform admin only — a tournament spans every room) ----------
    const admin = await platformAdmin(req);
    if (!admin) return bad(res, 'Admin only', 403);
    const body = method === 'POST' ? await readBody(req) : {};
    const tid = method === 'POST' ? body.tournamentId || body.id : url.searchParams.get('id');
    const needT = async () => { const T = tid ? await loadById(tid) : null; if (!T) { bad(res, 'Tournament not found', 404); return null; } return T; };

    if (p === '/api/admin/tournaments' && method === 'GET') {
      const rows = await db.all('SELECT * FROM tournaments ORDER BY COALESCE(event_at, created_at) DESC', []);
      const out = [];
      for (const t of rows) {
        const filled = (await db.get('SELECT COUNT(*) AS c FROM tournament_competitors WHERE tournament_id = ?', [t.id])).c;
        const champ = t.winner_competitor_id ? await db.get('SELECT name FROM tournament_competitors WHERE id = ?', [t.winner_competitor_id]) : null;
        out.push({ id: t.id, kind: t.kind, name: t.name, number: t.number, slug: t.slug, status: t.status, eventAt: t.event_at ? Number(t.event_at) : null,
          dateLabel: dateLabel(t.event_at), shortLabel: shortDate(t.event_at), timeLabel: timeLabel(t.event_at), filled: Number(filled) || 0, champion: champ ? champ.name : null });
      }
      return send(res, 200, { tournaments: out });
    }

    if (p === '/api/admin/tournament' && method === 'POST') {
      const kind = KINDS[body.kind] ? body.kind : null;
      let T = body.id ? await loadById(body.id) : null;
      if (!T && !kind) return bad(res, 'Pick the tournament kind');
      const K = KINDS[T ? T.kind : kind];
      const number = body.number != null && body.number !== '' ? Math.max(1, Math.min(999, Number(body.number) || 1)) : (T ? T.number : null);
      const eventAt = body.eventLocal ? parseEventLocal(body.eventLocal) : (body.eventAt ? Number(body.eventAt) : (T ? T.event_at : null));
      if (body.eventLocal && eventAt == null) return bad(res, 'Event date and time are not valid');
      const finalPolls = body.finalPolls != null && body.finalPolls !== '' ? Math.max(1, Math.min(9, Number(body.finalPolls) || 3)) : (T ? T.final_polls : 3);
      const remindMin = body.remindMin != null && body.remindMin !== '' ? Math.max(0, Math.min(10080, Number(body.remindMin) || 0)) : (T ? T.remind_min : 120);
      const sessionId = 'sessionId' in body ? (str(body.sessionId, 40) || null) : (T ? T.session_id : null);
      if (sessionId && !(await db.get('SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL', [sessionId]))) return bad(res, 'Session not found', 404);
      const packId = 'packId' in body ? (str(body.packId, 40) || null) : (T ? T.pack_id : null);
      if (packId && !(await db.get('SELECT id FROM packs WHERE id = ?', [packId]))) return bad(res, 'Service Pack not found', 404);
      const watchUrl = 'watchUrl' in body ? (str(body.watchUrl, 500) || null) : (T ? T.watch_url : null);
      if (watchUrl && !/^https?:\/\//i.test(watchUrl)) return bad(res, 'Watch link must start with http');
      const prizeText = 'prizeText' in body ? (str(body.prizeText, 80) || K.prizeText) : (T ? T.prize_text : K.prizeText);
      const name = 'name' in body && str(body.name, 120) ? str(body.name, 120) : (T ? T.name : K.name);
      if (!T) {
        const nid = id(9);
        let slug = `${K.slug}-${number || 1}`;
        if (await db.get('SELECT id FROM tournaments WHERE slug = ?', [slug])) slug = `${slug}-${id(3).toLowerCase()}`;
        await db.run(`INSERT INTO tournaments (id, kind, name, number, slug, prize_text, status, event_at, session_id, pack_id, watch_url, final_polls, remind_min, created_by, created_at)
          VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?)`, [nid, kind, name, number || 1, slug, prizeText, eventAt, sessionId, packId, watchUrl, finalPolls, remindMin, admin.uid, now()]);
        return send(res, 200, { id: nid, slug });
      }
      await db.run(`UPDATE tournaments SET name = ?, number = ?, prize_text = ?, event_at = ?, session_id = ?, pack_id = ?, watch_url = ?, final_polls = ?, remind_min = ? WHERE id = ?`,
        [name, number, prizeText, eventAt, sessionId, packId, watchUrl, finalPolls, remindMin, T.id]);
      return send(res, 200, { id: T.id, slug: T.slug });
    }

    if (p === '/api/admin/tournament' && method === 'GET') {
      const T = await needT(); if (!T) return true;
      const pub = await publicShape(T, { admin: true });
      const sessions = await db.all(`SELECT id, name, status FROM sessions WHERE deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') AND status IN ('upcoming','live') ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT 40`, []);
      const packs = await db.all('SELECT id, name, status FROM packs ORDER BY created_at DESC LIMIT 20', []);
      let packSongs = [];
      if (T.pack_id) {
        const played = new Set(T.polls.flatMap(() => []));
        packSongs = await db.all('SELECT id, row_no, title, artist, played FROM pack_songs WHERE pack_id = ? ORDER BY row_no ASC', [T.pack_id]);
        const used = await db.all('SELECT pack_song_a AS a, pack_song_b AS b FROM rounds WHERE session_id = ? AND status <> \'pending\' AND (pack_song_a IS NOT NULL OR pack_song_b IS NOT NULL)', [T.session_id || '']);
        for (const u of used) { if (u.a) played.add(u.a); if (u.b) played.add(u.b); }
        packSongs = packSongs.map(s => ({ id: s.id, rowNo: s.row_no, title: s.title, artist: s.artist, played: !!s.played || played.has(s.id) }));
      }
      const subs = await db.get('SELECT COUNT(*) AS c, SUM(CASE WHEN reminded_at IS NOT NULL THEN 1 ELSE 0 END) AS r FROM tournament_subscribers WHERE tournament_id = ? AND unsubscribed_at IS NULL', [T.id]);
      const ars = (await db.get('SELECT COUNT(*) AS c FROM tournament_subscribers s JOIN users u ON LOWER(u.email) = s.email WHERE s.tournament_id = ? AND s.unsubscribed_at IS NULL', [T.id])).c;
      const remindAt = T.event_at && T.remind_min > 0 ? Number(T.event_at) - Number(T.remind_min) * 60000 : null;
      let sidebetEntries = null;
      if (T.pack_id) sidebetEntries = Number((await db.get('SELECT COUNT(*) AS c FROM sidebet_entries WHERE pack_id = ?', [T.pack_id])).c) || 0;
      return send(res, 200, {
        tournament: { ...pub, sessionId: T.session_id || null, packId: T.pack_id || null, remindMin: Number(T.remind_min) || 0, remindAt,
          remindLabel: remindAt ? `${shortDate(remindAt)} · ${timeLabel(remindAt)}` : null, eventLocal: eventLocal(T.event_at), landingPath: `/tournament/${T.slug}`,
          anyDecided: anyDecided(T), sidebetEntries },
        sessions, packs, packSongs,
        candidates: T.status === 'draft' || T.status === 'promo' ? await candidates(T) : [],
        subscribers: { count: Number(subs.c) || 0, ars: Number(ars) || 0, reminded: Number(subs.r) || 0 },
        graphics: graphicRows(T),
        asana: { configured: !!(process.env.ASANA_TOKEN && (await asanaProject())), blob: !!process.env.BLOB_READ_WRITE_TOKEN },
      });
    }

    if (p === '/api/admin/tournament/search' && method === 'GET') {
      const T = await needT(); if (!T) return true;
      const q = str(url.searchParams.get('q'), 80).toLowerCase();
      if (!q) return send(res, 200, { results: [] });
      const rows = await db.all(`SELECT uid, name, instagram, location, photo_url, lifetime_points FROM users
        WHERE profile_complete = 1 AND blocked = 0 AND LOWER(name) LIKE ? ORDER BY lifetime_points DESC LIMIT 12`, ['%' + q + '%']);
      return send(res, 200, { results: rows.map(u => ({ userId: u.uid, name: u.name, handle: cleanHandle(u.instagram), city: u.location || null, photoUrl: u.photo_url || null, points: Number(u.lifetime_points) || 0 })) });
    }

    if (p === '/api/admin/tournament/competitor' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      const name = str(body.name, 80);
      if (!name) return bad(res, 'Name required');
      const fields = { name, handle: cleanHandle(body.handle), city: str(body.city, 80) || null, photo_url: str(body.photoUrl, 1000) || null,
        qualified_label: str(body.qualifiedLabel, 40) || null, source: str(body.source, 80) || null, user_id: str(body.userId, 40) || null };
      if (body.competitorId) {
        const c = compById(T, body.competitorId);
        if (!c) return bad(res, 'Competitor not found', 404);
        await db.run('UPDATE tournament_competitors SET name = ?, handle = ?, city = ?, photo_url = ?, qualified_label = ?, source = ?, user_id = ? WHERE id = ?',
          [fields.name, fields.handle, fields.city, fields.photo_url, fields.qualified_label, fields.source, fields.user_id || c.user_id, c.id]);
        candCache.delete(T.id);
        return send(res, 200, { competitorId: c.id });
      }
      if (filledCount(T) >= B.FIELD) return bad(res, 'All 8 seats are filled', 409);
      if (fields.user_id && T.competitors.some(c => c.user_id === fields.user_id)) return bad(res, 'Already seated', 409);
      // fill the profile in when a user is named and the form left fields blank
      if (fields.user_id) {
        const u = await db.get('SELECT name, instagram, location, photo_url FROM users WHERE uid = ?', [fields.user_id]);
        if (u) { fields.handle = fields.handle || cleanHandle(u.instagram); fields.city = fields.city || u.location || null; fields.photo_url = fields.photo_url || u.photo_url || null; }
      }
      const seat = filledCount(T) + 1;
      const usedSeeds = new Set(T.competitors.map(c => c.seed));
      let seed = body.seed && !usedSeeds.has(Number(body.seed)) ? Number(body.seed) : 1;
      while (usedSeeds.has(seed)) seed++;
      const cid = id(9);
      await db.run('INSERT INTO tournament_competitors (id, tournament_id, seed, seat, qualified_label, user_id, name, handle, city, photo_url, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [cid, T.id, seed, seat, fields.qualified_label, fields.user_id, fields.name, fields.handle, fields.city, fields.photo_url, fields.source || 'picked', now()]);
      candCache.delete(T.id);
      const T2 = await loadById(T.id);
      if (filledCount(T2) === B.FIELD && !T2.matches.length) await rebuildBracket(T2);
      return send(res, 200, { competitorId: cid, seat, seed });
    }

    if (p === '/api/admin/tournament/competitor/photo' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      const c = compById(T, body.competitorId);
      if (!c) return bad(res, 'Competitor not found', 404);
      if (body.__tooBig) return bad(res, 'Image too large', 413);
      const m = String(body.image || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return bad(res, 'Invalid image');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 1024 * 1024) return bad(res, 'Image too large', 413);
      let photoUrl = String(body.image);
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const { put } = require('@vercel/blob');
          const r = await put(`tournaments/${T.slug}/photos/${c.id}-${now()}.${m[1] === 'png' ? 'png' : 'jpg'}`, buf, { access: 'public', contentType: `image/${m[1]}`, token: process.env.BLOB_READ_WRITE_TOKEN });
          photoUrl = r.url;
        } catch (e) { console.error('[tournament] photo upload failed, keeping data URL:', e.message); }
      }
      await db.run('UPDATE tournament_competitors SET photo_url = ? WHERE id = ?', [photoUrl, c.id]);
      return send(res, 200, { photoUrl });
    }

    if (p === '/api/admin/tournament/competitor/remove' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      if (anyDecided(T)) return bad(res, 'The bracket has a decided match — seats are locked', 409);
      const c = compById(T, body.competitorId);
      if (!c) return bad(res, 'Competitor not found', 404);
      await db.run('DELETE FROM tournament_competitors WHERE id = ?', [c.id]);
      // close the seat gap so flyer N is always the Nth person picked
      const rest = T.competitors.filter(x => x.id !== c.id).sort((a, b) => (a.seat || a.seed) - (b.seat || b.seed));
      for (let i = 0; i < rest.length; i++) await db.run('UPDATE tournament_competitors SET seat = ? WHERE id = ?', [i + 1, rest[i].id]);
      await db.run('DELETE FROM tournament_matches WHERE tournament_id = ?', [T.id]);
      candCache.delete(T.id);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/tournament/seed' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      if (anyDecided(T)) return bad(res, 'The bracket has a decided match — seeding is locked', 409);
      let order;
      if (body.byPoints) {
        const uids = T.competitors.map(c => c.user_id).filter(Boolean);
        const pts = new Map();
        if (uids.length) for (const u of await db.all(`SELECT uid, lifetime_points FROM users WHERE uid IN (${uids.map(() => '?').join(',')})`, uids)) pts.set(u.uid, Number(u.lifetime_points) || 0);
        order = B.seedByPoints(T.competitors.map(c => ({ id: c.id, name: c.name, points: pts.get(c.user_id) || 0 }))).map(c => c.id);
      } else {
        order = Array.isArray(body.order) ? body.order.map(String) : [];
        const ids = new Set(T.competitors.map(c => c.id));
        if (order.length !== ids.size || order.some(x => !ids.has(x)) || new Set(order).size !== order.length) return bad(res, 'Order must list every competitor once');
      }
      // two passes: seeds are UNIQUE per tournament, so park them first
      for (let i = 0; i < order.length; i++) await db.run('UPDATE tournament_competitors SET seed = ? WHERE id = ?', [100 + i, order[i]]);
      for (let i = 0; i < order.length; i++) await db.run('UPDATE tournament_competitors SET seed = ? WHERE id = ?', [i + 1, order[i]]);
      const T2 = await loadById(T.id);
      await rebuildBracket(T2);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/tournament/status' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      const s = String(body.status || '');
      if (!['draft', 'promo', 'live'].includes(s)) return bad(res, 'Status must be draft, promo or live');
      if (s !== 'draft' && filledCount(T) < B.FIELD) return bad(res, `All 8 seats must be filled first (${filledCount(T)} of 8)`, 409);
      if (s !== 'draft' && !T.event_at) return bad(res, 'Set the event date and time first', 409);
      if (s === 'live' && !T.session_id) return bad(res, 'Link the live session first', 409);
      if (anyDecided(T) && s === 'draft') return bad(res, 'The bracket has a decided match', 409);
      if (!T.matches.length && filledCount(T) === B.FIELD) await rebuildBracket(T);
      await db.run('UPDATE tournaments SET status = ? WHERE id = ?', [s, T.id]);
      return send(res, 200, { ok: true, status: s });
    }

    if (p === '/api/admin/tournament/queue' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      if (!T.session_id) return bad(res, 'Link the live session first', 409);
      const m = T.matches.find(x => x.id === body.matchId);
      if (!m) return bad(res, 'Match not found', 404);
      if (!m.a_id || !m.b_id) return bad(res, 'Both sides of this match are not in yet', 409);
      if (m.winner_id && m.round_no < 3) return bad(res, 'This match is already decided', 409);
      const open = pollsOf(T, m).find(p => ['pending', 'listening', 'voting', 'closed'].includes(p.status));
      if (open) return bad(res, 'A poll for this match is already queued or in play', 409);
      const needed = m.round_no === 3 ? (Number(T.final_polls) || 3) : 1;
      if (pollsOf(T, m).filter(p => p.status === 'ratified').length >= needed) return bad(res, 'Every poll for this match has been played', 409);
      const session = await canAdminSession(req, T.session_id);
      if (!session) return bad(res, 'Session not found', 404);
      const side = async (x) => {
        if (x && x.packSongId) {
          const s = await db.get('SELECT * FROM pack_songs WHERE id = ? AND pack_id = ?', [x.packSongId, T.pack_id || '']);
          if (!s) throw new Error('Pack song not found');
          return { title: s.title, artist: s.artist, packSongId: s.id };
        }
        const title = str(x && x.title, 160), artist = str(x && x.artist, 120);
        if (!title) throw new Error('Song title required');
        return { title, artist, packSongId: null };
      };
      let a, b;
      try { a = await side(body.a); b = await side(body.b); } catch (e) { return bad(res, e.message); }
      const r = await queueRound(session, { poll_type: 'binary', song_title: a.title, song_artist: a.artist, option_b_title: b.title, option_b_artist: b.artist,
        pack_song_a: a.packSongId, pack_song_b: b.packSongId, tournamentMatchId: m.id });
      if (!r.ok) return bad(res, r.error || 'Could not queue', r.status || 400);
      return send(res, 200, r.payload);
    }

    if (p === '/api/admin/tournament/decide' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      const m = T.matches.find(x => x.id === body.matchId);
      if (!m) return bad(res, 'Match not found', 404);
      let next;
      if (!body.winnerId) {
        next = B.clearWinner(T.matches, m.round_no, m.slot);
      } else {
        if (body.winnerId !== m.a_id && body.winnerId !== m.b_id) return bad(res, 'Winner is not in this match');
        next = B.applyWinner(B.clearWinner(T.matches, m.round_no, m.slot), m.round_no, m.slot, body.winnerId)
          .map(x => x.round_no === m.round_no && x.slot === m.slot ? { ...x, decided_by: 'host', decided_at: now() } : x);
      }
      await writeMatches(T, next);
      await finishIfChampion(T, next);
      if (T.session_id) { try { await realtime.publish(T.session_id, 'tournament'); } catch {} }
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/tournament/caption' && method === 'GET') {
      const T = await needT(); if (!T) return true;
      return send(res, 200, await caption(T, url.searchParams.get('key') || ''));
    }

    if (p === '/api/admin/tournament/publish' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      const key = str(body.key, 12);
      const r = keyToRender(T, key);
      if (!r) return bad(res, 'Unknown graphic');
      const row = graphicRows(T).find(x => x.key === key);
      if (!row || !row.ready) return bad(res, 'That graphic is not ready yet', 409);
      const cap = await caption(T, key);
      const files = [];
      for (const kind of row.kinds) files.push({ name: `${T.slug}-${key}-${kind}.png`, kind, buf: await renderKey(T, key, kind) });
      const urls = {};
      let hosted = false;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        try { for (const f of files) urls[f.kind] = await uploadPng(`tournaments/${T.slug}/${key}-${f.kind}.png`, f.buf); hosted = true; }
        catch (e) { console.error('[tournament] blob failed:', e.message); }
      }
      let asana = null, asanaError = null;
      const project = await asanaProject();
      if (process.env.ASANA_TOKEN && project) {
        try {
          const task = await asanaFetch('/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: {
              name: `${T.name} #${T.number || 1} — ${row.label}`,
              notes: `Caption (paste as-is):\n\n${cap.caption}\n\n—\nTag on the graphic: ${cap.tagOnGraphic.join(', ') || '(nobody)'}\n` +
                (cap.comments.length ? `\nComments, bottom up, four a comment:\n${cap.comments.map(c => '• ' + c).join('\n')}\n` : '') +
                `\nStory, feed and thumbnail attached. Generated by The A&R Room.`,
              projects: [String(project)] } }) });
          const gid = task && task.data && task.data.gid;
          if (gid) {
            for (const f of files) {
              const form = new FormData(); form.set('parent', gid); form.set('file', new Blob([f.buf], { type: 'image/png' }), f.name);
              await asanaFetch('/attachments', { method: 'POST', body: form });
            }
            asana = { taskId: gid, url: (task.data.permalink_url) || `https://app.asana.com/0/${project}/${gid}` };
          }
        } catch (e) { asanaError = e.message; console.error('[tournament] asana failed:', e.message); }
      }
      const map = { ...T.graphicsMap, [key]: { urls: hosted ? urls : null, publishedAt: now(), asanaTaskId: asana ? asana.taskId : (T.graphicsMap[key] || {}).asanaTaskId || null, asanaUrl: asana ? asana.url : (T.graphicsMap[key] || {}).asanaUrl || null } };
      await db.run('UPDATE tournaments SET graphics = ?, caption = ? WHERE id = ?', [JSON.stringify(map), cap.caption, T.id]);
      return send(res, 200, { ok: true, urls: hosted ? urls : null, hosted, asana, asanaError, caption: cap.caption, comments: cap.comments });
    }

    // Every available graphic in one download: each ready row × its kinds, a hosted copy when
    // one was published (a fetch, not a render), plus captions.txt. Up to 31 PNGs; photos are
    // fetched once per competitor for the whole set.
    if (p === '/api/admin/tournament/graphics.zip' && method === 'GET') {
      const T = await needT(); if (!T) return true;
      const { zipStore } = require('./zip');
      const files = [];
      const notes = [];
      for (const row of graphicRows(T).filter(r => r.ready)) {
        for (const kind of row.kinds) {
          const name = `${T.slug}-${row.key}-${kind}.png`;
          let buf = null;
          const hosted = row.urls && row.urls[kind];
          if (hosted) {
            try {
              const r = await fetch(hosted, { signal: AbortSignal.timeout(5000) });
              if (r.ok) buf = Buffer.from(await r.arrayBuffer());
            } catch (e) { /* render instead */ }
          }
          if (!buf) buf = await renderKey(T, row.key, kind);
          files.push({ name, data: buf });
        }
        const cap = await caption(T, row.key);
        notes.push(`== ${row.label} ==\n\n${cap.caption}\n` + (cap.comments.length ? `\nComments, four a comment:\n${cap.comments.map(c => '- ' + c).join('\n')}\n` : '') + `\nTag on the graphic: ${cap.tagOnGraphic.join(', ') || '(nobody)'}\n`);
      }
      if (!files.length) return bad(res, 'No graphics are ready yet — seat a competitor first', 409);
      files.push({ name: `${T.slug}-captions.txt`, data: Buffer.from(notes.join('\n'), 'utf8') });
      const zip = zipStore(files);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${T.slug}-graphics.zip"` });
      return res.end(zip);
    }

    if (p === '/api/admin/tournament/subscribers' && method === 'GET') {
      const T = await needT(); if (!T) return true;
      const rows = await db.all('SELECT email, name, created_at, reminded_at, unsubscribed_at FROM tournament_subscribers WHERE tournament_id = ? ORDER BY created_at ASC', [T.id]);
      if (url.searchParams.get('format') === 'csv') {
        const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const iso = ts => ts ? new Date(Number(ts)).toISOString() : '';
        const csv = ['email,name,joined,reminded,unsubscribed', ...rows.map(r => [r.email, r.name, iso(r.created_at), iso(r.reminded_at), iso(r.unsubscribed_at)].map(esc).join(','))].join('\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${T.slug}-reminders.csv"` });
        return res.end(csv);
      }
      return send(res, 200, { subscribers: rows.map(r => ({ email: r.email, name: r.name, joined: Number(r.created_at), reminded: r.reminded_at ? Number(r.reminded_at) : null, unsubscribed: !!r.unsubscribed_at })) });
    }

    if (p === '/api/admin/tournament/remind-now' && method === 'POST') {
      const T = await needT(); if (!T) return true;
      if (!T.event_at) return bad(res, 'Set the event date first', 409);
      return send(res, 200, await sendReminders(T, { limit: REMIND_BATCH, deadline: Date.now() + 20000 }));
    }

    return false;
  }

  // /api/card/tournament — admin only, rendered live, never cached.
  async function card(req, res, url) {
    const admin = await platformAdmin(req);
    if (!admin) return bad(res, 'Admin only', 403);
    const T = await loadById(url.searchParams.get('t'));
    if (!T) return bad(res, 'Tournament not found', 404);
    const kind = url.searchParams.get('kind') || 'feed';
    let buf;
    if (kind === 'bracket') buf = await shareCards.renderPng('tournamentBracket', await bracketData(T));
    else {
      const stage = url.searchParams.get('stage') || null;
      const filled = url.searchParams.get('filled');
      const d = await flyerData(T, { stage: ['seat', 'final', 'champion'].includes(stage) ? stage : undefined, filled: filled != null ? Number(filled) : undefined });
      buf = await shareCards.renderPng(kind === 'story' ? 'tournamentStory' : kind === 'thumb' ? 'tournamentThumb' : 'tournamentFeed', d);
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
    return res.end(buf);
  }

  return { handle, card, onRoundRatified, drainReminders, homeWinners, KINDS, _flyerData: flyerData, _bracketData: bracketData, _caption: caption };
};
