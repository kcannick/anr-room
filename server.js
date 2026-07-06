'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Local dev convenience: load a gitignored .env if present (no dependency). Vercel
// injects env vars directly, so no .env exists there — this is a no-op in prod. Never
// overrides a var already set in the real environment, so tests/CI stay authoritative.
(function loadDotEnv() {
  try {
    const p = path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* best-effort */ }
})();

const db = require('./db');
const { sendOtp, sendFeedback, sendEmail, escapeHtml } = require('./email');
const { sendSms, PROVIDER: SMS_PROVIDER } = require('./sms');
const realtime = require('./realtime');
const { roomAverage, rankVotes, roomSplitA, rankBinaryVotes } = require('./scoring');
const shareCards = require('./share-cards');

const PORT = process.env.PORT || 3000;
const now = () => Date.now();
const id = (n = 9) => crypto.randomBytes(n).toString('base64url');
// Display name shown publicly. The FULL chosen name — never split on spaces ("DJ Sussex"
// must stay whole, not become "DJ"; "Black Crown Records" must not become "Black"). Capped
// as a layout backstop for legacy over-long names; surfaces with ellipsis trim by width.
const MAX_NAME = 32; // hard cap applied when a name is set (registration / signup)
const dispName = (nm) => { const s = (nm || '').toString().trim(); return s ? s.slice(0, 40) : 'A&R'; };
const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
// Profile categories (3.5a) — the creative/industry roles an A&R can pick. Server-side
// allowlist so the client can't inject arbitrary values; the chips render from this list.
// "Most focused on" (primary) is one of these. Broad on purpose (not music-only) — the
// visual/content people around an artist's rollout belong in the room too.
const PROFILE_CATEGORIES = ['DJ', 'Producer', 'Engineer', 'Manager', 'Event Promoter', 'Booking', 'Artist', 'Creative Director', 'Videographer', 'Photographer', 'Content Creator', 'Marketing', 'Executive', 'Media', 'Listener / Fan'];
// A profile qualifies (leaderboard/prizes/Wars + payout KYC) when it has: display name
// + at least one category + a primary + location. Socials and photo are optional.
function isProfileComplete(u) {
  if (!u) return false;
  let cats = []; try { cats = JSON.parse(u.categories || '[]'); } catch {}
  return !!((u.name || '').trim() && cats.length >= 1 && (u.primary_category || '').trim() && (u.location || '').trim());
}

// US state names -> 2-letter abbreviations, for "City, ST" profile locations.
const US_STATE_ABBR = { alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO', connecticut:'CT', delaware:'DE', 'district of columbia':'DC', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV', 'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY', 'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR', pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD', tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', 'west virginia':'WV', wisconsin:'WI', wyoming:'WY' };
const stateAbbr = (s) => US_STATE_ABBR[(s || '').toLowerCase()] || null;

// Voting windows are constrained to 2–60 minutes everywhere.
const MIN_MINUTES = 2, MAX_MINUTES = 60, DEFAULT_MINUTES = 5;
const clampMinutes = (m) => {
  const n = Number(m);
  if (!Number.isFinite(n)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
};

// Sanitize an optional user-supplied URL: must be http(s); empty/invalid -> null.
// Keeps javascript:/data: and other schemes out of links we render for players.
function cleanUrl(u) {
  const s = (u || '').toString().trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  if (s.length > 500) return null;
  return s;
}

// Short, human-shareable referral code (no ambiguous chars). Used in ?ref= links.
function refCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1/L
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

// Great-circle distance between two lat/lng points, in YARDS.
function distanceYards(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000; // earth radius, meters
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return meters * 1.09361; // meters -> yards
}
const DEFAULT_GEO_RADIUS = 200; // generous default (yards) — venue GPS is imprecise indoors

// ---------- tiny helpers ----------
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    ...headers,
  });
  res.end(body);
}
// CORS headers for the public ingest endpoint (the magazine's Drupal /review page posts
// cross-origin). Echoes the Origin when it's a makinitmag.com host, else the canonical one.
function ingestCors(req) {
  const o = (req.headers.origin || '').toString();
  const allow = /^https?:\/\/(www\.)?makinitmag\.com$/i.test(o) ? o : 'https://www.makinitmag.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Token',
    'Vary': 'Origin',
  };
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
// First-account-is-admin (3.5b): on a fresh install the first user becomes admin,
// so the operator doesn't depend on the ADMIN_EMAIL env var (kept as a fallback/override).
// No-op once any admin exists. Returns true if it promoted this user.
async function maybePromoteFirstAdmin(uid) {
  const admin = await db.get("SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1", []);
  if (admin) return false;
  await db.run("UPDATE users SET role = 'admin' WHERE uid = ?", [uid]);
  return true;
}
// Resolve the durable user behind a request from EITHER a session player token
// (X-Player-Token → participant.user_id) OR an account token (X-Auth-Token → users.uid).
// Lets session-less "A&R Team" members edit their profile/photo just like players do.
async function resolveUserId(req) {
  const participant = await participantFromReq(req);
  if (participant && participant.user_id) return participant.user_id;
  const u = await userFromAuth(req);
  return u ? u.uid : null;
}
async function adminFromReq(req, sessionId) {
  const tok = req.headers['x-admin-token'];
  if (!tok) return null;
  const s = await db.get('SELECT * FROM sessions WHERE id = ? AND admin_token = ?', [sessionId, tok]);
  return s || null;
}

// ---- identity-based auth (Stage 2/3) ----
const AUTH_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days, refreshed on use

// Resolve the logged-in user from an X-Auth-Token header (durable host/admin login).
// Refreshes last_used + sliding expiry on each successful resolve. Returns the user row or null.
async function userFromAuth(req) {
  const tok = req.headers['x-auth-token'];
  if (!tok) return null;
  const t = await db.get('SELECT * FROM auth_tokens WHERE token = ?', [tok]);
  if (!t) return null;
  if (now() > Number(t.expires_at)) {
    await db.run('DELETE FROM auth_tokens WHERE token = ?', [tok]).catch(() => {});
    return null;
  }
  await db.run('UPDATE auth_tokens SET last_used = ?, expires_at = ? WHERE token = ?',
    [now(), now() + AUTH_TTL, tok]);
  return db.get('SELECT * FROM users WHERE uid = ?', [t.uid]);
}

// Per-host feature permissions. A host gets NONE by default; an admin grants them. Admins
// are unrestricted. The client reads these (via /api/auth/me) to show/hide tools, and every
// gated endpoint re-checks server-side so a hidden feature can't be called directly.
const HOST_PERMS = ['sms', 'ads', 'export', 'broadcast'];
function effectivePerms(user) {
  const out = {};
  const isAdmin = !!(user && user.role === 'admin');
  let granted = {};
  if (user && user.role === 'host') { try { granted = JSON.parse(user.host_perms || '{}') || {}; } catch (e) {} }
  HOST_PERMS.forEach(k => { out[k] = isAdmin ? true : !!granted[k]; });
  return out;
}
// Does this user have a given feature? Admin = always; host = per-grant; anyone else = no.
function hasPerm(user, key) { return !!(user && (user.role === 'admin' || (user.role === 'host' && effectivePerms(user)[key]))); }
// Gate for session-management features: block ONLY an identity host that lacks the grant.
// Admins and legacy per-session-token callers (no identity user) pass through unchanged.
function blockedByPerm(user, key) { return !!(user && user.role === 'host' && !effectivePerms(user)[key]); }

// The monthly audience prize. Fixed today; could become per-series later.
const GIVEAWAY_PRIZE = '$500';
// Whether a host is included in the giveaway program (opt-out: NULL/1 = in, 0 = out).
function hostGiveawayEligible(user) { return !!(user && user.giveaway_eligible !== 0); }
// Giveaway context for a session's play page: the series it competes in + a PII-safe top
// board, but ONLY when the session is tagged into a series AND its owner is eligible
// (admin always; host per flag; legacy admin-token sessions with no owner count as Makin'
// It's own). Returns null when the $500 hook should not show. Points are already public
// (homepage board) — this never exposes the sealed round average/split.
async function giveawayContext(session) {
  if (!session || !session.series_id) return null;
  let ownerEligible = true; // no owner_uid = legacy admin-token session (Makin' It's own)
  if (session.owner_uid) {
    const owner = await db.get('SELECT role, giveaway_eligible FROM users WHERE uid = ?', [session.owner_uid]);
    if (!owner) ownerEligible = false;
    else if (owner.role === 'admin') ownerEligible = true;
    else if (owner.role === 'host') ownerEligible = hostGiveawayEligible(owner);
    else ownerEligible = false; // a plain player shouldn't own a session post-gate
  }
  if (!ownerEligible) return null;
  const ser = await db.get('SELECT id, title, status FROM series WHERE id = ?', [session.series_id]);
  if (!ser) return null;
  return { series_id: ser.id, title: ser.title, status: ser.status, prize: GIVEAWAY_PRIZE, board: await homeSeriesBoard(ser.id) };
}

// Can this request administer this session? True if:
//   - the user is logged in AND (role 'admin' OR they own the session), OR
//   - the legacy per-session admin token matches (back-compat / fallback).
// Returns the session row when allowed, else null.
async function canAdminSession(req, sessionId) {
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return null;
  const user = await userFromAuth(req);
  if (user && (user.role === 'admin' || session.owner_uid === user.uid)) return session;
  // legacy fallback: per-session admin token
  const tok = req.headers['x-admin-token'];
  if (tok && tok === session.admin_token) return session;
  return null;
}

// Platform admin (the role) — for platform-scope operations with no room context
// (global banners, system settings, SMS test).
async function platformAdmin(req) {
  const u = await userFromAuth(req);
  return (u && u.role === 'admin') ? u : null;
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
//   session (session.banner_id) -> global default -> none.
// (A per-song level existed briefly; it was cut as over-engineering. rounds.banner_id
// stays in the schema, dormant.)
async function resolveBanner(session) {
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
  const session = await db.get('SELECT poll_type FROM sessions WHERE id = ?', [sessionId]);
  const isBinary = session && session.poll_type === 'binary';
  // The player's own results across all ratified rounds.
  const mine = await db.all(
    `SELECT v.points, v.err, v.rank, v.tier, r.idx, r.song_title, r.room_average, r.split_a
     FROM votes v JOIN rounds r ON r.id = v.round_id
     WHERE v.participant_id = ? AND r.status = 'ratified' ORDER BY r.idx ASC`,
    [participant.id]
  );
  const roundsPlayed = mine.length;
  const totalRounds = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status = 'ratified'", [sessionId])).c;
  // "How the room felt" number: average rating (rating game) or average A-share (binary).
  const avgCol = isBinary ? 'split_a' : 'room_average';
  const avgRow = await db.get(
    `SELECT AVG(${avgCol}) AS a FROM rounds WHERE session_id = ? AND status = 'ratified' AND ${avgCol} IS NOT NULL`,
    [sessionId]
  );
  const overallRoom = avgRow && avgRow.a != null ? Number(avgRow.a) : null;

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

  const recap = {
    name: participant.name,
    poll_type: isBinary ? 'binary' : 'rating',
    totalPoints: mineTotal,
    roundsPlayed,
    totalRounds,
    avgErr: avgErr != null ? Math.round(avgErr * 10) / 10 : null,
    bullseyes,
    rank, fieldSize,
    percentile,
    best: best ? { idx: best.idx, song_title: best.song_title, points: best.points } : null,
  };
  if (isBinary) {
    // Binary: errors are on a 0–100 scale, so the 0–9 letter grade doesn't apply.
    // Surface the average A-share instead of the average rating.
    recap.overallSplitA = overallRoom != null ? Math.round(overallRoom) : null;
    recap.grade = null;
  } else {
    recap.grade = gradeForAvgError(avgErr);
    recap.overallRoomAvg = overallRoom != null ? Math.round(overallRoom * 10) / 10 : null;
  }
  return recap;
}

async function playerState(participant) {
  const sessionId = participant.session_id;
  const session = await db.get('SELECT id, name, status, scheduled_at, banner_id, poll_type, watch_url, lobby_message, broadcast_text, broadcast_at, broadcast_overlay, geo_mode, geo_label, geo_radius, owner_uid, series_id FROM sessions WHERE id = ?', [sessionId]);
  const pollType = session.poll_type === 'binary' ? 'binary' : 'rating';
  const isBinary = pollType === 'binary';
  const count = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1', [sessionId])).c;
  const round = await activeRound(sessionId);

  let view = { phase: 'waiting' }; // waiting | voting | locked | results
  if (round) {
    const myVote = await db.get('SELECT * FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    // Shape a round object for the player, carrying the A/B labels on binary rounds.
    const roundBase = {
      idx: round.idx, song_title: round.song_title, song_artist: round.song_artist,
      song_note: round.song_note, giveaway: round.giveaway, closes_at: round.closes_at,
    };
    if (isBinary) { roundBase.option_b_title = round.option_b_title; roundBase.option_b_artist = round.option_b_artist; }
    const myVoteShape = (v) => v
      ? (isBinary ? { pick: v.pick, predict_split: v.predict_split } : { taste: v.taste, predict: v.predict })
      : null;

    if (round.status === 'voting') {
      view = {
        phase: myVote ? 'locked' : 'voting',
        round: roundBase,
        myVote: myVoteShape(myVote),
      };
    } else if (round.status === 'closed') {
      view = { phase: 'locked', round: { idx: round.idx, song_title: round.song_title, ...(isBinary ? { option_b_title: round.option_b_title } : {}) }, tallying: true, myVote: myVoteShape(myVote) };
    } else if (round.status === 'ratified') {
      const ranked = await db.all('SELECT * FROM votes WHERE round_id = ? ORDER BY rank ASC', [round.id]);
      const mine = ranked.find(v => v.participant_id === participant.id);
      const winner = ranked[0]
        ? await db.get('SELECT name FROM participants WHERE id = ?', [ranked[0].participant_id])
        : null;
      // FULLY BLIND during the session: players see their points, rank, and reaction
      // tier — but NOT the room average / split, NOT their exact "off by", NOT the
      // winner's guess. The answer is saved for the end-of-session recap reveal.
      const resultRound = { idx: round.idx, song_title: round.song_title, song_artist: round.song_artist, giveaway: round.giveaway };
      if (isBinary) { resultRound.option_b_title = round.option_b_title; resultRound.option_b_artist = round.option_b_artist; }
      view = {
        phase: 'results',
        round: resultRound,
        winner: ranked[0] ? { name: winner ? winner.name : 'Someone' } : null,
        myResult: mine
          ? (isBinary
              ? { pick: mine.pick, predict_split: mine.predict_split, points: mine.points, rank: mine.rank, tier: mine.tier }
              : { taste: mine.taste, predict: mine.predict, points: mine.points, rank: mine.rank, tier: mine.tier })
          : null,
        totalPlayers: ranked.length,
      };
    } else {
      view = { phase: 'waiting' };
    }
  }

  // Referral: this player's own share code + how many people they've brought who
  // actually played (credited). The DISPLAY here is per-session; the reward is the
  // milestone bonus (creditReferralMilestones): a NEW account you bring in earns you
  // +10 pts at their 10th scored round and +75 at their 50th.
  const referredCount = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND referred_by = ? AND ref_credited = 1', [sessionId, participant.id])).c;

  // Liveness join feed (3.5d) — recent verified joiners. Names show only for COMPLETE
  // profiles; incomplete joiners appear as "someone". Count-only — no lean/direction.
  const joinRows = await db.all(
    `SELECT p.created_at, u.uid, u.name AS uname, u.profile_complete
     FROM participants p LEFT JOIN users u ON p.user_id = u.uid
     WHERE p.session_id = ? AND p.verified = 1 AND COALESCE(u.blocked, 0) = 0
     ORDER BY p.created_at DESC LIMIT 6`, [sessionId]);
  // Named (complete-profile) joiners carry their PUBLIC profile id so the feed can link
  // to /u/<id> — display name + public profile only, same PII surface as the boards.
  const joins = joinRows.map(r => ({
    name: r.profile_complete ? ((r.uname || '').toString().trim().slice(0, 40) || null) : null,
    id: r.profile_complete ? (r.uid || null) : null,
    at: Number(r.created_at) }));

  // $500 monthly-series hook (null unless this session competes for it) — drives the play
  // page giveaway banner + the third onboarding step.
  const giveaway = await giveawayContext(session);

  const out = {
    session: { id: sessionId, name: session.name, status: session.status, poll_type: pollType,
      scheduled_at: session.scheduled_at ? Number(session.scheduled_at) : null,
      watch_url: session.watch_url || null, lobby_message: session.lobby_message || null },
    poll_type: pollType,
    watch_url: session.watch_url || null,
    lobby_message: session.lobby_message || null,
    broadcast: session.broadcast_text ? { text: session.broadcast_text, at: Number(session.broadcast_at) } : null,
    me: { name: participant.name, email: participant.email, total_points: participant.total_points },
    myTotalPoints: participant.total_points,
    refCode: participant.ref_code || null,
    referredCount,
    geo: { mode: session.geo_mode || 'off', label: session.geo_label || null, radius: session.geo_radius || null },
    pool: participant.pool || null,
    participants: count,
    joins,
    giveaway,
    ...view,
  };
  // Ad slot — lobby, voting, and locked only. Never on results/recap.
  // Cascade: the room's own banner -> Revive zone (when configured) -> global banner.
  if (out.phase === 'waiting' || out.phase === 'voting' || out.phase === 'locked') {
    const own = session.banner_id ? await getBanner(session.banner_id) : null;
    if (own) out.banner = own;
    else {
      const rv = await getReviveCfg();
      if (rv) out.revive = { base: rv.base, zone: out.phase === 'waiting' ? rv.lobby : rv.game };
      else out.banner = await resolveBanner(session); // banner_id is null here -> global level
    }
  }
  if (session.status === 'completed') {
    out.phase = 'recap';
    out.recap = await buildRecap(participant);
    out.banner = null;
  }
  return out;
}

// A referral counts as "real" only once the referred player actually plays — flip
// ref_credited on their first vote. Idempotent: the WHERE clause makes re-calls no-ops.
// This is the anti-farming gate (a fake account that never plays never counts).
// Revive ad-server config (Platform panel settings), cached per instance for 60s so
// the 2.5s player poll never adds settings reads to the hot path.
let _reviveCfg = { at: 0, cfg: null };
async function getReviveCfg() {
  if (Date.now() - _reviveCfg.at < 60000) return _reviveCfg.cfg;
  const rows = await db.all("SELECT k, v FROM settings WHERE k IN ('revive_delivery_url','revive_zone_lobby','revive_zone_game')", []);
  const m = Object.fromEntries(rows.map(r => [r.k, r.v]));
  const base = (m.revive_delivery_url || '').replace(/\/+$/, '');
  const cfg = (base && (m.revive_zone_lobby || m.revive_zone_game))
    ? { base, lobby: m.revive_zone_lobby || m.revive_zone_game, game: m.revive_zone_game || m.revive_zone_lobby }
    : null;
  _reviveCfg = { at: Date.now(), cfg };
  return cfg;
}

// per-instance cache for /api/watch-embed channel-live lookups (sid -> {videoId, at})
const _liveEmbedCache = new Map();

async function creditReferral(participant) {
  if (!participant || !participant.referred_by || participant.ref_credited) return;
  await db.run('UPDATE participants SET ref_credited = 1 WHERE id = ? AND referred_by IS NOT NULL AND ref_credited = 0', [participant.id]);
}

// Referral bonus milestones (2026-07 operator decision): when a REFERRED user (durable
// first-touch, users.referrer_uid) crosses a cumulative-scored-rounds threshold, their
// referrer earns leaderboard points:
//   10 rounds → +10 pts     50 rounds → +75 pts   (one invitee is worth 85 max, ever)
// Runs at ratify for that round's voters only (bounded by room size — never on the
// boot/request path). The bonus lands on the ratified session's series board via the
// point_events ledger (live-summed with votes, per the no-stored-rollup rule) and on the
// referrer's lifetime total. Idempotency lives in the DB: the unique
// (reason, source_uid, milestone) index makes a re-fired ratify a no-op.
const REFERRAL_MILESTONES = [{ rounds: 10, points: 10 }, { rounds: 50, points: 75 }];
async function creditReferralMilestones(round, session) {
  const voters = await db.all(
    `SELECT DISTINCT u.uid, u.referrer_uid FROM votes v
       JOIN participants p ON v.participant_id = p.id
       JOIN users u        ON p.user_id = u.uid
      WHERE v.round_id = ? AND u.referrer_uid IS NOT NULL`, [round.id]);
  for (const inv of voters) {
    // Cumulative scored rounds for this invitee, across ALL sessions.
    const c = Number((await db.get(
      `SELECT COUNT(*) AS c FROM votes v
         JOIN participants p ON v.participant_id = p.id
         JOIN rounds r       ON v.round_id = r.id
        WHERE p.user_id = ? AND r.status = 'ratified'`, [inv.uid])).c) || 0;
    const due = REFERRAL_MILESTONES.filter(m => c >= m.rounds);
    if (!due.length) continue;
    const ref = await db.get('SELECT uid, blocked FROM users WHERE uid = ?', [inv.referrer_uid]);
    if (!ref || ref.blocked) continue;
    for (const m of due) {
      const ins = await db.run(
        `INSERT INTO point_events (id, user_id, points, series_id, reason, source_uid, milestone, created_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT (reason, source_uid, milestone) DO NOTHING`,
        [id(9), ref.uid, m.points, session.series_id || null, 'referral', inv.uid, m.rounds, now()]);
      // Lifetime rolls up only when the event actually landed (changes = 0 on replays).
      if (ins.changes) await db.run('UPDATE users SET lifetime_points = lifetime_points + ? WHERE uid = ?', [m.points, ref.uid]);
    }
  }
}

// Public, PII-safe state for the on-stream overlay. Shows the live truth (unlike the
// blind player view): current song/matchup, the running tally, the latest ratified
// result with the real room number, and a first-name leaderboard.
async function overlayState(session) {
  const sessionId = session.id;
  const isBinary = session.poll_type === 'binary';
  const count = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1', [sessionId])).c;
  const round = await activeRound(sessionId);
  const onlyFirst = dispName; // full display name (no first-word splitting)

  let current = null, result = null;
  if (round) {
    const votes = await db.all('SELECT * FROM votes WHERE round_id = ?', [round.id]);
    const base = {
      idx: round.idx, status: round.status, closes_at: round.closes_at,
      song_title: round.song_title, song_artist: round.song_artist, giveaway: round.giveaway,
    };
    if (isBinary) { base.option_b_title = round.option_b_title; base.option_b_artist = round.option_b_artist; }
    if (round.status === 'voting' || round.status === 'closed') {
      // Live tally: only the vote count is safe to show (the hype number). The room
      // average (rating) and the A/B split (binary) are the prediction targets — they
      // stay sealed until ratify, so we do NOT send them on the live payload at all.
      base.votes = votes.length;
      current = base;
    } else if (round.status === 'ratified') {
      const ranked = isBinary
        ? await db.all(`SELECT v.rank, v.pick, v.predict_split, v.points, p.name FROM votes v JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.rank ASC LIMIT 3`, [round.id])
        : await db.all(`SELECT v.rank, v.predict, v.points, p.name FROM votes v JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.rank ASC LIMIT 3`, [round.id]);
      result = {
        idx: round.idx, song_title: round.song_title, song_artist: round.song_artist, giveaway: round.giveaway,
        option_b_title: isBinary ? round.option_b_title : undefined,
        room: isBinary ? { split_a: round.split_a } : { average: round.room_average },
        top: ranked.map(r => ({ name: onlyFirst(r.name), points: r.points, rank: r.rank,
          ...(isBinary ? { pick: r.pick, predict_split: r.predict_split } : { predict: r.predict }) })),
        winner: ranked[0] ? onlyFirst(ranked[0].name) : null,
      };
    }
  }

  const board = await db.all('SELECT name, total_points FROM participants WHERE session_id = ? AND verified = 1 ORDER BY total_points DESC, created_at ASC LIMIT 10', [sessionId]);
  return {
    session: { id: sessionId, name: session.name, status: session.status, poll_type: isBinary ? 'binary' : 'rating' },
    participants: count,
    current,
    result,
    leaderboard: board.map((p, i) => ({ rank: i + 1, name: onlyFirst(p.name), points: p.total_points })),
    broadcast: (session.broadcast_text && session.broadcast_overlay) ? { text: session.broadcast_text, at: Number(session.broadcast_at) } : null,
  };
}

// Public series leaderboard (top N, live-computed) in the PII-safe shape the homepage
// uses. Shared by /api/home and the realtime leaderboard push so both stay identical.
// This is the board whose compute must be viewer-count-independent at scale: computed
// once here on ratify and pushed to every connected client, instead of recomputed per poll.
// Series points = vote points over the series' tagged sessions PLUS bonus point_events
// tagged to the series (referral milestones). Both live-summed — never a stored rollup.
// The UNION shape is shared by every series board (home, admin, public, share card).
const SERIES_POINTS_SRC = `
    SELECT p.user_id AS puid, v.points AS pts FROM votes v
      JOIN participants p ON v.participant_id = p.id
      JOIN rounds r       ON v.round_id = r.id
      JOIN sessions s     ON r.session_id = s.id
     WHERE s.series_id = ? AND s.deleted_at IS NULL AND v.points IS NOT NULL
    UNION ALL
    SELECT pe.user_id AS puid, pe.points AS pts FROM point_events pe WHERE pe.series_id = ?`;

async function homeSeriesBoard(seriesId, limit = 5) {
  const first = dispName; // full display name (no first-word splitting)
  const rows = await db.all(
    `SELECT u.uid, u.name, u.primary_category, u.location, u.photo_url, SUM(t.pts) AS pts
       FROM (${SERIES_POINTS_SRC}) t
       JOIN users u ON t.puid = u.uid
      WHERE u.profile_complete = 1 AND u.blocked = 0
      GROUP BY u.uid, u.name, u.primary_category, u.location, u.photo_url
      ORDER BY pts DESC, u.name ASC LIMIT ?`,
    [seriesId, seriesId, limit]);
  return rows.map((r, i) => ({ rank: i + 1, id: r.uid, name: first(r.name), category: r.primary_category || null, location: r.location || null, photoUrl: r.photo_url || null, points: Number(r.pts) || 0 }));
}

// ---- share-card data assembly (feeds share-cards.js) ----
// Names + Instagram are public promotional data (display name is already public per the PII
// rule; email/phone never appear here). Qualified A&Rs only (complete profile, not blocked).
const igClean = (s) => (s || '').toString().trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_.]/g, '') || null;

// Top 8 A&Rs. Session scope = that night's top participants (matches the overlay board — all
// verified players). Series scope = the $500 competition board (QUALIFIED only: complete
// profile, not blocked), summed across the series' tagged sessions.
async function cardArsData({ sessionId, seriesId }, limit = 8) {
  if (sessionId) {
    const rows = await db.all(
      `SELECT p.name AS pname, u.name AS uname, u.instagram, p.total_points AS pts
         FROM participants p LEFT JOIN users u ON p.user_id = u.uid
        WHERE p.session_id = ? AND p.verified = 1 AND COALESCE(u.blocked, 0) = 0
        ORDER BY pts DESC, p.created_at ASC LIMIT ?`, [sessionId, limit]);
    return rows.map(r => ({ name: r.uname || r.pname || 'A&R', ig: igClean(r.instagram), points: Number(r.pts) || 0 }));
  }
  const rows = await db.all(
    `SELECT u.name, u.instagram, SUM(t.pts) AS pts
       FROM (${SERIES_POINTS_SRC}) t
       JOIN users u ON t.puid = u.uid
      WHERE u.profile_complete = 1 AND u.blocked = 0
      GROUP BY u.uid, u.name, u.instagram
      ORDER BY pts DESC, u.name ASC LIMIT ?`, [seriesId, seriesId, limit]);
  return rows.map(r => ({ name: r.name || 'A&R', ig: igClean(r.instagram), points: Number(r.pts) || 0 }));
}

// Top 8 songs by room average — RATING sessions only (binary/Versus excluded; they have a
// split, not a 0–9 average — see the parked Versus-infographic idea). IG parsed from the note.
async function cardSongsData(sessionId, limit = 8) {
  const rows = await db.all(
    `SELECT song_title, song_artist, song_note, room_average FROM rounds
      WHERE session_id = ? AND status = 'ratified' AND room_average IS NOT NULL
      ORDER BY room_average DESC, idx ASC LIMIT ?`, [sessionId, limit]);
  return rows.map(r => {
    const m = /(?:IG|instagram)[:\s]+@?([A-Za-z0-9_.]+)/i.exec(r.song_note || '');
    return { title: r.song_title || '—', artist: r.song_artist || '', ig: m ? m[1] : null, score: Number(r.room_average) };
  });
}

// Song Report (paid artist tier): everything the 3-page report needs, computed live
// from one ratified rating round. Host-triggered only — never on the boot/poll path.
// Aggregates only: segments (role/city/pool) surface at 3+ voters; individual scores
// never leave the server.
async function songReportData(round, session) {
  const votes = await db.all(
    `SELECT v.taste, v.predict, p.pool, u.primary_category AS cat, u.location AS loc
       FROM votes v
       JOIN participants p ON v.participant_id = p.id
       LEFT JOIN users u   ON p.user_id = u.uid
      WHERE v.round_id = ? AND v.taste IS NOT NULL`, [round.id]);
  const n = votes.length;
  if (!n) return null;
  const tastes = votes.map(v => Number(v.taste)).sort((a, b) => a - b);
  const mean = tastes.reduce((a, x) => a + x, 0) / n;
  const median = n % 2 ? tastes[(n - 1) / 2] : (tastes[n / 2 - 1] + tastes[n / 2]) / 2;
  const hist = Array(10).fill(0);
  tastes.forEach(t => { if (t >= 0 && t <= 9) hist[t]++; });
  const maxC = Math.max(...hist);
  const modes = hist.map((c, i) => [i, c]).filter(([, c]) => c === maxC && c > 0).map(([i]) => i);
  const heatPct = Math.round(tastes.filter(t => t >= 8).length / n * 100);
  const preds = votes.map(v => Number(v.predict)).filter(Number.isFinite);
  const predictMean = preds.length ? preds.reduce((a, x) => a + x, 0) / preds.length : null;
  const gap = predictMean != null ? mean - predictMean : null;
  const fmt = x => Number.isInteger(x) ? String(x) : x.toFixed(1);
  // Segments: only groups with 3+ voters, top 4 by score.
  const segment = key => {
    const m = {};
    votes.forEach(v => { const k = (v[key] || '').toString().trim(); if (k) (m[k] = m[k] || []).push(Number(v.taste)); });
    return Object.entries(m)
      .filter(([, a]) => a.length >= 3)
      .map(([name, a]) => ({ name, n: a.length, avg: a.reduce((x, y) => x + y, 0) / a.length }))
      .sort((a, b) => b.avg - a.avg).slice(0, 4);
  };
  const poolAvg = pool => {
    const a = votes.filter(v => v.pool === pool).map(v => Number(v.taste));
    return a.length >= 3 ? { n: a.length, avg: a.reduce((x, y) => x + y, 0) / a.length } : null;
  };
  const inP = poolAvg('in_person'), rem = poolAvg('online');
  // Context: rank among this room's ratified rating rounds; percentile across the series.
  const roomRows = await db.all(
    "SELECT room_average FROM rounds WHERE session_id = ? AND status = 'ratified' AND room_average IS NOT NULL", [session.id]);
  const rankInRoom = { rank: roomRows.filter(r => Number(r.room_average) > Number(round.room_average)).length + 1, total: roomRows.length };
  let seriesPct = null;
  if (session.series_id) {
    const sr = await db.all(
      `SELECT r.room_average FROM rounds r JOIN sessions s ON r.session_id = s.id
        WHERE s.series_id = ? AND s.deleted_at IS NULL AND r.status = 'ratified' AND r.room_average IS NOT NULL`, [session.series_id]);
    if (sr.length >= 5) {
      const better = sr.filter(r => Number(r.room_average) > Number(round.room_average)).length;
      seriesPct = { pct: Math.max(1, Math.ceil((better + 1) / sr.length * 100)), total: sr.length };
    }
  }
  const igM = /(?:IG|instagram)[:\s]+@?([A-Za-z0-9_.]+)/i.exec(round.song_note || '');
  const dateLabel = new Date(Number(session.created_at) || Date.now())
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  return {
    votes: n,
    title: round.song_title || 'Untitled',
    sub: [round.song_artist || null, igM ? '@' + igM[1] : null].filter(Boolean).join(' · ') || session.name,
    // pages 2-3 identify the song in the subhead (the page title takes the header)
    sub23: [String(round.song_title || 'Untitled').slice(0, 24), (round.song_artist || '').slice(0, 18) || null, n + ' votes'].filter(Boolean).join(' · '),
    mean: mean.toFixed(1),
    median: fmt(median),
    mode: modes.slice(0, 2).join(' & '),
    modes,
    hist,
    heatPct,
    predictMean: predictMean != null ? predictMean.toFixed(1) : null,
    gapUp: gap != null && gap >= 0,
    gapLabel: gap == null ? '' : (gap >= 0 ? '+' : '') + gap.toFixed(1),
    gapWord: gap == null ? '' : (gap >= 0.05 ? 'It over-delivered on first impressions'
      : gap <= -0.05 ? 'Expectations ran ahead of the room' : 'It landed right on expectations'),
    medianNote: 'Half the room scored it ' + fmt(median) + ' or higher.'
      + (median > mean + 0.2 ? ' The typical listener heard more than the mean shows — a few tough critics pulled it down.' : ''),
    roles: segment('cat'),
    cities: segment('loc'),
    pools: (inP && rem) ? { in: inP, remote: rem } : null,
    rankInRoom: rankInRoom.total > 1 ? rankInRoom : null,
    seriesPct,
    dateLabel,
  };
}

// A participant's personal score card for their session.
async function cardScoreData(participant) {
  const sessionId = participant.session_id;
  const session = await db.get('SELECT name FROM sessions WHERE id = ?', [sessionId]);
  const u = participant.user_id ? await db.get('SELECT name, instagram FROM users WHERE uid = ?', [participant.user_id]) : null;
  const pts = Number(participant.total_points) || 0;
  const rank = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1 AND total_points > ?', [sessionId, pts])).c + 1;
  const total = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1', [sessionId])).c;
  const bullseyes = (await db.get("SELECT COUNT(*) AS c FROM votes WHERE participant_id = ? AND tier = 'bullseye'", [participant.id])).c;
  const rounds = (await db.get('SELECT COUNT(*) AS c FROM votes WHERE participant_id = ? AND points IS NOT NULL', [participant.id])).c;
  return {
    name: (u && u.name) || participant.name || 'A&R', ig: igClean(u && u.instagram),
    rank, total, bullseyes, rounds, points: pts, session: session ? session.name : null,
  };
}

// Upload a PNG to Vercel Blob and return its public URL. Deterministic path (re-runnable).
async function uploadPng(pathname, buf) {
  const { put } = require('@vercel/blob');
  const r = await put(pathname, buf, {
    access: 'public', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return r.url;
}

// Recap email — a light, email-safe HTML wrapper around the four graphics (hosted URLs).
const GIVEAWAY_PRIZE_LABEL = shareCards.PRIZE;
function recapEmailText(d, sessionName) {
  return `Your A&R Room recap — ${sessionName}\n\nYou ranked #${d.rank} of ${d.total}. `
    + `Post your Score Card, the Top 8 Songs and Top 8 A&Rs as one Instagram carousel and add `
    + `@Makinit4indies as a collaborator to double your reach. Play again at ANR.makinitmag.com.`;
}
function recapEmailHtml({ name, sessionName, rank, total, cards }) {
  const first = dispName(name); // greet with the full display name, not just the first word
  const imgs = [
    ['Your Score Card', cards.score],
    ['Top 8 Songs', cards.songs],
    ['Top 8 A&Rs', cards.ars],
    [`Win ${GIVEAWAY_PRIZE_LABEL}`, cards.promo],
  ].filter(([, u]) => !!u);
  const block = imgs.map(([alt, u]) =>
    `<a href="${u}" style="text-decoration:none"><img src="${u}" alt="${escapeHtml(alt)}" width="320" style="width:320px;max-width:100%;border-radius:14px;display:block;margin:0 auto 14px;border:1px solid #2e2750"></a>`
  ).join('');
  return `<div style="background:#0d0b16;padding:26px 16px;font-family:'DM Sans',system-ui,sans-serif;color:#f3f0fb">
    <div style="max-width:360px;margin:0 auto;text-align:center">
      <div style="font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#a9a2c9">The A&amp;R Room</div>
      <h1 style="font-size:22px;margin:8px 0 4px">Nice ears, ${escapeHtml(first)}.</h1>
      <p style="font-size:15px;line-height:1.5;color:#a9a2c9;margin:0 0 20px">You ranked <b style="color:#4bb749">#${rank}</b> of ${total} in <b style="color:#f3f0fb">${escapeHtml(sessionName)}</b>. Here's your recap to share.</p>
      ${block}
      <div style="background:#171328;border:1px solid #6d5fe0;border-radius:14px;padding:16px;text-align:left;margin-top:6px">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px">📲 Post it — and double your reach</div>
        <div style="font-size:13px;line-height:1.6;color:#a9a2c9">Post all four as one Instagram <b>carousel</b>. When you upload, add <b style="color:#f3f0fb">@Makinit4indies</b> as a <b>collaborator</b> — it shows on both feeds. Tag us + use <b>#TheARoom</b>.</div>
      </div>
      <p style="font-size:13px;color:#6f688f;margin:22px 0 0">Play again → <a href="https://anr.makinitmag.com" style="color:#4bb749;text-decoration:none">ANR.makinitmag.com</a></p>
    </div>
  </div>`;
}

async function adminState(session, opts = {}) {
  // Hosts (non-admin owners) see engagement — names, points, counts, socials — but NEVER
  // contact PII (email/phone). Only the platform admin (Makin' It) sees emails.
  const isAdmin = !!(opts.viewer && opts.viewer.role === 'admin');
  const sessionId = session.id;
  const pollType = session.poll_type === 'binary' ? 'binary' : 'rating';
  const isBinary = pollType === 'binary';
  const participants = await db.all(`
    SELECT p.id, p.name, p.email, p.verified, p.total_points, p.referred_by, p.pool, p.checkin_distance,
           u.instagram, u.tiktok,
           (SELECT COUNT(*) FROM participants c WHERE c.session_id = p.session_id AND c.referred_by = p.id AND c.ref_credited = 1) AS brought
    FROM participants p LEFT JOIN users u ON u.uid = p.user_id
    WHERE p.session_id = ? ORDER BY p.total_points DESC, p.created_at ASC`, [sessionId]);
  const rounds = await db.all('SELECT * FROM rounds WHERE session_id = ? ORDER BY idx ASC', [sessionId]);
  const round = await activeRound(sessionId);
  let liveVotes = [];
  if (round && (round.status === 'voting' || round.status === 'closed')) {
    liveVotes = isBinary
      ? await db.all(
          `SELECT v.pick, v.predict_split, v.locked_at, p.name FROM votes v
           JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.locked_at ASC`,
          [round.id]
        )
      : await db.all(
          `SELECT v.taste, v.predict, v.locked_at, p.name FROM votes v
           JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.locked_at ASC`,
          [round.id]
        );
  }
  // Live A/B split preview (binary only) — what % of locked votes have picked A so far.
  let liveSplit = null;
  if (isBinary && round && (round.status === 'voting' || round.status === 'closed')) {
    liveSplit = roomSplitA(liveVotes);
  }
  let ratifiedResults = null;
  if (round && round.status === 'ratified') {
    ratifiedResults = isBinary
      ? await db.all(
          `SELECT v.rank, v.pick, v.predict_split, v.err, v.points, v.tier, p.name FROM votes v
           JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.rank ASC`,
          [round.id]
        )
      : await db.all(
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
    `SELECT id, session_id, label, link_url, created_at FROM banners
      WHERE session_id = ? OR (session_id IS NULL AND (owner_uid IS NULL OR owner_uid = ?))
      ORDER BY created_at DESC`,
    [sessionId, session.owner_uid || '']
  );
  const globalBannerId = (await db.get("SELECT v FROM settings WHERE k = 'global_banner_id'"))?.v || null;
  // Latest song pushed from the magazine review site — drives the "Pull latest submission"
  // button in the queue form (shown only when one has been staged).
  let ingestLatest = null;
  const ingRow = await db.get("SELECT v FROM settings WHERE k = 'ingest_latest'");
  if (ingRow) { try { const r = JSON.parse(ingRow.v); ingestLatest = { title: r.title || '', artist: r.artist || '', at: r.at || null }; } catch (e) {} }
  const banners = bannerRows.map(b => ({
    id: b.id, label: b.label, link_url: b.link_url || null,
    scope: b.session_id ? 'session' : 'global',
    isGlobalDefault: b.id === globalBannerId,
  }));
  return {
    session: { id: session.id, name: session.name, status: session.status, admin_token: session.admin_token, banner_id: session.banner_id || null, default_minutes: session.default_minutes || DEFAULT_MINUTES, poll_type: pollType,
      watch_url: session.watch_url || null, submit_url: session.submit_url || null, lobby_message: session.lobby_message || null,
      broadcast: session.broadcast_text ? { text: session.broadcast_text, at: Number(session.broadcast_at) } : null,
      geo_mode: session.geo_mode || 'off', geo_lat: session.geo_lat ?? null, geo_lng: session.geo_lng ?? null, geo_radius: session.geo_radius || null, geo_label: session.geo_label || null,
      visibility: session.visibility || 'public', access_code: session.access_code || null },
    pools: {
      in_person: participants.filter(p => p.pool === 'in_person').length,
      online: participants.filter(p => p.pool === 'online').length,
      unchecked: participants.filter(p => !p.pool).length,
    },
    poll_type: pollType,
    participants: participants.map(p => {
      const base = { id: p.id, name: p.name, verified: p.verified, total_points: p.total_points,
        referred_by: p.referred_by, pool: p.pool, checkin_distance: p.checkin_distance, brought: p.brought,
        instagram: p.instagram || null, tiktok: p.tiktok || null };
      if (isAdmin) { base.email = p.email; } // contact PII: platform admin only
      return base;
    }),
    verifiedCount: participants.filter(p => p.verified).length,
    rounds,
    queue,
    playedCount,
    activeRound: round || null,
    liveVotes,
    liveSplit,
    ratifiedResults,
    banners,
    globalBannerId,
    ingestLatest,
    serverNow: now(),
  };
}

// Small JSON GET against the nero.fan public API (used by the "Pull Song from
// Nero" helper). No auth needed; we send an Origin so their edge is happy and
// abort after 8s so a stalled fetch never hangs the admin request.
async function neroFetch(u) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(u, { headers: { 'Origin': 'https://www.nero.fan', 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('nero ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ----- go-live notifications: SMS + email fan-out when a session flips to live -----
// Fires once per session (idempotent via notification_log). Bounded + capped so it stays
// within the function budget; at large registrant counts this should move to a queued
// drain, but for the realistic early audience an inline concurrency-limited pass covers it.
// Audience = the session's own verified participants (registering for the session is the
// consent basis for its go-live notice). SMS additionally requires sms_marketing_consent.
const NOTIFY_CAP = 800;          // hard ceiling per go-live; overflow is logged, never silently dropped
const NOTIFY_CONCURRENCY = 8;

// Run fn over items with at most `limit` in flight (keeps the fan-out inside the budget).
async function runLimited(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

function publicBaseFromReq(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'anr.makinitmag.com';
  return `${proto}://${host}`;
}

async function alreadyNotified(sessionId, participantId, channel) {
  return !!(await db.get('SELECT 1 FROM notification_log WHERE session_id = ? AND participant_id = ? AND channel = ?', [sessionId, participantId, channel]));
}
async function logNotify(sessionId, p, channel, destination, status, error) {
  try {
    await db.run('INSERT INTO notification_log (id, session_id, participant_id, user_id, channel, destination, status, error, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id(12), sessionId, p.id, p.user_id || null, channel, destination || null, status, error || null, now()]);
  } catch (e) { /* unique-index race: another worker logged first — fine */ }
}

async function dispatchGoLiveNotifications(session, base, channels) {
  const wantEmail = !!(channels && channels.email);
  const wantSms = !!(channels && channels.sms);
  // Push (channels.push) is not wired yet — deferred behind the PWA shell; ignore it here.
  if (!wantEmail && !wantSms) return { attempted: 0, sent: 0, failed: 0 };
  const sessionId = session.id;
  const parts = await db.all(
    'SELECT id, user_id, email, phone, sms_marketing_consent FROM participants WHERE session_id = ? AND verified = 1',
    [sessionId]);
  if (!parts.length) return { attempted: 0, sent: 0, failed: 0 };
  const capped = parts.slice(0, NOTIFY_CAP);
  if (parts.length > NOTIFY_CAP) console.warn(`[NOTIFY] session ${sessionId}: ${parts.length} participants exceeds cap ${NOTIFY_CAP}; notifying first ${NOTIFY_CAP}.`);
  const url = `${base}/?s=${encodeURIComponent(sessionId)}`;
  const name = session.name || 'The A&R Room';
  const smsBody = `🎧 ${name} is LIVE on The A&R Room — rate songs & read the room: ${url}\nReply STOP to opt out.`;
  const subject = `${name} is live now 🎧`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5">
    <p><strong>${escapeHtml(name)}</strong> just went live on The A&amp;R Room.</p>
    <p>Rate songs 0–9, predict the room, and climb the leaderboard.</p>
    <p><a href="${url}" style="display:inline-block;background:#4bb749;color:#06210b;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none">Join the room →</a></p>
    <p style="color:#666;font-size:13px">${url}</p></div>`;
  const text = `${name} is live on The A&R Room. Join: ${url}`;
  let sent = 0, failed = 0;
  await runLimited(capped, NOTIFY_CONCURRENCY, async (p) => {
    if (wantEmail && p.email && !(await alreadyNotified(sessionId, p.id, 'email'))) {
      const r = await sendEmail(p.email, subject, html, text);
      await logNotify(sessionId, p, 'email', p.email, r.ok ? 'sent' : 'failed', r.error);
      r.ok ? sent++ : failed++;
    }
    if (wantSms && p.phone && p.sms_marketing_consent && !(await alreadyNotified(sessionId, p.id, 'sms'))) {
      const r = await sendSms(p.phone, smsBody);
      await logNotify(sessionId, p, 'sms', p.phone, r.ok ? 'sent' : 'failed', r.error);
      r.ok ? sent++ : failed++;
    }
  });
  console.log(`[NOTIFY] session ${sessionId} go-live: ${sent} sent, ${failed} failed across ${capped.length} participants`);
  return { attempted: capped.length, sent, failed };
}

// ---------- ratify: compute result, points, ranks, bump totals ----------
async function ratifyRound(round) {
  const session = await db.get('SELECT poll_type FROM sessions WHERE id = ?', [round.session_id]);
  const isBinary = session && session.poll_type === 'binary';
  return db.tx(async (tx) => {
    const votes = await tx.all('SELECT * FROM votes WHERE round_id = ?', [round.id]);
    if (!votes.length) {
      if (isBinary) {
        await tx.run("UPDATE rounds SET status = 'ratified', split_a = NULL WHERE id = ?", [round.id]);
        return { ranked: [], split_a: null, poll_type: 'binary' };
      }
      await tx.run("UPDATE rounds SET status = 'ratified', room_average = NULL WHERE id = ?", [round.id]);
      return { ranked: [], room_average: null, poll_type: 'rating' };
    }

    let ranked, resultField;
    if (isBinary) {
      const actualA = roomSplitA(votes);
      ranked = rankBinaryVotes(votes, actualA);
      resultField = { split_a: actualA };
      await tx.run("UPDATE rounds SET status = 'ratified', split_a = ? WHERE id = ?", [actualA, round.id]);
    } else {
      const avg = roomAverage(votes);
      ranked = rankVotes(votes, avg);
      resultField = { room_average: avg };
      await tx.run("UPDATE rounds SET status = 'ratified', room_average = ? WHERE id = ?", [avg, round.id]);
    }
    for (const v of ranked) {
      await tx.run('UPDATE votes SET points = ?, err = ?, tier = ?, rank = ? WHERE id = ?', [v.points, v.err, v.tier, v.rank, v.id]);
    }
    // Bump each participant's running total by the points earned this round.
    // A round can be negative, but the cumulative leaderboard total never drops below 0.
    // This rollup is poll-type-agnostic — it just sums vote points.
    for (const v of ranked) {
      await tx.run('UPDATE participants SET total_points = CASE WHEN total_points + ? < 0 THEN 0 ELSE total_points + ? END WHERE id = ?', [v.points, v.points, v.participant_id]);
      // Also accrue to the durable user's lifetime total (floored at 0), for cross-event stats.
      await tx.run('UPDATE users SET lifetime_points = CASE WHEN lifetime_points + ? < 0 THEN 0 ELSE lifetime_points + ? END WHERE uid = (SELECT user_id FROM participants WHERE id = ?)', [v.points, v.points, v.participant_id]);
      // Count this round toward the user's lifetime rounds_voted (engagement stat).
      await tx.run('UPDATE users SET rounds_voted = rounds_voted + 1 WHERE uid = (SELECT user_id FROM participants WHERE id = ?)', [v.participant_id]);
    }
    return { ranked, ...resultField, poll_type: isBinary ? 'binary' : 'rating' };
  });
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // ----- create session (admin bootstrap) -----
  if (p === '/api/session' && method === 'POST') {
    // Session creation is invite-only: only a platform admin or an upgraded host may create.
    // (Regular viewers never should have been able to — this closes that gap.)
    const creator = await userFromAuth(req);
    if (!creator || !(creator.role === 'admin' || creator.role === 'host')) return bad(res, 'Host access required', 403);
    const { name, defaultMinutes, scheduledAt, status, pollType, watchUrl, submitUrl, lobbyMessage, bannerId, geoLabel, geoLat, geoLng, geoRadius } = await readBody(req);
    if (!name || !name.trim()) return bad(res, 'Room name required');
    const sid = id(5).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || id(4);
    const adminToken = id(18);
    const dm = clampMinutes(defaultMinutes != null ? defaultMinutes : DEFAULT_MINUTES);
    // Poll type is fixed at creation; rounds inherit it. 'rating' (0-9) is the default.
    const pt = pollType === 'binary' ? 'binary' : 'rating';
    // Optional event config — a stream link and a lobby message.
    const wu = cleanUrl(watchUrl);
    const su = cleanUrl(submitUrl);
    const lm = (lobbyMessage || '').toString().trim().slice(0, 500) || null;
    const bid = bannerId || null; // optional default ad set at creation
    // Optional venue, settable at creation (geocoded address). Enforcement stays off
    // until the host turns geo_mode on later.
    const gla = Number(geoLat), gln = Number(geoLng);
    const haveGeo = Number.isFinite(gla) && Number.isFinite(gln) && Math.abs(gla) <= 90 && Math.abs(gln) <= 180;
    const grad = Number.isFinite(Number(geoRadius)) ? Math.min(5000, Math.max(25, Math.round(Number(geoRadius)))) : null;
    const glabel = (geoLabel || '').toString().trim().slice(0, 200) || null;
    // Owner = the logged-in user creating it (if any). Falls back to null (legacy token still works).
    const ownerUid = creator.uid; // gated above → always present
    // New sessions are 'live' by default, or 'upcoming' if a future start is given.
    const st = (status === 'upcoming' || (scheduledAt && Number(scheduledAt) > now())) ? 'upcoming' : 'live';
    // Host default banner: applied when the creator set one and no explicit banner came in.
    // (Watch/submit/description defaults prefill CLIENT-side so the host can clear them.)
    let bidFinal = bid;
    if (!bidFinal && creator.host_defaults) {
      try {
        const hd = JSON.parse(creator.host_defaults);
        if (hd && hd.bannerId) {
          const b = await db.get('SELECT id FROM banners WHERE id = ? AND (owner_uid = ? OR owner_uid IS NULL)', [hd.bannerId, creator.uid]);
          if (b) bidFinal = b.id;
        }
      } catch (e) { /* malformed defaults never block creation */ }
    }
    await db.run('INSERT INTO sessions (id, name, admin_token, owner_uid, status, scheduled_at, default_minutes, poll_type, watch_url, submit_url, lobby_message, banner_id, geo_lat, geo_lng, geo_radius, geo_label, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [sid, name.trim(), adminToken, ownerUid, st, scheduledAt ? Number(scheduledAt) : null, dm, pt, wu, su, lm, bidFinal, haveGeo ? gla : null, haveGeo ? gln : null, haveGeo ? grad : null, glabel, now()]);
    return send(res, 200, { sessionId: sid, adminToken, pollType: pt });
  }

  // ===== HOST/ADMIN LOGIN (identity-based, email OTP — no per-session token) =====
  if (p === '/api/auth/request' && method === 'POST') {
    const { email } = await readBody(req);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Enter a valid email');
    const em = email.toLowerCase();
    const code = code6();
    // Reuse the otps table with a sentinel session_id for auth-scope codes.
    await db.run("DELETE FROM otps WHERE email = ? AND session_id = '__auth__'", [em]);
    await db.run("INSERT INTO otps (email, session_id, code, expires_at, attempts) VALUES (?, '__auth__', ?, ?, 0)",
      [em, code, now() + 10 * 60 * 1000]);
    const r = await sendOtp(email, code, 'your account');
    // PII-safe "what's already on file" hint so the Join flow can skip steps a returning
    // member has already done (name/phone fields, the profile step). Booleans only.
    const prior = await db.get('SELECT name, phone, profile_complete FROM users WHERE email = ?', [em]);
    const known = {
      exists: !!prior,
      hasName: !!(prior && (prior.name || '').trim()),
      hasPhone: !!(prior && (prior.phone || '').replace(/\D/g, '').length >= 7),
      profileComplete: !!(prior && prior.profile_complete),
    };
    return send(res, 200, { sent: true, devCode: r.devCode || null, known });
  }

  if (p === '/api/auth/verify' && method === 'POST') {
    const { email, code, name, phone } = await readBody(req);
    if (!email || !code) return bad(res, 'Email and code required');
    const em = email.toLowerCase();
    const otp = await db.get("SELECT * FROM otps WHERE email = ? AND session_id = '__auth__'", [em]);
    if (!otp) return bad(res, 'Request a code first');
    if (now() > Number(otp.expires_at)) return bad(res, 'Code expired. Request a new one.');
    if (String(otp.code) !== String(code).trim()) {
      await db.run("UPDATE otps SET attempts = attempts + 1 WHERE email = ? AND session_id = '__auth__'", [em]);
      return bad(res, 'Incorrect code');
    }
    // Find or create the durable user.
    let user = await db.get('SELECT * FROM users WHERE email = ?', [em]);
    if (!user) {
      const uid = id(12);
      await db.run('INSERT INTO users (uid, email, first_seen, last_seen) VALUES (?,?,?,?)', [uid, em, now(), now()]);
      user = await db.get('SELECT * FROM users WHERE uid = ?', [uid]);
    } else {
      await db.run('UPDATE users SET last_seen = ? WHERE uid = ?', [now(), user.uid]);
    }
    // Blocked accounts can't log in (admins are never blocked).
    if (user.blocked) return bad(res, 'This account has been suspended.', 403);
    // "Join the A&R Team" signup carries a display name + optional phone — set them on
    // the account (phone present => SMS opt-in, same model as a session join).
    const sName = (name || '').toString().trim().slice(0, MAX_NAME);
    if (sName) { await db.run("UPDATE users SET name = COALESCE(NULLIF(?, ''), name) WHERE uid = ?", [sName, user.uid]); user.name = user.name || sName; }
    const sPhoneRaw = (phone || '').toString().trim();
    if (sPhoneRaw && !sPhoneRaw.includes('•') && sPhoneRaw.replace(/\D/g, '').length >= 7) {
      await db.run('UPDATE users SET phone = ?, sms_marketing_consent = 1, sms_consent_at = ? WHERE uid = ?', [sPhoneRaw, now(), user.uid]);
    }
    // First-account-is-admin: the operator's first host login on a fresh install becomes
    // admin (a session can't exist without a host, so this fires before any player joins).
    if (user.role !== 'admin' && await maybePromoteFirstAdmin(user.uid)) user.role = 'admin';
    // ADMIN_EMAIL fallback/override: promote the configured superuser at login.
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
    if (adminEmail && em === adminEmail && user.role !== 'admin') {
      await db.run("UPDATE users SET role = 'admin' WHERE uid = ?", [user.uid]);
      user.role = 'admin';
    }
    // Issue a durable auth token.
    const token = id(24);
    await db.run('INSERT INTO auth_tokens (token, uid, created_at, last_used, expires_at) VALUES (?,?,?,?,?)',
      [token, user.uid, now(), now(), now() + AUTH_TTL]);
    await db.run("DELETE FROM otps WHERE email = ? AND session_id = '__auth__'", [em]);
    return send(res, 200, { token, role: user.role, uid: user.uid, email: user.email, name: user.name || null, perms: effectivePerms(user) });
  }

  // Who am I? (validates a stored auth token)
  if (p === '/api/auth/me' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user) return bad(res, 'Not logged in', 401);
    return send(res, 200, { uid: user.uid, email: user.email, name: user.name || null, role: user.role, perms: effectivePerms(user) });
  }

  // Log out this device, or all devices for this user.
  if (p === '/api/auth/logout' && method === 'POST') {
    const { allDevices } = await readBody(req);
    const tok = req.headers['x-auth-token'];
    if (!tok) return send(res, 200, { ok: true });
    if (allDevices) {
      const t = await db.get('SELECT uid FROM auth_tokens WHERE token = ?', [tok]);
      if (t) await db.run('DELETE FROM auth_tokens WHERE uid = ?', [t.uid]);
    } else {
      await db.run('DELETE FROM auth_tokens WHERE token = ?', [tok]);
    }
    return send(res, 200, { ok: true });
  }

  // List sessions the logged-in user can manage (admin: all; host: owned), grouped by status.
  if (p === '/api/auth/sessions' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user) return bad(res, 'Not logged in', 401);
    // Extra columns power the session cards: series_id (series chip), poll_type
    // (game-type attr), geo_mode (location-rule attr), and ar_count (verified
    // participants — labelled "A&Rs" in the UI). All cheap at this scale.
    const cols = `id, name, status, scheduled_at, owner_uid, created_at, series_id, poll_type, geo_mode,
      (SELECT COUNT(*) FROM participants pp WHERE pp.session_id = sessions.id AND pp.verified = 1) AS ar_count`;
    const rows = user.role === 'admin'
      ? await db.all(`SELECT ${cols} FROM sessions WHERE deleted_at IS NULL ORDER BY created_at ASC`, [])
      : await db.all(`SELECT ${cols} FROM sessions WHERE owner_uid = ? AND deleted_at IS NULL ORDER BY created_at ASC`, [user.uid]);
    return send(res, 200, { role: user.role, sessions: rows });
  }

  // ----- request OTP -----
  if (p === '/api/join/request' && method === 'POST') {
    const { sessionId, email, accessCode } = await readBody(req);
    const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session || session.deleted_at) return bad(res, 'Room not found', 404);
    if (session.status === 'completed' || session.status === 'archived') return bad(res, 'This room is closed');
    // Invite-only gate: a session with an access code only mints OTPs for people who
    // have it. Returning players re-joining still pass through here, so the code
    // guards every entry into the room. Case/whitespace-insensitive.
    if (session.access_code) {
      const given = (accessCode || '').toString().trim().toUpperCase();
      if (given !== session.access_code.trim().toUpperCase()) {
        return send(res, 403, { error: 'access_code_required', message: given ? 'That room code isn’t right.' : 'This room is invite-only — enter the room code.' });
      }
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Enter a valid email');
    const code = code6();
    await db.run('DELETE FROM otps WHERE email = ? AND session_id = ?', [email.toLowerCase(), sessionId]);
    await db.run('INSERT INTO otps (email, session_id, code, expires_at, attempts) VALUES (?,?,?,?,0)',
      [email.toLowerCase(), sessionId, code, now() + 10 * 60 * 1000]);
    const r = await sendOtp(email, code, session.name);
    // Returning-player prefill (safe subset only). This response is pre-verification, so
    // we must NOT leak raw PII to anyone who types an email. We return the name and, for
    // the phone, only a MASKED hint (last 4 digits) — never the full number. Because
    // providing a number IS the SMS opt-in, a phone on file means they're already opted
    // in; the masked hint signals that without exposing the number.
    const prior = await db.get('SELECT name, phone FROM users WHERE email = ?', [email.toLowerCase()]);
    let prefill = null;
    if (prior) {
      const digits = (prior.phone || '').replace(/\D/g, '');
      prefill = {
        name: prior.name || '',
        hasPhone: !!digits,
        phoneHint: digits ? ('••• ' + digits.slice(-4)) : null,
      };
    }
    return send(res, 200, { sent: true, devCode: r.devCode || null,
      sessionName: session.name, watchUrl: session.watch_url || null,
      returning: !!prior, prefill });
  }

  // ----- verify OTP + create/return participant -----
  if (p === '/api/join/verify' && method === 'POST') {
    const { sessionId, email, code, name, phone, keepPhone, ref } = await readBody(req);
    const em = (email || '').toLowerCase();
    // Phone handling: ignore the masked hint if it's ever echoed back; only a value with
    // real digits counts as a newly typed number.
    const phRaw = (phone || '').trim();
    const newPhone = (phRaw && !phRaw.includes('•') && phRaw.replace(/\D/g, '').length >= 7) ? phRaw : '';
    const refIn = (ref || '').toString().trim().toUpperCase().slice(0, 12) || null;
    const otp = await db.get('SELECT * FROM otps WHERE email = ? AND session_id = ?', [em, sessionId]);
    if (!otp) return bad(res, 'Request a code first');
    if (otp.attempts >= 6) return bad(res, 'Too many attempts. Request a new code.');
    if (now() > Number(otp.expires_at)) return bad(res, 'Code expired. Request a new one.');
    if (String(code).trim() !== otp.code) {
      await db.run('UPDATE otps SET attempts = attempts + 1 WHERE email = ? AND session_id = ?', [em, sessionId]);
      return bad(res, 'Incorrect code');
    }
    // Re-check the session is still open (belt-and-suspenders: could close between
    // requesting a code and verifying). You can only register for upcoming/live sessions.
    const vSession = await db.get('SELECT status, deleted_at FROM sessions WHERE id = ?', [sessionId]);
    if (!vSession || vSession.deleted_at || vSession.status === 'completed' || vSession.status === 'archived') return bad(res, 'This room is closed', 400);
    // ---- durable user identity (keyed on email, spans all sessions) ----
    // Recognize a returning player by email; create a permanent uid the first time.
    let user = await db.get('SELECT * FROM users WHERE email = ?', [em]);
    if (user && user.blocked) return bad(res, 'This account has been suspended.', 403);
    const storedDigits = user ? (user.phone || '').replace(/\D/g, '') : '';
    // Providing a phone number IS the SMS opt-in (disclosure sits under the field). The
    // effective phone is: a newly typed number, OR the stored number kept by a returning
    // user (keepPhone flag, field left as the mask). Consent = does an effective phone
    // exist. Derived server-side; no client consent flag is trusted.
    const keepingStored = (keepPhone === true || keepPhone === 1 || keepPhone === '1') && storedDigits.length >= 7;
    const effectivePhone = newPhone || (keepingStored ? user.phone : '');
    const consent = (effectivePhone.replace(/\D/g, '').length >= 7) ? 1 : 0;

    if (user) {
      await db.run('UPDATE users SET last_seen = ?, name = COALESCE(NULLIF(?,\'\'), name) WHERE uid = ?',
        [now(), (name || '').trim().slice(0, MAX_NAME), user.uid]);
      // Save a newly typed number (masked/echoed values were filtered out above).
      if (newPhone) await db.run('UPDATE users SET phone = ? WHERE uid = ?', [newPhone, user.uid]);
      // Consent reconciliation. A phone present (new or kept) => opted in (stamp on a
      // fresh opt-in). If they previously had consent but provided/kept no number now,
      // treat that as a withdrawal (keep the stored number on file, flip the flag off).
      const wasConsented = user.sms_marketing_consent === 1 || user.sms_marketing_consent === true;
      if (consent && !wasConsented) {
        await db.run('UPDATE users SET sms_marketing_consent = 1, sms_consent_at = ? WHERE uid = ?', [now(), user.uid]);
      } else if (!consent && wasConsented) {
        await db.run('UPDATE users SET sms_marketing_consent = 0 WHERE uid = ?', [user.uid]);
      }
    } else {
      const uid = id(12);
      await db.run('INSERT INTO users (uid, email, name, phone, sms_marketing_consent, sms_consent_at, first_seen, last_seen, sessions_played, lifetime_points) VALUES (?,?,?,?,?,?,?,?,0,0)',
        [uid, em, (name || '').trim().slice(0, MAX_NAME), effectivePhone || null, consent, consent ? now() : null, now(), now()]);
      user = { uid, email: em, isNewAccount: true };
    }
    // The per-session participant records the phone + consent for THIS signup.
    const ph = effectivePhone;

    // ---- per-session player record (participants = this user, in this session) ----
    let participant = await db.get('SELECT * FROM participants WHERE session_id = ? AND email = ?', [sessionId, em]);
    const token = id(18);
    if (participant) {
      await db.run('UPDATE participants SET verified = 1, token = ?, user_id = ?, name = COALESCE(NULLIF(?,\'\'), name), phone = COALESCE(NULLIF(?,\'\'), phone), sms_marketing_consent = CASE WHEN ? = 1 THEN 1 ELSE sms_marketing_consent END WHERE id = ?',
        [token, user.uid, (name || '').trim().slice(0, MAX_NAME), ph, consent, participant.id]);
      // Give an existing referral-less participant a code if they somehow lack one.
      if (!participant.ref_code) await db.run('UPDATE participants SET ref_code = ? WHERE id = ?', [refCode(), participant.id]);
    } else {
      const pid = id(9);
      // Resolve the inviter: a code must map to a DIFFERENT, verified participant in
      // THIS session, and must not be a self-referral by email. Anything else -> organic.
      let referredBy = null;
      if (refIn) {
        const inviter = await db.get('SELECT id, email, user_id FROM participants WHERE session_id = ? AND ref_code = ? AND verified = 1', [sessionId, refIn]);
        if (inviter && inviter.email !== em) {
          referredBy = inviter.id;
          // Durable FIRST-TOUCH attribution for the referral bonus: only a brand-new
          // account counts as "brought in" — referring an existing player never earns
          // milestone points (their round history would fire instantly otherwise).
          // Set once; the referrer_uid IS NULL guard means it's never reassigned.
          if (user.isNewAccount && inviter.user_id && inviter.user_id !== user.uid) {
            await db.run('UPDATE users SET referrer_uid = ? WHERE uid = ? AND referrer_uid IS NULL', [inviter.user_id, user.uid]);
          }
        }
      }
      // Generate a unique-per-session code for the new player.
      let myCode = refCode();
      for (let tries = 0; tries < 5; tries++) {
        const clash = await db.get('SELECT 1 FROM participants WHERE session_id = ? AND ref_code = ?', [sessionId, myCode]);
        if (!clash) break;
        myCode = refCode();
      }
      await db.run('INSERT INTO participants (id, session_id, user_id, email, name, phone, sms_marketing_consent, ref_code, referred_by, token, verified, total_points, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,0,?)',
        [pid, sessionId, user.uid, em, (name || '').trim().slice(0, MAX_NAME), ph || null, consent, myCode, referredBy, token, now()]);
      // First time this user appears in this session → count it toward sessions_played.
      await db.run('UPDATE users SET sessions_played = sessions_played + 1 WHERE uid = ?', [user.uid]);
    }
    await db.run('DELETE FROM otps WHERE email = ? AND session_id = ?', [em, sessionId]);
    return send(res, 200, { token });
  }

  // ----- register a logged-in account holder into a session (no OTP) -----
  // They're already identity-verified via their A&R account, so one tap adds them as a
  // participant. Only for upcoming/live sessions. Returns a per-session player token.
  if (p === '/api/join/account' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user) return bad(res, 'Not logged in', 401);
    if (user.blocked) return bad(res, 'This account has been suspended.', 403);
    const { sessionId, accessCode } = await readBody(req);
    const session = await db.get('SELECT id, status, deleted_at, access_code FROM sessions WHERE id = ?', [sessionId]);
    if (!session || session.deleted_at) return bad(res, 'Room not found', 404);
    if (session.status === 'completed' || session.status === 'archived') return bad(res, 'This room is closed — you can only register for upcoming or live rooms', 400);
    const em = (user.email || '').toLowerCase();
    const consent = ((user.phone || '').replace(/\D/g, '').length >= 7) ? 1 : 0;
    const token = id(18);
    let participant = await db.get('SELECT * FROM participants WHERE session_id = ? AND email = ?', [sessionId, em]);
    // Invite-only gate for the one-tap account join: same rule as /api/join/request.
    // Someone already seated in this session re-authing doesn't need the code again.
    if (session.access_code && !participant) {
      const given = (accessCode || '').toString().trim().toUpperCase();
      if (given !== session.access_code.trim().toUpperCase()) {
        return send(res, 403, { error: 'access_code_required', message: given ? 'That room code isn’t right.' : 'This room is invite-only — enter the room code.' });
      }
    }
    if (participant) {
      await db.run('UPDATE participants SET verified = 1, token = ?, user_id = ?, name = COALESCE(NULLIF(?,\'\'), name), phone = COALESCE(NULLIF(?,\'\'), phone) WHERE id = ?',
        [token, user.uid, (user.name || '').trim(), user.phone || '', participant.id]);
      if (!participant.ref_code) await db.run('UPDATE participants SET ref_code = ? WHERE id = ?', [refCode(), participant.id]);
    } else {
      const pid = id(9);
      let myCode = refCode();
      for (let tries = 0; tries < 5; tries++) { const clash = await db.get('SELECT 1 FROM participants WHERE session_id = ? AND ref_code = ?', [sessionId, myCode]); if (!clash) break; myCode = refCode(); }
      await db.run('INSERT INTO participants (id, session_id, user_id, email, name, phone, sms_marketing_consent, ref_code, referred_by, token, verified, total_points, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,0,?)',
        [pid, sessionId, user.uid, em, (user.name || '').trim(), user.phone || null, consent, myCode, null, token, now()]);
      await db.run('UPDATE users SET sessions_played = sessions_played + 1, last_seen = ? WHERE uid = ?', [now(), user.uid]);
    }
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

  // Player's profile (3.5a) — lives on the durable `users` row behind the participant.
  // ===== HOST DEFAULTS (prefill for new rooms: watch/submit/description/banner) =====
  if (p === '/api/me/host-defaults' && method === 'GET') {
    const u = await userFromAuth(req);
    if (!u || !(u.role === 'admin' || u.role === 'host')) return bad(res, 'Host access required', 403);
    let d = {}; try { d = JSON.parse(u.host_defaults || '{}') || {}; } catch (e) {}
    let banner = null;
    if (d.bannerId) {
      const b = await db.get('SELECT id, label FROM banners WHERE id = ?', [d.bannerId]);
      if (b) banner = { id: b.id, label: b.label || null }; else d.bannerId = null;
    }
    return send(res, 200, { defaults: { watchUrl: d.watchUrl || '', submitUrl: d.submitUrl || '', lobbyMessage: d.lobbyMessage || '', bannerId: d.bannerId || null }, banner });
  }
  if (p === '/api/me/host-defaults' && method === 'POST') {
    const u = await userFromAuth(req);
    if (!u || !(u.role === 'admin' || u.role === 'host')) return bad(res, 'Host access required', 403);
    const body = await readBody(req);
    let cur = {}; try { cur = JSON.parse(u.host_defaults || '{}') || {}; } catch (e) {}
    const d = {
      watchUrl: cleanUrl(body.watchUrl) || null,
      submitUrl: cleanUrl(body.submitUrl) || null,
      lobbyMessage: (body.lobbyMessage || '').toString().trim().slice(0, 500) || null,
      bannerId: ('bannerId' in body) ? (body.bannerId || null) : (cur.bannerId || null),
    };
    if (d.bannerId) {
      const b = await db.get('SELECT id FROM banners WHERE id = ? AND (owner_uid = ? OR owner_uid IS NULL)', [d.bannerId, u.uid]);
      if (!b) d.bannerId = null;
    }
    await db.run('UPDATE users SET host_defaults = ? WHERE uid = ?', [JSON.stringify(d), u.uid]);
    return send(res, 200, { ok: true, defaults: d });
  }
  // Upload a personal default banner (room-less, owned by the host). It only ever
  // shows in the OWNER's rooms — assigned automatically to rooms they create.
  if (p === '/api/me/host-defaults/banner' && method === 'POST') {
    const u = await userFromAuth(req);
    if (!u || !(u.role === 'admin' || u.role === 'host')) return bad(res, 'Host access required', 403);
    if (blockedByPerm(u, 'ads')) return bad(res, 'Ads are not enabled for this account', 403);
    const body = await readBody(req);
    if (body.__tooBig) return bad(res, 'Image too large — keep banners under ~500KB', 413);
    const { image_data, link_url, label } = body;
    if (!image_data || !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(image_data)) {
      return bad(res, 'Provide a PNG, JPG, GIF, or WebP image');
    }
    if (image_data.length > 900000) return bad(res, 'Image too large — keep banners under ~500KB');
    if (link_url && !/^https?:\/\//i.test(link_url)) return bad(res, 'Link must start with http:// or https://');
    const bid2 = id(9);
    await db.run('INSERT INTO banners (id, session_id, owner_uid, label, image_data, link_url, created_at) VALUES (?,NULL,?,?,?,?,?)',
      [bid2, u.uid, (label || '').trim() || null, image_data, (link_url || '').trim() || null, now()]);
    let cur = {}; try { cur = JSON.parse(u.host_defaults || '{}') || {}; } catch (e) {}
    cur.bannerId = bid2;
    await db.run('UPDATE users SET host_defaults = ? WHERE uid = ?', [JSON.stringify(cur), u.uid]);
    return send(res, 200, { bannerId: bid2 });
  }

  if (p === '/api/me/profile' && method === 'GET') {
    const userId = await resolveUserId(req);
    if (!userId) return bad(res, 'Not authenticated', 401);
    const u = await db.get('SELECT name, categories, primary_category, location, instagram, tiktok, photo_url, profile_complete FROM users WHERE uid = ?', [userId]);
    if (!u) return bad(res, 'Not found', 404);
    let cats = []; try { cats = JSON.parse(u.categories || '[]'); } catch {}
    return send(res, 200, {
      profile: {
        name: u.name || '', categories: cats, primaryCategory: u.primary_category || '',
        location: u.location || '', instagram: u.instagram || '', tiktok: u.tiktok || '',
        photoUrl: u.photo_url || null, complete: !!u.profile_complete,
      },
      categoriesAvailable: PROFILE_CATEGORIES,
    });
  }

  // Save profile (3.5a). Validates categories against the allowlist, recomputes the
  // qualification flag. Name is set at registration (not changed here); socials optional.
  if (p === '/api/me/profile' && method === 'POST') {
    const userId = await resolveUserId(req);
    if (!userId) return bad(res, 'Not authenticated', 401);
    const body = await readBody(req);
    let cats = Array.isArray(body.categories) ? body.categories.filter(c => PROFILE_CATEGORIES.includes(c)) : [];
    cats = [...new Set(cats)].slice(0, PROFILE_CATEGORIES.length);
    let primary = PROFILE_CATEGORIES.includes(body.primaryCategory) ? body.primaryCategory : null;
    if (primary && !cats.includes(primary)) cats.push(primary); // primary implies selected
    if (!primary && cats.length) primary = cats[0];             // default primary to first picked
    const location = (body.location || '').toString().trim().slice(0, 120) || null;
    const instagram = (body.instagram || '').toString().trim().replace(/^@+/, '').slice(0, 60) || null;
    const tiktok = (body.tiktok || '').toString().trim().replace(/^@+/, '').slice(0, 60) || null;
    // Display-name edit (optional; applied only when non-empty). The durable name
    // lives on users; the player's per-room participant rows sync too so boards,
    // cards, and the overlay all agree. A handful of rows, user-triggered.
    const newName = ('name' in body) ? (body.name || '').toString().trim().slice(0, MAX_NAME) : '';
    if (newName) {
      await db.run('UPDATE users SET name = ? WHERE uid = ?', [newName, userId]);
      await db.run('UPDATE participants SET name = ? WHERE user_id = ?', [newName, userId]);
    }
    const u = await db.get('SELECT name FROM users WHERE uid = ?', [userId]);
    const complete = isProfileComplete({ name: u && u.name, categories: JSON.stringify(cats), primary_category: primary, location }) ? 1 : 0;
    await db.run('UPDATE users SET categories = ?, primary_category = ?, location = ?, instagram = ?, tiktok = ?, profile_complete = ? WHERE uid = ?',
      [JSON.stringify(cats), primary, location, instagram, tiktok, complete, userId]);
    return send(res, 200, { ok: true, complete: !!complete });
  }

  // Upload a profile photo (3.5a). Receives a client-cropped, downscaled square as a
  // data URL. Stored on Vercel Blob (public CDN) when BLOB_READ_WRITE_TOKEN is set;
  // otherwise falls back to storing the data URL inline so the feature still works
  // before a Blob store exists (migrate by adding the token + re-uploading).
  if (p === '/api/me/photo' && method === 'POST') {
    const userId = await resolveUserId(req);
    if (!userId) return bad(res, 'Not authenticated', 401);
    const body = await readBody(req);
    if (body.__tooBig) return bad(res, 'Image too large — try again (crop makes a small file)', 413);
    const dataUrl = (body.image || '').toString();
    const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return bad(res, 'Invalid image');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1024 * 1024) return bad(res, 'Image too large', 413);
    let photoUrl = dataUrl, storage = 'fallback';
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { put } = require('@vercel/blob');
        const r = await put(`avatars/${userId}-${now()}.${m[1] === 'png' ? 'png' : 'jpg'}`, buf,
          { access: 'public', contentType: `image/${m[1]}`, token: process.env.BLOB_READ_WRITE_TOKEN });
        photoUrl = r.url; storage = 'blob';
      } catch (e) {
        console.error('[blob] upload failed, using data-URL fallback:', e && e.message);
        storage = 'error:' + ((e && e.message) || 'unknown').slice(0, 80);
      }
    }
    await db.run('UPDATE users SET photo_url = ? WHERE uid = ?', [photoUrl, userId]);
    return send(res, 200, { ok: true, photoUrl, storage }); // storage tells us which path ran
  }

  // Diagnostic: is Vercel Blob configured for this runtime? Boolean only, no secret.
  if (p === '/api/health/blob' && method === 'GET') {
    return send(res, 200, { configured: !!process.env.BLOB_READ_WRITE_TOKEN });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN USER MANAGEMENT — searchable users list + block (reversible) + delete (hard).
  // ─────────────────────────────────────────────────────────────────────────
  if (p === '/api/admin/users' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const status = url.searchParams.get('status') || '';      // active | blocked | ''
    const skill = url.searchParams.get('skill') || '';        // a category
    const skillMode = url.searchParams.get('skillMode') === 'any' ? 'any' : 'primary'; // primary|any
    const loc = (url.searchParams.get('location') || '').trim().toLowerCase();
    const sort = url.searchParams.get('sort') || 'recent';    // recent | points | name | sessions | series
    const where = [], params = [];
    if (q) { where.push('(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    if (status === 'blocked') where.push('u.blocked = 1');
    else if (status === 'active') where.push('u.blocked = 0');
    if (skill && PROFILE_CATEGORIES.includes(skill)) {
      // 'primary' matches the headline role; 'any' matches anyone with that role at all
      // (categories is a JSON array, so a quoted-token LIKE is a safe contains check).
      if (skillMode === 'any') { where.push('u.categories LIKE ?'); params.push('%"' + skill + '"%'); }
      else { where.push('u.primary_category = ?'); params.push(skill); }
    }
    if (loc) { where.push('LOWER(u.location) LIKE ?'); params.push('%' + loc + '%'); }
    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    // Series participated: distinct series a user has scored votes in.
    const seriesSub = `(SELECT COUNT(DISTINCT s.series_id) FROM votes v JOIN participants p ON v.participant_id = p.id JOIN rounds r ON v.round_id = r.id JOIN sessions s ON r.session_id = s.id WHERE p.user_id = u.uid AND s.series_id IS NOT NULL)`;
    const sessSub = `(SELECT COUNT(DISTINCT session_id) FROM participants WHERE user_id = u.uid AND verified = 1)`;
    const orderSql = sort === 'points' ? 'u.lifetime_points DESC' : sort === 'name' ? 'u.name ASC'
      : sort === 'sessions' ? `${sessSub} DESC` : sort === 'series' ? `${seriesSub} DESC` : 'u.last_seen DESC';
    const total = (await db.get(`SELECT COUNT(*) AS c FROM users u ${whereSql}`, params)).c;
    const rows = await db.all(
      `SELECT u.uid, u.name, u.email, u.role, u.blocked, u.host_perms, u.giveaway_eligible, u.profile_complete, u.primary_category, u.location, u.photo_url, u.lifetime_points, u.last_seen,
         ${sessSub} AS sessions, ${seriesSub} AS series_participated
       FROM users u ${whereSql} ORDER BY ${orderSql} LIMIT 100`, params);
    return send(res, 200, {
      total: Number(total) || 0,
      users: rows.map(r => ({ id: r.uid, name: r.name || null, email: r.email, role: r.role, blocked: !!r.blocked,
        perms: r.role === 'host' ? effectivePerms(r) : null,
        giveaway: r.role === 'host' ? hostGiveawayEligible(r) : null,
        profileComplete: !!r.profile_complete, primaryCategory: r.primary_category || null, location: r.location || null,
        photoUrl: r.photo_url || null, points: Number(r.lifetime_points) || 0, sessions: Number(r.sessions) || 0,
        seriesParticipated: Number(r.series_participated) || 0,
        lastSeen: r.last_seen ? Number(r.last_seen) : null })),
      categories: PROFILE_CATEGORIES,
    });
  }

  // Block / unblock a user (reversible). Admins can't be blocked. Blocking logs them out.
  if (p === '/api/admin/users/block' && method === 'POST') {
    const admin = await userFromAuth(req);
    if (!admin || admin.role !== 'admin') return bad(res, 'Admin only', 403);
    const { uid, blocked } = await readBody(req);
    const u = await db.get('SELECT uid, role FROM users WHERE uid = ?', [uid]);
    if (!u) return bad(res, 'User not found', 404);
    if (u.role === 'admin') return bad(res, "Admins can't be blocked");
    const b = blocked ? 1 : 0;
    await db.run('UPDATE users SET blocked = ? WHERE uid = ?', [b, uid]);
    if (b) await db.run('DELETE FROM auth_tokens WHERE uid = ?', [uid]); // force-logout
    return send(res, 200, { ok: true, blocked: !!b });
  }

  // Hard-delete a user (admin). PERMANENT — removes the account, its participations, and
  // its votes in one transaction (changes any leaderboard that counted them). Name-confirmed.
  // Grant/revoke the host role (platform-admin only) — the invite-only upgrade. Only toggles
  // between 'host' and 'player'; never touches admins.
  if (p === '/api/admin/users/role' && method === 'POST') {
    const admin = await userFromAuth(req);
    if (!admin || admin.role !== 'admin') return bad(res, 'Admin only', 403);
    const { uid, role } = await readBody(req);
    if (!uid) return bad(res, 'uid required');
    if (role !== 'host' && role !== 'player') return bad(res, 'Role must be host or player');
    const u = await db.get('SELECT uid, role FROM users WHERE uid = ?', [uid]);
    if (!u) return bad(res, 'User not found', 404);
    if (u.role === 'admin') return bad(res, "Can't change an admin's role here");
    await db.run('UPDATE users SET role = ? WHERE uid = ?', [role, uid]);
    return send(res, 200, { ok: true, uid, role });
  }

  // Set a host's feature permissions (platform-admin only): { sms, ads, export, broadcast }.
  if (p === '/api/admin/users/perms' && method === 'POST') {
    const admin = await userFromAuth(req);
    if (!admin || admin.role !== 'admin') return bad(res, 'Admin only', 403);
    const { uid, perms } = await readBody(req);
    if (!uid) return bad(res, 'uid required');
    const u = await db.get('SELECT uid, host_perms FROM users WHERE uid = ?', [uid]);
    if (!u) return bad(res, 'User not found', 404);
    // Merge: only the provided keys change; the rest keep their current value.
    let merged = {}; try { merged = JSON.parse(u.host_perms || '{}') || {}; } catch (e) {}
    const clean = {};
    HOST_PERMS.forEach(k => { clean[k] = (perms && k in perms) ? !!perms[k] : !!merged[k]; });
    await db.run('UPDATE users SET host_perms = ? WHERE uid = ?', [JSON.stringify(clean), uid]);
    return send(res, 200, { ok: true, uid, perms: clean });
  }

  // Include / exclude a host from the monthly $500 giveaway (platform-admin only): { uid, on }.
  // Only meaningful for hosts (admins are always in); the session must still be series-tagged.
  if (p === '/api/admin/users/giveaway' && method === 'POST') {
    const admin = await userFromAuth(req);
    if (!admin || admin.role !== 'admin') return bad(res, 'Admin only', 403);
    const { uid, on } = await readBody(req);
    if (!uid) return bad(res, 'uid required');
    const u = await db.get('SELECT uid FROM users WHERE uid = ?', [uid]);
    if (!u) return bad(res, 'User not found', 404);
    await db.run('UPDATE users SET giveaway_eligible = ? WHERE uid = ?', [on ? 1 : 0, uid]);
    return send(res, 200, { ok: true, uid, giveaway: !!on });
  }

  if (p === '/api/admin/users/delete' && method === 'POST') {
    const admin = await userFromAuth(req);
    if (!admin || admin.role !== 'admin') return bad(res, 'Admin only', 403);
    const { uid, confirmName } = await readBody(req);
    const u = await db.get('SELECT uid, name, email, role FROM users WHERE uid = ?', [uid]);
    if (!u) return bad(res, 'User not found', 404);
    if (u.role === 'admin') return bad(res, "Admins can't be deleted here");
    const expected = (u.name && u.name.trim()) ? u.name : u.email;
    if ((confirmName || '') !== expected) return bad(res, 'Does not match — type it exactly to confirm');
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM votes WHERE participant_id IN (SELECT id FROM participants WHERE user_id = ?)', [uid]);
      await tx.run('DELETE FROM participants WHERE user_id = ?', [uid]);
      await tx.run('DELETE FROM auth_tokens WHERE uid = ?', [uid]);
      await tx.run('DELETE FROM otps WHERE email = ?', [u.email]);
      await tx.run('DELETE FROM users WHERE uid = ?', [uid]);
    });
    return send(res, 200, { ok: true, deleted: true });
  }

  // Public profile (no auth) — PII-safe: photo, name, role(s), city, socials, and
  // competition stats (points, sessions, current series rank). 404 for blocked/missing.
  if (p === '/api/profile' && method === 'GET') {
    const uid = url.searchParams.get('u') || url.searchParams.get('id');
    if (!uid) return bad(res, 'Profile id required');
    const u = await db.get('SELECT uid, name, categories, primary_category, location, instagram, tiktok, photo_url, blocked, lifetime_points FROM users WHERE uid = ?', [uid]);
    if (!u || u.blocked) return bad(res, 'Profile not found', 404);
    let cats = []; try { cats = JSON.parse(u.categories || '[]'); } catch {}
    const sessions = (await db.get('SELECT COUNT(DISTINCT session_id) AS c FROM participants WHERE user_id = ? AND verified = 1', [uid])).c;
    // Current series rank: rank among qualified (complete, non-blocked) A&Rs in the active
    // series, by summed points. Null if no active series or they haven't qualified there.
    let seriesRank = null, seriesTitle = null;
    const ser = (await db.get("SELECT id, title FROM series WHERE status = 'active' ORDER BY created_at DESC LIMIT 1", []))
      || (await db.get('SELECT id, title FROM series ORDER BY created_at DESC LIMIT 1', []));
    if (ser) {
      const ranked = await db.all(
        `SELECT u2.uid, SUM(v.points) AS pts FROM votes v
         JOIN participants p ON v.participant_id = p.id
         JOIN users u2       ON p.user_id = u2.uid
         JOIN rounds r       ON v.round_id = r.id
         JOIN sessions s     ON r.session_id = s.id
         WHERE s.series_id = ? AND s.deleted_at IS NULL AND v.points IS NOT NULL AND u2.profile_complete = 1 AND u2.blocked = 0
         GROUP BY u2.uid ORDER BY pts DESC`, [ser.id]);
      const idx = ranked.findIndex(r => r.uid === uid);
      if (idx >= 0) { seriesRank = idx + 1; seriesTitle = ser.title; }
    }
    return send(res, 200, {
      profile: {
        id: u.uid, name: u.name || 'A&R', categories: cats, primaryCategory: u.primary_category || null,
        location: u.location || null, instagram: u.instagram || null, tiktok: u.tiktok || null,
        photoUrl: u.photo_url || null,
        stats: { points: Number(u.lifetime_points) || 0, sessions: Number(sessions) || 0, seriesRank, seriesTitle },
      },
    });
  }

  // ----- beta feedback (public; no auth required) -----
  // Logs the text to the DB for later review, then best-effort emails the admin (with
  // the optional screenshot as an attachment). Email failure NEVER blocks the submit —
  // the DB log is the source of truth. The screenshot is emailed, not stored in the DB.
  if (p === '/api/feedback' && method === 'POST') {
    const body = await readBody(req);
    const message = (body.message || '').toString().trim();
    if (!message) return bad(res, 'Please enter a message');
    if (message.length > 4000) return bad(res, 'Message is too long (max 4000 characters)');
    const sessionId = (body.sessionId || '').toString().slice(0, 64) || null;
    const contactEmail = (body.contactEmail || '').toString().trim().slice(0, 200) || null;
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 400) || null;

    // Resolve participant + session context if the caller is a known player.
    let participant = null;
    try { participant = await participantFromReq(req); } catch (e) { /* anonymous is fine */ }
    const effectiveSessionId = (participant && participant.session_id) || sessionId;
    let sessionName = '';
    if (effectiveSessionId) {
      const s = await db.get('SELECT name FROM sessions WHERE id = ?', [effectiveSessionId]);
      if (s) sessionName = s.name;
    }

    // Validate the optional screenshot (emailed only). Cap the size to keep the request
    // sane; a base64 image > ~7MB (~5.25MB raw) is rejected rather than stored/sent.
    let image = null;
    if (body.image && typeof body.image === 'string') {
      const m = body.image.match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/);
      if (!m) return bad(res, 'Screenshot must be a PNG, JPEG, WEBP or GIF image');
      const b64 = m[3];
      if (b64.length > 7 * 1024 * 1024) return bad(res, 'Screenshot is too large (max ~5MB)');
      const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
      image = { dataBase64: b64, mime: m[1], filename: `screenshot.${ext}` };
    }

    // 1) Durable log first — this is the record you'll review later.
    const fid = id(10);
    await db.run(
      'INSERT INTO feedback (id, session_id, participant_id, message, had_screenshot, contact_email, user_agent, emailed, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [fid, effectiveSessionId, participant ? participant.id : null, message, image ? 1 : 0, contactEmail, userAgent, 0, now()]
    );

    // 2) Best-effort email to the admin. Never blocks the response.
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
    if (adminEmail) {
      sendFeedback(adminEmail, {
        message, sessionName, sessionId: effectiveSessionId || '',
        fromName: participant ? (participant.name || '') : '',
        fromEmail: contactEmail || (participant ? participant.email : '') || '',
        userAgent, image,
      }).then(r => {
        if (r && r.ok) db.run('UPDATE feedback SET emailed = 1 WHERE id = ?', [fid]).catch(() => {});
      }).catch(() => { /* swallow — DB log already captured it */ });
    }

    return send(res, 200, { ok: true });
  }

  // ----- public overlay state (no auth; PII-safe display data for OBS/venue screens) -----
  // Keyed only by session id. Returns what's safe to show on a stream: session name,
  // current song/matchup, live tally, the most recent ratified result, and a first-name
  // leaderboard. No emails, phones, or sign-up answers ever leave this endpoint.
  // ----- public session info (no auth) — lets the player page show the room name/status
  // BEFORE login, so the header isn't blank on a fresh session. PII-safe: name + status
  // + lightweight join context only.
  if (p === '/api/session/info' && method === 'GET') {
    const sessionId = url.searchParams.get('s') || url.searchParams.get('sessionId');
    const session = sessionId ? await db.get('SELECT id, name, status, deleted_at, watch_url, lobby_message FROM sessions WHERE id = ?', [sessionId]) : null;
    if (!session || session.deleted_at) return bad(res, 'Room not found', 404);
    return send(res, 200, {
      id: session.id,
      name: session.name,
      status: session.status,
      closed: session.status === 'completed' || session.status === 'archived',
      watchUrl: session.watch_url || null,
      lobbyMessage: session.lobby_message || null,
    });
  }

  if (p === '/api/overlay/state' && method === 'GET') {
    const sessionId = url.searchParams.get('s') || url.searchParams.get('sessionId');
    const session = sessionId ? await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]) : null;
    if (!session) return bad(res, 'Room not found', 404);
    return send(res, 200, await overlayState(session));
  }

  // ----- check in to an event (sets the player's pool: in_person | online) -----
  // Called when the player taps "Check in" at first lock-in. We use precise coords
  // ONLY to compute distance, then discard them — we persist only the pool + a coarse
  // distance for the host's auditing. Accuracy-aware: a low-confidence reading near the
  // boundary is admitted (the venue's own GPS is imprecise indoors).
  if (p === '/api/checkin' && method === 'POST') {
    const participant = await participantFromReq(req);
    if (!participant) return bad(res, 'Not authenticated', 401);
    const { lat, lng, accuracy, declined } = await readBody(req);
    const session = await db.get('SELECT geo_mode, geo_lat, geo_lng, geo_radius FROM sessions WHERE id = ?', [participant.session_id]);
    const mode = session ? session.geo_mode : 'off';
    if (mode === 'off' || session.geo_lat == null || session.geo_lng == null) {
      // No geofence configured — everyone is simply "online" (or unpooled). Nothing to check.
      await db.run("UPDATE participants SET pool = COALESCE(pool, 'online') WHERE id = ?", [participant.id]);
      return send(res, 200, { pool: 'online', checked_in: true, geofenced: false });
    }
    // Player declined to share location.
    if (declined || lat == null || lng == null) {
      if (mode === 'required') return bad(res, 'This event needs your location to check you in. Please allow location access.', 422);
      // optional mode: treat as online
      await db.run("UPDATE participants SET pool = 'online', checkin_distance = NULL WHERE id = ?", [participant.id]);
      return send(res, 200, { pool: 'online', checked_in: true, geofenced: true });
    }
    const la = Number(lat), ln = Number(lng), acc = Number(accuracy) || 0;
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return bad(res, 'Invalid location reading');
    const radius = session.geo_radius || DEFAULT_GEO_RADIUS;
    const dist = distanceYards(session.geo_lat, session.geo_lng, la, ln);
    // Admit if within radius, OR if the reading's own uncertainty (accuracy, in meters
    // -> yards) plausibly places them inside. This forgives bad indoor GPS.
    const accYards = acc * 1.09361;
    const inPerson = dist <= radius || (dist - accYards) <= radius;
    const coarse = Math.round(dist); // store coarse distance only — never raw coords
    if (inPerson) {
      await db.run("UPDATE participants SET pool = 'in_person', checkin_distance = ? WHERE id = ?", [coarse, participant.id]);
      return send(res, 200, { pool: 'in_person', checked_in: true, geofenced: true, distance: coarse });
    }
    // Out of radius.
    if (mode === 'required') {
      return send(res, 200, { pool: null, checked_in: false, geofenced: true, distance: coarse,
        message: 'You\u2019re not at the event location, so you can\u2019t vote in this in-person room.' });
    }
    await db.run("UPDATE participants SET pool = 'online', checkin_distance = ? WHERE id = ?", [coarse, participant.id]);
    return send(res, 200, { pool: 'online', checked_in: true, geofenced: true, distance: coarse });
  }

  // ----- cast vote -----
  // Ably realtime token: mint a subscribe-only token for a session's channel. The API
  // key never leaves the server. Returns { enabled:false } when no key is configured so
  // the client falls back to polling. Also serves as the Ably authUrl for renewals.
  if (p === '/api/ably/token' && method === 'GET') {
    if (!realtime.isEnabled()) return send(res, 200, { enabled: false });
    const sessionId = url.searchParams.get('s') || url.searchParams.get('sessionId');
    if (!sessionId) return bad(res, 'session required');
    try {
      const tr = await realtime.tokenRequest(sessionId, null);
      return send(res, 200, tr);
    } catch (e) {
      console.error('[realtime] token error:', e.message);
      return send(res, 200, { enabled: false }); // fail soft -> client polls
    }
  }

  // ----- ingest a song from the magazine's review site (Drupal /review page) -----
  // That page shows a random submission; its "Send to A&R Room" button POSTs the shown song
  // here. We stash it as the latest staged submission; the host then clicks "Pull latest
  // submission" in the queue form (same UX as Pull from Nero). Token-gated + CORS'd to the
  // magazine origin; disabled (503) until INGEST_TOKEN is set in the environment.
  if (p === '/api/ingest/submission' && method === 'OPTIONS') {
    return send(res, 204, '', ingestCors(req));
  }
  if (p === '/api/ingest/submission' && method === 'POST') {
    const cors = ingestCors(req);
    const token = process.env.INGEST_TOKEN || '';
    if (!token) return send(res, 503, { error: 'Ingest not configured' }, cors);
    const body = await readBody(req);
    const given = req.headers['x-ingest-token'] || body.token || '';
    if (given !== token) return send(res, 401, { error: 'Bad token' }, cors);
    const clip = (s, n) => (s == null ? '' : String(s)).trim().slice(0, n);
    const rec = { title: clip(body.title, 200), artist: clip(body.artist, 200),
      instagram: clip((body.instagram || '').toString().replace(/^@+/, ''), 60) || null,
      source: clip(body.source, 60) || 'makinitmag', at: now() };
    if (!rec.title && !rec.artist) return send(res, 400, { error: 'Need at least a title or artist' }, cors);
    await db.run("INSERT INTO settings (k,v) VALUES ('ingest_latest', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [JSON.stringify(rec)]);
    return send(res, 200, { ok: true, staged: { title: rec.title, artist: rec.artist } }, cors);
  }

  // Send a one-off test SMS to verify the Twilio config (no session needed). Reports the
  // active provider so the UI can flag when SMS_PROVIDER is still 'console' (logs, no send).
  if (p === '/api/admin/sms/test' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user) return bad(res, 'Not logged in', 401);
    const { to } = await readBody(req);
    if (!to || !to.trim()) return bad(res, 'Phone number required');
    const r = await sendSms(to.trim(), '🎧 Test from The A&R Room — your SMS setup is working! Reply STOP to opt out.');
    return send(res, 200, { ok: !!r.ok, provider: SMS_PROVIDER, error: r.error || null });
  }

  // Host pulls the latest staged submission into the queue form (mirrors nero-pull).
  if (p === '/api/admin/ingest/latest' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user) return bad(res, 'Not logged in', 401);
    const row = await db.get("SELECT v FROM settings WHERE k = 'ingest_latest'");
    if (!row) return send(res, 200, { empty: true });
    try { return send(res, 200, JSON.parse(row.v)); }
    catch (e) { return send(res, 200, { empty: true }); }
  }

  if (p === '/api/vote' && method === 'POST') {
    const participant = await participantFromReq(req);
    if (!participant) return bad(res, 'Not authenticated', 401);
    // Blocked accounts can't vote (and their existing votes are already excluded from
    // every board). Also stamp activity so "last seen" reflects real play, not just login.
    if (participant.user_id) {
      const pu = await db.get('SELECT blocked FROM users WHERE uid = ?', [participant.user_id]);
      if (pu && pu.blocked) return bad(res, 'This account has been suspended.', 403);
      await db.run('UPDATE users SET last_seen = ? WHERE uid = ?', [now(), participant.user_id]);
    }
    const body = await readBody(req);
    const round = await activeRound(participant.session_id);
    if (!round || round.status !== 'voting') return bad(res, 'Voting is not open');
    if (round.closes_at && now() > Number(round.closes_at)) return bad(res, 'Time is up');
    const existing = await db.get('SELECT id FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    if (existing) return bad(res, 'You already locked in');
    const session = await db.get('SELECT poll_type, geo_mode FROM sessions WHERE id = ?', [participant.session_id]);
    const isBinary = session && session.poll_type === 'binary';
    // Geo gate: when enforcement is on, a player must check in before their FIRST
    // lock-in. The client intercepts this code and shows the check-in prompt.
    // 'required' demands an at-venue check-in specifically — an 'online' pool from an
    // earlier optional phase doesn't count once the host tightens the mode; the player
    // is sent back through check-in (which upgrades them to in_person at the venue).
    if (session && session.geo_mode && session.geo_mode !== 'off') {
      const needCheckin = session.geo_mode === 'required'
        ? participant.pool !== 'in_person'
        : !participant.pool;
      if (needCheckin) return send(res, 428, { error: 'checkin_required', geo_mode: session.geo_mode });
    }

    if (isBinary) {
      // Binary vote: pick a side + predict the room's A/B split. Reject rating-shaped votes.
      const { pick, predict_split } = body;
      if (body.taste != null || body.predict != null) return bad(res, 'This is a Versus round — pick a side and predict the split');
      const pk = String(pick || '').toUpperCase();
      if (pk !== 'A' && pk !== 'B') return bad(res, 'Pick a side: A or B');
      const sp = Number(predict_split);
      if (!(sp >= 0 && sp <= 100)) return bad(res, 'Split prediction must be 0–100');
      await db.run('INSERT INTO votes (id, round_id, participant_id, pick, predict_split, locked_at) VALUES (?,?,?,?,?,?)',
        [id(9), round.id, participant.id, pk, sp, now()]);
      await creditReferral(participant);
      return send(res, 200, { locked: true });
    }

    // Rating vote (unchanged): rate 0–9, predict the room average 0.0–9.0.
    const { taste, predict } = body;
    if (body.pick != null || body.predict_split != null) return bad(res, 'This is a rating round — rate the song and predict the average');
    const t = Number(taste), pr = Number(predict);
    if (!Number.isInteger(t) || t < 0 || t > 9) return bad(res, 'Rating must be 0–9');
    if (!(pr >= 0 && pr <= 9)) return bad(res, 'Prediction must be 0.0–9.0');
    await db.run('INSERT INTO votes (id, round_id, participant_id, taste, predict, locked_at) VALUES (?,?,?,?,?,?)',
      [id(9), round.id, participant.id, t, pr, now()]);
    await creditReferral(participant);
    return send(res, 200, { locked: true });
  }

  // Resolve a channel "/live" watch link to the CURRENT live video id, so the host
  // can keep a permanent link (youtube.com/@handle/live) and the play page still
  // gets a real embed whenever the channel is live. Direct video URLs short-circuit
  // without any network call. Cached per instance for 2 minutes; the client asks at
  // most every few minutes — this never rides the 2.5s poll.
  if (p === '/api/watch-embed' && method === 'GET') {
    const sid = url.searchParams.get('s');
    if (!sid) return bad(res, 'session required');
    const sess = await db.get('SELECT watch_url FROM sessions WHERE id = ? AND deleted_at IS NULL', [sid]);
    const wu = (sess && sess.watch_url || '').trim();
    if (!wu) return send(res, 200, { videoId: null });
    const direct = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|[?&]v=)([A-Za-z0-9_-]{11})/.exec(wu);
    if (direct) return send(res, 200, { videoId: direct[1] });
    // Only channel-live forms get resolved (@handle, /c/, /user/, /channel/, legacy vanity).
    if (!/^https?:\/\/(?:www\.)?youtube\.com\/[^?#]+\/live\/?(?:[?#].*)?$/i.test(wu)) {
      return send(res, 200, { videoId: null });
    }
    const cached = _liveEmbedCache.get(sid);
    if (cached && Date.now() - cached.at < 120000) return send(res, 200, { videoId: cached.videoId, channelId: cached.channelId || null, live: !!cached.live, cached: true });
    let videoId = null, channelId = null, live = false;
    // A /channel/UC…/live URL carries the channel id in plain sight — grab it up front
    // (it also powers the embed/live_stream?channel= fallback the operator uses on
    // the magazine site).
    const ucInUrl = /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})\//.exec(wu);
    if (ucInUrl) channelId = ucInUrl[1];
    try {
      const r = await fetch(wu, {
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'en' },
      });
      const html = await r.text();
      live = /"isLiveNow"\s*:\s*true/.test(html);
      const canon = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/.exec(html);
      // Trust the video id only when the stream is live RIGHT NOW — a scheduled or
      // ended stream would embed as a countdown/replay, not the show.
      if (canon && live) videoId = canon[1];
      // Channel id appears under different keys depending on live state — try each.
      const uc = /"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/.exec(html)
        || /"externalId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/.exec(html)
        || /itemprop="(?:channelId|identifier)" content="(UC[0-9A-Za-z_-]{22})"/.exec(html)
        || /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/.exec(html);
      if (uc) channelId = uc[1]; // never changes for a channel
    } catch (e) { /* unreachable/slow -> treat as not live; cache the miss */ }
    _liveEmbedCache.set(sid, { videoId, channelId, live, at: Date.now() });
    return send(res, 200, { videoId, channelId, live });
  }

  // ===== ADMIN =====
  // Round history for the console's Rounds tab. Fetched lazily when the tab opens
  // (NOT on the 2s poll), so it adds nothing to the steady-state request path.
  // Powers per-round Song Reports after the show.
  if (p === '/api/admin/rounds' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const rounds = await db.all(
      `SELECT r.id, r.idx, r.status, r.song_title, r.song_artist, r.option_b_title, r.room_average, r.split_a,
              (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id) AS votes
         FROM rounds r WHERE r.session_id = ? ORDER BY r.idx ASC`, [sessionId]);
    return send(res, 200, { rounds: rounds.map(r => ({
      id: r.id, idx: r.idx, status: r.status, song_title: r.song_title, song_artist: r.song_artist,
      option_b_title: r.option_b_title || null,
      room_average: r.room_average != null ? Number(r.room_average) : null,
      split_a: r.split_a != null ? Number(r.split_a) : null,
      votes: Number(r.votes) || 0,
    })) });
  }

  // ===== PLATFORM CONTROL PANEL (admin role only) =====
  // Everything platform-scoped in one payload: the banner library + system settings.
  if (p === '/api/admin/platform' && method === 'GET') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const banners = await db.all('SELECT id, session_id, label, link_url, created_at FROM banners ORDER BY created_at DESC', []);
    const globalBannerId = (await db.get("SELECT v FROM settings WHERE k = 'global_banner_id'"))?.v || null;
    const houseSubmitUrl = (await db.get("SELECT v FROM settings WHERE k = 'house_submit_url'"))?.v || null;
    return send(res, 200, {
      banners: banners.map(b => ({ id: b.id, label: b.label || null, link: b.link_url || null,
        scope: b.session_id ? 'room' : 'global', roomId: b.session_id || null,
        isGlobalDefault: b.id === globalBannerId })),
      settings: { houseSubmitUrl,
        reviveDeliveryUrl: (await db.get("SELECT v FROM settings WHERE k = 'revive_delivery_url'"))?.v || null,
        reviveZoneLobby: (await db.get("SELECT v FROM settings WHERE k = 'revive_zone_lobby'"))?.v || null,
        reviveZoneGame: (await db.get("SELECT v FROM settings WHERE k = 'revive_zone_game'"))?.v || null },
      smsProvider: (process.env.SMS_PROVIDER || 'none'),
    });
  }
  // System settings — allowlisted keys only; empty string clears back to the default.
  if (p === '/api/admin/settings' && method === 'POST') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const body = await readBody(req);
    if ('houseSubmitUrl' in body) {
      const v = cleanUrl(body.houseSubmitUrl);
      if (v) await db.run("INSERT INTO settings (k,v) VALUES ('house_submit_url', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [v]);
      else await db.run("DELETE FROM settings WHERE k = 'house_submit_url'");
    }
    // Revive ad server: delivery base URL + a zone per placement. Empty clears.
    const setOrClear = async (k, v) => {
      if (v) await db.run(`INSERT INTO settings (k,v) VALUES ('${k}', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, [v]);
      else await db.run(`DELETE FROM settings WHERE k = '${k}'`);
    };
    if ('reviveDeliveryUrl' in body) await setOrClear('revive_delivery_url', cleanUrl(body.reviveDeliveryUrl));
    if ('reviveZoneLobby' in body) await setOrClear('revive_zone_lobby', String(parseInt(body.reviveZoneLobby, 10) || '') || null);
    if ('reviveZoneGame' in body) await setOrClear('revive_zone_game', String(parseInt(body.reviveZoneGame, 10) || '') || null);
    _reviveCfg.at = 0; // bust the poll-path cache so changes apply within a poll
    return send(res, 200, { ok: true });
  }

  // Results for ONE past round — powers the Rounds tab's click-to-expand.
  // Host-only; ratified rounds only (live vote direction stays sealed).
  if (p === '/api/admin/round/results' && method === 'GET') {
    const roundId = url.searchParams.get('roundId') || url.searchParams.get('r');
    if (!roundId) return bad(res, 'roundId required');
    const round = await db.get('SELECT * FROM rounds WHERE id = ?', [roundId]);
    if (!round) return bad(res, 'Round not found', 404);
    const session = await canAdminSession(req, round.session_id);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (round.status !== 'ratified') return bad(res, 'Round isn\u2019t ratified yet');
    const isBinary = session.poll_type === 'binary';
    const rows = isBinary
      ? await db.all(
          `SELECT v.rank, v.pick, v.predict_split, v.err, v.points, v.tier, p.name FROM votes v
           JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.rank ASC`, [round.id])
      : await db.all(
          `SELECT v.rank, v.taste, v.predict, v.err, v.points, v.tier, p.name FROM votes v
           JOIN participants p ON p.id = v.participant_id WHERE v.round_id = ? ORDER BY v.rank ASC`, [round.id]);
    return send(res, 200, {
      poll_type: isBinary ? 'binary' : 'rating',
      round: { id: round.id, idx: round.idx, song_title: round.song_title, song_artist: round.song_artist,
        option_b_title: round.option_b_title || null,
        room_average: round.room_average != null ? Number(round.room_average) : null,
        split_a: round.split_a != null ? Number(round.split_a) : null },
      rows,
    });
  }

  if (p === '/api/admin/state' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const viewer = await userFromAuth(req); // null for legacy per-session token → treated as non-admin (redacted)
    return send(res, 200, await adminState(session, { viewer }));
  }

  // ----- pull the currently-playing song from a nero.fan live page -----
  // If the session's submission link points at a nero.fan live room, read the
  // now-playing submission from nero's public API and hand it back so the host
  // can one-tap queue it. Their submissionName -> our title, submitterName -> artist.
  if (p === '/api/admin/nero-pull' && method === 'POST') {
    const { sessionId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const su = session.submit_url || '';
    const m = /nero\.fan\/([^/?#]+)\/live\b/i.exec(su);
    if (!m) return bad(res, 'This room has no nero.fan live link', 400);
    const username = m[1];
    try {
      const resolved = await neroFetch(`https://api.nero.fan/sessions/overlay/resolve/${encodeURIComponent(username)}`);
      const neroSid = resolved && resolved.sessionId;
      if (!neroSid) return bad(res, 'Could not find that nero.fan room', 404);
      const state = await neroFetch(`https://api.nero.fan/sessions/state/${encodeURIComponent(neroSid)}`);
      const cur = state && state.current;
      if (!cur || !cur.submissionName) return send(res, 200, { playing: false });
      return send(res, 200, {
        playing: true,
        title: cur.submissionName || '',
        artist: cur.submitterName || '',
        instagram: (cur.submitterSocials && cur.submitterSocials.instagram) || null,
        note: cur.note || null,
      });
    } catch (e) {
      return bad(res, 'Could not reach nero.fan — try again', 502);
    }
  }

  if (p === '/api/admin/round' && method === 'POST') {
    const { sessionId, song_title, song_artist, song_note, giveaway, option_b_title, option_b_artist } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (!song_title || !song_title.trim()) return bad(res, (session.poll_type === 'binary' ? 'Song A title required' : 'Song title required'));
    // Binary sessions need both sides; Song A reuses song_title/song_artist.
    const isBinary = session.poll_type === 'binary';
    if (isBinary && (!option_b_title || !option_b_title.trim())) return bad(res, 'Song B title required');
    // Queued songs don't get a round number (idx) until they're actually opened —
    // they're played in queue order, which may differ from the order added.
    const maxPos = (await db.get("SELECT COALESCE(MAX(queue_pos),0) AS m FROM rounds WHERE session_id = ? AND status = 'pending'", [sessionId])).m;
    const rid = id(9);
    await db.run(
      `INSERT INTO rounds (id, session_id, idx, queue_pos, song_title, song_artist, song_note, giveaway, option_b_title, option_b_artist, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
      [rid, sessionId, 0, Number(maxPos) + 1, song_title.trim(), (song_artist || '').trim(), (song_note || '').trim(), (giveaway || '').trim(),
       isBinary ? (option_b_title || '').trim() : null, isBinary ? (option_b_artist || '').trim() : null, now()]
    );
    // Straight to open unless a round is already in play (voting or awaiting tally) — then it
    // waits in the queue. Removes the mandatory add-then-open two-step for the common case.
    const inPlay = await db.get("SELECT id FROM rounds WHERE session_id = ? AND status IN ('voting','closed')", [sessionId]);
    if (!inPlay) {
      const started = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('voting','closed','ratified')", [sessionId])).c;
      const dur = clampMinutes(session.default_minutes != null ? session.default_minutes : DEFAULT_MINUTES) * 60 * 1000;
      await db.run("UPDATE rounds SET status = 'voting', idx = ?, opens_at = ?, closes_at = ? WHERE id = ?",
        [Number(started) + 1, now(), now() + dur, rid]);
      if (session.status === 'upcoming') await db.run("UPDATE sessions SET status = 'live' WHERE id = ?", [sessionId]);
      await realtime.publish(sessionId, 'round');
      return send(res, 200, { roundId: rid, opened: true });
    }
    return send(res, 200, { roundId: rid, opened: false });
  }

  // Reorder a queued song up/down, or delete it from the queue.
  if (p === '/api/admin/round/move' && method === 'POST') {
    const { sessionId, roundId, dir } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
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
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.run("DELETE FROM rounds WHERE id = ? AND session_id = ? AND status = 'pending'", [roundId, sessionId]);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/open' && method === 'POST') {
    const { sessionId, roundId, minutes } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
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
    // Opening a round on an 'upcoming' (pre-registration) session takes it live.
    if (session.status === 'upcoming') {
      await db.run("UPDATE sessions SET status = 'live' WHERE id = ?", [sessionId]);
    }
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/extend' && method === 'POST') {
    const { sessionId, roundId, minutes, seconds } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    const add = (minutes != null ? Number(minutes) * 60 : (Number(seconds) || 30)) * 1000;
    const base = Math.max(Number(round.closes_at) || now(), now());
    await db.run("UPDATE rounds SET status = 'voting', closes_at = ? WHERE id = ?", [base + add, roundId]);
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/close' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.run("UPDATE rounds SET status = 'closed', closes_at = ? WHERE id = ? AND session_id = ?",
      [now(), roundId, sessionId]);
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
  }

  // Reopen an accidentally-closed round (closed -> voting again). Only works before
  // it's been tallied/ratified. Gives it a fresh voting window.
  if (p === '/api/admin/round/reopen' && method === 'POST') {
    const { sessionId, roundId, minutes } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status !== 'closed') return bad(res, 'Only a closed (not yet tallied) round can be reopened');
    const inPlay = await db.get("SELECT id FROM rounds WHERE session_id = ? AND status = 'voting' AND id != ?", [sessionId, roundId]);
    if (inPlay) return bad(res, 'Another round is currently open');
    const dur = clampMinutes(minutes != null ? minutes : DEFAULT_MINUTES) * 60 * 1000;
    await db.run("UPDATE rounds SET status = 'voting', closes_at = ? WHERE id = ?", [now() + dur, roundId]);
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
  }

  // Edit a song's details. Allowed while pending (queued), voting, or closed —
  // anything not yet ratified. Players see the update on their next poll.
  if (p === '/api/admin/round/edit' && method === 'POST') {
    const { sessionId, roundId, song_title, song_artist, song_note, giveaway, option_b_title, option_b_artist } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status === 'ratified') return bad(res, 'Round already tallied — can\'t edit it now');
    if (song_title !== undefined && !String(song_title).trim()) return bad(res, 'Song title can\'t be empty');
    const isBinary = session.poll_type === 'binary';
    if (isBinary && option_b_title !== undefined && !String(option_b_title).trim()) return bad(res, 'Song B title can\'t be empty');
    await db.run(
      `UPDATE rounds SET song_title = COALESCE(NULLIF(?,''), song_title),
         song_artist = ?, song_note = ?, giveaway = ?,
         option_b_title = CASE WHEN ? = 1 THEN COALESCE(NULLIF(?,''), option_b_title) ELSE option_b_title END,
         option_b_artist = CASE WHEN ? = 1 THEN ? ELSE option_b_artist END
       WHERE id = ?`,
      [(song_title || '').trim(), (song_artist || '').trim(), (song_note || '').trim(), (giveaway || '').trim(),
       isBinary ? 1 : 0, (option_b_title || '').trim(),
       isBinary ? 1 : 0, (option_b_artist || '').trim(),
       roundId]
    );
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/ratify' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status === 'voting') {
      await db.run("UPDATE rounds SET status = 'closed' WHERE id = ?", [roundId]);
    }
    const out = await ratifyRound(round);
    // Referral bonuses fire BEFORE the board compute so the pushed board includes them.
    try { await creditReferralMilestones(round, session); }
    catch (e) { console.error('[referral] milestone credit failed:', e.message); }
    // Compute the public series board ONCE here and push it as payload, so every connected
    // homepage applies it directly instead of each re-fetching + recomputing (O(1) at scale).
    let lbData = null;
    if (session.series_id) {
      try { lbData = { series: { id: session.series_id, leaderboard: await homeSeriesBoard(session.series_id) } }; }
      catch (e) { console.error('[realtime] series board compute failed:', e.message); }
    }
    await realtime.publish(sessionId, 'leaderboard', lbData);
    return send(res, 200, { ok: true, poll_type: out.poll_type, room_average: out.room_average ?? null, split_a: out.split_a ?? null, players: out.ranked.length });
  }

  if (p === '/api/admin/session/end' && method === 'POST') {
    const { sessionId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.run("UPDATE sessions SET status = 'completed' WHERE id = ?", [sessionId]);
    await realtime.publish(sessionId, 'status');
    return send(res, 200, { ok: true });
  }

  // Set session lifecycle status: upcoming | live | completed | archived.
  // Used for go-live, complete, archive, and reopen (completed/archived -> live).
  if (p === '/api/admin/session/status' && method === 'POST') {
    const { sessionId, status, notify } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const valid = ['upcoming', 'live', 'completed', 'archived'];
    if (!valid.includes(status)) return bad(res, 'Invalid status');
    const wasLive = session.status === 'live';
    await db.run('UPDATE sessions SET status = ? WHERE id = ?', [status, sessionId]);
    // On go-live, the host chooses which channels notify registrants (notify:{email,sms,push})
    // from the confirm dialog. No notify object => notify nothing. Idempotent per
    // (session, participant, channel) so a reopen never re-notifies. Non-fatal — a send
    // hiccup must never fail the go-live itself.
    if (status === 'live' && !wasLive && notify) {
      // SMS requires the sms permission (hosts are email-only unless granted); email is always allowed.
      const channels = { email: !!notify.email, push: !!notify.push, sms: !!notify.sms && !blockedByPerm(await userFromAuth(req), 'sms') };
      try { await dispatchGoLiveNotifications(session, publicBaseFromReq(req), channels); }
      catch (e) { console.error(`[NOTIFY] go-live dispatch error: ${e.message}`); }
    }
    await realtime.publish(sessionId, 'status');
    return send(res, 200, { ok: true, status });
  }

  // Soft-delete a session (admin only). The row + all its data are retained; it's just
  // hidden from listings. Restorable by clearing deleted_at. Player links to a deleted
  // session stop working (treated as closed).
  if (p === '/api/admin/session/delete' && method === 'POST') {
    const { sessionId, restore } = await readBody(req);
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const session = await db.get('SELECT id FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return bad(res, 'Room not found', 404);
    if (restore) {
      await db.run('UPDATE sessions SET deleted_at = NULL WHERE id = ?', [sessionId]);
      return send(res, 200, { ok: true, restored: true });
    }
    // Soft-delete. Also clear a 'live' status: a deleted session must never
    // remain live (a deleted+live row is the contradictory state that caused the
    // stuck-live confusion during the outage cleanup). Completed/upcoming are left
    // as-is so a restore returns the session to a sensible status.
    await db.run(
      "UPDATE sessions SET deleted_at = ?, status = CASE WHEN status = 'live' THEN 'completed' ELSE status END WHERE id = ?",
      [now(), sessionId]
    );
    return send(res, 200, { ok: true, deleted: true });
  }

  // Full session detail for the admin Create/Edit form (prefill) + the delete
  // dependents check. "Dependents" = participant-generated data (audit §G): any
  // votes OR any verified participants OR any ratified rounds. Empty rounds with no
  // votes do NOT count — a session clicked together but never played is disposable.
  if (p === '/api/admin/session/get' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const sessionId = url.searchParams.get('id') || url.searchParams.get('sessionId');
    const s = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!s) return bad(res, 'Room not found', 404);
    const votes = await db.get('SELECT COUNT(*) AS n FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE session_id = ?)', [sessionId]);
    const parts = await db.get('SELECT COUNT(*) AS n FROM participants WHERE session_id = ? AND verified = 1', [sessionId]);
    const rrounds = await db.get("SELECT COUNT(*) AS n FROM rounds WHERE session_id = ? AND status = 'ratified'", [sessionId]);
    const v = Number(votes.n) || 0, pc = Number(parts.n) || 0, rr = Number(rrounds.n) || 0;
    return send(res, 200, {
      session: {
        id: s.id, name: s.name, status: s.status, pollType: s.poll_type,
        defaultMinutes: s.default_minutes, scheduledAt: s.scheduled_at, seriesId: s.series_id || null,
        watchUrl: s.watch_url || null, submitUrl: s.submit_url || null, lobbyMessage: s.lobby_message || null,
        geoMode: s.geo_mode || 'off', geoLat: s.geo_lat, geoLng: s.geo_lng,
        geoRadius: s.geo_radius, geoLabel: s.geo_label || null,
      },
      dependents: { votes: v, participants: pc, ratifiedRounds: rr, hasDependents: (v > 0 || pc > 0 || rr > 0) },
    });
  }

  // Hard cascade-delete (admin). PERMANENT — removes the session and its entire
  // dependent tree. The reversible everyday action is soft-delete (/delete); this is
  // the rare, intentional destroy, gated by exact-name confirmation (audit §G).
  // Transactional: all-or-nothing, so a mid-cascade failure can't manufacture the
  // orphan rows the whole model exists to prevent.
  if (p === '/api/admin/session/purge' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const { sessionId, confirmName } = await readBody(req);
    const s = await db.get('SELECT id, name FROM sessions WHERE id = ?', [sessionId]);
    if (!s) return bad(res, 'Room not found', 404);
    if ((confirmName || '') !== s.name) return bad(res, 'Name does not match — type the exact room name to confirm');
    // Delete in FK order: votes -> rounds -> participants -> session banners -> otps -> session.
    // Feedback merely references the session (it's general product feedback that happened to
    // be tagged); keep the content but NULL the reference so purge leaves no dangling pointer.
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE session_id = ?)', [sessionId]);
      await tx.run('DELETE FROM rounds WHERE session_id = ?', [sessionId]);
      await tx.run('DELETE FROM participants WHERE session_id = ?', [sessionId]);
      await tx.run('DELETE FROM banners WHERE session_id = ?', [sessionId]);
      await tx.run('DELETE FROM otps WHERE session_id = ?', [sessionId]);
      await tx.run('UPDATE feedback SET session_id = NULL WHERE session_id = ?', [sessionId]);
      await tx.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    });
    return send(res, 200, { ok: true, purged: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SERIES LAYER
  // A series is a DISPLAY container that groups tagged sessions into a monthly
  // competition. Membership is the explicit `sessions.series_id` tag — never the
  // dates/target (those are display only). Leaderboard points are LIVE-COMPUTED
  // by summing votes.points across a series' tagged sessions, so the board stays
  // correct through retroactive tagging, re-ratification, and vote corrections.
  // ─────────────────────────────────────────────────────────────────────────

  // Create a series (admin).
  if (p === '/api/admin/series/create' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const { title, description, targetSessions, qualifyCount, startDate, endDate, status } = await readBody(req);
    if (!title || !title.trim()) return bad(res, 'Series title required');
    const sid = id(9);
    const st = ['upcoming', 'active', 'closed'].includes(status) ? status : 'upcoming';
    const qc = qualifyCount != null ? Math.min(Math.max(parseInt(qualifyCount, 10) || 8, 1), 100) : 8;
    await db.run(
      'INSERT INTO series (id, title, description, status, target_sessions, qualify_count, start_date, end_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [sid, title.trim().slice(0, 120), (description || '').toString().trim().slice(0, 1000) || null, st,
       targetSessions != null ? Number(targetSessions) : null, qc,
       startDate != null ? Number(startDate) : null, endDate != null ? Number(endDate) : null, now()]
    );
    return send(res, 200, { ok: true, seriesId: sid });
  }

  // List all series with a tagged-session count (admin).
  if (p === '/api/admin/series/list' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const rows = await db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM sessions ss WHERE ss.series_id = s.id AND ss.deleted_at IS NULL) AS session_count
       FROM series s ORDER BY s.created_at DESC`, []);
    return send(res, 200, { series: rows });
  }

  // Edit a series' display metadata or status (admin). Only provided fields change.
  if (p === '/api/admin/series/edit' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const body = await readBody(req);
    const series = await db.get('SELECT id FROM series WHERE id = ?', [body.seriesId]);
    if (!series) return bad(res, 'Series not found', 404);
    const sets = [], vals = [];
    if ('title' in body)          { const t = (body.title || '').toString().trim(); if (!t) return bad(res, 'Series title can\'t be empty'); sets.push('title = ?'); vals.push(t.slice(0, 120)); }
    if ('description' in body)    { sets.push('description = ?'); vals.push((body.description || '').toString().trim().slice(0, 1000) || null); }
    if ('status' in body)         { const st = ['upcoming', 'active', 'closed'].includes(body.status) ? body.status : 'upcoming'; sets.push('status = ?'); vals.push(st); }
    if ('targetSessions' in body) { sets.push('target_sessions = ?'); vals.push(body.targetSessions != null ? Number(body.targetSessions) : null); }
    if ('qualifyCount' in body)   { sets.push('qualify_count = ?'); vals.push(Math.min(Math.max(parseInt(body.qualifyCount, 10) || 8, 1), 100)); }
    if ('startDate' in body)      { sets.push('start_date = ?'); vals.push(body.startDate != null ? Number(body.startDate) : null); }
    if ('endDate' in body)        { sets.push('end_date = ?'); vals.push(body.endDate != null ? Number(body.endDate) : null); }
    if (!sets.length) return bad(res, 'Nothing to update');
    vals.push(body.seriesId);
    await db.run(`UPDATE series SET ${sets.join(', ')} WHERE id = ?`, vals);
    return send(res, 200, { ok: true });
  }

  // Tag (or untag) a session into a series (admin). seriesId null/'' clears the tag.
  if (p === '/api/admin/series/tag' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const { sessionId, seriesId } = await readBody(req);
    const session = await db.get('SELECT id FROM sessions WHERE id = ?', [sessionId]);
    if (!session) return bad(res, 'Room not found', 404);
    if (seriesId) {
      const series = await db.get('SELECT id FROM series WHERE id = ?', [seriesId]);
      if (!series) return bad(res, 'Series not found', 404);
    }
    await db.run('UPDATE sessions SET series_id = ? WHERE id = ?', [seriesId || null, sessionId]);
    return send(res, 200, { ok: true, sessionId, seriesId: seriesId || null });
  }

  // Series leaderboard — LIVE-COMPUTED (admin/internal view; full identity).
  // Sums votes.points across the series' tagged (non-deleted) sessions, grouped by
  // the durable user behind each participant. `limit` query param caps the cut.
  if (p === '/api/admin/series/leaderboard' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const seriesId = url.searchParams.get('seriesId') || url.searchParams.get('id');
    if (!seriesId) return bad(res, 'seriesId required');
    const seriesRow = await db.get('SELECT qualify_count FROM series WHERE id = ?', [seriesId]);
    const qualifyCount = seriesRow ? (seriesRow.qualify_count || 8) : 8;
    // Default to a generous view (50) so the admin sees beyond the cut; the cut
    // line is drawn at qualifyCount. An explicit ?limit= overrides.
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const rows = await db.all(
      `SELECT u.uid AS user_id, u.name, u.email, u.profile_complete, u.primary_category, u.location, SUM(t.pts) AS series_points
       FROM (${SERIES_POINTS_SRC}) t
       JOIN users u ON t.puid = u.uid
       WHERE u.blocked = 0
       GROUP BY u.uid, u.name, u.email, u.profile_complete, u.primary_category, u.location
       ORDER BY series_points DESC, u.name ASC
       LIMIT ?`, [seriesId, seriesId, limit]);
    // Admin sees everyone (incl. incomplete), but the A&R Wars cut only counts qualified
    // (complete) profiles — an incomplete top scorer doesn't take a qualifying slot.
    let q = 0;
    const leaderboard = rows.map((r, i) => {
      const complete = !!r.profile_complete;
      const qualifies = complete && q < qualifyCount;
      if (qualifies) q++;
      return { rank: i + 1, userId: r.user_id, name: r.name, email: r.email, points: Number(r.series_points) || 0,
        profileComplete: complete, category: r.primary_category || null, location: r.location || null, qualifies };
    });
    return send(res, 200, { seriesId, qualifyCount, leaderboard });
  }

  // Public series leaderboard (no auth) — PII-safe: display name + points + rank only.
  // Feeds the public homepage standings. Never emits email/phone.
  if (p === '/api/series/leaderboard' && method === 'GET') {
    const seriesId = url.searchParams.get('seriesId') || url.searchParams.get('id');
    if (!seriesId) return bad(res, 'seriesId required');
    const series = await db.get('SELECT id, title, status FROM series WHERE id = ?', [seriesId]);
    if (!series) return bad(res, 'Series not found', 404);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 50);
    // Qualified-only: only complete profiles appear publicly (3.5c gate). Category +
    // location are public by design (they're what makes a leaderboard row "real").
    const rows = await db.all(
      `SELECT u.uid, u.name, u.primary_category, u.location, u.photo_url, SUM(t.pts) AS series_points
       FROM (${SERIES_POINTS_SRC}) t
       JOIN users u ON t.puid = u.uid
       WHERE u.profile_complete = 1 AND u.blocked = 0
       GROUP BY u.uid, u.name, u.primary_category, u.location, u.photo_url
       ORDER BY series_points DESC, u.name ASC
       LIMIT ?`, [seriesId, seriesId, limit]);
    return send(res, 200, {
      series: { id: series.id, title: series.title, status: series.status },
      leaderboard: rows.map((r, i) => ({ rank: i + 1, id: r.uid, name: dispName(r.name), category: r.primary_category || null, location: r.location || null, photoUrl: r.photo_url || null, points: Number(r.series_points) || 0 })),
    });
  }

  // Public homepage data (no auth). Session-aware: the live session (if any), the next
  // upcoming session, the active series leaderboard, and past winners. PII-safe — first
  // name + points only, never email/phone. One call powers the whole front door.
  if (p === '/api/home' && method === 'GET') {
    const firstName = dispName; // full display name (no first-word splitting)
    // Live session (most recent if more than one is somehow live). Unlisted sessions
    // never surface here — they're reachable only by direct link/QR.
    const liveRow = await db.get("SELECT * FROM sessions WHERE status = 'live' AND deleted_at IS NULL AND (visibility IS NULL OR visibility != 'unlisted') ORDER BY created_at DESC LIMIT 1", []);
    let live = null;
    if (liveRow) {
      const arCount = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1', [liveRow.id])).c;
      const round = await activeRound(liveRow.id);
      let nowPlaying = null;
      if (round) nowPlaying = liveRow.poll_type === 'binary'
        ? (round.song_title + ' VS ' + (round.option_b_title || 'B'))
        : (round.song_title + (round.song_artist ? ' — ' + round.song_artist : ''));
      live = { id: liveRow.id, name: liveRow.name, pollType: liveRow.poll_type, watchUrl: liveRow.watch_url || null, submitUrl: liveRow.submit_url || null, arCount: Number(arCount) || 0, nowPlaying };
    }
    // Next upcoming session: earliest future start, else most recently created upcoming.
    const nextRow = await db.get("SELECT id, name, scheduled_at, watch_url, submit_url FROM sessions WHERE status = 'upcoming' AND deleted_at IS NULL AND (visibility IS NULL OR visibility != 'unlisted') ORDER BY (scheduled_at IS NULL), scheduled_at ASC, created_at DESC LIMIT 1", []);
    const next = nextRow ? { id: nextRow.id, name: nextRow.name, scheduledAt: nextRow.scheduled_at, watchUrl: nextRow.watch_url || null, submitUrl: nextRow.submit_url || null } : null;
    // Active series (else most recent) + its live-computed top 5.
    const serRow = (await db.get("SELECT id, title, status FROM series WHERE status = 'active' ORDER BY created_at DESC LIMIT 1", []))
      || (await db.get("SELECT id, title, status FROM series ORDER BY created_at DESC LIMIT 1", []));
    let series = null;
    if (serRow) {
      series = { id: serRow.id, title: serRow.title, status: serRow.status,
        leaderboard: await homeSeriesBoard(serRow.id) };
    }
    // Past winners — no winner model yet; empty until an A&R Wars close records them.
    // Recent A&Rs (activity ticker) — complete profiles only (they carry the photo/role/
    // location the ticker shows, and it doubles as a "complete to appear" pull). Public-
    // safe: display name + city + role + photo; never email/phone.
    const arRows = await db.all(
      'SELECT uid, name, primary_category, location, photo_url FROM users WHERE profile_complete = 1 AND blocked = 0 ORDER BY first_seen DESC LIMIT 12', []);
    const recentARs = arRows.map(u => ({ id: u.uid, name: u.name, category: u.primary_category || null, location: u.location || null, photoUrl: u.photo_url || null }));
    // House submission link for the homepage's submit section when no room link applies
    // (single source of truth: the platform setting, falling back to the built-in).
    const houseSubmitUrl = (await db.get("SELECT v FROM settings WHERE k = 'house_submit_url'"))?.v || 'https://www.makinitmag.com/review';
    return send(res, 200, { live, next, series, winners: [], recentARs, houseSubmitUrl });
  }


  // Update event config after creation: watch link, lobby message, sign-up prompt.
  // Each field is optional; only fields present in the body are changed. Send an
  // empty string to clear a field.
  if (p === '/api/admin/session/config' && method === 'POST') {
    const body = await readBody(req);
    const session = await canAdminSession(req, body.sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const sets = [], vals = [];
    if ('name' in body)         { const nm = (body.name || '').toString().trim(); if (!nm) return bad(res, 'Room name can\'t be empty'); sets.push('name = ?'); vals.push(nm.slice(0, 120)); }
    if ('bannerId' in body)     { sets.push('banner_id = ?'); vals.push(body.bannerId || null); }
    if ('defaultMinutes' in body) { sets.push('default_minutes = ?'); vals.push(clampMinutes(body.defaultMinutes)); }
    if ('watchUrl' in body)      { sets.push('watch_url = ?');     vals.push(cleanUrl(body.watchUrl)); }
    if ('submitUrl' in body)     { sets.push('submit_url = ?');    vals.push(cleanUrl(body.submitUrl)); }
    if ('lobbyMessage' in body)  { sets.push('lobby_message = ?'); vals.push((body.lobbyMessage || '').toString().trim().slice(0, 500) || null); }
    // Geo: enforcement mode is independent of the venue pin (set venue early, enforce later).
    if ('geoMode' in body) {
      const m = ['off', 'optional', 'required'].includes(body.geoMode) ? body.geoMode : 'off';
      sets.push('geo_mode = ?'); vals.push(m);
    }
    if ('geoLat' in body && 'geoLng' in body) {
      const la = Number(body.geoLat), ln = Number(body.geoLng);
      if (Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) {
        sets.push('geo_lat = ?'); vals.push(la);
        sets.push('geo_lng = ?'); vals.push(ln);
      } else return bad(res, 'Invalid venue coordinates');
    }
    if ('geoRadius' in body) {
      const r = Math.round(Number(body.geoRadius));
      sets.push('geo_radius = ?'); vals.push(Number.isFinite(r) && r > 0 ? Math.min(5000, Math.max(25, r)) : DEFAULT_GEO_RADIUS);
    }
    if ('geoLabel' in body) { sets.push('geo_label = ?'); vals.push((body.geoLabel || '').toString().trim().slice(0, 200) || null); }
    // Invite-only controls: unlisted visibility + optional join access code.
    if ('visibility' in body) {
      const v = body.visibility === 'unlisted' ? 'unlisted' : 'public';
      sets.push('visibility = ?'); vals.push(v);
    }
    if ('accessCode' in body) {
      const c = (body.accessCode || '').toString().trim().toUpperCase().slice(0, 24);
      sets.push('access_code = ?'); vals.push(c || null);
    }
    if (!sets.length) return bad(res, 'Nothing to update');
    vals.push(body.sessionId);
    await db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, vals);
    return send(res, 200, { ok: true });
  }

  // Geocode an address -> lat/lng for the venue pin. Host-only. Uses OpenStreetMap
  // Nominatim (no API key). Network failures degrade gracefully — the host can always
  // enter coordinates manually or use device location instead.
  if (p === '/api/admin/session/geocode' && method === 'POST') {
    const { sessionId, address } = await readBody(req);
    // Either an admin of the given session, OR any logged-in host (for pre-creation lookup).
    let authed = false;
    if (sessionId) { authed = !!(await canAdminSession(req, sessionId)); }
    else { authed = !!(await userFromAuth(req)); }
    if (!authed) return bad(res, 'Auth failed', 401);
    const q = (address || '').toString().trim();
    if (!q) return bad(res, 'Enter an address');
    try {
      const u = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
      const r = await fetch(u, { headers: { 'User-Agent': 'TheA&RRoom/1.0 (event check-in)' } });
      if (!r.ok) return bad(res, 'Geocoding service unavailable — enter coordinates manually', 502);
      const arr = await r.json();
      if (!arr || !arr.length) return bad(res, 'No match for that address — try a more specific one', 404);
      const hit = arr[0];
      return send(res, 200, { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name });
    } catch (e) {
      return bad(res, 'Geocoding failed — enter coordinates manually', 502);
    }
  }

  // City autocomplete for the profile Location field (player-auth). Returns "City, ST"
  // suggestions via OpenStreetMap, so locations standardize (which sharpens the admin
  // Location filter). Degrades to [] on any error — the field still accepts free text.
  if (p === '/api/geo/cities' && method === 'GET') {
    if (!(await resolveUserId(req))) return bad(res, 'Not authenticated', 401);
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return send(res, 200, { cities: [] });
    try {
      const u = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&featuretype=city&q=' + encodeURIComponent(q);
      const r = await fetch(u, { headers: { 'User-Agent': 'TheA&RRoom/1.0 (profile city)' } });
      if (!r.ok) return send(res, 200, { cities: [] });
      const arr = await r.json();
      const seen = new Set(), cities = [];
      for (const hit of (arr || [])) {
        const a = hit.address || {};
        const city = a.city || a.town || a.village || a.hamlet || a.municipality;
        const region = a.state || a.region || a.country;
        if (!city || !region) continue;
        const label = `${city}, ${stateAbbr(region) || region}`;
        if (seen.has(label)) continue;
        seen.add(label); cities.push(label);
        if (cities.length >= 5) break;
      }
      return send(res, 200, { cities });
    } catch (e) { return send(res, 200, { cities: [] }); }
  }

  // Live broadcast: push a message to every player in the session, or clear it.
  // The message + timestamp ride along in player state; the client shows it once
  // per (broadcast_at) value, so re-sending the same text re-pops it.
  if (p === '/api/admin/session/broadcast' && method === 'POST') {
    const { sessionId, text, clear, overlay } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (blockedByPerm(await userFromAuth(req), 'broadcast')) return bad(res, 'Broadcast is not enabled for this account', 403);
    if (clear) {
      await db.run('UPDATE sessions SET broadcast_text = NULL, broadcast_at = NULL, broadcast_overlay = FALSE WHERE id = ?', [sessionId]);
      await realtime.publish(sessionId, 'broadcast');
      return send(res, 200, { ok: true, cleared: true });
    }
    const msg = (text || '').toString().trim().slice(0, 500);
    if (!msg) return bad(res, 'Broadcast message is empty');
    await db.run('UPDATE sessions SET broadcast_text = ?, broadcast_at = ?, broadcast_overlay = ? WHERE id = ?', [msg, now(), overlay ? 1 : 0, sessionId]);
    await realtime.publish(sessionId, 'broadcast');
    return send(res, 200, { ok: true, at: now() });
  }

  // ===== ADS / BANNERS =====
  // Upload a banner image (sent as a base64 data URI from the browser).
  // scope: 'global' | 'session'. Optional link_url (opens in new tab on tap).
  if (p === '/api/admin/banner/upload' && method === 'POST') {
    const body = await readBody(req);
    if (body.__tooBig) return bad(res, 'Image too large — keep banners under ~500KB', 413);
    const { sessionId, scope, image_data, link_url, label } = body;
    // Room context OR platform admin (control panel uploads are global by definition).
    const session = sessionId ? await canAdminSession(req, sessionId) : null;
    if (!session && !(await platformAdmin(req))) return bad(res, 'Admin auth failed', 401);
    if (blockedByPerm(await userFromAuth(req), 'ads')) return bad(res, 'Ads are not enabled for this account', 403);
    if (!image_data || !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(image_data)) {
      return bad(res, 'Provide a PNG, JPG, GIF, or WebP image');
    }
    if (image_data.length > 900000) return bad(res, 'Image too large — keep banners under ~500KB');
    if (link_url && !/^https?:\/\//i.test(link_url)) return bad(res, 'Link must start with http:// or https://');
    const bid = id(9);
    const ownerSession = (scope === 'global' || !sessionId) ? null : sessionId;
    await db.run(
      'INSERT INTO banners (id, session_id, label, image_data, link_url, created_at) VALUES (?,?,?,?,?,?)',
      [bid, ownerSession, (label || '').trim() || null, image_data, (link_url || '').trim() || null, now()]
    );
    return send(res, 200, { bannerId: bid });
  }

  // ---- Shareable report graphics (PNG, 1080×1440). Rendered on demand from live data. ----
  // score = personal (player token); songs/ars/promo = public promo (display name + IG + points,
  // no email/phone). Binary/Versus sessions are excluded from Top 8 Songs.
  if (p.startsWith('/api/card/') && method === 'GET') {
    const kind = p.slice('/api/card/'.length);
    const numbers = url.searchParams.get('numbers') === '1';
    const sid = url.searchParams.get('s');
    const seriesId = url.searchParams.get('series');
    const sendPng = (buf, cache) => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': cache }); return res.end(buf); };
    try {
      if (kind === 'promo') {
        return sendPng(await shareCards.renderPng('promo', {}), 'public, max-age=86400');
      }
      if (kind === 'songs') {
        const session = sid ? await db.get('SELECT id, name, poll_type FROM sessions WHERE id = ? AND deleted_at IS NULL', [sid]) : null;
        if (!session) return bad(res, 'Room not found', 404);
        if (session.poll_type === 'binary') return bad(res, 'Top Songs is not available for Versus sessions', 409);
        const list = await cardSongsData(sid);
        if (!list.length) return bad(res, 'No rated songs yet', 404);
        return sendPng(await shareCards.renderPng('songs', { list, session: session.name, showNumbers: numbers }), 'public, max-age=300');
      }
      if (kind === 'ars') {
        let data;
        if (seriesId) {
          const ser = await db.get('SELECT id, title FROM series WHERE id = ?', [seriesId]);
          if (!ser) return bad(res, 'Series not found', 404);
          data = { list: await cardArsData({ seriesId }), scope: ser.title, showNumbers: numbers };
        } else {
          const session = sid ? await db.get('SELECT id, name FROM sessions WHERE id = ? AND deleted_at IS NULL', [sid]) : null;
          if (!session) return bad(res, 'Room not found', 404);
          data = { list: await cardArsData({ sessionId: sid }), session: session.name, showNumbers: numbers };
        }
        if (!data.list.length) return bad(res, 'No ranked A&Rs yet', 404);
        return sendPng(await shareCards.renderPng('ars', data), 'public, max-age=300');
      }
      if (kind === 'score') {
        const participant = await participantFromReq(req);
        if (!participant) return bad(res, 'Not logged in', 401);
        return sendPng(await shareCards.renderPng('score', await cardScoreData(participant)), 'private, max-age=120');
      }
      // Song Report (paid artist tier) — HOST-ONLY: the host generates it and delivers
      // it to the paying artist; there's no in-app paywall. Per ratified rating round.
      // ?r=<roundId>&page=1|2|3 -> one PNG page. Page 3 (segments) needs 8+ votes so
      // small samples never decompose into near-individual scores.
      if (kind === 'song-report') {
        const roundId = url.searchParams.get('r');
        const page = Math.max(1, Math.min(3, parseInt(url.searchParams.get('page') || '1', 10) || 1));
        if (!roundId) return bad(res, 'r (roundId) required');
        const round = await db.get('SELECT * FROM rounds WHERE id = ?', [roundId]);
        if (!round) return bad(res, 'Round not found', 404);
        const session = await canAdminSession(req, round.session_id);
        if (!session) return bad(res, 'Host auth required', 401);
        if (session.poll_type === 'binary') return bad(res, 'Song Reports cover rating rounds (Versus reports come later)', 409);
        if (round.status !== 'ratified' || round.room_average == null) return bad(res, 'Ratify the round first — the report reads final scores');
        const d = await songReportData(round, session);
        if (!d) return bad(res, 'No votes to report', 404);
        if (page === 3 && d.votes < 8) return bad(res, 'The segments page needs at least 8 votes', 409);
        return sendPng(await shareCards.renderPng('report' + page, page === 1 ? d : { ...d, sub: d.sub23 }), 'private, no-store');
      }
      return bad(res, 'Unknown card', 404);
    } catch (e) {
      console.error('[card] render failed:', e.message);
      return bad(res, 'Card render failed', 500);
    }
  }

  // QR code as SVG (self-hosted; used by the vertical overlay's "Scan to Win $500" join code).
  if (p === '/api/qr' && method === 'GET') {
    const data = url.searchParams.get('d') || '';
    if (!data) return bad(res, 'missing d', 400);
    try {
      const QRCode = require('qrcode');
      const svg = await QRCode.toString(data.slice(0, 1024), { type: 'svg', margin: 1, color: { dark: '#0c0a15', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      return res.end(svg);
    } catch (e) { console.error('[qr] failed:', e.message); return bad(res, 'qr failed', 500); }
  }

  // ---- Post-session recap email carousel (admin/owner). Renders the shared cards once, then
  // emails each voter their Score Card + the Top 8s + Promo. Processed in chunks off the
  // request path (client loops /process); requires Vercel Blob to host the images. ----
  if (p === '/api/admin/session/recap/status' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    if (!(await canAdminSession(req, sessionId))) return bad(res, 'Not authorized', 403);
    const one = async (sql, args) => (await db.get(sql, args)).c;
    const eligibleSql = `SELECT COUNT(*) AS c FROM participants p WHERE p.session_id = ? AND p.verified = 1 AND p.email IS NOT NULL AND p.email <> '' AND EXISTS (SELECT 1 FROM votes v WHERE v.participant_id = p.id)`;
    const eligible = await one(eligibleSql, [sessionId]);
    const total = await one('SELECT COUNT(*) AS c FROM recap_emails WHERE session_id = ?', [sessionId]);
    const sent = await one("SELECT COUNT(*) AS c FROM recap_emails WHERE session_id = ? AND status = 'sent'", [sessionId]);
    const failed = await one("SELECT COUNT(*) AS c FROM recap_emails WHERE session_id = ? AND status = 'failed'", [sessionId]);
    return send(res, 200, { configured: !!process.env.BLOB_READ_WRITE_TOKEN, eligible, total, sent, failed, pending: total - sent - failed });
  }

  // Start (or refresh) a recap job: render + host the shared cards, enqueue eligible voters.
  if (p === '/api/admin/session/recap/start' && method === 'POST') {
    const { sessionId } = await readBody(req);
    if (!(await canAdminSession(req, sessionId))) return bad(res, 'Not authorized', 403);
    if (!process.env.BLOB_READ_WRITE_TOKEN) return bad(res, 'Image hosting not configured (set BLOB_READ_WRITE_TOKEN)', 409);
    const session = await db.get('SELECT id, name, poll_type FROM sessions WHERE id = ? AND deleted_at IS NULL', [sessionId]);
    if (!session) return bad(res, 'Room not found', 404);
    try {
      const arsUrl = await uploadPng(`recap/${sessionId}/ars.png`, await shareCards.renderPng('ars', { list: await cardArsData({ sessionId }), session: session.name }));
      let songsUrl = null;
      if (session.poll_type !== 'binary') {
        const songs = await cardSongsData(sessionId);
        if (songs.length) songsUrl = await uploadPng(`recap/${sessionId}/songs.png`, await shareCards.renderPng('songs', { list: songs, session: session.name }));
      }
      const promoUrl = await uploadPng(`recap/${sessionId}/promo.png`, await shareCards.renderPng('promo', {}));
      await db.run('INSERT INTO recap_jobs (session_id, ars_url, songs_url, promo_url, created_at) VALUES (?,?,?,?,?) ON CONFLICT (session_id) DO UPDATE SET ars_url = excluded.ars_url, songs_url = excluded.songs_url, promo_url = excluded.promo_url',
        [sessionId, arsUrl, songsUrl, promoUrl, now()]);
      const voters = await db.all(`SELECT p.id, p.email FROM participants p WHERE p.session_id = ? AND p.verified = 1 AND p.email IS NOT NULL AND p.email <> '' AND EXISTS (SELECT 1 FROM votes v WHERE v.participant_id = p.id)`, [sessionId]);
      for (const v of voters) {
        await db.run("INSERT INTO recap_emails (id, session_id, participant_id, email, status, created_at) VALUES (?,?,?,?, 'pending', ?) ON CONFLICT (session_id, participant_id) DO NOTHING", [id(12), sessionId, v.id, v.email, now()]);
      }
      const total = (await db.get('SELECT COUNT(*) AS c FROM recap_emails WHERE session_id = ?', [sessionId])).c;
      const pending = (await db.get("SELECT COUNT(*) AS c FROM recap_emails WHERE session_id = ? AND status = 'pending'", [sessionId])).c;
      return send(res, 200, { ok: true, total, pending });
    } catch (e) {
      console.error('[recap] start failed:', e.message);
      return bad(res, 'Recap setup failed: ' + e.message, 500);
    }
  }

  // Process a chunk of pending recap emails (render+host each score card, send). Idempotent.
  if (p === '/api/admin/session/recap/process' && method === 'POST') {
    const { sessionId, limit } = await readBody(req);
    if (!(await canAdminSession(req, sessionId))) return bad(res, 'Not authorized', 403);
    const job = await db.get('SELECT * FROM recap_jobs WHERE session_id = ?', [sessionId]);
    if (!job) return bad(res, 'No recap job — start it first', 400);
    const session = await db.get('SELECT name FROM sessions WHERE id = ?', [sessionId]);
    const n = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20);
    const batch = await db.all("SELECT * FROM recap_emails WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?", [sessionId, n]);
    let sent = 0, failed = 0;
    for (const row of batch) {
      try {
        const participant = await db.get('SELECT * FROM participants WHERE id = ?', [row.participant_id]);
        const d = await cardScoreData(participant);
        const scoreUrl = await uploadPng(`recap/${sessionId}/score-${row.participant_id}.png`, await shareCards.renderPng('score', d));
        const html = recapEmailHtml({ name: d.name, sessionName: session.name, rank: d.rank, total: d.total, cards: { score: scoreUrl, songs: job.songs_url, ars: job.ars_url, promo: job.promo_url } });
        const r = await sendEmail(row.email, `Your A&R Room recap — ${session.name}`, html, recapEmailText(d, session.name));
        if (r.ok) { await db.run("UPDATE recap_emails SET status = 'sent', score_url = ?, sent_at = ?, error = NULL WHERE id = ?", [scoreUrl, now(), row.id]); sent++; }
        else { await db.run("UPDATE recap_emails SET status = 'failed', error = ? WHERE id = ?", [(r.error || 'send failed').slice(0, 300), row.id]); failed++; }
      } catch (e) {
        await db.run("UPDATE recap_emails SET status = 'failed', error = ? WHERE id = ?", [(e.message || 'error').slice(0, 300), row.id]); failed++;
      }
    }
    const remaining = (await db.get("SELECT COUNT(*) AS c FROM recap_emails WHERE session_id = ? AND status = 'pending'", [sessionId])).c;
    return send(res, 200, { ok: true, sent, failed, remaining });
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
  // target: 'global' | 'session'.  bannerId null/empty clears it.
  // (The 'song' target was removed — per-round ads were over-engineering.)
  if (p === '/api/admin/banner/assign' && method === 'POST') {
    const { sessionId, target, bannerId } = await readBody(req);
    const session = sessionId ? await canAdminSession(req, sessionId) : null;
    if (!session && !(target === 'global' && await platformAdmin(req))) return bad(res, 'Admin auth failed', 401);
    if (blockedByPerm(await userFromAuth(req), 'ads')) return bad(res, 'Ads are not enabled for this account', 403);
    const val = bannerId || null;
    if (target === 'global') {
      if (val) await db.run("INSERT INTO settings (k,v) VALUES ('global_banner_id', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [val]);
      else await db.run("DELETE FROM settings WHERE k = 'global_banner_id'");
    } else if (target === 'session') {
      await db.run('UPDATE sessions SET banner_id = ? WHERE id = ?', [val, sessionId]);
    } else {
      return bad(res, 'Unknown target');
    }
    return send(res, 200, { ok: true });
  }

  // Delete a banner from the library (and clear any assignments pointing at it).
  if (p === '/api/admin/banner/delete' && method === 'POST') {
    const { sessionId, bannerId } = await readBody(req);
    const session = sessionId ? await canAdminSession(req, sessionId) : null;
    if (!session && !(await platformAdmin(req))) return bad(res, 'Admin auth failed', 401);
    if (blockedByPerm(await userFromAuth(req), 'ads')) return bad(res, 'Ads are not enabled for this account', 403);
    await db.tx(async (tx) => {
      await tx.run('UPDATE sessions SET banner_id = NULL WHERE banner_id = ?', [bannerId]);
      await tx.run('UPDATE rounds SET banner_id = NULL WHERE banner_id = ?', [bannerId]);
      await tx.run("DELETE FROM settings WHERE k = 'global_banner_id' AND v = ?", [bannerId]);
      await tx.run('DELETE FROM banners WHERE id = ?', [bannerId]);
    });
    return send(res, 200, { ok: true });
  }

  // ===== DATA EXPORT (host-only) =====
  // Pulls the full session dataset — participants, rounds, and every vote with
  // computed scores — for analysis or fan-list building.
  //   format = csv | json
  //   anon   = 1  -> replace names/emails with "Player N" (safe to share)
  if (p === '/api/admin/export' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const exporter = await userFromAuth(req);
    if (blockedByPerm(exporter, 'export')) return bad(res, 'Export is not enabled for this account', 403);
    const redact = !!(exporter && exporter.role === 'host'); // hosts export engagement, never contact PII
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const anon = url.searchParams.get('anon') === '1';
    const isBinary = session.poll_type === 'binary';

    const participants = await db.all(
      'SELECT id, user_id, name, email, phone, sms_marketing_consent, ref_code, referred_by, ref_credited, pool, checkin_distance, total_points, created_at FROM participants WHERE session_id = ? AND verified = 1 ORDER BY created_at ASC',
      [sessionId]
    );
    const rounds = await db.all(
      "SELECT id, idx, song_title, song_artist, option_b_title, option_b_artist, room_average, split_a, opens_at, closes_at, status FROM rounds WHERE session_id = ? AND status = 'ratified' ORDER BY idx ASC",
      [sessionId]
    );
    const votes = await db.all(
      `SELECT v.round_id, v.participant_id, v.taste, v.predict, v.pick, v.predict_split, v.err, v.points, v.tier, v.rank, v.locked_at
         FROM votes v JOIN rounds r ON r.id = v.round_id
        WHERE r.session_id = ? AND r.status = 'ratified'`,
      [sessionId]
    );

    // Stable anonymization: map each participant to "Player N" by join order.
    const labelById = {};
    participants.forEach((pt, i) => { labelById[pt.id] = `Player ${i + 1}`; });
    const roomAvgByRound = {}, splitAByRound = {};
    rounds.forEach(r => { roomAvgByRound[r.id] = r.room_average; splitAByRound[r.id] = r.split_a; });

    const cleanParticipants = participants.map((pt, i) => {
      const referredByLabel = pt.referred_by ? (labelById[pt.referred_by] || null) : null;
      const credited = (pt.ref_credited === 1 || pt.ref_credited === true) ? 1 : 0;
      if (anon) return { player: labelById[pt.id], total_points: pt.total_points, referred_by: referredByLabel, referral_credited: credited, pool: pt.pool || null };
      // Host export: engagement only — no email/phone/consent/answer.
      if (redact) return { player: labelById[pt.id], name: pt.name, referred_by: referredByLabel, referral_credited: credited, pool: pt.pool || null, total_points: pt.total_points, joined_at: Number(pt.created_at) };
      return { player: labelById[pt.id], name: pt.name, email: pt.email, phone: pt.phone || null, sms_marketing_consent: (pt.sms_marketing_consent === 1 || pt.sms_marketing_consent === true) ? 1 : 0, referred_by: referredByLabel, referral_credited: credited, pool: pt.pool || null, checkin_distance: pt.checkin_distance ?? null, user_id: pt.user_id, total_points: pt.total_points, joined_at: Number(pt.created_at) };
    });

    const cleanVotes = votes.map(v => {
      const base = {
        player: labelById[v.participant_id] || 'Player ?',
        round: (rounds.find(r => r.id === v.round_id) || {}).idx,
      };
      if (isBinary) {
        base.pick = v.pick;
        base.predict_split = v.predict_split;
        base.split_a = splitAByRound[v.round_id];
      } else {
        base.rating = v.taste;
        base.prediction = v.predict;
        base.room_average = roomAvgByRound[v.round_id];
      }
      base.error = v.err;
      base.points = v.points;
      base.tier = v.tier;
      base.rank = v.rank;
      base.locked_at = Number(v.locked_at);
      return base;
    });

    const cleanRounds = rounds.map(r => {
      if (anon) {
        return isBinary ? { round: r.idx, split_a: r.split_a } : { round: r.idx, room_average: r.room_average };
      }
      return isBinary
        ? { round: r.idx, song_a_title: r.song_title, song_a_artist: r.song_artist, song_b_title: r.option_b_title, song_b_artist: r.option_b_artist, split_a: r.split_a, opened_at: Number(r.opens_at), closed_at: Number(r.closes_at) }
        : { round: r.idx, song_title: r.song_title, song_artist: r.song_artist, room_average: r.room_average, opened_at: Number(r.opens_at), closed_at: Number(r.closes_at) };
    });

    if (format === 'csv') {
      // One row per vote — the richest single flat table for analysis.
      const headers = isBinary
        ? (anon
            ? ['player', 'round', 'pick', 'predict_split', 'split_a', 'error', 'points', 'tier', 'rank']
            : ['player', 'name', 'email', 'round', 'song_a', 'song_b', 'pick', 'predict_split', 'split_a', 'error', 'points', 'tier', 'rank', 'locked_at'])
        : (anon
            ? ['player', 'round', 'rating', 'prediction', 'room_average', 'error', 'points', 'tier', 'rank']
            : ['player', 'name', 'email', 'round', 'song_title', 'rating', 'prediction', 'room_average', 'error', 'points', 'tier', 'rank', 'locked_at']);
      const nameById = {}, emailById = {};
      participants.forEach(pt => { nameById[pt.id] = pt.name; emailById[pt.id] = pt.email; });
      const songAByRound = {}, songBByRound = {}, songByRound = {};
      rounds.forEach(r => { songAByRound[r.id] = r.song_title; songBByRound[r.id] = r.option_b_title; songByRound[r.id] = r.song_title; });
      const esc = (val) => {
        const s = val == null ? '' : String(val);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [headers.join(',')];
      for (const v of votes) {
        const pid = v.participant_id;
        const r = rounds.find(rr => rr.id === v.round_id) || {};
        let row;
        if (isBinary) {
          row = anon
            ? [labelById[pid], r.idx, v.pick, v.predict_split, splitAByRound[v.round_id], v.err, v.points, v.tier, v.rank]
            : [labelById[pid], nameById[pid], emailById[pid], r.idx, songAByRound[v.round_id], songBByRound[v.round_id], v.pick, v.predict_split, splitAByRound[v.round_id], v.err, v.points, v.tier, v.rank, Number(v.locked_at)];
        } else {
          row = anon
            ? [labelById[pid], r.idx, v.taste, v.predict, roomAvgByRound[v.round_id], v.err, v.points, v.tier, v.rank]
            : [labelById[pid], nameById[pid], emailById[pid], r.idx, songByRound[v.round_id], v.taste, v.predict, roomAvgByRound[v.round_id], v.err, v.points, v.tier, v.rank, Number(v.locked_at)];
        }
        lines.push(row.map(esc).join(','));
      }
      const fname = `anr-${sessionId}${anon ? '-anon' : ''}.csv`;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fname}"` });
      return res.end(lines.join('\n'));
    }

    // JSON (default)
    const payload = {
      session: { id: anon ? undefined : session.id, name: session.name, poll_type: isBinary ? 'binary' : 'rating', exported_at: now(), anonymized: anon },
      participants: cleanParticipants,
      rounds: cleanRounds,
      votes: cleanVotes,
    };
    const fname = `anr-${sessionId}${anon ? '-anon' : ''}.json`;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${fname}"` });
    return res.end(JSON.stringify(payload, null, 2));
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
    // Bare root = the public homepage; root WITH a session param (?s=) is the voting
    // page (preserves existing QR/share links of the form /?s=<id>). /play is explicit.
    if (url.pathname === '/') return serveStatic(res, url.searchParams.get('s') ? 'play.html' : 'home.html');
    if (url.pathname === '/play') return serveStatic(res, 'play.html');
    if (url.pathname.startsWith('/u/')) return serveStatic(res, 'profile.html'); // public A&R profile
    if (url.pathname === '/join' || url.pathname === '/profile') return serveStatic(res, 'join.html'); // team signup + self-serve profile edit
    if (url.pathname === '/admin') return serveStatic(res, 'admin.html');
    if (url.pathname === '/overlay') return serveStatic(res, 'overlay.html');
    // Stable submit link for QR codes: /submit?s=<session> 302s to wherever that
    // session's submission link points RIGHT NOW (Nero, review site, anything).
    // The QR encodes this route, so the host can change the destination mid-show
    // and every printed/on-screen code keeps working. no-store: never cache a 302
    // to a stale destination.
    if (url.pathname === '/submit') {
      const sid = url.searchParams.get('s');
      let dest = null;
      if (sid) {
        try { const row = await db.get('SELECT submit_url FROM sessions WHERE id = ? AND deleted_at IS NULL', [sid]); dest = row && row.submit_url; }
        catch (e) { /* fall through to the house default */ }
      }
      if (!dest) dest = (await db.get("SELECT v FROM settings WHERE k = 'house_submit_url'"))?.v || null;
      dest = dest || 'https://www.makinitmag.com/review'; // built-in last resort
      res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store' });
      return res.end();
    }
    // Google Analytics bootstrap, generated from GA_MEASUREMENT_ID (GA4, e.g. G-XXXX).
    // Pages include <script async src="/analytics.js">; with no id set it's a no-op, so
    // analytics is off in dev/preview and until the operator configures it in prod.
    if (url.pathname === '/analytics.js') {
      const gaId = (process.env.GA_MEASUREMENT_ID || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      if (!/^G-[A-Za-z0-9]+$/.test(gaId)) return res.end('/* analytics disabled (no GA_MEASUREMENT_ID) */');
      return res.end(
        `(function(){var s=document.createElement('script');s.async=1;` +
        `s.src='https://www.googletagmanager.com/gtag/js?id=${gaId}';document.head.appendChild(s);` +
        `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;` +
        `gtag('js',new Date());gtag('config','${gaId}');})();`
      );
    }
    // Direct asset paths: serve the file if it exists. If not, an unknown PAGE request
    // (no file extension, .html, or a browser navigation) redirects to the homepage;
    // a missing asset (.js/.css/.png/etc.) still gets a plain 404 so we never hand HTML
    // back for a script/image request. (API 404s are handled in handleApi as JSON.)
    const rel = url.pathname.replace(/^\//, '') || 'home.html';
    const full = path.join(PUBLIC, rel);
    if (full.startsWith(PUBLIC) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      return serveStatic(res, rel);
    }
    const ext = path.extname(url.pathname).toLowerCase();
    const wantsHtml = (req.headers.accept || '').includes('text/html');
    if (!ext || ext === '.html' || wantsHtml) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    return send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
});

// Ensure the schema exists. Idempotent (CREATE TABLE IF NOT EXISTS), so it's
// safe to call on every cold start in serverless. Memoized so repeated calls
// within a warm function are cheap.
//
// SELF-HEALING: a successful init is cached for the instance's lifetime, but a
// FAILED init clears the cache so the next request retries. Without this, a
// single transient DB hiccup during a cold start would leave _initPromise as a
// permanently-rejected promise, bricking that warm instance into returning
// errors for its entire lifetime even after the database recovered.
let _initPromise = null;
function ensureInit() {
  if (!_initPromise) {
    _initPromise = db.init().catch((err) => {
      _initPromise = null; // allow the next call to retry instead of caching the failure
      throw err;
    });
  }
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
