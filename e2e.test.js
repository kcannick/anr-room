'use strict';
// Boots the server in-process and exercises the whole flow over HTTP.
process.env.EMAIL_PROVIDER = 'console';
process.env.SQLITE_PATH = './test.db';
process.env.PORT = '3999';
process.env.ADMIN_EMAIL = 'admin@test.com';
const fs = require('fs');
try { fs.unlinkSync('./test.db'); } catch {}
try { fs.unlinkSync('./test.db-wal'); } catch {}
try { fs.unlinkSync('./test.db-shm'); } catch {}

const base = 'http://localhost:3999';
let pass = 0, fail = 0;
function ok(label, cond, extra='') { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } }

async function call(path, body, method='POST', headers={}) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}

(async () => {
  const server = require('./server');
  // server.js only auto-listens when run directly; when required (here, and on
  // Vercel) we drive init + listen ourselves.
  await server.ensureInit();
  await new Promise((res) => server.listen(3999, res));

  console.log('\n— create session —');
  const cs = await call('/api/session', { name: 'Test Night' });
  ok('session created', cs.status === 200 && cs.d.sessionId && cs.d.adminToken, JSON.stringify(cs.d));
  const SID = cs.d.sessionId, ATOK = cs.d.adminToken;
  const AH = { 'X-Admin-Token': ATOK };

  console.log('\n— two players join —');
  async function join(email, name) {
    const req = await call('/api/join/request', { sessionId: SID, email });
    ok(`OTP issued for ${email}`, req.status === 200 && req.d.devCode, JSON.stringify(req.d));
    const ver = await call('/api/join/verify', { sessionId: SID, email, code: req.d.devCode, name });
    ok(`verified ${name}`, ver.status === 200 && ver.d.token, JSON.stringify(ver.d));
    return ver.d.token;
  }
  const t1 = await join('a@test.com', 'Maya');
  const t2 = await join('b@test.com', 'Theo');
  const t3 = await join('c@test.com', 'Iris');

  // wrong code rejected
  const bad = await call('/api/join/verify', { sessionId: SID, email: 'a@test.com', code: '000000', name: 'x' });
  ok('wrong code rejected', bad.status === 400);

  console.log('\n— admin sees 3 joined —');
  let st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('3 verified participants', st.verifiedCount === 3, 'got ' + st.verifiedCount);

  console.log('\n— add + open round —');
  const ar = await call('/api/admin/round', { sessionId: SID, song_title: 'Midnight City', song_artist: 'M83', giveaway: 'Vinyl' }, 'POST', AH);
  ok('round added', ar.status === 200 && ar.d.roundId);
  const RID = ar.d.roundId;
  const op = await call('/api/admin/round/open', { sessionId: SID, roundId: RID, minutes: 1 }, 'POST', AH);
  ok('round opened', op.status === 200);

  // player sees voting
  let ps = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t1 })).d;
  ok('player phase=voting', ps.phase === 'voting', ps.phase);
  ok('player sees song title', ps.round.song_title === 'Midnight City');
  ok('player sees giveaway', ps.round.giveaway === 'Vinyl');

  console.log('\n— votes cast —');
  // tastes: 8, 6, 7 -> avg 7.0
  const v1 = await call('/api/vote', { taste: 8, predict: 7.0 }, 'POST', { 'X-Player-Token': t1 }); // Maya, err 0.0
  await new Promise(r=>setTimeout(r,5));
  const v2 = await call('/api/vote', { taste: 6, predict: 7.0 }, 'POST', { 'X-Player-Token': t2 }); // Theo, err 0.0 but later lock
  const v3 = await call('/api/vote', { taste: 7, predict: 5.5 }, 'POST', { 'X-Player-Token': t3 }); // Iris, err 1.5
  ok('vote 1 locked', v1.d.locked === true);
  ok('vote 2 locked', v2.d.locked === true);
  ok('vote 3 locked', v3.d.locked === true);

  // double vote rejected
  const dv = await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': t1 });
  ok('double-vote rejected', dv.status === 400);
  // invalid rating rejected
  const iv = await call('/api/vote', { taste: 11, predict: 5 }, 'POST', { 'X-Player-Token': t2 });
  ok('out-of-range rating rejected (already voted anyway)', iv.status === 400);

  // player who voted now sees locked
  ps = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t1 })).d;
  ok('voted player phase=locked', ps.phase === 'locked', ps.phase);

  console.log('\n— admin live feed shows 3 votes —');
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('admin sees 3 live votes', st.liveVotes.length === 3, 'got ' + st.liveVotes.length);

  console.log('\n— extend then close then ratify —');
  const ext = await call('/api/admin/round/extend', { sessionId: SID, roundId: RID, seconds: 30 }, 'POST', AH);
  ok('extend ok', ext.status === 200);
  const rat = await call('/api/admin/round/ratify', { sessionId: SID, roundId: RID }, 'POST', AH);
  ok('ratify ok', rat.status === 200, JSON.stringify(rat.d));
  ok('room average = 7.0', Math.abs(rat.d.room_average - 7.0) < 1e-9, 'got ' + rat.d.room_average);

  console.log('\n— results: Maya wins on earliest lock tie —');
  // Maya & Theo both err 0.0 (exact); Maya locked first -> Maya rank 1
  const m1 = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t1 })).d;
  ok('Maya phase=results', m1.phase === 'results', m1.phase);
  ok('winner is Maya (tie -> earliest lock)', m1.winner && m1.winner.name === 'Maya', JSON.stringify(m1.winner));
  ok('Maya rank 1', m1.myResult.rank === 1, 'rank ' + m1.myResult.rank);
  ok('Maya exact = 125 pts (100 + 25 bullseye)', m1.myResult.points === 125, 'pts ' + m1.myResult.points);
  ok('Maya tier = bullseye', m1.myResult.tier === 'bullseye', 'tier ' + m1.myResult.tier);
  ok('Maya total updated to 125', m1.myTotalPoints === 125, 'total ' + m1.myTotalPoints);

  const m3 = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t3 })).d;
  ok('Iris rank 3', m3.myResult.rank === 3, 'rank ' + m3.myResult.rank);
  ok('Iris still gets points + tier', typeof m3.myResult.points === 'number' && m3.myResult.tier, JSON.stringify(m3.myResult));
  ok('BLIND: room average not leaked to players mid-session', m3.round.room_average === undefined, 'leaked ' + m3.round.room_average);
  ok('BLIND: exact err not leaked to players mid-session', m3.myResult.err === undefined, 'leaked ' + m3.myResult.err);
  ok('BLIND: winner guess not leaked mid-session', m3.winner && m3.winner.predict === undefined, JSON.stringify(m3.winner));

  console.log('\n— queue: add two songs, both persist (the old bug) —');
  const qa = await call('/api/admin/round', { sessionId: SID, song_title: 'Queue Song A' }, 'POST', AH);
  const qb = await call('/api/admin/round', { sessionId: SID, song_title: 'Queue Song B' }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('both queued songs present (round 1 not lost)', st.queue.length === 2, 'queue len ' + st.queue.length);
  ok('queue in add order: A then B', st.queue[0].song_title === 'Queue Song A' && st.queue[1].song_title === 'Queue Song B');
  ok('queued songs have no round number yet', st.queue.every(r => !r.idx), JSON.stringify(st.queue.map(r=>r.idx)));

  console.log('\n— reorder queue, then delete one —');
  await call('/api/admin/round/move', { sessionId: SID, roundId: qb.d.roundId, dir: 'up' }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('after move up: B then A', st.queue[0].song_title === 'Queue Song B' && st.queue[1].song_title === 'Queue Song A');
  await call('/api/admin/round/delete', { sessionId: SID, roundId: qa.d.roundId }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('after delete: 1 left (B)', st.queue.length === 1 && st.queue[0].song_title === 'Queue Song B');

  console.log('\n— open queued B: becomes round 2, Iris-only vote —');
  const RID2 = qb.d.roundId;
  const op2 = await call('/api/admin/round/open', { sessionId: SID, roundId: RID2, minutes: 1 }, 'POST', AH);
  ok('open queued round ok', op2.status === 200, JSON.stringify(op2.d));
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('opened round numbered 2 (idx assigned at open)', st.activeRound.idx === 2, 'idx ' + st.activeRound.idx);
  ok('queue now empty', st.queue.length === 0);
  await call('/api/vote', { taste: 9, predict: 9 }, 'POST', { 'X-Player-Token': t3 }); // Iris only, exact -> 125
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: RID2 }, 'POST', AH);
  const m3b = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t3 })).d;
  ok('Iris solo round: rank 1, exact 125', m3b.myResult.rank === 1 && m3b.myResult.points === 125, JSON.stringify(m3b.myResult));
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  const iris = st.participants.find(p => p.name === 'Iris');
  ok('Iris cumulative total carries across rounds', iris.total_points > 125, 'total ' + iris.total_points);

  console.log('\n— guard: cannot open while a round is in play —');
  const qc = await call('/api/admin/round', { sessionId: SID, song_title: 'Mid-flight' }, 'POST', AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qc.d.roundId, minutes: 1 }, 'POST', AH);
  const qd = await call('/api/admin/round', { sessionId: SID, song_title: 'Should block' }, 'POST', AH);
  const blocked = await call('/api/admin/round/open', { sessionId: SID, roundId: qd.d.roundId, minutes: 1 }, 'POST', AH);
  ok('open blocked while another round is voting', blocked.status === 400, JSON.stringify(blocked.d));
  await call('/api/admin/round/close', { sessionId: SID, roundId: qc.d.roundId }, 'POST', AH);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qc.d.roundId }, 'POST', AH);

  console.log('\n— negative round stings, but lifetime total floors at 0 —');
  // New player with 0 total; one wildly-off guess should go negative on the round
  // but their cumulative total must not drop below 0.
  const tn = await join('z@test.com', 'Zed');
  const qz = await call('/api/admin/round', { sessionId: SID, song_title: 'Penalty Test' }, 'POST', AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qz.d.roundId, minutes: 1 }, 'POST', AH);
  // Zed rates 0, predicts 9 -> with a solo vote the room avg = 0, err = 9 -> negative round
  await call('/api/vote', { taste: 0, predict: 9 }, 'POST', { 'X-Player-Token': tn });
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qz.d.roundId }, 'POST', AH);
  const zed = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': tn })).d;
  ok('Zed round score is negative', zed.myResult.points < 0, 'pts ' + zed.myResult.points);
  ok('Zed tier = wayoff', zed.myResult.tier === 'wayoff', 'tier ' + zed.myResult.tier);
  ok('Zed lifetime total floored at 0', zed.myTotalPoints === 0, 'total ' + zed.myTotalPoints);

  console.log('\n— edit a queued song, and reopen an accidentally-closed round —');
  const qe = await call('/api/admin/round', { sessionId: SID, song_title: 'Wrong Title', song_artist: 'Wrong Artist' }, 'POST', AH);
  const ed = await call('/api/admin/round/edit', { sessionId: SID, roundId: qe.d.roundId, song_title: 'Right Title', song_artist: 'Right Artist', giveaway: 'Hat' }, 'POST', AH);
  ok('edit queued song ok', ed.status === 200);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  const editedInQueue = st.queue.find(r => r.id === qe.d.roundId);
  ok('queued song now shows edited title + artist', editedInQueue && editedInQueue.song_title === 'Right Title' && editedInQueue.song_artist === 'Right Artist');
  // open it, close by accident, then reopen
  await call('/api/admin/round/open', { sessionId: SID, roundId: qe.d.roundId, minutes: 2 }, 'POST', AH);
  await call('/api/vote', { taste: 6, predict: 6 }, 'POST', { 'X-Player-Token': t1 });
  await call('/api/admin/round/close', { sessionId: SID, roundId: qe.d.roundId }, 'POST', AH);
  let stc = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('round is closed after accidental close', stc.activeRound.status === 'closed');
  const reo = await call('/api/admin/round/reopen', { sessionId: SID, roundId: qe.d.roundId, minutes: 1 }, 'POST', AH);
  ok('reopen ok', reo.status === 200, JSON.stringify(reo.d));
  stc = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('round is voting again after reopen', stc.activeRound.status === 'voting');
  // a second voter can now join in
  const lateVote = await call('/api/vote', { taste: 8, predict: 7 }, 'POST', { 'X-Player-Token': t2 });
  ok('late voter can vote after reopen', lateVote.d.locked === true);
  // can't edit once ratified
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qe.d.roundId }, 'POST', AH);
  const editLate = await call('/api/admin/round/edit', { sessionId: SID, roundId: qe.d.roundId, song_title: 'Too Late' }, 'POST', AH);
  ok('edit blocked after ratify', editLate.status === 400);
  // can't reopen a ratified round
  const reoLate = await call('/api/admin/round/reopen', { sessionId: SID, roundId: qe.d.roundId, minutes: 1 }, 'POST', AH);
  ok('reopen blocked after ratify', reoLate.status === 400);

  console.log('\n— minutes-based voting window + 2–60 clamp —');
  const qm = await call('/api/admin/round', { sessionId: SID, song_title: 'Two Minute Song' }, 'POST', AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qm.d.roundId, minutes: 2 }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  let windowMs = Number(st.activeRound.closes_at) - st.serverNow;
  ok('2-minute window ≈ 120s', Math.abs(windowMs - 120000) < 5000, 'ms ' + windowMs);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qm.d.roundId }, 'POST', AH);

  // below-minimum clamps up to 2
  const qLow = await call('/api/admin/round', { sessionId: SID, song_title: 'Too Short' }, 'POST', AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qLow.d.roundId, minutes: 0.5 }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  windowMs = Number(st.activeRound.closes_at) - st.serverNow;
  ok('0.5 min clamps up to 2 min', Math.abs(windowMs - 120000) < 5000, 'ms ' + windowMs);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qLow.d.roundId }, 'POST', AH);

  // above-maximum clamps down to 60
  const qHigh = await call('/api/admin/round', { sessionId: SID, song_title: 'Too Long' }, 'POST', AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qHigh.d.roundId, minutes: 999 }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  windowMs = Number(st.activeRound.closes_at) - st.serverNow;
  ok('999 min clamps down to 60 min', Math.abs(windowMs - 3600000) < 5000, 'ms ' + windowMs);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qHigh.d.roundId }, 'POST', AH);

  console.log('\n— per-session default voting window —');
  // default exposed in admin state (this session was created without one → defaults to 5)
  ok('session default_minutes present', st.session.default_minutes === 5, 'got ' + st.session.default_minutes);
  // a session created with a custom default stores it (clamped)
  const cs2 = await call('/api/session', { name: 'Custom Default', defaultMinutes: 10 });
  const st2 = (await call(`/api/admin/state?sessionId=${cs2.d.sessionId}`, null, 'GET', { 'X-Admin-Token': cs2.d.adminToken })).d;
  ok('custom default stored (10)', st2.session.default_minutes === 10, 'got ' + st2.session.default_minutes);
  const cs3 = await call('/api/session', { name: 'Clamped Default', defaultMinutes: 200 });
  const st3 = (await call(`/api/admin/state?sessionId=${cs3.d.sessionId}`, null, 'GET', { 'X-Admin-Token': cs3.d.adminToken })).d;
  ok('out-of-range default clamps to 60', st3.session.default_minutes === 60, 'got ' + st3.session.default_minutes);

  console.log('\n— ad banner cascade: global → session → song —');
  // 1x1 transparent PNG data URI (tiny valid image)
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQGk4+nAAAAAAElFTkSuQmCC';
  const upG = await call('/api/admin/banner/upload', { sessionId: SID, scope: 'global', image_data: PNG, label: 'Global', link_url: 'https://makinitmag.com' }, 'POST', AH);
  ok('global banner uploaded', upG.status === 200 && upG.d.bannerId, JSON.stringify(upG.d));
  await call('/api/admin/banner/assign', { sessionId: SID, target: 'global', bannerId: upG.d.bannerId }, 'POST', AH);
  const upS = await call('/api/admin/banner/upload', { sessionId: SID, scope: 'session', image_data: PNG, label: 'Session' }, 'POST', AH);
  const upSong = await call('/api/admin/banner/upload', { sessionId: SID, scope: 'session', image_data: PNG, label: 'Song' }, 'POST', AH);

  // open a fresh round so we have an active song to attach to
  const qbn = await call("/api/admin/round", { sessionId: SID, song_title: "Banner Song" }, 'POST', AH);
  const BRID = qbn.d.roundId;
  await call('/api/admin/round/open', { sessionId: SID, roundId: BRID, minutes: 2 }, 'POST', AH);

  // With only global assigned, a fresh player in lobby/voting should see the global banner.
  const jb = await join('banner@test.com', 'Bea');
  let bs = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': jb })).d;
  ok('player in voting sees a banner', bs.banner && bs.banner.id === upG.d.bannerId, JSON.stringify(bs.banner));
  ok('banner image is a URL, not base64', bs.banner.image.startsWith('/api/banner/image'), bs.banner.image);
  ok('banner link passes through', bs.banner.link === 'https://makinitmag.com');

  // Assign session-level → now session wins over global.
  await call('/api/admin/banner/assign', { sessionId: SID, target: 'session', bannerId: upS.d.bannerId }, 'POST', AH);
  bs = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': jb })).d;
  ok('session banner overrides global', bs.banner.id === upS.d.bannerId, JSON.stringify(bs.banner));

  // Assign song-level → now song wins over session.
  await call('/api/admin/banner/assign', { sessionId: SID, target: 'song', bannerId: upSong.d.bannerId, roundId: BRID }, 'POST', AH);
  bs = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': jb })).d;
  ok('song banner overrides session', bs.banner.id === upSong.d.bannerId, JSON.stringify(bs.banner));

  // The banner image actually serves.
  const imgRes = await fetch(base + '/api/banner/image?id=' + upSong.d.bannerId);
  ok('banner image serves with image content-type', imgRes.ok && /^image\//.test(imgRes.headers.get('content-type') || ''), imgRes.status + ' ' + imgRes.headers.get('content-type'));

  // Vote + ratify → results phase must NOT carry a banner.
  await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': jb });
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: BRID }, 'POST', AH);
  bs = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': jb })).d;
  ok('results phase carries NO banner', bs.phase === 'results' && (bs.banner === undefined || bs.banner === null), 'banner=' + JSON.stringify(bs.banner));

  // Clearing song banner falls back to session.
  await call('/api/admin/banner/assign', { sessionId: SID, target: 'song', bannerId: null, roundId: BRID }, 'POST', AH);
  // Delete session banner → falls back to global for the next active round.
  await call('/api/admin/banner/delete', { sessionId: SID, bannerId: upS.d.bannerId }, 'POST', AH);
  const adminAfter = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('deleted banner gone from library', !adminAfter.banners.find(b => b.id === upS.d.bannerId));
  ok('session banner_id cleared after delete', adminAfter.session.banner_id == null, 'still ' + adminAfter.session.banner_id);

  console.log('\n— durable user identity across sessions —');
  // Maya (a@test.com) already played this session. Create a SECOND session and
  // have the same email join → must resolve to the same uid, not a duplicate user.
  const s2 = await call('/api/session', { name: 'Second Night' });
  const SID2 = s2.d.sessionId, AH2 = { 'X-Admin-Token': s2.d.adminToken };
  const r2 = await call('/api/join/request', { sessionId: SID2, email: 'a@test.com' });
  await call('/api/join/verify', { sessionId: SID2, email: 'a@test.com', code: r2.d.devCode, name: 'Maya' });
  // Export both sessions (full JSON) and confirm Maya carries the same user_id.
  const exp1 = await fetch(base + `/api/admin/export?sessionId=${SID}&format=json`, { headers: AH }).then(r => r.json());
  const exp2 = await fetch(base + `/api/admin/export?sessionId=${SID2}&format=json`, { headers: AH2 }).then(r => r.json());
  const maya1 = exp1.participants.find(p => p.email === 'a@test.com');
  const maya2 = exp2.participants.find(p => p.email === 'a@test.com');
  ok('same email gets a user_id in session 1', !!(maya1 && maya1.user_id), JSON.stringify(maya1));
  ok('same email gets a user_id in session 2', !!(maya2 && maya2.user_id), JSON.stringify(maya2));
  ok('returning user has the SAME uid across sessions', maya1 && maya2 && maya1.user_id === maya2.user_id, `${maya1&&maya1.user_id} vs ${maya2&&maya2.user_id}`);

  console.log('\n— data export (full + anonymized, csv + json) —');
  const fullJson = await fetch(base + `/api/admin/export?sessionId=${SID}&format=json`, { headers: AH }).then(r => r.json());
  ok('full JSON has participants/rounds/votes', fullJson.participants && fullJson.rounds && fullJson.votes, Object.keys(fullJson).join(','));
  ok('full JSON includes emails', fullJson.participants.some(p => p.email && p.email.includes('@')));
  ok('full JSON votes carry room_average + points', fullJson.votes.length > 0 && 'room_average' in fullJson.votes[0] && 'points' in fullJson.votes[0], JSON.stringify(fullJson.votes[0] || {}));

  const anonJson = await fetch(base + `/api/admin/export?sessionId=${SID}&format=json&anon=1`, { headers: AH }).then(r => r.json());
  ok('anon JSON marked anonymized', anonJson.session.anonymized === true);
  ok('anon JSON has NO emails', !anonJson.participants.some(p => 'email' in p), JSON.stringify(anonJson.participants[0] || {}));
  ok('anon JSON has NO names', !anonJson.participants.some(p => 'name' in p));
  ok('anon JSON uses Player N labels', anonJson.participants.every(p => /^Player \d+$/.test(p.player)), JSON.stringify(anonJson.participants[0] || {}));
  ok('anon votes still have behavioral data', anonJson.votes.every(v => 'rating' in v && 'prediction' in v && 'points' in v));

  const csvRes = await fetch(base + `/api/admin/export?sessionId=${SID}&format=csv`, { headers: AH });
  const csvText = await csvRes.text();
  ok('CSV content-type + attachment', /text\/csv/.test(csvRes.headers.get('content-type') || '') && /attachment/.test(csvRes.headers.get('content-disposition') || ''));
  ok('CSV has header row + data', csvText.split('\n').length > 1 && csvText.split('\n')[0].includes('rating'), csvText.split('\n')[0]);

  const csvAnon = await fetch(base + `/api/admin/export?sessionId=${SID}&format=csv&anon=1`, { headers: AH }).then(r => r.text());
  ok('anon CSV header omits email', !csvAnon.split('\n')[0].includes('email'), csvAnon.split('\n')[0]);

  ok('export requires admin auth', (await fetch(base + `/api/admin/export?sessionId=${SID}&format=json`)).status === 401);

  console.log('\n— identity layer schema (stage 1) —');
  // New sessions default to 'live' status (was 'open').
  const liveCheck = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('session has a status', !!liveCheck.session.status, JSON.stringify(liveCheck.session.status));
  // Export still works (schema additions didn't break participant shape).
  const expCheck = await fetch(base + `/api/admin/export?sessionId=${SID}&format=json`, { headers: AH }).then(r => r.json());
  ok('participants export still works post-schema-change', Array.isArray(expCheck.participants));

  console.log('\n— host login + ownership access (stage 2/3) —');
  // First-account-is-admin (3.5b): establish the ADMIN_EMAIL admin BEFORE the host logs
  // in, so the test host stays a regular (non-admin) host instead of being auto-promoted
  // as the first account on a fresh DB.
  const seedAdm = await call('/api/auth/request', { email: 'admin@test.com' });
  await call('/api/auth/verify', { email: 'admin@test.com', code: seedAdm.d.devCode });
  // Host login via OTP (auth-scoped, no session needed).
  const authReq = await call('/api/auth/request', { email: 'host@test.com' });
  ok('auth OTP issued', authReq.status === 200 && authReq.d.devCode, JSON.stringify(ar.d));
  const authVer = await call('/api/auth/verify', { email: 'host@test.com', code: authReq.d.devCode });
  ok('auth verify returns token + role', authVer.status === 200 && authVer.d.token && authVer.d.role === 'player', JSON.stringify(authVer.d));
  const HOSTTOK = authVer.d.token;
  const AUTHH = { 'X-Auth-Token': HOSTTOK };

  // /auth/me validates the token.
  const me = await call('/api/auth/me', null, 'GET', AUTHH);
  ok('auth/me returns identity', me.status === 200 && me.d.email === 'host@test.com', JSON.stringify(me.d));

  // A logged-in host creates a session → they own it.
  const ownSess = await call('/api/session', { name: 'Host Owned' }, 'POST', AUTHH);
  ok('host creates a session', ownSess.status === 200 && ownSess.d.sessionId, JSON.stringify(ownSess.d));
  const OSID = ownSess.d.sessionId;

  // Host can admin their OWN session via auth token (no per-session admin token needed).
  const ownState = await call(`/api/admin/state?sessionId=${OSID}`, null, 'GET', AUTHH);
  ok('owner can admin own session via auth token', ownState.status === 200 && ownState.d.session, JSON.stringify(ownState.status));

  // A DIFFERENT host cannot admin someone else's session.
  const ar2 = await call('/api/auth/request', { email: 'other@test.com' });
  const av2 = await call('/api/auth/verify', { email: 'other@test.com', code: ar2.d.devCode });
  const OTHERH = { 'X-Auth-Token': av2.d.token };
  const denied = await call(`/api/admin/state?sessionId=${OSID}`, null, 'GET', OTHERH);
  ok('non-owner host is denied', denied.status === 401, 'got ' + denied.status);

  // The admin (promoted via ADMIN_EMAIL=admin@test.com in the test run) sees ALL sessions.
  const ara = await call('/api/auth/request', { email: 'admin@test.com' });
  const ava = await call('/api/auth/verify', { email: 'admin@test.com', code: ara.d.devCode });
  ok('admin email has admin role', ava.d.role === 'admin', 'role=' + ava.d.role);
  const ADMINH = { 'X-Auth-Token': ava.d.token };
  const adminSees = await call(`/api/admin/state?sessionId=${OSID}`, null, 'GET', ADMINH);
  ok('admin can admin any session', adminSees.status === 200, 'got ' + adminSees.status);

  // Session picker: host sees only theirs; admin sees all.
  const hostList = await call('/api/auth/sessions', null, 'GET', AUTHH);
  ok('host sees own sessions only', hostList.d.sessions.every(s => s.owner_uid === me.d.uid), JSON.stringify(hostList.d.sessions.map(s=>s.id)));
  const adminList = await call('/api/auth/sessions', null, 'GET', ADMINH);
  ok('admin sees all sessions (>= host count)', adminList.d.sessions.length >= hostList.d.sessions.length);

  console.log('\n— session lifecycle (stage 4) —');
  // Create an upcoming (pre-registration) session.
  const upc = await call('/api/session', { name: 'Future Show', status: 'upcoming', scheduledAt: Date.now() + 86400000 }, 'POST', AUTHH);
  const UPID = upc.d.sessionId;
  let us = await call(`/api/admin/state?sessionId=${UPID}`, null, 'GET', AUTHH);
  ok('session created as upcoming', us.d.session.status === 'upcoming', us.d.session.status);
  // Players can still JOIN an upcoming session (pre-register).
  const preReg = await call('/api/join/request', { sessionId: UPID, email: 'early@test.com' });
  ok('player can pre-register for upcoming', preReg.status === 200, JSON.stringify(preReg.d));
  // Go live explicitly.
  await call('/api/admin/session/status', { sessionId: UPID, status: 'live' }, 'POST', AUTHH);
  us = await call(`/api/admin/state?sessionId=${UPID}`, null, 'GET', AUTHH);
  ok('host can take session live', us.d.session.status === 'live', us.d.session.status);
  // Complete, then reopen (the key "load a past session" capability).
  await call('/api/admin/session/status', { sessionId: UPID, status: 'completed' }, 'POST', AUTHH);
  await call('/api/admin/session/status', { sessionId: UPID, status: 'archived' }, 'POST', AUTHH);
  us = await call(`/api/admin/state?sessionId=${UPID}`, null, 'GET', AUTHH);
  ok('host can archive', us.d.session.status === 'archived', us.d.session.status);
  await call('/api/admin/session/status', { sessionId: UPID, status: 'live' }, 'POST', AUTHH);
  us = await call(`/api/admin/state?sessionId=${UPID}`, null, 'GET', AUTHH);
  ok('host can reopen an archived session', us.d.session.status === 'live', us.d.session.status);

  // Logout invalidates the token.
  await call('/api/auth/logout', {}, 'POST', AUTHH);
  const afterLogout = await call('/api/auth/me', null, 'GET', AUTHH);
  ok('logout invalidates token', afterLogout.status === 401, 'got ' + afterLogout.status);

  console.log('\n— legacy per-session admin token still works (back-compat) —');
  const legacyState = await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH);
  ok('legacy admin token still admins its session', legacyState.status === 200, 'got ' + legacyState.status);

  console.log('\n— SMS consent via phone presence (phone = opt-in, no checkbox) —');
  const smsYesReq = await call('/api/join/request', { sessionId: SID, email: 'sms-yes@test.com' });
  await call('/api/join/verify', { sessionId: SID, email: 'sms-yes@test.com', code: smsYesReq.d.devCode, name: 'Yes Person', phone: '555-111-2222' });
  const expY = await fetch(base + `/api/admin/export?sessionId=${SID}&format=json`, { headers: AH }).then(r => r.json());
  const yRow = expY.participants.find(p => p.email === 'sms-yes@test.com');
  ok('player with phone stored', yRow && yRow.phone === '555-111-2222', JSON.stringify(yRow && yRow.phone));
  ok('phone presence = consent', yRow && (yRow.sms_marketing_consent === 1 || yRow.sms_marketing_consent === true), JSON.stringify(yRow && yRow.sms_marketing_consent));
  const smsNoReq = await call('/api/join/request', { sessionId: SID, email: 'sms-no@test.com' });
  await call('/api/join/verify', { sessionId: SID, email: 'sms-no@test.com', code: smsNoReq.d.devCode, name: 'No Person', phone: '', smsConsent: true });
  const expN = await fetch(base + `/api/admin/export?sessionId=${SID}&format=json`, { headers: AH }).then(r => r.json());
  const nRow = expN.participants.find(p => p.email === 'sms-no@test.com');
  ok('no phone = not consented (even if client claims consent)', nRow && (nRow.sms_marketing_consent === 0 || nRow.sms_marketing_consent === false || nRow.sms_marketing_consent == null), JSON.stringify(nRow && nRow.sms_marketing_consent));

  console.log('\n— returning prefill + phone-as-consent combined —');
  const pfEmail = 'combo@test.com';
  const pfSessA = await call('/api/session', { name: 'Combo One' });
  const pfReqA = await call('/api/join/request', { sessionId: pfSessA.d.sessionId, email: pfEmail });
  ok('first visit not returning', pfReqA.d.returning === false, JSON.stringify(pfReqA.d.returning));
  await call('/api/join/verify', { sessionId: pfSessA.d.sessionId, email: pfEmail, code: pfReqA.d.devCode, name: 'Combo Kid', phone: '4045550101' });
  const pfSessB = await call('/api/session', { name: 'Combo Two' });
  const pfReqB = await call('/api/join/request', { sessionId: pfSessB.d.sessionId, email: pfEmail });
  ok('return visit flagged returning', pfReqB.d.returning === true, JSON.stringify(pfReqB.d.returning));
  ok('prefill name present', pfReqB.d.prefill && pfReqB.d.prefill.name === 'Combo Kid', JSON.stringify(pfReqB.d.prefill));
  ok('phone hint masked', pfReqB.d.prefill && pfReqB.d.prefill.phoneHint === '••• 0101', JSON.stringify(pfReqB.d.prefill && pfReqB.d.prefill.phoneHint));
  ok('full phone not leaked in request', !JSON.stringify(pfReqB.d).includes('4045550101') && !JSON.stringify(pfReqB.d).includes('5550101'));
  await call('/api/join/verify', { sessionId: pfSessB.d.sessionId, email: pfEmail, code: pfReqB.d.devCode, name: 'Combo Kid', phone: '', keepPhone: true });
  const pfSessC = await call('/api/session', { name: 'Combo Three' });
  const pfReqC = await call('/api/join/request', { sessionId: pfSessC.d.sessionId, email: pfEmail });
  ok('kept phone preserved (still on file)', pfReqC.d.prefill && pfReqC.d.prefill.phoneHint === '••• 0101', JSON.stringify(pfReqC.d.prefill && pfReqC.d.prefill.phoneHint));

  console.log('\n— end session: shareable recap revealed —');
  await call('/api/admin/session/end', { sessionId: SID }, 'POST', AH);
  const ms = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t1 })).d;
  ok('player sees completed', ms.session.status === 'completed', ms.session.status);
  ok('phase is recap', ms.phase === 'recap', ms.phase);
  ok('recap has total points', typeof ms.recap.totalPoints === 'number');
  ok('recap has a letter grade', /^[A-DF][+-]?$/.test(ms.recap.grade || ''), 'grade ' + ms.recap.grade);
  ok('recap reveals overall room average', ms.recap.overallRoomAvg != null, 'avg ' + ms.recap.overallRoomAvg);
  ok('recap has rank + field size', ms.recap.rank >= 1 && ms.recap.fieldSize >= 1, JSON.stringify({r:ms.recap.rank,f:ms.recap.fieldSize}));
  ok('recap has percentile', typeof ms.recap.percentile === 'number');
  ok('recap counts bullseyes', typeof ms.recap.bullseyes === 'number');

  // auth guards
  const noauth = await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', {});
  ok('admin state requires token', noauth.status === 401);

  // ======================================================================
  // BINARY POLL ("Verzuz" mode) — a SECOND poll type. Self-contained: its own
  // session, players, round, votes, ratify, results, recap, and export.
  // ======================================================================
  console.log('\n— binary poll: create a binary session —');
  const bcs = await call('/api/session', { name: 'Verzuz Night', pollType: 'binary' });
  ok('binary session created', bcs.status === 200 && bcs.d.sessionId, JSON.stringify(bcs.d));
  ok('create echoes pollType=binary', bcs.d.pollType === 'binary', 'got ' + bcs.d.pollType);
  const BSID = bcs.d.sessionId, BATOK = bcs.d.adminToken;
  const BAH = { 'X-Admin-Token': BATOK };

  let bst = (await call(`/api/admin/state?sessionId=${BSID}`, null, 'GET', BAH)).d;
  ok('admin state reports poll_type=binary', bst.poll_type === 'binary', 'got ' + bst.poll_type);

  console.log('\n— binary: four players join —');
  async function bjoin(email, name) {
    const req = await call('/api/join/request', { sessionId: BSID, email });
    const ver = await call('/api/join/verify', { sessionId: BSID, email, code: req.d.devCode, name });
    return ver.d.token;
  }
  const b1 = await bjoin('ba@test.com', 'Ann');   // pick A
  const b2 = await bjoin('bb@test.com', 'Ben');   // pick A
  const b3 = await bjoin('bc@test.com', 'Cleo');  // pick B
  const b4 = await bjoin('bd@test.com', 'Dom');   // pick B
  bst = (await call(`/api/admin/state?sessionId=${BSID}`, null, 'GET', BAH)).d;
  ok('binary: 4 verified', bst.verifiedCount === 4, 'got ' + bst.verifiedCount);

  console.log('\n— binary: round needs both A and B —');
  const missB = await call('/api/admin/round', { sessionId: BSID, song_title: 'Only A' }, 'POST', BAH);
  ok('binary round requires Song B', missB.status === 400, 'got ' + missB.status);
  const bar = await call('/api/admin/round', { sessionId: BSID, song_title: 'Jay-Z', song_artist: 'HOV', option_b_title: 'Nas', option_b_artist: 'Nasir', giveaway: 'Tickets' }, 'POST', BAH);
  ok('binary round added with A/B', bar.status === 200 && bar.d.roundId, JSON.stringify(bar.d));
  const VBRID = bar.d.roundId;
  const bop = await call('/api/admin/round/open', { sessionId: BSID, roundId: VBRID, minutes: 1 }, 'POST', BAH);
  ok('binary round opened', bop.status === 200);

  // Player sees the A/B labels + poll_type.
  let bps = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': b1 })).d;
  ok('binary player phase=voting', bps.phase === 'voting', bps.phase);
  ok('binary player poll_type=binary', bps.poll_type === 'binary', bps.poll_type);
  ok('binary player sees Song A title', bps.round.song_title === 'Jay-Z', bps.round.song_title);
  ok('binary player sees Song B title', bps.round.option_b_title === 'Nas', bps.round.option_b_title);

  console.log('\n— binary: votes (2 pick A, 2 pick B -> actual split A=50) —');
  // Predicted splits: Ann 60 (err 10), Ben 70 (err 20), Cleo 50 (err 0 -> winner), Dom 20 (err 30)
  const bv1 = await call('/api/vote', { pick: 'A', predict_split: 60 }, 'POST', { 'X-Player-Token': b1 });
  await new Promise(r=>setTimeout(r,5));
  const bv2 = await call('/api/vote', { pick: 'A', predict_split: 70 }, 'POST', { 'X-Player-Token': b2 });
  const bv3 = await call('/api/vote', { pick: 'B', predict_split: 50 }, 'POST', { 'X-Player-Token': b3 });
  const bv4 = await call('/api/vote', { pick: 'B', predict_split: 20 }, 'POST', { 'X-Player-Token': b4 });
  ok('binary vote 1 locked', bv1.d.locked === true, JSON.stringify(bv1.d));
  ok('binary vote 3 locked', bv3.d.locked === true, JSON.stringify(bv3.d));

  // Cross-shaped votes rejected both ways.
  const wrongShape = await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': b1 });
  ok('rating-shaped vote rejected on binary session', wrongShape.status === 400, 'got ' + wrongShape.status);
  const badPick = await call('/api/join/verify', { sessionId: BSID, email: 'be@test.com', code: (await call('/api/join/request', { sessionId: BSID, email: 'be@test.com' })).d.devCode, name: 'Eve' });
  const noSide = await call('/api/vote', { predict_split: 50 }, 'POST', { 'X-Player-Token': badPick.d.token });
  ok('binary vote without a pick rejected', noSide.status === 400, 'got ' + noSide.status);

  // Admin live split preview.
  bst = (await call(`/api/admin/state?sessionId=${BSID}`, null, 'GET', BAH)).d;
  ok('admin sees binary live votes', bst.liveVotes.length === 4, 'got ' + bst.liveVotes.length);
  ok('admin live votes carry pick', bst.liveVotes.every(v => v.pick === 'A' || v.pick === 'B'), JSON.stringify(bst.liveVotes[0]));
  ok('admin live split = 50 (2 of 4 A)', bst.liveSplit === 50, 'got ' + bst.liveSplit);

  console.log('\n— binary: ratify -> split + scoring —');
  const brat = await call('/api/admin/round/ratify', { sessionId: BSID, roundId: VBRID }, 'POST', BAH);
  ok('binary ratify ok', brat.status === 200, JSON.stringify(brat.d));
  ok('binary ratify reports poll_type', brat.d.poll_type === 'binary', brat.d.poll_type);
  ok('binary actual split A = 50', brat.d.split_a === 50, 'got ' + brat.d.split_a);
  ok('binary ratify room_average null', brat.d.room_average === null, 'got ' + brat.d.room_average);

  console.log('\n— binary: results (Cleo exact split wins) —');
  const bm3 = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': b3 })).d;
  ok('binary player phase=results', bm3.phase === 'results', bm3.phase);
  ok('binary winner is Cleo (exact split)', bm3.winner && bm3.winner.name === 'Cleo', JSON.stringify(bm3.winner));
  ok('binary Cleo rank 1', bm3.myResult.rank === 1, 'rank ' + bm3.myResult.rank);
  ok('binary Cleo exact = 125 pts', bm3.myResult.points === 125, 'pts ' + bm3.myResult.points);
  ok('binary Cleo tier = bullseye', bm3.myResult.tier === 'bullseye', 'tier ' + bm3.myResult.tier);
  ok('binary result carries pick', bm3.myResult.pick === 'B', 'pick ' + bm3.myResult.pick);
  ok('binary result carries predict_split', bm3.myResult.predict_split === 50, 'split ' + bm3.myResult.predict_split);
  // BLIND: actual split not leaked mid-session.
  ok('BLIND: split_a not leaked to players mid-session', bm3.round.split_a === undefined, 'leaked ' + bm3.round.split_a);
  ok('BLIND: exact err not leaked mid-session', bm3.myResult.err === undefined, 'leaked ' + bm3.myResult.err);

  const bm1 = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': b1 })).d;
  ok('binary Ann (err 10) gets close/positive points', bm1.myResult.points > 0 && bm1.myResult.tier, JSON.stringify(bm1.myResult));

  console.log('\n— binary: export carries pick/split columns —');
  const bExpJson = await fetch(base + `/api/admin/export?sessionId=${BSID}&format=json`, { headers: BAH }).then(r => r.json());
  ok('binary export poll_type=binary', bExpJson.session.poll_type === 'binary', JSON.stringify(bExpJson.session.poll_type));
  ok('binary export votes have pick', bExpJson.votes.every(v => v.pick === 'A' || v.pick === 'B'), JSON.stringify(bExpJson.votes[0]));
  ok('binary export votes have predict_split', bExpJson.votes.every(v => typeof v.predict_split === 'number'), JSON.stringify(bExpJson.votes[0]));
  ok('binary export rounds have split_a', bExpJson.rounds.every(r => typeof r.split_a === 'number'), JSON.stringify(bExpJson.rounds[0]));
  ok('binary export rounds carry both songs', bExpJson.rounds[0].song_a_title === 'Jay-Z' && bExpJson.rounds[0].song_b_title === 'Nas', JSON.stringify(bExpJson.rounds[0]));
  const bCsv = await fetch(base + `/api/admin/export?sessionId=${BSID}&format=csv`, { headers: BAH }).then(r => r.text());
  ok('binary CSV header has pick + predict_split + split_a', /pick/.test(bCsv) && /predict_split/.test(bCsv) && /split_a/.test(bCsv), bCsv.split('\n')[0]);

  console.log('\n— binary: end session -> recap (no 0-9 grade, split-based) —');
  await call('/api/admin/session/end', { sessionId: BSID }, 'POST', BAH);
  const brecap = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': b3 })).d;
  ok('binary phase is recap', brecap.phase === 'recap', brecap.phase);
  ok('binary recap poll_type=binary', brecap.recap.poll_type === 'binary', brecap.recap.poll_type);
  ok('binary recap has total points', typeof brecap.recap.totalPoints === 'number');
  ok('binary recap has overallSplitA', typeof brecap.recap.overallSplitA === 'number', 'got ' + brecap.recap.overallSplitA);
  ok('binary recap omits 0-9 letter grade', brecap.recap.grade == null, 'grade ' + brecap.recap.grade);

  console.log('\n— rating game untouched: original session still rating —');
  const ratingStillWorks = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('original session is rating type', ratingStillWorks.poll_type === 'rating', ratingStillWorks.poll_type);

  // ======================================================================
  // EVENT TOOLS — watch link, lobby message, sign-up prompt, broadcast, overlay
  // ======================================================================
  console.log('\n— event tools: session config at creation —');
  const ecs = await call('/api/session', { name: 'Event Night', watchUrl: 'https://twitch.tv/example', lobbyMessage: 'Starting soon!', signupPrompt: 'Drop your IG + city' });
  ok('session created with config', ecs.status === 200 && ecs.d.sessionId, JSON.stringify(ecs.d));
  const ESID = ecs.d.sessionId, EATOK = ecs.d.adminToken, EAH = { 'X-Admin-Token': EATOK };
  let es = (await call(`/api/admin/state?sessionId=${ESID}`, null, 'GET', EAH)).d;
  ok('watch_url stored', es.session.watch_url === 'https://twitch.tv/example', es.session.watch_url);
  ok('lobby_message stored', es.session.lobby_message === 'Starting soon!', es.session.lobby_message);
  ok('signup_prompt stored', es.session.signup_prompt === 'Drop your IG + city', es.session.signup_prompt);

  console.log('\n— event tools: bad watch url is rejected (sanitized to null) —');
  const badUrl = await call('/api/session', { name: 'Bad URL', watchUrl: 'javascript:alert(1)' });
  const buState = (await call(`/api/admin/state?sessionId=${badUrl.d.sessionId}`, null, 'GET', { 'X-Admin-Token': badUrl.d.adminToken })).d;
  ok('non-http watch url sanitized to null', buState.session.watch_url === null, 'got ' + buState.session.watch_url);

  console.log('\n— event tools: update config after creation —');
  await call('/api/admin/session/config', { sessionId: ESID, watchUrl: 'https://youtube.com/live', lobbyMessage: '', signupPrompt: 'IG only' }, 'POST', EAH);
  es = (await call(`/api/admin/state?sessionId=${ESID}`, null, 'GET', EAH)).d;
  ok('watch_url updated', es.session.watch_url === 'https://youtube.com/live', es.session.watch_url);
  ok('lobby_message cleared via empty string', es.session.lobby_message === null, JSON.stringify(es.session.lobby_message));
  ok('signup_prompt updated', es.session.signup_prompt === 'IG only', es.session.signup_prompt);

  console.log('\n— event tools: sign-up prompt surfaced at join + answer captured —');
  const ejr = await call('/api/join/request', { sessionId: ESID, email: 'fan@test.com' });
  ok('join/request returns signup prompt', ejr.d.signupPrompt === 'IG only', ejr.d.signupPrompt);
  ok('join/request returns watch url', ejr.d.watchUrl === 'https://youtube.com/live', ejr.d.watchUrl);
  await call('/api/join/verify', { sessionId: ESID, email: 'fan@test.com', code: ejr.d.devCode, name: 'Fan One', signupAnswer: '@fanone · Atlanta' });
  const eexp = await fetch(base + `/api/admin/export?sessionId=${ESID}&format=json`, { headers: EAH }).then(r => r.json());
  const fanRow = eexp.participants.find(p => p.email === 'fan@test.com');
  ok('signup_answer captured + exported', fanRow && fanRow.signup_answer === '@fanone · Atlanta', JSON.stringify(fanRow && fanRow.signup_answer));
  const eexpAnon = await fetch(base + `/api/admin/export?sessionId=${ESID}&format=json&anon=1`, { headers: EAH }).then(r => r.json());
  ok('signup_answer NOT in anon export', eexpAnon.participants.every(p => !('signup_answer' in p)), JSON.stringify(eexpAnon.participants[0]));

  console.log('\n— event tools: broadcast push + clear —');
  const bc = await call('/api/admin/session/broadcast', { sessionId: ESID, text: 'Running 10 min late!' }, 'POST', EAH);
  ok('broadcast push ok', bc.status === 200 && bc.d.at, JSON.stringify(bc.d));
  es = (await call(`/api/admin/state?sessionId=${ESID}`, null, 'GET', EAH)).d;
  ok('broadcast visible in admin state', es.session.broadcast && es.session.broadcast.text === 'Running 10 min late!', JSON.stringify(es.session.broadcast));
  // Player sees it too.
  const fanState = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': (await (async()=>{const r=await call('/api/join/request',{sessionId:ESID,email:'fan2@test.com'});const v=await call('/api/join/verify',{sessionId:ESID,email:'fan2@test.com',code:r.d.devCode,name:'Fan Two'});return v.d.token;})()) } )).d;
  ok('player sees broadcast', fanState.broadcast && fanState.broadcast.text === 'Running 10 min late!', JSON.stringify(fanState.broadcast));
  ok('player sees watch_url + lobby in state', fanState.watch_url === 'https://youtube.com/live', fanState.watch_url);
  await call('/api/admin/session/broadcast', { sessionId: ESID, clear: true }, 'POST', EAH);
  es = (await call(`/api/admin/state?sessionId=${ESID}`, null, 'GET', EAH)).d;
  ok('broadcast cleared', es.session.broadcast === null, JSON.stringify(es.session.broadcast));

  console.log('\n— overlay: public PII-safe state —');
  const ov = await fetch(base + `/api/overlay/state?s=${ESID}`).then(r => r.json());
  ok('overlay needs no auth', !!ov.session, JSON.stringify(ov.session && ov.session.name));
  ok('overlay carries leaderboard', Array.isArray(ov.leaderboard), JSON.stringify(ov.leaderboard && ov.leaderboard.length));
  ok('overlay first-names only (no spaces)', ov.leaderboard.every(r => !/\s/.test(r.name)), JSON.stringify(ov.leaderboard.map(r=>r.name)));
  const ovStr = JSON.stringify(ov);
  ok('overlay leaks no emails', !/@test\.com/.test(ovStr));
  ok('overlay leaks no signup answers', !/Atlanta/.test(ovStr) && !/fanone/.test(ovStr));
  const ovBad = await fetch(base + `/api/overlay/state?s=nope`).then(r => r.status);
  ok('overlay 404s unknown session', ovBad === 404, 'got ' + ovBad);

  // ======================================================================
  // REFERRALS — code issued, attribution on join, credit on first vote
  // ======================================================================
  console.log('\n— referrals: each player gets a code; referred join is attributed —');
  const rcs = await call('/api/session', { name: 'Referral Test' });
  const RSID = rcs.d.sessionId, RATOK = rcs.d.adminToken, RAH = { 'X-Admin-Token': RATOK };
  // Inviter joins.
  async function rjoin(email, name, ref) {
    const req = await call('/api/join/request', { sessionId: RSID, email });
    const body = { sessionId: RSID, email, code: req.d.devCode, name };
    if (ref) body.ref = ref;
    const ver = await call('/api/join/verify', body);
    return ver.d.token;
  }
  const inviterTok = await rjoin('inviter@test.com', 'Ivy Inviter');
  const inviterState = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': inviterTok })).d;
  ok('player gets a ref code', !!inviterState.refCode && inviterState.refCode.length >= 4, JSON.stringify(inviterState.refCode));
  ok('referred count starts at 0', inviterState.referredCount === 0, 'got ' + inviterState.referredCount);
  const INVITE_CODE = inviterState.refCode;

  // Referred player joins WITH the code.
  const refTok = await rjoin('referred@test.com', 'Reggie Referred', INVITE_CODE);
  // Not credited yet (hasn't played).
  let inv2 = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': inviterTok })).d;
  ok('referral NOT credited before play', inv2.referredCount === 0, 'got ' + inv2.referredCount);

  console.log('\n— referrals: credit only after the referred player actually plays —');
  // Open a round and have the referred player vote.
  const rr = await call('/api/admin/round', { sessionId: RSID, song_title: 'Ref Song' }, 'POST', RAH);
  const RRID = rr.d.roundId;
  await call('/api/admin/round/open', { sessionId: RSID, roundId: RRID, minutes: 2 }, 'POST', RAH);
  await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': refTok });
  inv2 = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': inviterTok })).d;
  ok('referral credited after referee plays', inv2.referredCount === 1, 'got ' + inv2.referredCount);

  console.log('\n— referrals: self-referral and unknown codes are ignored —');
  // Self-referral: a NEW player using a code that maps to their own (future) row can't —
  // codes map to existing inviters, so test that an unknown code yields organic.
  const orphanTok = await rjoin('orphan@test.com', 'Olive Orphan', 'ZZZZZZ');
  const rexp = await fetch(base + `/api/admin/export?sessionId=${RSID}&format=json`, { headers: RAH }).then(r => r.json());
  const orphanRow = rexp.participants.find(p => p.email === 'orphan@test.com');
  ok('unknown ref code -> organic (no referrer)', orphanRow && orphanRow.referred_by === null, JSON.stringify(orphanRow && orphanRow.referred_by));
  // A player using their OWN code: have the inviter try to re-join with their own code — same email blocks self-ref.
  await rjoin('inviter@test.com', 'Ivy Inviter', INVITE_CODE);
  const rexp2 = await fetch(base + `/api/admin/export?sessionId=${RSID}&format=json`, { headers: RAH }).then(r => r.json());
  const invRow = rexp2.participants.find(p => p.email === 'inviter@test.com');
  ok('self-referral blocked (inviter has no referrer)', invRow && invRow.referred_by === null, JSON.stringify(invRow && invRow.referred_by));

  console.log('\n— referrals: export attribution (anon-safe) —');
  const refRow = rexp2.participants.find(p => p.email === 'referred@test.com');
  ok('referred_by maps to inviter label', refRow && /^Player \d+$/.test(refRow.referred_by || ''), JSON.stringify(refRow && refRow.referred_by));
  ok('referral_credited reflected in export', refRow && refRow.referral_credited === 1, JSON.stringify(refRow && refRow.referral_credited));
  const rexpAnon = await fetch(base + `/api/admin/export?sessionId=${RSID}&format=json&anon=1`, { headers: RAH }).then(r => r.json());
  ok('anon export still has referral attribution (no PII)', rexpAnon.participants.some(p => p.referred_by && /^Player \d+$/.test(p.referred_by)), JSON.stringify(rexpAnon.participants.map(p=>p.referred_by)));
  ok('anon export leaks no referral emails', !/@test\.com/.test(JSON.stringify(rexpAnon.participants)));

  // ======================================================================
  // GEOFENCED CHECK-IN — venue pin, modes, lock-in gate, pooling, privacy
  // ======================================================================
  console.log('\n— geo: venue can be set ahead, enforcement off; config independent —');
  const gcs = await call('/api/session', { name: 'LA Event' });
  const GSID = gcs.d.sessionId, GATOK = gcs.d.adminToken, GAH = { 'X-Admin-Token': GATOK };
  // Set venue pin now (as if geocoded), leave geo_mode off.
  const VENUE = { lat: 34.0430, lng: -118.2673 }; // ~ LA live venue
  await call('/api/admin/session/config', { sessionId: GSID, geoLat: VENUE.lat, geoLng: VENUE.lng, geoRadius: 200, geoLabel: 'The Novo, Los Angeles' }, 'POST', GAH);
  let gs = (await call(`/api/admin/state?sessionId=${GSID}`, null, 'GET', GAH)).d;
  ok('venue pin stored', gs.session.geo_lat === VENUE.lat && gs.session.geo_lng === VENUE.lng, JSON.stringify([gs.session.geo_lat, gs.session.geo_lng]));
  ok('geo_mode still off (enforcement independent)', gs.session.geo_mode === 'off', gs.session.geo_mode);
  ok('venue label stored', gs.session.geo_label === 'The Novo, Los Angeles', gs.session.geo_label);

  console.log('\n— geo: with enforcement off, voting is NOT gated —');
  async function gjoin(email, name) {
    const r = await call('/api/join/request', { sessionId: GSID, email });
    const v = await call('/api/join/verify', { sessionId: GSID, email, code: r.d.devCode, name });
    return v.d.token;
  }
  const gRound1 = await call('/api/admin/round', { sessionId: GSID, song_title: 'Pre-enforce' }, 'POST', GAH);
  await call('/api/admin/round/open', { sessionId: GSID, roundId: gRound1.d.roundId, minutes: 5 }, 'POST', GAH);
  const earlyTok = await gjoin('early@test.com', 'Early Bird');
  const earlyVote = await call('/api/vote', { taste: 6, predict: 6 }, 'POST', { 'X-Player-Token': earlyTok });
  ok('vote locks with geo off', earlyVote.d.locked === true, JSON.stringify(earlyVote.d));
  await call('/api/admin/round/ratify', { sessionId: GSID, roundId: gRound1.d.roundId }, 'POST', GAH);

  console.log('\n— geo: flip enforcement ON (optional/dual-pool); lock-in now gated —');
  await call('/api/admin/session/config', { sessionId: GSID, geoMode: 'optional' }, 'POST', GAH);
  const gRound2 = await call('/api/admin/round', { sessionId: GSID, song_title: 'Geo Round' }, 'POST', GAH);
  await call('/api/admin/round/open', { sessionId: GSID, roundId: gRound2.d.roundId, minutes: 5 }, 'POST', GAH);
  const inTok = await gjoin('inroom@test.com', 'In Room');
  // Player state advertises the geo requirement.
  const inState = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': inTok })).d;
  ok('player sees geo mode', inState.geo && inState.geo.mode === 'optional', JSON.stringify(inState.geo));
  ok('player pool null before check-in', inState.pool === null, JSON.stringify(inState.pool));
  // Try to lock in without checking in -> 428 checkin_required.
  const gated = await call('/api/vote', { taste: 7, predict: 7 }, 'POST', { 'X-Player-Token': inTok });
  ok('lock-in gated by check-in (428)', gated.status === 428 && gated.d.error === 'checkin_required', JSON.stringify([gated.status, gated.d]));

  console.log('\n— geo: in-radius check-in -> in_person, then vote locks —');
  // ~30 yards away (tiny offset).
  const near = { lat: VENUE.lat + 0.0002, lng: VENUE.lng };
  const ciIn = await call('/api/checkin', { lat: near.lat, lng: near.lng, accuracy: 15 }, 'POST', { 'X-Player-Token': inTok });
  ok('in-radius -> in_person pool', ciIn.d.pool === 'in_person' && ciIn.d.checked_in, JSON.stringify(ciIn.d));
  const inVote = await call('/api/vote', { taste: 7, predict: 7 }, 'POST', { 'X-Player-Token': inTok });
  ok('vote locks after check-in', inVote.d.locked === true, JSON.stringify(inVote.d));

  console.log('\n— geo: far check-in in optional mode -> online pool —');
  const farTok = await gjoin('remote@test.com', 'Remote Rita');
  const far = { lat: 40.7128, lng: -74.0060 }; // NYC — definitely far from LA
  const ciFar = await call('/api/checkin', { lat: far.lat, lng: far.lng, accuracy: 20 }, 'POST', { 'X-Player-Token': farTok });
  ok('far -> online pool (optional mode)', ciFar.d.pool === 'online' && ciFar.d.checked_in, JSON.stringify(ciFar.d));
  const farVote = await call('/api/vote', { taste: 3, predict: 4 }, 'POST', { 'X-Player-Token': farTok });
  ok('online player can still vote (optional)', farVote.d.locked === true, JSON.stringify(farVote.d));

  console.log('\n— geo: REQUIRED mode rejects out-of-radius —');
  await call('/api/admin/session/config', { sessionId: GSID, geoMode: 'required' }, 'POST', GAH);
  const strictTok = await gjoin('strict@test.com', 'Strict Sam');
  const ciReject = await call('/api/checkin', { lat: far.lat, lng: far.lng, accuracy: 20 }, 'POST', { 'X-Player-Token': strictTok });
  ok('required + far -> not checked in', ciReject.d.checked_in === false && ciReject.d.pool === null, JSON.stringify(ciReject.d));
  const ciDecline = await call('/api/checkin', { declined: true }, 'POST', { 'X-Player-Token': strictTok });
  ok('required + declined -> 422', ciDecline.status === 422, JSON.stringify([ciDecline.status, ciDecline.d]));

  console.log('\n— geo: pools tally + privacy (no raw coords stored) —');
  gs = (await call(`/api/admin/state?sessionId=${GSID}`, null, 'GET', GAH)).d;
  ok('admin pool counts present', gs.pools && gs.pools.in_person >= 1 && gs.pools.online >= 1, JSON.stringify(gs.pools));
  const gexp = await fetch(base + `/api/admin/export?sessionId=${GSID}&format=json`, { headers: GAH }).then(r => r.json());
  const inRow = gexp.participants.find(p => p.email === 'inroom@test.com');
  ok('export carries pool', inRow && inRow.pool === 'in_person', JSON.stringify(inRow && inRow.pool));
  ok('export carries coarse distance only', inRow && typeof inRow.checkin_distance === 'number', JSON.stringify(inRow && inRow.checkin_distance));
  // privacy: raw coordinates never persisted anywhere
  const gexpStr = JSON.stringify(gexp);
  ok('no raw player coords in export', !gexpStr.includes('40.7128') && !gexpStr.includes('34.0432'), 'coords leaked');

  // ======================================================================
  // REGRESSION: per-session tokens — a token must resolve to ITS OWN session
  // (the "Session A link showed Session B" bug). Same email in two sessions
  // must produce two distinct participants/tokens, each scoped to its session.
  // ======================================================================
  console.log('\n— regression: same email across two sessions = two scoped tokens —');
  const sA = await call('/api/session', { name: 'Session Alpha' });
  const sB = await call('/api/session', { name: 'Session Bravo' });
  const SA = sA.d.sessionId, SB = sB.d.sessionId;
  const EMAIL = 'dualjoin@test.com';
  // Join A.
  const rA = await call('/api/join/request', { sessionId: SA, email: EMAIL });
  const vA = await call('/api/join/verify', { sessionId: SA, email: EMAIL, code: rA.d.devCode, name: 'Dual Joiner' });
  // Join B with the SAME email.
  const rB = await call('/api/join/request', { sessionId: SB, email: EMAIL });
  const vB = await call('/api/join/verify', { sessionId: SB, email: EMAIL, code: rB.d.devCode, name: 'Dual Joiner' });
  ok('two sessions yield different tokens', vA.d.token !== vB.d.token, 'tokens matched!');
  // Token A resolves to Session Alpha; token B to Session Bravo.
  const stateA = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': vA.d.token })).d;
  const stateB = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': vB.d.token })).d;
  ok('token A -> Session Alpha', stateA.session.name === 'Session Alpha', stateA.session.name);
  ok('token B -> Session Bravo', stateB.session.name === 'Session Bravo', stateB.session.name);
  ok('tokens do not cross sessions', stateA.session.id === SA && stateB.session.id === SB, JSON.stringify([stateA.session.id, stateB.session.id]));

  // ======================================================================
  // SESSION MANAGEMENT — edit name, default ad at creation, soft-delete
  // ======================================================================
  console.log('\n— session mgmt: edit name + config after creation —');
  const smA = ADMINH; // admin auth header from earlier in the suite
  const sm = await call('/api/session', { name: 'Original Name', lobbyMessage: 'hi' });
  const SMID = sm.d.sessionId, SMAH = { 'X-Admin-Token': sm.d.adminToken };
  await call('/api/admin/session/config', { sessionId: SMID, name: 'Renamed Event', lobbyMessage: 'updated' }, 'POST', SMAH);
  let sms = (await call(`/api/admin/state?sessionId=${SMID}`, null, 'GET', SMAH)).d;
  ok('session name edited', sms.session.name === 'Renamed Event', sms.session.name);
  ok('lobby message edited', sms.session.lobby_message === 'updated', sms.session.lobby_message);
  const emptyName = await call('/api/admin/session/config', { sessionId: SMID, name: '   ' }, 'POST', SMAH);
  ok('empty name rejected', emptyName.status === 400, 'got ' + emptyName.status);

  console.log('\n— session mgmt: default ad + venue settable at creation —');
  const smCreate = await call('/api/session', { name: 'Preconfigured', geoLat: 34.04, geoLng: -118.26, geoRadius: 150, geoLabel: 'Venue X' });
  const PCID = smCreate.d.sessionId, PCAH = { 'X-Admin-Token': smCreate.d.adminToken };
  const pcs = (await call(`/api/admin/state?sessionId=${PCID}`, null, 'GET', PCAH)).d;
  ok('venue set at creation', pcs.session.geo_lat === 34.04 && pcs.session.geo_label === 'Venue X', JSON.stringify([pcs.session.geo_lat, pcs.session.geo_label]));
  ok('venue creation leaves enforcement off', pcs.session.geo_mode === 'off', pcs.session.geo_mode);

  console.log('\n— session mgmt: soft-delete (admin only) hides from list, blocks joins —');
  // Non-admin host can't delete.
  const hostDel = await call('/api/admin/session/delete', { sessionId: SMID }, 'POST', { 'X-Auth-Token': HOSTTOK });
  ok('non-admin cannot delete', hostDel.status === 403, 'got ' + hostDel.status);
  // Admin deletes.
  const del = await call('/api/admin/session/delete', { sessionId: SMID }, 'POST', ADMINH);
  ok('admin delete ok', del.status === 200 && del.d.deleted, JSON.stringify(del.d));
  // Hidden from the admin's session list.
  const listAfter = (await call('/api/auth/sessions', null, 'GET', ADMINH)).d;
  ok('deleted session hidden from list', !listAfter.sessions.some(s => s.id === SMID), 'still listed');
  // Player can't join a deleted session.
  const joinDel = await call('/api/join/request', { sessionId: SMID, email: 'late@test.com' });
  ok('join blocked on deleted session', joinDel.status === 404, 'got ' + joinDel.status);
  // Restore brings it back.
  const restore = await call('/api/admin/session/delete', { sessionId: SMID, restore: true }, 'POST', ADMINH);
  ok('admin restore ok', restore.status === 200 && restore.d.restored, JSON.stringify(restore.d));
  const listRestored = (await call('/api/auth/sessions', null, 'GET', ADMINH)).d;
  ok('restored session back in list', listRestored.sessions.some(s => s.id === SMID), 'not listed');

  console.log('\n— beta feedback: logs to DB, validates, never blocks —');
  const fbSess = await call('/api/session', { name: 'Feedback Night' });
  const FBSID = fbSess.d.sessionId;
  const fb1 = await call('/api/feedback', { message: 'Lock button was confusing', sessionId: FBSID, contactEmail: 'fan@x.com' });
  ok('text feedback accepted', fb1.status === 200 && fb1.d.ok, JSON.stringify([fb1.status, fb1.d]));
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const fb2 = await call('/api/feedback', { message: 'with shot', sessionId: FBSID, image: tinyPng });
  ok('feedback with screenshot accepted', fb2.status === 200 && fb2.d.ok, JSON.stringify([fb2.status, fb2.d]));
  const fbEmpty = await call('/api/feedback', { message: '   ' });
  ok('empty message rejected', fbEmpty.status === 400, 'got ' + fbEmpty.status);
  const fbBadImg = await call('/api/feedback', { message: 'x', image: 'data:text/plain;base64,aGk=' });
  ok('non-image attachment rejected', fbBadImg.status === 400, 'got ' + fbBadImg.status);

  console.log('\n— session mgmt: cascade purge (admin, type-name) leaves no orphans —');
  const db = require('./db');
  // A session with a full dependent tree: participant (+otp from join), a ratified round
  // with a vote, a session banner, feedback, and a series tag — all purge must handle.
  const pgSess = await call('/api/session', { name: 'Purge Me' }, 'POST', ADMINH);
  const PGID = pgSess.d.sessionId, PGAH = { 'X-Admin-Token': pgSess.d.adminToken };
  const pjr = await call('/api/join/request', { sessionId: PGID, email: 'purge@test.com' }); // seeds an otp too
  const pjv = await call('/api/join/verify', { sessionId: PGID, email: 'purge@test.com', code: pjr.d.devCode, name: 'Purgy' });
  const pgt = pjv.d.token;
  const pgr = await call('/api/admin/round', { sessionId: PGID, song_title: 'Doomed Track' }, 'POST', PGAH);
  await call('/api/admin/round/open', { sessionId: PGID, roundId: pgr.d.roundId, minutes: 1 }, 'POST', PGAH);
  await call('/api/vote', { taste: 7, predict: 7 }, 'POST', { 'X-Player-Token': pgt });
  await call('/api/admin/round/ratify', { sessionId: PGID, roundId: pgr.d.roundId }, 'POST', PGAH);
  const FBMSG = 'PURGE-KEEP-REF-9271';
  await call('/api/feedback', { message: FBMSG, sessionId: PGID });
  await db.run('INSERT INTO banners (id, session_id, label, image_data, created_at) VALUES (?,?,?,?,?)',
    ['pgbanner1', PGID, 'Purge Banner', 'data:image/png;base64,AA==', Date.now()]);
  // Tag into a series and confirm the session contributes to that board.
  const pgSer = await call('/api/admin/series/create', { title: 'Purge Series', qualifyCount: 10 }, 'POST', ADMINH);
  const PGSER = pgSer.d.seriesId;
  await call('/api/admin/series/tag', { sessionId: PGID, seriesId: PGSER }, 'POST', ADMINH);
  const lbBefore = (await call(`/api/admin/series/leaderboard?seriesId=${PGSER}`, null, 'GET', ADMINH)).d;
  ok('series board counts the session before purge', (lbBefore.leaderboard || []).length >= 1 && lbBefore.leaderboard[0].points > 0, JSON.stringify(lbBefore.leaderboard));
  // Non-admin cannot purge.
  const pgHost = await call('/api/admin/session/purge', { sessionId: PGID, confirmName: 'Purge Me' }, 'POST', { 'X-Auth-Token': HOSTTOK });
  ok('non-admin cannot purge', pgHost.status === 403, 'got ' + pgHost.status);
  // Wrong name is rejected (type-name gate) and leaves the session fully intact.
  const pgWrong = await call('/api/admin/session/purge', { sessionId: PGID, confirmName: 'purge me' }, 'POST', ADMINH);
  ok('purge rejects wrong confirm name', pgWrong.status === 400, 'got ' + pgWrong.status);
  const stillThere = await call(`/api/admin/session/get?id=${PGID}`, null, 'GET', ADMINH);
  ok('session survives a failed purge', stillThere.status === 200, 'got ' + stillThere.status);
  // Exact name purges.
  const pgOk = await call('/api/admin/session/purge', { sessionId: PGID, confirmName: 'Purge Me' }, 'POST', ADMINH);
  ok('purge with exact name ok', pgOk.status === 200 && pgOk.d.purged, JSON.stringify(pgOk.d));
  // Orphan audit: session gone, every child row gone, feedback kept but de-referenced.
  const gone = await call(`/api/admin/session/get?id=${PGID}`, null, 'GET', ADMINH);
  ok('purged session is gone', gone.status === 404, 'got ' + gone.status);
  const cnt = async (sql) => Number((await db.get(sql, [PGID])).c);
  ok('no orphan rounds', (await cnt('SELECT COUNT(*) c FROM rounds WHERE session_id = ?')) === 0);
  ok('no orphan votes', (await cnt('SELECT COUNT(*) c FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE session_id = ?)')) === 0);
  ok('no orphan participants', (await cnt('SELECT COUNT(*) c FROM participants WHERE session_id = ?')) === 0);
  ok('no orphan otps', (await cnt('SELECT COUNT(*) c FROM otps WHERE session_id = ?')) === 0);
  ok('no orphan banners', (await cnt('SELECT COUNT(*) c FROM banners WHERE session_id = ?')) === 0);
  const fbRow = await db.get('SELECT session_id FROM feedback WHERE message = ?', [FBMSG]);
  ok('feedback kept, session ref nulled', !!fbRow && fbRow.session_id == null, JSON.stringify(fbRow));
  // Series board recomputes live: the purged session no longer contributes.
  const lbAfter = (await call(`/api/admin/series/leaderboard?seriesId=${PGSER}`, null, 'GET', ADMINH)).d;
  ok('series board drops purged session', (lbAfter.leaderboard || []).length === 0, JSON.stringify(lbAfter.leaderboard));

  console.log('\n— notify on go-live: SMS + email fan-out, consent-gated + idempotent —');
  // Upcoming session, two registrants: one with phone+consent (SMS+email), one email-only.
  const noSess = await call('/api/session', { name: 'Notify Night', status: 'upcoming' }, 'POST', ADMINH);
  const NOID = noSess.d.sessionId;
  const nrq1 = await call('/api/join/request', { sessionId: NOID, email: 'smsy@test.com' });
  await call('/api/join/verify', { sessionId: NOID, email: 'smsy@test.com', code: nrq1.d.devCode, name: 'Smsy', phone: '(555) 111-2222' });
  const nrq2 = await call('/api/join/request', { sessionId: NOID, email: 'maily@test.com' });
  await call('/api/join/verify', { sessionId: NOID, email: 'maily@test.com', code: nrq2.d.devCode, name: 'Maily' });
  const before = Number((await db.get('SELECT COUNT(*) c FROM notification_log WHERE session_id = ?', [NOID])).c);
  ok('nothing sent before go-live', before === 0, 'got ' + before);
  // Flip to live -> dispatch fires.
  const golive = await call('/api/admin/session/status', { sessionId: NOID, status: 'live' }, 'POST', ADMINH);
  ok('go-live ok', golive.status === 200, JSON.stringify(golive.d));
  const rows = await db.all('SELECT channel, status FROM notification_log WHERE session_id = ?', [NOID]);
  const emails = rows.filter(r => r.channel === 'email'), smses = rows.filter(r => r.channel === 'sms');
  ok('emailed both registrants', emails.length === 2 && emails.every(r => r.status === 'sent'), JSON.stringify(rows));
  ok('SMS only to the consenting number', smses.length === 1 && smses[0].status === 'sent', JSON.stringify(smses));
  // Idempotent: reopen (live -> upcoming -> live) must not re-notify.
  await call('/api/admin/session/status', { sessionId: NOID, status: 'upcoming' }, 'POST', ADMINH);
  await call('/api/admin/session/status', { sessionId: NOID, status: 'live' }, 'POST', ADMINH);
  const after = Number((await db.get('SELECT COUNT(*) c FROM notification_log WHERE session_id = ?', [NOID])).c);
  ok('reopen does not re-notify', after === rows.length, `before ${rows.length} after ${after}`);
  // A session created directly as live doesn't spam (no upcoming->live transition, no registrants).
  const liveDirect = await call('/api/session', { name: 'Born Live', status: 'live' }, 'POST', ADMINH);
  const bornRows = Number((await db.get('SELECT COUNT(*) c FROM notification_log WHERE session_id = ?', [liveDirect.d.sessionId])).c);
  ok('born-live session sends nothing', bornRows === 0, 'got ' + bornRows);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
