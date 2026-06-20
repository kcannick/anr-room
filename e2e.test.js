'use strict';
// Boots the server in-process and exercises the whole flow over HTTP.
process.env.EMAIL_PROVIDER = 'console';
process.env.SQLITE_PATH = './test.db';
process.env.PORT = '3999';
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
  // Zed rates 1, predicts 10 -> with a solo vote the room avg = 1, err = 9 -> negative round
  await call('/api/vote', { taste: 1, predict: 10 }, 'POST', { 'X-Player-Token': tn });
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

  console.log('\n— end session: shareable recap revealed —');
  await call('/api/admin/session/end', { sessionId: SID }, 'POST', AH);
  const ms = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t1 })).d;
  ok('player sees ended', ms.session.status === 'ended');
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

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
