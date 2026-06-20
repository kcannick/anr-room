'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { sendOtp } = require('./email');
const { roomAverage, rankVotes } = require('./scoring');

const PORT = process.env.PORT || 3000;
const now = () => Date.now();
const id = (n = 9) => crypto.randomBytes(n).toString('base64url');
const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
// Voting windows are constrained to 2–60 minutes everywhere.
const MIN_MINUTES = 2, MAX_MINUTES = 60, DEFAULT_MINUTES = 5;
const clampMinutes = (m) => {
  const n = Number(m);
  if (!Number.isFinite(n)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
};

// ---------- tiny helpers ----------
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    ...headers,
  });
  res.end(body);
}
function readBody(req, maxBytes = 1.5 * 1024 * 1024) {
  return new Promise((resolve) => {
    let b = '';
    let bytes = 0, tooBig = false;
    req.on('data', c => {
      bytes += c.length;
      if (bytes > maxBytes) { tooBig = true; return; }
      b += c;
    });
    req.on('end', () => {
      if (tooBig) return resolve({ __tooBig: true });
      try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); }
    });
  });
}
function bad(res, msg, status = 400) { send(res, status, { error: msg }); }

// ---------- auth resolution ----------
async function participantFromReq(req) {
  const tok = req.headers['x-player-token'];
  if (!tok) return null;
  return db.get('SELECT * FROM participants WHERE token = ?', [tok]);
}
async function adminFromReq(req, sessionId) {
  const tok = req.headers['x-admin-token'];
  if (!tok) return null;
  const s = await db.get('SELECT * FROM sessions WHERE id = ? AND admin_token = ?', [sessionId, tok]);
  return s || null;
}

// ---------- state builders ----------
// Fetch a banner's public shape by id, or null. Returns the id + link; the
// image itself is served separately via /api/banner/image to keep the frequent
// player-state polls small.
async function getBanner(bannerId) {
  if (!bannerId) return null;
  const b = await db.get('SELECT id, link_url FROM banners WHERE id = ?', [bannerId]);
  return b ? { id: b.id, image: `/api/banner/image?id=${b.id}`, link: b.link_url || null } : null;
}

// Resolve which banner to show, most-specific wins:
//   per-song (round.banner_id) -> session (session.banner_id) -> global default -> none.
// `round` may be null (e.g. lobby), in which case we skip the per-song level.
async function resolveBanner(session, round) {
  if (round && round.banner_id) {
    const b = await getBanner(round.banner_id);
    if (b) return b;
  }
  if (session && session.banner_id) {
    const b = await getBanner(session.banner_id);
    if (b) return b;
  }
  const globalId = (await db.get("SELECT v FROM settings WHERE k = 'global_banner_id'"))?.v;
  if (globalId) {
    const b = await getBanner(globalId);
    if (b) return b;
  }
  return null;
}

// The round that is actually "in play" right now: a live vote, a just-closed
// tally, or the most-recently ratified result. Pending (queued) rounds are NOT
// active — they live in the queue until the admin opens one. This is what keeps
// queuing a second song from hijacking the screen.
async function activeRound(sessionId) {
  return db.get(
    `SELECT * FROM rounds WHERE session_id = ? AND status IN ('voting','closed','ratified')
     ORDER BY CASE status WHEN 'voting' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END,
              idx DESC LIMIT 1`,
    [sessionId]
  );
}

// The queue: songs added but not yet played, in the order they'll be opened.
async function queuedRounds(sessionId) {
  return db.all(
    `SELECT * FROM rounds WHERE session_id = ? AND status = 'pending' ORDER BY queue_pos ASC, idx ASC`,
    [sessionId]
  );
}

// Letter grade from a player's average prediction error across the rounds they
// played. Lower error = sharper read = better grade. Tuned to feel earnable.
function gradeForAvgError(avgErr) {
  if (avgErr == null) return null;
  if (avgErr <= 0.3) return 'A+';
  if (avgErr <= 0.6) return 'A';
  if (avgErr <= 1.0) return 'A-';
  if (avgErr <= 1.4) return 'B+';
  if (avgErr <= 1.9) return 'B';
  if (avgErr <= 2.4) return 'B-';
  if (avgErr <= 3.0) return 'C+';
  if (avgErr <= 3.6) return 'C';
  if (avgErr <= 4.3) return 'C-';
  if (avgErr <= 5.2) return 'D';
  return 'F';
}

// End-of-session recap for one player: the big shareable reveal. Computed only
// when the session has ended.
async function buildRecap(participant) {
  const sessionId = participant.session_id;
  // The player's own results across all ratified rounds.
  const mine = await db.all(
    `SELECT v.points, v.err, v.rank, v.tier, r.idx, r.song_title, r.room_average
     FROM votes v JOIN rounds r ON r.id = v.round_id
     WHERE v.participant_id = ? AND r.status = 'ratified' ORDER BY r.idx ASC`,
    [participant.id]
  );
  const roundsPlayed = mine.length;
  const totalRounds = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status = 'ratified'", [sessionId])).c;
  // Overall room average across all songs (the "how the room felt" number).
  const avgRow = await db.get(
    "SELECT AVG(room_average) AS a FROM rounds WHERE session_id = ? AND status = 'ratified' AND room_average IS NOT NULL",
    [sessionId]
  );
  const overallRoomAvg = avgRow && avgRow.a != null ? Number(avgRow.a) : null;

  let avgErr = null, bullseyes = 0, best = null;
  if (roundsPlayed) {
    avgErr = mine.reduce((a, m) => a + m.err, 0) / roundsPlayed;
    bullseyes = mine.filter(m => m.tier === 'bullseye').length;
    best = mine.reduce((b, m) => (b == null || m.points > b.points ? m : b), null);
  }

  // Points-based percentile across the whole room.
  const all = await db.all('SELECT id, total_points FROM participants WHERE session_id = ? AND verified = 1', [sessionId]);
  const totals = all.map(p => p.total_points).sort((a, b) => a - b);
  const mineTotal = participant.total_points;
  let percentile = null, rank = null, fieldSize = totals.length;
  if (fieldSize > 0) {
    const below = totals.filter(t => t < mineTotal).length;
    percentile = Math.round((below / fieldSize) * 100);
    const sortedDesc = [...all].sort((a, b) => b.total_points - a.total_points);
    rank = sortedDesc.findIndex(p => p.id === participant.id) + 1;
  }

  return {
    name: participant.name,
    totalPoints: mineTotal,
    roundsPlayed,
    totalRounds,
    avgErr: avgErr != null ? Math.round(avgErr * 10) / 10 : null,
    grade: gradeForAvgError(avgErr),
    bullseyes,
    overallRoomAvg: overallRoomAvg != null ? Math.round(overallRoomAvg * 10) / 10 : null,
    rank, fieldSize,
    percentile,
    best: best ? { idx: best.idx, song_title: best.song_title, points: best.points } : null,
  };
}

async function playerState(participant) {
  const sessionId = participant.session_id;
  const session = await db.get('SELECT id, name, status, banner_id FROM sessions WHERE id = ?', [sessionId]);
  const count = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1', [sessionId])).c;
  const round = await activeRound(sessionId);

  let view = { phase: 'waiting' }; // waiting | voting | locked | results
  if (round) {
    const myVote = await db.get('SELECT * FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    if (round.status === 'voting') {
      view = {
        phase: myVote ? 'locked' : 'voting',
        round: { idx: round.idx, song_title: round.song_title, song_artist: round.song_artist, song_note: round.song_note, giveaway: round.giveaway, closes_at: round.closes_at },
        myVote: myVote ? { taste: myVote.taste, predict: myVote.predict } : null,
      };
    } else if (round.status === 'closed') {
      view = { phase: 'locked', round: { idx: round.idx, song_title: round.song_title }, tallying: true, myVote: myVote ? { taste: myVote.taste, predict: myVote.predict } : null };
    } else if (round.status === 'ratified') {
      const ranked = await db.all('SELECT * FROM votes WHERE round_id = ? ORDER BY rank ASC', [round.id]);
      const mine = ranked.find(v => v.participant_id === participant.id);
      const winner = ranked[0]
        ? await db.get('SELECT name FROM participants WHERE id = ?', [ranked[0].participant_id])
        : null;
      // FULLY BLIND during the session: players see their points, rank, and reaction
      // tier — but NOT the room average, NOT their exact "off by", NOT the winner's
      // guess. The answer is saved for the end-of-session recap reveal.
      view = {
        phase: 'results',
        round: { idx: round.idx, song_title: round.song_title, song_artist: round.song_artist, giveaway: round.giveaway },
        winner: ranked[0] ? { name: winner ? winner.name : 'Someone' } : null,
        myResult: mine ? { taste: mine.taste, predict: mine.predict, points: mine.points, rank: mine.rank, tier: mine.tier } : null,
        totalPlayers: ranked.length,
      };
    } else {
      view = { phase: 'waiting' };
    }
  }

  const out = {
    session: { name: session.name, status: session.status },
    me: { name: participant.name, email: participant.email, total_points: participant.total_points },
    myTotalPoints: participant.total_points,
    participants: count,
    ...view,
  };
  // Ad banner — shown on lobby, voting, and locked only. Never on results/recap.
  // Per-song banner uses the active round; otherwise session/global apply.
  if (out.phase === 'waiting' || out.phase === 'voting' || out.phase === 'locked') {
    out.banner = await resolveBanner(session, round);
  }
  if (session.status === 'ended') {
    out.phase = 'recap';
    out.recap = await buildRecap(participant);
    out.banner = null;
  }
  return out;
}

async function adminState(session) {
  const sessionId = session.id;
  const participants = await db.all('SELECT id, name, email, verified, total_points FROM participants WHERE session_id = ? ORDER BY total_points DESC, created_at ASC', [sessionId]);
  const rounds = await db.all('SELECT * FROM rounds WHERE session_id = ? ORDER BY idx ASC', [sessionId]);
  const round = await activeRound(sessionId);
  let liveVotes = [];
  if (round && (round.status === 'voting' || round.status === 'closed')) {
    liveVotes = await db.all(
      `SELECT v.taste, v.predict, v.locked_at, p.name FROM votes v
       JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.locked_at ASC`,
      [round.id]
    );
  }
  let ratifiedResults = null;
  if (round && round.status === 'ratified') {
    ratifiedResults = await db.all(
      `SELECT v.rank, v.taste, v.predict, v.err, v.points, v.tier, p.name FROM votes v
       JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.rank ASC`,
      [round.id]
    );
  }
  const queue = await queuedRounds(sessionId);
  const playedCount = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status = 'ratified'", [sessionId])).c;
  // Banner library: global default + any uploaded for this session. We send a
  // short preview (not the full base64) to keep admin state light; the image
  // itself is fetched on demand or shown via its own id.
  const bannerRows = await db.all(
    "SELECT id, session_id, label, link_url, created_at FROM banners WHERE session_id = ? OR session_id IS NULL ORDER BY created_at DESC",
    [sessionId]
  );
  const globalBannerId = (await db.get("SELECT v FROM settings WHERE k = 'global_banner_id'"))?.v || null;
  const banners = bannerRows.map(b => ({
    id: b.id, label: b.label, link_url: b.link_url || null,
    scope: b.session_id ? 'session' : 'global',
    isGlobalDefault: b.id === globalBannerId,
  }));
  return {
    session: { id: session.id, name: session.name, status: session.status, admin_token: session.admin_token, banner_id: session.banner_id || null, default_minutes: session.default_minutes || DEFAULT_MINUTES },
    participants,
    verifiedCount: participants.filter(p => p.verified).length,
    rounds,
    queue,
    playedCount,
    activeRound: round || null,
    liveVotes,
    ratifiedResults,
    banners,
    globalBannerId,
    serverNow: now(),
  };
}

// ---------- ratify: compute room avg, points, ranks, bump totals ----------
async function ratifyRound(round) {
  return db.tx(async (tx) => {
    const votes = await tx.all('SELECT * FROM votes WHERE round_id = ?', [round.id]);
    if (!votes.length) {
      await tx.run("UPDATE rounds SET status = 'ratified', room_average = NULL WHERE id = ?", [round.id]);
      return { ranked: [], room_average: null };
    }
    const avg = roomAverage(votes);
    const ranked = rankVotes(votes, avg);
    for (const v of ranked) {
      await tx.run('UPDATE votes SET points = ?, err = ?, tier = ?, rank = ? WHERE id = ?', [v.points, v.err, v.tier, v.rank, v.id]);
    }
    await tx.run("UPDATE rounds SET status = 'ratified', room_average = ? WHERE id = ?", [avg, round.id]);
    // Bump each participant's running total by the points earned this round.
    // A round can be negative, but the cumulative leaderboard total never drops below 0.
    for (const v of ranked) {
      await tx.run('UPDATE participants SET total_points = MAX(0, total_points + ?) WHERE id = ?', [v.points, v.participant_id]);
    }
    return { ranked, room_average: avg };
  });
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // ----- create session (admin bootstrap) -----
  if (p === '/api/session' && method === 'POST') {
    const { name, defaultMinutes } = await readBody(req);
    if (!name || !name.trim()) return bad(res, 'Session name required');
    const sid = id(5).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || id(4);
    const adminToken = id(18);
    const dm = clampMinutes(defaultMinutes != null ? defaultMinutes : DEFAULT_MINUTES);
    await db.run('INSERT INTO sessions (id, name, admin_token, status, default_minutes, created_at) VALUES (?,?,?,?,?,?)',
      [sid, name.trim(), adminToken, 'open', dm, now()]);
    return send(res, 200, { sessionId: sid, adminToken });
  }

  // ----- request OTP -----
  if (p === '/api/join/request' && method === 'POST') {
    const { sessionId, email } = await readBody(req);
    const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return bad(res, 'Session not found', 404);
    if (session.status !== 'open') return bad(res, 'This session is closed');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Enter a valid email');
    const code = code6();
    await db.run('DELETE FROM otps WHERE email = ? AND session_id = ?', [email.toLowerCase(), sessionId]);
    await db.run('INSERT INTO otps (email, session_id, code, expires_at, attempts) VALUES (?,?,?,?,0)',
      [email.toLowerCase(), sessionId, code, now() + 10 * 60 * 1000]);
    const r = await sendOtp(email, code, session.name);
    return send(res, 200, { sent: true, devCode: r.devCode || null });
  }

  // ----- verify OTP + create/return participant -----
  if (p === '/api/join/verify' && method === 'POST') {
    const { sessionId, email, code, name } = await readBody(req);
    const em = (email || '').toLowerCase();
    const otp = await db.get('SELECT * FROM otps WHERE email = ? AND session_id = ?', [em, sessionId]);
    if (!otp) return bad(res, 'Request a code first');
    if (otp.attempts >= 6) return bad(res, 'Too many attempts. Request a new code.');
    if (now() > Number(otp.expires_at)) return bad(res, 'Code expired. Request a new one.');
    if (String(code).trim() !== otp.code) {
      await db.run('UPDATE otps SET attempts = attempts + 1 WHERE email = ? AND session_id = ?', [em, sessionId]);
      return bad(res, 'Incorrect code');
    }
    // upsert participant for this session+email
    let participant = await db.get('SELECT * FROM participants WHERE session_id = ? AND email = ?', [sessionId, em]);
    const token = id(18);
    if (participant) {
      await db.run('UPDATE participants SET verified = 1, token = ?, name = COALESCE(NULLIF(?,\'\'), name) WHERE id = ?',
        [token, (name || '').trim(), participant.id]);
    } else {
      const pid = id(9);
      await db.run('INSERT INTO participants (id, session_id, email, name, token, verified, total_points, created_at) VALUES (?,?,?,?,?,1,0,?)',
        [pid, sessionId, em, (name || '').trim(), token, now()]);
    }
    await db.run('DELETE FROM otps WHERE email = ? AND session_id = ?', [em, sessionId]);
    return send(res, 200, { token });
  }

  // ----- set / update name -----
  if (p === '/api/me/name' && method === 'POST') {
    const participant = await participantFromReq(req);
    if (!participant) return bad(res, 'Not authenticated', 401);
    const { name } = await readBody(req);
    if (!name || !name.trim()) return bad(res, 'Name required');
    await db.run('UPDATE participants SET name = ? WHERE id = ?', [name.trim(), participant.id]);
    return send(res, 200, { ok: true });
  }

  // ----- player live state (polled) -----
  if (p === '/api/me/state' && method === 'GET') {
    const participant = await participantFromReq(req);
    if (!participant) return bad(res, 'Not authenticated', 401);
    return send(res, 200, await playerState(participant));
  }

  // ----- cast vote -----
  if (p === '/api/vote' && method === 'POST') {
    const participant = await participantFromReq(req);
    if (!participant) return bad(res, 'Not authenticated', 401);
    const { taste, predict } = await readBody(req);
    const round = await activeRound(participant.session_id);
    if (!round || round.status !== 'voting') return bad(res, 'Voting is not open');
    if (round.closes_at && now() > Number(round.closes_at)) return bad(res, 'Time is up');
    const t = Number(taste), pr = Number(predict);
    if (!Number.isInteger(t) || t < 1 || t > 10) return bad(res, 'Rating must be 1–10');
    if (!(pr >= 0 && pr <= 10)) return bad(res, 'Prediction must be 0.0–10.0');
    const existing = await db.get('SELECT id FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    if (existing) return bad(res, 'You already locked in');
    await db.run('INSERT INTO votes (id, round_id, participant_id, taste, predict, locked_at) VALUES (?,?,?,?,?,?)',
      [id(9), round.id, participant.id, t, pr, now()]);
    return send(res, 200, { locked: true });
  }

  // ===== ADMIN =====
  if (p === '/api/admin/state' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    return send(res, 200, await adminState(session));
  }

  if (p === '/api/admin/round' && method === 'POST') {
    const { sessionId, song_title, song_artist, song_note, giveaway } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (!song_title || !song_title.trim()) return bad(res, 'Song title required');
    // Queued songs don't get a round number (idx) until they're actually opened —
    // they're played in queue order, which may differ from the order added.
    const maxPos = (await db.get("SELECT COALESCE(MAX(queue_pos),0) AS m FROM rounds WHERE session_id = ? AND status = 'pending'", [sessionId])).m;
    const rid = id(9);
    await db.run(
      `INSERT INTO rounds (id, session_id, idx, queue_pos, song_title, song_artist, song_note, giveaway, status, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`,
      [rid, sessionId, 0, Number(maxPos) + 1, song_title.trim(), (song_artist || '').trim(), (song_note || '').trim(), (giveaway || '').trim(), now()]
    );
    return send(res, 200, { roundId: rid });
  }

  // Reorder a queued song up/down, or delete it from the queue.
  if (p === '/api/admin/round/move' && method === 'POST') {
    const { sessionId, roundId, dir } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const q = await queuedRounds(sessionId);
    const i = q.findIndex(r => r.id === roundId);
    if (i < 0) return bad(res, 'Not in queue', 404);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= q.length) return send(res, 200, { ok: true }); // already at an end
    await db.tx(async (tx) => {
      await tx.run('UPDATE rounds SET queue_pos = ? WHERE id = ?', [q[j].queue_pos, q[i].id]);
      await tx.run('UPDATE rounds SET queue_pos = ? WHERE id = ?', [q[i].queue_pos, q[j].id]);
    });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/delete' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.run("DELETE FROM rounds WHERE id = ? AND session_id = ? AND status = 'pending'", [roundId, sessionId]);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/open' && method === 'POST') {
    const { sessionId, roundId, minutes } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    // Don't open a new round while another is mid-flight (voting or awaiting tally).
    const inPlay = await db.get("SELECT id FROM rounds WHERE session_id = ? AND status IN ('voting','closed') AND id != ?", [sessionId, roundId]);
    if (inPlay) return bad(res, 'Close and tally the current round first');
    // Assign the real round number now, at open time = number of rounds already started + 1.
    let idx = round.idx;
    if (!idx || round.status === 'pending') {
      const started = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('voting','closed','ratified')", [sessionId])).c;
      idx = Number(started) + 1;
    }
    // Voting window in minutes, clamped to 2–60.
    const dur = clampMinutes(minutes != null ? minutes : DEFAULT_MINUTES) * 60 * 1000;
    await db.run("UPDATE rounds SET status = 'voting', idx = ?, opens_at = ?, closes_at = ? WHERE id = ?",
      [idx, now(), now() + dur, roundId]);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/extend' && method === 'POST') {
    const { sessionId, roundId, minutes, seconds } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    const add = (minutes != null ? Number(minutes) * 60 : (Number(seconds) || 30)) * 1000;
    const base = Math.max(Number(round.closes_at) || now(), now());
    await db.run("UPDATE rounds SET status = 'voting', closes_at = ? WHERE id = ?", [base + add, roundId]);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/close' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.run("UPDATE rounds SET status = 'closed', closes_at = ? WHERE id = ? AND session_id = ?",
      [now(), roundId, sessionId]);
    return send(res, 200, { ok: true });
  }

  // Reopen an accidentally-closed round (closed -> voting again). Only works before
  // it's been tallied/ratified. Gives it a fresh voting window.
  if (p === '/api/admin/round/reopen' && method === 'POST') {
    const { sessionId, roundId, minutes } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status !== 'closed') return bad(res, 'Only a closed (not yet tallied) round can be reopened');
    const inPlay = await db.get("SELECT id FROM rounds WHERE session_id = ? AND status = 'voting' AND id != ?", [sessionId, roundId]);
    if (inPlay) return bad(res, 'Another round is currently open');
    const dur = clampMinutes(minutes != null ? minutes : DEFAULT_MINUTES) * 60 * 1000;
    await db.run("UPDATE rounds SET status = 'voting', closes_at = ? WHERE id = ?", [now() + dur, roundId]);
    return send(res, 200, { ok: true });
  }

  // Edit a song's details. Allowed while pending (queued), voting, or closed —
  // anything not yet ratified. Players see the update on their next poll.
  if (p === '/api/admin/round/edit' && method === 'POST') {
    const { sessionId, roundId, song_title, song_artist, song_note, giveaway } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status === 'ratified') return bad(res, 'Round already tallied — can\'t edit it now');
    if (song_title !== undefined && !String(song_title).trim()) return bad(res, 'Song title can\'t be empty');
    await db.run(
      `UPDATE rounds SET song_title = COALESCE(NULLIF(?,''), song_title),
         song_artist = ?, song_note = ?, giveaway = ? WHERE id = ?`,
      [(song_title || '').trim(), (song_artist || '').trim(), (song_note || '').trim(), (giveaway || '').trim(), roundId]
    );
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/ratify' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status === 'voting') {
      await db.run("UPDATE rounds SET status = 'closed' WHERE id = ?", [roundId]);
    }
    const out = await ratifyRound(round);
    return send(res, 200, { ok: true, room_average: out.room_average, players: out.ranked.length });
  }

  if (p === '/api/admin/session/end' && method === 'POST') {
    const { sessionId } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.run("UPDATE sessions SET status = 'ended' WHERE id = ?", [sessionId]);
    return send(res, 200, { ok: true });
  }

  // ===== ADS / BANNERS =====
  // Upload a banner image (sent as a base64 data URI from the browser).
  // scope: 'global' | 'session'. Optional link_url (opens in new tab on tap).
  if (p === '/api/admin/banner/upload' && method === 'POST') {
    const body = await readBody(req);
    if (body.__tooBig) return bad(res, 'Image too large — keep banners under ~500KB', 413);
    const { sessionId, scope, image_data, link_url, label } = body;
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (!image_data || !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(image_data)) {
      return bad(res, 'Provide a PNG, JPG, GIF, or WebP image');
    }
    if (image_data.length > 900000) return bad(res, 'Image too large — keep banners under ~500KB');
    if (link_url && !/^https?:\/\//i.test(link_url)) return bad(res, 'Link must start with http:// or https://');
    const bid = id(9);
    const ownerSession = scope === 'global' ? null : sessionId;
    await db.run(
      'INSERT INTO banners (id, session_id, label, image_data, link_url, created_at) VALUES (?,?,?,?,?,?)',
      [bid, ownerSession, (label || '').trim() || null, image_data, (link_url || '').trim() || null, now()]
    );
    return send(res, 200, { bannerId: bid });
  }

  // Serve a banner image by id (used by <img src>). Public — banners are shown to players.
  if (p === '/api/banner/image' && method === 'GET') {
    const bid = url.searchParams.get('id');
    const b = await db.get('SELECT image_data FROM banners WHERE id = ?', [bid]);
    if (!b) return bad(res, 'Not found', 404);
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(b.image_data);
    if (!m) return bad(res, 'Bad image', 500);
    const buf = Buffer.from(m[2], 'base64');
    res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=300' });
    return res.end(buf);
  }

  // Assign / clear a banner at a given level.
  // target: 'global' | 'session' | 'song'.  bannerId null/empty clears it.
  if (p === '/api/admin/banner/assign' && method === 'POST') {
    const { sessionId, target, bannerId, roundId } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const val = bannerId || null;
    if (target === 'global') {
      if (val) await db.run("INSERT INTO settings (k,v) VALUES ('global_banner_id', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [val]);
      else await db.run("DELETE FROM settings WHERE k = 'global_banner_id'");
    } else if (target === 'session') {
      await db.run('UPDATE sessions SET banner_id = ? WHERE id = ?', [val, sessionId]);
    } else if (target === 'song') {
      if (!roundId) return bad(res, 'roundId required for song-level banner');
      await db.run('UPDATE rounds SET banner_id = ? WHERE id = ? AND session_id = ?', [val, roundId, sessionId]);
    } else {
      return bad(res, 'Unknown target');
    }
    return send(res, 200, { ok: true });
  }

  // Delete a banner from the library (and clear any assignments pointing at it).
  if (p === '/api/admin/banner/delete' && method === 'POST') {
    const { sessionId, bannerId } = await readBody(req);
    const session = await adminFromReq(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.tx(async (tx) => {
      await tx.run('UPDATE sessions SET banner_id = NULL WHERE banner_id = ?', [bannerId]);
      await tx.run('UPDATE rounds SET banner_id = NULL WHERE banner_id = ?', [bannerId]);
      await tx.run("DELETE FROM settings WHERE k = 'global_banner_id' AND v = ?", [bannerId]);
      await tx.run('DELETE FROM banners WHERE id = ?', [bannerId]);
    });
    return send(res, 200, { ok: true });
  }

  return bad(res, 'Not found', 404);
}

// ---------- static ----------
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp' };
function serveStatic(res, file) {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) { send(res, 404, 'Not found'); return; }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/' || url.pathname === '/play') return serveStatic(res, 'play.html');
    if (url.pathname === '/admin') return serveStatic(res, 'admin.html');
    // allow direct asset paths
    return serveStatic(res, url.pathname.replace(/^\//, '') || 'play.html');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
});

// Ensure the schema exists. Idempotent (CREATE TABLE IF NOT EXISTS), so it's
// safe to call on every cold start in serverless. Memoized so repeated calls
// within a warm function are cheap.
let _initPromise = null;
function ensureInit() {
  if (!_initPromise) _initPromise = db.init();
  return _initPromise;
}

// Local mode: run directly with `node server.js` → bind a port and listen.
// Serverless (Vercel): the file is `require`d by api/index.js, which calls
// ensureInit() itself and forwards requests — so we must NOT listen here.
if (require.main === module) {
  (async () => {
    await ensureInit();
    server.listen(PORT, () => {
      console.log(`The A&R Room running on http://localhost:${PORT}  (db: ${db.engine}, email: ${require('./email').PROVIDER})`);
      console.log(`  Players:  http://localhost:${PORT}/`);
      console.log(`  Admin:    http://localhost:${PORT}/admin`);
    });
  })();
}

module.exports = server;
module.exports.ensureInit = ensureInit;
