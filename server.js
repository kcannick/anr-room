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
const { roomAverage, rankVotes, roomSplitA, rankBinaryVotes, roundAccuracy, gradeForAccuracy } = require('./scoring');
const shareCards = require('./share-cards');
const { consensusRanking, scoreEntry, rankEntries, validatePicks } = require('./sidebet');

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

// Per-song artist contact (post-show report card + heads-up text). Both return null for
// anything unusable, so a blank/garbage field reads as "no contact" rather than queuing a
// send that can only fail. PRIVATE — never emitted by a public surface (PII rule).
function cleanArtistEmail(e) {
  const s = (e || '').toString().trim().toLowerCase();
  if (!s || s.length > 200) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}
function cleanArtistPhone(v) {
  const s = (v || '').toString().trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null; // E.164 bounds; sms.js normalizes
  return s.slice(0, 40);
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

// Optional round comments. Raised from 280 to 500 (operator's call, 2026-09-02): A&Rs
// reported a tweet's length was too short to say what they heard AND why, which is the
// half the artist can actually use. 500 is about two more sentences — still short enough
// to stay quotable on a report page, to read a hundred of them in one artist email, and
// to keep the host's reject-by-exception scan fast. No migration: the column is TEXT.
// Shipped to the client in the player state so no surface carries a second copy.
const COMMENT_MAX = 500;

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

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION CONTACT CENTER (028) — per-topic, per-channel subscriptions.
// ─────────────────────────────────────────────────────────────────────────────
// This catalog IS the schema for topics. A notify_prefs row exists only where an A&R
// made an explicit choice; everyone else resolves to the defaults below. Adding a topic
// or a channel is an edit to this object — no migration, no backfill (see 028's header).
//
// A channel key that is ABSENT means the channel is not offered for that topic:
// notifyAudience() returns null, so "no daily digest by SMS" is enforced server-side
// rather than by trusting the client not to ask for it.
//
// SMS defaults of 1 are only ever permissive UNDER users.sms_marketing_consent — an ON
// default never texts anyone who lacks master consent and a phone on file.
// NOTE on invite-only ("VIP") rooms: they are NOT a separate topic. A draft carried a
// `vip_rooms` topic, but it isn't exposed in the UI (operator's call — fewer decisions
// per A&R), and an unexposed topic that still gates sends is a trap: unchecking "a room
// goes live" would leave private-room alerts firing with no control to stop them. So
// room_live governs EVERY room, public or invite-only. The table is topic-agnostic, so
// splitting them later is one line here plus a UI row — no migration.
const NOTIFY_TOPICS = {
  room_live:     { label: 'A room goes live', channels: { email: 1, sms: 1 } },
  digest_daily:  { label: 'Daily update',     channels: { email: 0 } },
  digest_weekly: { label: 'Weekly update',    channels: { email: 0 } },
};
const NOTIFY_CHANNELS = ['email', 'sms'];

// Is (topic, channel) a real, offered pair? Everything that writes prefs goes through this
// so a client can never invent a topic or subscribe to a channel a topic doesn't offer.
function notifyTopicOffers(topic, channel) {
  const t = NOTIFY_TOPICS[topic];
  return !!(t && t.channels[channel] !== undefined);
}
function notifyDefault(topic, channel) {
  const t = NOTIFY_TOPICS[topic];
  if (!t || t.channels[channel] === undefined) return null;
  return t.channels[channel] ? 1 : 0;
}

// Audience resolution for (topic, channel). Returns { sql, params } — a FRAGMENT, not
// rows — so senders can drop it straight into an `INSERT ... SELECT` the way
// /api/admin/notify/start already does, keeping the whole fan-out set-based (the #1 rule:
// never a per-user loop). Returns null when the channel isn't offered for the topic.
//
// "Absent row = default" happens inside the one query: the LEFT JOIN yields NULL for
// every user who never chose, and COALESCE substitutes the catalog default in place.
//
// THREE DIALECT TRAPS, all deliberate:
//  1. The default is INLINED as a literal 0/1 while `topic` stays a ? param. Postgres can
//     raise "could not determine data type of parameter" for COALESCE(int_col, $n)
//     because node-postgres sends params untyped. The literal comes from NOTIFY_TOPICS
//     via notifyDefault() and is always exactly 0 or 1, so it can't carry injection.
//  2. NOT `p.enabled = 1 OR p.enabled IS NULL` — that reads equivalent and is wrong: it
//     produces default-ON behaviour even for topics whose default is OFF.
//  3. `= 1`, not `IS TRUE` — the column is INTEGER on both engines.
//
// The channel gates are byte-identical to /api/admin/notify/start (including the
// LENGTH(phone) >= 7 quirk, which counts formatting characters) so audience counts stay
// consistent with the existing admin readout. Do not "improve" them here in isolation.
function notifyAudience(topic, channel) {
  const def = notifyDefault(topic, channel);
  if (def === null) return null;
  const join = `FROM users u
      LEFT JOIN notify_prefs p
             ON p.uid = u.uid AND p.topic = ? AND p.channel = '${channel}'`;
  if (channel === 'email') {
    return {
      sql: `${join}
     WHERE COALESCE(u.blocked, 0) = 0
       AND COALESCE(u.email_opt_out, 0) = 0
       AND u.email IS NOT NULL AND u.email != ''
       AND COALESCE(p.enabled, ${def}) = 1`,
      params: [topic],
    };
  }
  if (channel === 'sms') {
    return {
      sql: `${join}
     WHERE COALESCE(u.blocked, 0) = 0
       AND u.sms_marketing_consent = 1
       AND u.phone IS NOT NULL AND LENGTH(u.phone) >= 7
       AND COALESCE(p.enabled, ${def}) = 1`,
      params: [topic],
    };
  }
  return null;
}
// How many A&Rs would receive (topic, channel) right now. Bounded aggregate, admin-only
// callers — never on the boot or poll path.
async function notifyAudienceCount(topic, channel) {
  const a = notifyAudience(topic, channel);
  if (!a) return null;
  const r = await db.get(`SELECT COUNT(*) AS c ${a.sql}`, a.params);
  return Number(r && r.c) || 0;
}

// Resolve one user's full preference set: the stored choice where they made one, the
// catalog default everywhere else. `smsEffective` lets the UI say "SMS is on but you
// haven't picked any topics" instead of silently doing nothing.
async function notifyPrefsFor(user) {
  const rows = await db.all('SELECT topic, channel, enabled FROM notify_prefs WHERE uid = ?', [user.uid]);
  const stored = new Map(rows.map(r => [`${r.topic}:${r.channel}`, Number(r.enabled) ? 1 : 0]));
  const topics = {};
  let anySms = false;
  for (const [topic, spec] of Object.entries(NOTIFY_TOPICS)) {
    const entry = { label: spec.label, channels: {} };
    for (const channel of NOTIFY_CHANNELS) {
      if (spec.channels[channel] === undefined) continue;
      const key = `${topic}:${channel}`;
      const on = stored.has(key) ? stored.get(key) : notifyDefault(topic, channel);
      entry.channels[channel] = !!on;
      if (channel === 'sms' && on) anySms = true;
    }
    topics[topic] = entry;
  }
  const smsConsent = user.sms_marketing_consent === 1 || user.sms_marketing_consent === true;
  const hasPhone = !!(user.phone && String(user.phone).replace(/\D/g, '').length >= 7);
  return {
    topics,
    emailOptOut: !!(user.email_opt_out === 1 || user.email_opt_out === true),
    smsConsent, hasPhone,
    // True only when a text could actually be delivered for at least one topic.
    smsEffective: smsConsent && hasPhone && anySms,
    smsPrefSet: user.sms_pref_set_at != null,
  };
}

// Write one preference. `source` is audit-only ('register' | 'prefs' | 'link').
async function setNotifyPref(uid, topic, channel, enabled, source) {
  if (!notifyTopicOffers(topic, channel)) return false;
  const val = enabled ? 1 : 0;
  await db.run(
    `INSERT INTO notify_prefs (uid, topic, channel, enabled, source, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT (uid, topic, channel)
       DO UPDATE SET enabled = excluded.enabled, source = excluded.source, updated_at = excluded.updated_at`,
    [uid, topic, channel, val, source || null, now()]);
  return true;
}

// The registration checkbox: "Notify me when this and future rooms go live." Writes the
// room_live topic on BOTH channels (SMS stays inert without master consent + a phone).
//
// It deliberately does NOT stamp users.sms_pref_set_at. That flag means "this A&R made an
// explicit SMS MASTER decision in the contact center", and the registration flow is
// exactly where the phone-presence consent basis lives — so it must not disable itself.
// Consequence, and it's the intended one: the contact center is the durable override,
// while this checkbox is a fresh topic choice re-expressed at each registration.
//
// Callers pass the RAW body value: `undefined` means the client never sent the field, and
// we must write NOTHING (an older client must never silently unsubscribe anybody).
async function applyRegisterNotifyChoice(uid, raw) {
  if (raw === undefined || raw === null || !uid) return;
  const on = raw === true || raw === 1 || raw === '1' || raw === 'true';
  await setNotifyPref(uid, 'room_live', 'email', on, 'register');
  await setNotifyPref(uid, 'room_live', 'sms', on, 'register');
}

// ---- notification manage/unsubscribe link token ----
// A signed, URL-safe token that opens the contact center with no login, so every message
// we send can carry a working manage/unsubscribe link (CAN-SPAM, and plain decency).
//
// SCOPE IS THE WHOLE POINT: this authorizes the notify-prefs endpoints and NOTHING else.
// verifyNotifyLink() is standalone and is deliberately NOT called from resolveUserId(),
// userFromAuth(), participantFromReq(), platformAdmin() or canAdminSession() — so a
// leaked link can't reach /api/me/profile, an admin surface, or anything else BY
// CONSTRUCTION rather than by a checklist someone has to remember. It never mints an
// auth_tokens row and never sets a cookie: there is no upgrade path to a real session.
const NOTIFY_LINK_TTL = 30 * 24 * 60 * 60; // seconds; mirrors AUTH_TTL
const notifyLinkSecret = () => process.env.NOTIFY_LINK_SECRET || '';

function mintNotifyLink(uid) {
  const secret = notifyLinkSecret();
  if (!secret || !uid) return null;   // unconfigured → callers fall back to a login link
  const exp = Math.floor(now() / 1000) + NOTIFY_LINK_TTL;
  const msg = `np1.${uid}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('base64url');
  return `${msg}.${sig}`;
}
// Full manage URL for a message footer, or the bare settings URL when links aren't
// configured (which still works — it just requires the normal email-code login).
function notifyManageUrl(base, uid) {
  const tok = mintNotifyLink(uid);
  return tok ? `${base}/profile#nt=${tok}` : `${base}/profile`;
}

// Verify, cheapest-and-most-decisive first. Returns { uid } or { error, status }.
// Signature mismatch and malformed both return `bad_link` — never distinguish them.
async function verifyNotifyLink(req, url) {
  const secret = notifyLinkSecret();
  // Fails CLOSED: no default secret, no derivation from another secret, no permissive
  // "accept anything when unset". Header auth still works, so the contact center stays
  // fully usable by a logged-in A&R; only the no-login deep link is dark.
  if (!secret) return { error: 'notify_links_unconfigured', status: 503 };
  const raw = (req.headers['x-notify-link'] || (url && url.searchParams.get('nt')) || '').toString();
  if (!raw) return { error: 'bad_link', status: 401 };
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== 'np1') return { error: 'bad_link', status: 401 };
  const [, uid, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(uid)) return { error: 'bad_link', status: 401 };
  if (!/^\d{1,12}$/.test(exp)) return { error: 'bad_link', status: 401 };
  if (Number(exp) * 1000 < now()) return { error: 'link_expired', status: 401 };
  const expected = crypto.createHmac('sha256', secret).update(`np1.${uid}.${exp}`).digest('base64url');
  // The length pre-check is MANDATORY — timingSafeEqual throws on unequal lengths.
  if (sig.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { error: 'bad_link', status: 401 };
  }
  const u = await db.get('SELECT * FROM users WHERE uid = ?', [uid]);
  if (!u) return { error: 'bad_link', status: 401 };
  if (u.blocked === 1 || u.blocked === true) return { error: 'account_suspended', status: 403 };
  return { uid: u.uid, user: u };
}

// Footers that make every message we send carry a working way out. `manage` comes from
// notifyManageUrl(), so it deep-links straight into the contact center when
// NOTIFY_LINK_SECRET is configured and degrades to a login-gated /profile when it isn't.
function notifyFooterHtml(manage) {
  return `<p style="color:#6f688f;font-size:12px;margin:22px 0 0;border-top:1px solid #2e2750;padding-top:12px">
    You're getting this as a registered A&amp;R of The A&amp;R Room.
    <a href="${manage}" style="color:#6d5fe0">Manage your notifications</a>.</p>`;
}
function notifyFooterText(manage) {
  return `Manage your notifications: ${manage}`;
}
// SMS footer. "Reply STOP" is the legally sufficient opt-out; the link is a convenience,
// and it can push a message into a second billed segment — drop it here if that ever
// matters more than the convenience.
function smsFooter(manage) {
  return `Reply STOP to opt out. Manage: ${manage}`;
}

// Mask helpers for the token-authed read: a link holder sees enough to recognise the
// account, never enough to harvest it (PII rule).
function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return '';
  return s[0] + '•••' + s.slice(at);
}
function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 4 ? '••• ' + d.slice(-4) : '';
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
// 'listening' (030) is a round that's OPEN but not yet taking votes — the record is on the
// overlay and in everyone's hands while it plays, and the clock only starts when the host
// opens voting. That's what makes the voting window uniform: nobody can rate three bars in,
// and everyone gets the same countdown. It sorts ahead of everything else because a
// listening round is the one the room is currently looking at.
async function activeRound(sessionId) {
  return db.get(
    `SELECT * FROM rounds WHERE session_id = ? AND status IN ('listening','voting','closed','ratified')
     ORDER BY CASE status WHEN 'listening' THEN 0 WHEN 'voting' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END,
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

// ---------- the staged round machine (one button drives the show) ----------
// Open Round -> Open Voting -> Ratify -> Open Round. ONE implementation, called by both the
// console's big button and the Stream Deck's /api/control/advance, so a physical key and the
// screen can never disagree about what the next press does.
//
// Ratify is DOUBLE-PRESSED. It's the only irreversible step in the loop (it computes points
// and flips every player to results), and a Stream Deck is a physical key that gets leaned
// on mid-song. First press arms, second within the window commits.
const ADVANCE_ARM_MS = 8000;

// What the next press will do, without doing it. Powers the button's label on both surfaces
// and the /api/control/state readout.
async function nextStage(sessionId, session = null) {
  // A&R Daily runs on the clock, not on a button. Every record of the day is already open,
  // and there is no "next" to advance to — so the console's Advance button and the Stream
  // Deck both get an explicit no-op rather than opening, re-numbering or ratifying a drop
  // round out from under a live window.
  const s = session || await db.get('SELECT mode FROM sessions WHERE id = ?', [sessionId]);
  if (isAsync(s)) return { action: 'none', round: null, label: 'A&R Daily — runs on the clock' };
  const r = await activeRound(sessionId);
  if (r && r.status === 'listening') return { action: 'vote', round: r, label: 'Open Voting' };
  if (r && (r.status === 'voting' || r.status === 'closed')) return { action: 'ratify', round: r, label: 'Ratify — tally the room' };
  const q = (await queuedRounds(sessionId))[0] || null;
  if (q) return { action: 'open', round: q, label: 'Open Round' };
  return { action: 'none', round: null, label: 'Nothing queued' };
}

// Stage a review-site push as a real queued round in an auto-fill room.
//
// 031 filled the console's FORM, which the server never sees — so the Stream Deck's Advance
// had nothing to open ("Nothing queued"). Staging it here is what makes a pushed song
// openable from the deck without touching the console. It is STAGED, not opened: a pending
// round is host-only, takes no votes, and reaches the room only via an explicit Advance.
//
// Returns the round id, or null when the push isn't stageable (no title, or the room is
// running Versus rounds — a single review submission isn't an A/B matchup, so those rooms
// keep the form-fill only).
async function stageIngestRound(session, rec) {
  if (!rec || !rec.title) return null;
  // NEVER stage into a drop. This function's newest-push-wins DELETE targets pending rounds
  // by session, and the /api/ingest/submission fan-out selects every live ingest_auto room —
  // so without this guard one stray /review push could delete a record out of a running day.
  // Drop rounds also carry ingest_ref rather than ingest_at, which is the second, independent
  // half of that guard.
  if (isAsync(session)) return null;
  // Same poll-type resolution as /api/admin/round: the last round's type wins, then the
  // room default — so a room mid-Versus doesn't get a rating round injected behind it.
  const last = await db.get('SELECT poll_type FROM rounds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1', [session.id]);
  const pt = (last && last.poll_type) || (session.poll_type === 'binary' ? 'binary' : 'rating');
  if (pt === 'binary') return null;
  // Newest push wins (the operator's rule for the form, applied to the queue): replace the
  // previous auto-staged record if it's still waiting, rather than stacking up songs that
  // were pushed past and never played. Only ever touches PENDING auto-staged rows — a round
  // the host already opened, or one they typed themselves, is never in scope.
  await db.run("DELETE FROM rounds WHERE session_id = ? AND status = 'pending' AND ingest_at IS NOT NULL", [session.id]);
  const maxPos = (await db.get("SELECT COALESCE(MAX(queue_pos),0) AS m FROM rounds WHERE session_id = ? AND status = 'pending'", [session.id])).m;
  const rid = id(9);
  await db.run(
    `INSERT INTO rounds (id, session_id, idx, queue_pos, poll_type, song_title, song_artist, song_note, giveaway,
       artist_email, artist_phone, artist_note, play_url, artist_instagram, artist_profile_url,
       ingest_ref, ingest_url, scout_drupal_uid, status, ingest_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
    [rid, session.id, 0, Number(maxPos) + 1, 'rating', rec.title, rec.artist || '',
     rec.instagram ? ('IG: @' + rec.instagram) : '', '',
     cleanArtistEmail(rec.email), cleanArtistPhone(rec.phone),
     rec.note || null, cleanPlayUrl(rec.playUrl), rec.instagram || null, rec.profileUrl || null,
     rec.ref || null, cleanUrl(rec.url), rec.scoutUid || null,
     Number(rec.at) || now(), now()]
  );
  return rid;
}

function clearAdvanceArm(sessionId) {
  return db.run('UPDATE sessions SET advance_armed_at = NULL, advance_armed_round = NULL WHERE id = ?', [sessionId]);
}

// Ratify + every side effect that must ride with it. Extracted so the console route and the
// staged advance share one path — a second copy would drift, and the copy that forgot to
// credit referral milestones or push the board would be silently wrong.
async function ratifyAndPublish(round, session) {
  if (round.status === 'voting' || round.status === 'listening') {
    await db.run("UPDATE rounds SET status = 'closed' WHERE id = ?", [round.id]);
  }
  const out = await ratifyRound(round);
  // Referral bonuses fire BEFORE the board compute so the pushed board includes them.
  try { await creditReferralMilestones(round, session); }
  catch (e) { console.error('[referral] milestone credit failed:', e.message); }
  // Eye for talent: the A&R who found this record earns in proportion to how it scored.
  // Needs room_average, so it can only fire here — after the tally.
  try { await creditScoutPoints(await db.get('SELECT * FROM rounds WHERE id = ?', [round.id]), session); }
  catch (e) { console.error('[scout] credit failed:', e.message); }
  // Compute the public series board ONCE here and push it as payload, so every connected
  // homepage applies it directly instead of each re-fetching + recomputing (O(1) at scale).
  let lbData = null;
  if (session.series_id) {
    try { lbData = { series: { id: session.series_id, leaderboard: await homeSeriesBoard(session.series_id) } }; }
    catch (e) { console.error('[realtime] series board compute failed:', e.message); }
  }
  await realtime.publish(session.id, 'leaderboard', lbData);
  return { ok: true, poll_type: out.poll_type, room_average: out.room_average ?? null,
    split_a: out.split_a ?? null, players: out.ranked.length };
}

// Drive the room forward one stage. `minutes` only applies to the vote stage.
async function advanceRoom(session, { minutes = null } = {}) {
  const sessionId = session.id;
  // One cut here covers BOTH callers — the console's big button and /api/control/advance —
  // so a Stream Deck press can never drive a drop.
  if (isAsync(session)) return { ok: false, action: 'none', error: 'A&R Daily runs on the clock — there is nothing to advance' };
  const stage = await nextStage(sessionId, session);
  if (stage.action === 'none') return { ok: false, action: 'none', error: 'Nothing queued — add a record first' };
  const round = stage.round;

  if (stage.action === 'open') {
    // The round number is assigned when it actually STARTS, not when it was queued — so a
    // reordered or deleted queue never leaves a gap in the numbering the room sees.
    const started = (await db.get(
      "SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('listening','voting','closed','ratified')",
      [sessionId])).c;
    // closes_at stays NULL: a listening round has no clock, and that's exactly the point.
    await db.run("UPDATE rounds SET status = 'listening', idx = ?, opens_at = ?, closes_at = NULL WHERE id = ?",
      [Number(started) + 1, now(), round.id]);
    if (session.status === 'upcoming') {
      await db.run("UPDATE sessions SET status = 'live', scheduled_at = COALESCE(scheduled_at, ?) WHERE id = ?", [now(), sessionId]);
    }
    await clearAdvanceArm(sessionId);
    await realtime.publish(sessionId, 'round');
    return { ok: true, action: 'open', status: 'listening', roundId: round.id,
      idx: Number(started) + 1, title: round.song_title || '', next: 'vote' };
  }

  if (stage.action === 'vote') {
    const dur = clampMinutes(minutes != null ? minutes
      : (session.default_minutes != null ? session.default_minutes : DEFAULT_MINUTES)) * 60 * 1000;
    const closes = now() + dur;
    await db.run("UPDATE rounds SET status = 'voting', closes_at = ? WHERE id = ?", [closes, round.id]);
    await clearAdvanceArm(sessionId);
    await realtime.publish(sessionId, 'round');
    return { ok: true, action: 'vote', status: 'voting', roundId: round.id,
      idx: round.idx, title: round.song_title || '', closes_at: closes, next: 'ratify' };
  }

  // ---- ratify: arm on the first press, commit on the second ----
  // Re-read the arm from the DB rather than trusting the caller's `session` row, which may
  // predate the arming press by a whole request on a different serverless instance.
  const armRow = await db.get('SELECT advance_armed_at, advance_armed_round FROM sessions WHERE id = ?', [sessionId]);
  const armed = !!armRow && armRow.advance_armed_round === round.id
    && Number(armRow.advance_armed_at || 0) > now() - ADVANCE_ARM_MS;
  if (!armed) {
    await db.run('UPDATE sessions SET advance_armed_at = ?, advance_armed_round = ? WHERE id = ?',
      [now(), round.id, sessionId]);
    return { ok: true, action: 'ratify', confirmNeeded: true, armed: true, roundId: round.id,
      idx: round.idx, title: round.song_title || '', armMs: ADVANCE_ARM_MS, next: 'ratify' };
  }
  await clearAdvanceArm(sessionId);
  const out = await ratifyAndPublish(round, session);
  return { ...out, action: 'ratify', confirmNeeded: false, roundId: round.id, idx: round.idx, next: 'open' };
}

// End-of-session recap for one player: the big shareable reveal. Computed only
// when the session has ended. Poll type is PER-ROUND now, so a recap can span both
// mechanics — everything is reported on ONE unified Accuracy % axis (+ an absolute
// grade banded off it), with the A/B rounds also broken out into a separate card.
// `detail` adds a round-by-round breakdown for the daily scorecard and the A&R digest.
// It is OFF by default so the polled live payload stays byte-identical for its only
// existing caller, and it costs no extra query — every column is already in `mine`.
async function buildRecap(participant, { detail = false } = {}) {
  const sessionId = participant.session_id;
  // Each ratified round the player voted in, WITH its poll_type + the fields the
  // Versus card needs (their pick/split + the round's actual split).
  const mine = await db.all(
    `SELECT v.points, v.err, v.rank, v.tier, v.pick, v.predict_split, v.taste, v.predict,
            r.idx, r.poll_type, r.song_title, r.song_artist, r.option_b_title, r.option_b_artist,
            r.room_average, r.split_a
       FROM votes v JOIN rounds r ON r.id = v.round_id
      WHERE v.participant_id = ? AND r.status = 'ratified' ORDER BY r.idx ASC`,
    [participant.id]
  );
  const roundsPlayed = mine.length;
  const totalRounds = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status = 'ratified'", [sessionId])).c;

  // Accuracy %: each round's error becomes a distance on its OWN scale (9 rating /
  // 100 binary), so a mixed session averages cleanly onto one 0..100 axis. 2 dp.
  const scaleFor = pt => (pt === 'binary' ? 100 : 9);
  const accOf = rows => rows.length
    ? Math.round((rows.reduce((a, m) => a + roundAccuracy(m.err, scaleFor(m.poll_type)), 0) / rows.length) * 100) / 100
    : null;
  const ratingRows = mine.filter(m => m.poll_type !== 'binary');
  const binaryRows = mine.filter(m => m.poll_type === 'binary');
  const accuracy = accOf(mine);
  const grade = gradeForAccuracy(accuracy); // absolute, always present when they played

  let bullseyes = 0, best = null;
  if (roundsPlayed) {
    bullseyes = mine.filter(m => m.tier === 'bullseye').length;
    best = mine.reduce((b, m) => (b == null || m.points > b.points ? m : b), null);
  }

  // Points-based percentile / rank across the whole room (poll-type-agnostic).
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

  // Separate Versus card: the player's A/B rounds (self-contained, not comparable to
  // a 0–9 score). Empty on a pure-rating night — the client hides the card then.
  const versusRounds = binaryRows.map(m => ({
    idx: m.idx, song_a: m.song_title, song_b: m.option_b_title,
    my_pick: m.pick, my_split: m.predict_split,
    actual_split_a: m.split_a != null ? Number(m.split_a) : null, err: m.err,
  }));

  const out = {
    name: participant.name,
    accuracy,                                    // unified 0..100, 2dp (null if no rounds)
    grade,                                       // absolute letter (null if no rounds)
    accuracyByType: { rating: accOf(ratingRows), versus: accOf(binaryRows) },
    totalPoints: mineTotal,
    roundsPlayed, totalRounds,
    rank, fieldSize, percentile,
    bullseyes,
    best: best ? { idx: best.idx, song_title: best.song_title, points: best.points } : null,
    versusRounds,
  };
  // The round-by-round breakdown. THE SEAL IS SATISFIED HERE and nowhere earlier: every
  // row is a RATIFIED round, so room_average already exists and is already public. Nothing
  // in this block may ever be moved to a pre-ratify code path.
  //
  // votes.tier IS the emoji/colour key — tierForError() (scoring.js) emits exactly five
  // values, so the renderer maps five names and there is no second source of truth for
  // what counts as "sharp".
  if (detail) {
    out.rounds = ratingRows.map(m => ({
      idx: m.idx, song_title: m.song_title, song_artist: m.song_artist,
      taste: m.taste, predict: m.predict == null ? null : Number(m.predict),
      room_average: m.room_average == null ? null : Number(m.room_average),
      err: m.err == null ? null : Number(m.err),
      points: Number(m.points) || 0, tier: m.tier,
    }));
  }
  return out;
}

// How far through the day this A&R is. The denominator is LIVE (whatever the day currently
// holds) rather than a stored 16 — the day is variable in size, and deleting a zero-vote
// record must shrink it rather than make completion unreachable for everyone at n-1.
//
// A REPORTED RECORD COUNTS AS HANDLED. If it stayed in the numerator's way, reporting an
// unplayable track honestly would strand the reporter one short of their bonus — which
// teaches people to say nothing about dead links, the exact opposite of why the button
// exists. The obvious abuse (report everything, collect the bonus for nothing) is closed by
// the cap in /api/report-round, not here.
//
// Two indexed COUNTs plus one NOT EXISTS, all bounded by the day's size — constant work per
// call, nothing that scales with the row count.
async function asyncHandled(participant, session) {
  const total = Number((await db.get(
    "SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('voting','closed','ratified')",
    [session.id])).c) || 0;
  const v = await db.get(
    `SELECT COUNT(*) AS c, MAX(v.locked_at) AS last FROM votes v JOIN rounds r ON r.id = v.round_id
      WHERE v.participant_id = ? AND r.session_id = ?`, [participant.id, session.id]);
  // Two different counts, deliberately.
  //   reportsTotal  — every report this A&R filed today. This is what the CAP counts, because
  //                   a report is console noise whether or not it also earned them a skip.
  //   reported      — reports on records they did NOT rate. Only these advance the day, since
  //                   the two sets can overlap (nothing stops an A&R rating a track and then
  //                   reporting that the link later went dead) and that must not double-count.
  const rp = await db.get(
    `SELECT COUNT(*) AS c, MAX(rr.created_at) AS last FROM round_reports rr
       JOIN rounds r ON r.id = rr.round_id
      WHERE rr.participant_id = ? AND r.session_id = ?
        AND r.status IN ('voting','closed','ratified')`,
    [participant.id, session.id]);
  const rpFree = await db.get(
    `SELECT COUNT(*) AS c FROM round_reports rr
       JOIN rounds r ON r.id = rr.round_id
      WHERE rr.participant_id = ? AND r.session_id = ?
        AND r.status IN ('voting','closed','ratified')
        AND NOT EXISTS (SELECT 1 FROM votes v2 WHERE v2.round_id = rr.round_id AND v2.participant_id = rr.participant_id)`,
    [participant.id, session.id]);
  const voted = Number(v.c) || 0;
  const reported = Number(rpFree.c) || 0;
  return {
    total, voted, reported, reportsTotal: Number(rp.c) || 0, handled: voted + reported,
    // The instant they actually finished the day, which is the LATER of their last rating and
    // their last report. Used for the completion tier — see maybeAwardCompletionBonus.
    last: Math.max(Number(v.last) || 0, Number(rp.last) || 0) || null,
  };
}

async function asyncProgress(participant, session) {
  const h = await asyncHandled(participant, session);
  return { progress: { voted: h.voted, reported: h.reported, handled: h.handled, total: h.total,
    eligible: h.total >= ASYNC_MIN_FOR_BONUS, reportsLeft: reportsLeftFor(h) } };
}

// Per-A&R per-day ceiling on reports (operator's call, 2026-09-02). Three is a shade under
// a fifth of a full 16-record day, and comfortably above the real dead-link rate — enough
// that an honest reporter is never punished, small enough that reporting is not a route to
// the bonus. Console surfaces per-A&R report counts so a serial reporter is visible.
//
// The floor is what actually closes the loophole on a SHORT day: min(cap, total - 1) means
// there is no day size on which you can report your way to a completion bonus without
// rating at least one record.
const DROP_REPORT_CAP = 3;
function reportCapFor(total) { return Math.min(DROP_REPORT_CAP, Math.max(0, Number(total) - 1)); }
function reportsLeftFor(h) { return Math.max(0, reportCapFor(h.total) - h.reportsTotal); }

// Pay the completion bonus for finishing the day. Idempotent by construction.
//
// THE TIER COMES FROM WHEN THEY FINISHED, not from now(). Inline (at their final action) those
// are the same instant; in a sweep they are not, and a 9AM sweep must never pay 25 to someone
// who actually finished at 2PM. One rule, both callers.
//
// point_events has UNIQUE (reason, source_uid, milestone), so the session x user pair has to
// live in source_uid: a bare uid would pay once EVER, a bare session id would pay once per day
// across all users. milestone is a literal 1 and deliberately NOT the tier — two racing inserts
// that computed different tiers would differ in milestone, defeat the index, and pay twice.
async function maybeAwardCompletionBonus(participant, session, atTs = null) {
  if (!participant.user_id) return null;   // the bonus ledger is user-level
  const h = await asyncHandled(participant, session);
  if (h.total < ASYNC_MIN_FOR_BONUS) return null;
  if (h.handled < h.total) return null;
  const pts = completionBonusPoints(session, atTs != null ? atTs : (h.last || now()));
  const ins = await db.run(
    `INSERT INTO point_events (id, user_id, points, series_id, reason, source_uid, milestone, created_at)
     VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (reason, source_uid, milestone) DO NOTHING`,
    [id(9), participant.user_id, pts, session.series_id || null,
     'async_complete', `${session.id}:${participant.user_id}`, 1, now()]);
  if (ins.changes) await db.run('UPDATE users SET lifetime_points = lifetime_points + ? WHERE uid = ?', [pts, participant.user_id]);
  return ins.changes ? pts : null;
}

// ===== EYE FOR TALENT — scouting =====
// An A&R promotes makinitmag.com/review?a=<their Drupal uid>; Drupal records the referring
// A&R on the submission and returns it in the daily push. Drupal owns the non-points rewards
// (ambassador tiers, promo budget) natively off that uid and needs nothing from us.
//
// The POINTS half needs a mapping, since we credit users.uid. Bootstrapped lazily: the push
// carries the scout's Drupal uid AND email, and the first successful email match writes
// users.drupal_uid permanently. No handshake, no connect UI — the mapping accumulates as a
// side effect of normal use, and a mismatched email simply doesn't earn until it's linked.
async function linkScout(drupalUid, email) {
  if (!drupalUid) return null;
  const known = await db.get('SELECT uid FROM users WHERE drupal_uid = ?', [drupalUid]);
  if (known) return known.uid;
  if (!email) return null;
  const byEmail = await db.get('SELECT uid, drupal_uid FROM users WHERE email = ?', [email]);
  if (!byEmail || byEmail.drupal_uid) return byEmail ? byEmail.uid : null;
  // Unique partial index guards against two accounts claiming one Makin' It identity; a race
  // just means the loser stays unlinked until next time, which is harmless.
  try { await db.run('UPDATE users SET drupal_uid = ? WHERE uid = ?', [drupalUid, byEmail.uid]); } catch {}
  return byEmail.uid;
}

// Scouting points scale with how well the record actually SCORED — that is the "eye for
// talent" half measured directly. Not flat-on-play: submission is free, so a flat award would
// make referring 100 mediocre artists beat referring 5 great ones.
//
// Floor + linear scale, never negative. A bad referral earns zero rather than costing points,
// or nobody refers anyone.
//
// SIZING (operator decision — this constant is the dial). A month of daily play is roughly
// 15,000 points (a 6-record day, decent accuracy) to 45,000 (a full 16-record day, sharp), so:
//   at 250/point-above-floor, a 7.0 record earns 500 and five of them ≈ 2,500 ≈ 6-15% of a
//   month. Meaningful without letting scouting outrun accuracy on a cash-prize board.
// Raise it to make scouting a real second lane; lower it to keep it a garnish.
const SCOUT_FLOOR = 5.0;              // moves with the 0-9 -> 0-10 scale switch
const SCOUT_PER_POINT = 250;
function scoutPointsFor(roomAverage) {
  const a = Number(roomAverage);
  if (!Number.isFinite(a) || a <= SCOUT_FLOOR) return 0;
  return Math.round((a - SCOUT_FLOOR) * SCOUT_PER_POINT);
}

// Credit the A&R who found this record, once it has a room average. Fires at ratify next to
// the referral milestones, because room_average does not exist before then. Idempotent on the
// same UNIQUE (reason, source_uid, milestone) that makes referral milestones safe.
async function creditScoutPoints(round, session) {
  if (!round || !round.scout_drupal_uid || round.room_average == null) return null;
  if ((round.poll_type || 'rating') === 'binary') return null;
  const pts = scoutPointsFor(round.room_average);
  if (pts <= 0) return null;
  const u = await db.get('SELECT uid, blocked FROM users WHERE drupal_uid = ?', [round.scout_drupal_uid]);
  if (!u || u.blocked) return null;      // unlinked scouts earn nothing until the accounts match
  const ins = await db.run(
    `INSERT INTO point_events (id, user_id, points, series_id, reason, source_uid, milestone, created_at)
     VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (reason, source_uid, milestone) DO NOTHING`,
    [id(9), u.uid, pts, session.series_id || null, 'scout', round.id, 1, now()]);
  if (ins.changes) await db.run('UPDATE users SET lifetime_points = lifetime_points + ? WHERE uid = ?', [pts, u.uid]);
  return ins.changes ? pts : null;
}

// The unified board's counterweight. A month of A&R Daily is roughly 15,000-45,000 points;
// one live show is a dozen records, so WITHOUT this the weekly broadcast is decorative on the
// leaderboard it is supposed to headline. sessions.live_bonus pays an A&R who rated EVERY
// ratified record of that show — the same unit as the daily bonus ("you showed up and played
// the whole thing"), and unfarmable: you had to be in the room, on the clock.
//
// Deliberately NOT a points multiplier on votes.points. A multiplier would rewrite the column
// every board sum, share card, Song Report, chart and recap reads (making "max 125" untrue
// everywhere), would multiply NEGATIVE rounds into a penalty rather than a bonus, and could
// not be undone without the heavy per-row migration the #1 rule exists to prevent.
async function awardLiveCompletion(session) {
  if (!session || isAsync(session)) return 0;
  const bonus = Number(session.live_bonus) || 0;
  if (bonus <= 0) return 0;
  const total = Number((await db.get(
    "SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status = 'ratified'", [session.id])).c) || 0;
  if (!total) return 0;
  const full = await db.all(
    `SELECT p.id, p.user_id, COUNT(v.id) AS c FROM participants p
       JOIN votes v ON v.participant_id = p.id
       JOIN rounds r ON r.id = v.round_id AND r.status = 'ratified'
      WHERE p.session_id = ? AND p.verified = 1 AND p.user_id IS NOT NULL
      GROUP BY p.id, p.user_id`, [session.id]);
  let paid = 0;
  for (const row of full) {
    if (Number(row.c) < total) continue;
    const ins = await db.run(
      `INSERT INTO point_events (id, user_id, points, series_id, reason, source_uid, milestone, created_at)
       VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (reason, source_uid, milestone) DO NOTHING`,
      [id(9), row.user_id, bonus, session.series_id || null,
       'live_complete', `${session.id}:${row.user_id}`, 1, now()]);
    if (ins.changes) { await db.run('UPDATE users SET lifetime_points = lifetime_points + ? WHERE uid = ?', [bonus, row.user_id]); paid++; }
  }
  return paid;
}

// Deleting a zero-vote record shrinks the day — which instantly STRANDS anyone already at
// n-1, because the award only ever runs inside /api/vote. Bounded by room size and only ever
// host- or cron-triggered, never on the boot or request path.
async function sweepCompletionBonuses(session) {
  const ps = await db.all('SELECT * FROM participants WHERE session_id = ? AND verified = 1', [session.id]);
  let paid = 0;
  for (const p of ps) if (await maybeAwardCompletionBonus(p, session)) paid++;   // no atTs: each A&R at their OWN last-vote tier
  return paid;
}

// ===== A&R DAILY — the lifecycle =====
// The day runs on the clock, not on a button: it opens at noon, closes at 9AM, tallies, and
// publishes at noon. Driven by /api/cron/daily (and by an admin route, so the operator can
// run it by hand and so the suite can drive it without CRON_SECRET set).
//
// EVERY TRANSITION IS A CONDITIONAL UPDATE. Vercel documents that a scheduled run can
// occasionally be invoked more than once, and at 12:00PM two invocations would otherwise both
// open the day. The claim IS the lock — the drainArtistSms pattern, applied to a state machine
// rather than a queue row.
//
// AND IT IS DEADLINE-BUDGETED. ratifyRound() re-scores every vote in a round inside one
// transaction; at the 2,000-concurrent target a full day is tens of thousands of rows, which
// is not a 30-second job (vercel.json pins maxDuration to 30). The 9AM close gives a 3-hour
// runway to the noon publish, so the tally deliberately takes as many ticks as it needs and
// stops cleanly when the budget runs out. A plain `for (const r of rounds) await ratify(r)`
// would silently produce a half-tallied day and a published-but-wrong leaderboard.
const DROP_TICK_BUDGET_MS = 22000;   // of the 30s function ceiling

// How long after the noon publish the artist notices are held. 029 made comments ship by
// DEFAULT with the host rejecting the odd bad one — a model that works because a live show
// has a wrap-up moment where the send panel prints "N comments about to go out". A cron has
// no such moment, and there is no unsend. This hour is that checkpoint, restored.
const ARTIST_NOTICE_DELAY_MIN = 60;

async function runAsyncDropLifecycle({ budgetMs = DROP_TICK_BUDGET_MS, ts = null } = {}) {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  const at = ts != null ? Number(ts) : now();
  const out = { opened: 0, closed: 0, ratified: 0, sealed: 0, published: 0,
    digestSent: 0, digestFailed: 0, artistSent: 0, artistFailed: 0, artistSms: 0, budgetHit: false };

  const due = await db.all(
    `SELECT * FROM sessions
      WHERE mode = 'async' AND deleted_at IS NULL
        AND COALESCE(async_state, 'scheduled') IN ('scheduled','open','closing','ratified')
      ORDER BY window_opens_at ASC LIMIT 5`, []);

  for (const s of due) {
    if (left() < 2000) { out.budgetHit = true; break; }
    const state = s.async_state || 'scheduled';

    // ---- open: scheduled -> open (claim, then flip every record in one statement) ----
    if (state === 'scheduled' && at >= Number(s.window_opens_at)) {
      const claim = await db.run(
        "UPDATE sessions SET async_state = 'open', status = 'live' WHERE id = ? AND COALESCE(async_state,'scheduled') = 'scheduled'",
        [s.id]);
      if (!claim.changes) continue;                       // another invocation won
      await db.run("UPDATE rounds SET status = 'voting' WHERE session_id = ? AND status = 'pending'", [s.id]);
      await realtime.publish(s.id, 'round');
      out.opened++;
      continue;                                            // nothing else is due for this day yet
    }

    // ---- close: open -> closing (stop the voting, then tally over as many ticks as needed) ----
    if (state === 'open' && at >= Number(s.window_closes_at)) {
      const claim = await db.run(
        "UPDATE sessions SET async_state = 'closing' WHERE id = ? AND async_state = 'open'", [s.id]);
      if (!claim.changes) continue;
      await db.run("UPDATE rounds SET status = 'closed' WHERE session_id = ? AND status = 'voting'", [s.id]);
      // Anyone stranded at n-1 by a deleted record is paid here, each at their OWN last-vote
      // tier (no atTs), rather than being silently skipped because they never cast an nth vote.
      try { await sweepCompletionBonuses(s); } catch (e) { console.error('[daily] bonus sweep failed:', e.message); }
      await realtime.publish(s.id, 'round');
      out.closed++;
    }

    // ---- tally: one record at a time, budget-checked, ONE board push at the end ----
    if ((s.async_state === 'closing' || state === 'closing') || out.closed) {
      const pending = await db.all(
        "SELECT * FROM rounds WHERE session_id = ? AND status = 'closed' ORDER BY idx ASC", [s.id]);
      for (const r of pending) {
        if (left() < 6000) { out.budgetHit = true; break; }
        // Per-round claim: nothing else can distinguish a tally in flight from one abandoned
        // by a dead invocation, and re-running ratifyRound would double-bump total_points.
        const rc = await db.run(
          'UPDATE rounds SET tally_claimed_at = ? WHERE id = ? AND status = ? AND tally_claimed_at IS NULL',
          [Date.now(), r.id, 'closed']);
        if (!rc.changes) continue;
        await ratifyRound(r);                               // pure tally — no per-round board push
        try { await creditReferralMilestones(r, s); } catch (e) { console.error('[daily] referral credit failed:', e.message); }
        try { await creditScoutPoints(await db.get('SELECT * FROM rounds WHERE id = ?', [r.id]), s); }
        catch (e) { console.error('[daily] scout credit failed:', e.message); }
        out.ratified++;
      }
      const stillOpen = (await db.get(
        "SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('voting','closed')", [s.id])).c;
      if (!Number(stillOpen)) {
        await db.run("UPDATE sessions SET async_state = 'ratified' WHERE id = ? AND async_state = 'closing'", [s.id]);
        // ONE series-board recompute and ONE push for the whole day — not one per record,
        // which is exactly the cost the per-round /ratify route exists to avoid.
        let lbData = null;
        if (s.series_id) {
          try { lbData = { series: { id: s.series_id, leaderboard: await homeSeriesBoard(s.series_id) } }; }
          catch (e) { console.error('[daily] board compute failed:', e.message); }
        }
        await realtime.publish(s.id, 'leaderboard', lbData);
        out.sealed++;
      }
    }

    // ---- publish: ratified -> published, at results_at (noon) ----
    const cur = await db.get('SELECT * FROM sessions WHERE id = ?', [s.id]);
    if (cur && cur.async_state === 'ratified' && at >= Number(cur.results_at)) {
      if (left() < 8000) { out.budgetHit = true; break; }
      try {
        const done = await publishDailyDrop(cur, { deadline: t0 + budgetMs });
        if (done) out.published++;
      } catch (e) { console.error('[daily] publish failed:', e.message); }
    }

  }

  // ---- drain: the two fan-outs, in their own pass ----
  // Deliberately OUTSIDE the state-machine loop above, because a published day has left that
  // working set for good — that is what keeps the "what is due" probe selective forever. The
  // queues outlive the transition, so they are drained by looking at the queues themselves.
  //
  // A&R digest first (~200ms a send, so 60+ per tick), then the artist reports (~3-6s each
  // because they render report PNGs, but bounded at one per record). SMS obeys its own ET
  // window and no-ops outside it. Throughput here is governed by tick COUNT, not tick length
  // — which is why the cron is */5 and not hourly.
  if (left() > 4000) {
    const pubs = await db.all(
      `SELECT * FROM sessions WHERE mode = 'async' AND async_state = 'published' AND deleted_at IS NULL
        ORDER BY published_at DESC LIMIT 3`, []);
    for (const s of pubs) {
      if (left() < 4000) { out.budgetHit = true; break; }
      const bc = await db.get("SELECT id FROM notify_broadcasts WHERE kind = 'digest_daily' AND ref_id = ?", [s.id]);
      if (bc) {
        try {
          const d = await drainDailyDigest({ sessionId: s.id, broadcastId: bc.id, limit: 60, deadline: t0 + budgetMs });
          out.digestSent += d.sent; out.digestFailed += d.failed;
        } catch (e) { console.error('[daily] digest drain failed:', e.message); }
      }
      // 029's reject-by-exception loses its human checkpoint under a cron: comments default
      // to shared, an async day has no wrap-up moment where the host sees "N comments about
      // to go out", and there is NO UNSEND. Holding the artist enqueue an hour past publish
      // gives the operator a real rejection window with the count visible in the console.
      const holdUntil = Number(s.published_at || 0) + ARTIST_NOTICE_DELAY_MIN * 60000;
      if (at >= holdUntil && left() > 8000) {
        try {
          await enqueueArtistNotices(s.id);
          const a = await drainArtistEmail({ sessionId: s.id, limit: 4, deadline: t0 + budgetMs });
          out.artistSent += a.sent; out.artistFailed += a.failed;
          const sms = await drainArtistSms({ sessionId: s.id, limit: 6 });
          out.artistSms += sms.sent;
        } catch (e) { console.error('[daily] artist drain failed:', e.message); }
      }
    }
  }
  return out;
}

// Publish the day: render and host the two shared cards, build the post kit caption, queue
// the A&R digest, and flip the session to completed/published.
//
// The status flip to 'completed' is what makes playerState's recap branch fire — which is
// why it happens at NOON and not at the 9AM close. Flipping three hours early would reveal
// every room average while the results are still supposed to be sealed.
//
// THE CARDS ARE BEST-EFFORT; THE REVEAL IS NOT.
//
// The plan called for skipping the publish entirely when BLOB_READ_WRITE_TOKEN is unset, so
// a day is never marked published without the Top 8 cards that form every digest's common
// block. On reflection that trades a small harm for a much larger one: a publish that skips
// does not retry into existence — it stalls, and every A&R sits on a sealed screen with no
// results, indefinitely, because of an env var. Results are the thing they are waiting for
// and the schedule is a promise.
//
// So the reveal always happens, and the graphics are attempted per-card with a failure
// logged and the URL left null. The digest template already drops a missing card, and for
// anyone who actually played, the substance of that mail is the round-by-round table, not
// the graphics. The console's daily status surfaces the missing cards so a re-render is a
// visible piece of work rather than a silent degradation.
async function publishDailyDrop(session, { deadline = null } = {}) {
  const sessionId = session.id;
  // The claim. Vercel can double-invoke a scheduled run, and two publishers would queue two
  // broadcasts. recap_jobs.claimed_at is the token; a claim older than 10 minutes is treated
  // as abandoned so a crashed render cannot wedge the day forever.
  const stale = now() - 10 * 60000;
  await db.run(
    'INSERT INTO recap_jobs (session_id, created_at, stage, claimed_at) VALUES (?,?,?,?) ON CONFLICT (session_id) DO NOTHING',
    [sessionId, now(), 'daily', null]);
  const claim = await db.run(
    "UPDATE recap_jobs SET claimed_at = ?, stage = 'daily' WHERE session_id = ? AND (claimed_at IS NULL OR claimed_at < ?)",
    [now(), sessionId, stale]);
  if (!claim.changes) return false;                       // another invocation owns this publish

  // Deterministic paths — uploadPng is allowOverwrite, so a re-run replaces rather than
  // accumulating a new URL every time.
  const day = session.drop_day || etDay(Number(session.window_opens_at) || now());
  let arsUrl = null, songsUrl = null, caption = null;
  try {
    const kit = await buildPostKit(session);
    if (kit) {
      caption = kit.caption;
      for (const f of kit.files) {
        if (f.kind === 'ars') arsUrl = await uploadPng(`daily/${day}/ars.png`, f.buf);
        if (f.kind === 'songs') songsUrl = await uploadPng(`daily/${day}/songs.png`, f.buf);
        if (deadline && Date.now() > deadline) break;
      }
    }
  } catch (e) {
    // Logged, not fatal — see the note above. The caption survives even when hosting does
    // not, so the operator can still assemble the post by hand.
    console.error('[daily] card render/upload failed:', e.message);
  }
  await db.run(
    `UPDATE recap_jobs SET ars_url = ?, songs_url = ?, caption = ? WHERE session_id = ?`,
    [arsUrl, songsUrl, caption, sessionId]);

  try { await enqueueDailyDigest(session); }
  catch (e) { console.error('[daily] digest enqueue failed:', e.message); }

  // status='completed' is the LAST thing, so a failure above leaves the day unpublished and
  // the next tick retries rather than stranding it half-revealed.
  await db.run(
    "UPDATE sessions SET async_state = 'published', status = 'completed', published_at = ? WHERE id = ? AND async_state = 'ratified'",
    [now(), sessionId]);
  await realtime.publish(sessionId, 'round');
  return true;
}

// The A&R Team's daily surface. Returns the participant's whole queue — every record of the
// day, in THEIR deterministic order — plus where they are in it and what the day is worth.
//
// THE SEAL, and it is stricter here than on a live show. Omit keys rather than nulling them:
// `room_average: null` versus a number is itself a tell once one record tallies.
//   * no room_average, no split — ever, before the results publish
//   * no other participant's taste / predict / points / rank / tier
//   * NO PER-RECORD VOTE COUNTS. On a live show a vote count means "how many people are in
//     the room"; across a 21-hour window with every record open at once it is a POPULARITY
//     signal — "record 7 has 180 evaluations and record 12 has 40" says where the room's
//     attention went, which is the direction-adjacent inference the seal rule forbids.
//     Only the session-level participant count ships.
// myVote and myComment DO ship: they are the A&R's own answers, and showing "you gave this a
// 7" on revisit is the point of being able to navigate back.
async function asyncPlayerState(participant, session, count) {
  const ts = now();
  const opens = Number(session.window_opens_at) || 0;
  const closes = Number(session.window_closes_at) || 0;
  const results = Number(session.results_at) || 0;

  const rows = await db.all(
    `SELECT id, idx, song_title, song_artist, artist_note, play_url, artist_instagram, artist_profile_url, status
       FROM rounds WHERE session_id = ? AND status IN ('voting','closed','ratified') ORDER BY idx ASC`,
    [session.id]);
  const total = rows.length;

  const mine = await db.all(
    `SELECT v.round_id, v.taste, v.predict FROM votes v JOIN rounds r ON r.id = v.round_id
      WHERE r.session_id = ? AND v.participant_id = ?`, [session.id, participant.id]);
  const byRound = new Map(mine.map(v => [v.round_id, v]));
  const comments = await db.all(
    `SELECT c.round_id, c.body FROM round_comments c JOIN rounds r ON r.id = c.round_id
      WHERE r.session_id = ? AND c.participant_id = ?`, [session.id, participant.id]);
  const cmtBy = new Map(comments.map(c => [c.round_id, c.body]));
  const reports = await db.all(
    `SELECT rr.round_id, rr.reason FROM round_reports rr JOIN rounds r ON r.id = rr.round_id
      WHERE r.session_id = ? AND rr.participant_id = ?`, [session.id, participant.id]);
  const repBy = new Map(reports.map(r => [r.round_id, r.reason]));

  // The A&R's own running order. Pure function of (uid, session) — nothing stored, so resume
  // is free and there is no cursor to go stale when a record is deleted or a second tab votes.
  const ordered = asyncQueueOrder(participant.user_id || participant.id, session.id, rows);
  const voted = mine.length;
  // A reported record is DEALT WITH for this A&R. See asyncHandled — if it stayed in the way,
  // an honest report on a dead link would cost the reporter their completion bonus.
  const handled = rows.reduce((n, r) => n + (byRound.has(r.id) || repBy.has(r.id) ? 1 : 0), 0);
  const reportsTotal = rows.reduce((n, r) => n + (repBy.has(r.id) ? 1 : 0), 0);

  let phase;
  if (session.status === 'completed' || (session.async_state === 'published' && ts >= results)) phase = 'recap';
  else if (ts < opens || session.async_state === 'scheduled') phase = 'waiting';
  else if (ts >= closes) phase = 'sealed';       // rated, tallying or tallied — results at noon
  else phase = handled >= total && total > 0 ? 'done' : 'queue';

  // Before the day opens the queue ships EMPTY — titles and pre-release links are a reveal,
  // and there is no reason for them to exist client-side three hours early.
  const open = phase === 'queue' || phase === 'done' || phase === 'sealed';
  const queue = !open ? [] : ordered.map((r, i) => {
    const v = byRound.get(r.id);
    const item = { id: r.id, position: i + 1, idx: r.idx, song_title: r.song_title,
      song_artist: r.song_artist, artist_note: r.artist_note || null, play_url: r.play_url || null,
      // Public promotional links only. ingest_url is the admin deep link to the submission
      // node and carries the submitter's contact details — it must never reach a player.
      artist_instagram: r.artist_instagram || null,
      artist_profile_url: r.artist_profile_url || null,
      voted: !!v };
    if (v) item.myVote = { taste: v.taste, predict: v.predict };
    if (cmtBy.has(r.id)) item.myComment = cmtBy.get(r.id);
    // Their own report, so a revisit shows the record as dealt with rather than unrated.
    // Note this is the CALLER's report only — a per-record report COUNT would be exactly
    // the popularity signal the seal note above rules out.
    if (repBy.has(r.id)) item.myReport = repBy.get(r.id);
    return item;   // note: no room_average, no counts, no other votes. See the seal note above.
  });

  // Tiers are SERVER-computed and shipped as resolved epochs + a label. The client must never
  // derive the tier from its own clock: a timezone bug would promise money the server won't
  // pay, on a cash-prize board.
  const day = session.drop_day;
  // Every label is a bare wall-clock string so a caller can put its own word in front of
  // it ("until 3:00 PM ET", "Before 3:00 PM ET"). The last tier used to read "before the
  // window closes", which rendered as "Before before the window closes".
  const tiers = [
    { at: etEpoch(day, 15), points: 100, label: '3:00 PM ET' },
    { at: etEpoch(day, 18), points: 75, label: '6:00 PM ET' },
    { at: etEpoch(day, 21), points: 50, label: '9:00 PM ET' },
    { at: closes, points: 25, label: etClockLabel(closes) },
  ];
  const nextTier = tiers.find(t => t.at != null && ts < t.at) || null;
  const earned = await db.get(
    "SELECT points FROM point_events WHERE reason = 'async_complete' AND source_uid = ?",
    [`${session.id}:${participant.user_id || ''}`]);

  const out = {
    session: { id: session.id, name: session.name, status: session.status, poll_type: 'rating', mode: 'async' },
    mode: 'async',
    // Every LABEL here is server-rendered for the same reason the tiers are: the surface
    // must never turn an epoch into ET wall-clock with the browser's own timezone.
    async: { day, opens_at: opens, closes_at: closes, results_at: results, tiers,
      dayLabel: etDayLabel(day), opensLabel: etClockLabel(opens),
      closesLabel: etClockLabel(closes), resultsLabel: etClockLabel(results),
      closesWhen: etWhenLabel(closes, day), resultsWhen: etWhenLabel(results, day) },
    phase,
    progress: { voted, total, handled, reported: reportsTotal,
      // A short day still pays; only a 1-2 record day (a mis-push or a dry pool) does not.
      eligible: total >= ASYNC_MIN_FOR_BONUS,
      reportsLeft: Math.max(0, reportCapFor(total) - reportsTotal),
      reportCap: reportCapFor(total),
      earned: earned ? Number(earned.points) : null,
      nextTierAt: nextTier ? nextTier.at : null,
      nextTierPoints: nextTier ? nextTier.points : null,
      nextTierLabel: nextTier ? nextTier.label : null },
    // The comment cap lives on the server (COMMENT_MAX). Shipping it means the surface never
    // carries a second copy that can drift from what the server actually enforces.
    commentMax: COMMENT_MAX,
    queue,
    me: { name: participant.name, email: participant.email, total_points: participant.total_points },
    myTotalPoints: participant.total_points,
    refCode: participant.ref_code || null,
    participants: count,
  };

  // The scorecard. Only ever built in 'recap', which is only reachable once the day has
  // published — so this is the one place room_average is allowed to exist in a player
  // payload, and the seal is why it is gated on the phase rather than on the data.
  if (phase === 'recap') {
    out.recap = await buildRecap(participant, { detail: true });
    out.recap.completionBonus = earned ? Number(earned.points) : null;
    out.rank = out.recap.rank;
  }
  return out;
}

async function playerState(participant) {
  const sessionId = participant.session_id;
  const session = await db.get('SELECT id, name, status, scheduled_at, banner_id, poll_type, watch_url, lobby_message, broadcast_text, broadcast_at, broadcast_overlay, geo_mode, geo_label, geo_radius, owner_uid, series_id, mode, drop_day, async_state, window_opens_at, window_closes_at, results_at FROM sessions WHERE id = ?', [sessionId]);
  const pollType = session.poll_type === 'binary' ? 'binary' : 'rating'; // session default/hint only
  const count = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1', [sessionId])).c;
  // A&R Daily has no single active round — every record of the day is open at once — so it
  // never reaches activeRound(), which is single-round BY DEFINITION.
  if (isAsync(session)) return asyncPlayerState(participant, session, count);
  const round = await activeRound(sessionId);
  // Poll type is PER-ROUND: the active round decides which widget the player sees.
  // Fall back to the session default when there's no round yet.
  const roundType = round ? (round.poll_type || pollType) : pollType;
  const isBinary = roundType === 'binary';

  let view = { phase: 'waiting' }; // waiting | voting | locked | results
  if (round) {
    const myVote = await db.get('SELECT * FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    // Shape a round object for the player, carrying its poll_type + A/B labels on binary rounds.
    const roundBase = {
      id: round.id, idx: round.idx, poll_type: roundType, song_title: round.song_title, song_artist: round.song_artist,
      song_note: round.song_note, giveaway: round.giveaway, closes_at: round.closes_at,
    };
    // The player's own optional comment on this round, if they left one. Gated on
    // having voted — commenting requires a lock-in, so a non-voter can never have
    // one and the poll skips the lookup entirely. Point read on uniq_round_comment.
    const myCommentFor = async (rid) => {
      if (!myVote) return null;
      const c = await db.get('SELECT body FROM round_comments WHERE round_id = ? AND participant_id = ?', [rid, participant.id]);
      return c ? c.body : null;
    };
    if (isBinary) { roundBase.option_b_title = round.option_b_title; roundBase.option_b_artist = round.option_b_artist; }
    const myVoteShape = (v) => v
      ? (isBinary ? { pick: v.pick, predict_split: v.predict_split } : { taste: v.taste, predict: v.predict })
      : null;

    if (round.status === 'listening') {
      // The record is up and playing; nobody can vote yet. No dial, no clock — that's what
      // makes everyone's voting window identical once the host starts it. /api/vote refuses
      // this status outright, so the guard is real and not just a hidden button.
      view = { phase: 'listening', round: roundBase, myVote: null };
    } else if (round.status === 'voting') {
      view = {
        phase: myVote ? 'locked' : 'voting',
        round: roundBase,
        myVote: myVoteShape(myVote),
        myComment: await myCommentFor(round.id),
      };
    } else if (round.status === 'closed') {
      view = { phase: 'locked', round: { id: round.id, idx: round.idx, poll_type: roundType, song_title: round.song_title, ...(isBinary ? { option_b_title: round.option_b_title } : {}) }, tallying: true, myVote: myVoteShape(myVote), myComment: await myCommentFor(round.id) };
    } else if (round.status === 'ratified') {
      // Only three facts are needed here — the winner's name, THIS player's own row,
      // and the total count. Fetch exactly those instead of pulling the whole vote
      // set (which, on the 2.5s poll × every viewer, shipped O(votes) rows out of
      // Neon per poll — an O(viewers×votes) egress multiplier during the results screen).
      const winner = await db.get(
        `SELECT p.name FROM votes v JOIN participants p ON p.id = v.participant_id
         WHERE v.round_id = ? ORDER BY v.rank ASC LIMIT 1`, [round.id]);
      const mine = await db.get('SELECT * FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
      const totalPlayers = (await db.get('SELECT COUNT(*) AS c FROM votes WHERE round_id = ?', [round.id])).c;
      // FULLY BLIND during the session: players see their points, rank, and reaction
      // tier — but NOT the room average / split, NOT their exact "off by", NOT the
      // winner's guess. The answer is saved for the end-of-session recap reveal.
      const resultRound = { id: round.id, idx: round.idx, poll_type: roundType, song_title: round.song_title, song_artist: round.song_artist, giveaway: round.giveaway };
      if (isBinary) { resultRound.option_b_title = round.option_b_title; resultRound.option_b_artist = round.option_b_artist; }
      view = {
        phase: 'results',
        round: resultRound,
        winner: winner ? { name: winner.name || 'Someone' } : null,
        myResult: mine
          ? (isBinary
              ? { pick: mine.pick, predict_split: mine.predict_split, points: mine.points, rank: mine.rank, tier: mine.tier }
              : { taste: mine.taste, predict: mine.predict, points: mine.points, rank: mine.rank, tier: mine.tier })
          : null,
        totalPlayers,
        // The composer follows the player onto the results screen — the reveal
        // must never swap the screen out from under half-typed work.
        myComment: await myCommentFor(round.id),
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
  // Ad slot — EVERY phase, results and recap included (banner ads fund the show;
  // was lobby/voting/locked only until 2026-08-14).
  // Cascade: the room's own banner -> Revive zone (when configured) -> global banner.
  {
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
async function overlayState(session, lbScope) {
  const sessionId = session.id;
  const count = (await db.get('SELECT COUNT(*) AS c FROM participants WHERE session_id = ? AND verified = 1', [sessionId])).c;

  // A&R Daily has nothing to overlay — there is no stream, and every record of the day is
  // open at once. Falling through would be a SEAL VIOLATION, not just a cosmetic wrong:
  // activeRound() would pick one arbitrary record of the day and this function publishes its
  // running tally on a PUBLIC surface, while the room's average is exactly what every A&R is
  // still predicting. Refuse the whole shape; the leaderboard is safe and stays.
  if (isAsync(session)) {
    // The board is the only piece that still makes sense, and it is already a public shape
    // (it's what the homepage renders). Prefer the series board — the $500 race — since a
    // drop's own participant totals read 0 until the 9AM tally.
    const leaderboard = session.series_id
      ? (await homeSeriesBoard(session.series_id, 10)).map(r => ({ rank: r.rank, name: r.name, points: r.points }))
      : (await db.all('SELECT name, total_points FROM participants WHERE session_id = ? AND verified = 1 ORDER BY total_points DESC, created_at ASC LIMIT 10', [sessionId]))
          .map((p, i) => ({ rank: i + 1, name: dispName(p.name), points: p.total_points }));
    return { session: { id: sessionId, name: session.name, status: session.status, mode: 'async', poll_type: 'rating' },
      participants: count, current: null, result: null, leaderboard,
      leaderboardScope: session.series_id ? 'series' : 'session', broadcast: null };
  }

  const round = await activeRound(sessionId);
  // Per-round poll type: the current/last round decides the lower-third shape.
  const isBinary = (round ? (round.poll_type || session.poll_type) : session.poll_type) === 'binary';
  const onlyFirst = dispName; // full display name (no first-word splitting)

  let current = null, result = null;
  if (round) {
    const votes = await db.all('SELECT * FROM votes WHERE round_id = ?', [round.id]);
    const base = {
      idx: round.idx, status: round.status, closes_at: round.closes_at, poll_type: round.poll_type || session.poll_type,
      song_title: round.song_title, song_artist: round.song_artist, giveaway: round.giveaway,
    };
    if (isBinary) { base.option_b_title = round.option_b_title; base.option_b_artist = round.option_b_artist; }
    if (round.status === 'listening') {
      // On deck: the record is on screen while it plays. No vote count (there are none)
      // and no clock — closes_at is null, so the overlay's timer stays off on its own.
      base.votes = 0;
      current = base;
    } else if (round.status === 'voting' || round.status === 'closed') {
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
        idx: round.idx, poll_type: round.poll_type || session.poll_type, song_title: round.song_title, song_artist: round.song_artist, giveaway: round.giveaway,
        option_b_title: isBinary ? round.option_b_title : undefined,
        room: isBinary ? { split_a: round.split_a } : { average: round.room_average },
        top: ranked.map(r => ({ name: onlyFirst(r.name), points: r.points, rank: r.rank,
          ...(isBinary ? { pick: r.pick, predict_split: r.predict_split } : { predict: r.predict }) })),
        winner: ranked[0] ? onlyFirst(ranked[0].name) : null,
      };
    }
  }

  // Leaderboard scope (?leader_scope= on the overlay URL): 'room' (default) = this
  // room's running totals; 'round' = the latest RATIFIED round only (points exist
  // only post-ratify, so nothing sealed can leak); 'series' = the $500 competition
  // board. An untagged room quietly falls back to room scope.
  let scope = (lbScope === 'round' || lbScope === 'series') ? lbScope : 'room';
  if (scope === 'series' && !session.series_id) scope = 'room';
  let leaderboard;
  if (scope === 'round') {
    const lastRat = await db.get("SELECT id FROM rounds WHERE session_id = ? AND status = 'ratified' ORDER BY idx DESC LIMIT 1", [sessionId]);
    const rows = lastRat ? await db.all(
      `SELECT p.name, v.points FROM votes v JOIN participants p ON p.id = v.participant_id
        WHERE v.round_id = ? AND v.points IS NOT NULL ORDER BY v.points DESC, v.rank ASC LIMIT 10`, [lastRat.id]) : [];
    leaderboard = rows.map((r, i) => ({ rank: i + 1, name: onlyFirst(r.name), points: r.points }));
  } else if (scope === 'series') {
    leaderboard = (await homeSeriesBoard(session.series_id, 10)).map(r => ({ rank: r.rank, name: r.name, points: r.points }));
  } else {
    const board = await db.all('SELECT name, total_points FROM participants WHERE session_id = ? AND verified = 1 ORDER BY total_points DESC, created_at ASC LIMIT 10', [sessionId]);
    leaderboard = board.map((p, i) => ({ rank: i + 1, name: onlyFirst(p.name), points: p.total_points }));
  }
  return {
    session: { id: sessionId, name: session.name, status: session.status, poll_type: isBinary ? 'binary' : 'rating' },
    participants: count,
    current,
    result,
    leaderboard,
    leaderboardScope: scope,
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

// ---- Charts (admin): "Makin' It HOT 100" and friends -----------------------------------
// A ranked chart of RECORDS or A&Rs across a series, a date range, or the last N rooms —
// feeding the Charts screen, the CSV export, and the Instagram carousel.
//
// Ranking is the ROOM AVERAGE with a MIN-VOTE FLOOR (operator's call, 2026-08-05): a 9.0
// from 4 voters must not outrank an 8.6 from 200, but the number PRINTED stays the room's
// real average, so the floor excludes rows rather than reweighting them into something no
// A&R ever voted. Excluded rounds come back in their own list instead of vanishing — a
// chart that silently truncates reads as "this is everything" when it isn't, and the
// operator needs to see what the floor cost before choosing where to put it.
//
// Versus/binary rounds never chart: a split isn't an average (same rule as cardSongsData).
// All of this scales with ROUNDS and is admin-triggered — it must never become reachable
// from the boot or poll path (CLAUDE.md #1 rule).

const CHART_DEFAULT_MIN_VOTES = 10;
const chartDate = ms => new Date(Number(ms) || 0)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
const chartDay = ms => new Date(Number(ms) || 0)
  .toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD, for CSV/sorting
// Loose match for "same record, played twice": case/punctuation-insensitive title+artist.
const chartKey = s => (s == null ? '' : String(s)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Resolve the requested scope to a concrete set of rooms + a human label.
// Soft-deleted rooms never chart. Returns null when the scope names something that's gone.
async function chartScope(q) {
  const pick = (where, params) => db.all(
    `SELECT id, name, series_id, status, COALESCE(scheduled_at, created_at) AS show_at
       FROM sessions WHERE deleted_at IS NULL ${where}
      ORDER BY COALESCE(scheduled_at, created_at) DESC`, params);
  if (q.scope === 'series') {
    const ser = await db.get('SELECT id, title FROM series WHERE id = ?', [q.seriesId]);
    if (!ser) return null;
    return { kind: 'series', label: ser.title, seriesId: ser.id, sessions: await pick('AND series_id = ?', [ser.id]) };
  }
  if (q.scope === 'range') {
    if (!(q.from >= 0) || !(q.to > q.from)) return null;
    return { kind: 'range', label: `${chartDate(q.from)} – ${chartDate(q.to)}`, from: q.from, to: q.to,
      sessions: await pick('AND COALESCE(scheduled_at, created_at) BETWEEN ? AND ?', [q.from, q.to]) };
  }
  if (q.scope === 'last') {
    // "Last N rooms" means N rooms that actually RAN — an empty upcoming room isn't a show.
    const ran = await pick("AND status <> 'upcoming'", []);
    return { kind: 'last', label: `Last ${q.lastN} rooms`, lastN: q.lastN, sessions: ran.slice(0, q.lastN) };
  }
  return { kind: 'all', label: 'All time', sessions: await pick('', []) };
}

// Every ratified rating round in scope, split by the floor. Ties: more voters wins (a
// bigger room agreeing is the stronger result), then the earlier play — first to hit it.
const chartRank = (a, b) => b.score - a.score || b.votes - a.votes || a.showAt - b.showAt;
async function chartRecords(sessions, { minVotes, dedupe }) {
  if (!sessions.length) return { charting: [], excluded: [], pool: 0 };
  const ids = sessions.map(s => s.id);
  const ph = ids.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT r.id, r.idx, r.song_title, r.song_artist, r.song_note, r.room_average, r.session_id,
            s.name AS session_name, COALESCE(s.scheduled_at, s.created_at) AS show_at,
            COUNT(v.id) AS votes
       FROM rounds r
       JOIN sessions s ON s.id = r.session_id
       LEFT JOIN votes v ON v.round_id = r.id AND v.taste IS NOT NULL
      WHERE r.session_id IN (${ph}) AND r.status = 'ratified'
        AND r.poll_type <> 'binary' AND r.room_average IS NOT NULL
      GROUP BY r.id, r.idx, r.song_title, r.song_artist, r.song_note, r.room_average,
               r.session_id, s.name, s.scheduled_at, s.created_at`, ids);
  const all = rows.map(r => {
    const m = /(?:IG|instagram)[:\s]+@?([A-Za-z0-9_.]+)/i.exec(r.song_note || '');
    return {
      roundId: r.id, title: r.song_title || '—', artist: r.song_artist || '', ig: m ? m[1] : null,
      score: Number(r.room_average), votes: Number(r.votes) || 0, plays: 1,
      room: r.session_name, roomId: r.session_id, showAt: Number(r.show_at),
    };
  });
  const excluded = all.filter(r => r.votes < minVotes).sort(chartRank);
  let charting = all.filter(r => r.votes >= minVotes).sort(chartRank);
  if (dedupe) {
    // A record replayed in a later room charts ONCE, at its best showing. `plays` keeps the
    // repeat visible in the CSV instead of quietly dropping a row the operator can see.
    const best = new Map();
    for (const r of charting) {
      const k = chartKey(r.title) + '|' + chartKey(r.artist);
      const prev = best.get(k);
      if (prev) { prev.plays++; continue; }
      best.set(k, r);
    }
    charting = [...best.values()]; // already in ranked order — Map preserves insertion
  }
  return { charting, excluded, pool: all.length };
}

// Top A&Rs over the scope. A SERIES chart reads the public board verbatim (bonus
// point_events included) — that's the $500 board, and a chart that disagreed with it
// would be a support ticket. Other scopes sum vote points over the scoped rooms.
async function chartArs(scope, sessions) {
  const ids = sessions.map(s => s.id);
  const ph = ids.map(() => '?').join(',');
  const shape = r => ({
    id: r.uid, name: r.name || 'A&R', ig: igClean(r.instagram),
    category: r.primary_category || null, location: r.location || null,
    points: Number(r.pts) || 0, rounds: r.rounds == null ? null : Number(r.rounds),
  });
  if (scope.kind === 'series') {
    const rows = await db.all(
      `SELECT u.uid, u.name, u.instagram, u.primary_category, u.location, SUM(t.pts) AS pts
         FROM (${SERIES_POINTS_SRC}) t JOIN users u ON t.puid = u.uid
        WHERE u.profile_complete = 1 AND u.blocked = 0
        GROUP BY u.uid, u.name, u.instagram, u.primary_category, u.location
        ORDER BY pts DESC, u.name ASC`, [scope.seriesId, scope.seriesId]);
    // Rounds-scored isn't derivable from the points union (it carries bonus events too),
    // so count it off the scoped rooms and merge.
    const counts = ids.length ? await db.all(
      `SELECT p.user_id AS uid, COUNT(v.id) AS rounds
         FROM votes v JOIN participants p ON v.participant_id = p.id
         JOIN rounds r ON r.id = v.round_id
        WHERE r.session_id IN (${ph}) AND v.points IS NOT NULL AND p.user_id IS NOT NULL
        GROUP BY p.user_id`, ids) : [];
    const byUid = new Map(counts.map(c => [c.uid, Number(c.rounds) || 0]));
    return rows.map(r => shape({ ...r, rounds: byUid.get(r.uid) ?? 0 }));
  }
  if (!ids.length) return [];
  const rows = await db.all(
    `SELECT u.uid, u.name, u.instagram, u.primary_category, u.location,
            SUM(v.points) AS pts, COUNT(v.id) AS rounds
       FROM votes v
       JOIN participants p ON v.participant_id = p.id
       JOIN rounds r ON r.id = v.round_id
       JOIN users u ON p.user_id = u.uid
      WHERE r.session_id IN (${ph}) AND v.points IS NOT NULL
        AND u.profile_complete = 1 AND u.blocked = 0
      GROUP BY u.uid, u.name, u.instagram, u.primary_category, u.location
      ORDER BY pts DESC, u.name ASC`, ids);
  return rows.map(shape);
}

// Parse + clamp everything the chart endpoints accept, in one place so the JSON, the CSV
// and the carousel can never disagree about what was asked for.
function chartQuery(url) {
  const g = k => url.searchParams.get(k);
  // Number.isFinite, not `|| d` — a legitimate 0 (minVotes=0 turns the floor OFF) is
  // falsy, and `|| d` would silently restore the default floor the operator just cleared.
  const int = (k, d, lo, hi) => { const n = parseInt(g(k), 10); return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : d)); };
  const mode = ['records', 'ars', 'weekly1s'].includes(g('mode')) ? g('mode') : 'records';
  const scope = ['series', 'range', 'last', 'all'].includes(g('scope')) ? g('scope') : 'all';
  return {
    mode, scope,
    seriesId: g('seriesId') || null,
    from: parseInt(g('from'), 10) || 0,
    to: parseInt(g('to'), 10) || 0,
    lastN: int('lastN', 4, 1, 52),
    minVotes: int('minVotes', CHART_DEFAULT_MIN_VOTES, 0, 100000),
    limit: int('limit', 100, 1, 1000),
    per: int('per', 10, 5, 20),          // rows per carousel slide (IG caps a carousel at 20)
    order: g('order') === 'countdown' ? 'countdown' : 'top',
    dedupe: g('dedupe') !== '0',
    title: (g('title') || '').trim().slice(0, 40) || null,
  };
}

async function chartsData(q) {
  const scope = await chartScope(q);
  if (!scope) return null;
  const sessions = scope.sessions;
  const out = {
    mode: q.mode, order: q.order, minVotes: q.minVotes, limit: q.limit, per: q.per,
    dedupe: q.dedupe, scaleMax: shareCards.CHART_SCALE_MAX, bands: shareCards.CHART_BANDS,
    scope: { kind: scope.kind, label: scope.label, rooms: sessions.length,
      from: sessions.length ? Math.min(...sessions.map(s => Number(s.show_at))) : null,
      to: sessions.length ? Math.max(...sessions.map(s => Number(s.show_at))) : null },
    generatedAt: now(),
  };

  if (q.mode === 'ars') {
    const all = await chartArs(scope, sessions);
    const rows = all.slice(0, q.limit).map((r, i) => ({ rank: i + 1, ...r }));
    out.rows = q.order === 'countdown' ? rows.slice().reverse() : rows;
    out.excluded = [];
    out.summary = { pool: all.length, charting: rows.length, excluded: 0, votes: null };
    out.title = q.title || 'Top A&Rs';
    return out;
  }

  const { charting, excluded, pool } = await chartRecords(sessions, q);

  if (q.mode === 'weekly1s') {
    // One row per room that ran, newest first: its top record over the floor. A room whose
    // best record is UNDER the floor reports null rather than silently dropping out — the
    // gap in the week is the story.
    const bySession = new Map();
    for (const r of charting) if (!bySession.has(r.roomId)) bySession.set(r.roomId, r);
    const ran = sessions.filter(s => s.status !== 'upcoming').slice(0, q.limit);
    const rows = ran.map(s => {
      const top = bySession.get(s.id) || null;
      return { rank: 1, room: s.name, roomId: s.id, showAt: Number(s.show_at),
        showDate: chartDay(s.show_at), record: top };
    });
    out.rows = q.order === 'countdown' ? rows.slice().reverse() : rows;
    out.excluded = [];
    out.summary = { pool, charting: rows.filter(r => r.record).length, excluded: rows.filter(r => !r.record).length,
      votes: chartVoteSpread(charting) };
    out.title = q.title || 'Room #1s';
    return out;
  }

  const ranked = charting.slice(0, q.limit).map((r, i) => ({ rank: i + 1, ...r, showDate: chartDay(r.showAt) }));
  out.rows = q.order === 'countdown' ? ranked.slice().reverse() : ranked;
  // Keep the excluded preview small — it exists to justify the floor, not to be a second chart.
  out.excluded = excluded.slice(0, 25).map(r => ({ ...r, showDate: chartDay(r.showAt) }));
  out.summary = { pool, charting: charting.length, excluded: excluded.length,
    deduped: q.dedupe ? ranked.reduce((n, r) => n + (r.plays - 1), 0) : 0,
    votes: chartVoteSpread(charting) };
  out.title = q.title || 'Makin’ It HOT ' + (charting.length >= q.limit ? q.limit : charting.length);
  return out;
}

function chartVoteSpread(rows) {
  if (!rows.length) return null;
  const v = rows.map(r => r.votes).sort((a, b) => a - b);
  const mid = v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  return { min: v[0], median: mid, max: v[v.length - 1] };
}

// CSV per mode. Same rows, same order, same floor as the on-screen chart.
function chartsCsv(d) {
  const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  let head, body;
  if (d.mode === 'ars') {
    head = ['rank', 'name', 'instagram', 'category', 'location', 'points', 'rounds_scored'];
    body = d.rows.map(r => [r.rank, r.name, r.ig ? '@' + r.ig : '', r.category, r.location, r.points, r.rounds]);
  } else if (d.mode === 'weekly1s') {
    head = ['room', 'show_date', 'title', 'artist', 'instagram', 'room_average', 'votes'];
    body = d.rows.map(r => r.record
      ? [r.room, r.showDate, r.record.title, r.record.artist, r.record.ig ? '@' + r.record.ig : '', r.record.score.toFixed(1), r.record.votes]
      : [r.room, r.showDate, '', '', '', '', '']);
  } else {
    head = ['rank', 'title', 'artist', 'instagram', 'room_average', 'votes', 'plays', 'room', 'show_date', 'round_id'];
    body = d.rows.map(r => [r.rank, r.title, r.artist, r.ig ? '@' + r.ig : '', r.score.toFixed(1), r.votes, r.plays, r.room, r.showDate, r.roundId]);
  }
  return [head.join(',')].concat(body.map(row => row.map(esc).join(','))).join('\n');
}

// The Instagram caption: the chart as pasteable text, with the band key and both CTAs.
function chartsCaption(d) {
  const L = [];
  L.push(`${d.title.toUpperCase()} — ${d.scope.label.toUpperCase()} 🔥`, '');
  L.push(`Tracks submitted to the A&R Room at ${shareCards.SUBMIT_URL} — rated live, 0–${d.scaleMax}, by the room.`, '');
  if (d.mode !== 'ars') { d.bands.forEach(b => L.push(`${b.range} | ${b.label}`)); L.push(''); }
  d.rows.forEach(r => {
    if (d.mode === 'ars') return L.push(`${r.rank}. ${r.name}${r.ig ? ' — @' + r.ig : ''} (${r.points.toLocaleString()} pts)`);
    if (d.mode === 'weekly1s') return L.push(r.record
      ? `${r.room} — ${r.record.title}${r.record.ig ? ' — @' + r.record.ig : ' — ' + r.record.artist} (${r.record.score.toFixed(1)})`
      : `${r.room} — no record cleared the floor`);
    L.push(`${r.rank}. ${r.title}${r.ig ? ' — @' + r.ig : (r.artist ? ' — ' + r.artist : '')} (${r.score.toFixed(1)})`);
  });
  L.push('', `Join the A&R Team → ${shareCards.JOIN_URL}`, `Submit your record → ${shareCards.SUBMIT_URL}`, '',
    '@Makinit4indies #TheARoom');
  return L.join('\n');
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
    gapWord: gap == null ? '' : (gap >= 0.05 ? "It exceeded the room's expectations"
      : gap <= -0.05 ? 'Expectations finished above the final score' : 'It finished in line with expectations'),
    medianNote: 'Half of eligible A&Rs scored it ' + fmt(median) + ' or higher.'
      + (median > mean + 0.2 ? ' The typical evaluation was stronger than the final average; a small number of lower scores shifted the result.' : ''),
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
function recapEmailText(d, sessionName, manage) {
  return `Your A&R Room session record — ${sessionName}\n\nYou finished #${d.rank} of ${d.total}. `
    + `Share your A&R Record, the Top 8 Records, and the Top 8 A&Rs as one Instagram carousel. Add `
    + `@Makinit4indies as a collaborator to extend its reach. Return for the next evaluation at ANR.makinitmag.com.`
    + (manage ? `\n\n${notifyFooterText(manage)}` : '');
}
function recapEmailHtml({ name, sessionName, rank, total, cards, manage }) {
  const first = dispName(name); // greet with the full display name, not just the first word
  const imgs = [
    ['Your A&R Record', cards.score],
    ['Top 8 Songs', cards.songs],
    ['Top 8 A&Rs', cards.ars],
    [`${GIVEAWAY_PRIZE_LABEL} Monthly A&R Award`, cards.promo],
  ].filter(([, u]) => !!u);
  const block = imgs.map(([alt, u]) =>
    `<a href="${u}" style="text-decoration:none"><img src="${u}" alt="${escapeHtml(alt)}" width="320" style="width:320px;max-width:100%;border-radius:14px;display:block;margin:0 auto 14px;border:1px solid #2e2750"></a>`
  ).join('');
  return `<div style="background:#0d0b16;padding:26px 16px;font-family:'DM Sans',system-ui,sans-serif;color:#f3f0fb">
    <div style="max-width:360px;margin:0 auto;text-align:center">
      <div style="font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#a9a2c9">The A&amp;R Room</div>
      <h1 style="font-size:22px;margin:8px 0 4px">Your A&amp;R record, ${escapeHtml(first)}.</h1>
      <p style="font-size:15px;line-height:1.5;color:#a9a2c9;margin:0 0 20px">You finished <b style="color:#4bb749">#${rank}</b> of ${total} in <b style="color:#f3f0fb">${escapeHtml(sessionName)}</b>. Your verified session record is ready to share.</p>
      ${block}
      <div style="background:#171328;border:1px solid #6d5fe0;border-radius:14px;padding:16px;text-align:left;margin-top:6px">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px">📲 Share your A&amp;R record</div>
        <div style="font-size:13px;line-height:1.6;color:#a9a2c9">Post all four graphics as one Instagram <b>carousel</b>. Add <b style="color:#f3f0fb">@Makinit4indies</b> as a <b>collaborator</b> and tag us with <b>#TheARRoom</b>.</div>
      </div>
      <p style="font-size:13px;color:#6f688f;margin:22px 0 0">Return for the next evaluation → <a href="https://anr.makinitmag.com" style="color:#4bb749;text-decoration:none">ANR.makinitmag.com</a></p>
      ${manage ? notifyFooterHtml(manage) : ''}
    </div>
  </div>`;
}

// ===== A&R DAILY: THE DAILY DIGEST =====
// Two INDEPENDENT emails go out at noon, and they stay independent on purpose.
//
// This one is for A&Rs: "here's how you did." The artist gets their own (026's Song Report,
// unchanged in shape) saying "here's how your record did." Different products for different
// people — and an artist who is also a registered A&R correctly receives both, which is a
// fact to preserve rather than a duplicate to dedupe.
//
// It also keeps a structural fact clean rather than fighting it: ARTISTS ARE NOT USERS.
// They exist only as rounds.artist_email with no uid, so they could never sit in
// notify_recipients (PK is (broadcast_id, uid, channel)), have no notify_prefs row, and
// cannot be given a signed manage link (np1.<uid>.<exp> is uid-scoped). Their footer and
// their compliance basis are different. That is the real reason the two mails are separate.
//
// The CTA lands correctly for free: results publish at noon and today's drop opens at noon,
// so "today's records are open" is true at send time. The recap email IS the acquisition
// email — the best thing about the schedule.
//
// The five tier names are exactly what tierForError() (scoring.js) emits. One map here, no
// second source of truth for what counts as "sharp".
const TIER_LABEL = { bullseye: 'Bullseye', sharp: 'Sharp', close: 'Close', off: 'Off', wayoff: 'Way off' };
const TIER_COLOR = { bullseye: '#4bb749', sharp: '#4bb749', close: '#f3f0fb', off: '#a9a2c9', wayoff: '#a9a2c9' };

function dailyDigestEmailHtml({ name, dayLabel, cards = {}, recap = null, manage, playUrl }) {
  const imgs = [['Top 8 Songs', cards.songs], ['Top 8 A&Rs', cards.ars]].filter(([, u]) => !!u);
  const common = imgs.map(([alt, u]) =>
    `<a href="${u}" style="text-decoration:none"><img src="${u}" alt="${escapeHtml(alt)}" width="320" style="width:320px;max-width:100%;border-radius:14px;display:block;margin:0 auto 14px;border:1px solid #2e2750"></a>`
  ).join('');

  // The personalised half. Present for anyone who rated at least one record, ABSENT (not
  // empty) for everyone else — the audience is unconditional, the block is not.
  //
  // THE SEAL IS SATISFIED: every row here is a ratified round on a published day, so
  // room_average is already public. This is composed after the whole day has tallied and
  // must never be moved anywhere earlier.
  let arBlock = '';
  if (recap && recap.rounds && recap.rounds.length) {
    const rows = recap.rounds.map(r => {
      const dev = (r.taste != null && r.room_average != null)
        ? (Math.round((r.predict - r.room_average) * 10) / 10) : null;
      const devTxt = dev == null ? '—' : (dev > 0 ? '+' + dev.toFixed(1) : dev.toFixed(1));
      const col = TIER_COLOR[r.tier] || '#f3f0fb';
      return `<tr>
        <td style="padding:9px 6px 9px 0;border-top:1px solid #2e2750;font-size:13px">
          <div style="color:#f3f0fb">${escapeHtml(r.song_title || '')}</div>
          <div style="color:#8c84ad;font-size:11.5px">${escapeHtml(r.song_artist || '')}</div>
        </td>
        <td style="padding:9px 6px;border-top:1px solid #2e2750;font-family:'Space Mono',monospace;font-size:13px;color:#a9a2c9;text-align:center">${r.taste == null ? '—' : r.taste}</td>
        <td style="padding:9px 6px;border-top:1px solid #2e2750;font-family:'Space Mono',monospace;font-size:13px;color:#a9a2c9;text-align:center">${r.predict == null ? '—' : Number(r.predict).toFixed(1)}</td>
        <td style="padding:9px 6px;border-top:1px solid #2e2750;font-family:'Space Mono',monospace;font-size:13px;color:#f3f0fb;text-align:center">${r.room_average == null ? '—' : Number(r.room_average).toFixed(1)}</td>
        <td style="padding:9px 6px;border-top:1px solid #2e2750;font-family:'Space Mono',monospace;font-size:12px;color:${col};text-align:center">${devTxt}</td>
        <td style="padding:9px 0 9px 6px;border-top:1px solid #2e2750;font-family:'Space Mono',monospace;font-size:13px;font-weight:700;color:${col};text-align:right">${(Number(r.points) || 0) >= 0 ? '+' : ''}${Number(r.points) || 0}</td>
      </tr>`;
    }).join('');
    const stat = (k, v, c) => `<td style="width:33%;padding:12px 6px;text-align:center;background:#171328;border:1px solid #2e2750;border-radius:12px">
      <div style="font-family:'Space Mono',monospace;font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;color:#8c84ad">${k}</div>
      <div style="font-family:'Space Mono',monospace;font-size:22px;font-weight:700;margin-top:4px;color:${c || '#f3f0fb'}">${v}</div></td>`;
    arBlock = `
      <div style="height:1px;background:#2e2750;margin:26px 0 20px"></div>
      <div style="font-family:'Space Mono',monospace;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#8c84ad;text-align:left">How you did</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:10px 0 4px"><tr>
        ${stat('Points', recap.totalPoints == null ? '—' : recap.totalPoints, '#4bb749')}
        ${stat('Grade', recap.grade || '—')}
        ${stat('Rank', recap.rank ? '#' + recap.rank : '—', recap.rank === 1 ? '#f5c518' : null)}
      </tr></table>
      ${recap.bullseyes ? `<p style="font-size:13px;color:#a9a2c9;margin:10px 0 0;text-align:left">${recap.bullseyes} exact ${recap.bullseyes === 1 ? 'hit' : 'hits'} on the average.</p>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;text-align:left">
        <tr>
          <th align="left" style="font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8c84ad;padding-bottom:6px">Record</th>
          <th style="font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8c84ad;padding-bottom:6px">You</th>
          <th style="font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8c84ad;padding-bottom:6px">Guess</th>
          <th style="font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8c84ad;padding-bottom:6px">Avg</th>
          <th style="font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8c84ad;padding-bottom:6px">Off by</th>
          <th align="right" style="font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8c84ad;padding-bottom:6px">Pts</th>
        </tr>
        ${rows}
      </table>
      ${recap.completionBonus ? `<table role="presentation" width="100%" style="margin-top:2px"><tr>
        <td style="padding:11px 0 0;border-top:1px solid #2e2750;font-size:13.5px;font-weight:700;color:#f3f0fb">Completion bonus</td>
        <td align="right" style="padding:11px 0 0;border-top:1px solid #2e2750;font-family:'Space Mono',monospace;font-size:14px;font-weight:700;color:#f5c518">+${recap.completionBonus}</td>
      </tr></table>` : ''}`;
  }

  return `<div style="background:#0d0b16;padding:26px 16px;font-family:'DM Sans',system-ui,sans-serif;color:#f3f0fb">
    <div style="max-width:400px;margin:0 auto;text-align:center">
      <div style="font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#a9a2c9">A&amp;R Daily${dayLabel ? ' · ' + escapeHtml(dayLabel) : ''}</div>
      <h1 style="font-size:22px;margin:8px 0 4px">Yesterday's results${name ? ', ' + escapeHtml(dispName(name)) : ''}.</h1>
      <p style="font-size:15px;line-height:1.5;color:#a9a2c9;margin:0 0 20px">Here is how the records landed, and where the A&amp;Rs finished.</p>
      ${common}
      ${arBlock}
      <div style="height:1px;background:#2e2750;margin:26px 0 18px"></div>
      <a href="${playUrl}" style="display:block;background:#4bb749;color:#0d0b16;text-decoration:none;font-weight:700;font-size:16px;padding:15px;border-radius:13px">Today's records are open</a>
      <p style="font-size:13px;color:#8c84ad;margin:18px 0 0">Makin' It Magazine · A&amp;R Daily</p>
      ${manage ? notifyFooterHtml(manage) : ''}
    </div>
  </div>`;
}

function dailyDigestEmailText({ name, dayLabel, recap, manage, playUrl }) {
  const lines = [`A&R Daily${dayLabel ? ' — ' + dayLabel : ''}`, ''];
  lines.push(`Yesterday's results${name ? ', ' + dispName(name) : ''}.`);
  if (recap && recap.rounds && recap.rounds.length) {
    lines.push('', `Points ${recap.totalPoints} · Grade ${recap.grade || '—'} · Rank ${recap.rank ? '#' + recap.rank : '—'}`, '');
    for (const r of recap.rounds) {
      lines.push(`${r.song_title} — ${r.song_artist}: you ${r.taste}, guess ${r.predict == null ? '—' : Number(r.predict).toFixed(1)}, average ${r.room_average == null ? '—' : Number(r.room_average).toFixed(1)} → ${(Number(r.points) || 0) >= 0 ? '+' : ''}${Number(r.points) || 0} (${TIER_LABEL[r.tier] || ''})`);
    }
    if (recap.completionBonus) lines.push(`Completion bonus: +${recap.completionBonus}`);
  }
  lines.push('', `Today's records are open: ${playUrl}`);
  if (manage) lines.push('', notifyFooterText(manage));
  return lines.join('\n');
}

// Queue the digest. ONE broadcast row per day, made idempotent by uniq_broadcast_kind_ref
// (kind='digest_daily', ref_id=<session id>) — a re-run of the publisher finds the existing
// row rather than making a second and mailing everyone twice.
//
// This is notifyAudience()'s FIRST production caller. It returns a {sql, params} fragment
// that ends mid-WHERE, so it composes by string append into an INSERT...SELECT — which
// keeps the fan-out one set-based statement rather than a per-user loop.
//
// ⚠️ toPg() numbers '?' TEXTUALLY, so params bind by position in the FINAL string, not by
// argument order. The broadcast id's '?' appears in the SELECT list, ahead of the audience
// fragment's topic '?' in the FROM/JOIN — hence [bcId, ...a.params] and not the reverse.
// Do not let a later edit move a '?' earlier without re-ordering this array.
//
// NO EXCLUSIONS. Every A&R on the list gets the mail; the personalised block simply renders
// for those who played and is absent for those who didn't. Someone who missed a day is
// exactly who a "today's records are open" CTA is for.
async function enqueueDailyDigest(session) {
  const a = notifyAudience('digest_daily', 'email');
  if (!a) return { broadcastId: null, queued: 0 };
  const day = session.drop_day || etDay(Number(session.window_opens_at) || now());
  const subject = `A&R Daily — ${etDayLabel(day) || 'yesterday'}'s results`;
  // uniq_broadcast_kind_ref is a PARTIAL unique index, and a bare ON CONFLICT (kind, ref_id)
  // does not match one without repeating its predicate — a dialect detail not worth encoding
  // in the statement. Let the index throw and re-read instead: the index is the real guard,
  // exactly as it is for two simultaneous daily pushes racing on uniq_session_drop_day.
  let existing = await db.get(
    "SELECT id FROM notify_broadcasts WHERE kind = 'digest_daily' AND ref_id = ?", [session.id]);
  let bcId = existing ? existing.id : id(9);
  if (!existing) {
    try {
      await db.run(
        `INSERT INTO notify_broadcasts (id, subject, message, channels, created_by, status, created_at, kind, ref_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [bcId, subject, `A&R Daily results for ${day}`, 'email', null, 'sending', now(), 'digest_daily', session.id]);
    } catch (e) { /* another invocation won the index — fall through and adopt its row */ }
    existing = await db.get("SELECT id FROM notify_broadcasts WHERE kind = 'digest_daily' AND ref_id = ?", [session.id]);
    if (!existing) return { broadcastId: null, queued: 0 };
    bcId = existing.id;
  }
  await db.run(
    `INSERT INTO notify_recipients (broadcast_id, uid, channel, dest)
       SELECT ?, u.uid, 'email', u.email
       ${a.sql}
     ON CONFLICT (broadcast_id, uid, channel) DO NOTHING`,
    [bcId, ...a.params]);
  const q = (await db.get("SELECT COUNT(*) AS c FROM notify_recipients WHERE broadcast_id = ? AND status = 'pending'", [bcId])).c;
  return { broadcastId: bcId, queued: Number(q) || 0 };
}

// Send a chunk of the digest.
//
// ⚠️ NO PER-RECIPIENT PNG. recap/process renders and uploads one card per recipient at
// ~1-2s each, which is ~10 sends per 30s invocation and would never finish before the next
// day's drop. The round-by-round breakdown is an HTML table — which reads better than a
// 1080x1440 card at 16 rows anyway — so each send is one sendEmail() at ~200ms, 60-80 per
// tick. This is the single most important efficiency decision in the daily outputs.
async function drainDailyDigest({ sessionId, broadcastId, limit = 40, deadline = null, base = null } = {}) {
  const bc = await db.get('SELECT * FROM notify_broadcasts WHERE id = ?', [broadcastId]);
  if (!bc) return { sent: 0, failed: 0, remaining: 0 };
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  const job = await db.get('SELECT * FROM recap_jobs WHERE session_id = ?', [sessionId]);
  const day = session && session.drop_day;
  const dayLabel = etDayLabel(day);
  const playUrl = (base || publicBase()) + '/';
  const rows = await db.all(
    "SELECT * FROM notify_recipients WHERE broadcast_id = ? AND status = 'pending' LIMIT ?", [broadcastId, limit]);
  let sent = 0, failed = 0;
  for (const r of rows) {
    if (deadline && Date.now() > deadline) break;
    // Claim before sending — the cron can double-invoke and there is no unsend.
    const claim = await db.run(
      "UPDATE notify_recipients SET status = 'sending' WHERE broadcast_id = ? AND uid = ? AND channel = ? AND status = 'pending'",
      [broadcastId, r.uid, r.channel]);
    if (!claim.changes) continue;
    try {
      // The personalised block only exists for A&Rs who actually played this day — which
      // is a participants row in THIS session, not merely a users row.
      const participant = await db.get(
        'SELECT * FROM participants WHERE session_id = ? AND user_id = ? AND verified = 1', [sessionId, r.uid]);
      const recap = participant ? await buildRecap(participant, { detail: true }) : null;
      if (recap) {
        const earned = await db.get(
          "SELECT points FROM point_events WHERE reason = 'async_complete' AND source_uid = ?", [`${sessionId}:${r.uid}`]);
        recap.completionBonus = earned ? Number(earned.points) : null;
      }
      const u = await db.get('SELECT name FROM users WHERE uid = ?', [r.uid]);
      const manage = notifyManageUrl(base || publicBase(), r.uid);
      const arg = { name: (participant && participant.name) || (u && u.name) || null, dayLabel,
        cards: { ars: job && job.ars_url, songs: job && job.songs_url }, recap, manage, playUrl };
      const out = await sendEmail(r.dest, bc.subject || 'A&R Daily',
        dailyDigestEmailHtml(arg), dailyDigestEmailText(arg));
      if (out.ok) { await db.run("UPDATE notify_recipients SET status = 'sent', sent_at = ?, error = NULL WHERE broadcast_id = ? AND uid = ? AND channel = ?", [now(), broadcastId, r.uid, r.channel]); sent++; }
      else { await db.run("UPDATE notify_recipients SET status = 'failed', error = ? WHERE broadcast_id = ? AND uid = ? AND channel = ?", [(out.error || 'send failed').slice(0, 200), broadcastId, r.uid, r.channel]); failed++; }
    } catch (e) {
      await db.run("UPDATE notify_recipients SET status = 'failed', error = ? WHERE broadcast_id = ? AND uid = ? AND channel = ?", [(e.message || 'error').slice(0, 200), broadcastId, r.uid, r.channel]); failed++;
    }
  }
  const remaining = Number((await db.get("SELECT COUNT(*) AS c FROM notify_recipients WHERE broadcast_id = ? AND status = 'pending'", [broadcastId])).c) || 0;
  if (!remaining) await db.run("UPDATE notify_broadcasts SET status = 'done' WHERE id = ?", [broadcastId]);
  return { sent, failed, remaining };
}

// ===== POST-SHOW ARTIST NOTICES =====
// Quiet hours (TCPA): artist SMS only sends 10AM-10:30PM ET. The show ends at 11PM, so a
// text queued at wrap sits pending until the next morning — /api/cron/artist-sms drains
// it. Email has no such window (inboxes are asynchronous by nature).
// The window edge is on a half hour, so the gate works in minutes-of-day, not whole hours.
const SMS_WINDOW_START_MIN = 10 * 60;      // 10:00 AM ET
const SMS_WINDOW_END_MIN = 22 * 60 + 30;   // 10:30 PM ET
const SMS_WINDOW_START_LABEL = '10 AM ET', SMS_WINDOW_END_LABEL = '10:30 PM ET';
function etHourMinute(ts = Date.now()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(ts));
  const num = (t) => parseInt(p.find(x => x.type === t)?.value ?? '', 10);
  // hour12:false can render midnight as "24" depending on ICU — normalize to 0-23.
  const h = num('hour'), m = num('minute');
  return { h: (Number.isFinite(h) ? h : 0) % 24, m: Number.isFinite(m) ? m : 0 };
}
function etHour(ts = Date.now()) { return etHourMinute(ts).h; }
function withinSmsWindow(ts = Date.now()) {
  const { h, m } = etHourMinute(ts);
  const mins = h * 60 + m;
  return mins >= SMS_WINDOW_START_MIN && mins < SMS_WINDOW_END_MIN;
}
// Human "when the queue next moves", for the panel's status line.
function nextSmsWindowLabel(ts = Date.now()) {
  return withinSmsWindow(ts) ? 'sending now' : `holds until ${SMS_WINDOW_START_LABEL}`;
}

// ===== ET DAY ARITHMETIC (A&R Daily) =====
// Everything above answers "what ET time is it NOW". A&R Daily needs the other direction:
// given an ET calendar day and a wall-clock hour, what epoch is that? The drop's whole
// schedule is wall clock — 12PM ET open, 9AM ET close, 12PM ET publish — and the window
// crosses the DST switch twice a year, so deriving the close as "open + 21h" would give an
// 8AM close in spring and a 10AM close in fall. Both ends resolve from wall clock instead.
//
// No tz library (package.json has none, deliberately); Intl is the only primitive.

// Minutes east of UTC for America/New_York at `ts` (always negative here). Derived by
// formatting the instant in ET, reading it back as if it were UTC, and differencing —
// which is DST-correct by construction because Intl did the work.
function etOffsetMinutes(ts) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts));
  const g = (t) => parseInt(p.find(x => x.type === t)?.value ?? '0', 10);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / 60000);
}

// Epoch ms of an ET wall-clock time on an ET calendar day. 'YYYY-MM-DD' + hour (+ minute).
// Two-pass: guess with the offset at the naive instant, then re-read the offset AT that
// guess and correct. One correction is enough — offsets move by at most an hour and never
// twice within a day. THIS is what makes 12:00PM ET mean 12:00PM ET in both March and July.
function etEpoch(day, hh, mm = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '').trim());
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], hh, mm, 0);
  let ts = naive - etOffsetMinutes(naive) * 60000;
  ts = naive - etOffsetMinutes(ts) * 60000;
  return ts;
}

// ET calendar-day arithmetic. Anchored at ET noon so a 23- or 25-hour DST day can never
// push the result onto the wrong date.
function etNextDay(day, n = 1) {
  const base = etEpoch(day, 12);
  if (base == null) return null;
  return chartDay(base + n * 86400000);
}

// chartDay() already renders the ET 'YYYY-MM-DD' (en-CA). Alias rather than write a second
// formatter — two of them that can disagree about what day it is would be a nasty bug.
const etDay = (ts = Date.now()) => chartDay(ts);

// Human labels, rendered SERVER-side and shipped as strings. The player surface never
// converts an epoch to ET wall clock itself: a browser in Lagos would print a different
// deadline than the one the server actually pays out on, and this is a cash-prize board.
function etDayLabel(day) {
  const ts = etEpoch(day, 12);
  if (ts == null) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ts));
}
function etClockLabel(ts) {
  if (!ts) return null;
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(Number(ts)));
  return s + ' ET';
}
// "at 12:00 PM ET tomorrow" — a complete phrase, because whether an instant is today or
// tomorrow is a question about the ET calendar and the browser must not be the one asked.
function etWhenLabel(ts, fromDay) {
  if (!ts) return null;
  const clock = etClockLabel(ts);
  const d = etDay(Number(ts));
  if (!fromDay || d === fromDay) return 'at ' + clock;
  if (d === etNextDay(fromDay)) return 'at ' + clock + ' tomorrow';
  return 'on ' + etDayLabel(d) + ' at ' + clock;
}

// ===== A&R DAILY — the async drop =====
// The daily schedule, as ET minutes-of-day. Defaults, not hardcodes: the drop builder takes
// explicit overrides so a test can run a 60-second window instead of waiting for noon.
const DROP_OPEN_MIN = 12 * 60;      // 12:00 PM ET — the day's records open
const DROP_CLOSE_MIN = 9 * 60;      // 9:00 AM ET next day — rating closes, everything ratifies
const DROP_PUBLISH_MIN = 12 * 60;   // 12:00 PM ET next day — results publish
// A day is 4 random free records plus UP TO 12 paid, so its size is VARIABLE (4-16) and only
// reaches 16 when the paid queue is full or backlogged. This is a sanity ceiling on a bad
// push, not the expected count — nothing may treat 16 as given.
const DROP_MAX_SONGS = 24;
// Only guards a 1-2 record day (a mis-push, or a dry free pool) from paying a full completion
// bonus. Deliberately NOT near the typical day size: a floor of 8 would silently withhold the
// bonus on exactly the thin days when the pool needs the participation most.
const ASYNC_MIN_FOR_BONUS = 3;

const isAsync = (s) => !!s && s.mode === 'async';

// A&R Daily has no per-round host controls. The day's records open together, close together
// and ratify together, on the clock — so every one of open / reopen / start-voting / unopen /
// close / extend / ratify would act on ONE arbitrary record of a day that has many open at
// once. Two of them are worse than merely wrong: per-round /ratify fires a series-board
// recompute AND an Ably publish per call (the exact cost the batched tally exists to avoid),
// and /extend would move one record's clock while the session window governs the rest.
// Returns true when it has already answered the request.
function refuseOnDrop(res, session) {
  if (!isAsync(session)) return false;
  bad(res, 'A&R Daily runs on the clock — records are not opened, closed or tallied one at a time', 409);
  return true;
}

// The completion-bonus tier, anchored to the DROP DAY's absolute epochs. NOT minutes-of-day:
// the window crosses midnight, so an A&R who finishes at 2:00 AM is 120 minutes into the ET
// clock and a minutes-of-day comparison would read that as "before 3PM" and pay 100 instead
// of 25. Callers pass the A&R's LAST VOTE time, not now() — see maybeAwardCompletionBonus.
function completionBonusPoints(session, ts) {
  const d = session && session.drop_day;
  if (!d) return 25;
  if (ts < etEpoch(d, 15)) return 100;
  if (ts < etEpoch(d, 18)) return 75;
  if (ts < etEpoch(d, 21)) return 50;
  return 25;   // any time before the close; the close itself is the vote guard's job
}

// The play link IS the product on an async day — the A&R listens here, not on a stream.
// Same http(s)-only discipline as cleanUrl (a javascript: value is XSS wherever it renders),
// but deliberately NOT host-allowlisted: the operator will use a CDN mp3 one day and a
// Spotify link the next, and an allowlist would reject tomorrow's host as broken.
const cleanPlayUrl = (u) => cleanUrl(u);

// A deterministic running order per A&R, so no two people walk the day's records in the same
// sequence — but the SAME person always gets the SAME order, on any device, forever. Pure
// function of (seedKey, sessionId): nothing is stored, so resume is free and there is no
// cursor to go stale when a round is deleted or a second tab votes.
//
// Why it matters beyond novelty: with a fixed order, drop-off concentrates on whatever sits
// at the end of the list, so the last record of the day would draw a fraction of the first's
// votes every single day. Shuffling per A&R spreads that evenly.
//
// SHA-256 in counter mode rather than a seeded PRNG: an LCG or xorshift is a promise about a
// specific implementation, and this order has to survive Node upgrades. SHA-256 is a spec.
// Rejection sampling keeps the shuffle unbiased (a bare `% bound` is not).
// Validate + normalize one song from the daily push. Returns { rec } or { err }.
// ALL-OR-NOTHING at the caller: the operator approved a specific set in Drupal and is looking
// at that page, so a red error they can act on beats silently creating a short day that nobody
// notices until noon.
function normalizeDropSong(raw, i) {
  const clip = (s, n) => (s == null ? '' : String(s)).trim().slice(0, n);
  const title = clip(raw && raw.title, 200);
  if (!title) return { err: { index: i, field: 'title', reason: 'required' } };
  // A record with no play link is unratable for the whole window — and a day of them is a
  // dead day. This is the one field that is fatal beyond the title.
  const playUrl = cleanPlayUrl(raw.playUrl || raw.play_url);
  if (!playUrl) return { err: { index: i, field: 'playUrl', reason: 'required, must be http(s)' } };
  return { rec: {
    ref: clip(raw.ref, 100) || null,
    url: cleanUrl(raw.url),
    title,
    artist: clip(raw.artist, 200),
    instagram: clip((raw.instagram || '').toString().replace(/^@+/, ''), 60) || null,
    profileUrl: cleanUrl(raw.profileUrl || raw.profile_url),
    // Unusable contact nulls out and is NOT fatal — matches /api/ingest/submission. The
    // artist just doesn't get a report; the caller surfaces it as a warning so Drupal can flag it.
    email: cleanArtistEmail(raw.email),
    phone: cleanArtistPhone(raw.phone),
    note: clip(raw.note ?? raw.ask, 500) || null,
    playUrl,
    scoutUid: clip(raw.scout && raw.scout.uid, 60) || null,
    scoutEmail: cleanArtistEmail(raw.scout && raw.scout.email),
  } };
}

// A drop MUST be tagged into a series or its points never reach the $500 board — the whole
// unification premise, failing silently. Explicit -> the active series -> refuse. One rule,
// shared by the batch push and the hand-built queue, so they can never disagree about what
// a valid day is.
async function resolveDropSeries(explicitId) {
  const want = (explicitId || '').toString().trim() || null;
  if (want) {
    const ser = await db.get('SELECT id FROM series WHERE id = ?', [want]);
    return ser ? { seriesId: ser.id } : { error: 'Unknown seriesId' };
  }
  const active = await db.get("SELECT id FROM series WHERE status = 'active' ORDER BY created_at DESC LIMIT 1", []);
  if (active) return { seriesId: active.id };
  return { error: 'No active series — a drop with no series tag earns nothing on the board', status: 409 };
}

// Stage a day. ONE IMPLEMENTATION, TWO CALLERS — the advanceRoom discipline, again.
// Drupal pushes the approved set over /api/ingest/daily with its own secret; the operator
// stages one by hand over /api/admin/daily/drop when Drupal is down, when a day needs
// rebuilding, or to try the whole thing on a preview deployment. Identical validation and
// identical idempotency both ways: a hand-staged day must not be able to do anything the
// pushed one cannot, or the two paths start disagreeing about what a valid day is.
//
// Callers do their own auth and then hand the parsed body straight here.
async function stageDailyDrop(res, body) {
  const day = (body.day || etDay()).toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, 'day must be YYYY-MM-DD');
  // ±2 days of ET today: catches a typo that would otherwise create a drop in 2027 and sit
  // invisible until it opened.
  const dayTs = etEpoch(day, 12);
  if (dayTs == null || Math.abs(dayTs - now()) > 3 * 86400000) return bad(res, 'day is too far from today');

  const songs = Array.isArray(body.songs) ? body.songs : null;
  if (!songs || !songs.length) return bad(res, 'songs[] required');
  if (songs.length > DROP_MAX_SONGS) return bad(res, `too many songs (max ${DROP_MAX_SONGS})`);

  // ALL-OR-NOTHING. A silently-short day is worse than an error the operator can act on.
  const recs = [], rejected = [], warnings = [], seenRef = new Set();
  songs.forEach((raw, i) => {
    const { rec, err } = normalizeDropSong(raw, i);
    if (err) return rejected.push(err);
    if (rec.ref && seenRef.has(rec.ref)) return rejected.push({ index: i, field: 'ref', reason: 'duplicate in batch' });
    if (rec.ref) seenRef.add(rec.ref);
    if (raw.email && !rec.email) warnings.push({ index: i, field: 'email', reason: 'unusable' });
    if (raw.phone && !rec.phone) warnings.push({ index: i, field: 'phone', reason: 'unusable' });
    recs.push(rec);
  });
  if (rejected.length) return send(res, 400, { error: 'Batch rejected', rejected });

  // Link each scout's Makin' It identity to their A&R Team account while we still have the
  // email. Best-effort and non-fatal: scout_drupal_uid is stored on the round REGARDLESS,
  // because Drupal's own ambassador and promo reporting reads it and must not depend on us
  // having resolved the person. An unlinked scout simply earns no points yet.
  for (const r of recs) {
    if (r.scoutUid) { try { await linkScout(r.scoutUid, r.scoutEmail); } catch (e) { console.error('[scout] link failed:', e.message); } }
  }

  const ser = await resolveDropSeries(body.seriesId);
  if (ser.error) return bad(res, ser.error, ser.status || 400);
  const seriesId = ser.seriesId;

  const existing = await db.get('SELECT * FROM sessions WHERE drop_day = ? AND deleted_at IS NULL', [day]);
  if (existing) {
    const voted = (await db.get(
      'SELECT COUNT(*) AS c FROM votes v JOIN rounds r ON r.id = v.round_id WHERE r.session_id = ?', [existing.id])).c;
    const started = existing.status !== 'upcoming' || (existing.async_state && existing.async_state !== 'scheduled');
    if (Number(voted) > 0 || started) {
      return send(res, 409, { error: "Today's drop is already in play", sessionId: existing.id, votes: Number(voted) });
    }
    // Cold and unplayed: replace the record set in place (newest push wins, the same rule
    // 031/032 apply to a single staged record — here applied to the batch).
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM rounds WHERE session_id = ?', [existing.id]);
      let i = 0;
      for (const s of recs) {
        i++;
        await tx.run(
          `INSERT INTO rounds (id, session_id, idx, queue_pos, poll_type, song_title, song_artist, song_note,
             giveaway, artist_email, artist_phone, artist_note, play_url, artist_instagram,
             artist_profile_url, ingest_ref, ingest_url, scout_drupal_uid, status, opens_at, closes_at, created_at)
           VALUES (?,?,?,?, 'rating', ?,?,?, '', ?,?,?,?,?,?,?,?,?, 'pending', ?,?,?)`,
          [id(9), existing.id, i, i, s.title, s.artist || '', s.instagram ? ('IG: @' + s.instagram) : '',
           s.email, s.phone, s.note, s.playUrl, s.instagram, s.profileUrl, s.ref, s.url, s.scoutUid,
           existing.window_opens_at, existing.window_closes_at, now()]);
      }
      if (seriesId && !existing.series_id) await tx.run('UPDATE sessions SET series_id = ? WHERE id = ?', [seriesId, existing.id]);
    });
    // Echo titles only — never the emails or phones back out (they came in over this wire,
    // that doesn't make them safe to reflect).
    return send(res, 200, { ok: true, replaced: true, sessionId: existing.id, day,
      rounds: recs.length, seriesId: seriesId || existing.series_id || null, warnings });
  }

  let out;
  try {
    out = await createAsyncDrop({ day, name: body.name, seriesId, songs: recs,
      opensAt: body.opensAt, closesAt: body.closesAt, resultsAt: body.resultsAt });
  } catch (e) {
    // The partial unique index on drop_day is the REAL guard: two simultaneous pushes race
    // on the constraint, not on the SELECT above, and the loser lands here.
    if (/unique|duplicate/i.test(e.message || '')) {
      return send(res, 409, { error: "A drop already exists for that day" });
    }
    throw e;
  }
  return send(res, 200, { ok: true, replaced: false, ...out, seriesId, warnings });
}

// Build one day of A&R Daily from the approved batch Drupal pushes.
//
// The day is VARIABLE in size — 4 random free records plus up to 12 paid — so nothing here
// assumes 16. idx is assigned AT INSERT (1..n) from the batch order, unlike a live show where
// advanceRoom() assigns it at open: with every record opening at once there is no "open time"
// to number from, and the per-A&R shuffle is a read-time concern that never touches idx.
//
// Rounds are created 'pending'; the lifecycle cron flips them all to 'voting' in one statement
// at the open. Ingest stays dumb and the open stays atomic.
async function createAsyncDrop({ day, name, seriesId, songs, opensAt, closesAt, resultsAt }) {
  const wo = opensAt != null ? Number(opensAt) : etEpoch(day, DROP_OPEN_MIN / 60, DROP_OPEN_MIN % 60);
  const nextDay = etNextDay(day);
  const wc = closesAt != null ? Number(closesAt) : etEpoch(nextDay, DROP_CLOSE_MIN / 60, DROP_CLOSE_MIN % 60);
  const rp = resultsAt != null ? Number(resultsAt) : etEpoch(nextDay, DROP_PUBLISH_MIN / 60, DROP_PUBLISH_MIN % 60);
  const sid = id(9), ts = now();
  await db.tx(async (tx) => {
    await tx.run(
      `INSERT INTO sessions (id, name, admin_token, owner_uid, status, mode, drop_day, async_state,
         window_opens_at, window_closes_at, results_at, scheduled_at, default_minutes, poll_type,
         series_id, ingest_auto, created_at)
       VALUES (?,?,?,?, 'upcoming', 'async', ?, 'scheduled', ?,?,?,?, 5, 'rating', ?, 0, ?)`,
      // owner_uid NULL is deliberate: canAdminSession then admits only a platform admin, and
      // this batch carries every artist's email and phone. Same reasoning that tightened
      // /api/admin/ingest/latest.
      [sid, name || `A&R Daily — ${day}`, id(12), null, day, wo, wc, rp, wo, seriesId || null, ts]);
    let i = 0;
    for (const s of songs) {
      i++;
      await tx.run(
        `INSERT INTO rounds (id, session_id, idx, queue_pos, poll_type, song_title, song_artist, song_note,
           giveaway, artist_email, artist_phone, artist_note, play_url, artist_instagram,
           artist_profile_url, ingest_ref, ingest_url, scout_drupal_uid, status, opens_at, closes_at, created_at)
         VALUES (?,?,?,?, 'rating', ?,?,?, '', ?,?,?,?,?,?,?,?,?, 'pending', ?,?,?)`,
        [id(9), sid, i, i, s.title, s.artist || '', s.instagram ? ('IG: @' + s.instagram) : '',
         s.email, s.phone, s.note, s.playUrl, s.instagram, s.profileUrl, s.ref, s.url, s.scoutUid, wo, wc, ts]);
    }
  });
  return { sessionId: sid, day, rounds: songs.length, opensAt: wo, closesAt: wc, resultsAt: rp };
}

// Append one record to a day that has not opened yet. Deliberately the SAME insert as
// createAsyncDrop's loop — if the two ever drift, a hand-built day and a pushed one stop
// being the same kind of thing.
//
// idx is MAX+1 rather than a count, so deleting a record and adding another cannot hand out
// a number that is already on the day.
async function addDropRound(session, s) {
  const ts = now();
  const top = await db.get('SELECT COALESCE(MAX(idx), 0) AS n FROM rounds WHERE session_id = ?', [session.id]);
  const idx = Number(top.n) + 1;
  if (idx > DROP_MAX_SONGS) {
    return { ok: false, error: `A day holds at most ${DROP_MAX_SONGS} records`, rounds: idx - 1 };
  }
  const rid = id(9);
  await db.run(
    `INSERT INTO rounds (id, session_id, idx, queue_pos, poll_type, song_title, song_artist, song_note,
       giveaway, artist_email, artist_phone, artist_note, play_url, artist_instagram,
       artist_profile_url, ingest_ref, ingest_url, scout_drupal_uid, status, opens_at, closes_at, created_at)
     VALUES (?,?,?,?, 'rating', ?,?,?, '', ?,?,?,?,?,?,?,?,?, 'pending', ?,?,?)`,
    [rid, session.id, idx, idx, s.title, s.artist || '', s.instagram ? ('IG: @' + s.instagram) : '',
     s.email, s.phone, s.note, s.playUrl, s.instagram, s.profileUrl, s.ref, s.url, s.scoutUid,
     session.window_opens_at, session.window_closes_at, ts]);
  const n = Number((await db.get('SELECT COUNT(*) AS c FROM rounds WHERE session_id = ?', [session.id])).c) || 0;
  return { ok: true, created: false, sessionId: session.id, day: session.drop_day, roundId: rid, idx, rounds: n };
}

function asyncQueueOrder(seedKey, sessionId, rounds) {
  const arr = (rounds || []).slice().sort((a, b) =>
    (Number(a.idx) - Number(b.idx)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (arr.length < 2) return arr;
  const seed = crypto.createHash('sha256').update(`${seedKey}|${sessionId}`).digest();
  let pool = Buffer.alloc(0), ctr = 0;
  const next32 = () => {
    if (pool.length < 4) {
      const c = Buffer.alloc(4); c.writeUInt32BE(ctr++, 0);
      pool = crypto.createHash('sha256').update(seed).update(c).digest();  // 32 bytes = 8 draws
    }
    const v = pool.readUInt32BE(0); pool = pool.subarray(4); return v;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const bound = i + 1;
    const limit = Math.floor(0x100000000 / bound) * bound;
    let r; do { r = next32(); } while (r >= limit);
    const j = r % bound;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const artistEmailText = (d) => `Your record was evaluated live — ${d.title}\n\n`
  + `"${d.title}"${d.artist ? ' by ' + d.artist : ''} was evaluated by The A&R Room on ${d.dateLabel}. `
  + `It earned a final room score of ${d.mean} and ranked #${d.rank} of ${d.total} records evaluated in the session.\n\n`
  + (d.watchUrl ? `Watch the evaluation: ${d.watchUrl}\n\n` : '')
  + artistCommentsText(d.comments)
  + `Your Official Room Report is attached as three images. Share them as one Instagram carousel, `
  + `add @Makinit4indies as a collaborator, and tag #TheARRoom.\n\n`
  + `Submit another record for consideration: https://makinitmag.com/review`;

// The artist's post-show email: full 3-page report card + the replay link + post instructions.
// Deliberately carries NO price or upsell — the operator's call: visibility first
// (see the postshow-artist-workflow memory).
// Approved A&R comments, rendered for the artist. Attribution is the whole point — these
// are named people who scored the record, not anonymous internet opinion — so each quote
// carries display name + role + city, the same PII surface as the public boards.
// Only 'shared' rows ever reach here; the host approves every one by hand.
function artistCommentsHtml(comments) {
  if (!comments || !comments.length) return '';
  const quotes = comments.map(c => {
    const meta = [c.role, c.location].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div style="background:#171328;border:1px solid #2e2750;border-left:3px solid #4bb749;border-radius:0 12px 12px 0;padding:14px 15px;margin-bottom:11px;text-align:left">
        <div style="font-size:14.5px;line-height:1.55;color:#f3f0fb">“${escapeHtml(c.body)}”</div>
        <div style="font-size:12.5px;font-weight:700;color:#f3f0fb;margin-top:10px">${escapeHtml(c.name)}</div>
        ${meta ? `<div style="font-size:12px;color:#8c84ad;margin-top:1px">${meta}</div>` : ''}
      </div>`;
  }).join('');
  return `<div style="margin:22px 0 4px">
      <div style="font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#8c84ad">From the room</div>
      <div style="font-size:19px;font-weight:700;margin:8px 0 4px">What the A&amp;Rs said</div>
      <p style="font-size:13.5px;line-height:1.5;color:#a9a2c9;margin:0 0 16px">Selected comments from the A&amp;Rs who rated your record live.</p>
      ${quotes}
      <p style="font-size:12px;line-height:1.5;color:#8c84ad;margin:14px 0 0">Comments are the personal opinions of individual A&amp;Rs, selected by the host. Not every A&amp;R left one.</p>
    </div>`;
}
const artistCommentsText = (comments) => (!comments || !comments.length) ? ''
  : `What the A&Rs said\n\n`
    + comments.map(c => `"${c.body}"\n— ${c.name}${[c.role, c.location].filter(Boolean).length ? ' (' + [c.role, c.location].filter(Boolean).join(', ') + ')' : ''}`).join('\n\n')
    + `\n\nComments are the personal opinions of individual A&Rs, selected by the host.\n\n`;

function artistEmailHtml({ title, artist, mean, rank, total, dateLabel, sessionName, watchUrl, pages, comments }) {
  const pageBlock = pages.filter(Boolean).map((u, i) =>
    `<a href="${u}" style="text-decoration:none"><img src="${u}" alt="Report page ${i + 1}" width="320" style="width:320px;max-width:100%;border-radius:14px;display:block;margin:0 auto 14px;border:1px solid #2e2750"></a>`
  ).join('');
  const watchBlock = watchUrl ? `
      <a href="${watchUrl}" style="display:block;background:#4bb749;color:#07130a;font-weight:700;font-size:15px;border-radius:12px;padding:14px 16px;text-decoration:none;margin:4px 0 8px">▶ Watch the room evaluate your record</a>
      <p style="font-size:12.5px;line-height:1.55;color:#a9a2c9;margin:0 0 18px">Go to your record in the replay to hear the room's live response. Short clips can help you share the evaluation in context.</p>` : '';
  return `<div style="background:#0d0b16;padding:26px 16px;font-family:'DM Sans',system-ui,sans-serif;color:#f3f0fb">
    <div style="max-width:360px;margin:0 auto;text-align:center">
      <div style="font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#a9a2c9">The A&amp;R Room</div>
      <h1 style="font-size:22px;margin:8px 0 4px">Your record was evaluated live${artist ? ', ' + escapeHtml(String(artist).split(/\s+/)[0]) : ''}.</h1>
      <p style="font-size:15px;line-height:1.5;color:#a9a2c9;margin:0 0 18px"><b style="color:#f3f0fb">“${escapeHtml(title)}”</b> was evaluated by The A&amp;R Room on <b style="color:#f3f0fb">${escapeHtml(dateLabel)}</b>. Your Official Room Report is ready.</p>
      <div style="background:#171328;border:1px solid #2e2750;border-radius:14px;padding:18px 16px;margin-bottom:16px">
        <div style="font-weight:700;font-size:17px">${escapeHtml(title)}</div>
        ${artist ? `<div style="font-size:13px;color:#a9a2c9;margin-top:2px">${escapeHtml(artist)}</div>` : ''}
        <div style="font-family:'Space Mono',monospace;font-size:44px;font-weight:700;color:#4bb749;line-height:1.1;margin-top:10px">${escapeHtml(mean)}</div>
        <div style="font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6f688f">final room score · out of 9</div>
        ${total > 1 ? `<div style="font-size:13px;color:#a9a2c9;margin-top:8px">Ranked <b style="color:#f3f0fb">#${rank} of ${total}</b> records evaluated in the session</div>` : ''}
      </div>
      ${pageBlock}
      ${watchBlock}
      ${artistCommentsHtml(comments)}
      <div style="background:#171328;border:1px solid #6d5fe0;border-radius:14px;padding:16px;text-align:left">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px">📲 Share your Official Room Report</div>
        <div style="font-size:13px;line-height:1.6;color:#a9a2c9">Share all three report pages as one Instagram <b style="color:#f3f0fb">carousel</b>. Add <b style="color:#f3f0fb">@Makinit4indies</b> as a <b>collaborator</b> and tag us with <b style="color:#f3f0fb">#TheARRoom</b>.</div>
      </div>
      <p style="font-size:13px;color:#6f688f;margin:20px 0 0">Submit another record for consideration → <a href="https://makinitmag.com/review" style="color:#4bb749;text-decoration:none">makinitmag.com/review</a></p>
    </div>
  </div>`;
}

// Rounds eligible for an artist notice: ratified RATING rounds with votes (a Song Report
// needs a room average — Versus rounds have a split, not an average) and some contact.
const ARTIST_ELIGIBLE_SQL = `
  SELECT r.* FROM rounds r
   WHERE r.session_id = ? AND r.status = 'ratified' AND r.room_average IS NOT NULL
     AND COALESCE(r.poll_type,'rating') <> 'binary'
     AND EXISTS (SELECT 1 FROM votes v WHERE v.round_id = r.id AND v.taste IS NOT NULL)
   ORDER BY r.idx ASC`;

// Render + host this round's report pages, then mail them to the artist. Returns the
// hosted page URLs so the queue row can record exactly what was delivered.
// Page 3 (segments) needs 8+ votes — same floor the host-facing report enforces, so a
// small room never decomposes into near-individual scores.
async function sendArtistReportEmail(round, session, dest) {
  const d = await songReportData(round, session);
  if (!d) return { ok: false, error: 'No eligible evaluations to report' };
  const pageCount = d.votes >= 8 ? 3 : 2;
  const pages = [];
  for (let i = 1; i <= pageCount; i++) {
    const buf = await shareCards.renderPng('report' + i, i === 1 ? d : { ...d, sub: d.sub23 });
    pages.push(await uploadPng(`artist/${session.id}/${round.id}-p${i}.png`, buf));
  }
  // Host-approved comments only. A blocked account's comment is dropped here for the same
  // reason its votes are excluded from every board.
  const commentRows = await db.all(
    `SELECT c.body, p.name AS pname, u.name AS uname, u.primary_category, u.location
       FROM round_comments c
       JOIN participants p ON p.id = c.participant_id
       LEFT JOIN users u ON u.uid = p.user_id
      WHERE c.round_id = ? AND c.status = 'shared' AND COALESCE(u.blocked, 0) = 0
      ORDER BY c.created_at ASC`, [round.id]);
  const comments = commentRows.map(r => ({
    body: r.body,
    name: (r.uname || r.pname || 'A&R').toString().trim().slice(0, 40),
    role: r.primary_category || null,
    location: r.location || null,
  }));
  const html = artistEmailHtml({
    title: round.song_title || 'Your record', artist: round.song_artist || '',
    mean: d.mean, rank: d.rankInRoom ? d.rankInRoom.rank : 1, total: d.rankInRoom ? d.rankInRoom.total : 1,
    dateLabel: d.dateLabel, sessionName: session.name, watchUrl: session.watch_url || null, pages, comments,
  });
  const text = artistEmailText({
    title: round.song_title || 'Your record', artist: round.song_artist || '', mean: d.mean,
    rank: d.rankInRoom ? d.rankInRoom.rank : 1, total: d.rankInRoom ? d.rankInRoom.total : 1,
    dateLabel: d.dateLabel, watchUrl: session.watch_url || null, comments,
  });
  const r = await sendEmail(dest, `Official Room Report: “${round.song_title || 'your song'}” scored ${d.mean}`, html, text);
  return r.ok ? { ok: true, pages } : { ok: false, error: r.error };
}

// Drain pending artist SMS — optionally scoped to one round (a per-round resend), one
// session (host-triggered at wrap), or across all of them (cron). A no-op outside the ET
// window: the rows simply stay pending and the cron gets them in the morning.
async function drainArtistSms({ sessionId = null, roundId = null, limit = 10 } = {}) {
  if (!withinSmsWindow()) return { sent: 0, failed: 0, held: true };
  const rows = roundId
    ? await db.all("SELECT * FROM artist_notices WHERE round_id = ? AND status = 'pending' AND channel = 'sms'", [roundId])
    : sessionId
    ? await db.all("SELECT * FROM artist_notices WHERE session_id = ? AND status = 'pending' AND channel = 'sms' ORDER BY created_at ASC LIMIT ?", [sessionId, limit])
    : await db.all("SELECT * FROM artist_notices WHERE status = 'pending' AND channel = 'sms' ORDER BY created_at ASC LIMIT ?", [limit]);
  let sent = 0, failed = 0;
  for (const row of rows) {
    // CLAIM the row before sending. Vercel states cron delivery "can occasionally invoke the
    // same scheduled run more than once", and the hourly cron overlaps the host's own
    // wrap-up drain — without this, two runs both read the row as pending and the artist
    // gets the same text twice. The conditional UPDATE makes exactly one run win.
    const claim = await db.run("UPDATE artist_notices SET status = 'sending' WHERE id = ? AND status = 'pending'", [row.id]);
    if (!claim.changes) continue; // another run already took it
    try {
      const round = await db.get('SELECT song_title FROM rounds WHERE id = ?', [row.round_id]);
      const title = (round && round.song_title) || 'your record';
      const body = `🎧 The A&R Room: "${title}" was evaluated live. Your Official Room Report is in your email. Reply STOP to opt out.`;
      const r = await sendSms(row.dest, body);
      if (r.ok) { await db.run("UPDATE artist_notices SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", [now(), row.id]); sent++; }
      else { await db.run("UPDATE artist_notices SET status = 'failed', error = ? WHERE id = ?", [(r.error || 'send failed').slice(0, 300), row.id]); failed++; }
    } catch (e) {
      // Unknown outcome: park it as failed (visible in the panel) rather than pending —
      // re-queuing a row we may already have sent is the one thing worse than not sending.
      await db.run("UPDATE artist_notices SET status = 'failed', error = ? WHERE id = ?", [(e.message || 'error').slice(0, 300), row.id]); failed++;
    }
  }
  return { sent, failed, held: false };
}

// Enqueue one email + one SMS per eligible round that has contact info. Idempotent:
// re-running after a retroactive contact edit enqueues only the newly-reachable rounds
// (uniq_artist_notice + DO NOTHING), so nobody is double-mailed.
//
// ONE IMPLEMENTATION, TWO CALLERS — the advanceRoom discipline. The host presses a button
// at wrap-up on a live show; A&R Daily's publisher calls it from the cron. Nothing about
// the artist's mail changes between the two: it is the same template, the same queue and
// the same 026 shape. Only the trigger differs.
async function enqueueArtistNotices(sessionId) {
  const rounds = await db.all(ARTIST_ELIGIBLE_SQL, [sessionId]);
  let queuedEmail = 0, queuedSms = 0;
  for (const r of rounds) {
    const em = (r.artist_email || '').trim(), ph = (r.artist_phone || '').trim();
    if (em) {
      const ins = await db.run("INSERT INTO artist_notices (id, session_id, round_id, channel, dest, status, created_at) VALUES (?,?,?, 'email', ?, 'pending', ?) ON CONFLICT (round_id, channel) DO NOTHING",
        [id(12), sessionId, r.id, em, now()]);
      if (ins && ins.changes) queuedEmail++;
    }
    if (ph) {
      const ins = await db.run("INSERT INTO artist_notices (id, session_id, round_id, channel, dest, status, created_at) VALUES (?,?,?, 'sms', ?, 'pending', ?) ON CONFLICT (round_id, channel) DO NOTHING",
        [id(12), sessionId, r.id, ph, now()]);
      if (ins && ins.changes) queuedSms++;
    }
  }
  return { queuedEmail, queuedSms };
}

// The email half of the artist queue, with a CLAIM — the sibling of drainArtistSms.
//
// It had none: tolerable while a human clicked the button, a double-send bug the moment a
// cron drives it, and there is no unsend. Two invocations of the same scheduled run would
// both read a row as pending and mail the artist their report twice. The conditional
// UPDATE makes exactly one win. Extracting it fixes that for the existing route too.
async function drainArtistEmail({ sessionId = null, limit = 4, deadline = null } = {}) {
  const rows = sessionId
    ? await db.all("SELECT * FROM artist_notices WHERE session_id = ? AND status = 'pending' AND channel = 'email' ORDER BY created_at ASC LIMIT ?", [sessionId, limit])
    : await db.all("SELECT * FROM artist_notices WHERE status = 'pending' AND channel = 'email' ORDER BY created_at ASC LIMIT ?", [limit]);
  let sent = 0, failed = 0;
  for (const row of rows) {
    // Each of these renders and uploads 2-3 report PNGs at ~3-6s, so the budget is checked
    // per item rather than per batch.
    if (deadline && Date.now() > deadline) break;
    const claim = await db.run("UPDATE artist_notices SET status = 'sending' WHERE id = ? AND status = 'pending'", [row.id]);
    if (!claim.changes) continue;
    try {
      const session = await db.get('SELECT * FROM sessions WHERE id = ?', [row.session_id]);
      const round = await db.get('SELECT * FROM rounds WHERE id = ?', [row.round_id]);
      const out = await sendArtistReportEmail(round, session, row.dest);
      if (out.ok) { await db.run("UPDATE artist_notices SET status = 'sent', report_urls = ?, sent_at = ?, error = NULL WHERE id = ?", [JSON.stringify(out.pages), now(), row.id]); sent++; }
      else { await db.run("UPDATE artist_notices SET status = 'failed', error = ? WHERE id = ?", [(out.error || 'send failed').slice(0, 300), row.id]); failed++; }
    } catch (e) {
      // Unknown outcome parks as failed (visible in the panel) rather than back to pending:
      // re-queuing a row we may already have sent is the one thing worse than not sending.
      await db.run("UPDATE artist_notices SET status = 'failed', error = ? WHERE id = ?", [(e.message || 'error').slice(0, 300), row.id]); failed++;
    }
  }
  return { sent, failed };
}

// ===== ASANA POST KIT =====
// One task per show carrying the night's graphics + a caption that tags everyone, so the
// social post is assembled by the time the operator sits down to make it.
// Token lives in ASANA_TOKEN (env) — same shape as INGEST_TOKEN/ANALYTICS_TOKEN/Blob, and
// deliberately NOT the settings table: a PAT there would be echoed back by the platform
// GET to every admin. The project gid is not a secret and does live in settings.
const ASANA_API = 'https://app.asana.com/api/1.0';
async function asanaFetch(path, opts = {}) {
  const token = process.env.ASANA_TOKEN;
  if (!token) throw new Error('Asana not configured (set ASANA_TOKEN)');
  const r = await fetch(ASANA_API + path, {
    ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const body = await r.text();
  if (!r.ok) {
    let msg = `Asana ${r.status}`;
    try { const j = JSON.parse(body); if (j.errors && j.errors[0]) msg += ': ' + j.errors[0].message; } catch (e) {}
    throw new Error(msg);
  }
  try { return JSON.parse(body); } catch (e) { return {}; }
}

// The caption: 8 A&R handles + 8 artist handles + the top record. Falls back to display
// names when someone has no IG on file, so the operator always sees who's missing a tag.
async function postKitCaption(sessionId, ars, songs) {
  const handle = (x) => (x.ig ? '@' + x.ig : (x.name || x.artist || '').trim()).trim();
  const arLine = ars.map(handle).filter(Boolean).join(' ');
  const songLine = songs.map(handle).filter(Boolean).join(' ');
  const top = songs[0];
  const lines = [];
  if (arLine) lines.push(`🏆 Top 8 A&Rs: ${arLine}`);
  if (songLine) lines.push(`🎧 Top 8 Records: ${songLine}`);
  if (top) lines.push(`Top-rated record of the session: “${top.title}”${top.artist ? ' — ' + top.artist : ''} (${Number(top.score).toFixed(1)})`);
  lines.push('#TheARRoom @Makinit4indies');
  return lines.join('\n');
}

// The night's (or the day's) graphics + the caption, as bytes in memory. One implementation
// so the Asana route and A&R Daily's publisher can never assemble different post kits.
// Returns null when there is nothing worth posting.
//
// Manual posting is the answer here, plainly: the Meta Graph API needs an IG Business
// account, App Review for instagram_content_publish and a 60-day token refresh cycle, which
// is precisely the infrastructure this project does not want to babysit. The operator gets a
// task with the PNGs attached and a paste-ready caption.
async function buildPostKit(session) {
  const sessionId = session.id;
  const ars = await cardArsData({ sessionId });
  const songs = session.poll_type === 'binary' ? [] : await cardSongsData(sessionId);
  if (!ars.length && !songs.length) return null;
  const files = [];
  if (ars.length) files.push({ name: 'top8-ars.png', kind: 'ars', buf: await shareCards.renderPng('ars', { list: ars, session: session.name }) });
  if (songs.length) files.push({ name: 'top8-songs.png', kind: 'songs', buf: await shareCards.renderPng('songs', { list: songs, session: session.name }) });
  // The top record's report cards — highest room average of the session.
  const topRound = await db.get(
    `SELECT * FROM rounds WHERE session_id = ? AND status = 'ratified' AND room_average IS NOT NULL
       AND COALESCE(poll_type,'rating') <> 'binary' ORDER BY room_average DESC, idx ASC LIMIT 1`, [sessionId]);
  if (topRound) {
    const d = await songReportData(topRound, session);
    if (d) {
      const pageCount = d.votes >= 8 ? 3 : 2; // page 3 needs 8+ votes (same floor as the report)
      for (let i = 1; i <= pageCount; i++) {
        files.push({ name: `top-record-p${i}.png`, kind: 'report' + i, buf: await shareCards.renderPng('report' + i, i === 1 ? d : { ...d, sub: d.sub23 }) });
      }
    }
  }
  return { files, caption: await postKitCaption(sessionId, ars, songs), ars, songs };
}

async function adminState(session, opts = {}) {
  // Hosts (non-admin owners) see engagement — names, points, counts, socials — but NEVER
  // contact PII (email/phone). Only the platform admin (Makin' It) sees emails.
  const isAdmin = !!(opts.viewer && opts.viewer.role === 'admin');
  const sessionId = session.id;
  const pollType = session.poll_type === 'binary' ? 'binary' : 'rating'; // session default/hint
  const participants = await db.all(`
    SELECT p.id, p.name, p.email, p.verified, p.total_points, p.referred_by, p.pool, p.checkin_distance,
           u.instagram, u.tiktok,
           (SELECT COUNT(*) FROM participants c WHERE c.session_id = p.session_id AND c.referred_by = p.id AND c.ref_credited = 1) AS brought
    FROM participants p LEFT JOIN users u ON u.uid = p.user_id
    WHERE p.session_id = ? ORDER BY p.total_points DESC, p.created_at ASC`, [sessionId]);
  const rounds = await db.all('SELECT * FROM rounds WHERE session_id = ? ORDER BY idx ASC', [sessionId]);
  const round = await activeRound(sessionId);
  // Live console follows the CURRENT round's poll type, not the session default.
  const isBinary = (round ? (round.poll_type || pollType) : pollType) === 'binary';
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
      visibility: session.visibility || 'public', access_code: session.access_code || null,
      ingest_auto: (session.ingest_auto === 1 || session.ingest_auto === true) ? 1 : 0,
      scheduled_at: session.scheduled_at ? Number(session.scheduled_at) : null,
      series_id: session.series_id || null },
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
// Request-free flavour, for work driven by the cron rather than by a click. Every link in a
// daily send rides this, including the signed manage/unsubscribe link, so PUBLIC_BASE_URL
// is worth setting on any deployment that is not the production host.
function publicBase() {
  return (process.env.PUBLIC_BASE_URL || 'https://anr.makinitmag.com').replace(/\/+$/, '');
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
  // AUDIENCE vs GATE — keep these straight (028):
  //   AUDIENCE = this room's own verified participants. Registering for a room is what
  //     puts you on this list; it is NOT a platform-wide broadcast list.
  //   GATE = the room_live topic preference. The register screen carries a "notify me
  //     when this and future rooms go live" checkbox, so honouring the topic here is just
  //     honouring the box they ticked. Without this gate the settings page would offer a
  //     switch that does nothing, which is worse than not offering it.
  // Invite-only rooms use the SAME topic deliberately — see the NOTIFY_TOPICS comment.
  const topic = 'room_live';
  // Consent and phone come from `users`, NOT from the participant snapshot: the snapshot
  // is written at join time, so a room joined before an opt-out would otherwise still
  // carry a stale sms_marketing_consent = 1 and get texted.
  const parts = await db.all(
    `SELECT pt.id, pt.user_id, pt.email, COALESCE(u.phone, pt.phone) AS phone,
            COALESCE(u.sms_marketing_consent, pt.sms_marketing_consent) AS sms_marketing_consent,
            COALESCE(u.blocked, 0) AS blocked, COALESCE(u.email_opt_out, 0) AS email_opt_out,
            pe.enabled AS pref_email, ps.enabled AS pref_sms
       FROM participants pt
       LEFT JOIN users u ON u.uid = pt.user_id
       LEFT JOIN notify_prefs pe ON pe.uid = pt.user_id AND pe.topic = ? AND pe.channel = 'email'
       LEFT JOIN notify_prefs ps ON ps.uid = pt.user_id AND ps.topic = ? AND ps.channel = 'sms'
      WHERE pt.session_id = ? AND pt.verified = 1`,
    [topic, topic, sessionId]);
  if (!parts.length) return { attempted: 0, sent: 0, failed: 0 };
  // Absent pref row => the catalog default, exactly as notifyAudience() resolves it.
  const defEmail = notifyDefault(topic, 'email'), defSms = notifyDefault(topic, 'sms');
  const onEmail = p => (p.pref_email == null ? defEmail : Number(p.pref_email)) === 1;
  const onSms   = p => (p.pref_sms   == null ? defSms   : Number(p.pref_sms))   === 1;
  const capped = parts.slice(0, NOTIFY_CAP);
  if (parts.length > NOTIFY_CAP) console.warn(`[NOTIFY] session ${sessionId}: ${parts.length} participants exceeds cap ${NOTIFY_CAP}; notifying first ${NOTIFY_CAP}.`);
  const url = `${base}/?s=${encodeURIComponent(sessionId)}`;
  const name = session.name || 'The A&R Room';
  const subject = `${name} is live · Enter the A&R evaluation`;
  const text = `${name} is live in The A&R Room. Enter the evaluation: ${url}`;
  let sent = 0, failed = 0;
  await runLimited(capped, NOTIFY_CONCURRENCY, async (p) => {
    if (Number(p.blocked) === 1) return;
    if (wantEmail && p.email && !Number(p.email_opt_out) && onEmail(p)
        && !(await alreadyNotified(sessionId, p.id, 'email'))) {
      const manage = notifyManageUrl(base, p.user_id);
      const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5">
    <p><strong>${escapeHtml(name)}</strong> is now live in The A&amp;R Room.</p>
    <p>Evaluate records, predict the room's consensus, and build your monthly ranking.</p>
    <p><a href="${url}" style="display:inline-block;background:#4bb749;color:#06210b;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none">Enter the evaluation →</a></p>
    <p style="color:#666;font-size:13px">${url}</p>
    ${notifyFooterHtml(manage)}</div>`;
      const r = await sendEmail(p.email, subject, html, `${text}\n\n${notifyFooterText(manage)}`);
      await logNotify(sessionId, p, 'email', p.email, r.ok ? 'sent' : 'failed', r.error);
      r.ok ? sent++ : failed++;
    }
    if (wantSms && p.phone && Number(p.sms_marketing_consent) === 1 && onSms(p)
        && !(await alreadyNotified(sessionId, p.id, 'sms'))) {
      const smsBody = `🎧 ${name} is LIVE in The A&R Room—evaluate records and predict the room: ${url}\n${smsFooter(notifyManageUrl(base, p.user_id))}`;
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
  // Poll type is now per-round (rounds.poll_type); the session is only a fallback for
  // any legacy round row that predates the column.
  const isBinary = (round.poll_type || 'rating') === 'binary';
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

// Final standings for a settled pack. PII-safe by construction: display name, city and
// the two score numbers only — never email or phone, because this rides the public
// /api/sidebet response. Nothing here is readable before status='settled' (callers gate
// on it): the standings are derived from pick counts, which stay sealed until then.
const SIDEBET_RESULT_LIMIT = 25;
async function sidebetResults(pack, limit = SIDEBET_RESULT_LIMIT) {
  const rows = await db.all(
    `SELECT se.rank, se.correct, se.distance, se.entry_no, u.name, u.location
       FROM sidebet_entries se JOIN users u ON u.uid = se.user_id
      WHERE se.pack_id = ? AND se.rank IS NOT NULL
      ORDER BY se.rank ASC, se.entry_no ASC
      LIMIT ?`, [pack.id, limit]);
  return rows.map(r => ({
    rank: Number(r.rank), correct: Number(r.correct), distance: Number(r.distance),
    name: dispName(r.name), location: r.location || null,
  }));
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
    // Review-site auto-fill is a host default too: the show spins up a NEW room every week,
    // and a mode you have to re-arm every week is a mode that's off the night you forget.
    let ingestAutoFinal = 0;
    if (creator.host_defaults) {
      try {
        const hd = JSON.parse(creator.host_defaults);
        if (hd && hd.bannerId && !bidFinal) {
          const b = await db.get('SELECT id FROM banners WHERE id = ? AND (owner_uid = ? OR owner_uid IS NULL)', [hd.bannerId, creator.uid]);
          if (b) bidFinal = b.id;
        }
        // Re-checked at creation, not trusted from the stored blob: a host demoted since
        // setting it must not keep minting rooms that stream artist contact at them.
        if (hd && hd.ingestAuto && creator.role === 'admin') ingestAutoFinal = 1;
      } catch (e) { /* malformed defaults never block creation */ }
    }
    // A room born 'live' starts NOW — stamp scheduled_at so every started room has a
    // real start time (an unscheduled 'upcoming' room gets stamped at go-live instead).
    const ts = now();
    await db.run('INSERT INTO sessions (id, name, admin_token, owner_uid, status, scheduled_at, default_minutes, poll_type, watch_url, submit_url, lobby_message, banner_id, geo_lat, geo_lng, geo_radius, geo_label, ingest_auto, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [sid, name.trim(), adminToken, ownerUid, st, scheduledAt ? Number(scheduledAt) : (st === 'live' ? ts : null), dm, pt, wu, su, lm, bidFinal, haveGeo ? gla : null, haveGeo ? gln : null, haveGeo ? grad : null, glabel, ingestAutoFinal, ts]);
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
    const { email, code, name, phone, notifyRooms } = await readBody(req);
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
      // DERIVATION SITE 1 of 3 (see also /api/join/verify and /api/join/account).
      // Phone presence is still the consent basis for anyone who has never opened the
      // contact center. Once they HAVE (sms_pref_set_at set), the number is still saved
      // but consent is left exactly as they set it — otherwise a deliberate opt-out gets
      // silently reversed by the next signup, which is a real TCPA problem (028).
      if (user.sms_pref_set_at == null) {
        await db.run('UPDATE users SET phone = ?, sms_marketing_consent = 1, sms_consent_at = ? WHERE uid = ?', [sPhoneRaw, now(), user.uid]);
      } else {
        await db.run('UPDATE users SET phone = ? WHERE uid = ?', [sPhoneRaw, user.uid]);
      }
    }
    // Registration checkbox: "Notify me when this and future rooms go live." Absent =>
    // write nothing, so an older client can never silently unsubscribe anybody.
    await applyRegisterNotifyChoice(user.uid, notifyRooms);
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
    // (game-type attr), geo_mode (location-rule attr), ar_count (verified
    // participants — labelled "A&Rs" in the UI), and round_count (ratified, i.e.
    // scored, rounds). All cheap at this scale. Newest first: the room you just
    // ended should be at the top of its group, not the bottom.
    const cols = `id, name, status, scheduled_at, owner_uid, created_at, series_id, poll_type, geo_mode,
      (SELECT COUNT(*) FROM participants pp WHERE pp.session_id = sessions.id AND pp.verified = 1) AS ar_count,
      (SELECT COUNT(*) FROM rounds rr WHERE rr.session_id = sessions.id AND rr.status = 'ratified') AS round_count`;
    const rows = user.role === 'admin'
      ? await db.all(`SELECT ${cols} FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC`, [])
      : await db.all(`SELECT ${cols} FROM sessions WHERE owner_uid = ? AND deleted_at IS NULL ORDER BY created_at DESC`, [user.uid]);
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
    const { sessionId, email, code, name, phone, keepPhone, ref, notifyRooms } = await readBody(req);
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
    // DERIVATION SITE 2 of 3. `consent` above is the phone-presence derivation; it governs
    // only until an A&R makes an explicit SMS decision in the contact center. After that
    // (sms_pref_set_at set) their stored choice wins and this join must not touch it — in
    // BOTH directions, so neither a re-typed number nor an omitted one can flip it (028).
    const prefSet = !!(user && user.sms_pref_set_at != null);
    let effConsent = consent;

    if (user) {
      await db.run('UPDATE users SET last_seen = ?, name = COALESCE(NULLIF(?,\'\'), name) WHERE uid = ?',
        [now(), (name || '').trim().slice(0, MAX_NAME), user.uid]);
      // Save a newly typed number (masked/echoed values were filtered out above). A number
      // is data — storing it is always fine; only the CONSENT flag is protected.
      if (newPhone) await db.run('UPDATE users SET phone = ? WHERE uid = ?', [newPhone, user.uid]);
      const wasConsented = user.sms_marketing_consent === 1 || user.sms_marketing_consent === true;
      if (prefSet) {
        effConsent = wasConsented ? 1 : 0;   // their explicit choice stands, untouched
      } else if (consent && !wasConsented) {
        // Consent reconciliation (unchanged for anyone who never set a preference). A
        // phone present (new or kept) => opted in, stamped on a fresh opt-in.
        await db.run('UPDATE users SET sms_marketing_consent = 1, sms_consent_at = ? WHERE uid = ?', [now(), user.uid]);
      } else if (!consent && wasConsented) {
        // Had consent, provided/kept no number now => withdrawal. The stored number stays
        // on file; sms_consent_at is never cleared, sms_optout_at records the withdrawal.
        await db.run('UPDATE users SET sms_marketing_consent = 0, sms_optout_at = ? WHERE uid = ?', [now(), user.uid]);
      }
    } else {
      const uid = id(12);
      await db.run('INSERT INTO users (uid, email, name, phone, sms_marketing_consent, sms_consent_at, first_seen, last_seen, sessions_played, lifetime_points) VALUES (?,?,?,?,?,?,?,?,0,0)',
        [uid, em, (name || '').trim().slice(0, MAX_NAME), effectivePhone || null, consent, consent ? now() : null, now(), now()]);
      user = { uid, email: em, isNewAccount: true };
    }
    // The per-session participant records the phone + consent for THIS signup. For an A&R
    // who has set an explicit preference, the snapshot mirrors their LIVE account consent
    // rather than re-deriving it — otherwise the admin export (and anything else reading
    // the snapshot) would claim a consent they've since revoked.
    const ph = effectivePhone || (prefSet ? (user.phone || '') : '');

    // ---- per-session player record (participants = this user, in this session) ----
    let participant = await db.get('SELECT * FROM participants WHERE session_id = ? AND email = ?', [sessionId, em]);
    const token = id(18);
    if (participant) {
      await db.run('UPDATE participants SET verified = 1, token = ?, user_id = ?, name = COALESCE(NULLIF(?,\'\'), name), phone = COALESCE(NULLIF(?,\'\'), phone), sms_marketing_consent = CASE WHEN ? = 1 THEN 1 ELSE sms_marketing_consent END WHERE id = ?',
        [token, user.uid, (name || '').trim().slice(0, MAX_NAME), ph, effConsent, participant.id]);
      // An explicit opt-out must also clear a stale snapshot left by an earlier signup —
      // the CASE above only ever raises the flag, never lowers it.
      if (prefSet && !effConsent) await db.run('UPDATE participants SET sms_marketing_consent = 0 WHERE id = ?', [participant.id]);
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
        [pid, sessionId, user.uid, em, (name || '').trim().slice(0, MAX_NAME), ph || null, effConsent, myCode, referredBy, token, now()]);
      // First time this user appears in this session → count it toward sessions_played.
      await db.run('UPDATE users SET sessions_played = sessions_played + 1 WHERE uid = ?', [user.uid]);
    }
    // Registration checkbox: "Notify me when this and future rooms go live." Absent =>
    // write nothing, so an older client can never silently unsubscribe anybody.
    await applyRegisterNotifyChoice(user.uid, notifyRooms);
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
    const { sessionId, accessCode, notifyRooms } = await readBody(req);
    const session = await db.get('SELECT id, status, deleted_at, access_code FROM sessions WHERE id = ?', [sessionId]);
    if (!session || session.deleted_at) return bad(res, 'Room not found', 404);
    if (session.status === 'completed' || session.status === 'archived') return bad(res, 'This room is closed — you can only register for upcoming or live rooms', 400);
    const em = (user.email || '').toLowerCase();
    // DERIVATION SITE 3 of 3 — the one-tap path, and the easiest to miss. Once an A&R has
    // made an explicit SMS decision, the snapshot mirrors their LIVE account consent
    // instead of re-deriving it from phone presence, so a one-tap re-join can't quietly
    // resurrect a consent they revoked (028).
    const consent = (user.sms_pref_set_at != null)
      ? ((user.sms_marketing_consent === 1 || user.sms_marketing_consent === true) ? 1 : 0)
      : (((user.phone || '').replace(/\D/g, '').length >= 7) ? 1 : 0);
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
      await db.run('UPDATE participants SET verified = 1, token = ?, user_id = ?, name = COALESCE(NULLIF(?,\'\'), name), phone = COALESCE(NULLIF(?,\'\'), phone), sms_marketing_consent = ? WHERE id = ?',
        [token, user.uid, (user.name || '').trim(), user.phone || '', consent, participant.id]);
      if (!participant.ref_code) await db.run('UPDATE participants SET ref_code = ? WHERE id = ?', [refCode(), participant.id]);
    } else {
      const pid = id(9);
      let myCode = refCode();
      for (let tries = 0; tries < 5; tries++) { const clash = await db.get('SELECT 1 FROM participants WHERE session_id = ? AND ref_code = ?', [sessionId, myCode]); if (!clash) break; myCode = refCode(); }
      await db.run('INSERT INTO participants (id, session_id, user_id, email, name, phone, sms_marketing_consent, ref_code, referred_by, token, verified, total_points, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,0,?)',
        [pid, sessionId, user.uid, em, (user.name || '').trim(), user.phone || null, consent, myCode, null, token, now()]);
      await db.run('UPDATE users SET sessions_played = sessions_played + 1, last_seen = ? WHERE uid = ?', [now(), user.uid]);
    }
    // Registration checkbox: "Notify me when this and future rooms go live." Absent =>
    // write nothing, so an older client can never silently unsubscribe anybody.
    await applyRegisterNotifyChoice(user.uid, notifyRooms);
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
    return send(res, 200, { defaults: { watchUrl: d.watchUrl || '', submitUrl: d.submitUrl || '', lobbyMessage: d.lobbyMessage || '', bannerId: d.bannerId || null, ingestAuto: d.ingestAuto ? 1 : 0 }, banner });
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
      // Auto-fill default for NEW rooms. Preserved when absent (the console saves the three
      // text defaults on their own) — an older client must never silently switch it off.
      ingestAuto: ('ingestAuto' in body) ? ((body.ingestAuto === 1 || body.ingestAuto === true || body.ingestAuto === '1') ? 1 : 0) : (cur.ingestAuto ? 1 : 0),
    };
    // Same gate as arming a single room: the staged push carries artist contact.
    if (d.ingestAuto && u.role !== 'admin') return bad(res, 'Admin only', 403);
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
    const u = await db.get('SELECT * FROM users WHERE uid = ?', [userId]);
    if (!u) return bad(res, 'Not found', 404);
    let cats = []; try { cats = JSON.parse(u.categories || '[]'); } catch {}
    return send(res, 200, {
      profile: {
        name: u.name || '', categories: cats, primaryCategory: u.primary_category || '',
        location: u.location || '', instagram: u.instagram || '', tiktok: u.tiktok || '',
        photoUrl: u.photo_url || null, complete: !!u.profile_complete,
        // Private-to-self contact fields. This is a header-authenticated route only
        // (the notify-link token can NEVER reach it), so the real values are safe here.
        phone: u.phone || '',
      },
      categoriesAvailable: PROFILE_CATEGORIES,
      notify: await notifyPrefsFor(u),
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
    // NOTE: the phone number is NOT writable here. It lives on /api/me/notify-prefs
    // (header auth only) so exactly one code path owns the number and its TCPA consent
    // side-effects — two endpoints with subtly different consent rules is a bug waiting.
    const u = await db.get('SELECT name FROM users WHERE uid = ?', [userId]);
    const complete = isProfileComplete({ name: u && u.name, categories: JSON.stringify(cats), primary_category: primary, location }) ? 1 : 0;
    await db.run('UPDATE users SET categories = ?, primary_category = ?, location = ?, instagram = ?, tiktok = ?, profile_complete = ? WHERE uid = ?',
      [JSON.stringify(cats), primary, location, instagram, tiktok, complete, userId]);
    return send(res, 200, { ok: true, complete: !!complete });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NOTIFICATION CONTACT CENTER (028) — read/write an A&R's own subscriptions.
  // ─────────────────────────────────────────────────────────────────────────
  // Dual auth: the normal header token wins; failing that, a signed manage-link token
  // (see verifyNotifyLink). These live on their OWN paths, deliberately not under
  // /api/me/profile, so the link token has no route to the profile handler.
  //
  // resolveNotifyActor returns { user, viaLink } — viaLink narrows what may be read
  // (masked contact only) and written (never the phone number).
  async function resolveNotifyActor(req, url) {
    const userId = await resolveUserId(req);
    if (userId) {
      const u = await db.get('SELECT * FROM users WHERE uid = ?', [userId]);
      if (u) return { user: u, viaLink: false };
    }
    const v = await verifyNotifyLink(req, url);
    if (v.error) return { error: v.error, status: v.status };
    return { user: v.user, viaLink: true };
  }

  if (p === '/api/me/notify-prefs' && (method === 'GET' || method === 'POST')) {
    const actor = await resolveNotifyActor(req, url);
    if (actor.error) return bad(res, actor.error, actor.status);
    const u = actor.user;
    // A manage link must never be cached by a shared proxy, and must not leak into the
    // Referer of anything the settings page links out to.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (method === 'POST') {
      const body = await readBody(req);

      // --- Phone. HEADER AUTH ONLY: changing the number is an account change, and a
      // leaked manage link must never be able to REDIRECT someone's texts. ---
      if ('phone' in body) {
        if (actor.viaLink) return bad(res, 'login_required', 403);
        const rawPhone = (body.phone || '').toString().trim().slice(0, 40);
        const digits = rawPhone.replace(/\D/g, '');
        if (rawPhone && digits.length < 7) return bad(res, 'That mobile number looks incomplete', 400);
        if (rawPhone) {
          await db.run('UPDATE users SET phone = ?, sms_pref_set_at = ? WHERE uid = ?', [rawPhone, now(), u.uid]);
        } else {
          // No number, no consent — regardless of what the topic rows say.
          await db.run('UPDATE users SET phone = NULL, sms_marketing_consent = 0, sms_optout_at = ?, sms_pref_set_at = ? WHERE uid = ?',
            [now(), now(), u.uid]);
        }
        await db.run('UPDATE participants SET phone = ? WHERE user_id = ?', [rawPhone || null, u.uid]);
        u.phone = rawPhone || null;   // so the smsConsent branch below sees the new number
      }

      // --- SMS master (the TCPA record). Never inferred from the topic rows. ---
      if ('smsConsent' in body) {
        const wantSms = body.smsConsent === true || body.smsConsent === 1;
        const hasPhone = !!(u.phone && String(u.phone).replace(/\D/g, '').length >= 7);
        if (wantSms && !hasPhone) return bad(res, 'Add a mobile number first', 400);
        if (wantSms) {
          // sms_consent_at records the GRANT, stamped on each 0 -> 1 transition.
          await db.run('UPDATE users SET sms_marketing_consent = 1, sms_consent_at = ?, sms_pref_set_at = ? WHERE uid = ?',
            [now(), now(), u.uid]);
        } else {
          // The number stays on file — revoking consent is not deleting the contact.
          // sms_consent_at is NEVER cleared; sms_optout_at records the withdrawal, so
          // the pair reads as a consent history rather than a mutable flag.
          await db.run('UPDATE users SET sms_marketing_consent = 0, sms_optout_at = ?, sms_pref_set_at = ? WHERE uid = ?',
            [now(), now(), u.uid]);
        }
        await db.run('UPDATE participants SET sms_marketing_consent = ? WHERE user_id = ?', [wantSms ? 1 : 0, u.uid]);
      }

      // --- Global email kill switch (one-click unsubscribe-all). ---
      if ('emailOptOut' in body) {
        const off = body.emailOptOut === true || body.emailOptOut === 1;
        await db.run('UPDATE users SET email_opt_out = ?, email_opt_out_at = ? WHERE uid = ?',
          [off ? 1 : 0, off ? now() : null, u.uid]);
      }

      // --- Per-topic rows. Only allowlisted (topic, channel) pairs are ever written. ---
      const topics = (body.topics && typeof body.topics === 'object') ? body.topics : {};
      let touchedSms = false;
      for (const [topic, channels] of Object.entries(topics)) {
        if (!channels || typeof channels !== 'object') continue;
        for (const channel of NOTIFY_CHANNELS) {
          if (!(channel in channels)) continue;
          if (!notifyTopicOffers(topic, channel)) continue;   // unknown topic or channel not offered
          await setNotifyPref(u.uid, topic, channel, !!channels[channel], actor.viaLink ? 'link' : 'prefs');
          if (channel === 'sms') touchedSms = true;
        }
      }
      // Toggling an SMS topic in the contact center is an explicit SMS decision, so the
      // phone-presence derivation stops guessing for this user from here on. Note this
      // does NOT flip the master: inferring a TCPA record change from a narrower choice
      // is worse than leaving it explicit.
      if (touchedSms) await db.run('UPDATE users SET sms_pref_set_at = COALESCE(sms_pref_set_at, ?) WHERE uid = ?', [now(), u.uid]);
    }

    const fresh = await db.get('SELECT * FROM users WHERE uid = ?', [u.uid]);
    const out = await notifyPrefsFor(fresh);
    // Contact fields are MASKED for a link holder: enough to recognise the account,
    // never enough to harvest it. Header-authenticated callers get the real values.
    out.email = actor.viaLink ? maskEmail(fresh.email) : (fresh.email || '');
    out.phone = actor.viaLink ? maskPhone(fresh.phone) : (fresh.phone || '');
    out.name = fresh.name || '';
    out.viaLink = actor.viaLink;
    // Changing the number is an account change: a leaked link must never be able to
    // REDIRECT someone's texts. The client hides the phone field when this is false.
    out.canEditPhone = !actor.viaLink;
    out.topicsAvailable = Object.fromEntries(
      Object.entries(NOTIFY_TOPICS).map(([k, v]) => [k, { label: v.label, channels: Object.keys(v.channels) }]));
    return send(res, 200, out);
  }

  // One-click unsubscribe: everything off, no confirm step, no login. CAN-SPAM wants
  // this to just work — a link that demands a login is a spam complaint waiting to happen.
  if (p === '/api/me/notify-prefs/unsubscribe-all' && method === 'POST') {
    const actor = await resolveNotifyActor(req, url);
    if (actor.error) return bad(res, actor.error, actor.status);
    const u = actor.user;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    await db.run('UPDATE users SET email_opt_out = 1, email_opt_out_at = ?, sms_marketing_consent = 0, sms_optout_at = ?, sms_pref_set_at = ? WHERE uid = ?',
      [now(), now(), now(), u.uid]);
    await db.run('UPDATE participants SET sms_marketing_consent = 0 WHERE user_id = ?', [u.uid]);
    for (const [topic, spec] of Object.entries(NOTIFY_TOPICS)) {
      for (const channel of Object.keys(spec.channels)) {
        await setNotifyPref(u.uid, topic, channel, false, actor.viaLink ? 'link' : 'prefs');
      }
    }
    return send(res, 200, { ok: true });
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
      await tx.run('DELETE FROM notify_prefs WHERE uid = ?', [uid]);
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
    const session = sessionId ? await db.get('SELECT id, name, status, deleted_at, watch_url, lobby_message, banner_id, mode FROM sessions WHERE id = ?', [sessionId]) : null;
    if (!session || session.deleted_at) return bad(res, 'Room not found', 404);
    const out = {
      id: session.id,
      name: session.name,
      status: session.status,
      // The surface a link belongs on, decided BEFORE the first state request — play.html
      // and daily.html are different products, and each sends the other's links home.
      // (It also lets a page pick its polling strategy at boot rather than after.)
      mode: session.mode === 'async' ? 'async' : 'live',
      closed: session.status === 'completed' || session.status === 'archived',
      watchUrl: session.watch_url || null,
      lobbyMessage: session.lobby_message || null,
    };
    // Same ad cascade the in-room state carries (room banner -> Revive -> global),
    // so the banner is on screen from the JOIN screens on — the slot is never empty
    // while ads fund the show. Pre-join counts as lobby for zone choice. All public
    // data (banner image URL + link, Revive zone id) — no PII.
    const own = session.banner_id ? await getBanner(session.banner_id) : null;
    if (own) out.banner = own;
    else {
      const rv = await getReviveCfg();
      if (rv) out.revive = { base: rv.base, zone: rv.lobby };
      else out.banner = await resolveBanner(session);
    }
    return send(res, 200, out);
  }

  if (p === '/api/overlay/state' && method === 'GET') {
    const sessionId = url.searchParams.get('s') || url.searchParams.get('sessionId');
    const host = url.searchParams.get('host') || url.searchParams.get('h');
    let session = null;
    if (sessionId) {
      session = await db.get('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    } else if (host) {
      // Host-keyed overlay: a STABLE URL that follows the host's current room — their live
      // session if one is running, else their soonest upcoming one. Lets a host set the OBS
      // browser source once and reuse it every week without editing the URL. Keyed on the
      // owner's uid; the response carries session.id so the client rebuilds QR links when
      // the resolved room changes (e.g. next week's session).
      // Drops are excluded from BOTH lookups. A drop created that morning is `live` all day
      // and would otherwise steal the OBS source from the evening's actual broadcast — and
      // there is nothing to overlay on a drop anyway.
      session = await db.get("SELECT * FROM sessions WHERE owner_uid = ? AND status = 'live' AND deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') ORDER BY created_at DESC LIMIT 1", [host])
        || await db.get("SELECT * FROM sessions WHERE owner_uid = ? AND status = 'upcoming' AND deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') ORDER BY (scheduled_at IS NULL), scheduled_at ASC, created_at DESC LIMIT 1", [host]);
    }
    if (!session) return bad(res, 'Room not found', 404);
    return send(res, 200, await overlayState(session, (url.searchParams.get('leader_scope') || url.searchParams.get('lb') || '').toLowerCase()));
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
        message: 'You\u2019re outside the event location and can\u2019t participate in this in-person session.' });
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
    // email/phone ride along so the post-show report card can reach the artist without
    // the host retyping contact info mid-show. Private — staged, never publicly emitted.
    // `note` is the artist's own context from the submission form ("this isn't mixed, I
    // recorded it on Bandlab last night"). It tells the room HOW TO HEAR the record and it
    // is the differentiator of the whole review — the host reads it on air — yet until now
    // it never reached the room at all. Accepts `note` or the older `ask` spelling. `playUrl` lets a pulled record carry its own link.
    // `ref`/`url` tie the round back to the Drupal node; `scout` is the A&R whose referral
    // link the artist submitted through (see the daily push for how it resolves to points).
    const rec = { title: clip(body.title, 200), artist: clip(body.artist, 200),
      instagram: clip((body.instagram || '').toString().replace(/^@+/, ''), 60) || null,
      email: cleanArtistEmail(body.email), phone: cleanArtistPhone(body.phone),
      note: clip(body.note || body.ask, 500) || null,
      playUrl: cleanPlayUrl(body.playUrl || body.play_url),
      profileUrl: cleanUrl(body.profileUrl || body.profile_url),
      ref: clip(body.ref, 100) || null,
      url: cleanUrl(body.url),
      scoutUid: clip(body.scout && body.scout.uid, 60) || null,
      source: clip(body.source, 60) || 'makinitmag', at: now() };
    if (!rec.title && !rec.artist) return send(res, 400, { error: 'Need at least a title or artist' }, cors);
    await db.run("INSERT INTO settings (k,v) VALUES ('ingest_latest', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [JSON.stringify(rec)]);
    // Rooms in auto mode fill their queue form from this push — nudge them now instead of
    // making the host wait out the console's poll (which drops to 15s once Ably connects).
    // No new channel or token scope: this is the room's own channel, which the console is
    // already subscribed to. Bounded + non-fatal; a realtime hiccup just costs the poll.
    let autoRooms = [], queued = 0;
    try {
      // Drops are never auto-fill targets. stageIngestRound's newest-push-wins DELETE is
      // scoped by session, so a single stray /review push into a running day could otherwise
      // delete one of its records. (stageIngestRound refuses async too — belt and braces,
      // because either guard alone would be one edit away from being the only one.)
      autoRooms = await db.all("SELECT id, poll_type, status FROM sessions WHERE ingest_auto = 1 AND status = 'live' AND deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') ORDER BY created_at DESC LIMIT 5", []);
      for (const s of autoRooms) {
        // Stage it as a real queued round FIRST, so the console's refresh (and the deck's
        // next press) both see the record rather than only the form text.
        if (await stageIngestRound(s, rec)) queued++;
        await realtime.publish(s.id, 'ingest');
      }
    } catch (e) { console.error('[ingest] auto stage/notify failed:', e.message); }
    return send(res, 200, { ok: true, staged: { title: rec.title, artist: rec.artist }, autoRooms: autoRooms.length, queued }, cors);
  }

  // ----- A&R DAILY: the approved daily batch from Drupal -----
  // The operator reviews and approves the day's records on a Drupal page (4 drawn at random
  // from the free pool + up to 12 paid, weighted by amount — ALL of that maths lives there),
  // then pushes the approved set here as ONE batch. No pool table, no amount/tier fields and
  // no selection logic in this repo; a shadow copy is how the two systems stop agreeing.
  //
  // No CORS and no OPTIONS: this is server-to-server from PHP, not a browser button.
  // Its own secret because the blast radius differs — /submission stages one row a host can
  // ignore, this creates a room and every artist's contact details.
  if (p === '/api/ingest/daily' && method === 'POST') {
    // DAILY_INGEST_TOKEN ONLY — deliberately NOT falling back to INGEST_TOKEN. The fallback
    // read as convenient and quietly destroyed the whole reason this has its own secret:
    // INGEST_TOKEN guards a push that stages ONE row a host can ignore, while this one
    // creates a live room carrying up to sixteen artists' email addresses and phone numbers.
    // Sharing the secret means the lower-value integration's blast radius becomes this one's.
    // Unset ⇒ 503, and the day simply cannot be pushed until it is configured.
    const token = process.env.DAILY_INGEST_TOKEN || '';
    if (!token) return send(res, 503, { error: 'Daily ingest not configured (set DAILY_INGEST_TOKEN)' });
    const given = (req.headers['x-ingest-token'] || '').toString();
    // Length pre-check then constant-time compare (timingSafeEqual throws on a length
    // mismatch). The older `given !== token` above is a timing oracle — not propagated here.
    const okTok = given.length === token.length && given.length > 0
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
    if (!okTok) return send(res, 401, { error: 'Bad token' });

    return stageDailyDrop(res, await readBody(req));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SIDEBET (033) — the A&R Wars prediction contest at /sidebet.
  // ═════════════════════════════════════════════════════════════════════════
  // Entrants predict WHICH songs from the monthly service pack get PLAYED at A&R
  // Wars. Set membership, not ratings — nothing here reads votes, and no points are
  // awarded. Identity is the existing email OTP (/api/auth/request + /api/auth/verify);
  // an entrant becomes a users row with NO participants row, which is the point: the
  // contest seeds the durable audience.
  //
  // SEALED: pick counts are never emitted before status='settled'. The tiebreak
  // ranking is built from the entries themselves, so a live "340 people picked this"
  // would make copying the crowd the dominant strategy. sidebetPublicPack() is the
  // ONLY shape sent to a player, and it has no aggregate in it at all.

  // Public read: the open pack, its songs, and (with an auth token) your own entry.
  if (p === '/api/sidebet' && method === 'GET') {
    const slug = (url.searchParams.get('pack') || '').trim();
    // Resolution: the one OPEN pack wins. With none open, fall back to the most recent
    // closed-or-settled one — otherwise an entrant who comes back after the show (which
    // is exactly what the confirmation screen told them to do) lands on an empty page
    // instead of their own result. An explicit slug reaches any pack by permalink.
    const pack = slug
      ? await db.get('SELECT * FROM packs WHERE slug = ?', [slug])
      : (await db.get("SELECT * FROM packs WHERE status = 'open' ORDER BY created_at DESC LIMIT 1", []))
        || (await db.get("SELECT * FROM packs WHERE status IN ('closed','settled') ORDER BY COALESCE(settled_at, closes_at) DESC LIMIT 1", []));
    if (!pack) return send(res, 200, { pack: null });
    const songs = await db.all('SELECT id, title, artist, row_no FROM pack_songs WHERE pack_id = ? ORDER BY row_no', [pack.id]);
    const out = {
      pack: {
        id: pack.id, name: pack.name, picksRequired: pack.picks_required,
        downloadUrl: pack.download_url || null, prizeText: pack.prize_text || null,
        sponsorText: pack.sponsor_text || null,
        warsAt: Number(pack.wars_at), closesAt: Number(pack.closes_at),
        status: pack.status, songCount: songs.length,
        // Server clock, so a device with a wrong date can't think entries are still open.
        nowMs: now(),
        open: pack.status === 'open' && now() < Number(pack.closes_at),
      },
      banner: pack.banner_id ? await getBanner(pack.banner_id) : null,
      songs: songs.map(s => ({ id: s.id, title: s.title, artist: s.artist || null })),
      entry: null,
    };
    const user = await userFromAuth(req);
    if (user) {
      const e = await db.get('SELECT * FROM sidebet_entries WHERE pack_id = ? AND user_id = ?', [pack.id, user.uid]);
      if (e) {
        const picks = await db.all('SELECT pack_song_id FROM sidebet_picks WHERE entry_id = ? ORDER BY position', [e.id]);
        out.entry = {
          entryNo: e.entry_no, updatedAt: Number(e.updated_at),
          picks: picks.map(x => x.pack_song_id),
          correct: e.correct == null ? null : Number(e.correct),
          rank: e.rank == null ? null : Number(e.rank),
        };
      }
    }
    // Results are readable only once settled — before that there is nothing to read
    // (no song has been played) and pick counts are sealed.
    if (pack.status === 'settled') out.results = await sidebetResults(pack);
    return send(res, 200, out);
  }

  // Save / update an entry. Requires a verified account (X-Auth-Token) — the unique
  // index on (pack_id, user_id) is what makes "one entry per person" real, so the
  // identity behind it has to have been proven first.
  if (p === '/api/sidebet/entry' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user) return bad(res, 'Verify your email first', 401);
    if (user.blocked) return bad(res, 'This account has been suspended.', 403);
    const body = await readBody(req);
    const pack = body.packId
      ? await db.get('SELECT * FROM packs WHERE id = ?', [body.packId])
      : await db.get("SELECT * FROM packs WHERE status = 'open' ORDER BY created_at DESC LIMIT 1", []);
    if (!pack) return bad(res, 'No contest is open right now', 404);
    if (pack.status !== 'open') return bad(res, 'Entries are closed');
    // The cut-off is enforced HERE, not just in the UI: entries editable once songs
    // are playing would let someone submit a list they already know the answer to.
    if (now() >= Number(pack.closes_at)) return bad(res, 'Entries closed');

    const songs = await db.all('SELECT id FROM pack_songs WHERE pack_id = ?', [pack.id]);
    const valid = new Set(songs.map(s => s.id));
    const check = validatePicks(body.picks, valid, Number(pack.picks_required));
    if (!check.ok) return bad(res, check.error);

    const t = now();
    const existing = await db.get('SELECT * FROM sidebet_entries WHERE pack_id = ? AND user_id = ?', [pack.id, user.uid]);
    const entryId = existing ? existing.id : id(12);
    await db.tx(async (tx) => {
      if (existing) {
        // first_submitted_at is deliberately NOT touched: it is the record of when they
        // first entered. The TIEBREAK reads updated_at — the list that actually
        // competed — so an early throwaway entry rewritten at the deadline gets the
        // late timestamp it earned.
        await tx.run('UPDATE sidebet_entries SET updated_at = ? WHERE id = ?', [t, entryId]);
        await tx.run('DELETE FROM sidebet_picks WHERE entry_id = ?', [entryId]);
      } else {
        const c = await tx.get('SELECT COUNT(*) AS n FROM sidebet_entries WHERE pack_id = ?', [pack.id]);
        await tx.run('INSERT INTO sidebet_entries (id, pack_id, user_id, entry_no, first_submitted_at, updated_at, created_at) VALUES (?,?,?,?,?,?,?)',
          [entryId, pack.id, user.uid, Number(c.n) + 1, t, t, t]);
      }
      for (let i = 0; i < body.picks.length; i++) {
        await tx.run('INSERT INTO sidebet_picks (entry_id, pack_song_id, position) VALUES (?,?,?)',
          [entryId, body.picks[i], i + 1]);
      }
    });
    const e = await db.get('SELECT entry_no, updated_at FROM sidebet_entries WHERE id = ?', [entryId]);
    return send(res, 200, { ok: true, entryNo: e.entry_no, updatedAt: Number(e.updated_at), edited: !!existing });
  }

  // ----- sidebet admin (platform admin only: a pack spans no single room) -----
  if (p === '/api/admin/sidebet' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const packs = await db.all('SELECT * FROM packs ORDER BY created_at DESC', []);
    const out = [];
    for (const k of packs) {
      const sc = await db.get('SELECT COUNT(*) AS n FROM pack_songs WHERE pack_id = ?', [k.id]);
      const ec = await db.get('SELECT COUNT(*) AS n FROM sidebet_entries WHERE pack_id = ?', [k.id]);
      out.push({
        id: k.id, name: k.name, slug: k.slug || null, picksRequired: k.picks_required,
        downloadUrl: k.download_url || null, prizeText: k.prize_text || null,
        sponsorText: k.sponsor_text || null, bannerId: k.banner_id || null,
        warsAt: Number(k.wars_at), closesAt: Number(k.closes_at),
        sessionId: k.session_id || null, status: k.status,
        settledAt: k.settled_at ? Number(k.settled_at) : null,
        songs: Number(sc.n), entries: Number(ec.n),
      });
    }
    // The create form needs the banner library and the room list; both are admin-scoped
    // and small, so they ride this call rather than costing two more round trips.
    const banners = await db.all('SELECT id, label, session_id FROM banners ORDER BY created_at DESC LIMIT 100', []);
    const rooms = await db.all(
      "SELECT id, name, status FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50", []);
    return send(res, 200, {
      packs: out,
      banners: banners.map(b => ({ id: b.id, label: b.label || 'Untitled banner', image: `/api/banner/image?id=${b.id}` })),
      rooms: rooms.map(r => ({ id: r.id, name: r.name, status: r.status })),
    });
  }

  if (p === '/api/admin/sidebet' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const b = await readBody(req);
    const name = (b.name || '').toString().trim();
    if (!name) return bad(res, 'Service pack title is required');
    const picks = Math.max(1, Math.min(50, parseInt(b.picksRequired, 10) || 18));
    const warsAt = Number(b.warsAt), closesAt = Number(b.closesAt);
    if (!warsAt || !closesAt) return bad(res, 'Tournament date and cut-off are both required');
    // Enforced server-side as well as in the form: entries that stay editable past the
    // first song let someone submit a list they already know the answer to.
    if (closesAt >= warsAt) return bad(res, 'The cut-off must be before the tournament starts');

    const existing = b.id ? await db.get('SELECT * FROM packs WHERE id = ?', [b.id]) : null;
    if (b.id && !existing) return bad(res, 'Unknown iteration', 404);
    // Only one open pack at a time — /sidebet resolves to a single pack with no
    // disambiguation, so a second open one would silently shadow the first.
    if (b.status === 'open') {
      const other = await db.get("SELECT id, name FROM packs WHERE status = 'open' AND id <> ?", [b.id || '']);
      if (other) return bad(res, `"${other.name}" is already open. Close it first.`);
    }
    const fields = {
      name,
      slug: (b.slug || '').toString().trim() || null,
      picks_required: picks,
      download_url: (b.downloadUrl || '').toString().trim() || null,
      prize_text: (b.prizeText || '').toString().trim() || null,
      sponsor_text: (b.sponsorText || '').toString().trim() || null,
      banner_id: (b.bannerId || '').toString().trim() || null,
      wars_at: warsAt,
      closes_at: closesAt,
      session_id: (b.sessionId || '').toString().trim() || null,
      status: ['draft', 'open', 'closed', 'settled'].includes(b.status) ? b.status : (existing ? existing.status : 'draft'),
    };
    if (existing) {
      // picks_required can't move once entries exist — every stored entry is exactly
      // the old length, so changing it would silently invalidate all of them.
      const ec = await db.get('SELECT COUNT(*) AS n FROM sidebet_entries WHERE pack_id = ?', [existing.id]);
      if (Number(ec.n) > 0 && picks !== Number(existing.picks_required)) {
        return bad(res, `${ec.n} ${Number(ec.n) === 1 ? 'entry already exists' : 'entries already exist'} with ${existing.picks_required} picks — that number can no longer change.`);
      }
      const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
      await db.run(`UPDATE packs SET ${sets} WHERE id = ?`, [...Object.values(fields), existing.id]);
      return send(res, 200, { ok: true, id: existing.id });
    }
    const pid = id(12);
    const cols = ['id', ...Object.keys(fields), 'opens_at', 'created_at'];
    const vals = [pid, ...Object.values(fields), now(), now()];
    await db.run(`INSERT INTO packs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    return send(res, 200, { ok: true, id: pid });
  }

  // Load the songs from a CSV. Row order becomes row_no and is LOAD-BEARING: it breaks
  // ties in the consensus ranking, so it is fixed before any entry exists.
  if (p === '/api/admin/sidebet/songs' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const b = await readBody(req);
    const pack = await db.get('SELECT * FROM packs WHERE id = ?', [b.packId || '']);
    if (!pack) return bad(res, 'Unknown iteration', 404);
    // Every pick points at a pack_songs row, so replacing the list after entries exist
    // would repoint or orphan all of them. Get the CSV right before opening.
    const ec = await db.get('SELECT COUNT(*) AS n FROM sidebet_entries WHERE pack_id = ?', [pack.id]);
    if (Number(ec.n) > 0) return bad(res, `${ec.n} ${Number(ec.n) === 1 ? 'entry' : 'entries'} already point at these songs — the list can no longer be replaced.`);

    const rows = Array.isArray(b.songs) ? b.songs : [];
    const clean = [], seen = new Set();
    for (const r of rows) {
      const title = (r && r.title || '').toString().trim().slice(0, 200);
      const artist = (r && r.artist || '').toString().trim().slice(0, 200);
      if (!title) return bad(res, `Row ${clean.length + 1} has no title`);
      const k = (title + '|' + artist).toLowerCase();
      if (seen.has(k)) return bad(res, `"${title}" appears twice`);
      seen.add(k);
      clean.push({ title, artist });
    }
    if (clean.length < Number(pack.picks_required)) {
      return bad(res, `Only ${clean.length} songs — you can't pick ${pack.picks_required} out of ${clean.length}`);
    }
    const t = now();
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM pack_songs WHERE pack_id = ?', [pack.id]);
      for (let i = 0; i < clean.length; i++) {
        await tx.run('INSERT INTO pack_songs (id, pack_id, row_no, title, artist, played, created_at) VALUES (?,?,?,?,?,0,?)',
          [id(12), pack.id, i + 1, clean[i].title, clean[i].artist || null, t]);
      }
    });
    return send(res, 200, { ok: true, songs: clean.length });
  }

  // The service-pack songs for whatever sidebet iteration is linked to THIS room, so the
  // console can offer them when queuing a Versus matchup. Deliberately its own one-shot
  // call rather than a field on /api/admin/state: state is polled every couple of seconds
  // during a live show, and this list never changes mid-round.
  if (p === '/api/admin/sidebet/room-songs' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId') || '';
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const pack = await db.get(
      "SELECT id, name FROM packs WHERE session_id = ? AND status <> 'settled' ORDER BY created_at DESC LIMIT 1", [sessionId]);
    if (!pack) return send(res, 200, { pack: null, songs: [] });
    const songs = await db.all('SELECT id, title, artist FROM pack_songs WHERE pack_id = ? ORDER BY title', [pack.id]);
    return send(res, 200, {
      pack: { id: pack.id, name: pack.name },
      songs: songs.map(x => ({ id: x.id, title: x.title, artist: x.artist || null })),
    });
  }

  // Settle checklist: every pack song, pre-ticked from the Versus rounds that played it.
  if (p === '/api/admin/sidebet/checklist' && method === 'GET') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const pack = await db.get('SELECT * FROM packs WHERE id = ?', [url.searchParams.get('packId') || '']);
    if (!pack) return bad(res, 'Unknown iteration', 404);
    const songs = await db.all('SELECT id, title, artist, row_no, played FROM pack_songs WHERE pack_id = ? ORDER BY row_no', [pack.id]);
    // Derived: a song is auto-marked when it was one side of a started Versus round.
    // Every A&R Wars matchup is a two-song binary round, so the full set falls out with
    // no extra host work. The host still confirms — a swapped song or a hand-typed
    // matchup has to be fixable, and a title compare must never decide a cash prize.
    const derived = new Set();
    if (pack.session_id) {
      const rs = await db.all(
        "SELECT pack_song_a, pack_song_b FROM rounds WHERE session_id = ? AND status <> 'pending'", [pack.session_id]);
      for (const r of rs) { if (r.pack_song_a) derived.add(r.pack_song_a); if (r.pack_song_b) derived.add(r.pack_song_b); }
    }
    return send(res, 200, {
      picksRequired: Number(pack.picks_required),
      status: pack.status,
      sessionId: pack.session_id || null,
      songs: songs.map(s => ({
        id: s.id, title: s.title, artist: s.artist || null, rowNo: s.row_no,
        // `played` once anything has been saved; otherwise the derived set is the seed.
        played: Number(s.played) === 1 || (Number(s.played) === 0 && derived.has(s.id)),
        derived: derived.has(s.id),
      })),
    });
  }

  // Settle: mark what was played, score every entry, publish. Re-runnable while closed.
  if (p === '/api/admin/sidebet/settle' && method === 'POST') {
    const user = await userFromAuth(req);
    if (!user || user.role !== 'admin') return bad(res, 'Admin only', 403);
    const b = await readBody(req);
    const pack = await db.get('SELECT * FROM packs WHERE id = ?', [b.packId || '']);
    if (!pack) return bad(res, 'Unknown iteration', 404);
    const played = Array.isArray(b.played) ? [...new Set(b.played)] : [];
    const need = Number(pack.picks_required);
    // A miscount doesn't error on its own — it quietly crowns the wrong person. So the
    // count is a hard gate rather than a warning.
    if (played.length !== need) {
      return bad(res, `${played.length} songs marked, ${need} required.`);
    }
    const songs = await db.all('SELECT id, row_no FROM pack_songs WHERE pack_id = ?', [pack.id]);
    const byId = new Map(songs.map(s => [s.id, s]));
    for (const sid of played) if (!byId.has(sid)) return bad(res, 'A marked song is not in this pack');

    const truth = new Set(played);
    const playedSongs = played.map(sid => ({ id: sid, row_no: byId.get(sid).row_no }));

    // Consensus ranking: played songs ordered by how many entries picked them.
    const counts = new Map();
    const countRows = await db.all(
      `SELECT sp.pack_song_id AS sid, COUNT(*) AS n
         FROM sidebet_picks sp JOIN sidebet_entries se ON se.id = sp.entry_id
        WHERE se.pack_id = ? GROUP BY sp.pack_song_id`, [pack.id]);
    for (const r of countRows) counts.set(r.sid, Number(r.n));
    const consensus = consensusRanking(playedSongs, counts);

    const entries = await db.all('SELECT id, updated_at FROM sidebet_entries WHERE pack_id = ?', [pack.id]);
    const scored = [];
    for (const e of entries) {
      const picks = await db.all('SELECT pack_song_id, position FROM sidebet_picks WHERE entry_id = ?', [e.id]);
      const { correct, distance } = scoreEntry(picks, truth, consensus);
      scored.push({ id: e.id, updated_at: Number(e.updated_at), correct, distance });
    }
    const ranked = rankEntries(scored);

    await db.tx(async (tx) => {
      await tx.run('UPDATE pack_songs SET played = 0 WHERE pack_id = ?', [pack.id]);
      for (const sid of played) await tx.run('UPDATE pack_songs SET played = 1 WHERE id = ?', [sid]);
      for (const r of ranked) {
        await tx.run('UPDATE sidebet_entries SET correct = ?, distance = ?, rank = ? WHERE id = ?',
          [r.correct, r.distance, r.rank, r.id]);
      }
      await tx.run("UPDATE packs SET status = 'settled', settled_at = ? WHERE id = ?", [now(), pack.id]);
    });
    const fresh = await db.get('SELECT * FROM packs WHERE id = ?', [pack.id]);
    return send(res, 200, { ok: true, entries: ranked.length, results: await sidebetResults(fresh) });
  }

  // ===== ANALYTICS DATA FEED (static-token gated; machine-readable) =====
  // A raw, PII-safe data pull across the most recent N shows — the per-session CSV/JSON
  // exports bundled into ONE call, PLUS a STABLE pseudonymous A&R id (`ar`) so cross-session
  // analysis (retention, repeat behavior) is possible — which the per-session anonymized
  // exports can't do (their Player-N ids don't span sessions). Gated by a static
  // ANALYTICS_TOKEN (like INGEST_TOKEN) so it can be queried programmatically without an
  // interactive admin login; disabled (503) until the token is set. PII-safe: identity is a
  // one-way HMAC (keyed by the token) — never a name/email/phone/uid. Bounded to the window,
  // off every hot path (NOT boot/poll — the #1 rule); rides existing indexes.
  if (p === '/api/analytics/export' && method === 'GET') {
    const token = process.env.ANALYTICS_TOKEN || '';
    if (!token) return send(res, 503, { error: 'Analytics feed not configured (set ANALYTICS_TOKEN)' });
    const given = (req.headers['x-analytics-token'] || url.searchParams.get('token') || '').toString();
    const eq = given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
    if (!eq) return send(res, 401, { error: 'Bad token' });
    const window = Math.max(1, Math.min(52, parseInt(url.searchParams.get('window') || '12', 10) || 12));
    // Stable, one-way pseudonym for a durable user (keyed by the token; participants with no
    // user_id fall back to a per-participant pseudonym so the row is still analyzable).
    const arId = (uid, pid) => 'AR-' + crypto.createHmac('sha256', token).update(uid ? 'u:' + uid : 'p:' + pid).digest('hex').slice(0, 10);
    // Most recent non-deleted shows that actually ran (>=1 vote).
    const cand = await db.all('SELECT id, name, created_at, poll_type, series_id FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200', []);
    if (!cand.length) return send(res, 200, { generatedAt: Date.now(), window, sessions: [], participants: [], rounds: [], votes: [] });
    const cph = cand.map(() => '?').join(',');
    const vc = await db.all(`SELECT r.session_id AS sid, COUNT(v.id) AS c FROM rounds r JOIN votes v ON v.round_id = r.id WHERE r.session_id IN (${cph}) GROUP BY r.session_id`, cand.map(s => s.id));
    const vcMap = new Map(vc.map(r => [r.sid, Number(r.c) || 0]));
    const winSessions = cand.filter(s => (vcMap.get(s.id) || 0) > 0).slice(0, window);
    if (!winSessions.length) return send(res, 200, { generatedAt: Date.now(), window, sessions: [], participants: [], rounds: [], votes: [] });
    const ids = winSessions.map(s => s.id);
    const wph = ids.map(() => '?').join(',');
    // Short opaque per-session key for the payload (not the internal id).
    const sidKey = {}; winSessions.forEach((s, i) => { sidKey[s.id] = 'S' + (i + 1); });
    const parts = await db.all(`SELECT id, session_id, user_id, verified, total_points, referred_by, ref_credited, pool FROM participants WHERE session_id IN (${wph})`, ids);
    const pMap = new Map(parts.map(p => [p.id, p]));
    const arOf = (pid) => { const p = pMap.get(pid); return p ? arId(p.user_id, p.id) : null; };
    const rounds = await db.all(`SELECT id, session_id, idx, status, poll_type, room_average, split_a FROM rounds WHERE session_id IN (${wph}) ORDER BY session_id, idx`, ids);
    const rIdx = new Map(rounds.map(r => [r.id, r.idx]));
    const votes = await db.all(
      `SELECT v.round_id, r.session_id AS sid, v.participant_id AS pid, v.taste, v.predict, v.pick, v.predict_split,
              v.err, v.points, v.tier, v.rank, v.locked_at
         FROM votes v JOIN rounds r ON v.round_id = r.id WHERE r.session_id IN (${wph})`, ids);
    return send(res, 200, {
      generatedAt: Date.now(),
      window,
      note: 'PII-safe. `ar` is a stable one-way pseudonym per A&R across sessions (retention-safe). No names/emails/phones.',
      sessions: winSessions.map(s => ({ s: sidKey[s.id], name: s.name, date: Number(s.created_at) || null, pollType: s.poll_type === 'binary' ? 'binary' : 'rating', seriesId: s.series_id || null })),
      participants: parts.map(p => ({ s: sidKey[p.session_id], ar: arId(p.user_id, p.id), verified: (p.verified === 1 || p.verified === true) ? 1 : 0, points: Number(p.total_points) || 0, referredByAr: p.referred_by ? arOf(p.referred_by) : null, refCredited: (p.ref_credited === 1 || p.ref_credited === true) ? 1 : 0, pool: p.pool || null })),
      rounds: rounds.map(r => ({ s: sidKey[r.session_id], round: r.idx, status: r.status, pollType: r.poll_type === 'binary' ? 'binary' : 'rating', roomAverage: r.room_average == null ? null : Number(r.room_average), splitA: r.split_a == null ? null : Number(r.split_a) })),
      votes: votes.map(v => ({ s: sidKey[v.sid], round: rIdx.get(v.round_id) ?? null, ar: arOf(v.pid), taste: v.taste == null ? null : Number(v.taste), predict: v.predict == null ? null : Number(v.predict), pick: v.pick || null, predictSplit: v.predict_split == null ? null : Number(v.predict_split), error: v.err == null ? null : Number(v.err), points: v.points == null ? null : Number(v.points), tier: v.tier || null, rank: v.rank == null ? null : Number(v.rank), lockedAt: v.locked_at == null ? null : Number(v.locked_at) })),
    });
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
    // Platform-admin only — matches the UI's own gating ("Drupal ingest is platform-only"),
    // and the staged payload now carries the submitter's email/phone (PII rule): a plain
    // logged-in host must not be able to read another artist's contact info.
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
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
    const session = await db.get('SELECT id, poll_type, geo_mode, mode, status, deleted_at, series_id, drop_day, window_opens_at, window_closes_at FROM sessions WHERE id = ?', [participant.session_id]);
    // `roundId` is honored ONLY on a drop. A live client never sends it and the live branch
    // below is unchanged, so the existing live e2e section is this change's regression test.
    let round;
    if (isAsync(session)) {
      // Every record of the day is open at once, so there is no "the active round" to infer —
      // and inferring one would land the vote on the wrong record every time. Explicit id,
      // scoped to the caller's own session: the /api/comment precedent, verbatim.
      if (!body.roundId) return bad(res, 'Pick a record first');
      round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [body.roundId, participant.session_id]);
      if (!round) return bad(res, 'Round not found', 404);
      if (session.deleted_at || session.status === 'archived') return bad(res, 'This room is closed');
      if (round.status !== 'voting') return bad(res, 'Evaluation is not open');
      // The SESSION window is the single source of truth — deliberately not round.closes_at,
      // so an accidental per-record edit can never hold one record open longer than the rest.
      if (now() < Number(session.window_opens_at)) return bad(res, 'Evaluation is not open');
      if (now() >= Number(session.window_closes_at)) return bad(res, 'Time is up');
      if ((round.poll_type || 'rating') !== 'rating') return bad(res, 'A&R Daily is rating rounds only');
    } else {
      round = await activeRound(participant.session_id);
      if (!round || round.status !== 'voting') return bad(res, 'Evaluation is not open');
      if (round.closes_at && now() > Number(round.closes_at)) return bad(res, 'Time is up');
    }
    const existing = await db.get('SELECT id FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    if (existing) return bad(res, 'You already locked in');
    // Per-round poll type (the open round decides the vote shape); session is a fallback.
    const isBinary = (round.poll_type || (session && session.poll_type)) === 'binary';
    // Geo gate: when enforcement is on, a player must check in before their FIRST
    // lock-in. The client intercepts this code and shows the check-in prompt.
    // 'required' demands an at-venue check-in specifically — an 'online' pool from an
    // earlier optional phase doesn't count once the host tightens the mode; the player
    // is sent back through check-in (which upgrades them to in_person at the venue).
    // LIVE ONLY. A drop is by definition not at a venue — enforcing a check-in would lock
    // every remote A&R out of the primary points engine.
    if (!isAsync(session) && session && session.geo_mode && session.geo_mode !== 'off') {
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
    if (isAsync(session)) {
      // Awarded the moment the day is finished, so the tier reflects when they actually
      // finished rather than whenever a sweep happens to run. Two indexed COUNTs — bounded
      // and constant, not row-count-scaling, so this stays off the #1 rule's radar.
      const bonus = await maybeAwardCompletionBonus(participant, session);
      const prog = await asyncProgress(participant, session);
      return send(res, 200, { locked: true, bonus, ...prog });
    }
    return send(res, 200, { locked: true });
  }

  // ----- optional round comment (player) -----
  // After locking in, an A&R may leave ONE short note about the record. SEALED, exactly
  // like the vote split: no other player, no overlay, no public surface ever reads it.
  // "This one's a 9 for me" leaks vote direction as surely as the room average would, so
  // the only readers are the author and the host. There is no public read path.
  //
  // The write window deliberately does NOT slam shut at the reveal. Ratify swaps the
  // player's screen out from under the composer, and losing half-typed work there is the
  // fastest way to teach people not to bother — so a comment stays writable for as long
  // as the room is open. Requires a vote on that round (no lock-in, no comment).
  //
  // No points are awarded. Points on this board are accuracy-derived; paying for free
  // text would put non-accuracy points on a cash-prize board and reward volume over
  // quality — and every extra comment lands in the host's approval queue.
  // ----- report a record that cannot be evaluated (A&R Daily) -----
  // On a live show a dead link is obvious to the host within seconds. Across a 21-hour
  // window with nobody watching, the A&Rs are the only smoke detector — so this is a real
  // surface, not a support queue: two fixed reasons, and the optional body is advisory.
  if (p === '/api/report-round' && method === 'POST') {
    const participant = await participantFromReq(req);
    if (!participant) return bad(res, 'Not authenticated', 401);
    const { roundId, reason, body: rawBody } = await readBody(req);
    if (!roundId) return bad(res, 'Round required');
    if (!['not_playable', 'other'].includes(reason)) return bad(res, 'Unknown reason');
    // Scoped to THIS participant's session — the /api/comment precedent. A round id from
    // another room is not theirs to report.
    const round = await db.get('SELECT id, session_id FROM rounds WHERE id = ? AND session_id = ?',
      [roundId, participant.session_id]);
    if (!round) return bad(res, 'Round not found', 404);
    const note = (rawBody == null ? '' : String(rawBody)).trim().slice(0, 280) || null;
    const session = await db.get('SELECT * FROM sessions WHERE id = ?', [participant.session_id]);

    // THE CAP. A reported record counts as handled for the completion bonus (see
    // asyncHandled), so without a ceiling "report everything, collect the bonus" is the
    // dominant strategy. Counted per A&R per day and checked BEFORE the upsert, but a
    // re-report of a record they have already reported is an edit, not a new one — it must
    // not be refused just because they are at the cap.
    const already = await db.get(
      'SELECT id FROM round_reports WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    if (!already && isAsync(session)) {
      const h = await asyncHandled(participant, session);
      if (reportsLeftFor(h) <= 0) {
        return bad(res, `You can report ${reportCapFor(h.total)} ${reportCapFor(h.total) === 1 ? 'record' : 'records'} a day. Rate the rest to finish your day.`);
      }
    }

    // One report each, so the console's count is PEOPLE, not clicks — which is what makes
    // it a usable threshold for "pull this record".
    await db.run(
      `INSERT INTO round_reports (id, round_id, session_id, participant_id, reason, body, created_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT (round_id, participant_id)
       DO UPDATE SET reason = excluded.reason, body = excluded.body, created_at = excluded.created_at`,
      [id(9), round.id, round.session_id, participant.id, reason, note, now()]);
    const c = (await db.get('SELECT COUNT(*) AS c FROM round_reports WHERE round_id = ?', [round.id])).c;
    const out = { ok: true, reports: Number(c) || 0 };
    if (isAsync(session)) {
      // A report can be the last thing standing between an A&R and a finished day, so the
      // bonus is evaluated here too — same helper, same idempotency, same tier rule.
      out.bonus = await maybeAwardCompletionBonus(participant, session);
      Object.assign(out, await asyncProgress(participant, session));
    }
    return send(res, 200, out);
  }

  if (p === '/api/comment' && method === 'POST') {
    const participant = await participantFromReq(req);
    if (!participant) return bad(res, 'Not authenticated', 401);
    if (participant.user_id) {
      const pu = await db.get('SELECT blocked FROM users WHERE uid = ?', [participant.user_id]);
      if (pu && pu.blocked) return bad(res, 'This account has been suspended.', 403);
    }
    const { roundId, body: rawBody } = await readBody(req);
    if (!roundId) return bad(res, 'Round required');
    // Scope to THIS participant's session — a round id from another room is not theirs
    // to comment on. Also why the client sends an explicit round id rather than letting
    // the server infer the active round: once the host opens the next round, a Save from
    // a lingering results screen would otherwise land on the wrong record.
    const round = await db.get('SELECT id, session_id, poll_type FROM rounds WHERE id = ? AND session_id = ?', [roundId, participant.session_id]);
    if (!round) return bad(res, 'Round not found', 404);
    // Rating rounds only. A Versus round puts two songs head to head, so "the record" is
    // ambiguous — and the artist workflow already skips binary rounds entirely.
    if ((round.poll_type || 'rating') === 'binary') return bad(res, 'Versus rounds do not take comments');
    const sess = await db.get('SELECT status, deleted_at FROM sessions WHERE id = ?', [participant.session_id]);
    if (!sess || sess.deleted_at || sess.status === 'archived') return bad(res, 'This room is closed');
    const voted = await db.get('SELECT id FROM votes WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
    if (!voted) return bad(res, 'Lock in your vote first');

    const text = String(rawBody == null ? '' : rawBody).trim().slice(0, COMMENT_MAX);
    const ts = now();
    // Clearing the box deletes the comment outright — an empty row would otherwise sit
    // in the host's queue as a blank card forever.
    if (!text) {
      await db.run('DELETE FROM round_comments WHERE round_id = ? AND participant_id = ?', [round.id, participant.id]);
      return send(res, 200, { saved: true, body: '' });
    }
    // Comments are shared by DEFAULT (029) — the host rejects the occasional bad one
    // rather than approving every good one. An edit therefore stays shared, EXCEPT on a
    // comment the host already rejected: 'hidden' is sticky, or editing would be a
    // one-click way to undo a rejection.
    await db.run(
      `INSERT INTO round_comments (id, round_id, session_id, participant_id, body, status, created_at, updated_at)
       VALUES (?,?,?,?,?, 'shared', ?, ?)
       ON CONFLICT (round_id, participant_id)
       DO UPDATE SET body = excluded.body,
                     status = CASE WHEN round_comments.status = 'hidden' THEN 'hidden' ELSE 'shared' END,
                     updated_at = excluded.updated_at`,
      [id(9), round.id, round.session_id, participant.id, text, ts, ts]);
    return send(res, 200, { saved: true, body: text });
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

  // ===== EXTERNAL CONTROL (Stream Deck / any HTTP button) =====
  // A long-lived per-HOST key, so a deck is configured ONCE and never again: the key
  // resolves to whichever room that host currently has live (same live-then-upcoming
  // resolution the host-keyed overlay uses). Buttons are static URLs forever.
  //
  // GET is accepted deliberately. Stream Deck's built-in website action and most of its
  // HTTP plugins only do GET, and an endpoint the operator can't actually wire up is worth
  // nothing. The key may ride a header (preferred) or the query string (what the simple
  // plugins can manage) — same shape as the existing INGEST_TOKEN/ANALYTICS_TOKEN pattern.
  //
  // SCOPE IS ROUND CONTROL ONLY. These endpoints cannot read A&R contact details, touch
  // settings, or delete anything — so a key that leaks costs the operator a disrupted show,
  // not a data breach. It is revocable and regenerable from the console.
  if (p.startsWith('/api/control/')) {
    const given = (req.headers['x-control-key'] || url.searchParams.get('k') || url.searchParams.get('key') || '').toString();
    if (!given || given.length < 12) return send(res, 401, { error: 'Bad key' });
    // Compare in the DB by exact match (the column is uniquely indexed). A timing-safe
    // compare against every row would mean scanning the table on each press.
    const host = await db.get('SELECT uid, blocked FROM users WHERE control_key = ?', [given]);
    if (!host || host.blocked) return send(res, 401, { error: 'Bad key' });
    // Explicit room wins; otherwise the host's live room, then their soonest upcoming one.
    const wanted = url.searchParams.get('s') || url.searchParams.get('sessionId');
    const session = wanted
      ? await db.get('SELECT * FROM sessions WHERE id = ? AND owner_uid = ? AND deleted_at IS NULL', [wanted, host.uid])
      // Drops excluded from both: a Stream Deck is configured once and must keep resolving to
      // the show, not to whatever drop happens to be open on a Wednesday afternoon.
      : (await db.get("SELECT * FROM sessions WHERE owner_uid = ? AND status = 'live' AND deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') ORDER BY created_at DESC LIMIT 1", [host.uid])
        || await db.get("SELECT * FROM sessions WHERE owner_uid = ? AND status = 'upcoming' AND deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') ORDER BY (scheduled_at IS NULL), scheduled_at ASC, created_at DESC LIMIT 1", [host.uid]));
    if (!session) return send(res, 404, { error: 'No live room' });

    const act = p.slice('/api/control/'.length);
    // Read-only: what the next press would do. Safe on GET by any definition.
    if (act === 'state') {
      const stage = await nextStage(session.id);
      const r = stage.round;
      return send(res, 200, { room: session.name, action: stage.action, label: stage.label,
        round: r ? { idx: r.idx, status: r.status, song_title: r.song_title, closes_at: r.closes_at ? Number(r.closes_at) : null } : null });
    }
    if (act === 'advance') {
      const out = await advanceRoom(session, { minutes: url.searchParams.get('minutes') });
      return send(res, out.ok ? 200 : 400, out);
    }
    if (act === 'extend') {
      // An explicit ?s= can still point the deck at a drop even though the fallback lookups
      // exclude them — and activeRound() would hand back one arbitrary record of the day.
      // Moving the day's close is a session-level decision, not a per-record button.
      if (isAsync(session)) return send(res, 400, { error: 'A&R Daily runs on the clock — nothing to extend' });
      const round = await activeRound(session.id);
      if (!round || round.status !== 'voting') return send(res, 400, { error: 'No round is taking votes' });
      const mins = url.searchParams.get('minutes'), secs = url.searchParams.get('seconds');
      const add = (mins != null ? Number(mins) * 60 : (Number(secs) || 30)) * 1000;
      if (!Number.isFinite(add) || add <= 0 || add > 60 * 60 * 1000) return send(res, 400, { error: 'Bad duration' });
      const base = Math.max(Number(round.closes_at) || now(), now());
      await db.run("UPDATE rounds SET closes_at = ? WHERE id = ?", [base + add, round.id]);
      await realtime.publish(session.id, 'round');
      return send(res, 200, { ok: true, action: 'extend', added: add / 1000, closes_at: base + add });
    }
    return send(res, 404, { error: 'Unknown control action' });
  }

  // Mint / rotate / clear this host's control key. Returns the key in full ONLY here —
  // it's the one place the operator copies it from.
  if (p === '/api/me/control-key' && (method === 'POST' || method === 'GET' || method === 'DELETE')) {
    const user = await userFromAuth(req);
    if (!user) return bad(res, 'Sign in first', 401);
    if (method === 'GET') {
      const row = await db.get('SELECT control_key FROM users WHERE uid = ?', [user.uid]);
      return send(res, 200, { key: (row && row.control_key) || null });
    }
    if (method === 'DELETE') {
      await db.run('UPDATE users SET control_key = NULL WHERE uid = ?', [user.uid]);
      return send(res, 200, { key: null });
    }
    const key = 'k_' + id(18);
    await db.run('UPDATE users SET control_key = ? WHERE uid = ?', [key, user.uid]);
    return send(res, 200, { key });
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
      `SELECT r.id, r.idx, r.status, r.song_title, r.song_artist, r.song_note, r.giveaway, r.poll_type,
              r.option_b_title, r.option_b_artist, r.room_average, r.split_a, r.artist_email, r.artist_phone,
              r.play_url, r.artist_note, r.ingest_ref, r.ingest_url, r.scout_drupal_uid,
              (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id) AS votes,
              -- People, not clicks (uniq_round_report), which is what makes it a usable
              -- threshold for "pull this record".
              (SELECT COUNT(*) FROM round_reports rr WHERE rr.round_id = r.id) AS reports,
              (SELECT COUNT(*) FROM round_reports rr WHERE rr.round_id = r.id AND rr.reason = 'not_playable') AS reports_broken,
              (SELECT COUNT(*) FROM round_comments c WHERE c.round_id = r.id) AS comments,
              (SELECT COUNT(*) FROM round_comments c WHERE c.round_id = r.id AND c.status = 'shared') AS comments_shared,
              (SELECT COUNT(*) FROM round_comments c WHERE c.round_id = r.id AND c.status = 'hidden') AS comments_hidden,
              -- Per-round notice state drives the Rounds-tab 📨 button: whether it reads
              -- "send" or "resend", and whether the last attempt failed (and why).
              (SELECT n.status   FROM artist_notices n WHERE n.round_id = r.id AND n.channel = 'email') AS notice_email_status,
              (SELECT n.sent_at  FROM artist_notices n WHERE n.round_id = r.id AND n.channel = 'email') AS notice_email_at,
              (SELECT n.error    FROM artist_notices n WHERE n.round_id = r.id AND n.channel = 'email') AS notice_email_error,
              (SELECT n.status   FROM artist_notices n WHERE n.round_id = r.id AND n.channel = 'sms')   AS notice_sms_status,
              (SELECT n.sent_at  FROM artist_notices n WHERE n.round_id = r.id AND n.channel = 'sms')   AS notice_sms_at,
              (SELECT n.error    FROM artist_notices n WHERE n.round_id = r.id AND n.channel = 'sms')   AS notice_sms_error
         FROM rounds r WHERE r.session_id = ? ORDER BY r.idx ASC`, [sessionId]);
    // Artist contact is host-facing only (it's how they reach the artist post-show) and
    // this endpoint is already admin/owner-gated — it never reaches a public surface.
    return send(res, 200, { rounds: rounds.map(r => ({
      id: r.id, idx: r.idx, status: r.status, song_title: r.song_title, song_artist: r.song_artist,
      song_note: r.song_note || '', giveaway: r.giveaway || '', poll_type: r.poll_type || 'rating',
      option_b_title: r.option_b_title || null, option_b_artist: r.option_b_artist || null,
      room_average: r.room_average != null ? Number(r.room_average) : null,
      split_a: r.split_a != null ? Number(r.split_a) : null,
      artist_email: r.artist_email || '', artist_phone: r.artist_phone || '',
      // The console's mid-window repair kit: the link to fix, the artist's ask to read, and
      // a deep link back to the submission in Drupal for the non-urgent corrections.
      play_url: r.play_url || '', artist_note: r.artist_note || '',
      ingest_ref: r.ingest_ref || null, ingest_url: r.ingest_url || null,
      // The scout's DRUPAL uid is deliberately not emitted — the console shows who found a
      // record by display name, and that lookup belongs on a profile surface, not here.
      scouted: !!r.scout_drupal_uid,
      votes: Number(r.votes) || 0,
      reports: Number(r.reports) || 0,
      reports_broken: Number(r.reports_broken) || 0,
      comments: Number(r.comments) || 0,
      comments_shared: Number(r.comments_shared) || 0,
      comments_hidden: Number(r.comments_hidden) || 0,
      notice: {
        email: r.notice_email_status
          ? { status: r.notice_email_status, at: r.notice_email_at != null ? Number(r.notice_email_at) : null, error: r.notice_email_error || null }
          : null,
        sms: r.notice_sms_status
          ? { status: r.notice_sms_status, at: r.notice_sms_at != null ? Number(r.notice_sms_at) : null, error: r.notice_sms_error || null }
          : null,
      },
    })),
    // Rides along so the per-round resend dialog can warn that a text will be held,
    // without hardcoding the window in the client or spending a request to ask.
    smsWindow: { open: withinSmsWindow(), from: SMS_WINDOW_START_LABEL, to: SMS_WINDOW_END_LABEL },
    });
  }

  // ----- round comments: the host's moderation queue (admin/owner only) -----
  // The ONLY read path for comment bodies besides the author's own. Comments are 'shared'
  // by default (029) — this queue is where the host REJECTS the occasional bad one, not
  // where they approve the good ones. PII surface matches the public boards exactly —
  // display name, role, city. Never the commenter's email or phone.
  if (p === '/api/admin/comments' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const rows = await db.all(
      `SELECT c.id, c.round_id, c.body, c.status, c.updated_at,
              p.name AS pname, u.name AS uname, u.primary_category, u.location,
              u.photo_url, COALESCE(u.blocked, 0) AS blocked, v.taste
         FROM round_comments c
         JOIN participants p ON p.id = c.participant_id
         LEFT JOIN users u ON u.uid = p.user_id
         LEFT JOIN votes v ON v.round_id = c.round_id AND v.participant_id = c.participant_id
        WHERE c.session_id = ?
        ORDER BY c.created_at ASC`, [sessionId]);
    return send(res, 200, { comments: rows.map(r => ({
      id: r.id, round_id: r.round_id, body: r.body, status: r.status,
      name: (r.uname || r.pname || 'A&R').toString().trim().slice(0, 40),
      role: r.primary_category || null,
      location: r.location || null,
      photo: r.photo_url || null,
      taste: r.taste != null ? Number(r.taste) : null,
      blocked: !!Number(r.blocked),
      updated_at: Number(r.updated_at),
    })) });
  }

  // Reject one comment, or every comment on a round ("Reject all" / "Restore all").
  // Exactly two states: 'shared' (the default — goes to the artist) and 'hidden' (the
  // host rejected it). 027's 'pending' was retired in 029 — a status that still gates
  // sends but nothing produces reads as "held for review" while meaning "unreachable".
  if (p === '/api/admin/comment' && method === 'POST') {
    const { sessionId, commentId, roundId, status } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (!['shared', 'hidden'].includes(status)) return bad(res, 'Bad status');
    let r;
    if (commentId) {
      r = await db.run('UPDATE round_comments SET status = ? WHERE id = ? AND session_id = ?', [status, commentId, sessionId]);
    } else if (roundId) {
      r = await db.run('UPDATE round_comments SET status = ? WHERE round_id = ? AND session_id = ?', [status, roundId, sessionId]);
    } else return bad(res, 'commentId or roundId required');
    return send(res, 200, { ok: true, changed: r.changes || 0 });
  }

  // ===== MASS NOTIFY (admin role only): email/SMS announcement to ALL users =====
  // Chunked-queue pattern (same as recap emails): start builds the queue in two
  // set-based INSERT..SELECTs; the panel then drives small process batches.
  if (p === '/api/admin/notify/audience' && method === 'GET') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    // email_opt_out (028) is the global kill switch every unsubscribe link sets. Without
    // it here, an A&R who unsubscribed would still be counted — and still be mailed.
    const em = (await db.get("SELECT COUNT(*) AS c FROM users WHERE COALESCE(blocked,0) = 0 AND COALESCE(email_opt_out,0) = 0 AND email IS NOT NULL AND email != ''")).c;
    const sm = (await db.get("SELECT COUNT(*) AS c FROM users WHERE COALESCE(blocked,0) = 0 AND sms_marketing_consent = 1 AND phone IS NOT NULL AND LENGTH(phone) >= 7")).c;
    return send(res, 200, { email: Number(em) || 0, sms: Number(sm) || 0 });
  }

  // Subscription readout for the Platform panel (028): who would actually receive each
  // topic right now. This is how the operator can see the contact center working before
  // any digest sender exists. A handful of bounded COUNT(*)s, admin-triggered only —
  // never on the boot or poll path.
  if (p === '/api/admin/notify/topics' && method === 'GET') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const topics = [];
    for (const [key, spec] of Object.entries(NOTIFY_TOPICS)) {
      const counts = {};
      for (const channel of Object.keys(spec.channels)) {
        counts[channel] = { count: await notifyAudienceCount(key, channel), default: !!spec.channels[channel] };
      }
      topics.push({ key, label: spec.label, channels: counts });
    }
    const optedOut = Number((await db.get('SELECT COUNT(*) AS c FROM users WHERE COALESCE(email_opt_out,0) = 1')).c) || 0;
    const explicit = Number((await db.get('SELECT COUNT(DISTINCT uid) AS c FROM notify_prefs')).c) || 0;
    // Boolean only — never the secret itself.
    return send(res, 200, { topics, emailOptedOut: optedOut, withExplicitPrefs: explicit,
      manageLinksConfigured: !!notifyLinkSecret() });
  }
  if (p === '/api/admin/notify/start' && method === 'POST') {
    const admin = await platformAdmin(req);
    if (!admin) return bad(res, 'Admin only', 403);
    const body = await readBody(req);
    const message = (body.message || '').toString().trim().slice(0, 1000);
    const subject = (body.subject || '').toString().trim().slice(0, 150);
    const wantEmail = !!body.email, wantSms = !!body.sms;
    if (!message) return bad(res, 'Write the message first');
    if (!wantEmail && !wantSms) return bad(res, 'Pick at least one channel');
    if (wantEmail && !subject) return bad(res, 'Email needs a subject');
    const bcId = id(9);
    await db.run('INSERT INTO notify_broadcasts (id, subject, message, channels, created_by, status, created_at) VALUES (?,?,?,?,?,?,?)',
      [bcId, subject || null, message, [wantEmail && 'email', wantSms && 'sms'].filter(Boolean).join('+'), admin.uid, 'sending', now()]);
    if (wantEmail) await db.run(
      `INSERT INTO notify_recipients (broadcast_id, uid, channel, dest)
         SELECT ?, uid, 'email', email FROM users
          WHERE COALESCE(blocked,0) = 0 AND COALESCE(email_opt_out,0) = 0
            AND email IS NOT NULL AND email != ''`, [bcId]);
    if (wantSms) await db.run(
      `INSERT INTO notify_recipients (broadcast_id, uid, channel, dest)
         SELECT ?, uid, 'sms', phone FROM users
          WHERE COALESCE(blocked,0) = 0 AND sms_marketing_consent = 1 AND phone IS NOT NULL AND LENGTH(phone) >= 7`, [bcId]);
    const q = (await db.get("SELECT COUNT(*) AS c FROM notify_recipients WHERE broadcast_id = ? AND status = 'pending'", [bcId])).c;
    return send(res, 200, { broadcastId: bcId, queued: Number(q) || 0 });
  }
  if (p === '/api/admin/notify/process' && method === 'POST') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const { broadcastId, limit } = await readBody(req);
    const bc = await db.get('SELECT * FROM notify_broadcasts WHERE id = ?', [broadcastId]);
    if (!bc) return bad(res, 'Broadcast not found', 404);
    const n = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 20);
    const batch = await db.all("SELECT * FROM notify_recipients WHERE broadcast_id = ? AND status = 'pending' LIMIT ?", [broadcastId, n]);
    let sentN = 0, failedN = 0;
    const base = publicBaseFromReq(req);
    // The footer is per-recipient (the manage link is signed with their uid), so the body
    // is built inside the loop. Note the SMS branch previously carried NO opt-out language
    // at all, unlike the go-live and artist texts — smsFooter() fixes that too.
    const htmlFor = (manage) => `<div style="background:#0d0b16;padding:32px 20px;font-family:sans-serif">
      <div style="max-width:520px;margin:0 auto;background:#171328;border:1px solid #2e2750;border-radius:16px;padding:26px">
        <p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#4bb749;font-weight:700;margin:0 0 14px">The A&amp;R Room</p>
        <div style="font-size:15px;line-height:1.6;color:#f3f0fb">${escapeHtml(bc.message).replace(/\n/g, '<br>')}</div>
        <p style="font-size:12px;color:#6f688f;margin:22px 0 0">Makin' It Magazine · The A&amp;R Room · <a href="https://anr.makinitmag.com" style="color:#6d5fe0">anr.makinitmag.com</a></p>
        ${notifyFooterHtml(manage)}
      </div></div>`;
    for (const r of batch) {
      const manage = notifyManageUrl(base, r.uid);
      const out = r.channel === 'email'
        ? await sendEmail(r.dest, bc.subject || 'The A&R Room', htmlFor(manage), `${bc.message}\n\n${notifyFooterText(manage)}`)
        : await sendSms(r.dest, `${bc.message}\n${smsFooter(manage)}`);
      if (out.ok) { sentN++; await db.run("UPDATE notify_recipients SET status = 'sent', sent_at = ? WHERE broadcast_id = ? AND uid = ? AND channel = ?", [now(), broadcastId, r.uid, r.channel]); }
      else { failedN++; await db.run("UPDATE notify_recipients SET status = 'failed', error = ? WHERE broadcast_id = ? AND uid = ? AND channel = ?", [(out.error || 'send failed').slice(0, 200), broadcastId, r.uid, r.channel]); }
    }
    const remaining = Number((await db.get("SELECT COUNT(*) AS c FROM notify_recipients WHERE broadcast_id = ? AND status = 'pending'", [broadcastId])).c) || 0;
    if (!remaining) await db.run("UPDATE notify_broadcasts SET status = 'done' WHERE id = ?", [broadcastId]);
    const totals = await db.get("SELECT SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM notify_recipients WHERE broadcast_id = ?", [broadcastId]);
    return send(res, 200, { sent: Number(totals.sent) || 0, failed: Number(totals.failed) || 0, remaining });
  }

  // ===== PLATFORM ANALYTICS (admin role only) — traction/engagement dashboard =====
  // Cross-session engagement + RETENTION over the most recent N shows. This is the one
  // thing the per-session anonymized exports can't answer (their Player-N ids don't span
  // sessions); here we compute retention off the durable users.uid behind each participant.
  // PII-safe by construction: emits only counts/aggregates (+ non-PII room names), never
  // any name/email/phone/uid. Admin-triggered, bounded to the window, off every hot path —
  // NOT on the boot/poll path (the #1 rule). Every query rides an existing index
  // (idx_round_session, idx_votes_round, idx_part_session).
  // ---- Charts: ranked records / A&Rs over a series, date range, or the last N rooms ----
  // Platform-admin only. It spans EVERY room regardless of owner, so it is not a host tool;
  // a per-host flavour would need the scope query filtered by owner_uid first.
  // ?format=csv returns the same rows as a download; ?format=caption returns the IG text.
  if (p === '/api/admin/charts' && method === 'GET') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const q = chartQuery(url);
    const data = await chartsData(q);
    if (!data) return bad(res, 'Scope not found', 404);
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const slug = (data.title + '-' + data.scope.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (format === 'csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}.csv"` });
      return res.end(chartsCsv(data));
    }
    if (format === 'caption') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(chartsCaption(data));
    }
    return send(res, 200, data);
  }

  if (p === '/api/admin/analytics' && method === 'GET') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const window = Math.max(1, Math.min(52, parseInt(url.searchParams.get('window') || '12', 10) || 12));
    // Recent non-deleted sessions (small table; capped). We keep the most recent `window`
    // that actually ran (>=1 vote), so empty upcoming rooms never pollute the traction view.
    const cand = await db.all(
      'SELECT id, name, created_at, poll_type FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200', []);
    if (!cand.length) return send(res, 200, { window, generatedAt: Date.now(), shows: [], overview: { shows: 0, uniqueARs: 0, returningARs: 0, returningRate: 0, registrations: 0, totalVotes: 0, avgActivePerShow: 0, activationPct: null, avgDepth: 0, strongReadPct: 0, bullseyePct: 0, creditedReferrals: 0 }, retention: { histogram: [], uniqueARs: 0, returningARs: 0, returningRate: 0 }, accuracy: { bullseye: 0, sharp: 0, close: 0, off: 0, wayoff: 0, total: 0 } });
    const candIds = cand.map(s => s.id);
    const ph = candIds.map(() => '?').join(',');
    // Which candidates have any votes (via the indexed rounds->votes path), newest first.
    const voteCounts = await db.all(
      `SELECT r.session_id AS sid, COUNT(v.id) AS c
         FROM rounds r JOIN votes v ON v.round_id = r.id
        WHERE r.session_id IN (${ph}) GROUP BY r.session_id`, candIds);
    const vcMap = new Map(voteCounts.map(r => [r.sid, Number(r.c) || 0]));
    const winSessions = cand.filter(s => (vcMap.get(s.id) || 0) > 0).slice(0, window);
    if (!winSessions.length) return send(res, 200, { window, generatedAt: Date.now(), shows: [], overview: { shows: 0, uniqueARs: 0, returningARs: 0, returningRate: 0, registrations: 0, totalVotes: 0, avgActivePerShow: 0, activationPct: null, avgDepth: 0, strongReadPct: 0, bullseyePct: 0, creditedReferrals: 0 }, retention: { histogram: [], uniqueARs: 0, returningARs: 0, returningRate: 0 }, accuracy: { bullseye: 0, sharp: 0, close: 0, off: 0, wayoff: 0, total: 0 } });
    const ids = winSessions.map(s => s.id);
    const wph = ids.map(() => '?').join(',');
    // One pass over the window's votes (indexed by round->session): carries the session,
    // the round idx (for the in-show fill curve), the participant (active + retention),
    // and the tier (accuracy). Everything else aggregates from this in JS.
    const voteRows = await db.all(
      `SELECT r.session_id AS sid, r.idx AS idx, v.participant_id AS pid, v.tier AS tier
         FROM votes v JOIN rounds r ON v.round_id = r.id
        WHERE r.session_id IN (${wph})`, ids);
    const partRows = await db.all(
      `SELECT id, session_id, user_id, verified, ref_credited FROM participants WHERE session_id IN (${wph})`, ids);
    const roundRows = await db.all(
      `SELECT session_id AS sid, COUNT(*) AS c FROM rounds
        WHERE session_id IN (${wph}) AND status = 'ratified' GROUP BY session_id`, ids);

    const pidToUser = new Map(partRows.map(p => [p.id, p.user_id || ('anon:' + p.id)]));
    const regBySession = new Map();
    const credBySession = new Map();
    for (const p of partRows) {
      if (p.verified === 1 || p.verified === true) regBySession.set(p.session_id, (regBySession.get(p.session_id) || 0) + 1);
      if (p.ref_credited === 1 || p.ref_credited === true) credBySession.set(p.session_id, (credBySession.get(p.session_id) || 0) + 1);
    }
    const ratifiedBySession = new Map(roundRows.map(r => [r.sid, Number(r.c) || 0]));

    // Per-session accumulation.
    const per = new Map(ids.map(id => [id, { votes: 0, tiers: {}, activePids: new Set(), roundCounts: new Map() }]));
    const TIERS = ['bullseye', 'sharp', 'close', 'off', 'wayoff'];
    const accuracy = { bullseye: 0, sharp: 0, close: 0, off: 0, wayoff: 0, total: 0 };
    const userShows = new Map(); // durable uid -> Set(session ids active in)
    for (const v of voteRows) {
      const s = per.get(v.sid); if (!s) continue;
      s.votes++;
      s.activePids.add(v.pid);
      s.roundCounts.set(v.idx, (s.roundCounts.get(v.idx) || 0) + 1);
      const t = TIERS.includes(v.tier) ? v.tier : null;
      if (t) { s.tiers[t] = (s.tiers[t] || 0) + 1; accuracy[t]++; accuracy.total++; }
      const uid = pidToUser.get(v.pid);
      if (uid) { let set = userShows.get(uid); if (!set) { set = new Set(); userShows.set(uid, set); } set.add(v.sid); }
    }

    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    // Build show rows in chronological order (oldest -> newest) so the trend reads left-to-right.
    const shows = winSessions.slice().reverse().map(s => {
      const acc = per.get(s.id);
      const active = acc.activePids.size;
      const ratified = ratifiedBySession.get(s.id) || 0;
      const registered = regBySession.get(s.id) || 0;
      const idxs = [...acc.roundCounts.keys()].sort((a, b) => a - b);
      const counts = idxs.map(i => acc.roundCounts.get(i));
      const third = Math.max(1, Math.floor(idxs.length / 3));
      return {
        name: s.name, date: Number(s.created_at) || null, pollType: s.poll_type === 'binary' ? 'binary' : 'rating',
        registered, active, activationPct: registered ? Math.round(active / registered * 100) : null,
        votes: acc.votes, rounds: ratified,
        avgPerRound: ratified ? Math.round(acc.votes / ratified * 10) / 10 : 0,
        depth: active ? Math.round(acc.votes / active * 10) / 10 : 0,
        firstThird: counts.length ? Math.round(mean(counts.slice(0, third)) * 10) / 10 : 0,
        lastThird: counts.length ? Math.round(mean(counts.slice(-third)) * 10) / 10 : 0,
        creditedReferrals: credBySession.get(s.id) || 0,
        tiers: TIERS.reduce((o, t) => (o[t] = acc.tiers[t] || 0, o), {}),
      };
    });

    // Retention: how many of the window's shows each durable A&R was active in.
    const showCounts = [...userShows.values()].map(set => set.size);
    const uniqueARs = showCounts.length;
    const returningARs = showCounts.filter(n => n >= 2).length;
    const maxK = shows.length;
    const histogram = [];
    for (let k = 1; k <= maxK; k++) histogram.push({ shows: k, count: showCounts.filter(n => n === k).length });

    const totalVotes = shows.reduce((a, s) => a + s.votes, 0);
    const totalActive = shows.reduce((a, s) => a + s.active, 0);
    const totalReg = shows.reduce((a, s) => a + s.registered, 0);
    const overview = {
      shows: shows.length,
      uniqueARs, returningARs,
      returningRate: uniqueARs ? Math.round(returningARs / uniqueARs * 100) : 0,
      registrations: totalReg,
      totalVotes,
      avgActivePerShow: shows.length ? Math.round(totalActive / shows.length * 10) / 10 : 0,
      activationPct: totalReg ? Math.round(totalActive / totalReg * 100) : null,
      avgDepth: totalActive ? Math.round(totalVotes / totalActive * 10) / 10 : 0,
      strongReadPct: accuracy.total ? Math.round((accuracy.bullseye + accuracy.sharp) / accuracy.total * 100) : 0,
      bullseyePct: accuracy.total ? Math.round(accuracy.bullseye / accuracy.total * 100) : 0,
      creditedReferrals: shows.reduce((a, s) => a + s.creditedReferrals, 0),
    };
    return send(res, 200, { window, generatedAt: Date.now(), shows, overview, retention: { histogram, uniqueARs, returningARs, returningRate: overview.returningRate }, accuracy });
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
        reviveZoneGame: (await db.get("SELECT v FROM settings WHERE k = 'revive_zone_game'"))?.v || null,
        asanaProject: (await db.get("SELECT v FROM settings WHERE k = 'asana_project'"))?.v || null },
      smsProvider: (process.env.SMS_PROVIDER || 'none'),
      // The PAT itself is an env var and never leaves the server — only whether it's set.
      asanaToken: !!process.env.ASANA_TOKEN,
      cronConfigured: !!process.env.CRON_SECRET,
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
    // Asana project gid for the post kit (digits; the PAT itself is ASANA_TOKEN in env).
    if ('asanaProject' in body) await setOrClear('asana_project', (body.asanaProject || '').toString().trim().replace(/\D/g, '').slice(0, 30) || null);
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
    const isBinary = (round.poll_type || session.poll_type) === 'binary';
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
    const { sessionId, song_title, song_artist, song_note, giveaway, option_b_title, option_b_artist, poll_type,
      artist_email, artist_phone, roundId, pack_song_a, pack_song_b } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    // A drop's records arrive as one approved batch from Drupal and are numbered at insert.
    // Hand-adding here would either auto-open into a running window or land a pending round
    // the lifecycle never picks up — and either way it breaks the day's idx sequence.
    if (isAsync(session)) return bad(res, 'A&R Daily records come from the approved daily push, not the queue form', 409);
    // `roundId` = "this form is already a queued round" — the console sends it when the form
    // was auto-filled from a review-site push, which stages the record server-side. Without
    // it, pressing Add would queue a SECOND copy of the song already sitting on deck. Scoped
    // to PENDING rounds in this room, so it can never rewrite one that's playing or ratified;
    // an unknown/stale id falls through to a normal insert rather than erroring at the host
    // mid-show. Everything below (open-if-idle, poll-type resolution) is shared.
    let bound = null;
    if (roundId) bound = await db.get("SELECT * FROM rounds WHERE id = ? AND session_id = ? AND status = 'pending'", [roundId, sessionId]);
    // Poll type is PER-ROUND now. Resolve it: explicit body value → the session's most
    // recent round's type (so it persists round-to-round) → the session default → rating.
    let pt = poll_type === 'binary' ? 'binary' : (poll_type === 'rating' ? 'rating' : null);
    if (!pt) {
      const last = await db.get('SELECT poll_type FROM rounds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1', [sessionId]);
      pt = (last && last.poll_type) || (session.poll_type === 'binary' ? 'binary' : 'rating');
    }
    const isBinary = pt === 'binary';
    // Sidebet (033): a binary matchup queued FROM the service pack carries the two
    // pack_song ids, which is what lets the played set derive at settle instead of the
    // host re-ticking 18 boxes. Validated against the pack actually linked to THIS room
    // — an id from another pack would silently mark the wrong song as played, and that
    // decides a cash prize. A round is never rejected over this: an unrecognised id is
    // dropped and the host confirms by hand, which the settle checklist already expects.
    let packA = null, packB = null;
    if (isBinary && (pack_song_a || pack_song_b)) {
      const linked = await db.get("SELECT id FROM packs WHERE session_id = ? AND status <> 'settled' ORDER BY created_at DESC LIMIT 1", [sessionId]);
      if (linked) {
        const okSong = async (sid) => {
          if (!sid) return null;
          const r = await db.get('SELECT id FROM pack_songs WHERE id = ? AND pack_id = ?', [sid, linked.id]);
          return r ? r.id : null;
        };
        packA = await okSong(pack_song_a);
        packB = await okSong(pack_song_b);
      }
    }
    if (!song_title || !song_title.trim()) return bad(res, (isBinary ? 'Song A title required' : 'Song title required'));
    // Binary rounds need both sides; Song A reuses song_title/song_artist.
    if (isBinary && (!option_b_title || !option_b_title.trim())) return bad(res, 'Song B title required');
    // Queued songs don't get a round number (idx) until they're actually opened —
    // they're played in queue order, which may differ from the order added.
    const rid = bound ? bound.id : id(9);
    if (bound) {
      // Same fields, written over the record already on deck — the host's edits win over what
      // the review site pushed. queue_pos is left alone so a reordered queue stays reordered.
      await db.run(
        `UPDATE rounds SET poll_type = ?, song_title = ?, song_artist = ?, song_note = ?, giveaway = ?,
           option_b_title = ?, option_b_artist = ?, artist_email = ?, artist_phone = ?,
           pack_song_a = ?, pack_song_b = ? WHERE id = ?`,
        [pt, song_title.trim(), (song_artist || '').trim(), (song_note || '').trim(), (giveaway || '').trim(),
         isBinary ? (option_b_title || '').trim() : null, isBinary ? (option_b_artist || '').trim() : null,
         cleanArtistEmail(artist_email), cleanArtistPhone(artist_phone), packA, packB, rid]
      );
    } else {
      const maxPos = (await db.get("SELECT COALESCE(MAX(queue_pos),0) AS m FROM rounds WHERE session_id = ? AND status = 'pending'", [sessionId])).m;
      await db.run(
        `INSERT INTO rounds (id, session_id, idx, queue_pos, poll_type, song_title, song_artist, song_note, giveaway, option_b_title, option_b_artist, artist_email, artist_phone, pack_song_a, pack_song_b, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
        [rid, sessionId, 0, Number(maxPos) + 1, pt, song_title.trim(), (song_artist || '').trim(), (song_note || '').trim(), (giveaway || '').trim(),
         isBinary ? (option_b_title || '').trim() : null, isBinary ? (option_b_artist || '').trim() : null,
         cleanArtistEmail(artist_email), cleanArtistPhone(artist_phone), packA, packB, now()]
      );
    }
    // Straight to open unless a round is already in play — then it waits in the queue.
    // Removes the mandatory add-then-open two-step for the common case. As of 030 "open"
    // means LISTENING: the record goes up and the room hears it, and the host presses
    // Advance to start the clock. Opening straight into voting would start a countdown
    // before anyone had heard the song, which is the thing staging exists to prevent.
    const inPlay = await db.get("SELECT id FROM rounds WHERE session_id = ? AND status IN ('listening','voting','closed')", [sessionId]);
    if (!inPlay) {
      const started = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('listening','voting','closed','ratified')", [sessionId])).c;
      await db.run("UPDATE rounds SET status = 'listening', idx = ?, opens_at = ?, closes_at = NULL WHERE id = ?",
        [Number(started) + 1, now(), rid]);
      if (session.status === 'upcoming') await db.run("UPDATE sessions SET status = 'live', scheduled_at = COALESCE(scheduled_at, ?) WHERE id = ?", [now(), sessionId]);
      await realtime.publish(sessionId, 'round');
      return send(res, 200, { roundId: rid, opened: true, status: 'listening' });
    }
    return send(res, 200, { roundId: rid, opened: false });
  }

  // ---- the staged advance: one action drives the whole show ----
  // Open Round -> Open Voting -> Ratify -> Open Round. The console's big button and the
  // Stream Deck both land here (via /api/control/advance), so they can never disagree.
  // Ratify needs two presses; the first returns confirmNeeded and changes nothing.
  if (p === '/api/admin/advance' && method === 'POST') {
    const { sessionId, minutes } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const out = await advanceRoom(session, { minutes });
    return send(res, out.ok ? 200 : 400, out);
  }

  // What the next Advance press will do, without doing it. Lets the console label its button
  // from the same source of truth the press itself uses.
  if (p === '/api/admin/advance/state' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const stage = await nextStage(sessionId);
    return send(res, 200, { action: stage.action, label: stage.label,
      round: stage.round ? { id: stage.round.id, idx: stage.round.idx, status: stage.round.status, song_title: stage.round.song_title } : null });
  }

  // Start the clock on a listening round. This is the 'vote' stage of advance, exposed
  // directly so the console can offer it with an explicit duration.
  if (p === '/api/admin/round/start-voting' && method === 'POST') {
    const { sessionId, roundId, minutes } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (refuseOnDrop(res, session)) return;
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status !== 'listening') return bad(res, 'That round is not on deck');
    const dur = clampMinutes(minutes != null ? minutes
      : (session.default_minutes != null ? session.default_minutes : DEFAULT_MINUTES)) * 60 * 1000;
    const closes = now() + dur;
    await db.run("UPDATE rounds SET status = 'voting', closes_at = ? WHERE id = ?", [closes, roundId]);
    await clearAdvanceArm(sessionId);
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true, closes_at: closes });
  }

  // Send a listening round back to the queue — the host opened the wrong song. Only before
  // voting starts; once a clock has run there are votes to protect.
  if (p === '/api/admin/round/unopen' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (refuseOnDrop(res, session)) return;
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (round.status !== 'listening') return bad(res, 'Only a round that has not started voting can go back to the queue');
    await db.run("UPDATE rounds SET status = 'pending', idx = 0, opens_at = NULL, closes_at = NULL WHERE id = ?", [roundId]);
    await clearAdvanceArm(sessionId);
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
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

  // Remove a round. Two jobs behind one endpoint:
  //   * a PENDING (queued) song — pull it back off the queue, as always.
  //   * a round that actually STARTED but drew ZERO evaluations — the accident case: the
  //     host leans on Advance and a record gets opened, closed and ratified with nobody
  //     voting. There is no history worth keeping, and it otherwise sits in the round
  //     numbering, the Rounds tab and the artist-notice surfaces forever.
  // A round WITH votes is never deletable here: those points are somebody's score on a
  // cash-prize board, and vaporising them is not an undo. Soft-delete the room instead.
  if (p === '/api/admin/round/delete' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    const votes = Number((await db.get('SELECT COUNT(*) AS c FROM votes WHERE round_id = ?', [roundId])).c) || 0;
    if (round.status !== 'pending' && votes > 0) {
      return bad(res, `This round has ${votes} evaluation${votes === 1 ? '' : 's'} — only a round nobody voted on can be deleted`);
    }
    await db.tx(async (tx) => {
      // A comment needs a locked-in vote, so a zero-vote round shouldn't have any — clear
      // them (and any queued artist notice) anyway so nothing is left orphaned by id.
      await tx.run('DELETE FROM round_comments WHERE round_id = ?', [roundId]);
      await tx.run('DELETE FROM artist_notices WHERE round_id = ?', [roundId]);
      await tx.run('DELETE FROM votes WHERE round_id = ?', [roundId]);
      await tx.run('DELETE FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
      // Close the gap in the numbering. idx is assigned at open as (started rounds)+1, so
      // a hole would make the NEXT round reuse a number already on the board.
      if (round.status !== 'pending' && round.idx) {
        await tx.run("UPDATE rounds SET idx = idx - 1 WHERE session_id = ? AND idx > ? AND status IN ('listening','voting','closed','ratified')",
          [sessionId, round.idx]);
      }
      // A DROP numbers its records at insert rather than at open, so pulling one out of a
      // day still being built leaves a hole the operator can see ("Record 1, 2, 4"). Close
      // it too — but only for async, because a live room's pending rounds are an unnumbered
      // queue ordered by queue_pos and renumbering them would mean nothing.
      if (round.status === 'pending' && round.idx && isAsync(session)) {
        await tx.run("UPDATE rounds SET idx = idx - 1, queue_pos = queue_pos - 1 WHERE session_id = ? AND idx > ? AND status = 'pending'",
          [sessionId, round.idx]);
      }
    });
    // An arm pointing at a round that no longer exists must not survive to tally the next one.
    if (session.advance_armed_round === roundId) await clearAdvanceArm(sessionId);
    // Deleting a started round changes what every player is looking at (the live record, or
    // the results screen they're on), so push — a queued removal is host-only.
    if (round.status !== 'pending') await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true, status: round.status, idx: round.idx || null });
  }

  if (p === '/api/admin/round/open' && method === 'POST') {
    const { sessionId, roundId, minutes } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (refuseOnDrop(res, session)) return;
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    // Don't open a new round while another is mid-flight (voting or awaiting tally).
    const inPlay = await db.get("SELECT id FROM rounds WHERE session_id = ? AND status IN ('listening','voting','closed') AND id != ?", [sessionId, roundId]);
    if (inPlay) return bad(res, 'Close and tally the current round first');
    // Assign the real round number now, at open time = number of rounds already started + 1.
    let idx = round.idx;
    if (!idx || round.status === 'pending') {
      const started = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('listening','voting','closed','ratified')", [sessionId])).c;
      idx = Number(started) + 1;
    }
    // Voting window in minutes, clamped to 2–60.
    const dur = clampMinutes(minutes != null ? minutes : DEFAULT_MINUTES) * 60 * 1000;
    await db.run("UPDATE rounds SET status = 'voting', idx = ?, opens_at = ?, closes_at = ? WHERE id = ?",
      [idx, now(), now() + dur, roundId]);
    // Opening a round on an 'upcoming' (pre-registration) session takes it live.
    if (session.status === 'upcoming') {
      await db.run("UPDATE sessions SET status = 'live', scheduled_at = COALESCE(scheduled_at, ?) WHERE id = ?", [now(), sessionId]);
    }
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/extend' && method === 'POST') {
    const { sessionId, roundId, minutes, seconds } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (refuseOnDrop(res, session)) return;
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
    if (refuseOnDrop(res, session)) return;
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
    if (refuseOnDrop(res, session)) return;
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

  // Edit a song's details — at ANY status, including ratified. Only DESCRIPTIVE fields are
  // writable here (title/artist/note/giveaway/B-side/contact); votes, room_average, points
  // and tiers are never touched, so editing a tallied round can't move a score or a board.
  // Ratified edits exist for the post-show artist workflow: fix a typo, or add the artist's
  // email/phone retroactively so they can be sent their report card. Cards + reports render
  // live from current data, so an edit is picked up by the next render automatically.
  if (p === '/api/admin/round/edit' && method === 'POST') {
    const { sessionId, roundId, song_title, song_artist, song_note, giveaway, option_b_title, option_b_artist,
      artist_email, artist_phone, play_url, artist_note } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    if (song_title !== undefined && !String(song_title).trim()) return bad(res, 'Song title can\'t be empty');
    // play_url joins the DESCRIPTIVE allowlist — this route has never been able to touch
    // votes, points or status and still cannot. It earns its place because of one scenario:
    // a dead link at 12:05 PM is a dead record for the next 21 hours, nobody is watching the
    // way a host watches a live show, and the fix cannot round-trip through a CMS. This is
    // the single most operationally important thing the daily console does.
    if (play_url !== undefined && String(play_url).trim() && !cleanPlayUrl(play_url)) {
      return bad(res, 'That play link needs to be a full http(s) URL');
    }
    const isBinary = (round.poll_type || session.poll_type) === 'binary';
    if (isBinary && option_b_title !== undefined && !String(option_b_title).trim()) return bad(res, 'Song B title can\'t be empty');
    if (artist_email !== undefined && String(artist_email).trim() && !cleanArtistEmail(artist_email)) {
      return bad(res, 'That artist email doesn\'t look like an address');
    }
    // Contact fields are PATCH-style (only written when the caller sends them), so an
    // older client that doesn't know about them can't blank them out.
    await db.run(
      `UPDATE rounds SET song_title = COALESCE(NULLIF(?,''), song_title),
         song_artist = ?, song_note = ?, giveaway = ?,
         option_b_title = CASE WHEN ? = 1 THEN COALESCE(NULLIF(?,''), option_b_title) ELSE option_b_title END,
         option_b_artist = CASE WHEN ? = 1 THEN ? ELSE option_b_artist END,
         artist_email = CASE WHEN ? = 1 THEN ? ELSE artist_email END,
         artist_phone = CASE WHEN ? = 1 THEN ? ELSE artist_phone END,
         play_url = CASE WHEN ? = 1 THEN ? ELSE play_url END,
         artist_note = CASE WHEN ? = 1 THEN ? ELSE artist_note END
       WHERE id = ?`,
      [(song_title || '').trim(), (song_artist || '').trim(), (song_note || '').trim(), (giveaway || '').trim(),
       isBinary ? 1 : 0, (option_b_title || '').trim(),
       isBinary ? 1 : 0, (option_b_artist || '').trim(),
       artist_email !== undefined ? 1 : 0, cleanArtistEmail(artist_email),
       artist_phone !== undefined ? 1 : 0, cleanArtistPhone(artist_phone),
       play_url !== undefined ? 1 : 0, cleanPlayUrl(play_url),
       // 500 to match what the ingest already accepts for the same column.
       artist_note !== undefined ? 1 : 0, (artist_note == null ? '' : String(artist_note)).trim().slice(0, 500) || null,
       roundId]
    );
    await realtime.publish(sessionId, 'round');
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/round/ratify' && method === 'POST') {
    const { sessionId, roundId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    if (refuseOnDrop(res, session)) return;
    const round = await db.get('SELECT * FROM rounds WHERE id = ? AND session_id = ?', [roundId, sessionId]);
    if (!round) return bad(res, 'Round not found', 404);
    return send(res, 200, await ratifyAndPublish(round, session));
  }

  if (p === '/api/admin/session/end' && method === 'POST') {
    const { sessionId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    await db.run("UPDATE sessions SET status = 'completed' WHERE id = ?", [sessionId]);
    // Non-fatal: a bonus hiccup must never block the host ending the show.
    let liveBonusPaid = 0;
    try { liveBonusPaid = await awardLiveCompletion(session); }
    catch (e) { console.error('[live-bonus] award failed:', e.message); }
    await realtime.publish(sessionId, 'status');
    return send(res, 200, { ok: true, liveBonusPaid });
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
    // Going live stamps the actual start time when the host never scheduled one, so
    // every started room carries a real scheduled_at (migration 025 backfilled history;
    // this keeps the guarantee going forward). A pre-set schedule is never overwritten.
    if (status === 'live') {
      await db.run('UPDATE sessions SET status = ?, scheduled_at = COALESCE(scheduled_at, ?) WHERE id = ?', [status, now(), sessionId]);
    } else {
      await db.run('UPDATE sessions SET status = ? WHERE id = ?', [status, sessionId]);
    }
    // Same award as /session/end — this is the other path a show reaches 'completed' by, and
    // one implementation with two callers is the rule everywhere else in this file.
    if (status === 'completed' && wasLive) {
      try { await awardLiveCompletion(session); } catch (e) { console.error('[live-bonus] award failed:', e.message); }
    }
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
        visibility: s.visibility || 'public', accessCode: s.access_code || null,
        ingestAuto: (s.ingest_auto === 1 || s.ingest_auto === true) ? 1 : 0,
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
    // Delete in FK order: votes/comments/notices -> rounds -> participants -> banners -> otps -> session.
    // Feedback merely references the session (it's general product feedback that happened to
    // be tagged); keep the content but NULL the reference so purge leaves no dangling pointer.
    await db.tx(async (tx) => {
      await tx.run('DELETE FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE session_id = ?)', [sessionId]);
      await tx.run('DELETE FROM round_comments WHERE session_id = ?', [sessionId]);
      // artist_notices hangs off both session and round; it was missed when 026 added it,
      // which left the send queue orphaned after a purge.
      await tx.run('DELETE FROM artist_notices WHERE session_id = ?', [sessionId]);
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
    // `live` means the weekly BROADCAST. A drop is also status='live' for 21 hours a day, so
    // without the mode filter it would win this ORDER BY on any Wednesday it was created
    // after the show — and the live show would silently vanish from the homepage.
    const liveRow = await db.get("SELECT * FROM sessions WHERE status = 'live' AND deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') AND (visibility IS NULL OR visibility != 'unlisted') ORDER BY created_at DESC LIMIT 1", []);
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
    // Today's drop — A&R Daily. Its own key, never folded into `live`: the two coexist
    // (a drop is open every day, a show runs on Wednesday) and the homepage renders the drop
    // as the permanent hero with a live show stacking above it. No `nowPlaying` — every
    // record of the day is open at once, so there is no such thing.
    const dropRow = await db.get("SELECT * FROM sessions WHERE mode = 'async' AND status = 'live' AND deleted_at IS NULL AND (visibility IS NULL OR visibility != 'unlisted') ORDER BY window_opens_at DESC LIMIT 1", []);
    let daily = null;
    if (dropRow) {
      const songs = (await db.get("SELECT COUNT(*) AS c FROM rounds WHERE session_id = ? AND status IN ('voting','closed','ratified')", [dropRow.id])).c;
      daily = { id: dropRow.id, name: dropRow.name, day: dropRow.drop_day,
        songs: Number(songs) || 0,                       // VARIABLE — never assume 16
        closesAt: dropRow.window_closes_at == null ? null : Number(dropRow.window_closes_at),
        resultsAt: dropRow.results_at == null ? null : Number(dropRow.results_at),
        submitUrl: dropRow.submit_url || null };
    }
    // Next upcoming session: earliest future start, else most recently created upcoming.
    const nextRow = await db.get("SELECT id, name, scheduled_at, watch_url, submit_url FROM sessions WHERE status = 'upcoming' AND deleted_at IS NULL AND (mode IS NULL OR mode <> 'async') AND (visibility IS NULL OR visibility != 'unlisted') ORDER BY (scheduled_at IS NULL), scheduled_at ASC, created_at DESC LIMIT 1", []);
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

    // ---- The front door's proof block ----
    // YESTERDAY's board, deliberately, not the cumulative series board. A stranger reading
    // 12,480 concludes they are three months behind; reading 784 concludes they could have
    // done that. "Everyone starts over at noon" is what turns a hierarchy into an invitation,
    // and it is also just true about the product.
    //
    // Its own key rather than a field on `daily`: `daily` is TODAY's open drop, and the last
    // published day is a different session entirely (on the 9AM-to-noon gap, both exist).
    const lastPub = await db.get(
      `SELECT id, drop_day FROM sessions WHERE mode = 'async' AND async_state = 'published'
         AND deleted_at IS NULL AND (visibility IS NULL OR visibility != 'unlisted')
       ORDER BY published_at DESC LIMIT 1`, []);
    let yesterday = null;
    if (lastPub) {
      // Same shape cardArsData already ranks by — participants by points within ONE session.
      // Display name, role, city and points only: this is the most public surface there is,
      // and the PII rule keeps email and phone off it.
      // total_points > 0 because a board padded with people who scored nothing is not proof
      // of anything — it just makes a short day look like a big one.
      const rows = await db.all(
        `SELECT p.name AS pname, p.total_points, u.name AS uname, u.primary_category, u.location, u.photo_url
           FROM participants p LEFT JOIN users u ON u.uid = p.user_id
          WHERE p.session_id = ? AND p.verified = 1 AND p.total_points > 0
          ORDER BY p.total_points DESC, p.created_at ASC LIMIT 8`, [lastPub.id]);
      yesterday = {
        day: lastPub.drop_day, dayLabel: etDayLabel(lastPub.drop_day),
        board: rows.map((r, i) => ({
          rank: i + 1, name: dispName(r.uname || r.pname),
          category: r.primary_category || null, location: r.location || null,
          photoUrl: r.photo_url || null, points: Number(r.total_points) || 0,
        })),
      };
    }

    // "On the team." One bounded COUNT, and it is the membership rather than the qualified
    // subset — someone who just joined is on the team before their profile is complete.
    const teamCount = Number((await db.get('SELECT COUNT(*) AS c FROM users WHERE COALESCE(blocked,0) = 0', [])).c) || 0;

    // ---- Try one right now ----
    // Records that ALREADY RAN, so the average is a settled fact rather than a claim, and a
    // stranger can score themselves against it before signing up. Ratified only: room_average
    // does not exist before ratify, which is exactly what the seal guarantees — so there is
    // no way for this to leak a live day's direction.
    // Bounded: 24 recent rounds, each with one indexed count, then the best few by turnout.
    const tryRows = await db.all(
      `SELECT r.id, r.song_title, r.song_artist, r.room_average,
              (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id AND v.taste IS NOT NULL) AS voters
         FROM rounds r
        WHERE r.status = 'ratified' AND r.room_average IS NOT NULL
          AND COALESCE(r.poll_type,'rating') <> 'binary'
        ORDER BY r.created_at DESC LIMIT 24`, []);
    // THE ARTIST'S NAME IS NOT EMITTED (operator's call, 2026-09-02). A room average is
    // already public on charts and the Top 8 cards, but those show records that did WELL —
    // this pool is whatever ran most recently, so it puts real names against low scores on
    // the most prominent page the project has. The title alone carries the demo.
    // Dropped at the SOURCE rather than hidden in the markup: this payload is anonymous and
    // CDN-cacheable, so a name merely hidden client-side is still one view-source away.
    const tryIt = tryRows
      .filter(r => Number(r.voters) >= 5)   // "3 A&Rs rated this" is not proof of anything
      .slice(0, 5)
      .map(r => ({ title: r.song_title, avg: Number(r.room_average), voters: Number(r.voters) || 0 }));

    // Everything here is anonymous and cacheable — no per-viewer field on the one endpoint
    // worth putting behind a CDN, which would be a PII/seal leak waiting to happen.
    // "13 records left" is a client-side patch using the viewer's own session token.
    return send(res, 200, { live, daily, yesterday, teamCount, tryIt, next, series, winners: [], recentARs, houseSubmitUrl });
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
    // Scheduled start: epoch ms, or empty to clear (countdown shows while Upcoming).
    if ('scheduledAt' in body) {
      const t = Number(body.scheduledAt);
      sets.push('scheduled_at = ?'); vals.push(Number.isFinite(t) && t > 0 ? t : null);
    }
    // Invite-only controls: unlisted visibility + optional join access code.
    if ('visibility' in body) {
      const v = body.visibility === 'unlisted' ? 'unlisted' : 'public';
      sets.push('visibility = ?'); vals.push(v);
    }
    if ('accessCode' in body) {
      const c = (body.accessCode || '').toString().trim().toUpperCase().slice(0, 24);
      sets.push('access_code = ?'); vals.push(c || null);
    }
    // Review-site submission delivery: 0 = stage behind the pull button, 1 = auto-fill the
    // queue form the moment a push lands. Platform-admin only, matching the pull itself —
    // the staged payload carries the artist's email/phone, so a plain host must not be able
    // to arm a mode that streams it into their console.
    if ('ingestAuto' in body) {
      const on = body.ingestAuto === 1 || body.ingestAuto === true || body.ingestAuto === '1';
      if (on && !(await platformAdmin(req))) return bad(res, 'Admin only', 403);
      sets.push('ingest_auto = ?'); vals.push(on ? 1 : 0);
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
        if (!d) return bad(res, 'No eligible evaluations to report', 404);
        if (page === 3 && d.votes < 8) return bad(res, 'The segments page requires at least 8 eligible evaluations', 409);
        return sendPng(await shareCards.renderPng('report' + page, page === 1 ? d : { ...d, sub: d.sub23 }), 'private, no-store');
      }
      // Chart carousel (admin): slide 0 is the cover, 1..N are the list slides. Same query
      // params as /api/admin/charts, plus &per= (rows per slide) and &slide=.
      if (kind === 'chart') {
        if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
        const q = chartQuery(url);
        const data = await chartsData(q);
        if (!data) return bad(res, 'Scope not found', 404);
        const slide = Math.max(0, parseInt(url.searchParams.get('slide') || '0', 10) || 0);
        if (slide === 0) {
          return sendPng(await shareCards.renderPng('chartCover',
            { title: data.title, sub: data.scope.label, bands: data.bands }), 'private, no-store');
        }
        const chunk = data.rows.slice((slide - 1) * q.per, slide * q.per);
        if (!chunk.length) return bad(res, 'No such slide', 404);
        const shaped = chunk.map(r => {
          if (data.mode === 'ars') return { rank: r.rank, top: r.rank === 1, line1: r.name,
            line2: r.ig ? '@' + r.ig : [r.category, r.location].filter(Boolean).join(' · '),
            value: (r.points || 0).toLocaleString() };
          if (data.mode === 'weekly1s') return { rank: '#1', top: false,
            line1: r.record ? r.record.title : '—',
            line2: r.record ? [r.room, chartDate(r.showAt)].filter(Boolean).join(' · ') : r.room + ' · no record cleared the floor',
            value: r.record ? r.record.score.toFixed(1) : '—' };
          return { rank: r.rank, top: r.rank === 1, line1: r.title,
            line2: [r.artist, r.ig ? '@' + r.ig : ''].filter(Boolean).join(' · '),
            value: r.score.toFixed(1) };
        });
        const first = chunk[0], last = chunk[chunk.length - 1];
        const span = data.mode === 'weekly1s' ? `${chunk.length} rooms`
          : (first.rank === last.rank ? `#${first.rank}` : `#${first.rank}–${last.rank}`);
        return sendPng(await shareCards.renderPng('chartList',
          { title: data.title, sub: `${data.scope.label} · ${span}`, rows: shaped, bands: data.bands }), 'private, no-store');
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
        const manage = notifyManageUrl(publicBaseFromReq(req), participant && participant.user_id);
        const html = recapEmailHtml({ name: d.name, sessionName: session.name, rank: d.rank, total: d.total, cards: { score: scoreUrl, songs: job.songs_url, ars: job.ars_url, promo: job.promo_url }, manage });
        const r = await sendEmail(row.email, `Your A&R Room session record — ${session.name}`, html, recapEmailText(d, session.name, manage));
        if (r.ok) { await db.run("UPDATE recap_emails SET status = 'sent', score_url = ?, sent_at = ?, error = NULL WHERE id = ?", [scoreUrl, now(), row.id]); sent++; }
        else { await db.run("UPDATE recap_emails SET status = 'failed', error = ? WHERE id = ?", [(r.error || 'send failed').slice(0, 300), row.id]); failed++; }
      } catch (e) {
        await db.run("UPDATE recap_emails SET status = 'failed', error = ? WHERE id = ?", [(e.message || 'error').slice(0, 300), row.id]); failed++;
      }
    }
    const remaining = (await db.get("SELECT COUNT(*) AS c FROM recap_emails WHERE session_id = ? AND status = 'pending'", [sessionId])).c;
    return send(res, 200, { ok: true, sent, failed, remaining });
  }

  // ---- Post-show ARTIST NOTICES: every artist whose record was rated gets their full
  // Song Report by email + a heads-up SMS (queued to the 10AM-8PM ET window). Same
  // chunked-queue shape as the recap carousel above — admin-triggered, small batches,
  // never on the boot/request path. ----
  if (p === '/api/admin/session/artist-notices/status' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    if (!(await canAdminSession(req, sessionId))) return bad(res, 'Not authorized', 403);
    const rounds = await db.all(ARTIST_ELIGIBLE_SQL, [sessionId]);
    const withEmail = rounds.filter(r => (r.artist_email || '').trim()).length;
    const withPhone = rounds.filter(r => (r.artist_phone || '').trim()).length;
    const q = await db.all(
      'SELECT channel, status, COUNT(*) AS c FROM artist_notices WHERE session_id = ? GROUP BY channel, status', [sessionId]);
    const tally = (ch, st) => Number((q.find(r => r.channel === ch && r.status === st) || {}).c) || 0;
    // How many A&R comments this batch would carry. Comments ship by DEFAULT (029), so
    // host inaction means they all go out — the count belongs on the send panel, at the
    // moment it's actionable, not only in the Rounds tab where it's easy to never open.
    const cmt = await db.get(
      `SELECT COUNT(*) AS c FROM round_comments rc
         JOIN rounds r ON r.id = rc.round_id
        WHERE rc.session_id = ? AND rc.status = 'shared'
          AND r.status = 'ratified' AND COALESCE(r.poll_type,'rating') <> 'binary'`, [sessionId]);
    return send(res, 200, {
      configured: !!process.env.BLOB_READ_WRITE_TOKEN,
      rounds: rounds.length, withEmail, withPhone, missing: rounds.length - withEmail,
      comments: Number(cmt && cmt.c) || 0,
      smsWindow: { open: withinSmsWindow(), label: nextSmsWindowLabel(),
        from: SMS_WINDOW_START_LABEL, to: SMS_WINDOW_END_LABEL },
      email: { sent: tally('email', 'sent'), failed: tally('email', 'failed'), pending: tally('email', 'pending') },
      sms: { sent: tally('sms', 'sent'), failed: tally('sms', 'failed'), pending: tally('sms', 'pending') },
    });
  }

  // Enqueue one email + one SMS per eligible round that has contact info.
  // The implementation is enqueueArtistNotices() — shared with A&R Daily's publisher, so a
  // drop's artists get exactly the mail a live show's artists get.
  if (p === '/api/admin/session/artist-notices/start' && method === 'POST') {
    const { sessionId } = await readBody(req);
    if (!(await canAdminSession(req, sessionId))) return bad(res, 'Not authorized', 403);
    if (!process.env.BLOB_READ_WRITE_TOKEN) return bad(res, 'Image hosting not configured (set BLOB_READ_WRITE_TOKEN)', 409);
    const q = await enqueueArtistNotices(sessionId);
    return send(res, 200, { ok: true, ...q, smsHolds: !withinSmsWindow() });
  }

  // Process a chunk. Email sends immediately (rendering + hosting the 3 report pages per
  // round). SMS sends ONLY inside the ET window — outside it the rows stay pending and
  // the cron picks them up in the morning.
  if (p === '/api/admin/session/artist-notices/process' && method === 'POST') {
    const { sessionId, limit } = await readBody(req);
    if (!(await canAdminSession(req, sessionId))) return bad(res, 'Not authorized', 403);
    const session = await db.get('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', [sessionId]);
    if (!session) return bad(res, 'Room not found', 404);
    const n = Math.min(Math.max(parseInt(limit, 10) || 4, 1), 10);
    // drainArtistEmail() carries the pending->sending claim this route used to lack.
    const { sent, failed } = await drainArtistEmail({ sessionId, limit: n });
    // SMS: only inside the window. Drained here when the host wraps during the day;
    // otherwise the cron gets them tomorrow morning.
    const smsOut = await drainArtistSms({ sessionId, limit: n });
    const rem = await db.get("SELECT COUNT(*) AS c FROM artist_notices WHERE session_id = ? AND status = 'pending' AND channel = 'email'", [sessionId]);
    const smsRem = await db.get("SELECT COUNT(*) AS c FROM artist_notices WHERE session_id = ? AND status = 'pending' AND channel = 'sms'", [sessionId]);
    return send(res, 200, { ok: true, sent, failed, remaining: Number(rem.c) || 0,
      sms: { ...smsOut, remaining: Number(smsRem.c) || 0, held: !withinSmsWindow() } });
  }

  // Send (or RE-send) the notice for ONE round. The room-wide queue above is deliberately
  // idempotent — `ON CONFLICT DO NOTHING` means a round that already sent can never send
  // again — which is right for "run the batch twice" but leaves the host stuck when a
  // single address had a typo, an inbox bounced, or contact arrived after the batch ran.
  // This is the per-round escape hatch, and the only path that intentionally re-sends.
  //
  // The destination is re-read from the round EVERY time rather than reusing the queued
  // row's snapshot: fixing a wrong address and pressing resend is the whole point, so a
  // stale dest would defeat it. The report itself is re-rendered too, so comments shared
  // since the first send are included.
  if (p === '/api/admin/session/artist-notices/resend' && method === 'POST') {
    const { sessionId, roundId, email: wantEmail, sms: wantSms } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Not authorized', 403);
    if (!roundId) return bad(res, 'roundId required');
    // Eligibility is the same rule the batch uses — a ratified rating round with real
    // evaluations. Checked here rather than trusted from the client so a hand-made request
    // can't mail a report for a Versus round (which has no room average to report).
    const eligible = await db.all(ARTIST_ELIGIBLE_SQL, [sessionId]);
    const round = eligible.find(r => r.id === roundId);
    if (!round) return bad(res, 'That round has no report to send — it needs to be a ratified song round with evaluations', 409);
    const em = (round.artist_email || '').trim(), ph = (round.artist_phone || '').trim();
    if (!wantEmail && !wantSms) return bad(res, 'Pick at least one channel');
    if (wantEmail && !em) return bad(res, 'No artist email on this round — add it with ✎ first', 409);
    if (wantSms && !ph) return bad(res, 'No artist phone on this round — add it with ✎ first', 409);
    if (wantEmail && !process.env.BLOB_READ_WRITE_TOKEN) return bad(res, 'Image hosting not configured (set BLOB_READ_WRITE_TOKEN)', 409);

    // Reset the queue row (or create it) to pending with the CURRENT destination, so the
    // uniq_artist_notice index keeps one row per round per channel and the audit trail
    // shows the address we actually used.
    async function requeue(channel, dest) {
      await db.run(
        `INSERT INTO artist_notices (id, session_id, round_id, channel, dest, status, created_at)
         VALUES (?,?,?,?,?, 'pending', ?)
         ON CONFLICT (round_id, channel) DO UPDATE
           SET dest = excluded.dest, status = 'pending', error = NULL, sent_at = NULL`,
        [id(12), sessionId, roundId, channel, dest, now()]);
    }

    const out = { ok: true, email: null, sms: null };
    if (wantEmail) {
      await requeue('email', em);
      const row = await db.get("SELECT id FROM artist_notices WHERE round_id = ? AND channel = 'email'", [roundId]);
      try {
        const r = await sendArtistReportEmail(round, session, em);
        if (r.ok) {
          await db.run("UPDATE artist_notices SET status = 'sent', report_urls = ?, sent_at = ?, error = NULL WHERE id = ?", [JSON.stringify(r.pages), now(), row.id]);
          out.email = { ok: true, dest: em };
        } else {
          await db.run("UPDATE artist_notices SET status = 'failed', error = ? WHERE id = ?", [(r.error || 'send failed').slice(0, 300), row.id]);
          out.email = { ok: false, error: r.error || 'send failed' };
        }
      } catch (e) {
        await db.run("UPDATE artist_notices SET status = 'failed', error = ? WHERE id = ?", [(e.message || 'error').slice(0, 300), row.id]);
        out.email = { ok: false, error: (e.message || 'error') };
      }
    }
    if (wantSms) {
      await requeue('sms', ph);
      // TCPA quiet hours still apply — a per-round resend is not a reason to text someone
      // at 2AM. Outside the window the row stays pending and the cron sends it at 10AM ET.
      const s = await drainArtistSms({ roundId });
      out.sms = s.held
        ? { ok: true, held: true, label: nextSmsWindowLabel() }
        : { ok: s.sent > 0, held: false, error: s.sent > 0 ? null : 'send failed' };
    }
    return send(res, 200, out);
  }

  // Cron: drain artist SMS queued overnight, across ALL sessions, once the ET window
  // opens. Vercel Cron hits this on a schedule; CRON_SECRET-gated (Vercel sends it as a
  // Bearer token). A no-op outside the window — safe to call as often as you like.
  // Bounded (LIMIT) and index-backed (idx_artist_notice_pending): never a table scan.
  if (p === '/api/cron/artist-sms' && (method === 'GET' || method === 'POST')) {
    const secret = process.env.CRON_SECRET || '';
    if (!secret) return bad(res, 'Cron not configured (set CRON_SECRET)', 503);
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || url.searchParams.get('token') || '';
    const ok = given.length === secret.length && given.length > 0
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
    if (!ok) return bad(res, 'Bad token', 401);
    if (!withinSmsWindow()) return send(res, 200, { ok: true, skipped: 'outside the ET send window', etHour: etHour() });
    const out = await drainArtistSms({ limit: 25 });
    const rem = await db.get("SELECT COUNT(*) AS c FROM artist_notices WHERE status = 'pending' AND channel = 'sms'");
    return send(res, 200, { ok: true, ...out, remaining: Number(rem.c) || 0 });
  }

  // ---- A&R Daily lifecycle: open at noon, close + tally at 9AM, publish at noon ----
  // Its OWN path, deliberately not folded into /api/cron/artist-sms: that handler returns
  // early whenever withinSmsWindow() is false, which would silently skip the drop lifecycle
  // for 11.5 hours a day — including the 9:00 AM close.
  if (p === '/api/cron/daily' && (method === 'GET' || method === 'POST')) {
    const secret = process.env.CRON_SECRET || '';
    if (!secret) return bad(res, 'Cron not configured (set CRON_SECRET)', 503);
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || url.searchParams.get('token') || '';
    const okTok = given.length === secret.length && given.length > 0
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
    if (!okTok) return bad(res, 'Bad token', 401);
    return send(res, 200, { ok: true, ...(await runAsyncDropLifecycle()) });
  }

  // Same lifecycle, host-triggered: a manual "run it now" when a cron is late, and the way
  // the suite drives it (e2e.test.js asserts /api/cron/* is 503 with no CRON_SECRET set, so
  // the tests can't go through that door). One implementation, two callers — the advanceRoom
  // discipline.
  if (p === '/api/admin/daily/tick' && method === 'POST') {
    const body = await readBody(req);
    if (!(await platformAdmin(req))) return bad(res, 'Admin auth failed', 401);
    return send(res, 200, { ok: true, ...(await runAsyncDropLifecycle({ ts: body.at })) });
  }

  // Stage a day BY HAND — the same builder Drupal's push uses, behind the admin login
  // instead of a shared secret. It exists because "a missing drop is an incident, not an
  // empty state": if Drupal is down at 11:50 AM, the operator needs a way to put a day up
  // that does not involve waiting for someone else's CMS. It is also the only way to try
  // the whole thing on a deployment where DAILY_INGEST_TOKEN is not set.
  //
  // Platform-admin only, for the same reason /api/ingest/daily has its own secret: the
  // payload carries every artist's contact details, and a drop has no owner_uid.
  if (p === '/api/admin/daily/drop' && method === 'POST') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    return stageDailyDrop(res, await readBody(req));
  }

  // ---- Build tomorrow's drop a record at a time, the way the live queue is built. ----
  // /daily/drop is a BATCH: it takes an approved set and replaces the day, which is right
  // for a Drupal push and wrong for a person typing records in one by one. This adds ONE,
  // creating the day on the first record so there is no separate "create the day" step.
  //
  // It shares normalizeDropSong and resolveDropSeries with the batch, so a hand-built day
  // cannot end up in a shape the pushed one could not — same required fields, same series
  // rule, same contact handling.
  if (p === '/api/admin/daily/round' && method === 'POST') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const body = await readBody(req);

    // Which day. An explicit day wins; otherwise carry on with whatever is already being
    // built, and start the next empty day when nothing is.
    let day = (body.day || '').toString().trim();
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, 'day must be YYYY-MM-DD');
    if (!day) {
      const building = await db.get(
        `SELECT drop_day FROM sessions WHERE mode = 'async' AND deleted_at IS NULL
           AND COALESCE(async_state,'scheduled') = 'scheduled'
         ORDER BY window_opens_at ASC LIMIT 1`, []);
      if (building) day = building.drop_day;
      else {
        const today = etDay();
        const taken = await db.get("SELECT id FROM sessions WHERE drop_day = ? AND deleted_at IS NULL", [today]);
        day = taken ? etNextDay(today) : today;
      }
    }
    const dayTs = etEpoch(day, 12);
    if (dayTs == null || Math.abs(dayTs - now()) > 3 * 86400000) return bad(res, 'day is too far from today');

    const { rec, err } = normalizeDropSong(body, 0);
    if (err) {
      return bad(res, err.field === 'title' ? 'Give the record a title'
        : 'A play link is required — a record nobody can hear is a dead record for the whole window');
    }

    const existing = await db.get('SELECT * FROM sessions WHERE drop_day = ? AND deleted_at IS NULL', [day]);

    // ADDING TO A DAY THAT IS ALREADY OPEN IS REFUSED, and this is the reason: the
    // completion bonus counts against a LIVE denominator, so a record added mid-window
    // silently un-finishes everyone who already completed the day — including people
    // already paid, who would now read 9/10. Deleting a zero-vote record is the supported
    // direction; adding is not.
    if (existing && (existing.async_state || 'scheduled') !== 'scheduled') {
      return send(res, 409, { error: "That day is already open — adding a record now would un-finish every A&R who already completed it. Delete a record instead, or build the next day.",
        sessionId: existing.id, day, state: existing.async_state });
    }

    if (!existing) {
      const ser = await resolveDropSeries(body.seriesId);
      if (ser.error) return bad(res, ser.error, ser.status || 400);
      let out;
      try {
        out = await createAsyncDrop({ day, name: body.name, seriesId: ser.seriesId, songs: [rec],
          opensAt: body.opensAt, closesAt: body.closesAt, resultsAt: body.resultsAt });
      } catch (e) {
        // Two admins starting the same day at once race on uniq_session_drop_day; the loser
        // adopts the winner's day rather than erroring at a person who did nothing wrong.
        if (!/unique|duplicate/i.test(e.message || '')) throw e;
        const won = await db.get('SELECT * FROM sessions WHERE drop_day = ? AND deleted_at IS NULL', [day]);
        if (!won) throw e;
        const r2 = await addDropRound(won, rec);
        return send(res, r2.ok ? 200 : 409, r2);
      }
      return send(res, 200, { ok: true, created: true, sessionId: out.sessionId, day,
        rounds: 1, seriesId: ser.seriesId, opensAt: out.opensAt, closesAt: out.closesAt, resultsAt: out.resultsAt });
    }

    const added = await addDropRound(existing, rec);
    return send(res, added.ok ? 200 : 409, added);
  }

  // ---- The daily console's one status call. ----
  // Platform-admin only: a drop has no owner_uid (the batch carries 16 artists' contact
  // details, so canAdminSession admits only platform admins), and this readout carries the
  // whole day's operational state.
  //
  // Bounded by the day's size and by a handful of indexed aggregates — nothing here scales
  // with the number of A&Rs beyond one COUNT DISTINCT over the day's votes.
  if (p === '/api/admin/daily/status' && method === 'GET') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const wantDay = url.searchParams.get('day');
    // The RUNNING day, not merely the latest one. Once the operator starts building
    // tomorrow, tomorrow has the later window_opens_at and would otherwise displace today's
    // open drop on the screen — exactly when they most need to see it.
    const session = wantDay
      ? await db.get("SELECT * FROM sessions WHERE mode = 'async' AND drop_day = ? AND deleted_at IS NULL", [wantDay])
      : (await db.get(`SELECT * FROM sessions WHERE mode = 'async' AND deleted_at IS NULL
                         AND COALESCE(async_state,'scheduled') <> 'scheduled'
                       ORDER BY window_opens_at DESC LIMIT 1`, []))
        || (await db.get(`SELECT * FROM sessions WHERE mode = 'async' AND deleted_at IS NULL
                           ORDER BY window_opens_at ASC LIMIT 1`, []));

    // The day being BUILT, alongside whatever is running. Its own key so the console can
    // show both at once — fixing today's broken link and stacking tomorrow's records are
    // different jobs and the operator does them on the same screen.
    const nextRow = await db.get(
      `SELECT * FROM sessions WHERE mode = 'async' AND deleted_at IS NULL
         AND COALESCE(async_state,'scheduled') = 'scheduled'
       ORDER BY window_opens_at ASC LIMIT 1`, []);
    let building = null;
    if (nextRow) {
      const qr = await db.all(
        `SELECT id, idx, song_title, song_artist, play_url, artist_note, artist_email, artist_phone
           FROM rounds WHERE session_id = ? ORDER BY idx ASC`, [nextRow.id]);
      building = {
        id: nextRow.id, day: nextRow.drop_day, dayLabel: etDayLabel(nextRow.drop_day),
        opensLabel: etClockLabel(nextRow.window_opens_at),
        series_id: nextRow.series_id || null,
        max: DROP_MAX_SONGS,
        rounds: qr.map(r => ({ id: r.id, idx: r.idx, song_title: r.song_title,
          song_artist: r.song_artist || '', play_url: r.play_url || '',
          artist_note: r.artist_note || '',
          hasEmail: !!(r.artist_email || '').trim(), hasPhone: !!(r.artist_phone || '').trim() })),
      };
    }

    // No drop is an INCIDENT, not an empty state — if Drupal has not pushed, the site is
    // back to the exact failure this whole build exists to fix. Say so plainly.
    if (!session) return send(res, 200, { drop: null, building,
      message: 'No drop is staged. Nothing for A&Rs to do.' });

    const day = session.drop_day;
    const rounds = await db.all(
      `SELECT r.id, r.idx, r.status, r.song_title, r.song_artist, r.play_url, r.artist_note,
              r.ingest_ref, r.ingest_url, r.room_average, r.artist_email, r.artist_phone,
              (SELECT COUNT(*) FROM votes v WHERE v.round_id = r.id) AS votes,
              (SELECT COUNT(*) FROM round_reports rr WHERE rr.round_id = r.id) AS reports,
              (SELECT COUNT(*) FROM round_comments c WHERE c.round_id = r.id AND c.status = 'shared') AS comments_shared
         FROM rounds r WHERE r.session_id = ? ORDER BY r.idx ASC`, [session.id]);
    const live = rounds.filter(r => ['voting', 'closed', 'ratified'].includes(r.status));
    const arsPlaying = Number((await db.get(
      `SELECT COUNT(DISTINCT v.participant_id) AS c FROM votes v JOIN rounds r ON r.id = v.round_id
        WHERE r.session_id = ?`, [session.id])).c) || 0;
    const finished = Number((await db.get(
      "SELECT COUNT(*) AS c FROM point_events WHERE reason = 'async_complete' AND source_uid LIKE ?",
      [session.id + ':%'])).c) || 0;
    const job = await db.get('SELECT * FROM recap_jobs WHERE session_id = ?', [session.id]);
    const bc = await db.get("SELECT id FROM notify_broadcasts WHERE kind = 'digest_daily' AND ref_id = ?", [session.id]);

    // The four queue tallies, in the SAME {sent, failed, pending} shape
    // artist-notices/status already returns, so the console's panel component is reusable.
    const tallyOf = async (sql, params) => {
      const rows = await db.all(sql, params);
      const g = (st) => Number((rows.find(r => r.status === st) || {}).c) || 0;
      // 'sending' is a claimed row mid-flight; it is still owed, so it counts as pending.
      return { sent: g('sent'), failed: g('failed'), pending: g('pending') + g('sending') };
    };
    const notices = await db.all(
      'SELECT channel, status, COUNT(*) AS c FROM artist_notices WHERE session_id = ? GROUP BY channel, status', [session.id]);
    const chan = (ch) => {
      const g = (st) => Number((notices.find(r => r.channel === ch && r.status === st) || {}).c) || 0;
      return { sent: g('sent'), failed: g('failed'), pending: g('pending') + g('sending') };
    };
    const digest = bc
      ? await tallyOf('SELECT status, COUNT(*) AS c FROM notify_recipients WHERE broadcast_id = ? GROUP BY status', [bc.id])
      : { sent: 0, failed: 0, pending: 0 };

    const holdUntil = session.published_at
      ? Number(session.published_at) + ARTIST_NOTICE_DELAY_MIN * 60000 : null;
    return send(res, 200, {
      drop: {
        id: session.id, day, dayLabel: etDayLabel(day), name: session.name,
        status: session.status, async_state: session.async_state || 'scheduled',
        opens_at: Number(session.window_opens_at) || null,
        closes_at: Number(session.window_closes_at) || null,
        results_at: Number(session.results_at) || null,
        published_at: session.published_at ? Number(session.published_at) : null,
        opensLabel: etClockLabel(session.window_opens_at),
        closesLabel: etClockLabel(session.window_closes_at),
        resultsLabel: etClockLabel(session.results_at),
        // Untagged means the day's points never reach the $500 board — the whole
        // unification premise, failing silently. The console paints this red.
        series_id: session.series_id || null,
        records: live.length, total: rounds.length,
      },
      rounds: rounds.map(r => ({
        id: r.id, idx: r.idx, status: r.status,
        song_title: r.song_title, song_artist: r.song_artist,
        play_url: r.play_url || '', artist_note: r.artist_note || '',
        ingest_ref: r.ingest_ref || null, ingest_url: r.ingest_url || null,
        room_average: r.room_average != null ? Number(r.room_average) : null,
        hasEmail: !!(r.artist_email || '').trim(), hasPhone: !!(r.artist_phone || '').trim(),
        votes: Number(r.votes) || 0, reports: Number(r.reports) || 0,
        comments_shared: Number(r.comments_shared) || 0,
      })),
      engagement: { ars: arsPlaying, finished },
      // Comments ship by DEFAULT (029) and there is no unsend, so the count of what is
      // about to go out belongs here, next to the hold that is the only chance to stop it.
      comments: rounds.reduce((n, r) => n + (Number(r.comments_shared) || 0), 0),
      cards: { ars: (job && job.ars_url) || null, songs: (job && job.songs_url) || null,
        caption: (job && job.caption) || null, stage: (job && job.stage) || null },
      queues: { digest, artistEmail: chan('email'), artistSms: chan('sms') },
      artistHold: { until: holdUntil, held: !!(holdUntil && now() < holdUntil),
        minutes: ARTIST_NOTICE_DELAY_MIN },
      smsWindow: { open: withinSmsWindow(), label: nextSmsWindowLabel(),
        from: SMS_WINDOW_START_LABEL, to: SMS_WINDOW_END_LABEL },
      building,
      blobConfigured: !!process.env.BLOB_READ_WRITE_TOKEN,
    });
  }

  // Run the publish + drain once by hand, for a cron that never fired. Same implementation
  // the cron uses, so a manual run can never do something the scheduled one would not.
  if (p === '/api/admin/daily/publish' && method === 'POST') {
    if (!(await platformAdmin(req))) return bad(res, 'Admin only', 403);
    const { day } = await readBody(req);
    const session = day
      ? await db.get("SELECT * FROM sessions WHERE mode = 'async' AND drop_day = ? AND deleted_at IS NULL", [day])
      : await db.get(`SELECT * FROM sessions WHERE mode = 'async' AND deleted_at IS NULL
                       AND async_state IN ('ratified','published') ORDER BY window_opens_at DESC LIMIT 1`, []);
    if (!session) return bad(res, 'No drop found for that day', 404);
    if ((session.async_state || 'scheduled') === 'published') {
      // Already out. Re-running is still useful — it drains whatever is left queued — but
      // it must never re-publish or re-queue the digest.
      return send(res, 200, { ok: true, alreadyPublished: true, ...(await runAsyncDropLifecycle()) });
    }
    if ((session.async_state || 'scheduled') !== 'ratified') {
      return bad(res, `The day is ${session.async_state || 'scheduled'} — it has to finish tallying before it can publish`, 409);
    }
    const published = await publishDailyDrop(session);
    return send(res, 200, { ok: true, published, ...(await runAsyncDropLifecycle()) });
  }

  // ---- Asana post kit: the night's graphics + a tag-everyone caption, as one task. ----
  // Preview (also powers "Copy caption", which works with or without Asana configured).
  if (p === '/api/admin/session/post-kit' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Not authorized', 403);
    const ars = await cardArsData({ sessionId });
    const songs = session.poll_type === 'binary' ? [] : await cardSongsData(sessionId);
    const project = (await db.get("SELECT v FROM settings WHERE k = 'asana_project'"))?.v || null;
    return send(res, 200, {
      caption: await postKitCaption(sessionId, ars, songs),
      ars: ars.length, songs: songs.length,
      topRecord: songs.length ? { title: songs[0].title, artist: songs[0].artist, score: songs[0].score } : null,
      configured: !!(process.env.ASANA_TOKEN && project) && !!process.env.BLOB_READ_WRITE_TOKEN,
      hasToken: !!process.env.ASANA_TOKEN, hasProject: !!project,
      blob: !!process.env.BLOB_READ_WRITE_TOKEN,
    });
  }

  // Create the task: render the graphics, then upload each as a real Asana attachment
  // (not a link) so the operator can download and post them straight from the task.
  if (p === '/api/admin/session/asana-task' && method === 'POST') {
    const { sessionId } = await readBody(req);
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Not authorized', 403);
    if (!process.env.ASANA_TOKEN) return bad(res, 'Asana not configured (set ASANA_TOKEN)', 409);
    const project = (await db.get("SELECT v FROM settings WHERE k = 'asana_project'"))?.v || null;
    if (!project) return bad(res, 'Set the Asana project ID in the Platform panel first', 409);
    try {
      const kit = await buildPostKit(session);
      if (!kit) return bad(res, 'Nothing to post yet — no ranked A&Rs or rated songs', 404);
      const { files, caption } = kit;
      const dateLabel = new Date(Number(session.scheduled_at || session.created_at) || Date.now())
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
      const task = await asanaFetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {
          name: `A&R Room post kit — ${session.name} (${dateLabel})`,
          notes: `Caption (paste as-is):\n\n${caption}\n\n—\nPost the graphics as one Instagram carousel. Add @Makinit4indies as a collaborator.\nGenerated by The A&R Room.`,
          projects: [String(project)],
        } }),
      });
      const gid = task && task.data && task.data.gid;
      if (!gid) return bad(res, 'Asana did not return a task id', 502);
      // Attachments are uploaded one at a time — Asana takes one file per request.
      const attached = [];
      for (const f of files) {
        const form = new FormData();
        form.set('parent', gid);
        form.set('file', new Blob([f.buf], { type: 'image/png' }), f.name);
        await asanaFetch('/attachments', { method: 'POST', body: form });
        attached.push(f.name);
      }
      const permalink = (task.data && task.data.permalink_url) || `https://app.asana.com/0/${project}/${gid}`;
      return send(res, 200, { ok: true, taskId: gid, url: permalink, attached });
    } catch (e) {
      console.error('[asana] task failed:', e.message);
      return bad(res, 'Asana task failed: ' + e.message, 502);
    }
  }

  // Serve a banner image by id (used by <img src>). Public — banners are shown to players.
  if (p === '/api/banner/image' && method === 'GET') {
    const bid = url.searchParams.get('id');
    const b = await db.get('SELECT image_data FROM banners WHERE id = ?', [bid]);
    if (!b) return bad(res, 'Not found', 404);
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(b.image_data);
    if (!m) return bad(res, 'Bad image', 500);
    const buf = Buffer.from(m[2], 'base64');
    // Banner URLs are content-addressed: a new upload gets a fresh id(9), so the
    // bytes at a given ?id= never change. Cache for a year, immutable — this is the
    // single biggest DB-egress win (was max-age=300, which re-pulled the full ~500KB
    // blob out of Neon every 5 min per viewer and blew the data-transfer quota).
    res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable' });
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
  //   anon   = 1  -> replace names/emails with "A&R N" (safe to share)
  if (p === '/api/admin/export' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');
    const session = await canAdminSession(req, sessionId);
    if (!session) return bad(res, 'Admin auth failed', 401);
    const exporter = await userFromAuth(req);
    if (blockedByPerm(exporter, 'export')) return bad(res, 'Export is not enabled for this account', 403);
    const redact = !!(exporter && exporter.role === 'host'); // hosts export engagement, never contact PII
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const anon = url.searchParams.get('anon') === '1';

    const participants = await db.all(
      'SELECT id, user_id, name, email, phone, sms_marketing_consent, ref_code, referred_by, ref_credited, pool, checkin_distance, total_points, created_at FROM participants WHERE session_id = ? AND verified = 1 ORDER BY created_at ASC',
      [sessionId]
    );
    const rounds = await db.all(
      "SELECT id, idx, poll_type, song_title, song_artist, option_b_title, option_b_artist, room_average, split_a, opens_at, closes_at, status FROM rounds WHERE session_id = ? AND status = 'ratified' ORDER BY idx ASC",
      [sessionId]
    );
    // Poll type is per-round. A single-type session exports cleanly (one column set); a
    // MIXED session uses a union shape with a round_type column and both sets (blank where N/A).
    const roundTypeById = {};
    rounds.forEach(r => { roundTypeById[r.id] = r.poll_type === 'binary' ? 'binary' : 'rating'; });
    const typesPresent = new Set(rounds.map(r => roundTypeById[r.id]));
    const mixed = typesPresent.size > 1;
    const isBinary = !mixed && (typesPresent.has('binary') || (rounds.length === 0 && session.poll_type === 'binary'));
    const votes = await db.all(
      `SELECT v.round_id, v.participant_id, v.taste, v.predict, v.pick, v.predict_split, v.err, v.points, v.tier, v.rank, v.locked_at
         FROM votes v JOIN rounds r ON r.id = v.round_id
        WHERE r.session_id = ? AND r.status = 'ratified'`,
      [sessionId]
    );

    // Stable anonymization: map each participant to "A&R N" by join order. The `player`
    // JSON key is a data field name and stays put; only the visible label was repositioned.
    const labelById = {};
    participants.forEach((pt, i) => { labelById[pt.id] = `A&R ${i + 1}`; });
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
      const rt = roundTypeById[v.round_id] || 'rating';
      const base = {
        player: labelById[v.participant_id] || 'A&R ?',
        round: (rounds.find(r => r.id === v.round_id) || {}).idx,
      };
      if (mixed) base.round_type = rt;
      if (rt === 'binary') {
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
      const rt = roundTypeById[r.id];
      const isBin = rt === 'binary';
      if (anon) {
        const o = { round: r.idx };
        if (mixed) o.round_type = rt;
        if (isBin) o.split_a = r.split_a; else o.room_average = r.room_average;
        return o;
      }
      const o = { round: r.idx };
      if (mixed) o.round_type = rt;
      if (isBin) { o.song_a_title = r.song_title; o.song_a_artist = r.song_artist; o.song_b_title = r.option_b_title; o.song_b_artist = r.option_b_artist; o.split_a = r.split_a; }
      else { o.song_title = r.song_title; o.song_artist = r.song_artist; o.room_average = r.room_average; }
      o.opened_at = Number(r.opens_at); o.closed_at = Number(r.closes_at);
      return o;
    });

    if (format === 'csv') {
      // One row per vote — the richest single flat table for analysis. A mixed session
      // uses a union header (round_type + both column sets); pure sessions stay clean.
      const headers = mixed
        ? (anon
            ? ['player', 'round', 'round_type', 'rating', 'prediction', 'room_average', 'pick', 'predict_split', 'split_a', 'error', 'points', 'tier', 'rank']
            : ['player', 'name', 'email', 'round', 'round_type', 'song_a', 'song_b', 'rating', 'prediction', 'room_average', 'pick', 'predict_split', 'split_a', 'error', 'points', 'tier', 'rank', 'locked_at'])
        : isBinary
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
        const rt = roundTypeById[v.round_id] || 'rating';
        let row;
        if (mixed) {
          // Union row: populate the columns for this round's type, blanks for the rest.
          const isBin = rt === 'binary';
          const rating = isBin ? null : v.taste, prediction = isBin ? null : v.predict, roomAvg = isBin ? null : roomAvgByRound[v.round_id];
          const pick = isBin ? v.pick : null, psplit = isBin ? v.predict_split : null, splitA = isBin ? splitAByRound[v.round_id] : null;
          const songA = isBin ? songAByRound[v.round_id] : songByRound[v.round_id], songB = isBin ? songBByRound[v.round_id] : null;
          row = anon
            ? [labelById[pid], r.idx, rt, rating, prediction, roomAvg, pick, psplit, splitA, v.err, v.points, v.tier, v.rank]
            : [labelById[pid], nameById[pid], emailById[pid], r.idx, rt, songA, songB, rating, prediction, roomAvg, pick, psplit, splitA, v.err, v.points, v.tier, v.rank, Number(v.locked_at)];
        } else if (isBinary) {
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
      session: { id: anon ? undefined : session.id, name: session.name, poll_type: mixed ? 'mixed' : (isBinary ? 'binary' : 'rating'), exported_at: now(), anonymized: anon },
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
    // Bare root = THE FRONT DOOR (The A&R Team pitch, session-aware for a member); root WITH
    // a session param (?s=) is still the live voting page, which preserves every QR code and
    // share link ever printed. /play stays explicit.
    // home.html is retained but unrouted — it is the pre-rebrand homepage, kept for reference
    // until the sections it still owns (winners, the how-it-works copy) are confirmed dead.
    if (url.pathname === '/') return serveStatic(res, url.searchParams.get('s') ? 'play.html' : 'landing.html');
    if (url.pathname === '/play') return serveStatic(res, 'play.html');
    // A&R Daily — the async queue walk. Its own page, deliberately: play.html narrates a
    // live show, and this one exists to be the opposite of that.
    if (url.pathname === '/daily') return serveStatic(res, 'daily.html');
    if (url.pathname.startsWith('/u/')) return serveStatic(res, 'profile.html'); // public A&R profile
    if (url.pathname === '/join' || url.pathname === '/profile') return serveStatic(res, 'join.html'); // team signup + self-serve profile edit
    if (url.pathname === '/admin') return serveStatic(res, 'admin.html');
    if (url.pathname === '/sidebet') return serveStatic(res, 'sidebet.html'); // A&R Wars prediction contest
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
// Exported for tests: the artist-SMS quiet-hours gate is a TCPA constraint, so it's
// asserted directly against fixed timestamps rather than inferred from a live clock.
module.exports._withinSmsWindow = withinSmsWindow;
module.exports._etHour = etHour;
// Pure template (no secrets) — exported so the artist-facing email can be rendered and
// eyeballed without a live Blob token or a real send.
module.exports._artistEmailHtml = artistEmailHtml;
module.exports._drainArtistSms = drainArtistSms;
// Exported for tests: minting a manage link is what a real sender does, and the scope
// test needs a genuine token to prove it's rejected everywhere except the prefs routes.
module.exports._mintNotifyLink = mintNotifyLink;
// Exported for tests: A&R Daily's schedule is ET wall clock across a DST boundary, and the
// per-A&R queue order has to be stable forever. Both are pure and asserted directly.
module.exports._etEpoch = etEpoch;
module.exports._etNextDay = etNextDay;
module.exports._etDay = etDay;
module.exports._asyncQueueOrder = asyncQueueOrder;
module.exports._completionBonusPoints = completionBonusPoints;
// Exported for tests: the scouting curve is the dial that decides whether "eye for talent"
// is a real second lane or a garnish, so its shape is asserted rather than eyeballed.
module.exports._scoutPointsFor = scoutPointsFor;
module.exports._buildRecap = buildRecap;
module.exports._enqueueDailyDigest = enqueueDailyDigest;
module.exports._dailyDigestEmailHtml = dailyDigestEmailHtml;
