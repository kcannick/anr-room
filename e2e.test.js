'use strict';
// Boots the server in-process and exercises the whole flow over HTTP.
process.env.EMAIL_PROVIDER = 'console';
process.env.SQLITE_PATH = './test.db';
process.env.PORT = '3999';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ABLY_API_KEY = '';   // realtime off in tests (the .env loader must not pull a real key)
process.env.INGEST_TOKEN = 'test-ingest-secret';
// A SEPARATE secret, deliberately: /ingest/submission stages one ignorable row, while
// /ingest/daily creates a live room carrying every artist's contact details. The daily
// route does NOT fall back to INGEST_TOKEN — see the note on its token check.
process.env.DAILY_INGEST_TOKEN = 'test-daily-secret';
process.env.ANALYTICS_TOKEN = 'test-analytics-secret';
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

// Rounds open into 'listening' now (staged rounds, 030): the record goes up on the overlay
// and the room hears it, then the host starts the clock. Most tests just want a round taking
// votes, so this walks whatever is on deck into voting. Idempotent by design — a no-op when
// nothing is listening — so it's safe to call after any add.
async function startVoting(sessionId, headers, minutes = 5) {
  const st = (await call(`/api/admin/state?sessionId=${sessionId}`, null, 'GET', headers)).d;
  const r = st && st.activeRound;
  if (r && r.status === 'listening') {
    await call('/api/admin/round/start-voting', { sessionId, roundId: r.id, minutes }, 'POST', headers);
  }
}

(async () => {
  const server = require('./server');
  // server.js only auto-listens when run directly; when required (here, and on
  // Vercel) we drive init + listen ourselves.
  await server.ensureInit();
  await new Promise((res) => server.listen(3999, res));

  // Session creation is invite-only (host|admin). Establish the platform admin up front
  // (admin@test.com = ADMIN_EMAIL) and route all test session-creation through it. BOOTH
  // being the first account also keeps host@test.com a non-admin later.
  const bootReq = await call('/api/auth/request', { email: 'admin@test.com' });
  const bootVer = await call('/api/auth/verify', { email: 'admin@test.com', code: bootReq.d.devCode });
  const BOOTH = { 'X-Auth-Token': bootVer.d.token };

  console.log('\n— create session —');
  const cs = await call('/api/session', { name: 'Test Night' }, 'POST', BOOTH);
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
  await startVoting(SID, AH);
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

  console.log('\n— optional round comments: write window, sealing, moderation —');
  // RID is already RATIFIED here, which is the point: the write window deliberately
  // survives the reveal. Ratify swaps the player's screen out from under the composer,
  // and a comment that can't be saved after that is a comment someone typed and lost.
  const CMT_A = 'Voice is a star, but the beat is fighting her the whole way.';
  const c1 = await call('/api/comment', { roundId: RID, body: CMT_A }, 'POST', { 'X-Player-Token': t1 });
  ok('comment saves AFTER ratify (window does not slam at the reveal)', c1.status === 200 && c1.d.body === CMT_A, JSON.stringify(c1.d));
  const c2 = await call('/api/comment', { roundId: RID, body: 'Intro is eight bars too long.' }, 'POST', { 'X-Player-Token': t2 });
  ok('a second A&R can comment on the same round', c2.status === 200, JSON.stringify(c2.d));

  // Authorship + sealing.
  const cs1 = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t1 })).d;
  ok('author sees their own comment in state', cs1.myComment === CMT_A, JSON.stringify(cs1.myComment));
  const csIris = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t3 })).d;
  ok('a non-commenter sees no comment of their own', !csIris.myComment, JSON.stringify(csIris.myComment));
  ok('SEALED: another player never receives someone else\'s comment text',
    !JSON.stringify(csIris).includes('Voice is a star'), 'leaked into player state');
  const cOverlay = await call(`/api/overlay/state?sessionId=${SID}`, null, 'GET');
  ok('SEALED: no comment text on the broadcast overlay', !JSON.stringify(cOverlay.d).includes('Voice is a star'));

  // Guards. Commenting requires a lock-in on that round — Nyla joins but never votes.
  const cnReq = await call('/api/join/request', { sessionId: SID, email: 'nyla@test.com' });
  const cnVer = await call('/api/join/verify', { sessionId: SID, email: 'nyla@test.com', code: cnReq.d.devCode, name: 'Nyla' });
  const cNoVote = await call('/api/comment', { roundId: RID, body: 'never voted' }, 'POST', { 'X-Player-Token': cnVer.d.token });
  ok('comment without a lock-in on that round rejected', cNoVote.status === 400, 'got ' + cNoVote.status);
  const cNoRound = await call('/api/comment', { body: 'orphan' }, 'POST', { 'X-Player-Token': t1 });
  ok('comment without a round rejected', cNoRound.status === 400, 'got ' + cNoRound.status);
  const cBadRound = await call('/api/comment', { roundId: 'not-a-round', body: 'x' }, 'POST', { 'X-Player-Token': t1 });
  ok('comment on an unknown round rejected', cBadRound.status === 404, 'got ' + cBadRound.status);
  const cNoAuth = await call('/api/comment', { roundId: RID, body: 'x' }, 'POST');
  ok('comment without auth rejected', cNoAuth.status === 401, 'got ' + cNoAuth.status);
  const cLong = await call('/api/comment', { roundId: RID, body: 'z'.repeat(700) }, 'POST', { 'X-Player-Token': t3 });
  ok('over-length comment truncated to 500, not rejected', cLong.status === 200 && cLong.d.body.length === 500, 'len ' + (cLong.d.body || '').length);
  // 500 is the raised cap (was 280). A 400-char comment is now WITHIN it, which is the
  // point of the change — assert that rather than only asserting the ceiling.
  const cMid = await call('/api/comment', { roundId: RID, body: 'y'.repeat(400) }, 'POST', { 'X-Player-Token': t3 });
  ok('a 400-char comment is kept whole under the raised cap', cMid.status === 200 && cMid.d.body.length === 400, 'len ' + (cMid.d.body || '').length);

  // Host moderation is REJECT-BY-EXCEPTION (029): comments ship by default and the host
  // pulls the bad ones. There is no 'pending' — a status that gates sends but nothing
  // produces would read as "held for review" while actually meaning "unreachable".
  let cAdm = (await call(`/api/admin/comments?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('host sees all three comments', (cAdm.comments || []).length === 3, 'got ' + (cAdm.comments || []).length);
  ok('comments default to SHARED (host rejects, not approves)', cAdm.comments.every(c => c.status === 'shared'), JSON.stringify(cAdm.comments.map(c => c.status)));
  ok('host queue carries the A&R name + their rating', cAdm.comments.every(c => c.name && c.taste != null), JSON.stringify(cAdm.comments[0]));
  ok('host queue carries no commenter PII', !JSON.stringify(cAdm.comments).includes('@test.com'));
  const cmtId1 = cAdm.comments.find(c => c.body === CMT_A).id;
  const cNoAdmin = await call('/api/admin/comments?sessionId=' + SID, null, 'GET');
  ok('comment queue is admin-gated', cNoAdmin.status === 401, 'got ' + cNoAdmin.status);

  const cHide = await call('/api/admin/comment', { sessionId: SID, commentId: cmtId1, status: 'hidden' }, 'POST', AH);
  ok('host can reject one comment', cHide.status === 200 && cHide.d.changed === 1, JSON.stringify(cHide.d));
  const cBadStatus = await call('/api/admin/comment', { sessionId: SID, commentId: cmtId1, status: 'published' }, 'POST', AH);
  ok('unknown moderation status rejected', cBadStatus.status === 400, 'got ' + cBadStatus.status);
  const cRetired = await call('/api/admin/comment', { sessionId: SID, commentId: cmtId1, status: 'pending' }, 'POST', AH);
  ok("retired 'pending' status no longer accepted", cRetired.status === 400, 'got ' + cRetired.status);

  // 'hidden' is STICKY across an edit — otherwise editing would be a one-click way for an
  // A&R to undo the host's rejection.
  const cEdit = await call('/api/comment', { roundId: RID, body: 'Actually, on a relisten — the mix is fine.' }, 'POST', { 'X-Player-Token': t1 });
  ok('author can edit their comment', cEdit.status === 200, JSON.stringify(cEdit.d));
  cAdm = (await call(`/api/admin/comments?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('editing a REJECTED comment leaves it rejected (no undo-by-edit)',
    cAdm.comments.find(c => c.id === cmtId1).status === 'hidden', JSON.stringify(cAdm.comments.find(c => c.id === cmtId1)));
  // An edit to a normal (shared) comment stays shared — it does not need re-approving.
  const cEdit2 = await call('/api/comment', { roundId: RID, body: 'Intro runs long, but the hook saves it.' }, 'POST', { 'X-Player-Token': t2 });
  cAdm = (await call(`/api/admin/comments?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('editing a SHARED comment keeps it shared', cEdit2.status === 200
    && cAdm.comments.find(c => c.body.startsWith('Intro runs long')).status === 'shared', JSON.stringify(cAdm.comments.map(c => c.status)));

  // Bulk actions + counts on the rounds list.
  const cBulk = await call('/api/admin/comment', { sessionId: SID, roundId: RID, status: 'hidden' }, 'POST', AH);
  ok('host can reject a whole round at once', cBulk.status === 200 && cBulk.d.changed === 3, JSON.stringify(cBulk.d));
  let cRounds = (await call(`/api/admin/rounds?sessionId=${SID}`, null, 'GET', AH)).d;
  let cRow = cRounds.rounds.find(r => r.id === RID);
  ok('rounds list reports rejected counts', cRow.comments === 3 && cRow.comments_shared === 0 && cRow.comments_hidden === 3, JSON.stringify(cRow));
  await call('/api/admin/comment', { sessionId: SID, roundId: RID, status: 'shared' }, 'POST', AH);
  cRounds = (await call(`/api/admin/rounds?sessionId=${SID}`, null, 'GET', AH)).d;
  cRow = cRounds.rounds.find(r => r.id === RID);
  ok('host can restore a whole round', cRow.comments_shared === 3 && cRow.comments_hidden === 0, JSON.stringify(cRow));

  // Clearing the box deletes the row outright — a blank card would sit in the queue forever.
  const cClear = await call('/api/comment', { roundId: RID, body: '   ' }, 'POST', { 'X-Player-Token': t3 });
  ok('clearing a comment deletes it', cClear.status === 200 && cClear.d.body === '', JSON.stringify(cClear.d));
  cAdm = (await call(`/api/admin/comments?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('deleted comment leaves the host queue', cAdm.comments.length === 2, 'got ' + cAdm.comments.length);

  console.log('\n— add-song: straight to open; extras queue; none lost —');
  // Prior round is ratified, so nothing is in play — the first add opens immediately.
  const qa = await call('/api/admin/round', { sessionId: SID, song_title: 'Auto Open A' }, 'POST', AH);
  await startVoting(SID, AH);
  ok('first add opens immediately (no round in play)', qa.d.opened === true, JSON.stringify(qa.d));
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('auto-opened Song A, numbered 2', st.activeRound && st.activeRound.song_title === 'Auto Open A' && st.activeRound.idx === 2, JSON.stringify(st.activeRound));
  // While A is live, further adds go to the queue (both persist — the old bug).
  const qb = await call('/api/admin/round', { sessionId: SID, song_title: 'Queue Song B' }, 'POST', AH);
  await startVoting(SID, AH);
  const qc0 = await call('/api/admin/round', { sessionId: SID, song_title: 'Queue Song C' }, 'POST', AH);
  await startVoting(SID, AH);
  ok('adds during a live round go to the queue', qb.d.opened === false && qc0.d.opened === false, JSON.stringify([qb.d, qc0.d]));
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('both queued songs present (none lost)', st.queue.length === 2 && st.queue[0].song_title === 'Queue Song B' && st.queue[1].song_title === 'Queue Song C', 'queue len ' + st.queue.length);
  ok('queued songs have no round number yet', st.queue.every(r => !r.idx), JSON.stringify(st.queue.map(r=>r.idx)));

  console.log('\n— reorder queue, then delete one —');
  await call('/api/admin/round/move', { sessionId: SID, roundId: qc0.d.roundId, dir: 'up' }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('after move up: C then B', st.queue[0].song_title === 'Queue Song C' && st.queue[1].song_title === 'Queue Song B');
  await call('/api/admin/round/delete', { sessionId: SID, roundId: qc0.d.roundId }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('after delete: 1 left (B)', st.queue.length === 1 && st.queue[0].song_title === 'Queue Song B');

  console.log('\n— ratify the live round, then open queued B as round 3 —');
  await call('/api/vote', { taste: 9, predict: 9 }, 'POST', { 'X-Player-Token': t3 }); // Iris votes on the live A
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qa.d.roundId }, 'POST', AH);
  const RID2 = qb.d.roundId;
  const op2 = await call('/api/admin/round/open', { sessionId: SID, roundId: RID2, minutes: 1 }, 'POST', AH);
  ok('open queued round ok', op2.status === 200, JSON.stringify(op2.d));
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('opened queued B numbered 3', st.activeRound.idx === 3, 'idx ' + st.activeRound.idx);
  ok('queue now empty', st.queue.length === 0);
  await call('/api/vote', { taste: 9, predict: 9 }, 'POST', { 'X-Player-Token': t3 }); // Iris solo -> 125
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: RID2 }, 'POST', AH);
  const m3b = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t3 })).d;
  ok('Iris solo round: rank 1, exact 125', m3b.myResult.rank === 1 && m3b.myResult.points === 125, JSON.stringify(m3b.myResult));
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  const iris = st.participants.find(p => p.name === 'Iris');
  ok('Iris cumulative total carries across rounds', iris.total_points > 125, 'total ' + iris.total_points);

  console.log('\n— guard: cannot open while a round is in play —');
  const qc = await call('/api/admin/round', { sessionId: SID, song_title: 'Mid-flight' }, 'POST', AH);
  await startVoting(SID, AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qc.d.roundId, minutes: 1 }, 'POST', AH);
  const qd = await call('/api/admin/round', { sessionId: SID, song_title: 'Should block' }, 'POST', AH);
  await startVoting(SID, AH);
  const blocked = await call('/api/admin/round/open', { sessionId: SID, roundId: qd.d.roundId, minutes: 1 }, 'POST', AH);
  ok('open blocked while another round is voting', blocked.status === 400, JSON.stringify(blocked.d));
  await call('/api/admin/round/close', { sessionId: SID, roundId: qc.d.roundId }, 'POST', AH);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qc.d.roundId }, 'POST', AH);

  console.log('\n— negative round stings, but lifetime total floors at 0 —');
  // New player with 0 total; one wildly-off guess should go negative on the round
  // but their cumulative total must not drop below 0.
  const tn = await join('z@test.com', 'Zed');
  const qz = await call('/api/admin/round', { sessionId: SID, song_title: 'Penalty Test' }, 'POST', AH);
  await startVoting(SID, AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qz.d.roundId, minutes: 1 }, 'POST', AH);
  // Zed rates 0, predicts 9 -> with a solo vote the room avg = 0, err = 9 -> negative round
  await call('/api/vote', { taste: 0, predict: 9 }, 'POST', { 'X-Player-Token': tn });
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qz.d.roundId }, 'POST', AH);
  const zed = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': tn })).d;
  ok('Zed round score is negative', zed.myResult.points < 0, 'pts ' + zed.myResult.points);
  ok('Zed tier = wayoff', zed.myResult.tier === 'wayoff', 'tier ' + zed.myResult.tier);
  ok('Zed lifetime total floored at 0', zed.myTotalPoints === 0, 'total ' + zed.myTotalPoints);

  console.log('\n— edit a queued song, and reopen an accidentally-closed round —');
  // Put a round in play first so the next add queues (instead of auto-opening).
  const qFill = await call('/api/admin/round', { sessionId: SID, song_title: 'Filler (live)' }, 'POST', AH);
  await startVoting(SID, AH);
  const qe = await call('/api/admin/round', { sessionId: SID, song_title: 'Wrong Title', song_artist: 'Wrong Artist' }, 'POST', AH);
  await startVoting(SID, AH);
  ok('added while a round is live -> queued', qe.d.opened === false, JSON.stringify(qe.d));
  const ed = await call('/api/admin/round/edit', { sessionId: SID, roundId: qe.d.roundId, song_title: 'Right Title', song_artist: 'Right Artist', giveaway: 'Hat' }, 'POST', AH);
  ok('edit queued song ok', ed.status === 200);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  const editedInQueue = st.queue.find(r => r.id === qe.d.roundId);
  ok('queued song now shows edited title + artist', editedInQueue && editedInQueue.song_title === 'Right Title' && editedInQueue.song_artist === 'Right Artist');
  // clear the live filler, then open the edited song
  await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': t1 });
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qFill.d.roundId }, 'POST', AH);
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
  // Editing a ratified round is ALLOWED — but only its descriptive fields. This backs the
  // post-show artist workflow (fix a typo / add contact after the show); the score, votes
  // and points are never writable here. Full coverage in the artist-notices block below.
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qe.d.roundId }, 'POST', AH);
  const ratifiedAvg = (await call(`/api/admin/rounds?sessionId=${SID}`, null, 'GET', AH)).d.rounds.find(r => r.id === qe.d.roundId).room_average;
  const editLate = await call('/api/admin/round/edit', { sessionId: SID, roundId: qe.d.roundId, song_title: 'Renamed After Ratify' }, 'POST', AH);
  ok('a ratified round accepts a descriptive edit', editLate.status === 200, JSON.stringify(editLate.d));
  const editedRow = (await call(`/api/admin/rounds?sessionId=${SID}`, null, 'GET', AH)).d.rounds.find(r => r.id === qe.d.roundId);
  ok('the ratified edit applied', editedRow.song_title === 'Renamed After Ratify', editedRow.song_title);
  ok('the ratified edit left the score alone', editedRow.room_average === ratifiedAvg, `${ratifiedAvg} -> ${editedRow.room_average}`);
  // can't reopen a ratified round
  const reoLate = await call('/api/admin/round/reopen', { sessionId: SID, roundId: qe.d.roundId, minutes: 1 }, 'POST', AH);
  ok('reopen blocked after ratify', reoLate.status === 400);

  console.log('\n— minutes-based voting window + 2–60 clamp —');
  const qm = await call('/api/admin/round', { sessionId: SID, song_title: 'Two Minute Song' }, 'POST', AH);
  await startVoting(SID, AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qm.d.roundId, minutes: 2 }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  let windowMs = Number(st.activeRound.closes_at) - st.serverNow;
  ok('2-minute window ≈ 120s', Math.abs(windowMs - 120000) < 5000, 'ms ' + windowMs);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qm.d.roundId }, 'POST', AH);

  // below-minimum clamps up to 2
  const qLow = await call('/api/admin/round', { sessionId: SID, song_title: 'Too Short' }, 'POST', AH);
  await startVoting(SID, AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qLow.d.roundId, minutes: 0.5 }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  windowMs = Number(st.activeRound.closes_at) - st.serverNow;
  ok('0.5 min clamps up to 2 min', Math.abs(windowMs - 120000) < 5000, 'ms ' + windowMs);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qLow.d.roundId }, 'POST', AH);

  // above-maximum clamps down to 60
  const qHigh = await call('/api/admin/round', { sessionId: SID, song_title: 'Too Long' }, 'POST', AH);
  await startVoting(SID, AH);
  await call('/api/admin/round/open', { sessionId: SID, roundId: qHigh.d.roundId, minutes: 999 }, 'POST', AH);
  st = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  windowMs = Number(st.activeRound.closes_at) - st.serverNow;
  ok('999 min clamps down to 60 min', Math.abs(windowMs - 3600000) < 5000, 'ms ' + windowMs);
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: qHigh.d.roundId }, 'POST', AH);

  console.log('\n— per-session default voting window —');
  // default exposed in admin state (this session was created without one → defaults to 5)
  ok('session default_minutes present', st.session.default_minutes === 5, 'got ' + st.session.default_minutes);
  // a session created with a custom default stores it (clamped)
  const cs2 = await call('/api/session', { name: 'Custom Default', defaultMinutes: 10 }, 'POST', BOOTH);
  const st2 = (await call(`/api/admin/state?sessionId=${cs2.d.sessionId}`, null, 'GET', { 'X-Admin-Token': cs2.d.adminToken })).d;
  ok('custom default stored (10)', st2.session.default_minutes === 10, 'got ' + st2.session.default_minutes);
  const cs3 = await call('/api/session', { name: 'Clamped Default', defaultMinutes: 200 }, 'POST', BOOTH);
  const st3 = (await call(`/api/admin/state?sessionId=${cs3.d.sessionId}`, null, 'GET', { 'X-Admin-Token': cs3.d.adminToken })).d;
  ok('out-of-range default clamps to 60', st3.session.default_minutes === 60, 'got ' + st3.session.default_minutes);

  console.log('\n— ad banner cascade: global → session (song level removed) —');
  // 1x1 transparent PNG data URI (tiny valid image)
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQGk4+nAAAAAAElFTkSuQmCC';
  const upG = await call('/api/admin/banner/upload', { sessionId: SID, scope: 'global', image_data: PNG, label: 'Global', link_url: 'https://makinitmag.com' }, 'POST', AH);
  ok('global banner uploaded', upG.status === 200 && upG.d.bannerId, JSON.stringify(upG.d));
  await call('/api/admin/banner/assign', { sessionId: SID, target: 'global', bannerId: upG.d.bannerId }, 'POST', AH);
  const upS = await call('/api/admin/banner/upload', { sessionId: SID, scope: 'session', image_data: PNG, label: 'Session' }, 'POST', AH);

  // open a fresh round so players are in the voting phase
  const qbn = await call("/api/admin/round", { sessionId: SID, song_title: "Banner Song" }, 'POST', AH);
  const BRID = qbn.d.roundId;
  await call('/api/admin/round/open', { sessionId: SID, roundId: BRID, minutes: 2 }, 'POST', AH);

  // With only global assigned, a fresh player in lobby/voting should see the global banner.
  const jb = await join('banner@test.com', 'Bea');
  let bs = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': jb })).d;
  ok('player in voting sees a banner', bs.banner && bs.banner.id === upG.d.bannerId, JSON.stringify(bs.banner));

  // The banner is ALWAYS showing: the public pre-join info endpoint carries the same
  // cascade, so the slot is filled before a player even registers.
  const preJoin = (await call('/api/session/info?s=' + SID, null, 'GET')).d;
  ok('pre-join session info carries the banner', preJoin.banner && preJoin.banner.id === upG.d.bannerId, JSON.stringify(preJoin.banner));
  ok('banner image is a URL, not base64', bs.banner.image.startsWith('/api/banner/image'), bs.banner.image);
  ok('banner link passes through', bs.banner.link === 'https://makinitmag.com');

  // Assign session-level → now session wins over global.
  await call('/api/admin/banner/assign', { sessionId: SID, target: 'session', bannerId: upS.d.bannerId }, 'POST', AH);
  bs = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': jb })).d;
  ok('session banner overrides global', bs.banner.id === upS.d.bannerId, JSON.stringify(bs.banner));

  // The removed song-level target must be rejected, not silently accepted.
  const songAssign = await call('/api/admin/banner/assign', { sessionId: SID, target: 'song', bannerId: upS.d.bannerId, roundId: BRID }, 'POST', AH);
  ok('song-level banner target is rejected', songAssign.status === 400, 'status ' + songAssign.status);

  // The banner image actually serves.
  const imgRes = await fetch(base + '/api/banner/image?id=' + upS.d.bannerId);
  ok('banner image serves with image content-type', imgRes.ok && /^image\//.test(imgRes.headers.get('content-type') || ''), imgRes.status + ' ' + imgRes.headers.get('content-type'));

  // Vote + ratify → the banner keeps showing on results (ads run the full room, 2026-08-14).
  await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': jb });
  await call('/api/admin/round/ratify', { sessionId: SID, roundId: BRID }, 'POST', AH);
  bs = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': jb })).d;
  ok('results phase still carries the banner', bs.phase === 'results' && bs.banner && bs.banner.id === upS.d.bannerId, 'banner=' + JSON.stringify(bs.banner));

  // Delete session banner → falls back to global for the next active round.
  await call('/api/admin/banner/delete', { sessionId: SID, bannerId: upS.d.bannerId }, 'POST', AH);
  const adminAfter = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('deleted banner gone from library', !adminAfter.banners.find(b => b.id === upS.d.bannerId));
  ok('session banner_id cleared after delete', adminAfter.session.banner_id == null, 'still ' + adminAfter.session.banner_id);

  console.log('\n— durable user identity across sessions —');
  // Maya (a@test.com) already played this session. Create a SECOND session and
  // have the same email join → must resolve to the same uid, not a duplicate user.
  const s2 = await call('/api/session', { name: 'Second Night' }, 'POST', BOOTH);
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
  ok('anon JSON uses A&R N labels', anonJson.participants.every(p => /^A&R \d+$/.test(p.player)), JSON.stringify(anonJson.participants[0] || {}));
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
  // Upgrade to host so they can create sessions (invite-only). The existing token now
  // resolves to role=host — userFromAuth reads role live, so no re-login is needed.
  await call('/api/admin/users/role', { uid: authVer.d.uid, role: 'host' }, 'POST', BOOTH);

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
  // Invite-only: a plain player and an anonymous caller cannot create a session.
  const playerCreate = await call('/api/session', { name: 'Nope' }, 'POST', OTHERH);
  ok('a plain player cannot create a session', playerCreate.status === 403, 'got ' + playerCreate.status);
  const anonCreate = await call('/api/session', { name: 'Nope' });
  ok('an anonymous caller cannot create a session', anonCreate.status === 403, 'got ' + anonCreate.status);

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
  const FUT = Date.now() + 86400000;
  const upc = await call('/api/session', { name: 'Future Show', status: 'upcoming', scheduledAt: FUT }, 'POST', AUTHH);
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
  ok('go-live keeps a pre-set schedule', Number(us.d.session.scheduled_at) === FUT, String(us.d.session.scheduled_at));
  // Start-time stamping: an UNSCHEDULED room gets its start stamped at go-live…
  const unsched = await call('/api/session', { name: 'Pop-up Show', status: 'upcoming' }, 'POST', AUTHH);
  let uss = await call(`/api/admin/state?sessionId=${unsched.d.sessionId}`, null, 'GET', AUTHH);
  ok('unscheduled upcoming has no start time', uss.d.session.scheduled_at == null, String(uss.d.session.scheduled_at));
  const beforeLive = Date.now();
  await call('/api/admin/session/status', { sessionId: unsched.d.sessionId, status: 'live' }, 'POST', AUTHH);
  uss = await call(`/api/admin/state?sessionId=${unsched.d.sessionId}`, null, 'GET', AUTHH);
  ok('go-live stamps start time when unset', uss.d.session.scheduled_at >= beforeLive && uss.d.session.scheduled_at <= Date.now(), String(uss.d.session.scheduled_at));
  // …and a room born live starts NOW (stamped at creation).
  const bornLive = await call('/api/session', { name: 'Instant Show' }, 'POST', AUTHH);
  const bls = await call(`/api/admin/state?sessionId=${bornLive.d.sessionId}`, null, 'GET', AUTHH);
  ok('born-live room start time stamped at creation', bls.d.session.scheduled_at != null, String(bls.d.session.scheduled_at));
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

  // 028 narrowed this contract but did not weaken it: phone presence is still the consent
  // basis for anyone who has never set an explicit preference, which is every player here
  // (users.sms_pref_set_at IS NULL). The contact-center override is exercised separately,
  // in the "notification contact center" section at the end of this file.
  console.log('\n— SMS consent via phone presence (phone = opt-in BY DEFAULT, until the A&R sets a preference) —');
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
  const pfSessA = await call('/api/session', { name: 'Combo One' }, 'POST', BOOTH);
  const pfReqA = await call('/api/join/request', { sessionId: pfSessA.d.sessionId, email: pfEmail });
  ok('first visit not returning', pfReqA.d.returning === false, JSON.stringify(pfReqA.d.returning));
  await call('/api/join/verify', { sessionId: pfSessA.d.sessionId, email: pfEmail, code: pfReqA.d.devCode, name: 'Combo Kid', phone: '4045550101' });
  const pfSessB = await call('/api/session', { name: 'Combo Two' }, 'POST', BOOTH);
  const pfReqB = await call('/api/join/request', { sessionId: pfSessB.d.sessionId, email: pfEmail });
  ok('return visit flagged returning', pfReqB.d.returning === true, JSON.stringify(pfReqB.d.returning));
  ok('prefill name present', pfReqB.d.prefill && pfReqB.d.prefill.name === 'Combo Kid', JSON.stringify(pfReqB.d.prefill));
  ok('phone hint masked', pfReqB.d.prefill && pfReqB.d.prefill.phoneHint === '••• 0101', JSON.stringify(pfReqB.d.prefill && pfReqB.d.prefill.phoneHint));
  ok('full phone not leaked in request', !JSON.stringify(pfReqB.d).includes('4045550101') && !JSON.stringify(pfReqB.d).includes('5550101'));
  await call('/api/join/verify', { sessionId: pfSessB.d.sessionId, email: pfEmail, code: pfReqB.d.devCode, name: 'Combo Kid', phone: '', keepPhone: true });
  const pfSessC = await call('/api/session', { name: 'Combo Three' }, 'POST', BOOTH);
  const pfReqC = await call('/api/join/request', { sessionId: pfSessC.d.sessionId, email: pfEmail });
  ok('kept phone preserved (still on file)', pfReqC.d.prefill && pfReqC.d.prefill.phoneHint === '••• 0101', JSON.stringify(pfReqC.d.prefill && pfReqC.d.prefill.phoneHint));

  console.log('\n— end session: shareable recap revealed —');
  await call('/api/admin/session/end', { sessionId: SID }, 'POST', AH);
  const ms = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': t1 })).d;
  ok('player sees completed', ms.session.status === 'completed', ms.session.status);
  ok('phase is recap', ms.phase === 'recap', ms.phase);
  ok('recap has total points', typeof ms.recap.totalPoints === 'number');
  ok('recap has a letter grade', /^[A-DF][+-]?$/.test(ms.recap.grade || ''), 'grade ' + ms.recap.grade);
  ok('recap has unified accuracy %', typeof ms.recap.accuracy === 'number' && ms.recap.accuracy >= 0 && ms.recap.accuracy <= 100, 'acc ' + ms.recap.accuracy);
  ok('recap accuracyByType has rating leg', typeof ms.recap.accuracyByType.rating === 'number', JSON.stringify(ms.recap.accuracyByType));
  ok('rating-only recap has no versus card', Array.isArray(ms.recap.versusRounds) && ms.recap.versusRounds.length === 0, JSON.stringify(ms.recap.versusRounds));
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
  const bcs = await call('/api/session', { name: 'Verzuz Night', pollType: 'binary' }, 'POST', BOOTH);
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
  await startVoting(BSID, BAH);
  ok('binary round requires Song B', missB.status === 400, 'got ' + missB.status);
  const bar = await call('/api/admin/round', { sessionId: BSID, song_title: 'Jay-Z', song_artist: 'HOV', option_b_title: 'Nas', option_b_artist: 'Nasir', giveaway: 'Tickets' }, 'POST', BAH);
  await startVoting(BSID, BAH);
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

  // A Versus round has two songs, so "the record" is ambiguous — and the artist workflow
  // skips binary rounds anyway. The composer hides; the server refuses regardless.
  const bCmt = await call('/api/comment', { roundId: VBRID, body: 'both were great' }, 'POST', { 'X-Player-Token': b1 });
  ok('comments refused on a Versus round', bCmt.status === 400, 'got ' + bCmt.status);

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
  ok('binary recap has total points', typeof brecap.recap.totalPoints === 'number');
  ok('binary recap has unified accuracy %', typeof brecap.recap.accuracy === 'number', 'got ' + brecap.recap.accuracy);
  ok('binary recap accuracyByType has versus leg', typeof brecap.recap.accuracyByType.versus === 'number', JSON.stringify(brecap.recap.accuracyByType));
  ok('binary recap now HAS an absolute grade (from accuracy)', /^[A-DF][+-]?$/.test(brecap.recap.grade || ''), 'grade ' + brecap.recap.grade);
  ok('binary recap surfaces a Versus card', Array.isArray(brecap.recap.versusRounds) && brecap.recap.versusRounds.length >= 1, JSON.stringify(brecap.recap.versusRounds));
  ok('versus card carries pick + actual split', brecap.recap.versusRounds[0].my_pick && brecap.recap.versusRounds[0].actual_split_a != null, JSON.stringify(brecap.recap.versusRounds[0]));

  console.log('\n— rating game untouched: original session still rating —');
  const ratingStillWorks = (await call(`/api/admin/state?sessionId=${SID}`, null, 'GET', AH)).d;
  ok('original session is rating type', ratingStillWorks.poll_type === 'rating', ratingStillWorks.poll_type);

  // ======================================================================
  // MIXED ROUNDS — one room running BOTH 0-9 rating and binary (Versus) rounds.
  // Poll type is per-round: defaults to the previous round, host overrides per round.
  // ======================================================================
  console.log('\n— mixed: create a session (default rating), join 3 —');
  const mcs = await call('/api/session', { name: 'Mixed Night' }, 'POST', BOOTH); // no pollType -> rating default
  const MSID = mcs.d.sessionId, MAH = { 'X-Admin-Token': mcs.d.adminToken };
  ok('mixed session created (rating default)', mcs.status === 200 && mcs.d.pollType === 'rating', JSON.stringify(mcs.d));
  async function mjoin(email, name) {
    const req = await call('/api/join/request', { sessionId: MSID, email });
    const ver = await call('/api/join/verify', { sessionId: MSID, email, code: req.d.devCode, name });
    return ver.d.token;
  }
  const mxA = await mjoin('ma@test.com', 'Mia'), mxB = await mjoin('mb@test.com', 'Moe'), mxC = await mjoin('mc@test.com', 'Nix');

  console.log('\n— mixed: round 1 is a RATING round (session default) —');
  const mr1 = await call('/api/admin/round', { sessionId: MSID, song_title: 'Rating One', song_artist: 'X' }, 'POST', MAH);
  await startVoting(MSID, MAH);
  ok('R1 added + auto-opened', mr1.status === 200 && mr1.d.opened, JSON.stringify(mr1.d));
  let mxState = (await call(`/api/admin/state?sessionId=${MSID}`, null, 'GET', MAH)).d;
  ok('R1 active round poll_type=rating', mxState.activeRound.poll_type === 'rating', mxState.activeRound.poll_type);
  let mxPlay = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': mxA })).d;
  ok('player sees R1 as rating widget', mxPlay.round.poll_type === 'rating', mxPlay.round && mxPlay.round.poll_type);
  await call('/api/vote', { taste: 7, predict: 6 }, 'POST', { 'X-Player-Token': mxA });
  await call('/api/vote', { taste: 6, predict: 6 }, 'POST', { 'X-Player-Token': mxB });
  await call('/api/vote', { taste: 5, predict: 6 }, 'POST', { 'X-Player-Token': mxC });
  const mrat1 = await call('/api/admin/round/ratify', { sessionId: MSID, roundId: mr1.d.roundId }, 'POST', MAH);
  ok('R1 ratifies as rating (room_average set, split null)', mrat1.d.poll_type === 'rating' && mrat1.d.room_average != null && mrat1.d.split_a == null, JSON.stringify(mrat1.d));

  console.log('\n— mixed: round 2 is a BINARY round in the SAME session (per-round override) —');
  const mr2miss = await call('/api/admin/round', { sessionId: MSID, song_title: 'Only A', poll_type: 'binary' }, 'POST', MAH);
  await startVoting(MSID, MAH);
  ok('binary round in mixed session still requires Song B', mr2miss.status === 400, 'got ' + mr2miss.status);
  const mr2 = await call('/api/admin/round', { sessionId: MSID, song_title: 'Versus A', option_b_title: 'Versus B', poll_type: 'binary' }, 'POST', MAH);
  await startVoting(MSID, MAH);
  ok('R2 binary added + auto-opened', mr2.status === 200 && mr2.d.opened, JSON.stringify(mr2.d));
  mxState = (await call(`/api/admin/state?sessionId=${MSID}`, null, 'GET', MAH)).d;
  ok('R2 active round poll_type=binary', mxState.activeRound.poll_type === 'binary', mxState.activeRound.poll_type);
  mxPlay = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': mxA })).d;
  ok('player widget switched to binary for R2', mxPlay.round.poll_type === 'binary', mxPlay.round && mxPlay.round.poll_type);
  ok('SEALED: R2 split not leaked mid-vote', mxPlay.round.split_a === undefined, 'leaked ' + mxPlay.round.split_a);
  await call('/api/vote', { pick: 'A', predict_split: 60 }, 'POST', { 'X-Player-Token': mxA });
  await call('/api/vote', { pick: 'A', predict_split: 55 }, 'POST', { 'X-Player-Token': mxB });
  await call('/api/vote', { pick: 'B', predict_split: 40 }, 'POST', { 'X-Player-Token': mxC });
  // a rating-shaped vote must be rejected on this binary round
  const mwrong = await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': mxA });
  ok('rating-shaped vote rejected on binary round (already voted OR shape)', mwrong.status === 400, 'got ' + mwrong.status);
  const mrat2 = await call('/api/admin/round/ratify', { sessionId: MSID, roundId: mr2.d.roundId }, 'POST', MAH);
  ok('R2 ratifies as binary (split_a set, room_average null)', mrat2.d.poll_type === 'binary' && mrat2.d.split_a != null && mrat2.d.room_average == null, JSON.stringify(mrat2.d));

  console.log('\n— mixed: round 3 with NO type inherits the previous (binary) — persistence —');
  const mr3inherit = await call('/api/admin/round', { sessionId: MSID, song_title: 'Inherits binary' }, 'POST', MAH);
  await startVoting(MSID, MAH);
  ok('R3 (no poll_type) inherits binary -> Song B required', mr3inherit.status === 400, 'got ' + mr3inherit.status);
  const mr3 = await call('/api/admin/round', { sessionId: MSID, song_title: 'Rating Three', poll_type: 'rating' }, 'POST', MAH);
  await startVoting(MSID, MAH);
  ok('R3 switched back to rating', mr3.status === 200 && mr3.d.opened, JSON.stringify(mr3.d));
  await call('/api/vote', { taste: 8, predict: 7 }, 'POST', { 'X-Player-Token': mxA });
  await call('/api/vote', { taste: 7, predict: 7 }, 'POST', { 'X-Player-Token': mxB });
  await call('/api/vote', { taste: 9, predict: 7 }, 'POST', { 'X-Player-Token': mxC });
  await call('/api/admin/round/ratify', { sessionId: MSID, roundId: mr3.d.roundId }, 'POST', MAH);

  console.log('\n— mixed: recap unifies both mechanics (accuracy %, absolute grade, versus card) —');
  await call('/api/admin/session/end', { sessionId: MSID }, 'POST', MAH);
  const mrecap = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': mxA })).d.recap;
  ok('mixed recap: unified accuracy is a number', typeof mrecap.accuracy === 'number', 'acc ' + mrecap.accuracy);
  ok('mixed recap: absolute grade present', /^[A-DF][+-]?$/.test(mrecap.grade || ''), 'grade ' + mrecap.grade);
  ok('mixed recap: rating leg present', typeof mrecap.accuracyByType.rating === 'number', JSON.stringify(mrecap.accuracyByType));
  ok('mixed recap: versus leg present', typeof mrecap.accuracyByType.versus === 'number', JSON.stringify(mrecap.accuracyByType));
  ok('mixed recap: 3 rounds played', mrecap.roundsPlayed === 3, 'got ' + mrecap.roundsPlayed);
  ok('mixed recap: exactly ONE versus round in the card', mrecap.versusRounds.length === 1, JSON.stringify(mrecap.versusRounds));

  console.log('\n— mixed: export uses the union shape (round_type + both column sets) —');
  const mxExp = await fetch(base + `/api/admin/export?sessionId=${MSID}&format=json`, { headers: MAH }).then(r => r.json());
  ok('mixed export poll_type=mixed', mxExp.session.poll_type === 'mixed', JSON.stringify(mxExp.session.poll_type));
  ok('mixed export rounds carry round_type', mxExp.rounds.every(r => r.round_type === 'rating' || r.round_type === 'binary'), JSON.stringify(mxExp.rounds.map(r=>r.round_type)));
  ok('mixed export has a rating round with room_average', mxExp.rounds.some(r => r.round_type === 'rating' && r.room_average != null), JSON.stringify(mxExp.rounds));
  ok('mixed export has a binary round with split_a + song_b', mxExp.rounds.some(r => r.round_type === 'binary' && r.split_a != null && r.song_b_title), JSON.stringify(mxExp.rounds));
  ok('mixed export votes carry round_type', mxExp.votes.every(v => v.round_type === 'rating' || v.round_type === 'binary'), JSON.stringify(mxExp.votes[0]));
  ok('mixed export: rating votes carry rating, binary votes carry pick', mxExp.votes.some(v=>v.round_type==='rating'&&v.rating!=null) && mxExp.votes.some(v=>v.round_type==='binary'&&v.pick), 'shape');
  const mxCsv = await fetch(base + `/api/admin/export?sessionId=${MSID}&format=csv`, { headers: MAH }).then(r => r.text());
  ok('mixed CSV header is the union (round_type + rating + pick + split_a)', /round_type/.test(mxCsv) && /rating/.test(mxCsv) && /pick/.test(mxCsv) && /split_a/.test(mxCsv), mxCsv.split('\n')[0]);

  // ======================================================================
  // EVENT TOOLS — watch link, lobby message, sign-up prompt, broadcast, overlay
  // ======================================================================
  console.log('\n— event tools: session config at creation —');
  const ecs = await call('/api/session', { name: 'Event Night', watchUrl: 'https://twitch.tv/example', lobbyMessage: 'Starting soon!' }, 'POST', BOOTH);
  ok('session created with config', ecs.status === 200 && ecs.d.sessionId, JSON.stringify(ecs.d));
  const ESID = ecs.d.sessionId, EATOK = ecs.d.adminToken, EAH = { 'X-Admin-Token': EATOK };
  let es = (await call(`/api/admin/state?sessionId=${ESID}`, null, 'GET', EAH)).d;
  ok('watch_url stored', es.session.watch_url === 'https://twitch.tv/example', es.session.watch_url);
  ok('lobby_message stored', es.session.lobby_message === 'Starting soon!', es.session.lobby_message);

  console.log('\n— event tools: bad watch url is rejected (sanitized to null) —');
  const badUrl = await call('/api/session', { name: 'Bad URL', watchUrl: 'javascript:alert(1)' }, 'POST', BOOTH);
  const buState = (await call(`/api/admin/state?sessionId=${badUrl.d.sessionId}`, null, 'GET', { 'X-Admin-Token': badUrl.d.adminToken })).d;
  ok('non-http watch url sanitized to null', buState.session.watch_url === null, 'got ' + buState.session.watch_url);

  console.log('\n— event tools: update config after creation —');
  await call('/api/admin/session/config', { sessionId: ESID, watchUrl: 'https://youtube.com/live', lobbyMessage: '' }, 'POST', EAH);
  es = (await call(`/api/admin/state?sessionId=${ESID}`, null, 'GET', EAH)).d;
  ok('watch_url updated', es.session.watch_url === 'https://youtube.com/live', es.session.watch_url);
  ok('lobby_message cleared via empty string', es.session.lobby_message === null, JSON.stringify(es.session.lobby_message));

  console.log('\n— event tools: config surfaced at join —');
  const ejr = await call('/api/join/request', { sessionId: ESID, email: 'fan@test.com' });
  ok('join/request returns watch url', ejr.d.watchUrl === 'https://youtube.com/live', ejr.d.watchUrl);
  await call('/api/join/verify', { sessionId: ESID, email: 'fan@test.com', code: ejr.d.devCode, name: 'Fan One' });

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
  ok('overlay shows the full display name (not first-word only)', ov.leaderboard.some(r => r.name === 'Fan One'), JSON.stringify(ov.leaderboard.map(r=>r.name)));
  const ovStr = JSON.stringify(ov);
  ok('overlay leaks no emails', !/@test\.com/.test(ovStr));
  ok('overlay leaks no signup answers', !/Atlanta/.test(ovStr) && !/fanone/.test(ovStr));
  const ovBad = await fetch(base + `/api/overlay/state?s=nope`).then(r => r.status);
  ok('overlay 404s unknown session', ovBad === 404, 'got ' + ovBad);

  console.log('\n— overlay: host-keyed (?host=) follows the host\'s current/next room —');
  // A fresh host so no other test sessions interfere with the resolution.
  const hkVer = await call('/api/auth/verify', { email: 'hostkey@test.com', code: (await call('/api/auth/request', { email: 'hostkey@test.com' })).d.devCode });
  const HKH = { 'X-Auth-Token': hkVer.d.token }, HKUID = hkVer.d.uid;
  await call('/api/admin/users/role', { uid: HKUID, role: 'host' }, 'POST', BOOTH);
  const hkNone = await fetch(base + `/api/overlay/state?host=${HKUID}`).then(r => r.status);
  ok('host with no room 404s', hkNone === 404, 'got ' + hkNone);
  // Upcoming session only → host key resolves to it. (Sessions default to 'live' unless
  // status:'upcoming' or a future scheduledAt is given — server.js create.)
  const hkUp = await call('/api/session', { name: 'HK Upcoming', status: 'upcoming' }, 'POST', HKH);
  const HKUP = hkUp.d.sessionId;
  const ovUp = await fetch(base + `/api/overlay/state?host=${HKUID}`).then(r => r.json());
  ok('host key resolves to the upcoming room', ovUp.session && ovUp.session.id === HKUP, JSON.stringify(ovUp.session));
  ok('resolved upcoming carries status', ovUp.session.status === 'upcoming', ovUp.session.status);
  // A live session (round opened) beats upcoming.
  const hkLive = await call('/api/session', { name: 'HK Live' }, 'POST', HKH);
  const HKLIVE = hkLive.d.sessionId;
  await call('/api/admin/round', { sessionId: HKLIVE, song_title: 'Live Song' }, 'POST', HKH); // auto-opens -> live
  await startVoting(HKLIVE, HKH);
  const ovLive = await fetch(base + `/api/overlay/state?host=${HKUID}`).then(r => r.json());
  ok('host key prefers the LIVE room over upcoming', ovLive.session.id === HKLIVE && ovLive.session.status === 'live', JSON.stringify(ovLive.session));
  ok('host-keyed payload carries session.id for QR rebuild', typeof ovLive.session.id === 'string' && ovLive.session.id.length > 0, ovLive.session.id);
  // End the live room → host key falls back to the upcoming one again.
  await call('/api/admin/session/end', { sessionId: HKLIVE }, 'POST', HKH);
  const ovBack = await fetch(base + `/api/overlay/state?host=${HKUID}`).then(r => r.json());
  ok('host key falls back to upcoming after live ends', ovBack.session.id === HKUP, JSON.stringify(ovBack.session));
  // ?h= is an accepted alias.
  const ovAlias = await fetch(base + `/api/overlay/state?h=${HKUID}`).then(r => r.json());
  ok('?h= alias works', ovAlias.session.id === HKUP, JSON.stringify(ovAlias.session));

  console.log('\n— overlay: leaderboard scope (?leader_scope=room|round|series) —');
  const ovRoom = await fetch(base + `/api/overlay/state?s=${SID}`).then(r => r.json());
  ok('default scope is room', ovRoom.leaderboardScope === 'room', ovRoom.leaderboardScope);
  const ovRound = await fetch(base + `/api/overlay/state?s=${SID}&leader_scope=round`).then(r => r.json());
  ok('round scope flagged', ovRound.leaderboardScope === 'round', ovRound.leaderboardScope);
  ok('round scope board has rows (latest ratified round)', ovRound.leaderboard.length > 0, JSON.stringify(ovRound.leaderboard));
  ok('round scope points are single-round sized (≤135), not running totals',
    ovRound.leaderboard.every(r => r.points <= 135), JSON.stringify(ovRound.leaderboard));
  const ovSerFallback = await fetch(base + `/api/overlay/state?s=${SID}&leader_scope=series`).then(r => r.json());
  ok('series scope falls back to room on an untagged room', ovSerFallback.leaderboardScope === 'room', ovSerFallback.leaderboardScope);
  const scSer = await call('/api/admin/series/create', { title: 'Overlay Scope Series', status: 'active' }, 'POST', BOOTH);
  await call('/api/admin/series/tag', { sessionId: ESID, seriesId: scSer.d.seriesId }, 'POST', BOOTH);
  const ovSer = await fetch(base + `/api/overlay/state?s=${ESID}&leader_scope=series`).then(r => r.json());
  ok('series scope active once tagged', ovSer.leaderboardScope === 'series', ovSer.leaderboardScope);
  ok('series scope board is an array', Array.isArray(ovSer.leaderboard), JSON.stringify(ovSer.leaderboard));

  // ======================================================================
  // ANALYTICS — admin-only cross-session engagement + retention dashboard
  // ======================================================================
  console.log('\n— analytics: admin-only gate —');
  const anNoAuth = await fetch(base + '/api/admin/analytics').then(r => r.status);
  ok('analytics 403s without auth', anNoAuth === 403 || anNoAuth === 401, 'got ' + anNoAuth);
  const anAsHost = await call('/api/admin/analytics', null, 'GET', { 'X-Auth-Token': HOSTTOK });
  ok('analytics rejects a non-admin', anAsHost.status === 403 || anAsHost.status === 401, 'got ' + anAsHost.status);

  console.log('\n— analytics: payload shape + internal consistency —');
  const an = (await call('/api/admin/analytics?window=12', null, 'GET', BOOTH)).d;
  ok('analytics returns overview', an.overview && typeof an.overview.shows === 'number', JSON.stringify(an.overview));
  ok('analytics returns shows array', Array.isArray(an.shows) && an.shows.length >= 1, 'shows ' + (an.shows || []).length);
  ok('analytics returns retention histogram', Array.isArray(an.retention.histogram), JSON.stringify(an.retention));
  ok('analytics returns accuracy tiers', an.accuracy && typeof an.accuracy.total === 'number', JSON.stringify(an.accuracy));
  ok('analytics is PII-safe (no @ / email/phone keys)', !/@|"email"|"phone"|"uid"/.test(JSON.stringify(an)), 'leak');
  ok('every show: active <= registered', an.shows.every(s => s.active <= s.registered), JSON.stringify(an.shows.map(s => [s.active, s.registered])));
  ok('every show: votes >= active (>=1 vote each)', an.shows.every(s => s.votes >= s.active), 'bad');
  ok('accuracy tiers sum to accuracy.total', (an.accuracy.bullseye + an.accuracy.sharp + an.accuracy.close + an.accuracy.off + an.accuracy.wayoff) === an.accuracy.total, JSON.stringify(an.accuracy));
  ok('returning rate is a 0–100 percent', an.overview.returningRate >= 0 && an.overview.returningRate <= 100, 'got ' + an.overview.returningRate);
  ok('retention histogram buckets sum to uniqueARs', an.retention.histogram.reduce((a, h) => a + h.count, 0) === an.retention.uniqueARs, JSON.stringify(an.retention));
  ok('window is clamped', ((await call('/api/admin/analytics?window=999', null, 'GET', BOOTH)).d.window) === 52, 'clamp');

  console.log('\n— analytics data feed (static-token, machine-readable, PII-safe) —');
  const feedNoTok = await fetch(base + '/api/analytics/export').then(r => r.status);
  ok('feed 401s without a token', feedNoTok === 401, 'got ' + feedNoTok);
  const feedBad = await fetch(base + '/api/analytics/export?token=wrong').then(r => r.status);
  ok('feed 401s on a bad token', feedBad === 401, 'got ' + feedBad);
  const feed = await fetch(base + '/api/analytics/export?token=test-analytics-secret&window=12').then(r => r.json());
  ok('feed returns sessions/participants/rounds/votes arrays',
    Array.isArray(feed.sessions) && Array.isArray(feed.participants) && Array.isArray(feed.rounds) && Array.isArray(feed.votes),
    JSON.stringify(Object.keys(feed)));
  ok('feed has at least one show', feed.sessions.length >= 1, 'sessions ' + feed.sessions.length);
  ok('feed votes carry a stable ar pseudonym', feed.votes.length === 0 || feed.votes.every(v => typeof v.ar === 'string' && v.ar.startsWith('AR-')), 'ar');
  ok('feed is PII-safe (no @ / email/phone/uid/name-of-person keys)',
    !/@|"email"|"phone"|"uid"|"user_id"/.test(JSON.stringify(feed)), 'leak');
  // Same durable A&R keeps the SAME pseudonym across two different shows (retention works).
  const arBySession = {};
  for (const v of feed.votes) { (arBySession[v.s] = arBySession[v.s] || new Set()).add(v.ar); }
  const allAr = feed.votes.map(v => v.ar);
  ok('pseudonyms are deterministic within a pull', new Set(allAr).size <= allAr.length, 'ar set');
  ok('feed token also accepted via header', (await fetch(base + '/api/analytics/export?window=4', { headers: { 'x-analytics-token': 'test-analytics-secret' } })).status === 200, 'hdr');

  // ======================================================================
  // REFERRALS — code issued, attribution on join, credit on first vote
  // ======================================================================
  console.log('\n— referrals: each player gets a code; referred join is attributed —');
  const rcs = await call('/api/session', { name: 'Referral Test' }, 'POST', BOOTH);
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
  await startVoting(RSID, RAH);
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
  ok('referred_by maps to inviter label', refRow && /^A&R \d+$/.test(refRow.referred_by || ''), JSON.stringify(refRow && refRow.referred_by));
  ok('referral_credited reflected in export', refRow && refRow.referral_credited === 1, JSON.stringify(refRow && refRow.referral_credited));
  const rexpAnon = await fetch(base + `/api/admin/export?sessionId=${RSID}&format=json&anon=1`, { headers: RAH }).then(r => r.json());
  ok('anon export still has referral attribution (no PII)', rexpAnon.participants.some(p => p.referred_by && /^A&R \d+$/.test(p.referred_by)), JSON.stringify(rexpAnon.participants.map(p=>p.referred_by)));
  ok('anon export leaks no referral emails', !/@test\.com/.test(JSON.stringify(rexpAnon.participants)));

  // ======================================================================
  // GEOFENCED CHECK-IN — venue pin, modes, lock-in gate, pooling, privacy
  // ======================================================================
  console.log('\n— geo: venue can be set ahead, enforcement off; config independent —');
  const gcs = await call('/api/session', { name: 'LA Event' }, 'POST', BOOTH);
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
  await startVoting(GSID, GAH);
  await call('/api/admin/round/open', { sessionId: GSID, roundId: gRound1.d.roundId, minutes: 5 }, 'POST', GAH);
  const earlyTok = await gjoin('early@test.com', 'Early Bird');
  const earlyVote = await call('/api/vote', { taste: 6, predict: 6 }, 'POST', { 'X-Player-Token': earlyTok });
  ok('vote locks with geo off', earlyVote.d.locked === true, JSON.stringify(earlyVote.d));
  await call('/api/admin/round/ratify', { sessionId: GSID, roundId: gRound1.d.roundId }, 'POST', GAH);

  console.log('\n— geo: flip enforcement ON (optional/dual-pool); lock-in now gated —');
  await call('/api/admin/session/config', { sessionId: GSID, geoMode: 'optional' }, 'POST', GAH);
  const gRound2 = await call('/api/admin/round', { sessionId: GSID, song_title: 'Geo Round' }, 'POST', GAH);
  await startVoting(GSID, GAH);
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

  console.log('\n— geo: REQUIRED mode demands an AT-VENUE pool for every new vote —');
  // Fresh round under required mode (close out the optional-phase round first).
  await call('/api/admin/round/close', { sessionId: GSID, roundId: gRound2.d.roundId }, 'POST', GAH);
  await call('/api/admin/round/ratify', { sessionId: GSID, roundId: gRound2.d.roundId }, 'POST', GAH);
  await call('/api/admin/round', { sessionId: GSID, song_title: 'Strict Round' }, 'POST', GAH); // auto-opens
  await startVoting(GSID, GAH);
  // Rita kept her 'online' pool from the optional phase — required mode must NOT accept it.
  const ritaStrict = await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': farTok });
  ok('online pool from the optional phase is NOT enough in required mode (428)', ritaStrict.status === 428 && ritaStrict.d.error === 'checkin_required', JSON.stringify([ritaStrict.status, ritaStrict.d]));
  // A never-checked-in player is gated too.
  const samStrict = await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': strictTok });
  ok('unchecked player is gated in required mode (428)', samStrict.status === 428 && samStrict.d.error === 'checkin_required', JSON.stringify([samStrict.status, samStrict.d]));
  // The at-venue player sails through.
  const inStrict = await call('/api/vote', { taste: 8, predict: 7 }, 'POST', { 'X-Player-Token': inTok });
  ok('at-venue player votes in required mode', inStrict.d.locked === true, JSON.stringify(inStrict.d));
  // Rita shows up at the venue → re-check-in upgrades her pool → she can vote.
  const ritaUp = await call('/api/checkin', { lat: near.lat, lng: near.lng, accuracy: 15 }, 'POST', { 'X-Player-Token': farTok });
  ok('re-check-in at the venue upgrades online → in_person', ritaUp.d.pool === 'in_person' && ritaUp.d.checked_in, JSON.stringify(ritaUp.d));
  const ritaVote = await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': farTok });
  ok('upgraded player can now vote', ritaVote.d.locked === true, JSON.stringify(ritaVote.d));

  // ======================================================================
  // REGRESSION: per-session tokens — a token must resolve to ITS OWN session
  // (the "Session A link showed Session B" bug). Same email in two sessions
  // must produce two distinct participants/tokens, each scoped to its session.
  // ======================================================================
  console.log('\n— regression: same email across two sessions = two scoped tokens —');
  const sA = await call('/api/session', { name: 'Session Alpha' }, 'POST', BOOTH);
  const sB = await call('/api/session', { name: 'Session Bravo' }, 'POST', BOOTH);
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
  const sm = await call('/api/session', { name: 'Original Name', lobbyMessage: 'hi' }, 'POST', BOOTH);
  const SMID = sm.d.sessionId, SMAH = { 'X-Admin-Token': sm.d.adminToken };
  await call('/api/admin/session/config', { sessionId: SMID, name: 'Renamed Event', lobbyMessage: 'updated' }, 'POST', SMAH);
  let sms = (await call(`/api/admin/state?sessionId=${SMID}`, null, 'GET', SMAH)).d;
  ok('session name edited', sms.session.name === 'Renamed Event', sms.session.name);
  ok('lobby message edited', sms.session.lobby_message === 'updated', sms.session.lobby_message);
  const emptyName = await call('/api/admin/session/config', { sessionId: SMID, name: '   ' }, 'POST', SMAH);
  ok('empty name rejected', emptyName.status === 400, 'got ' + emptyName.status);

  console.log('\n— session mgmt: default ad + venue settable at creation —');
  const smCreate = await call('/api/session', { name: 'Preconfigured', geoLat: 34.04, geoLng: -118.26, geoRadius: 150, geoLabel: 'Venue X' }, 'POST', BOOTH);
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
  const fbSess = await call('/api/session', { name: 'Feedback Night' }, 'POST', BOOTH);
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
  await startVoting(PGID, PGAH);
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
  // Go live WITHOUT a notify object -> the host didn't opt in, so nothing sends.
  await call('/api/admin/session/status', { sessionId: NOID, status: 'live' }, 'POST', ADMINH);
  const noNotify = Number((await db.get('SELECT COUNT(*) c FROM notification_log WHERE session_id = ?', [NOID])).c);
  ok('go-live without notify sends nothing', noNotify === 0, 'got ' + noNotify);
  // Reopen and go live WITH notify:{email,sms} -> dispatch fires on this transition.
  await call('/api/admin/session/status', { sessionId: NOID, status: 'upcoming' }, 'POST', ADMINH);
  const golive = await call('/api/admin/session/status', { sessionId: NOID, status: 'live', notify: { email: true, sms: true } }, 'POST', ADMINH);
  ok('go-live ok', golive.status === 200, JSON.stringify(golive.d));
  const rows = await db.all('SELECT channel, status FROM notification_log WHERE session_id = ?', [NOID]);
  const emails = rows.filter(r => r.channel === 'email'), smses = rows.filter(r => r.channel === 'sms');
  ok('emailed both registrants', emails.length === 2 && emails.every(r => r.status === 'sent'), JSON.stringify(rows));
  ok('SMS only to the consenting number', smses.length === 1 && smses[0].status === 'sent', JSON.stringify(smses));
  // Idempotent: reopen with notify again must not re-notify.
  await call('/api/admin/session/status', { sessionId: NOID, status: 'upcoming' }, 'POST', ADMINH);
  await call('/api/admin/session/status', { sessionId: NOID, status: 'live', notify: { email: true, sms: true } }, 'POST', ADMINH);
  const after = Number((await db.get('SELECT COUNT(*) c FROM notification_log WHERE session_id = ?', [NOID])).c);
  ok('reopen does not re-notify', after === rows.length, `before ${rows.length} after ${after}`);
  // Channel selection is honored: email-only go-live sends no SMS.
  const emSess = await call('/api/session', { name: 'Email Only Night', status: 'upcoming' }, 'POST', ADMINH);
  const EMID = emSess.d.sessionId;
  const erq = await call('/api/join/request', { sessionId: EMID, email: 'eo@test.com' });
  await call('/api/join/verify', { sessionId: EMID, email: 'eo@test.com', code: erq.d.devCode, name: 'EOnly', phone: '(555) 333-4444' });
  await call('/api/admin/session/status', { sessionId: EMID, status: 'live', notify: { email: true, sms: false } }, 'POST', ADMINH);
  const emRows = await db.all('SELECT channel FROM notification_log WHERE session_id = ?', [EMID]);
  ok('email-only selection sends no SMS', emRows.length === 1 && emRows[0].channel === 'email', JSON.stringify(emRows));

  console.log('\n— review-site ingest: token-gated push, host pulls latest —');
  const ingBad = await call('/api/ingest/submission', { title: 'Hack', artist: 'X' }, 'POST', { 'X-Ingest-Token': 'wrong' });
  ok('ingest rejects a bad token', ingBad.status === 401, 'got ' + ingBad.status);
  const ingOk = await call('/api/ingest/submission', { title: 'Neon Skyline', artist: 'The Verge', instagram: '@theverge', source: 'drupal',
    email: 'Verge@Band.COM', phone: '(305) 555-0142' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  ok('ingest accepts a good token', ingOk.status === 200 && ingOk.d.ok, JSON.stringify(ingOk.d));
  const ingEmpty = await call('/api/ingest/submission', { title: '', artist: '' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  ok('ingest rejects an empty song', ingEmpty.status === 400, 'got ' + ingEmpty.status);
  // Non-authed cannot pull; admin can and gets the last staged song.
  const pullNoAuth = await call('/api/admin/ingest/latest', null, 'GET');
  ok('ingest pull needs auth', pullNoAuth.status === 403, 'got ' + pullNoAuth.status);
  const pull = await call('/api/admin/ingest/latest', null, 'GET', ADMINH);
  ok('host pulls the staged submission', pull.status === 200 && pull.d.title === 'Neon Skyline' && pull.d.artist === 'The Verge', JSON.stringify(pull.d));
  ok('ingest normalizes the IG handle (strips @)', pull.d.instagram === 'theverge', JSON.stringify(pull.d));
  // Artist contact rides along so the post-show report card can reach them.
  ok('ingest carries + normalizes the artist email', pull.d.email === 'verge@band.com', JSON.stringify(pull.d));
  ok('ingest carries the artist phone', pull.d.phone === '(305) 555-0142', JSON.stringify(pull.d));
  const ingJunk = await call('/api/ingest/submission', { title: 'Junk Contact', artist: 'Nobody', email: 'not-an-email', phone: '123' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  ok('ingest accepts the song even with unusable contact', ingJunk.status === 200, 'got ' + ingJunk.status);
  const pullJunk = (await call('/api/admin/ingest/latest', null, 'GET', ADMINH)).d;
  ok('unusable contact stages as null, not garbage', pullJunk.email === null && pullJunk.phone === null, JSON.stringify(pullJunk));
  // Re-stage the good record so later assertions/UI see a complete one.
  await call('/api/ingest/submission', { title: 'Neon Skyline', artist: 'The Verge', instagram: '@theverge', source: 'drupal' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  // adminState surfaces it so the button can show.
  const anyLive = await call('/api/session', { name: 'Ingest Btn', status: 'live' }, 'POST', ADMINH);
  const ist = (await call('/api/admin/state?sessionId=' + anyLive.d.sessionId, null, 'GET', ADMINH)).d;
  ok('adminState carries ingestLatest', ist.ingestLatest && ist.ingestLatest.title === 'Neon Skyline', JSON.stringify(ist.ingestLatest));

  console.log('\n— SMS test endpoint: auth-gated, reports provider —');
  const smsNoAuth = await call('/api/admin/sms/test', { to: '+13055551234' }, 'POST');
  ok('sms test needs auth', smsNoAuth.status === 401, 'got ' + smsNoAuth.status);
  const smsNoNum = await call('/api/admin/sms/test', {}, 'POST', ADMINH);
  ok('sms test requires a number', smsNoNum.status === 400, 'got ' + smsNoNum.status);
  const smsTest = await call('/api/admin/sms/test', { to: '+13055551234' }, 'POST', ADMINH);
  ok('sms test sends (console provider in tests)', smsTest.status === 200 && smsTest.d.ok === true && smsTest.d.provider === 'console', JSON.stringify(smsTest.d));

  console.log('\n— host role: assignment (admin-only) + engagement-only visibility (no PII) —');
  const usersList = (await call('/api/admin/users', null, 'GET', ADMINH)).d;
  const hostUser = (usersList.users || []).find(u => u.email === 'host@test.com');
  ok('host user present in admin list', !!(hostUser && hostUser.id), JSON.stringify((usersList.users||[]).map(u=>u.email)));
  const up = await call('/api/admin/users/role', { uid: hostUser.id, role: 'host' }, 'POST', ADMINH);
  ok('admin upgrades user to host', up.status === 200 && up.d.role === 'host', JSON.stringify(up.d));
  const badRole = await call('/api/admin/users/role', { uid: hostUser.id, role: 'admin' }, 'POST', ADMINH);
  ok('cannot mint an admin via role endpoint', badRole.status === 400, 'got ' + badRole.status);
  // Fresh login for the now-host (the earlier AUTHH token was logged out at line ~407).
  const hReq = await call('/api/auth/request', { email: 'host@test.com' });
  const hVer = await call('/api/auth/verify', { email: 'host@test.com', code: hReq.d.devCode });
  const HOSTH = { 'X-Auth-Token': hVer.d.token };
  ok('re-login reflects role=host', hVer.d.role === 'host', JSON.stringify(hVer.d));
  const roleForbidden = await call('/api/admin/users/role', { uid: hostUser.id, role: 'player' }, 'POST', HOSTH);
  ok('a host cannot assign roles', roleForbidden.status === 403, 'got ' + roleForbidden.status);
  // A host viewing their OWN session sees engagement but no contact PII; admin sees email.
  const hs = await call('/api/session', { name: 'Host Redact' }, 'POST', HOSTH);
  const HS = hs.d.sessionId;
  const hjr = await call('/api/join/request', { sessionId: HS, email: 'fan@redact.com' });
  await call('/api/join/verify', { sessionId: HS, email: 'fan@redact.com', code: hjr.d.devCode, name: 'RedactFan' });
  const asHost = (await call('/api/admin/state?sessionId=' + HS, null, 'GET', HOSTH)).d;
  const asAdmin = (await call('/api/admin/state?sessionId=' + HS, null, 'GET', ADMINH)).d;
  const hp = (asHost.participants || []).find(p => p.name === 'RedactFan');
  const ap = (asAdmin.participants || []).find(p => p.name === 'RedactFan');
  ok('host sees the participant (name + points)', !!(hp && hp.total_points !== undefined), JSON.stringify(hp));
  ok('host does NOT see participant email', !!hp && hp.email === undefined, JSON.stringify(hp));
  ok('admin DOES see participant email', !!ap && ap.email === 'fan@redact.com', JSON.stringify(ap));

  console.log('\n— per-host feature permissions (default NONE; admin grants; server-enforced) —');
  const meNoPerm = await call('/api/auth/me', null, 'GET', HOSTH);
  ok('new host has no feature perms by default', !!meNoPerm.d.perms && meNoPerm.d.perms.broadcast === false && meNoPerm.d.perms.sms === false, JSON.stringify(meNoPerm.d.perms));
  const bcDenied = await call('/api/admin/session/broadcast', { sessionId: HS, text: 'hi' }, 'POST', HOSTH);
  ok('host without broadcast perm is blocked (403)', bcDenied.status === 403, 'got ' + bcDenied.status);
  const permForbidden = await call('/api/admin/users/perms', { uid: hostUser.id, perms: { sms: true } }, 'POST', HOSTH);
  ok('a host cannot set permissions', permForbidden.status === 403, 'got ' + permForbidden.status);
  const grant = await call('/api/admin/users/perms', { uid: hostUser.id, perms: { broadcast: true } }, 'POST', ADMINH);
  ok('admin grants a host the broadcast perm', grant.status === 200 && grant.d.perms.broadcast === true, JSON.stringify(grant.d));
  const meWithPerm = await call('/api/auth/me', null, 'GET', HOSTH);
  ok('host now reports broadcast perm', meWithPerm.d.perms.broadcast === true && meWithPerm.d.perms.sms === false, JSON.stringify(meWithPerm.d.perms));
  const bcOk = await call('/api/admin/session/broadcast', { sessionId: HS, text: 'hi from host' }, 'POST', HOSTH);
  ok('host with broadcast perm can broadcast', bcOk.status === 200, JSON.stringify(bcOk.d));
  const adminBc = await call('/api/admin/session/broadcast', { sessionId: HS, text: 'admin msg' }, 'POST', ADMINH);
  ok('admin can broadcast regardless of perms', adminBc.status === 200, JSON.stringify(adminBc.d));

  console.log('\n— review-site auto-fill: per-room mode, admin-gated, realtime nudge —');
  // Default is HOLD FOR THE BUTTON: an existing room must not start auto-filling because
  // the column arrived.
  const aiRoom = await call('/api/session', { name: 'Auto Ingest', status: 'live' }, 'POST', ADMINH);
  const AIID = aiRoom.d.sessionId;
  const aiState0 = (await call('/api/admin/state?sessionId=' + AIID, null, 'GET', ADMINH)).d;
  ok('a new room holds submissions for the button by default', aiState0.session.ingest_auto === 0, JSON.stringify(aiState0.session.ingest_auto));
  // With no room in auto mode, a push notifies nobody (it just stages, as always).
  const pushNoAuto = await call('/api/ingest/submission', { title: 'Held Song', artist: 'Nobody' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  ok('a push with no auto room notifies nobody', pushNoAuto.status === 200 && pushNoAuto.d.autoRooms === 0, JSON.stringify(pushNoAuto.d));
  // Arming it is admin-only — the staged payload carries the artist's email/phone, so a
  // plain host must not be able to point that stream at their own console.
  const aiHostDenied = await call('/api/admin/session/config', { sessionId: HS, ingestAuto: 1 }, 'POST', HOSTH);
  ok('a non-admin host cannot arm auto-fill (403)', aiHostDenied.status === 403, 'got ' + aiHostDenied.status);
  const hsAfter = (await call('/api/admin/state?sessionId=' + HS, null, 'GET', ADMINH)).d;
  ok('the denied room stays on hold-for-button', hsAfter.session.ingest_auto === 0, JSON.stringify(hsAfter.session.ingest_auto));
  // Turning it OFF is not privileged — a host can always stop their own room auto-filling.
  const aiHostOff = await call('/api/admin/session/config', { sessionId: HS, ingestAuto: 0 }, 'POST', HOSTH);
  ok('a host can still turn auto-fill off', aiHostOff.status === 200, 'got ' + aiHostOff.status);
  // …and can't get there the long way round either, via their room defaults.
  const aiHostDefault = await call('/api/me/host-defaults', { watchUrl: '', submitUrl: '', lobbyMessage: '', ingestAuto: 1 }, 'POST', HOSTH);
  ok('a non-admin host cannot default new rooms to auto-fill (403)', aiHostDefault.status === 403, 'got ' + aiHostDefault.status);
  const aiOn = await call('/api/admin/session/config', { sessionId: AIID, ingestAuto: 1 }, 'POST', ADMINH);
  ok('admin arms auto-fill on a room', aiOn.status === 200, JSON.stringify(aiOn.d));
  const aiState1 = (await call('/api/admin/state?sessionId=' + AIID, null, 'GET', ADMINH)).d;
  ok('adminState reports the armed mode', aiState1.session.ingest_auto === 1, JSON.stringify(aiState1.session.ingest_auto));
  const aiGet = (await call('/api/admin/session/get?id=' + AIID, null, 'GET', ADMINH)).d;
  ok('session/get carries the mode (so the room-list Edit cannot save it off)', aiGet.session.ingestAuto === 1, JSON.stringify(aiGet.session));
  // Now a push resolves to that live room so the console gets nudged instead of waiting
  // out the poll. The record itself still stages exactly as before.
  const pushAuto = await call('/api/ingest/submission', { title: 'Straight Through', artist: 'The Verge', email: 'v@band.com' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  ok('a push resolves to the live auto room', pushAuto.status === 200 && pushAuto.d.autoRooms === 1, JSON.stringify(pushAuto.d));
  const aiPull = (await call('/api/admin/ingest/latest', null, 'GET', ADMINH)).d;
  ok('auto mode changes delivery, not the staged record', aiPull.title === 'Straight Through' && aiPull.email === 'v@band.com' && !!aiPull.at, JSON.stringify(aiPull));
  // …and the push STAGES it as a real queued round, which is what makes it openable from a
  // Stream Deck: a filled form is browser text the server has never seen.
  const aiQ = (await call('/api/admin/state?sessionId=' + AIID, null, 'GET', ADMINH)).d;
  ok('the push queues the record server-side', aiQ.queue.length === 1 && aiQ.queue[0].song_title === 'Straight Through', JSON.stringify(aiQ.queue.map(r => r.song_title)));
  ok('the staged round carries the push timestamp (binds the form to it)', !!aiQ.queue[0].ingest_at, JSON.stringify(aiQ.queue[0].ingest_at));
  ok('the staged round carries the artist contact', aiQ.queue[0].artist_email === 'v@band.com', JSON.stringify(aiQ.queue[0].artist_email));
  ok('staging does NOT put it in front of the room', !aiQ.activeRound, JSON.stringify(aiQ.activeRound));
  // Newest push wins in the queue too — otherwise songs pushed past pile up as records that
  // were never played, and the deck opens the wrong one.
  await call('/api/ingest/submission', { title: 'Replaced It', artist: 'Later Push' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  const aiQ2 = (await call('/api/admin/state?sessionId=' + AIID, null, 'GET', ADMINH)).d;
  ok('a newer push replaces the staged record, not stacks on it', aiQ2.queue.length === 1 && aiQ2.queue[0].song_title === 'Replaced It', JSON.stringify(aiQ2.queue.map(r => r.song_title)));
  // THE REGRESSION THIS EXISTS FOR: a pushed record opens from the Stream Deck with no
  // console interaction at all. Before staging, Advance answered "Nothing queued".
  const aiKey = (await call('/api/me/control-key', {}, 'POST', ADMINH)).d.key;
  const aiDeck = await call(`/api/control/advance?k=${aiKey}&s=${AIID}`, null, 'GET');
  ok('the deck opens a pushed record with no console press', aiDeck.status === 200 && aiDeck.d.action === 'open' && aiDeck.d.status === 'listening', JSON.stringify(aiDeck.d));
  ok('the deck opened the pushed song itself', aiDeck.d.title === 'Replaced It', JSON.stringify(aiDeck.d.title));
  // Add & open round on an auto-filled form updates the staged round instead of queueing a
  // second copy of the same song. (Mid-show case: a round is already in play, so it stays queued.)
  await call('/api/ingest/submission', { title: 'Next Up', artist: 'Pushed' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  const aiQ3 = (await call('/api/admin/state?sessionId=' + AIID, null, 'GET', ADMINH)).d;
  ok('a push during a live round waits in the queue', aiQ3.queue.length === 1 && aiQ3.queue[0].song_title === 'Next Up', JSON.stringify(aiQ3.queue.map(r => r.song_title)));
  const aiBound = await call('/api/admin/round', { sessionId: AIID, roundId: aiQ3.queue[0].id, song_title: 'Next Up (fixed)', song_artist: 'Pushed' }, 'POST', ADMINH);
  ok('a bound Add writes to the staged round', aiBound.status === 200 && aiBound.d.roundId === aiQ3.queue[0].id, JSON.stringify(aiBound.d));
  const aiQ4 = (await call('/api/admin/state?sessionId=' + AIID, null, 'GET', ADMINH)).d;
  ok('a bound Add leaves no duplicate behind', aiQ4.queue.length === 1, JSON.stringify(aiQ4.queue.map(r => r.song_title)));
  ok('the host edit wins over what was pushed', aiQ4.queue[0].song_title === 'Next Up (fixed)', JSON.stringify(aiQ4.queue[0].song_title));
  // An unknown/stale roundId must not error at the host mid-show — it falls back to an insert.
  const aiStale = await call('/api/admin/round', { sessionId: AIID, roundId: 'no-such-round', song_title: 'Typed By Hand' }, 'POST', ADMINH);
  ok('a stale bound id falls back to a normal add', aiStale.status === 200 && aiStale.d.roundId !== 'no-such-round', JSON.stringify(aiStale.d));
  // A room NOT in auto mode is untouched: the push stages nothing there.
  const plainRoom = await call('/api/session', { name: 'Plain Ingest', status: 'live' }, 'POST', ADMINH);
  await call('/api/ingest/submission', { title: 'Not For You', artist: 'Nobody' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  const plainQ = (await call('/api/admin/state?sessionId=' + plainRoom.d.sessionId, null, 'GET', ADMINH)).d;
  ok('a hold-for-button room queues nothing', plainQ.queue.length === 0, JSON.stringify(plainQ.queue.map(r => r.song_title)));
  // A completed room is not a place to deliver songs — the resolution is live-only.
  await call('/api/admin/session/status', { sessionId: AIID, status: 'completed' }, 'POST', ADMINH);
  const pushDone = await call('/api/ingest/submission', { title: 'Too Late', artist: 'Nobody' }, 'POST', { 'X-Ingest-Token': 'test-ingest-secret' });
  ok('a finished auto room is no longer a delivery target', pushDone.status === 200 && pushDone.d.autoRooms === 0, JSON.stringify(pushDone.d));

  console.log('\n— A&R Daily: the approved daily batch from Drupal —');
  const dDb = require('./db');
  const DTOK = { 'X-Ingest-Token': 'test-daily-secret' };
  // The day is VARIABLE — 4 free + up to 12 paid — so every fixture here is deliberately
  // NOT 16. A test that always used 16 would let a hardcoded 16 slip through.
  const song = (n, over = {}) => ({ ref: 'node/' + n, url: 'https://makinitmag.com/node/' + n,
    title: 'Record ' + n, artist: 'Artist ' + n, playUrl: 'https://cdn.makinitmag.com/' + n + '.mp3',
    ask: 'Not mixed yet — how are the drums?', ...over });
  const today = require('./server')._etDay();
  // A drop must be tagged into a series or its points never reach the $500 board.
  const serId = 'ser_daily_test';
  await dDb.run("INSERT INTO series (id, title, status, created_at) VALUES (?,?,'active',?)", [serId, 'Daily Test Series', Date.now()]);

  const dBad = await call('/api/ingest/daily', { day: today, songs: [song(1)] }, 'POST', { 'X-Ingest-Token': 'wrong' });
  ok('daily push rejects a bad token', dBad.status === 401, 'got ' + dBad.status);
  // THE SECRETS ARE SEPARATE, and this is the assertion that keeps them that way. The daily
  // route used to fall back to INGEST_TOKEN, which reads as convenient and quietly hands the
  // review-site integration's shared secret the power to create a room carrying sixteen
  // artists' contact details. If someone re-adds the fallback, this goes red.
  const dCross = await call('/api/ingest/daily', { day: today, songs: [song(1)] }, 'POST',
    { 'X-Ingest-Token': 'test-ingest-secret' });
  ok('the review-site token cannot push a DAY — different blast radius, different secret',
    dCross.status === 401, 'got ' + dCross.status);
  const dNoSongs = await call('/api/ingest/daily', { day: today, songs: [] }, 'POST', DTOK);
  ok('daily push needs songs', dNoSongs.status === 400, 'got ' + dNoSongs.status);
  const dTooMany = await call('/api/ingest/daily', { day: today, songs: Array.from({ length: 25 }, (_, i) => song(i)) }, 'POST', DTOK);
  ok('daily push caps the batch size', dTooMany.status === 400, 'got ' + dTooMany.status);
  const dFarDay = await call('/api/ingest/daily', { day: '2031-01-01', songs: [song(1)] }, 'POST', DTOK);
  ok('daily push refuses a day far from today (typo guard)', dFarDay.status === 400, 'got ' + dFarDay.status);

  // All-or-nothing: one bad row rejects the batch and creates NOTHING.
  const beforeBad = (await dDb.get("SELECT COUNT(*) AS c FROM sessions WHERE mode = 'async'", [])).c;
  const dNoTitle = await call('/api/ingest/daily', { day: today, songs: [song(1), { playUrl: 'https://x/y.mp3' }] }, 'POST', DTOK);
  ok('a row with no title rejects the whole batch', dNoTitle.status === 400 && dNoTitle.d.rejected[0].index === 1, JSON.stringify(dNoTitle.d));
  const dNoLink = await call('/api/ingest/daily', { day: today, songs: [song(1), { title: 'No link' }] }, 'POST', DTOK);
  ok('a row with no play link rejects the batch (unratable for 21h)', dNoLink.status === 400 && dNoLink.d.rejected[0].field === 'playUrl', JSON.stringify(dNoLink.d));
  const dJsUrl = await call('/api/ingest/daily', { day: today, songs: [song(1, { playUrl: 'javascript:alert(1)' })] }, 'POST', DTOK);
  ok('a non-http play link is refused', dJsUrl.status === 400, JSON.stringify(dJsUrl.d));
  const dDupRef = await call('/api/ingest/daily', { day: today, songs: [song(1), song(1)] }, 'POST', DTOK);
  ok('a duplicate ref inside one batch is refused', dDupRef.status === 400, JSON.stringify(dDupRef.d));
  const afterBad = (await dDb.get("SELECT COUNT(*) AS c FROM sessions WHERE mode = 'async'", [])).c;
  ok('a rejected batch creates ZERO rows', Number(beforeBad) === Number(afterBad), `${beforeBad} -> ${afterBad}`);

  // Happy path: a 5-record day (not 16).
  const dOk = await call('/api/ingest/daily', { day: today, seriesId: serId,
    songs: [song(1), song(2), song(3, { email: 'not-an-email' }), song(4), song(5)] }, 'POST', DTOK);
  ok('daily push creates the day', dOk.status === 200 && dOk.d.rounds === 5, JSON.stringify(dOk.d));
  const DROP = dOk.d.sessionId;
  const dSess = await dDb.get('SELECT * FROM sessions WHERE id = ?', [DROP]);
  ok('the day is mode=async, status=upcoming, async_state=scheduled',
    dSess.mode === 'async' && dSess.status === 'upcoming' && dSess.async_state === 'scheduled', JSON.stringify(dSess.mode + '/' + dSess.status + '/' + dSess.async_state));
  ok('the day is tagged into a series (else its points reach no board)', dSess.series_id === serId);
  ok('owner_uid is NULL so only a platform admin can touch it (the batch carries PII)', dSess.owner_uid == null);
  const dRounds = await dDb.all('SELECT * FROM rounds WHERE session_id = ? ORDER BY idx', [DROP]);
  ok('every record is pending until the clock opens the day', dRounds.every(r => r.status === 'pending'));
  ok('idx is assigned at INSERT, 1..n in batch order', dRounds.map(r => r.idx).join() === '1,2,3,4,5', dRounds.map(r => r.idx).join());
  ok('the play link is stored', dRounds[0].play_url === 'https://cdn.makinitmag.com/1.mp3');
  ok("the artist's ask is stored (it drives the comment prompt and the host reads it on air)",
    /how are the drums/.test(dRounds[0].artist_note || ''));
  ok('the Drupal ref and deep link ride along', dRounds[0].ingest_ref === 'node/1' && /makinitmag\.com\/node\/1/.test(dRounds[0].ingest_url || ''));
  ok('an unusable email nulls out without failing the row', dRounds[2].artist_email == null);
  ok('and is reported as a warning so Drupal can flag it', (dOk.d.warnings || []).some(w => w.index === 2 && w.field === 'email'), JSON.stringify(dOk.d.warnings));
  ok('the response reflects NO artist contact back out', !/@/.test(JSON.stringify(dOk.d)), JSON.stringify(dOk.d));

  // Re-push while cold: REPLACE, never duplicate.
  const dRe = await call('/api/ingest/daily', { day: today, seriesId: serId, songs: [song(9), song(8), song(7)] }, 'POST', DTOK);
  ok('a re-push of the same cold day replaces it', dRe.status === 200 && dRe.d.replaced === true && dRe.d.sessionId === DROP, JSON.stringify(dRe.d));
  const dRe2 = await dDb.all('SELECT idx, song_title FROM rounds WHERE session_id = ? ORDER BY idx', [DROP]);
  ok('the replaced day has 3 records, not 8', dRe2.length === 3, JSON.stringify(dRe2.map(r => r.song_title)));
  ok('and is renumbered 1..3', dRe2.map(r => r.idx).join() === '1,2,3');

  // The global staging slot belongs to the live show and must not be clobbered by a batch.
  const stagedAfter = await dDb.get("SELECT v FROM settings WHERE k = 'ingest_latest'", []);
  ok('a daily batch never touches the live show staging slot', stagedAfter && !/Record 9/.test(stagedAfter.v), (stagedAfter || {}).v);

  console.log('\n— A&R Daily: the drop is fenced off from every live-show control —');
  // Each of these would act on ONE arbitrary record of a day that has many open at once.
  const dAdmin = BOOTH;   // platform admin: owner_uid is NULL on a drop, so only admin can touch it
  const anyRound = dRe2[0] && (await dDb.get('SELECT id FROM rounds WHERE session_id = ? LIMIT 1', [DROP])).id;
  for (const [route, body] of [
    ['/api/admin/round/open', { sessionId: DROP, roundId: anyRound }],
    ['/api/admin/round/reopen', { sessionId: DROP, roundId: anyRound }],
    ['/api/admin/round/start-voting', { sessionId: DROP, roundId: anyRound }],
    ['/api/admin/round/unopen', { sessionId: DROP, roundId: anyRound }],
    ['/api/admin/round/close', { sessionId: DROP, roundId: anyRound }],
    ['/api/admin/round/extend', { sessionId: DROP, roundId: anyRound, seconds: 30 }],
    ['/api/admin/round/ratify', { sessionId: DROP, roundId: anyRound }],
  ]) {
    const r = await call(route, body, 'POST', dAdmin);
    ok(`${route} refuses a drop (409)`, r.status === 409, `got ${r.status} ${JSON.stringify(r.d)}`);
  }
  const dAdd = await call('/api/admin/round', { sessionId: DROP, song_title: 'Sneaky' }, 'POST', dAdmin);
  ok('a record cannot be hand-added to a drop', dAdd.status === 409, 'got ' + dAdd.status);
  const dAdv = await call('/api/admin/advance', { sessionId: DROP }, 'POST', dAdmin);
  ok('Advance does nothing on a drop (it runs on the clock)', dAdv.status === 400 && /clock/i.test(JSON.stringify(dAdv.d)), JSON.stringify(dAdv.d));

  // THE LANDMINE: a stray /review push must not delete a record out of a running day.
  await dDb.run("UPDATE sessions SET status = 'live', async_state = 'open', ingest_auto = 1 WHERE id = ?", [DROP]);
  await dDb.run("UPDATE rounds SET status = 'voting' WHERE session_id = ?", [DROP]);
  const beforeStray = (await dDb.get('SELECT COUNT(*) AS c FROM rounds WHERE session_id = ?', [DROP])).c;
  const stray = await call('/api/ingest/submission', { title: 'Stray Push', artist: 'Nobody' }, 'POST', DTOK);
  const afterStray = (await dDb.get('SELECT COUNT(*) AS c FROM rounds WHERE session_id = ?', [DROP])).c;
  ok('a stray /review push does not touch a running drop', Number(beforeStray) === Number(afterStray), `${beforeStray} -> ${afterStray}`);
  ok('and the drop is not counted as an auto-fill target', !/"autoRooms":[1-9]/.test(JSON.stringify(stray.d)) || Number(beforeStray) === Number(afterStray));

  // The overlay would publish one record's running tally on a PUBLIC surface — a direct
  // seal violation, since the room's average is what every A&R is still predicting.
  const ovr = await fetch(base + '/api/overlay/state?s=' + DROP).then(r => r.json());
  ok('the overlay shows no current record for a drop (seal)', ovr.current === null, JSON.stringify(ovr.current));
  ok('the overlay shows no result for a drop either', ovr.result === null, JSON.stringify(ovr.result));
  ok('the overlay still carries a leaderboard', Array.isArray(ovr.leaderboard));

  // A drop is status='live' all day; without the mode filter it would win the homepage's
  // ORDER BY and the weekly show would silently vanish.
  const homeD = await fetch(base + '/api/home').then(r => r.json());
  ok('the homepage carries the drop under its own key', homeD.daily && homeD.daily.id === DROP, JSON.stringify(homeD.daily));
  ok('the drop reports its ACTUAL record count, not 16', homeD.daily.songs === 3, JSON.stringify(homeD.daily));
  ok('the drop never shadows the live show on the homepage', !homeD.live || homeD.live.id !== DROP, JSON.stringify(homeD.live));

  // Re-push once votes exist must refuse: those points are somebody's score.
  await dDb.run("UPDATE sessions SET status = 'upcoming', async_state = 'scheduled' WHERE id = ?", [DROP]);
  const pRow = await dDb.get('SELECT id FROM participants LIMIT 1', []);
  await dDb.run('INSERT INTO votes (id, round_id, participant_id, taste, predict, locked_at) VALUES (?,?,?,?,?,?)',
    ['v_drop_test', anyRound, pRow.id, 7, 6.5, Date.now()]);
  const dHot = await call('/api/ingest/daily', { day: today, seriesId: serId, songs: [song(11)] }, 'POST', DTOK);
  ok('a re-push is refused once anyone has voted', dHot.status === 409, JSON.stringify(dHot.d));
  await dDb.run("DELETE FROM votes WHERE id = 'v_drop_test'", []);

  // The escape hatch: soft-delete the botched day, push it again.
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), DROP]);
  const dAgain = await call('/api/ingest/daily', { day: today, seriesId: serId, songs: [song(21), song(22), song(23), song(24)] }, 'POST', DTOK);
  ok('soft-deleting a botched day frees it for a fresh push', dAgain.status === 200 && dAgain.d.sessionId !== DROP, JSON.stringify(dAgain.d));
  ok('and a 4-record day is as valid as any other', dAgain.d.rounds === 4, JSON.stringify(dAgain.d));
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), dAgain.d.sessionId]);

  console.log('\n— A&R Daily: playing the day —');
  // A fresh 4-record day, opened the way the lifecycle cron will open it.
  const pOk = await call('/api/ingest/daily', { day: today, seriesId: serId,
    songs: [song(31), song(32), song(33), song(34)] }, 'POST', DTOK);
  const PDROP = pOk.d.sessionId;
  await dDb.run("UPDATE sessions SET status = 'live', async_state = 'open', window_opens_at = ? WHERE id = ?", [Date.now() - 1000, PDROP]);
  await dDb.run("UPDATE rounds SET status = 'voting' WHERE session_id = ?", [PDROP]);

  const dJoin = async (email, name) => {
    const rq = await call('/api/join/request', { sessionId: PDROP, email });
    const vr = await call('/api/join/verify', { sessionId: PDROP, email, code: rq.d.devCode, name });
    return vr.d.token;
  };
  const dt1 = await dJoin('daily1@test.com', 'Dana');
  const dt2 = await dJoin('daily2@test.com', 'Rio');
  const DH1 = { 'X-Player-Token': dt1 }, DH2 = { 'X-Player-Token': dt2 };

  const dState = (await call('/api/me/state', null, 'GET', DH1)).d;
  ok('the daily surface reports mode=async', dState.mode === 'async', JSON.stringify(dState.mode));
  ok('phase is queue with records left', dState.phase === 'queue', dState.phase);
  ok('the whole day ships at once (no single active round)', dState.queue.length === 4, JSON.stringify(dState.queue.length));
  ok('progress counts against the ACTUAL day size', dState.progress.total === 4 && dState.progress.voted === 0, JSON.stringify(dState.progress));
  ok('each record carries its play link and the artist ask',
    dState.queue.every(q => q.play_url && q.artist_note), JSON.stringify(dState.queue[0]));
  // THE SEAL: no room average, no split, and no PER-RECORD vote counts (a count across a
  // 21-hour window is a popularity signal, which is direction-adjacent).
  const dJson = JSON.stringify(dState);
  ok('the daily payload leaks no room_average', !/room_average/.test(dJson));
  ok('the daily payload leaks no split', !/split/.test(dJson));
  ok('the daily payload carries NO per-record vote counts', !dState.queue.some(q => 'votes' in q || 'count' in q), dJson.slice(0, 200));
  ok('tiers are server-resolved epochs, not client maths', Array.isArray(dState.async.tiers) && dState.async.tiers[0].points === 100);

  // Two A&Rs get different running orders; the same A&R gets the same one every time.
  const dState2 = (await call('/api/me/state', null, 'GET', DH2)).d;
  const walkA = dState.queue.map(q => q.id).join(), walkB = dState2.queue.map(q => q.id).join();
  const dStateAgain = (await call('/api/me/state', null, 'GET', DH1)).d;
  ok('the same A&R gets a stable order across requests (resume works)', dStateAgain.queue.map(q => q.id).join() === walkA);
  ok('a different A&R walks a different order', walkA !== walkB, walkA + ' vs ' + walkB);

  // The vote path: explicit roundId, scoped to the caller's own day.
  const noId = await call('/api/vote', { taste: 7, predict: 6.5 }, 'POST', DH1);
  ok('a daily vote with no roundId is refused', noId.status === 400, JSON.stringify(noId.d));
  const dailyForeign = await call('/api/vote', { roundId: anyRound, taste: 7, predict: 6.5 }, 'POST', DH1);
  ok("a vote for another day's record is refused", dailyForeign.status === 404, JSON.stringify(dailyForeign.d));
  const qIds = dState.queue.map(q => q.id);
  const vOne = await call('/api/vote', { roundId: qIds[0], taste: 7, predict: 6.5 }, 'POST', DH1);
  ok('a daily vote locks in', vOne.status === 200 && vOne.d.locked === true, JSON.stringify(vOne.d));
  ok('the vote response carries live progress', vOne.d.progress.voted === 1 && vOne.d.progress.total === 4, JSON.stringify(vOne.d.progress));
  ok('no bonus before the day is finished', vOne.d.bonus == null, JSON.stringify(vOne.d.bonus));
  const vDup = await call('/api/vote', { roundId: qIds[0], taste: 3, predict: 3 }, 'POST', DH1);
  ok('a record can only be rated once', vDup.status === 400, JSON.stringify(vDup.d));

  // Finish the day -> the completion bonus.
  for (const rid of qIds.slice(1)) await call('/api/vote', { roundId: rid, taste: 6, predict: 6.0 }, 'POST', DH1);
  const bonusRows = await dDb.all("SELECT * FROM point_events WHERE reason = 'async_complete' AND source_uid LIKE ?", [PDROP + ':%']);
  ok('finishing the day pays exactly ONE completion bonus', bonusRows.length === 1, JSON.stringify(bonusRows));
  ok('the bonus is tagged into the series so it reaches the $500 board', bonusRows[0].series_id === serId);
  ok('milestone is a literal 1, never the tier (two racers must collide, not both pay)', Number(bonusRows[0].milestone) === 1);
  const doneState = (await call('/api/me/state', null, 'GET', DH1)).d;
  ok('phase flips to done when the day is finished', doneState.phase === 'done', doneState.phase);
  ok('the earned bonus is reported back', doneState.progress.earned === Number(bonusRows[0].points), JSON.stringify(doneState.progress));

  // Idempotency: a sweep must not pay twice.
  const dSessRow = await dDb.get('SELECT * FROM sessions WHERE id = ?', [PDROP]);
  const srv = require('./server');
  const paidAgain = await dDb.all("SELECT COUNT(*) AS c FROM point_events WHERE reason = 'async_complete' AND source_uid LIKE ?", [PDROP + ':%']);
  ok('the bonus ledger still holds exactly one row after a re-read', Number(paidAgain[0].c) === 1);

  // A partial day earns nothing.
  await call('/api/vote', { roundId: qIds[0], taste: 5, predict: 5.0 }, 'POST', DH2);
  const partial = await dDb.all("SELECT * FROM point_events WHERE reason = 'async_complete' AND source_uid = ?",
    [PDROP + ':' + (await dDb.get('SELECT user_id FROM participants WHERE session_id = ? AND email = ?', [PDROP, 'daily2@test.com'])).user_id]);
  ok('an unfinished day pays no completion bonus', partial.length === 0, JSON.stringify(partial));

  // Once the window closes the day is SEALED — rated, but results are not out until noon.
  await dDb.run('UPDATE sessions SET window_closes_at = ? WHERE id = ?', [Date.now() - 1000, PDROP]);
  const sealed = (await call('/api/me/state', null, 'GET', DH2)).d;
  ok('after the close the day is sealed, not revealed', sealed.phase === 'sealed', sealed.phase);
  ok('a sealed day still leaks no room average', !/room_average/.test(JSON.stringify(sealed)));
  const dLateVote = await call('/api/vote', { roundId: qIds[1], taste: 4, predict: 4.0 }, 'POST', DH2);
  ok('the closed window refuses a late vote', dLateVote.status === 400 && /time is up/i.test(JSON.stringify(dLateVote.d)), JSON.stringify(dLateVote.d));
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), PDROP]);

  console.log('\n— A&R Daily: reporting a record that cannot be evaluated —');
  // A dead link across a 21-hour window with nobody watching is only visible if the A&Rs
  // say so, so filing a report has to be free. It marks the record HANDLED for that A&R:
  // if it still counted against them, reporting honestly would cost them their completion
  // bonus, which teaches everyone to stay quiet about dead links instead.
  const rOk = await call('/api/ingest/daily', { day: today, seriesId: serId,
    songs: [song(61), song(62), song(63), song(64), song(65)] }, 'POST', DTOK);
  const RDROP = rOk.d.sessionId;
  await dDb.run("UPDATE sessions SET status = 'live', async_state = 'open', window_opens_at = ?, window_closes_at = ? WHERE id = ?",
    [Date.now() - 1000, Date.now() + 3600000, RDROP]);
  await dDb.run("UPDATE rounds SET status = 'voting' WHERE session_id = ?", [RDROP]);
  const rJoin = async (email, name) => {
    const rq = await call('/api/join/request', { sessionId: RDROP, email });
    const vr = await call('/api/join/verify', { sessionId: RDROP, email, code: rq.d.devCode, name });
    return { 'X-Player-Token': vr.d.token };
  };
  const RH1 = await rJoin('rep1@test.com', 'Rae');
  const RH2 = await rJoin('rep2@test.com', 'Kit');
  const rQ = (await call('/api/me/state', null, 'GET', RH1)).d.queue.map(q => q.id);

  const rBad = await call('/api/report-round', { roundId: rQ[0], reason: 'because' }, 'POST', RH1);
  ok('a report with an unknown reason is refused', rBad.status === 400, JSON.stringify(rBad.d));
  const rForeign = await call('/api/report-round', { roundId: anyRound, reason: 'not_playable' }, 'POST', RH1);
  ok("a report on another day's record is refused", rForeign.status === 404, JSON.stringify(rForeign.d));

  const rep1 = await call('/api/report-round', { roundId: rQ[0], reason: 'not_playable' }, 'POST', RH1);
  ok('a report is accepted', rep1.status === 200 && rep1.d.ok === true, JSON.stringify(rep1.d));
  ok('the report count is people, not clicks', rep1.d.reports === 1, JSON.stringify(rep1.d));
  const rep1Again = await call('/api/report-round', { roundId: rQ[0], reason: 'other', body: 'wrong song' }, 'POST', RH1);
  ok('re-reporting the same record edits rather than adding', rep1Again.status === 200 && rep1Again.d.reports === 1, JSON.stringify(rep1Again.d));
  const rep2 = await call('/api/report-round', { roundId: rQ[0], reason: 'not_playable' }, 'POST', RH2);
  ok('a second A&R reporting the same record makes it two', rep2.d.reports === 2, JSON.stringify(rep2.d));

  const rState = (await call('/api/me/state', null, 'GET', RH1)).d;
  ok('the reporter sees their own report on the record',
    rState.queue.find(q => q.id === rQ[0]).myReport === 'other', JSON.stringify(rState.queue.find(q => q.id === rQ[0])));
  // THE SEAL AGAIN: their OWN report ships, but a per-record report COUNT is the same
  // popularity signal a vote count is, so it must never reach a player payload.
  ok('no other A&R report is visible on the record',
    rState.queue.every(q => !('reports' in q) && !('report_count' in q)), JSON.stringify(rState.queue[0]));
  ok('a report advances the day for the reporter',
    rState.progress.handled === 1 && rState.progress.voted === 0, JSON.stringify(rState.progress));

  // THE CAP. Five records => min(3, 5-1) = 3. Report three and the fourth is refused, so
  // there is no day size on which you can report your way to a completion bonus.
  ok('the cap and the remaining count reach the client',
    rState.progress.reportCap === 3 && rState.progress.reportsLeft === 2, JSON.stringify(rState.progress));
  await call('/api/report-round', { roundId: rQ[1], reason: 'not_playable' }, 'POST', RH1);
  await call('/api/report-round', { roundId: rQ[2], reason: 'not_playable' }, 'POST', RH1);
  const rOver = await call('/api/report-round', { roundId: rQ[3], reason: 'not_playable' }, 'POST', RH1);
  ok('the fourth report in a day is refused', rOver.status === 400 && /report 3/.test(JSON.stringify(rOver.d)), JSON.stringify(rOver.d));
  const rEditAtCap = await call('/api/report-round', { roundId: rQ[1], reason: 'other' }, 'POST', RH1);
  ok('editing an existing report still works at the cap', rEditAtCap.status === 200, JSON.stringify(rEditAtCap.d));
  const capped = (await call('/api/me/state', null, 'GET', RH1)).d;
  ok('reports never exceed the cap',
    capped.progress.reported === 3 && capped.progress.reportsLeft === 0, JSON.stringify(capped.progress));

  // Three reported + two rated = a finished day, and it pays. This is the whole point of
  // crediting a report: an honest reporter is not left one short forever.
  await call('/api/vote', { roundId: rQ[3], taste: 6, predict: 6.0 }, 'POST', RH1);
  const rLast = await call('/api/vote', { roundId: rQ[4], taste: 5, predict: 5.0 }, 'POST', RH1);
  ok('the day reads as finished with reports counted',
    rLast.d.progress.handled === 5 && rLast.d.progress.total === 5, JSON.stringify(rLast.d.progress));
  ok('a day finished partly by reporting still pays the completion bonus', rLast.d.bonus > 0, JSON.stringify(rLast.d.bonus));
  const rBonusRows = await dDb.all("SELECT * FROM point_events WHERE reason = 'async_complete' AND source_uid LIKE ?", [RDROP + ':%']);
  ok('and it pays exactly once', rBonusRows.length === 1, JSON.stringify(rBonusRows));

  // A report can itself be the last act of the day, so /api/report-round evaluates the
  // bonus too rather than waiting for a vote that is never going to come.
  for (const rid of rQ.slice(0, 4)) await call('/api/vote', { roundId: rid, taste: 4, predict: 4.0 }, 'POST', RH2);
  const rFinish = await call('/api/report-round', { roundId: rQ[4], reason: 'not_playable' }, 'POST', RH2);
  ok('finishing the day ON a report pays the bonus from the report route', rFinish.d.bonus > 0, JSON.stringify(rFinish.d));
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), RDROP]);

  console.log('\n— A&R Daily: the lifecycle runs on the clock —');
  // Explicit window overrides so real-time votes land inside it — /api/vote checks the
  // wall clock, while the lifecycle takes an injected `at`. (The overrides exist for exactly
  // this: a test must not have to wait for noon.)
  const lOpens = Date.now() - 1000, lCloses = Date.now() + 3600000;
  const lOk = await call('/api/ingest/daily', { day: today, seriesId: serId,
    opensAt: lOpens, closesAt: lCloses, resultsAt: lCloses + 10800000,
    songs: [song(41, { email: 'artist41@test.com' }), song(42, { email: 'artist42@test.com' }), song(43)] }, 'POST', DTOK);
  const LDROP = lOk.d.sessionId;
  const tick = (at) => call('/api/admin/daily/tick', at != null ? { at } : {}, 'POST', BOOTH);
  const lSess = () => dDb.get('SELECT * FROM sessions WHERE id = ?', [LDROP]);
  const lRounds = () => dDb.all('SELECT status FROM rounds WHERE session_id = ?', [LDROP]);

  const tEarly = await tick(lOpens - 86400000);
  ok('a tick before the open does nothing', tEarly.d.opened === 0, JSON.stringify(tEarly.d));
  ok('the day is still scheduled', (await lSess()).async_state === 'scheduled');

  const opensAt = Number((await lSess()).window_opens_at);
  const tOpen = await tick(opensAt + 1000);
  ok('the open tick opens the day', tOpen.d.opened === 1, JSON.stringify(tOpen.d));
  const dOpened = await lSess();
  ok('the day flips to live/open', dOpened.status === 'live' && dOpened.async_state === 'open', dOpened.status + '/' + dOpened.async_state);
  ok('EVERY record opens at once — there is no single active round', (await lRounds()).every(r => r.status === 'voting'));
  const tOpenAgain = await tick(opensAt + 2000);
  ok('a second open tick is a no-op (the claim is the lock)', tOpenAgain.d.opened === 0, JSON.stringify(tOpenAgain.d));

  // Someone plays the whole day, so the tally has real votes to score.
  const lRq = await call('/api/join/request', { sessionId: LDROP, email: 'life@test.com' });
  const lVer = await call('/api/join/verify', { sessionId: LDROP, email: 'life@test.com', code: lRq.d.devCode, name: 'Lex' });
  const LH = { 'X-Player-Token': lVer.d.token };
  const lQ = (await call('/api/me/state', null, 'GET', LH)).d.queue;
  for (const q of lQ) await call('/api/vote', { roundId: q.id, taste: 7, predict: 7.0 }, 'POST', LH);

  const closesAt = Number((await lSess()).window_closes_at);
  const tClose = await tick(closesAt + 1000);
  ok('the close tick closes and tallies the whole day', tClose.d.closed === 1 && tClose.d.ratified === 3, JSON.stringify(tClose.d));
  ok('every record is ratified', (await lRounds()).every(r => r.status === 'ratified'));
  ok('the day reaches async_state=ratified', (await lSess()).async_state === 'ratified');
  const scored = await dDb.all('SELECT points, room_average FROM votes v JOIN rounds r ON r.id = v.round_id WHERE r.session_id = ?', [LDROP]);
  ok('the tally scored every vote', scored.length === 3 && scored.every(v => v.points != null), JSON.stringify(scored));

  const tCloseAgain = await tick(closesAt + 2000);
  ok('a second close tick does not re-tally (double-bumped points would be permanent)',
    tCloseAgain.d.ratified === 0 && tCloseAgain.d.closed === 0, JSON.stringify(tCloseAgain.d));
  const lifetimeAfter = await dDb.get('SELECT lifetime_points FROM users WHERE email = ?', ['life@test.com']);
  const tCloseThird = await tick(closesAt + 3000);
  const lifetimeAfter2 = await dDb.get('SELECT lifetime_points FROM users WHERE email = ?', ['life@test.com']);
  ok('and lifetime points do not move on a repeat tick',
    lifetimeAfter.lifetime_points === lifetimeAfter2.lifetime_points, `${lifetimeAfter.lifetime_points} -> ${lifetimeAfter2.lifetime_points}`);

  console.log('\n— A&R Daily: the noon publish and the two independent emails —');
  // Publish is deliberately the LAST transition and it happens at NOON, not at the 9AM
  // close: status='completed' is what makes playerState's recap branch fire, so flipping
  // it three hours early would reveal every room average while the day is still sealed.
  const tBeforeNoon = await tick(closesAt + 4000);
  ok('a tick before results_at does not publish', tBeforeNoon.d.published === 0, JSON.stringify(tBeforeNoon.d));
  ok('the day is still sealed, not revealed', (await lSess()).async_state === 'ratified');
  // (The lifecycle takes an injected `at`; playerState reads the real wall clock, so with a
  // window that has not yet closed in real time this A&R reads as 'done' rather than
  // 'sealed'. The assertion that matters either way is that nothing has been revealed.)
  const sealedState = (await call('/api/me/state', null, 'GET', LH)).d;
  ok('and the player has NOT been shown results before the publish',
    sealedState.phase !== 'recap' && !sealedState.recap
    && !/room_average/.test(JSON.stringify(sealedState)), sealedState.phase);

  // Two more A&Rs with accounts but NO participation in this day: the audience is
  // unconditional, only the personalised block is conditional.
  const uidOf = async (email) => (await dDb.get('SELECT uid FROM users WHERE email = ?', [email])).uid;
  const mkUser = async (email, name) => {
    const rq = await call('/api/auth/request', { email });
    await call('/api/auth/verify', { email, code: rq.d.devCode, name });
    return (await dDb.get('SELECT uid FROM users WHERE email = ?', [email])).uid;
  };
  const uidIdle = await mkUser('digest-idle@test.com', 'Idle');
  const uidOut = await mkUser('digest-out@test.com', 'OptedOut');
  const uidNever = await mkUser('digest-never@test.com', 'NeverAsked');
  await dDb.run('UPDATE users SET email_opt_out = 1 WHERE uid = ?', [uidOut]);
  // digest_daily's catalog default is OFF and STAYS off (028): flipping it turns an opt-in
  // list into a daily send to the whole base, which is a deliverability decision and belongs
  // in its own one-line commit after a week on a manual list. So the audience is opt-in, and
  // uidNever — who was never asked — proves it by getting nothing.
  const optIn = async (uid) => dDb.run(
    "INSERT INTO notify_prefs (uid, topic, channel, enabled, source, updated_at) VALUES (?, 'digest_daily', 'email', 1, 'test', ?)"
    + ' ON CONFLICT (uid, topic, channel) DO UPDATE SET enabled = 1', [uid, Date.now()]);
  await optIn(await uidOf('life@test.com'));
  await optIn(uidIdle);
  await optIn(uidOut);

  const resultsAt = Number((await lSess()).results_at);
  const tPub = await tick(resultsAt + 1000);
  ok('the publish tick publishes the day', tPub.d.published === 1, JSON.stringify(tPub.d));
  const pubbed = await lSess();
  ok('the day flips to completed/published with a published_at',
    pubbed.status === 'completed' && pubbed.async_state === 'published' && pubbed.published_at > 0,
    pubbed.status + '/' + pubbed.async_state);

  // 7a — the A&R digest. This is notifyAudience()'s FIRST production caller, and the
  // assertion that its {sql, params} fragment really does compose into an INSERT...SELECT.
  const bcRow = await dDb.get("SELECT * FROM notify_broadcasts WHERE kind = 'digest_daily' AND ref_id = ?", [LDROP]);
  ok('publishing queues exactly one digest broadcast for the day', !!bcRow, JSON.stringify(bcRow));
  const rcpts = await dDb.all('SELECT * FROM notify_recipients WHERE broadcast_id = ?', [bcRow.id]);
  const uidPlayed = await uidOf('life@test.com');
  ok('the A&R who played the day is on the list', rcpts.some(r => r.uid === uidPlayed), JSON.stringify(rcpts.length));
  ok('so is an A&R who did NOT play — the audience is unconditional, only the block is not',
    rcpts.some(r => r.uid === uidIdle), JSON.stringify(rcpts.length));
  ok('email_opt_out is the global kill switch and outranks a topic opt-in',
    !rcpts.some(r => r.uid === uidOut), JSON.stringify(rcpts.length));
  ok('and digest_daily stays OPT-IN: someone who never chose gets nothing',
    !rcpts.some(r => r.uid === uidNever), JSON.stringify(rcpts.length));
  const rcptCount = rcpts.length;
  const tPubAgain = await tick(resultsAt + 2000);
  ok('a second publish tick does not publish again (the claim is the lock)', tPubAgain.d.published === 0, JSON.stringify(tPubAgain.d));
  const rcpts2 = await dDb.all('SELECT * FROM notify_recipients WHERE broadcast_id = ?', [bcRow.id]);
  ok('and it does not duplicate a single recipient row', rcpts2.length === rcptCount, rcptCount + ' -> ' + rcpts2.length);
  const bcCount = await dDb.get("SELECT COUNT(*) AS c FROM notify_broadcasts WHERE kind = 'digest_daily' AND ref_id = ?", [LDROP]);
  ok('nor a second broadcast', Number(bcCount.c) === 1, JSON.stringify(bcCount));

  // The personalised block: exactly one row per record they rated, carrying every column
  // the scorecard prints. Absent — not empty — for someone who did not play.
  const partPlayed = await dDb.get('SELECT * FROM participants WHERE session_id = ? AND email = ?', [LDROP, 'life@test.com']);
  const detail = await srv._buildRecap(partPlayed, { detail: true });
  ok('the digest detail has one row per record they rated', detail.rounds.length === 3, JSON.stringify(detail.rounds.length));
  ok('and each row carries rating, prediction, average, deviation and points',
    detail.rounds.every(r => r.taste != null && r.predict != null && r.room_average != null && r.err != null && r.points != null),
    JSON.stringify(detail.rounds[0]));
  ok('the emoji/colour key is the STORED votes.tier, not a recomputation',
    detail.rounds.every(r => ['bullseye', 'sharp', 'close', 'off', 'wayoff'].includes(r.tier)),
    JSON.stringify(detail.rounds.map(r => r.tier)));
  ok('the default recap is unchanged for its existing caller (no detail rows)',
    (await srv._buildRecap(partPlayed)).rounds === undefined);

  // 7b — the artist email is a SEPARATE product on a separate queue. Artists are not
  // users: they exist only as rounds.artist_email, so they can never be in
  // notify_recipients (PK is (broadcast_id, uid, channel)) and have no manage link.
  // The hold is measured from published_at — when the results actually went out — rather
  // than from the scheduled results_at, so a cron that runs late still leaves the operator a
  // full hour of rejection window instead of silently having none.
  await dDb.run("DELETE FROM artist_notices WHERE session_id = ?", [LDROP]);
  const publishedAt = Number((await lSess()).published_at);
  await tick(publishedAt + 1000);
  const notices = await dDb.all('SELECT * FROM artist_notices WHERE session_id = ?', [LDROP]);
  ok('the artist notices are HELD for an hour after publish — 029 has no unsend, and a cron'
    + ' has no wrap-up moment where the host sees the comment count', notices.length === 0, JSON.stringify(notices.length));
  await tick(publishedAt + 61 * 60000);
  const notices2 = await dDb.all('SELECT * FROM artist_notices WHERE session_id = ?', [LDROP]);
  ok('past the hold, the artist queue fills from the same helper the host button uses',
    notices2.length > 0, JSON.stringify(notices2.length));
  ok('the artist queue is keyed on the round, never on a uid',
    notices2.every(n => n.round_id && !('uid' in n)), JSON.stringify(Object.keys(notices2[0] || {})));

  // An A&R who is ALSO an artist on the day correctly gets BOTH. Assert it, so nobody
  // later "fixes" it into a dedupe: they are two different mails about two different things.
  const bothEmail = (await dDb.get('SELECT artist_email FROM rounds WHERE session_id = ? AND artist_email IS NOT NULL LIMIT 1', [LDROP]) || {}).artist_email;
  if (bothEmail) {
    const bothUid = await mkUser(bothEmail, 'Both Hats');
    await optIn(bothUid);
    await srv._enqueueDailyDigest(await lSess());
    const gotBroadcast = await dDb.get('SELECT 1 AS x FROM notify_recipients WHERE broadcast_id = ? AND uid = ?', [bcRow.id, bothUid]);
    const gotNotice = await dDb.get('SELECT 1 AS x FROM artist_notices WHERE session_id = ? AND dest = ?', [LDROP, bothEmail]);
    ok('someone who is both an A&R and an artist gets BOTH mails, deliberately',
      !!gotBroadcast && !!gotNotice, `broadcast=${!!gotBroadcast} notice=${!!gotNotice}`);
  }

  // And the day now reads as a recap for the player, with the scorecard attached.
  const recapState = (await call('/api/me/state', null, 'GET', LH)).d;
  ok('after the publish the player sees the recap', recapState.phase === 'recap', recapState.phase);
  ok('the scorecard carries the round-by-round breakdown',
    recapState.recap && recapState.recap.rounds && recapState.recap.rounds.length === 3, JSON.stringify(recapState.recap && recapState.recap.rounds && recapState.recap.rounds.length));
  ok('and NOW the room average is allowed to exist, because the day is published',
    recapState.recap.rounds.every(r => r.room_average != null), JSON.stringify(recapState.recap.rounds));

  // The cron door itself: locked when CRON_SECRET is unset (the suite runs without it).
  const cronNo = await fetch(base + '/api/cron/daily').then(r => ({ s: r.status }));
  ok('the daily cron is 503 until CRON_SECRET is configured', cronNo.s === 503, 'got ' + cronNo.s);
  const tickAnon = await call('/api/admin/daily/tick', {}, 'POST', {});
  ok('the manual tick is platform-admin only', tickAnon.status === 401, 'got ' + tickAnon.status);
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), LDROP]);

  console.log('\n— A&R Daily: the console —');
  // The console opens on the day, so this one status call has to carry all of it.
  const cOk = await call('/api/ingest/daily', { day: srv._etNextDay(today), seriesId: serId,
    songs: [song(71, { email: 'a71@test.com', phone: '+15551230071' }), song(72), song(73), song(74)] }, 'POST', DTOK);
  const CDROP = cOk.d.sessionId;
  await dDb.run("UPDATE sessions SET status = 'live', async_state = 'open', window_opens_at = ?, window_closes_at = ? WHERE id = ?",
    [Date.now() - 1000, Date.now() + 3600000, CDROP]);
  await dDb.run("UPDATE rounds SET status = 'voting' WHERE session_id = ?", [CDROP]);

  const dStatAnon = await call('/api/admin/daily/status?day=' + srv._etNextDay(today), null, 'GET', {});
  ok('the daily status is platform-admin only — a drop spans no host and carries artist PII',
    dStatAnon.status === 403 || dStatAnon.status === 401, 'got ' + dStatAnon.status);
  const dStat = (await call('/api/admin/daily/status?day=' + srv._etNextDay(today), null, 'GET', BOOTH)).d;
  ok('the status resolves the day', dStat.drop && dStat.drop.day === srv._etNextDay(today), JSON.stringify(dStat.drop && dStat.drop.day));
  ok('it carries every record with its play link', dStat.rounds.length === 4 && dStat.rounds.every(r => r.play_url), JSON.stringify(dStat.rounds.length));
  ok('and the resolved series, because an untagged day never reaches the $500 board',
    dStat.drop.series_id === serId, JSON.stringify(dStat.drop.series_id));
  ok('the four queue tallies arrive in the same {sent,failed,pending} shape the notices panel uses',
    ['digest', 'artistEmail', 'artistSms'].every(k => dStat.queues[k] && 'sent' in dStat.queues[k] && 'failed' in dStat.queues[k] && 'pending' in dStat.queues[k]),
    JSON.stringify(dStat.queues));
  ok('a status call never leaks an artist address — only whether one is on file',
    !/a71@test\.com/.test(JSON.stringify(dStat)) && dStat.rounds.some(r => r.hasEmail === true), JSON.stringify(dStat.rounds[0]));

  // FIXING A BROKEN PLAY LINK MID-WINDOW — the most operationally important thing here.
  // A dead link at 12:05PM is a dead record for 21 hours and cannot round-trip through a CMS.
  const dcRounds = (await call('/api/admin/rounds?sessionId=' + CDROP, null, 'GET', BOOTH)).d.rounds;
  ok('/api/admin/rounds carries the repair kit: the link, the ask and the Drupal deep link',
    dcRounds.every(r => 'play_url' in r && 'artist_note' in r && 'ingest_url' in r), JSON.stringify(Object.keys(dcRounds[0])));
  ok('and the per-record report count, which is people not clicks',
    dcRounds.every(r => 'reports' in r), JSON.stringify(Object.keys(dcRounds[0])));
  const dcR = dcRounds[0];
  const dcBadUrl = await call('/api/admin/round/edit',
    { sessionId: CDROP, roundId: dcR.id, song_title: dcR.song_title, play_url: 'javascript:alert(1)' }, 'POST', BOOTH);
  ok('a non-http play link is refused at the console too', dcBadUrl.status === 400, JSON.stringify(dcBadUrl.d));
  const dcFixed = await call('/api/admin/round/edit',
    { sessionId: CDROP, roundId: dcR.id, song_title: dcR.song_title, play_url: 'https://cdn.makinitmag.com/dcFixed.mp3' }, 'POST', BOOTH);
  ok('a broken link can be dcFixed while the window is open', dcFixed.status === 200, JSON.stringify(dcFixed.d));
  const afterFix = await dDb.get('SELECT play_url, room_average, status FROM rounds WHERE id = ?', [dcR.id]);
  ok('and the fix reaches the record', afterFix.play_url === 'https://cdn.makinitmag.com/dcFixed.mp3', afterFix.play_url);
  // The descriptive-only discipline: this route has never been able to write a score, and
  // adding play_url must not have changed that.
  const tryScore = await call('/api/admin/round/edit',
    { sessionId: CDROP, roundId: dcR.id, song_title: dcR.song_title, room_average: 9, status: 'ratified', points: 999 }, 'POST', BOOTH);
  const afterScore = await dDb.get('SELECT room_average, status FROM rounds WHERE id = ?', [dcR.id]);
  ok('round/edit still cannot write a score or a status — descriptive fields only',
    afterScore.room_average === afterFix.room_average && afterScore.status === afterFix.status,
    JSON.stringify(afterScore) + ' vs ' + JSON.stringify(afterFix));
  // And a player sees it, because that is the entire point of fixing it locally.
  const fixRq = await call('/api/join/request', { sessionId: CDROP, email: 'fixwatch@test.com' });
  const fixVer = await call('/api/join/verify', { sessionId: CDROP, email: 'fixwatch@test.com', code: fixRq.d.devCode, name: 'Watcher' });
  const fixQ = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': fixVer.d.token })).d.queue;
  ok('every A&R sees the repaired link on their next refresh',
    fixQ.some(q => q.play_url === 'https://cdn.makinitmag.com/dcFixed.mp3'), JSON.stringify(fixQ.map(q => q.play_url)));

  // Deleting a bad record works on an async VOTING round too, and closes the idx gap so the
  // numbering stays coherent for everyone mid-walk.
  const dcDelMe = dcRounds[3];
  const delOk = await call('/api/admin/round/delete', { sessionId: CDROP, roundId: dcDelMe.id }, 'POST', BOOTH);
  ok('a zero-vote record can be pulled out of a running day', delOk.status === 200, JSON.stringify(delOk.d));
  const dcLeftIdx = (await dDb.all('SELECT idx FROM rounds WHERE session_id = ? ORDER BY idx ASC', [CDROP])).map(r => r.idx);
  ok('and the numbering closes up behind it', JSON.stringify(dcLeftIdx) === JSON.stringify([1, 2, 3]), JSON.stringify(dcLeftIdx));
  await call('/api/vote', { roundId: dcRounds[1].id, taste: 6, predict: 6.0 }, 'POST', { 'X-Player-Token': fixVer.d.token });
  const delVoted = await call('/api/admin/round/delete', { sessionId: CDROP, roundId: dcRounds[1].id }, 'POST', BOOTH);
  ok('a record somebody has already evaluated is refused — those points are a real score',
    delVoted.status >= 400, JSON.stringify(delVoted.d));

  // The manual publish door, for a cron that never fired.
  const pubEarly = await call('/api/admin/daily/publish', { day: srv._etNextDay(today) }, 'POST', BOOTH);
  ok('publishing a day that has not tallied is refused', pubEarly.status === 409, JSON.stringify(pubEarly.d));
  const pubAnon = await call('/api/admin/daily/publish', { day: srv._etNextDay(today) }, 'POST', {});
  ok('and the publish door is platform-admin only', pubAnon.status === 403 || pubAnon.status === 401, 'got ' + pubAnon.status);
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), CDROP]);

  // Staging a day BY HAND. Same builder as Drupal's push, behind the admin login instead of
  // a shared secret — because a missing drop is an incident, and "wait for someone else's
  // CMS to come back" is not an answer at 11:50 AM.
  const handDay = srv._etNextDay(srv._etNextDay(today));
  const handAnon = await call('/api/admin/daily/drop', { day: handDay, songs: [song(81)] }, 'POST', {});
  ok('staging a day by hand is platform-admin only', handAnon.status === 403 || handAnon.status === 401, 'got ' + handAnon.status);
  const handBad = await call('/api/admin/daily/drop',
    { day: handDay, seriesId: serId, songs: [song(81), { title: 'No link' }] }, 'POST', BOOTH);
  ok('and it runs the SAME all-or-nothing validation as the push',
    handBad.status === 400 && handBad.d.rejected[0].field === 'playUrl', JSON.stringify(handBad.d));
  const handOk = await call('/api/admin/daily/drop',
    { day: handDay, seriesId: serId, songs: [song(81), song(82), song(83)] }, 'POST', BOOTH);
  ok('a platform admin can stage a day with no ingest token in sight',
    handOk.status === 200 && handOk.d.rounds === 3, JSON.stringify(handOk.d));
  const handSess = await dDb.get("SELECT * FROM sessions WHERE drop_day = ? AND deleted_at IS NULL", [handDay]);
  ok('the hand-staged day is a real async drop, tagged into the series',
    handSess.mode === 'async' && handSess.series_id === serId && handSess.async_state === 'scheduled',
    JSON.stringify({ mode: handSess.mode, series: handSess.series_id, state: handSess.async_state }));
  ok('and it echoes no artist contact back out',
    !/@/.test(JSON.stringify(handOk.d)), JSON.stringify(handOk.d));
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), handSess.id]);

  const noDrop = (await call('/api/admin/daily/status?day=2029-01-01', null, 'GET', BOOTH)).d;
  ok('a day with no drop reads as an incident, not an empty state',
    noDrop.drop === null && /nothing/i.test(noDrop.message || ''), JSON.stringify(noDrop));

  console.log('\n— A&R Daily: building a drop by hand, a record at a time —');
  // /daily/drop is a BATCH — right for an approved push from Drupal, wrong for a person
  // typing records in one by one. This is the queue-builder path, and it shares the batch's
  // validation so a hand-built day cannot end up in a shape the pushed one could not.
  // today+2: within the builder's +/-3 day typo guard, and freed again by the hand-staged
  // block above (uniq_session_drop_day is partial on deleted_at, so a soft delete releases
  // the day).
  const qbDay = srv._etNextDay(srv._etNextDay(today));
  const qbAnon = await call('/api/admin/daily/round', { day: qbDay, title: 'X', playUrl: 'https://a.co/1' }, 'POST', {});
  ok('adding a record by hand is platform-admin only', qbAnon.status === 403 || qbAnon.status === 401, 'got ' + qbAnon.status);

  const qbNoTitle = await call('/api/admin/daily/round', { day: qbDay, playUrl: 'https://a.co/1' }, 'POST', BOOTH);
  ok('a record with no title is refused', qbNoTitle.status === 400, JSON.stringify(qbNoTitle.d));
  const qbNoLink = await call('/api/admin/daily/round', { day: qbDay, title: 'No link' }, 'POST', BOOTH);
  ok('a record with no play link is refused — it would be dead for the whole window',
    qbNoLink.status === 400, JSON.stringify(qbNoLink.d));
  const qbBadLink = await call('/api/admin/daily/round', { day: qbDay, title: 'Bad', playUrl: 'javascript:alert(1)' }, 'POST', BOOTH);
  ok('and a non-http link is refused here too', qbBadLink.status === 400, JSON.stringify(qbBadLink.d));

  // The FIRST record creates the day around it — there is no separate "create the day" step.
  const qb1 = await call('/api/admin/daily/round',
    { day: qbDay, seriesId: serId, title: 'Neon Skyline', artist: 'The Verge',
      playUrl: 'https://open.spotify.com/track/1', ask: 'Not mixed yet.', email: 'verge@test.com' }, 'POST', BOOTH);
  ok('the first record creates the day around it', qb1.status === 200 && qb1.d.created === true, JSON.stringify(qb1.d));
  const qbSess = await dDb.get('SELECT * FROM sessions WHERE drop_day = ? AND deleted_at IS NULL', [qbDay]);
  ok('and it is a real async drop, scheduled and tagged into the series',
    qbSess.mode === 'async' && qbSess.async_state === 'scheduled' && qbSess.series_id === serId,
    JSON.stringify({ m: qbSess.mode, st: qbSess.async_state, ser: qbSess.series_id }));

  const qb2 = await call('/api/admin/daily/round',
    { day: qbDay, title: 'Long Way Down', artist: 'Sable', playUrl: 'https://open.spotify.com/track/2' }, 'POST', BOOTH);
  const qb3 = await call('/api/admin/daily/round',
    { day: qbDay, title: 'Basement Tape', artist: 'Wax Figure', playUrl: 'https://open.spotify.com/track/3' }, 'POST', BOOTH);
  ok('each further record appends to the same day', qb3.status === 200 && qb3.d.created === false && qb3.d.rounds === 3, JSON.stringify(qb3.d));
  ok('and they are numbered in the order they were typed', qb1.d.rounds === 1 && qb2.d.idx === 2 && qb3.d.idx === 3,
    JSON.stringify([qb1.d.rounds, qb2.d.idx, qb3.d.idx]));

  // Pulling one out while the day is still being built closes the numbering behind it, so
  // the operator never sees "Record 1, 2, 4" — and the next add cannot reuse a number.
  const qbDel = await call('/api/admin/round/delete', { sessionId: qbSess.id, roundId: qb2.d.roundId }, 'POST', BOOTH);
  ok('a staged record can be pulled back out', qbDel.status === 200, JSON.stringify(qbDel.d));
  const qbIdx = (await dDb.all('SELECT idx FROM rounds WHERE session_id = ? ORDER BY idx', [qbSess.id])).map(r => r.idx);
  ok('and the numbering closes up behind it', JSON.stringify(qbIdx) === JSON.stringify([1, 2]), JSON.stringify(qbIdx));
  const qb4 = await call('/api/admin/daily/round',
    { day: qbDay, title: 'Cold Open', playUrl: 'https://open.spotify.com/track/4' }, 'POST', BOOTH);
  ok('the next record does not reuse a number already on the day', qb4.d.idx === 3, JSON.stringify(qb4.d));

  // The console reads the day being built separately from the day that is RUNNING — they
  // are different jobs on the same screen.
  const qbStat = (await call('/api/admin/daily/status', null, 'GET', BOOTH)).d;
  ok('the status carries the day under construction on its own key',
    qbStat.building && qbStat.building.day === qbDay && qbStat.building.rounds.length === 3,
    JSON.stringify(qbStat.building && { d: qbStat.building.day, n: qbStat.building.rounds.length }));
  ok('and it says whether each staged record can reach its artist, never the address itself',
    qbStat.building.rounds.every(r => 'hasEmail' in r) && !/verge@test\.com/.test(JSON.stringify(qbStat.building)),
    JSON.stringify(qbStat.building.rounds[0]));

  // ONCE THE DAY OPENS, ADDING IS REFUSED. The completion bonus counts against a live
  // denominator, so a record added mid-window silently un-finishes everyone who already
  // completed the day — including people already paid.
  await dDb.run("UPDATE sessions SET async_state = 'open', status = 'live' WHERE id = ?", [qbSess.id]);
  const qbLate = await call('/api/admin/daily/round',
    { day: qbDay, title: 'Late Add', playUrl: 'https://open.spotify.com/track/9' }, 'POST', BOOTH);
  ok('adding to a day that is already open is refused', qbLate.status === 409, JSON.stringify(qbLate.d));
  ok('and the refusal says why, in terms of the people it would affect',
    /un-finish/i.test((qbLate.d && qbLate.d.error) || ''), JSON.stringify(qbLate.d));
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), qbSess.id]);

  console.log('\n— the front door: what the pitch is allowed to know —');
  // /api/home is the ONE endpoint worth putting behind a CDN, so everything the fdLanding
  // page needs has to be anonymous and identical for every viewer. Whether someone is a
  // member is decided client-side off their own token; nothing per-viewer lives here.
  const fdHome = (await call('/api/home', null, 'GET')).d;
  ok('the front door gets its data with no auth at all',
    'yesterday' in fdHome && 'teamCount' in fdHome && 'tryIt' in fdHome, JSON.stringify(Object.keys(fdHome)));
  ok('and it never carries a viewer-specific field',
    !('me' in fdHome) && !('myVote' in fdHome) && !('progress' in fdHome), JSON.stringify(Object.keys(fdHome)));
  const fdJson = JSON.stringify(fdHome);
  ok('the most public surface there is leaks no email', !/@/.test(fdJson.replace(/makinitmag\.com|@Makinit4indies/g, '')), fdJson.slice(0, 200));

  // TRY IT runs on records that ALREADY RAN. Ratified only — room_average does not exist
  // before ratify, which is exactly what the seal guarantees, so this can never expose a
  // live day's direction.
  ok('try-it offers only records that already have a settled average',
    (fdHome.tryIt || []).every(t => typeof t.avg === 'number' && t.voters >= 5), JSON.stringify(fdHome.tryIt));
  const fdOpenRound = await dDb.get("SELECT song_title FROM rounds WHERE status IN ('voting','listening','closed') LIMIT 1");
  if (fdOpenRound) {
    ok('and never a record that is still open for evaluation',
      !(fdHome.tryIt || []).some(t => t.title === fdOpenRound.song_title), JSON.stringify(fdHome.tryIt));
  }

  // PROOF is YESTERDAY's board, not the cumulative series board: 784 says a stranger could
  // have done that, 12,480 says they are three months behind.
  if (fdHome.yesterday) {
    ok('yesterday\'s board carries display name and points, never contact details',
      fdHome.yesterday.board.every(r => r.name && typeof r.points === 'number' && !('email' in r) && !('phone' in r)),
      JSON.stringify(fdHome.yesterday.board[0]));
    ok('and nobody who scored nothing pads it out',
      fdHome.yesterday.board.every(r => r.points > 0), JSON.stringify(fdHome.yesterday.board.map(r => r.points)));
  }

  // The front door itself, and the routes it must not have broken.
  const fdLanding = await fetch(base + '/').then(r => r.text());
  ok('/ serves the A&R Team front door', /The A&amp;R Team|The A&R Team/.test(fdLanding) && /Try one right now/i.test(fdLanding));
  ok('and it is the pitch by default — the member view is opt-in on a token',
    /id="memberView"[^>]*class="[^"]*hide|class="member hide"/.test(fdLanding), 'member view not hidden by default');
  const fdWithS = await fetch(base + '/?s=' + SID).then(r => r.text());
  ok('/?s= STILL serves the play page — every printed QR and share link depends on it',
    /screen-vote|id="screen-email"/.test(fdWithS));

  console.log('\n— eye for talent: scouting points —');
  // The curve is the dial that decides whether scouting is a real second lane or a garnish.
  // Context for the numbers: a month of A&R Daily is ~15,000 (6-record days) to ~45,000
  // (full 16-record days, sharp) points, so five 7.0 records ≈ 2,500 ≈ 6-15% of a month.
  ok('a record at the floor earns nothing', srv._scoutPointsFor(5.0) === 0);
  ok('a weak record earns nothing (zero, never negative — or nobody refers anyone)', srv._scoutPointsFor(3.0) === 0);
  ok('scouting scales with the score, not with volume', srv._scoutPointsFor(7.0) === 500 && srv._scoutPointsFor(6.0) === 250,
    srv._scoutPointsFor(7.0) + '/' + srv._scoutPointsFor(6.0));
  ok('a great find pays a lot more than a mediocre one', srv._scoutPointsFor(8.5) > 3 * srv._scoutPointsFor(5.5));

  // End-to-end: a scout who is linked earns when their record tallies well.
  const scoutEmail = 'scout@test.com';
  const scRq = await call('/api/auth/request', { email: scoutEmail });
  const scVer = await call('/api/auth/verify', { email: scoutEmail, code: scRq.d.devCode });
  const SCOUT_UID = scVer.d.uid;
  const sOpens = Date.now() - 1000, sCloses = Date.now() + 3600000;
  const scOk = await call('/api/ingest/daily', { day: today, seriesId: serId,
    opensAt: sOpens, closesAt: sCloses, resultsAt: sCloses + 1000,
    songs: [song(51, { scout: { uid: 'drupal-777', email: scoutEmail } }),
            song(52, { scout: { uid: 'drupal-999', email: 'nobody@nowhere.test' } })] }, 'POST', DTOK);
  const SDROP = scOk.d.sessionId;
  ok('the scout ref is stored on the record', (await dDb.get('SELECT scout_drupal_uid FROM rounds WHERE session_id = ? AND idx = 1', [SDROP])).scout_drupal_uid === 'drupal-777');
  ok('an UNMATCHED scout ref is still stored (Drupal reports off it and must not depend on us)',
    (await dDb.get('SELECT scout_drupal_uid FROM rounds WHERE session_id = ? AND idx = 2', [SDROP])).scout_drupal_uid === 'drupal-999');
  ok('the first email match links the two accounts permanently',
    (await dDb.get('SELECT drupal_uid FROM users WHERE uid = ?', [SCOUT_UID])).drupal_uid === 'drupal-777');

  await call('/api/admin/daily/tick', { at: sOpens + 1000 }, 'POST', BOOTH);
  const scJoin = async (email, name) => {
    const rq = await call('/api/join/request', { sessionId: SDROP, email });
    const vr = await call('/api/join/verify', { sessionId: SDROP, email, code: rq.d.devCode, name });
    return { 'X-Player-Token': vr.d.token };
  };
  const SH1 = await scJoin('sv1@test.com', 'Voter One');
  const sQ = (await call('/api/me/state', null, 'GET', SH1)).d.queue;
  for (const q of sQ) await call('/api/vote', { roundId: q.id, taste: 8, predict: 8.0 }, 'POST', SH1);
  await call('/api/admin/daily/tick', { at: sCloses + 1000 }, 'POST', BOOTH);
  const scEvents = await dDb.all("SELECT * FROM point_events WHERE reason = 'scout' AND user_id = ?", [SCOUT_UID]);
  ok('a linked scout earns once their record tallies', scEvents.length === 1, JSON.stringify(scEvents));
  ok('and the award scales with the room average', Number(scEvents[0].points) === srv._scoutPointsFor(8.0), JSON.stringify(scEvents[0]));
  ok('the scout award reaches the $500 board (series-tagged)', scEvents[0].series_id === serId);
  const scUnlinked = await dDb.all("SELECT * FROM point_events WHERE reason = 'scout' AND source_uid IN (SELECT id FROM rounds WHERE session_id = ? AND idx = 2)", [SDROP]);
  ok('an unlinked scout earns nothing until the accounts match', scUnlinked.length === 0, JSON.stringify(scUnlinked));
  await call('/api/admin/daily/tick', { at: sCloses + 5000 }, 'POST', BOOTH);
  ok('a repeat tally never pays the scout twice',
    (await dDb.all("SELECT * FROM point_events WHERE reason = 'scout' AND user_id = ?", [SCOUT_UID])).length === 1);
  await dDb.run('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), SDROP]);

  console.log('\n— live shows as bonus-point events —');
  // Without this the weekly broadcast is decorative on the unified board: a month of daily
  // play dwarfs a dozen live records.
  const lbCs = await call('/api/session', { name: 'Bonus Night', seriesId: serId }, 'POST', BOOTH);
  const LBSID = lbCs.d.sessionId, LBH = { 'X-Admin-Token': lbCs.d.adminToken };
  await dDb.run('UPDATE sessions SET live_bonus = 300, series_id = ? WHERE id = ?', [serId, LBSID]);
  const lbJoin = async (email, name) => {
    const rq = await call('/api/join/request', { sessionId: LBSID, email });
    const vr = await call('/api/join/verify', { sessionId: LBSID, email, code: rq.d.devCode, name });
    return { 'X-Player-Token': vr.d.token };
  };
  const LB1 = await lbJoin('lb1@test.com', 'Full House'), LB2 = await lbJoin('lb2@test.com', 'Half In');
  for (const t of [1, 2]) {
    await call('/api/admin/round', { sessionId: LBSID, song_title: 'Bonus ' + t }, 'POST', LBH);
    await startVoting(LBSID, LBH);
    const cur = (await call('/api/admin/state?sessionId=' + LBSID, null, 'GET', LBH)).d.activeRound;
    await call('/api/vote', { taste: 7, predict: 7 }, 'POST', LB1);
    if (t === 1) await call('/api/vote', { taste: 6, predict: 7 }, 'POST', LB2);   // LB2 skips round 2
    await call('/api/admin/round/ratify', { sessionId: LBSID, roundId: cur.id }, 'POST', LBH);
  }
  const lbEnd = await call('/api/admin/session/end', { sessionId: LBSID }, 'POST', LBH);
  ok('ending the show pays the live completion bonus', lbEnd.d.liveBonusPaid === 1, JSON.stringify(lbEnd.d));
  const lbRows = await dDb.all("SELECT * FROM point_events WHERE reason = 'live_complete' AND source_uid LIKE ?", [LBSID + ':%']);
  ok('only the A&R who rated EVERY record is paid', lbRows.length === 1 && Number(lbRows[0].points) === 300, JSON.stringify(lbRows));
  ok('the live bonus is series-tagged so it lands on the same board as daily play', lbRows[0].series_id === serId);
  await call('/api/admin/session/end', { sessionId: LBSID }, 'POST', LBH);
  ok('ending twice does not pay twice',
    (await dDb.all("SELECT * FROM point_events WHERE reason = 'live_complete' AND source_uid LIKE ?", [LBSID + ':%'])).length === 1);
  // A show with no bonus set is unaffected — every existing session keeps today's behaviour.
  const lbNone = await call('/api/session', { name: 'No Bonus Night' }, 'POST', BOOTH);
  const lbNoneEnd = await call('/api/admin/session/end', { sessionId: lbNone.d.sessionId }, 'POST', { 'X-Admin-Token': lbNone.d.adminToken });
  ok('a show with no live_bonus pays nothing', lbNoneEnd.d.liveBonusPaid === 0, JSON.stringify(lbNoneEnd.d));

  console.log('\n— shareable report graphics (PNG endpoints) —');
  const img = async (path, headers = {}) => { const r = await fetch(base + path, { headers }); return { status: r.status, type: r.headers.get('content-type') || '' }; };
  const isPng = (x) => x.status === 200 && /image\/png/.test(x.type);
  const promoImg = await img('/api/card/promo');
  ok('promo card renders a PNG', isPng(promoImg), JSON.stringify(promoImg));
  const songsImg = await img('/api/card/songs?s=' + SID);
  ok('songs card renders a PNG for a rating session', isPng(songsImg), JSON.stringify(songsImg));
  const songsBin = await img('/api/card/songs?s=' + BSID);
  ok('songs card is excluded for a Versus session (409)', songsBin.status === 409, 'got ' + songsBin.status);
  const songsBad = await img('/api/card/songs?s=nope');
  ok('songs card 404s for an unknown session', songsBad.status === 404, 'got ' + songsBad.status);
  const arsImg = await img('/api/card/ars?s=' + SID);
  ok('A&Rs card renders a PNG for a session', isPng(arsImg), JSON.stringify(arsImg));
  const scoreNoAuth = await img('/api/card/score');
  ok('score card requires a player token (401)', scoreNoAuth.status === 401, 'got ' + scoreNoAuth.status);
  const scoreImg = await img('/api/card/score', { 'X-Player-Token': t1 });
  ok('score card renders a PNG for the player', isPng(scoreImg), JSON.stringify(scoreImg));
  const qrImg = await img('/api/qr?d=' + encodeURIComponent('https://anr.makinitmag.com/?s=abc'));
  ok('QR endpoint returns an SVG', qrImg.status === 200 && /svg/.test(qrImg.type), JSON.stringify(qrImg));
  const qrBad = await call('/api/qr', null, 'GET');
  ok('QR endpoint requires the d param (400)', qrBad.status === 400, 'got ' + qrBad.status);

  console.log('\n— recap email carousel (queue + chunked processing) —');
  const recapStatus = await call('/api/admin/session/recap/status?sessionId=' + SID, null, 'GET', AH);
  ok('recap status lists eligible voters', recapStatus.status === 200 && recapStatus.d.eligible >= 1, JSON.stringify(recapStatus.d));
  const recapNoAuth = await call('/api/admin/session/recap/status?sessionId=' + SID, null, 'GET');
  ok('recap status needs authorization (403)', recapNoAuth.status === 403, 'got ' + recapNoAuth.status);
  const recapStart = await call('/api/admin/session/recap/start', { sessionId: SID }, 'POST', AH);
  ok('recap start blocked without Blob hosting (409)', recapStart.status === 409, 'got ' + recapStart.status + ' ' + JSON.stringify(recapStart.d));
  const recapProc = await call('/api/admin/session/recap/process', { sessionId: SID }, 'POST', AH);
  ok('recap process requires a started job (400)', recapProc.status === 400, 'got ' + recapProc.status);

  console.log('\n— per-host giveaway flag (admin-set; gates the $500 hook; needs a series tag) —');
  // A participant on the host's session, to read the play-state giveaway context.
  const gjr = await call('/api/join/request', { sessionId: HS, email: 'giv@fan.com' });
  const gVer = await call('/api/join/verify', { sessionId: HS, email: 'giv@fan.com', code: gjr.d.devCode, name: 'Giv Fan' });
  const GTOK = { 'X-Player-Token': gVer.d.token };
  // Untagged session -> no giveaway hook even though the host defaults to eligible.
  const preTag = (await call('/api/me/state', null, 'GET', GTOK)).d;
  ok('untagged session surfaces no giveaway', preTag.giveaway == null, JSON.stringify(preTag.giveaway));
  ok('host defaults to giveaway-eligible in admin list', (((await call('/api/admin/users', null, 'GET', ADMINH)).d.users || []).find(u => u.email === 'host@test.com') || {}).giveaway === true, 'default flag');
  // Tag the host session into an active series.
  const serC = await call('/api/admin/series/create', { title: 'E2E Giveaway Series', status: 'active' }, 'POST', ADMINH);
  await call('/api/admin/series/tag', { sessionId: HS, seriesId: serC.d.seriesId }, 'POST', ADMINH);
  const tagged = (await call('/api/me/state', null, 'GET', GTOK)).d;
  ok('tagged + eligible host surfaces the $500 hook', !!tagged.giveaway && tagged.giveaway.title === 'E2E Giveaway Series' && tagged.giveaway.prize === '$500', JSON.stringify(tagged.giveaway));
  // A host cannot flip its own giveaway flag.
  const givForbidden = await call('/api/admin/users/giveaway', { uid: hostUser.id, on: false }, 'POST', HOSTH);
  ok('a host cannot set the giveaway flag', givForbidden.status === 403, 'got ' + givForbidden.status);
  // Admin excludes the host -> hook disappears even though the session stays tagged.
  const givOff = await call('/api/admin/users/giveaway', { uid: hostUser.id, on: false }, 'POST', ADMINH);
  ok('admin excludes the host from the giveaway', givOff.status === 200 && givOff.d.giveaway === false, JSON.stringify(givOff.d));
  const excluded = (await call('/api/me/state', null, 'GET', GTOK)).d;
  ok('excluded host no longer surfaces the hook (still tagged)', excluded.giveaway == null, JSON.stringify(excluded.giveaway));
  const offInList = (((await call('/api/admin/users', null, 'GET', ADMINH)).d.users || []).find(u => u.email === 'host@test.com') || {}).giveaway;
  ok('admin list reflects the excluded flag', offInList === false, 'flag ' + offInList);

  console.log('\n— invite-only sessions: unlisted visibility + join access code —');
  const invC = await call('/api/session', { name: 'Private Listening' }, 'POST', BOOTH);
  const IVID = invC.d.sessionId, IVAH = { 'X-Admin-Token': invC.d.adminToken };
  // Make it live so it WOULD be the featured session if it were public.
  await call('/api/admin/session/status', { sessionId: IVID, status: 'live' }, 'POST', IVAH);
  await call('/api/admin/session/config', { sessionId: IVID, visibility: 'unlisted', accessCode: 'vip2026' }, 'POST', IVAH);
  const ivState = (await call(`/api/admin/state?sessionId=${IVID}`, null, 'GET', IVAH)).d;
  ok('admin state carries visibility + code (uppercased)', ivState.session.visibility === 'unlisted' && ivState.session.access_code === 'VIP2026', JSON.stringify([ivState.session.visibility, ivState.session.access_code]));
  // Unlisted sessions never surface as the homepage feature.
  const homeIv = (await call('/api/home', null, 'GET')).d;
  ok('unlisted live session hidden from /api/home', !homeIv.live || homeIv.live.id !== IVID, JSON.stringify(homeIv.live && homeIv.live.id));
  // Join gate: no code → 403 access_code_required; wrong code → 403; right code (any case) → OTP.
  const noCode = await call('/api/join/request', { sessionId: IVID, email: 'inv@fan.com' });
  ok('join without code is refused', noCode.status === 403 && noCode.d.error === 'access_code_required', JSON.stringify(noCode.d));
  const badCode = await call('/api/join/request', { sessionId: IVID, email: 'inv@fan.com', accessCode: 'NOPE' });
  ok('join with wrong code is refused', badCode.status === 403 && badCode.d.error === 'access_code_required', JSON.stringify(badCode.d));
  const goodCode = await call('/api/join/request', { sessionId: IVID, email: 'inv@fan.com', accessCode: ' Vip2026 ' });
  ok('join with the right code (case/space-insensitive) works', goodCode.status === 200 && goodCode.d.sent, JSON.stringify(goodCode.d));
  const invVer = await call('/api/join/verify', { sessionId: IVID, email: 'inv@fan.com', code: goodCode.d.devCode, name: 'Invited Fan' });
  ok('invited player verifies and gets a seat', invVer.status === 200 && invVer.d.token, JSON.stringify(invVer.d).slice(0, 80));
  // The one-tap account join obeys the same gate (fresh identity, not yet seated).
  const invAuthReq = await call('/api/auth/request', { email: 'inv3@fan.com' });
  const invAuthVer = await call('/api/auth/verify', { email: 'inv3@fan.com', code: invAuthReq.d.devCode });
  const INVAUTH = { 'X-Auth-Token': invAuthVer.d.token };
  const acctNo = await call('/api/join/account', { sessionId: IVID }, 'POST', INVAUTH);
  ok('account join without code is refused', acctNo.status === 403 && acctNo.d.error === 'access_code_required', JSON.stringify(acctNo.d));
  const acctYes = await call('/api/join/account', { sessionId: IVID, accessCode: 'vip2026' }, 'POST', INVAUTH);
  ok('account join with the code seats the user', acctYes.status === 200 && !!acctYes.d.token, 'status ' + acctYes.status);
  // Clearing the code reopens the join.
  await call('/api/admin/session/config', { sessionId: IVID, accessCode: '' }, 'POST', IVAH);
  const opened = await call('/api/join/request', { sessionId: IVID, email: 'inv2@fan.com' });
  ok('clearing the code reopens joins', opened.status === 200 && opened.d.sent, 'status ' + opened.status);
  // Back to public → it can feature again (and doesn't break state).
  await call('/api/admin/session/config', { sessionId: IVID, visibility: 'public' }, 'POST', IVAH);
  const ivState2 = (await call(`/api/admin/state?sessionId=${IVID}`, null, 'GET', IVAH)).d;
  ok('visibility flips back to public', ivState2.session.visibility === 'public', ivState2.session.visibility);
  await call('/api/admin/session/status', { sessionId: IVID, status: 'archived' }, 'POST', IVAH); // tidy up

  console.log('\n— /submit QR route: 302 to the session\'s CURRENT submission link —');
  await call('/api/admin/session/config', { sessionId: IVID, submitUrl: 'https://nero.fan/e2e/live' }, 'POST', IVAH);
  const sub1 = await fetch(base + '/submit?s=' + IVID, { redirect: 'manual' });
  ok('session submit link redirects (302)', sub1.status === 302 && sub1.headers.get('location') === 'https://nero.fan/e2e/live', sub1.status + ' -> ' + sub1.headers.get('location'));
  ok('submit redirect is never cached', /no-store/.test(sub1.headers.get('cache-control') || ''), sub1.headers.get('cache-control'));
  // Host swaps the destination mid-show — same QR now lands on the new link.
  await call('/api/admin/session/config', { sessionId: IVID, submitUrl: 'https://makinitmag.com/review2' }, 'POST', IVAH);
  const sub2 = await fetch(base + '/submit?s=' + IVID, { redirect: 'manual' });
  ok('destination swap takes effect on the same route', sub2.headers.get('location') === 'https://makinitmag.com/review2', sub2.headers.get('location'));
  const sub3 = await fetch(base + '/submit?s=does-not-exist', { redirect: 'manual' });
  ok('unknown session falls back to the house page', sub3.status === 302 && /makinitmag\.com\/review/.test(sub3.headers.get('location') || ''), sub3.headers.get('location'));

  console.log('\n— host defaults: saved once, prefill new rooms; default banner auto-assigns —');
  const hdSave = await call('/api/me/host-defaults', { watchUrl: 'https://youtube.com/@e2e/live', submitUrl: 'https://nero.fan/e2e/live', lobbyMessage: 'Default lobby copy' }, 'POST', BOOTH);
  ok('host defaults save', hdSave.status === 200 && hdSave.d.defaults.watchUrl === 'https://youtube.com/@e2e/live', JSON.stringify(hdSave.d));
  const hdGet = await call('/api/me/host-defaults', null, 'GET', BOOTH);
  ok('host defaults round-trip', hdGet.d.defaults.submitUrl === 'https://nero.fan/e2e/live' && hdGet.d.defaults.lobbyMessage === 'Default lobby copy', JSON.stringify(hdGet.d.defaults));
  const hdNoAuth = await call('/api/me/host-defaults', null, 'GET');
  ok('host defaults need a host account', hdNoAuth.status === 403 || hdNoAuth.status === 401, 'status ' + hdNoAuth.status);
  // Personal default banner: uploads room-less + owned, then auto-assigns at creation.
  const PNG3 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQGk4+nAAAAAAElFTkSuQmCC';
  const hdBan = await call('/api/me/host-defaults/banner', { image_data: PNG3, label: 'My Default' }, 'POST', BOOTH);
  ok('personal default banner uploads', hdBan.status === 200 && hdBan.d.bannerId, JSON.stringify(hdBan.d));
  const hdRoom = await call('/api/session', { name: 'Defaults Night' }, 'POST', BOOTH);
  const hdState = (await call(`/api/admin/state?sessionId=${hdRoom.d.sessionId}`, null, 'GET', { 'X-Admin-Token': hdRoom.d.adminToken })).d;
  ok('new room auto-assigned the default banner', hdState.session.banner_id === hdBan.d.bannerId, JSON.stringify(hdState.session.banner_id));
  // Review-site auto-fill as a host default: the show spins up a new room every week, so a
  // per-room-only toggle is off the week you forget to set it.
  const hdIng = await call('/api/me/host-defaults', { watchUrl: '', submitUrl: '', lobbyMessage: '', ingestAuto: 1 }, 'POST', BOOTH);
  ok('admin can default new rooms to auto-fill', hdIng.status === 200 && hdIng.d.defaults.ingestAuto === 1, JSON.stringify(hdIng.d.defaults));
  const hdIngRoom = await call('/api/session', { name: 'Auto By Default' }, 'POST', BOOTH);
  const hdIngState = (await call('/api/admin/state?sessionId=' + hdIngRoom.d.sessionId, null, 'GET', { 'X-Admin-Token': hdIngRoom.d.adminToken })).d;
  ok('a new room is born armed when the default is on', hdIngState.session.ingest_auto === 1, JSON.stringify(hdIngState.session.ingest_auto));
  // A save that doesn't mention it must not switch it off — the console saves the three text
  // defaults on their own, and an older client sends no such field at all.
  await call('/api/me/host-defaults', { watchUrl: '', submitUrl: '', lobbyMessage: 'x' }, 'POST', BOOTH);
  const hdKept = await call('/api/me/host-defaults', null, 'GET', BOOTH);
  ok('a save without the field preserves the default', hdKept.d.defaults.ingestAuto === 1, JSON.stringify(hdKept.d.defaults));
  // Turning it back off is a normal save, and new rooms follow immediately.
  await call('/api/me/host-defaults', { watchUrl: '', submitUrl: '', lobbyMessage: '', ingestAuto: 0 }, 'POST', BOOTH);
  const hdOffRoom = await call('/api/session', { name: 'Held By Default' }, 'POST', BOOTH);
  const hdOffState = (await call('/api/admin/state?sessionId=' + hdOffRoom.d.sessionId, null, 'GET', { 'X-Admin-Token': hdOffRoom.d.adminToken })).d;
  ok('clearing the default returns new rooms to hold-for-button', hdOffState.session.ingest_auto === 0, JSON.stringify(hdOffState.session.ingest_auto));
  // Tidy: clear the default so later banner tests see a clean slate.
  await call('/api/me/host-defaults', { bannerId: null, watchUrl: '', submitUrl: '', lobbyMessage: '' }, 'POST', BOOTH);

  console.log('\n— platform control panel: admin-only; settings drive the /submit fallback —');
  const platNoAuth = await call('/api/admin/platform', null, 'GET', { 'X-Auth-Token': HOSTTOK });
  ok('platform panel is admin-role only (403 for hosts)', platNoAuth.status === 403, 'status ' + platNoAuth.status);
  const plat = await call('/api/admin/platform', null, 'GET', ADMINH);
  ok('platform payload has banners + settings', plat.status === 200 && Array.isArray(plat.d.banners) && 'houseSubmitUrl' in plat.d.settings, JSON.stringify(Object.keys(plat.d)));
  await call('/api/admin/settings', { houseSubmitUrl: 'https://example.com/subm' }, 'POST', ADMINH);
  const subFb = await fetch(base + '/submit', { redirect: 'manual' });
  ok('house submit setting drives the /submit fallback', subFb.headers.get('location') === 'https://example.com/subm', subFb.headers.get('location'));
  await call('/api/admin/settings', { houseSubmitUrl: '' }, 'POST', ADMINH); // clear back to built-in
  const subFb2 = await fetch(base + '/submit', { redirect: 'manual' });
  ok('clearing the setting restores the built-in fallback', /makinitmag\.com\/review/.test(subFb2.headers.get('location') || ''), subFb2.headers.get('location'));
  // Global banner ops without a room context (the panel's whole point).
  const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQGk4+nAAAAAAElFTkSuQmCC';
  const pUp = await call('/api/admin/banner/upload', { scope: 'global', image_data: PNG2, label: 'Panel E2E' }, 'POST', ADMINH);
  ok('admin uploads a global banner with no room', pUp.status === 200 && pUp.d.bannerId, JSON.stringify(pUp.d));
  const pAsg = await call('/api/admin/banner/assign', { target: 'global', bannerId: pUp.d.bannerId }, 'POST', ADMINH);
  ok('admin sets the global default with no room', pAsg.status === 200, 'status ' + pAsg.status);
  const hostUp = await call('/api/admin/banner/upload', { scope: 'global', image_data: PNG2, label: 'Host Try' }, 'POST', { 'X-Auth-Token': HOSTTOK });
  ok('a host cannot use the room-less banner path', hostUp.status === 401, 'status ' + hostUp.status);
  await call('/api/admin/banner/delete', { bannerId: pUp.d.bannerId }, 'POST', ADMINH); // tidy up

  console.log('\n— mass notify: admin-only, consent-gated SMS queue, chunked to done —');
  const nbNoAuth = await call('/api/admin/notify/start', { message: 'x', email: true, subject: 's' }, 'POST', { 'X-Auth-Token': HOSTTOK });
  ok('mass notify is admin-only', nbNoAuth.status === 403 || nbNoAuth.status === 401, 'status ' + nbNoAuth.status);
  const aud = await call('/api/admin/notify/audience', null, 'GET', ADMINH);
  ok('audience counts: many emails, fewer consented phones', aud.status === 200 && aud.d.email > 5 && aud.d.sms >= 0 && aud.d.sms < aud.d.email, JSON.stringify(aud.d));
  const nb = await call('/api/admin/notify/start', { subject: 'Test blast', message: 'Wednesday 8PM ET — pull up.', email: true, sms: true }, 'POST', ADMINH);
  ok('broadcast queues email + consented SMS', nb.status === 200 && nb.d.queued === aud.d.email + aud.d.sms, JSON.stringify([nb.d.queued, aud.d.email + aud.d.sms]));
  let nbOut = { remaining: nb.d.queued }, spins = 0;
  while (nbOut.remaining > 0 && spins++ < 50) nbOut = (await call('/api/admin/notify/process', { broadcastId: nb.d.broadcastId, limit: 20 }, 'POST', ADMINH)).d;
  ok('chunked processing drains the queue (console senders)', nbOut.remaining === 0 && nbOut.sent === nb.d.queued && nbOut.failed === 0, JSON.stringify(nbOut));

  console.log('\n— Revive ad zones: phase-aware, room banners always win —');
  await call('/api/admin/settings', { reviveDeliveryUrl: 'https://ads.cannick.com/www/delivery', reviveZoneLobby: '8', reviveZoneGame: '9' }, 'POST', ADMINH);
  const rvC = await call('/api/session', { name: 'Revive Night' }, 'POST', BOOTH);
  const RVAH = { 'X-Admin-Token': rvC.d.adminToken };
  const rvJr = await call('/api/join/request', { sessionId: rvC.d.sessionId, email: 'rv@fan.com' });
  const rvVer = await call('/api/join/verify', { sessionId: rvC.d.sessionId, email: 'rv@fan.com', code: rvJr.d.devCode, name: 'Rev Fan' });
  const RVTOK = { 'X-Player-Token': rvVer.d.token };
  const rvWait = (await call('/api/me/state', null, 'GET', RVTOK)).d;
  ok('lobby phase serves the lobby zone', rvWait.phase === 'waiting' && rvWait.revive && rvWait.revive.zone === '8' && !rvWait.banner, JSON.stringify(rvWait.revive));
  await call('/api/admin/round', { sessionId: rvC.d.sessionId, song_title: 'Rv Song' }, 'POST', RVAH); // auto-opens
  await startVoting(rvC.d.sessionId, RVAH);
  const rvVote = (await call('/api/me/state', null, 'GET', RVTOK)).d;
  ok('voting phase serves the in-game zone', rvVote.phase === 'voting' && rvVote.revive && rvVote.revive.zone === '9', JSON.stringify(rvVote.revive));
  // A room banner beats the network ads.
  const rvUp = await call('/api/admin/banner/upload', { sessionId: rvC.d.sessionId, scope: 'session', image_data: PNG, label: 'Room Sponsor' }, 'POST', RVAH);
  await call('/api/admin/banner/assign', { sessionId: rvC.d.sessionId, target: 'session', bannerId: rvUp.d.bannerId }, 'POST', RVAH);
  const rvOwn = (await call('/api/me/state', null, 'GET', RVTOK)).d;
  ok('room banner wins over the Revive zone', rvOwn.banner && rvOwn.banner.id === rvUp.d.bannerId && !rvOwn.revive, JSON.stringify([!!rvOwn.banner, !!rvOwn.revive]));
  // Clearing the config turns network ads off (global banner level returns).
  await call('/api/admin/settings', { reviveDeliveryUrl: '', reviveZoneLobby: '', reviveZoneGame: '' }, 'POST', ADMINH);
  await call('/api/admin/banner/assign', { sessionId: rvC.d.sessionId, target: 'session', bannerId: null }, 'POST', RVAH);
  const rvOff = (await call('/api/me/state', null, 'GET', RVTOK)).d;
  ok('clearing the config turns Revive off', !rvOff.revive, JSON.stringify(rvOff.revive || null));

  console.log('\n— watch-embed resolver: direct ids parse locally; non-YouTube stays null —');
  // (The channel-/live network resolution isn’t exercised here — no YouTube in CI.)
  const weC = await call('/api/session', { name: 'Embed Check' }, 'POST', BOOTH);
  const WEAH = { 'X-Admin-Token': weC.d.adminToken };
  await call('/api/admin/session/config', { sessionId: weC.d.sessionId, watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, 'POST', WEAH);
  const weDirect = await call('/api/watch-embed?s=' + weC.d.sessionId, null, 'GET');
  ok('direct watch URL returns its video id (no fetch)', weDirect.status === 200 && weDirect.d.videoId === 'dQw4w9WgXcQ', JSON.stringify(weDirect.d));
  await call('/api/admin/session/config', { sessionId: weC.d.sessionId, watchUrl: 'https://twitch.tv/makinitmag' }, 'POST', WEAH);
  const weOther = await call('/api/watch-embed?s=' + weC.d.sessionId, null, 'GET');
  ok('non-YouTube watch link resolves to null', weOther.status === 200 && weOther.d.videoId === null, JSON.stringify(weOther.d));

  console.log('\n— Song Report (paid artist tier): host-only, 3 PNG pages, ratified rounds —');
  const rpC = await call('/api/session', { name: 'Report Night' }, 'POST', BOOTH);
  const RPID = rpC.d.sessionId, RPAH = { 'X-Admin-Token': rpC.d.adminToken };
  const rpRound = await call('/api/admin/round', { sessionId: RPID, song_title: 'Report Song', song_artist: 'Test Artist', song_note: 'IG: @testartist' }, 'POST', RPAH);
  await startVoting(RPID, RPAH);
  const RPRID = rpRound.d.roundId; // auto-opened
  const tastes = [3, 5, 6, 7, 7, 8, 8, 9];
  for (let i = 0; i < tastes.length; i++) {
    const jr = await call('/api/join/request', { sessionId: RPID, email: `rpt${i}@fan.com` });
    const ver = await call('/api/join/verify', { sessionId: RPID, email: `rpt${i}@fan.com`, code: jr.d.devCode, name: 'Rpt ' + i });
    await call('/api/vote', { taste: tastes[i], predict: 6 }, 'POST', { 'X-Player-Token': ver.d.token });
  }
  // Not ratified yet -> refused.
  const early = await call(`/api/card/song-report?r=${RPRID}`, null, 'GET', RPAH);
  ok('report refused before ratify', early.status === 400, 'status ' + early.status);
  await call('/api/admin/round/ratify', { sessionId: RPID, roundId: RPRID }, 'POST', RPAH);
  // Host-only: no credentials -> 401.
  const noAuth = await fetch(base + `/api/card/song-report?r=${RPRID}&page=1`);
  ok('report is host-only (401 without credentials)', noAuth.status === 401, 'status ' + noAuth.status);
  // All three pages render as PNGs with 8 votes.
  for (const page of [1, 2, 3]) {
    const r = await fetch(base + `/api/card/song-report?r=${RPRID}&page=${page}`, { headers: RPAH });
    const buf = Buffer.from(await r.arrayBuffer());
    ok(`report page ${page} renders a PNG`, r.status === 200 && (r.headers.get('content-type') || '').includes('image/png') && buf.length > 5000,
      `status ${r.status}, ${buf.length} bytes`);
  }
  // Round history browser: host-only list with scores + vote counts per round.
  const histNoAuth = await call(`/api/admin/rounds?sessionId=${RPID}`, null, 'GET');
  ok('round history is host-only (401)', histNoAuth.status === 401, 'status ' + histNoAuth.status);
  const hist = await call(`/api/admin/rounds?sessionId=${RPID}`, null, 'GET', RPAH);
  const hr = (hist.d.rounds || [])[0];
  ok('round history lists the ratified round with score + votes',
    hist.status === 200 && hr && hr.id === RPRID && hr.status === 'ratified' && hr.votes === 8 && hr.room_average != null,
    JSON.stringify(hr));
  // Per-round results (Rounds tab click-to-expand).
  const rresNoAuth = await call(`/api/admin/round/results?roundId=${RPRID}`, null, 'GET');
  ok('per-round results are host-only (401)', rresNoAuth.status === 401, 'status ' + rresNoAuth.status);
  const rres = await call(`/api/admin/round/results?roundId=${RPRID}`, null, 'GET', RPAH);
  ok('per-round results return the full ranked table',
    rres.status === 200 && rres.d.poll_type === 'rating' && (rres.d.rows || []).length === 8
      && rres.d.rows[0].rank === 1 && rres.d.round.room_average != null,
    JSON.stringify([rres.status, (rres.d.rows || []).length]));

  // Binary rounds are excluded (Versus flavor comes later).
  const rpBinC = await call('/api/session', { name: 'Report Versus', pollType: 'binary' }, 'POST', BOOTH);
  const rpBinR = await call('/api/admin/round', { sessionId: rpBinC.d.sessionId, song_title: 'A', option_b_title: 'B' }, 'POST', { 'X-Admin-Token': rpBinC.d.adminToken });
  const binRep = await call(`/api/card/song-report?r=${rpBinR.d.roundId}`, null, 'GET', { 'X-Admin-Token': rpBinC.d.adminToken });
  ok('Versus rounds are excluded (409)', binRep.status === 409, 'status ' + binRep.status);

  // ======================================================================
  // Post-show artist notices: report card by email + a heads-up text held to
  // the 10AM-10:30PM ET window, with contact addable retroactively after the show.
  // ======================================================================
  console.log('\n— artist SMS quiet hours: 10AM-10:30PM ET, asserted on fixed timestamps —');
  // Fixed instants, expressed in UTC, checked through the ET conversion. July = EDT (UTC-4).
  // The close is on a half hour, so 10:00 PM sends and 10:30 PM holds — the whole point of
  // the minute-of-day gate, and the case an hour-granular rewrite would silently break.
  const etCases = [
    ['2026-07-15T13:59:00Z', 9,  false, '9:59 AM ET — before the window'],
    ['2026-07-15T14:00:00Z', 10, true,  '10:00 AM ET — window opens'],
    ['2026-07-15T20:00:00Z', 16, true,  '4:00 PM ET — mid-window'],
    ['2026-07-16T00:00:00Z', 20, true,  '8:00 PM ET — still inside the window'],
    ['2026-07-16T02:00:00Z', 22, true,  '10:00 PM ET — top of the closing hour, still sends'],
    ['2026-07-16T02:29:00Z', 22, true,  '10:29 PM ET — last minute in'],
    ['2026-07-16T02:30:00Z', 22, false, '10:30 PM ET — window closes mid-hour'],
    ['2026-07-16T03:00:00Z', 23, false, '11:00 PM ET — show wrap, must hold'],
    ['2026-07-16T04:00:00Z', 0,  false, 'midnight ET — normalizes to hour 0, still held'],
    ['2026-07-16T09:00:00Z', 5,  false, '5:00 AM ET — still held'],
  ];
  for (const [iso, wantHour, wantOpen, label] of etCases) {
    const ts = Date.parse(iso);
    ok(`ET hour ${label}`, server._etHour(ts) === wantHour, `got ${server._etHour(ts)}, want ${wantHour}`);
    ok(`SMS ${wantOpen ? 'sends' : 'holds'} — ${label}`, server._withinSmsWindow(ts) === wantOpen, `got ${server._withinSmsWindow(ts)}`);
  }
  // Winter (EST, UTC-5): the same wall-clock rule must hold across the DST boundary.
  ok('EST: 9:59 AM ET holds', server._withinSmsWindow(Date.parse('2026-01-14T14:59:00Z')) === false);
  ok('EST: 10:00 AM ET sends', server._withinSmsWindow(Date.parse('2026-01-14T15:00:00Z')) === true);
  ok('EST: 10:29 PM ET sends', server._withinSmsWindow(Date.parse('2026-01-15T03:29:00Z')) === true);
  ok('EST: 10:30 PM ET holds', server._withinSmsWindow(Date.parse('2026-01-15T03:30:00Z')) === false);
  ok('EST: 11 PM ET (show wrap) holds', server._withinSmsWindow(Date.parse('2026-01-15T04:00:00Z')) === false);

  console.log('\n— A&R Daily: ET day arithmetic across DST —');
  // The drop's schedule is WALL CLOCK: 12PM ET open, 9AM ET close, 12PM ET publish. The
  // window crosses the DST switch twice a year, so the rule that has to hold is "noon is
  // noon" — and the DURATION is what flexes (20h in spring, 22h in fall), not the times.
  // Deriving the close as open+21h would give an 8AM close in March and a 10AM close in
  // November, which is the bug this helper exists to prevent.
  const etWall = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(ts));
  const wallCases = [
    ['2026-03-08', 12, '12:00', 'spring-forward day, noon'],
    ['2026-03-08',  9, '09:00', 'spring-forward day, 9AM'],
    ['2026-11-01', 12, '12:00', 'fall-back day, noon'],
    ['2026-11-01',  9, '09:00', 'fall-back day, 9AM'],
    ['2026-07-04', 12, '12:00', 'EDT, noon'],
    ['2026-01-15', 12, '12:00', 'EST, noon'],
  ];
  for (const [day, hh, want, label] of wallCases) {
    const got = etWall(server._etEpoch(day, hh));
    ok(`etEpoch: ${label} -> ${want} ET`, got === want, `got ${got}`);
  }
  // The window length flexing is the CORRECT behaviour, not a defect — assert it so nobody
  // "fixes" it into a fixed 21 hours.
  const spanH = (d) => (server._etEpoch(server._etNextDay(d), 9) - server._etEpoch(d, 12)) / 3600000;
  ok('window is 21h on an ordinary day', spanH('2026-07-04') === 21, `got ${spanH('2026-07-04')}`);
  ok('window is 20h across spring-forward (an hour is lost)', spanH('2026-03-07') === 20, `got ${spanH('2026-03-07')}`);
  ok('window is 22h across fall-back (an hour is gained)', spanH('2026-10-31') === 22, `got ${spanH('2026-10-31')}`);
  ok('etNextDay crosses a month boundary', server._etNextDay('2026-02-28') === '2026-03-01');
  ok('etNextDay crosses a year boundary', server._etNextDay('2026-12-31') === '2027-01-01');
  ok('etNextDay crosses spring-forward', server._etNextDay('2026-03-07') === '2026-03-08');
  ok('etNextDay crosses fall-back', server._etNextDay('2026-10-31') === '2026-11-01');
  ok('etEpoch rejects a malformed day', server._etEpoch('nope', 12) === null);
  ok('etNextDay rejects a malformed day', server._etNextDay('nope') === null);

  console.log('\n— A&R Daily: completion-bonus tiers —');
  // Anchored to the drop day's absolute epochs, NOT minutes-of-day. The window crosses
  // midnight, so someone finishing at 2AM is 120 minutes into the ET clock — a
  // minutes-of-day comparison would read that as "before 3PM" and pay 100 instead of 25.
  const bSess = { drop_day: '2026-07-04' };
  const at = (day, hh, mm = 0) => server._etEpoch(day, hh, mm);
  ok('finish at 12:01 PM -> 100', server._completionBonusPoints(bSess, at('2026-07-04', 12, 1)) === 100);
  ok('finish at 2:59 PM  -> 100', server._completionBonusPoints(bSess, at('2026-07-04', 14, 59)) === 100);
  ok('finish at 3:00 PM  -> 75',  server._completionBonusPoints(bSess, at('2026-07-04', 15)) === 75);
  ok('finish at 5:59 PM  -> 75',  server._completionBonusPoints(bSess, at('2026-07-04', 17, 59)) === 75);
  ok('finish at 6:00 PM  -> 50',  server._completionBonusPoints(bSess, at('2026-07-04', 18)) === 50);
  ok('finish at 8:59 PM  -> 50',  server._completionBonusPoints(bSess, at('2026-07-04', 20, 59)) === 50);
  ok('finish at 9:00 PM  -> 25',  server._completionBonusPoints(bSess, at('2026-07-04', 21)) === 25);
  ok('finish at 2:00 AM next day -> 25 (NOT 100 — the window crosses midnight)',
    server._completionBonusPoints(bSess, at('2026-07-05', 2)) === 25);
  ok('finish at 8:59 AM next day -> 25', server._completionBonusPoints(bSess, at('2026-07-05', 8, 59)) === 25);

  console.log('\n— A&R Daily: the per-A&R queue order —');
  // Deterministic and storage-free: the same A&R gets the same order on any device forever,
  // two A&Rs get different orders, and every record appears exactly once. If this stops
  // being stable, resume lands people on the wrong record.
  const qRounds = Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, idx: i + 1 }));
  const ordA1 = server._asyncQueueOrder('uidA', 'sess1', qRounds).map(r => r.id);
  const ordA2 = server._asyncQueueOrder('uidA', 'sess1', qRounds).map(r => r.id);
  const ordB = server._asyncQueueOrder('uidB', 'sess1', qRounds).map(r => r.id);
  const ordA3 = server._asyncQueueOrder('uidA', 'sess2', qRounds).map(r => r.id);
  ok('same A&R, same room -> identical order (resume works)', ordA1.join() === ordA2.join());
  ok('different A&R -> different order (drop-off spreads across the day)', ordA1.join() !== ordB.join());
  ok('same A&R, different day -> different order', ordA1.join() !== ordA3.join());
  ok('every record appears exactly once', new Set(ordA1).size === 12 && ordA1.length === 12);
  // Input order must not matter — the canonical sort is what makes it reproducible when the
  // DB hands rows back in a different sequence.
  const shuffledIn = qRounds.slice().reverse();
  ok('order is independent of the row order the DB returned',
    server._asyncQueueOrder('uidA', 'sess1', shuffledIn).map(r => r.id).join() === ordA1.join());
  ok('a one-record day is returned as-is', server._asyncQueueOrder('u', 's', [{ id: 'x', idx: 1 }]).length === 1);
  ok('an empty day does not throw', server._asyncQueueOrder('u', 's', []).length === 0);
  // A 4-record day is as valid as a 16-record one — the day size is variable by design.
  ok('a 4-record day shuffles', new Set(server._asyncQueueOrder('u', 's',
    qRounds.slice(0, 4)).map(r => r.id)).size === 4);

  console.log('\n— artist email: carries the report + replay link, and NO pricing —');
  // The operator's explicit call: the report card goes out free to drive visibility, and the
  // email must never mention price or an upsell. That's a product decision a future copy
  // edit could quietly undo, so it's asserted here rather than left to review.
  const aeHtml = server._artistEmailHtml({ title: 'Midnight Run', artist: 'Jaylen Cole', mean: '7.4',
    rank: 2, total: 11, dateLabel: 'Jul 8, 2026', sessionName: 'Test Night',
    watchUrl: 'https://youtube.com/watch?v=abc123', pages: ['https://blob/p1.png', 'https://blob/p2.png', 'https://blob/p3.png'] });
  ok('artist email embeds every report page', ['p1', 'p2', 'p3'].every(p => aeHtml.includes(p + '.png')));
  ok('artist email carries the replay link', aeHtml.includes('youtube.com/watch?v=abc123'));
  ok('artist email points the artist at the replay for clips', /short clips/i.test(aeHtml));
  ok('artist email asks for the collab post', aeHtml.includes('@Makinit4indies') && aeHtml.includes('#TheARRoom'));
  ok('artist email shows the score + rank', aeHtml.includes('7.4') && aeHtml.includes('#2 of 11'));
  const sellWords = /\$\d|\bprice\b|\bpricing\b|\bpurchase\b|\bpaid\b|\bupgrade\b|\bcheckout\b|\bbuy\b|\bupsell\b/i;
  ok('artist email mentions NO price or upsell (operator decision)', !sellWords.test(aeHtml),
    (aeHtml.match(sellWords) || [''])[0]);
  // A room with no replay link must simply omit the button, not render a dead one.
  const aeNoWatch = server._artistEmailHtml({ title: 'X', artist: '', mean: '5.0', rank: 1, total: 1,
    dateLabel: 'Jul 8, 2026', sessionName: 'N', watchUrl: null, pages: ['https://blob/p1.png'] });
  ok('no replay link -> no watch button (not a dead link)', !/Watch the room/.test(aeNoWatch));
  ok('single-song room omits the rank line', !/of 1<\/b> records/.test(aeNoWatch));
  // Approved A&R comments ride along, attributed. Attribution is the whole value —
  // named people who scored the record, not anonymous opinion.
  const aeCmts = server._artistEmailHtml({ title: 'Midnight Run', artist: 'Jaylen Cole', mean: '7.4',
    rank: 2, total: 11, dateLabel: 'Jul 8, 2026', sessionName: 'Test Night', watchUrl: null,
    pages: ['https://blob/p1.png'],
    comments: [{ body: 'The rasp on verse two is the whole record.', name: 'Devin R.', role: 'A&R', location: 'Atlanta' }] });
  ok('artist email carries approved comments', aeCmts.includes('The rasp on verse two is the whole record.'));
  ok('artist email attributes each comment', aeCmts.includes('Devin R.') && aeCmts.includes('A&amp;R') && aeCmts.includes('Atlanta'));
  ok('artist email frames comments as individual opinions', /personal opinions of individual/i.test(aeCmts));
  ok('comment block still carries no price or upsell', !sellWords.test(aeCmts), (aeCmts.match(sellWords) || [''])[0]);
  // Escaping: a comment is untrusted free text going into an HTML email.
  const aeXss = server._artistEmailHtml({ title: 'T', artist: '', mean: '5.0', rank: 1, total: 1,
    dateLabel: 'd', sessionName: 'N', watchUrl: null, pages: [],
    comments: [{ body: '<script>alert(1)</script>', name: '<b>x</b>', role: null, location: null }] });
  ok('comment bodies are HTML-escaped', !aeXss.includes('<script>') && aeXss.includes('&lt;script&gt;'));
  ok('commenter names are HTML-escaped', !aeXss.includes('<b>x</b>'));
  // No approved comments -> the block vanishes entirely, no empty header.
  ok('no shared comments -> no comment block at all', !/What the A&amp;Rs said/.test(aeNoWatch));

  console.log('\n— artist notices: contact capture, retroactive edit, queue —');
  const anC = await call('/api/session', { name: 'Artist Night' }, 'POST', BOOTH);
  const ANID = anC.d.sessionId, ANAH = { 'X-Admin-Token': anC.d.adminToken };
  // Song 1 arrives WITH contact (the review-site/queue-form path).
  const an1 = await call('/api/admin/round', { sessionId: ANID, song_title: 'Contact Song', song_artist: 'Reachable',
    artist_email: 'Reach@Artist.COM', artist_phone: '(305) 555-0199' }, 'POST', ANAH);
  await startVoting(ANID, ANAH);
  const AN1 = an1.d.roundId;
  const anVote = async (rid, n, tag) => {
    for (let i = 0; i < n; i++) {
      const jr = await call('/api/join/request', { sessionId: ANID, email: `${tag}${i}@fan.com` });
      const ver = await call('/api/join/verify', { sessionId: ANID, email: `${tag}${i}@fan.com`, code: jr.d.devCode, name: `${tag} ${i}` });
      await call('/api/vote', { taste: 7, predict: 7 }, 'POST', { 'X-Player-Token': ver.d.token });
    }
  };
  await anVote(AN1, 3, 'anA');
  await call('/api/admin/round/ratify', { sessionId: ANID, roundId: AN1 }, 'POST', ANAH);
  // Song 2 arrives with NO contact — the case the Rounds tab flags.
  const an2 = await call('/api/admin/round', { sessionId: ANID, song_title: 'Orphan Song', song_artist: 'Unreachable' }, 'POST', ANAH);
  await startVoting(ANID, ANAH);
  const AN2 = an2.d.roundId;
  await anVote(AN2, 3, 'anB');
  await call('/api/admin/round/ratify', { sessionId: ANID, roundId: AN2 }, 'POST', ANAH);

  const anRounds = (await call(`/api/admin/rounds?sessionId=${ANID}`, null, 'GET', ANAH)).d.rounds;
  const anR1 = anRounds.find(r => r.id === AN1), anR2 = anRounds.find(r => r.id === AN2);
  ok('contact stored on add + normalized (lowercased)', anR1.artist_email === 'reach@artist.com' && anR1.artist_phone === '(305) 555-0199', JSON.stringify(anR1));
  ok('round with no contact reports empty (drives the ⚠ flag)', anR2.artist_email === '' && anR2.artist_phone === '', JSON.stringify(anR2));

  const anSt1 = (await call(`/api/admin/session/artist-notices/status?sessionId=${ANID}`, null, 'GET', ANAH)).d;
  ok('status counts both rated rounds', anSt1.rounds === 2, JSON.stringify(anSt1));
  ok('status counts one reachable, one missing', anSt1.withEmail === 1 && anSt1.missing === 1, JSON.stringify(anSt1));
  const anStNoAuth = await call(`/api/admin/session/artist-notices/status?sessionId=${ANID}`, null, 'GET');
  ok('artist notices are host-only (403)', anStNoAuth.status === 403, 'got ' + anStNoAuth.status);

  // THE RETROACTIVE PATH: a ratified round is editable, and adding contact makes the
  // artist reachable — without touching the score.
  const anBefore = anR2.room_average;
  const anEdit = await call('/api/admin/round/edit', { sessionId: ANID, roundId: AN2,
    song_title: 'Orphan Song (fixed)', artist_email: 'found@artist.com', artist_phone: '3055550111' }, 'POST', ANAH);
  ok('a RATIFIED round is editable (was blocked before)', anEdit.status === 200, JSON.stringify(anEdit.d));
  const anAfter = (await call(`/api/admin/rounds?sessionId=${ANID}`, null, 'GET', ANAH)).d.rounds.find(r => r.id === AN2);
  ok('retroactive contact lands on the ratified round', anAfter.artist_email === 'found@artist.com', JSON.stringify(anAfter));
  ok('editing a ratified round does NOT move its score', anAfter.room_average === anBefore, `${anBefore} -> ${anAfter.room_average}`);
  ok('editing a ratified round does NOT drop its votes', anAfter.votes === 3, 'votes ' + anAfter.votes);
  ok('title edit applies to a ratified round', anAfter.song_title === 'Orphan Song (fixed)', anAfter.song_title);
  const anSt2 = (await call(`/api/admin/session/artist-notices/status?sessionId=${ANID}`, null, 'GET', ANAH)).d;
  ok('reachability updates after the retroactive edit', anSt2.withEmail === 2 && anSt2.missing === 0, JSON.stringify(anSt2));
  // A bad address is refused rather than silently queuing a doomed send.
  const anBadEmail = await call('/api/admin/round/edit', { sessionId: ANID, roundId: AN2, artist_email: 'not-an-email' }, 'POST', ANAH);
  ok('a malformed artist email is rejected', anBadEmail.status === 400, 'got ' + anBadEmail.status);
  const anStill = (await call(`/api/admin/rounds?sessionId=${ANID}`, null, 'GET', ANAH)).d.rounds.find(r => r.id === AN2);
  ok('the rejected edit left the good address intact', anStill.artist_email === 'found@artist.com', anStill.artist_email);
  // Omitting the field entirely must not blank it (PATCH-style contract).
  await call('/api/admin/round/edit', { sessionId: ANID, roundId: AN2, song_title: 'Orphan Song (fixed)' }, 'POST', ANAH);
  const anKept = (await call(`/api/admin/rounds?sessionId=${ANID}`, null, 'GET', ANAH)).d.rounds.find(r => r.id === AN2);
  ok('an edit that omits contact leaves it untouched', anKept.artist_email === 'found@artist.com', anKept.artist_email);

  // PII rule: artist contact is host-facing pipeline data and must never reach a player
  // surface. The public views build explicit field lists, but that's exactly the kind of
  // thing a later `...round` spread would quietly undo — so assert it on the live payload.
  const anPlayJr = await call('/api/join/request', { sessionId: ANID, email: 'peeker@fan.com' });
  const anPlayVer = await call('/api/join/verify', { sessionId: ANID, email: 'peeker@fan.com', code: anPlayJr.d.devCode, name: 'Peeker' });
  const anPlayState = await call('/api/me/state', null, 'GET', { 'X-Player-Token': anPlayVer.d.token });
  const anPlayBlob = JSON.stringify(anPlayState.d);
  ok('player state never carries artist email', !anPlayBlob.includes('reach@artist.com') && !anPlayBlob.includes('found@artist.com'), anPlayBlob.slice(0, 200));
  ok('player state never carries artist phone', !anPlayBlob.includes('555-0199') && !/artist_phone/.test(anPlayBlob), anPlayBlob.slice(0, 200));
  const anPub = await call(`/api/leaderboard?sessionId=${ANID}`, null, 'GET');
  ok('public leaderboard never carries artist contact', !JSON.stringify(anPub.d).includes('artist@'), JSON.stringify(anPub.d).slice(0, 160));

  // Sends need Blob (the report cards are rendered + hosted) — refused, not half-done.
  const anStart = await call('/api/admin/session/artist-notices/start', { sessionId: ANID }, 'POST', ANAH);
  ok('start refuses without image hosting (409)', anStart.status === 409, 'got ' + anStart.status);
  // Cron is token-gated and must never run un-gated.
  const cronNoTok = await call('/api/cron/artist-sms', null, 'GET');
  ok('artist-sms cron refuses without CRON_SECRET configured (503)', cronNoTok.status === 503, 'got ' + cronNoTok.status);
  // Vercel documents that cron delivery can invoke the same run twice, and the hourly cron
  // can overlap the host's own drain. Two concurrent drains must not double-text an artist.
  const anDb = require('./db');
  await anDb.run("INSERT INTO artist_notices (id, session_id, round_id, channel, dest, status, created_at) VALUES ('dup1', ?, ?, 'sms', '+13055550143', 'pending', ?)", [ANID, AN1, Date.now()]);
  const drains = await Promise.all([server._drainArtistSms({ sessionId: ANID, limit: 5 }), server._drainArtistSms({ sessionId: ANID, limit: 5 })]);
  const totalSent = drains.reduce((a, r) => a + r.sent, 0);
  const dupRow = await anDb.get("SELECT status FROM artist_notices WHERE id = 'dup1'");
  // Inside the ET window exactly one drain sends it; outside, both correctly hold.
  if (drains.some(d => d.held)) {
    ok('concurrent drains both hold outside the ET window', drains.every(d => d.held) && dupRow.status === 'pending', JSON.stringify({ drains, dupRow }));
  } else {
    ok('a double-invoked cron sends the artist exactly ONE text', totalSent === 1, 'sent ' + totalSent + ' times');
    ok('the claimed row settles as sent', dupRow.status === 'sent', dupRow.status);
  }

  // ---- per-round resend: the escape hatch the idempotent room-wide queue can't give ----
  console.log('\n— artist notices: resend ONE round —');
  const rsPath = '/api/admin/session/artist-notices/resend';
  ok('resend is host-only (403)', (await call(rsPath, { sessionId: ANID, roundId: AN1, email: true })).status === 403,
    'got ' + (await call(rsPath, { sessionId: ANID, roundId: AN1, email: true })).status);
  ok('resend needs a roundId', (await call(rsPath, { sessionId: ANID, email: true }, 'POST', ANAH)).status === 400);
  ok('resend needs a channel', (await call(rsPath, { sessionId: ANID, roundId: AN1 }, 'POST', ANAH)).status === 400);
  // Eligibility is re-checked server-side, so a hand-made request can't mail a report for
  // a round that has none. AN3 is a fresh unratified round.
  const an3 = await call('/api/admin/round', { sessionId: ANID, song_title: 'Not Yet', artist_email: 'x@y.com' }, 'POST', ANAH);
  await startVoting(ANID, ANAH);
  const rsIneligible = await call(rsPath, { sessionId: ANID, roundId: an3.d.roundId, email: true }, 'POST', ANAH);
  ok('resend refuses a round with no report to send (409)', rsIneligible.status === 409, JSON.stringify(rsIneligible.d));
  // Email needs Blob (the report pages are rendered + hosted) — refused, not half-sent.
  const rsNoBlob = await call(rsPath, { sessionId: ANID, roundId: AN1, email: true }, 'POST', ANAH);
  ok('resend email refuses without image hosting (409)', rsNoBlob.status === 409, JSON.stringify(rsNoBlob.d));
  // Asking for SMS on a round with no phone is refused rather than silently doing nothing.
  await call('/api/admin/round/edit', { sessionId: ANID, roundId: AN2, artist_phone: '' }, 'POST', ANAH);
  const rsNoPhone = await call(rsPath, { sessionId: ANID, roundId: AN2, sms: true }, 'POST', ANAH);
  ok('resend refuses SMS with no number on the round (409)', rsNoPhone.status === 409, JSON.stringify(rsNoPhone.d));

  // THE POINT OF THE FEATURE: a round that already sent can be sent again. The SMS path
  // needs no Blob, so it's what exercises the requeue semantics end to end.
  await anDb.run("UPDATE artist_notices SET status = 'sent', dest = '+13055550143', sent_at = ?, error = NULL WHERE round_id = ? AND channel = 'sms'", [Date.now(), AN1]);
  const rsSentBefore = await anDb.get("SELECT status, dest FROM artist_notices WHERE round_id = ? AND channel = 'sms'", [AN1]);
  ok('the round starts out already sent', rsSentBefore.status === 'sent', JSON.stringify(rsSentBefore));
  // ...and the host has since CORRECTED the number. The resend must use the new one —
  // reusing the queued row's stale dest would defeat the whole feature.
  await call('/api/admin/round/edit', { sessionId: ANID, roundId: AN1, artist_phone: '3055559999' }, 'POST', ANAH);
  const rsAgain = await call(rsPath, { sessionId: ANID, roundId: AN1, sms: true }, 'POST', ANAH);
  ok('resend succeeds on an already-sent round', rsAgain.status === 200 && rsAgain.d.sms, JSON.stringify(rsAgain.d));
  const rsRow = await anDb.get("SELECT status, dest, error FROM artist_notices WHERE round_id = ? AND channel = 'sms'", [AN1]);
  ok('resend re-reads the CORRECTED number off the round', rsRow.dest === '3055559999', JSON.stringify(rsRow));
  ok('resend never duplicates the queue row',
    Number((await anDb.get("SELECT COUNT(*) AS c FROM artist_notices WHERE round_id = ? AND channel = 'sms'", [AN1])).c) === 1);
  // TCPA quiet hours still bind — a per-round resend is not a reason to text at 2AM.
  if (rsAgain.d.sms.held) {
    ok('outside the ET window the text is HELD, not sent', rsRow.status === 'pending' && !!rsAgain.d.sms.label, JSON.stringify([rsRow, rsAgain.d.sms]));
  } else {
    ok('inside the ET window the text goes right out', rsRow.status === 'sent', JSON.stringify(rsRow));
  }
  // A failed row is retryable too — that's the bounce case.
  await anDb.run("UPDATE artist_notices SET status = 'failed', error = 'bounced' WHERE round_id = ? AND channel = 'sms'", [AN1]);
  await call(rsPath, { sessionId: ANID, roundId: AN1, sms: true }, 'POST', ANAH);
  const rsRetried = await anDb.get("SELECT status, error FROM artist_notices WHERE round_id = ? AND channel = 'sms'", [AN1]);
  ok('retrying a failed send clears the old error', rsRetried.error === null || rsRetried.error === undefined, JSON.stringify(rsRetried));
  // The Rounds tab reads this to colour the button and label it send vs resend.
  const rsRounds = (await call(`/api/admin/rounds?sessionId=${ANID}`, null, 'GET', ANAH)).d;
  const rsR1 = rsRounds.rounds.find(r => r.id === AN1);
  ok('rounds payload carries per-round notice state', !!(rsR1.notice && rsR1.notice.sms && rsR1.notice.sms.status), JSON.stringify(rsR1.notice));
  ok('rounds payload carries the SMS window for the dialog',
    rsRounds.smsWindow && typeof rsRounds.smsWindow.open === 'boolean' && !!rsRounds.smsWindow.from, JSON.stringify(rsRounds.smsWindow));

  // Post kit: the caption is always available, even with Asana unconfigured.
  const pk = await call(`/api/admin/session/post-kit?sessionId=${ANID}`, null, 'GET', ANAH);
  ok('post kit returns a caption', pk.status === 200 && typeof pk.d.caption === 'string' && pk.d.caption.includes('#TheARRoom'), JSON.stringify(pk.d).slice(0, 160));
  ok('post kit reports Asana unconfigured (no token)', pk.d.configured === false && pk.d.hasToken === false, JSON.stringify(pk.d));
  ok('post kit names the top record', !!pk.d.topRecord, JSON.stringify(pk.d.topRecord));
  const pkNoAuth = await call(`/api/admin/session/post-kit?sessionId=${ANID}`, null, 'GET');
  ok('post kit is host-only (403)', pkNoAuth.status === 403, 'got ' + pkNoAuth.status);
  const asanaOff = await call('/api/admin/session/asana-task', { sessionId: ANID }, 'POST', ANAH);
  ok('asana task refuses when unconfigured (409)', asanaOff.status === 409, 'got ' + asanaOff.status);

  // ======================================================================
  // Referral bonus milestones: an invitee's 10th cumulative scored round
  // pays their referrer +10 on the series board; the 50th pays +75 more.
  // First-touch only (new accounts); idempotent across every later ratify.
  // ======================================================================
  console.log('\n— staged rounds: listening → voting → ratify, one Advance action —');
  const sgC = await call('/api/session', { name: 'Staged Night' }, 'POST', BOOTH);
  const SGID = sgC.d.sessionId, SGAH = { 'X-Admin-Token': sgC.d.adminToken };
  const sgJoin = async (email, name) => {
    const rq = await call('/api/join/request', { sessionId: SGID, email });
    return (await call('/api/join/verify', { sessionId: SGID, email, code: rq.d.devCode, name })).d.token;
  };
  const sg1 = await sgJoin('sg1@test.com', 'Sasha'), sg2 = await sgJoin('sg2@test.com', 'Rome');

  // Adding a record puts it ON DECK, not straight into voting. That's the whole point:
  // the room hears the song before any clock starts.
  const sgAdd = await call('/api/admin/round', { sessionId: SGID, song_title: 'Staged One', song_artist: 'Deck' }, 'POST', SGAH);
  ok('a new record opens into LISTENING, not voting', sgAdd.d.opened === true && sgAdd.d.status === 'listening', JSON.stringify(sgAdd.d));
  let sgSt = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d;
  ok('listening round carries no clock', sgSt.activeRound.status === 'listening' && !sgSt.activeRound.closes_at, JSON.stringify(sgSt.activeRound));

  // The guard that makes voting windows uniform: it's the SERVER refusing, not a hidden button.
  const sgEarly = await call('/api/vote', { taste: 9, predict: 9 }, 'POST', { 'X-Player-Token': sg1 });
  ok('votes are REFUSED while a round is listening', sgEarly.status === 400, 'got ' + sgEarly.status);
  let sgPlay = (await call('/api/me/state', null, 'GET', { 'X-Player-Token': sg1 })).d;
  ok('player sees the listening phase', sgPlay.phase === 'listening', sgPlay.phase);
  ok('listening player gets the record but no clock', sgPlay.round.song_title === 'Staged One' && !sgPlay.round.closes_at, JSON.stringify(sgPlay.round));

  // Advance #1: listening -> voting.
  const sgNext1 = (await call(`/api/admin/advance/state?sessionId=${SGID}`, null, 'GET', SGAH)).d;
  ok('next stage reads as "vote" while listening', sgNext1.action === 'vote', JSON.stringify(sgNext1));
  const sgAdv1 = await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH);
  ok('advance starts the clock', sgAdv1.d.action === 'vote' && sgAdv1.d.status === 'voting' && sgAdv1.d.closes_at, JSON.stringify(sgAdv1.d));
  const sgNow = await call('/api/vote', { taste: 8, predict: 7 }, 'POST', { 'X-Player-Token': sg1 });
  ok('votes are accepted once voting opens', sgNow.d.locked === true, JSON.stringify(sgNow.d));
  await call('/api/vote', { taste: 6, predict: 7 }, 'POST', { 'X-Player-Token': sg2 });

  // Advance #2 + #3: ratify is DOUBLE-pressed. The first press must change nothing.
  const sgArm = await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH);
  ok('first ratify press only ARMS', sgArm.d.action === 'ratify' && sgArm.d.confirmNeeded === true, JSON.stringify(sgArm.d));
  sgSt = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d;
  ok('arming does NOT tally the round', sgSt.activeRound.status === 'voting', sgSt.activeRound.status);
  const sgFire = await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH);
  ok('second press tallies', sgFire.d.confirmNeeded === false && sgFire.d.room_average != null, JSON.stringify(sgFire.d));
  sgSt = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d;
  ok('round is ratified after the confirm', sgSt.activeRound.status === 'ratified', sgSt.activeRound.status);

  // A fresh round must re-arm from scratch — a stale arm can never tally the NEXT song.
  await call('/api/admin/round', { sessionId: SGID, song_title: 'Staged Two' }, 'POST', SGAH);
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH); // listening -> voting
  await call('/api/vote', { taste: 5, predict: 5 }, 'POST', { 'X-Player-Token': sg1 });
  const sgArm2 = await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH);
  ok('a new round requires its OWN arming press', sgArm2.d.confirmNeeded === true, JSON.stringify(sgArm2.d));
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH);

  // Back-to-queue only before a clock has run.
  await call('/api/admin/round', { sessionId: SGID, song_title: 'Wrong Song' }, 'POST', SGAH);
  const sgUn = await call('/api/admin/round/unopen', { sessionId: SGID, roundId: (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d.activeRound.id }, 'POST', SGAH);
  ok('a listening round can go back to the queue', sgUn.status === 200, JSON.stringify(sgUn.d));
  const sgQ = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d;
  ok('un-opened record is back in the queue', (sgQ.queue || []).some(q => q.song_title === 'Wrong Song'), JSON.stringify(sgQ.queue));

  console.log('\n— delete a round nobody evaluated (the mis-press), never one with votes —');
  // The accident this exists for: Advance gets leaned on and a record is opened, ended and
  // ratified on an empty room. Unopen only rescues a listening round; after ratify the only
  // fix is deletion.
  await call('/api/admin/round', { sessionId: SGID, song_title: 'Empty Mistake' }, 'POST', SGAH);
  const dlMiss = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d.activeRound;
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH); // listening -> voting
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH); // arm
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH); // ratify, zero votes
  // A second round AFTER the mistake, with a real vote on it — it must survive, and renumber.
  await call('/api/admin/round', { sessionId: SGID, song_title: 'After The Gap' }, 'POST', SGAH);
  const dlKeep = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d.activeRound;
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH); // listening -> voting
  await call('/api/vote', { taste: 7, predict: 7 }, 'POST', { 'X-Player-Token': sg1 });
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH); // arm
  await call('/api/admin/advance', { sessionId: SGID }, 'POST', SGAH); // ratify
  ok('the mis-pressed round ratified empty at #3, the next at #4', dlMiss.idx === 3 && dlKeep.idx === 4,
    JSON.stringify([dlMiss.idx, dlKeep.idx]));

  const dlNo = await call('/api/admin/round/delete', { sessionId: SGID, roundId: dlKeep.id }, 'POST', SGAH);
  ok('a round WITH evaluations is refused', dlNo.status === 400 && /evaluation/.test(dlNo.d.error || ''), JSON.stringify(dlNo.d));
  const dlYes = await call('/api/admin/round/delete', { sessionId: SGID, roundId: dlMiss.id }, 'POST', SGAH);
  ok('a round nobody evaluated deletes', dlYes.status === 200, JSON.stringify(dlYes.d));
  let dlRounds = (await call(`/api/admin/rounds?sessionId=${SGID}`, null, 'GET', SGAH)).d.rounds;
  ok('the deleted round is gone from history', !dlRounds.some(r => r.id === dlMiss.id), JSON.stringify(dlRounds.map(r => r.song_title)));
  ok('later rounds close the numbering gap', (dlRounds.find(r => r.id === dlKeep.id) || {}).idx === 3,
    JSON.stringify(dlRounds.map(r => [r.idx, r.song_title])));
  // The real cost of a gap: idx is assigned as (started rounds)+1, so an un-renumbered
  // hole makes the NEXT record reuse a number already on the board.
  await call('/api/admin/round', { sessionId: SGID, song_title: 'No Collision' }, 'POST', SGAH);
  const dlNext = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d.activeRound;
  ok('the next record numbers #4, not a duplicate #3', dlNext.idx === 4, 'idx ' + dlNext.idx);
  await call('/api/admin/round/unopen', { sessionId: SGID, roundId: dlNext.id }, 'POST', SGAH);
  // Scores are untouched: the surviving round's vote still carries its points.
  const dlSt = (await call(`/api/admin/state?sessionId=${SGID}`, null, 'GET', SGAH)).d;
  ok('the surviving round keeps its evaluations', (dlRounds.find(r => r.id === dlKeep.id) || {}).votes === 1,
    JSON.stringify(dlRounds.map(r => [r.song_title, r.votes])));
  ok('deleting a round does not disturb the room', dlSt.session.status === 'live', dlSt.session.status);

  console.log('\n— external control (Stream Deck): key auth, scope, live-room resolution —');
  // The key hangs off the HOST, and resolves to whichever room they have live — so a deck
  // is configured once and never re-pointed.
  const ckMint = await call('/api/me/control-key', {}, 'POST', BOOTH);
  ok('host can mint a control key', ckMint.status === 200 && /^k_/.test(ckMint.d.key || ''), JSON.stringify(ckMint.d));
  const CK = ckMint.d.key;
  const ckNoAuth = await call('/api/me/control-key', {}, 'POST');
  ok('minting requires a signed-in host', ckNoAuth.status === 401, 'got ' + ckNoAuth.status);
  const ckBad = await call('/api/control/state?k=k_totallywrongkey', null, 'GET');
  ok('a bad key is rejected', ckBad.status === 401, 'got ' + ckBad.status);
  const ckNone = await call('/api/control/state', null, 'GET');
  ok('a missing key is rejected', ckNone.status === 401, 'got ' + ckNone.status);
  const ckUnknown = await call(`/api/control/purge?k=${CK}`, null, 'GET');
  ok('unknown control actions are refused (scope is round control only)', ckUnknown.status === 404, 'got ' + ckUnknown.status);

  // Drive the staged room from the "deck". Explicit room id, since BOOTH owns several.
  const ckState = await call(`/api/control/state?k=${CK}&s=${SGID}`, null, 'GET');
  ok('control/state reports the next action', ckState.status === 200 && ckState.d.action === 'open', JSON.stringify(ckState.d));
  ok('control/state leaks no A&R PII', !JSON.stringify(ckState.d).includes('@test.com'));
  await call('/api/admin/round', { sessionId: SGID, song_title: 'Deck Driven' }, 'POST', SGAH);
  const ckAdv1 = await call(`/api/control/advance?k=${CK}&s=${SGID}`, null, 'GET');
  ok('deck advance starts voting on the listening round', ckAdv1.d.action === 'vote' && ckAdv1.d.status === 'voting', JSON.stringify(ckAdv1.d));
  const ckExt = await call(`/api/control/extend?k=${CK}&s=${SGID}&seconds=30`, null, 'GET');
  ok('deck can add time', ckExt.status === 200 && ckExt.d.added === 30, JSON.stringify(ckExt.d));
  await call('/api/vote', { taste: 7, predict: 7 }, 'POST', { 'X-Player-Token': sg2 });
  const ckArm = await call(`/api/control/advance?k=${CK}&s=${SGID}`, null, 'GET');
  ok('deck ratify ALSO needs two presses', ckArm.d.confirmNeeded === true, JSON.stringify(ckArm.d));
  const ckFire = await call(`/api/control/advance?k=${CK}&s=${SGID}`, null, 'GET');
  ok('deck second press tallies', ckFire.d.confirmNeeded === false && ckFire.d.room_average != null, JSON.stringify(ckFire.d));
  // The arm is shared state, so a console press can confirm a deck press and vice versa —
  // that's intended (one guard, not two), and worth pinning down.
  const ckHeaderAuth = await call(`/api/control/state?s=${SGID}`, null, 'GET', { 'X-Control-Key': CK });
  ok('the key also works as a header (not just the query string)', ckHeaderAuth.status === 200, 'got ' + ckHeaderAuth.status);
  // A regenerated key must invalidate the old one immediately.
  const ckRoll = await call('/api/me/control-key', {}, 'POST', BOOTH);
  ok('regenerating issues a different key', ckRoll.d.key && ckRoll.d.key !== CK);
  const ckStale = await call(`/api/control/state?k=${CK}&s=${SGID}`, null, 'GET');
  ok('the old key stops working the moment it is rolled', ckStale.status === 401, 'got ' + ckStale.status);
  // A host can only reach their OWN rooms. HKLIVE belongs to a different host account.
  const ckForeign = await call(`/api/control/state?k=${ckRoll.d.key}&s=${HKLIVE}`, null, 'GET');
  ok("a key can't drive another host's room", ckForeign.status === 404, 'got ' + ckForeign.status);
  // And the other host's own key resolves to their live room with no room id at all —
  // the property that lets a Stream Deck be configured once and never re-pointed.
  const hkKey = (await call('/api/me/control-key', {}, 'POST', HKH)).d.key;
  // (Which room specifically depends on what earlier tests left live vs upcoming — the
  // property under test is that it resolves to one of THEIR rooms with no id supplied.)
  const hkAuto = await call(`/api/control/state?k=${hkKey}`, null, 'GET');
  ok('a bare key auto-resolves to that host\'s own room', hkAuto.status === 200 && /^HK /.test(hkAuto.d.room || ''), JSON.stringify(hkAuto.d));

  console.log('\n— referral bonus milestones: 10 rounds → +10, 50 → +75 —');
  const rbSer = await call('/api/admin/series/create', { title: 'Referral Bonus Series', status: 'active' }, 'POST', ADMINH);
  const rbC = await call('/api/session', { name: 'Referral Night' }, 'POST', BOOTH);
  const RBID = rbC.d.sessionId, RBAH = { 'X-Admin-Token': rbC.d.adminToken };
  await call('/api/admin/series/tag', { sessionId: RBID, seriesId: rbSer.d.seriesId }, 'POST', ADMINH);
  // Ray (the referrer) takes a seat and shares his code.
  const rayJr = await call('/api/join/request', { sessionId: RBID, email: 'ray.referrer@fan.com' });
  const rayVer = await call('/api/join/verify', { sessionId: RBID, email: 'ray.referrer@fan.com', code: rayJr.d.devCode, name: 'Ray Referrer' });
  const RAY = { 'X-Player-Token': rayVer.d.token };
  const RAYCODE = ((await call('/api/me/state', null, 'GET', RAY)).d.referral || {}).refCode
    || (await call('/api/me/state', null, 'GET', RAY)).d.refCode;
  ok('referrer has a share code', !!RAYCODE, JSON.stringify(RAYCODE));
  // Nia is a BRAND-NEW account arriving on Ray's link → durable first-touch.
  const niaJr = await call('/api/join/request', { sessionId: RBID, email: 'nia.new@fan.com' });
  const niaVer = await call('/api/join/verify', { sessionId: RBID, email: 'nia.new@fan.com', code: niaJr.d.devCode, name: 'Nia New', ref: RAYCODE });
  const NIA = { 'X-Player-Token': niaVer.d.token };
  // Maya (a@test.com) is a VETERAN account with a long round history — joining on Ray's
  // code must NOT attach attribution (else her history would fire both milestones).
  const mayJr = await call('/api/join/request', { sessionId: RBID, email: 'a@test.com' });
  const mayVer = await call('/api/join/verify', { sessionId: RBID, email: 'a@test.com', code: mayJr.d.devCode, name: 'Maya', ref: RAYCODE });
  const MAYA_RB = { 'X-Player-Token': mayVer.d.token };

  const rayOnBoard = async () => {
    const lb = (await call(`/api/admin/series/leaderboard?seriesId=${rbSer.d.seriesId}`, null, 'GET', ADMINH)).d.leaderboard;
    return lb.find(r => r.email === 'ray.referrer@fan.com') || null;
  };
  // One scored round: add (auto-opens) → Nia votes (Maya too, for the veteran check) → ratify.
  let rbRound = 0;
  const playRound = async () => {
    rbRound++;
    const r = await call('/api/admin/round', { sessionId: RBID, song_title: 'RB ' + rbRound }, 'POST', RBAH);
    await startVoting(RBID, RBAH);
    await call('/api/vote', { taste: 6, predict: 6 }, 'POST', NIA);
    if (rbRound === 1) await call('/api/vote', { taste: 4, predict: 5 }, 'POST', MAYA_RB);
    await call('/api/admin/round/ratify', { sessionId: RBID, roundId: r.d.roundId }, 'POST', RBAH);
  };
  for (let i = 0; i < 9; i++) await playRound();
  let ray = await rayOnBoard();
  ok('no bonus before the 10th round', !ray || ray.points === 0, JSON.stringify(ray));
  ok('veteran joining via a code fires nothing (first-touch is new accounts only)', !ray || ray.points === 0, JSON.stringify(ray));
  await playRound(); // Nia's 10th scored round
  ray = await rayOnBoard();
  ok('10th round pays the referrer +10 on the series board', ray && ray.points === 10, JSON.stringify(ray));
  await playRound(); // 11th — same milestone must not re-fire
  ray = await rayOnBoard();
  ok('milestone is once-ever (11th round adds nothing)', ray && ray.points === 10, JSON.stringify(ray));
  while (rbRound < 50) await playRound();
  ray = await rayOnBoard();
  ok('50th round pays +75 more (85 total per invitee)', ray && ray.points === 85, JSON.stringify(ray));
  // Lifetime rolls up alongside the series board.
  const rayUser = (((await call('/api/admin/users?q=ray.referrer', null, 'GET', ADMINH)).d.users) || []).find(u => u.email === 'ray.referrer@fan.com');
  ok('referrer lifetime total carries the bonus', rayUser && rayUser.points === 85, JSON.stringify(rayUser && rayUser.points));
  // Nia's own score is untouched by the bonus machinery (50 rounds of her votes).
  const niaState = (await call('/api/me/state', null, 'GET', NIA)).d;
  ok('invitee keeps only her own vote points', niaState.totalPoints == null || typeof niaState.totalPoints === 'number', 'state ok');

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATION CONTACT CENTER (028)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n— notification contact center: defaults resolve with NO rows written —');
  const npDb = require('./db');
  process.env.NOTIFY_LINK_SECRET = 'test-notify-link-secret';
  // A fresh account that has never touched the settings page.
  const freshReq = await call('/api/auth/request', { email: 'prefs-fresh@test.com' });
  const freshVer = await call('/api/auth/verify', { email: 'prefs-fresh@test.com', code: freshReq.d.devCode, name: 'Fresh Ears' });
  const FRESH = { 'X-Auth-Token': freshVer.d.token };
  const freshUid = freshVer.d.uid;
  const fp = await call('/api/me/notify-prefs', null, 'GET', FRESH);
  ok('room_live email defaults ON', fp.status === 200 && fp.d.topics.room_live.channels.email === true, JSON.stringify(fp.d.topics));
  ok('room_live sms defaults ON', fp.d.topics.room_live.channels.sms === true, JSON.stringify(fp.d.topics.room_live));
  ok('daily digest defaults OFF', fp.d.topics.digest_daily.channels.email === false, JSON.stringify(fp.d.topics.digest_daily));
  ok('weekly digest defaults OFF', fp.d.topics.digest_weekly.channels.email === false, JSON.stringify(fp.d.topics.digest_weekly));
  ok('SMS not offered for a digest', fp.d.topics.digest_daily.channels.sms === undefined, JSON.stringify(fp.d.topics.digest_daily.channels));
  // THE no-backfill assertion: those defaults came from the catalog, not from rows.
  const freshRows = Number((await npDb.get('SELECT COUNT(*) AS c FROM notify_prefs WHERE uid = ?', [freshUid])).c);
  ok('defaults are resolved with ZERO stored rows (no backfill)', freshRows === 0, 'rows ' + freshRows);

  console.log('\n— saving prefs writes rows and marks an explicit SMS decision —');
  const savedPrefs = await call('/api/me/notify-prefs',
    { topics: { digest_weekly: { email: true }, room_live: { sms: false } } }, 'POST', FRESH);
  ok('save returns the resolved set', savedPrefs.status === 200 && savedPrefs.d.topics.digest_weekly.channels.email === true, JSON.stringify(savedPrefs.d.topics));
  ok('room_live sms now off', savedPrefs.d.topics.room_live.channels.sms === false, JSON.stringify(savedPrefs.d.topics.room_live));
  ok('untouched topic still resolves to its default', savedPrefs.d.topics.room_live.channels.email === true, JSON.stringify(savedPrefs.d.topics.room_live));
  const freshUser = await npDb.get('SELECT sms_pref_set_at FROM users WHERE uid = ?', [freshUid]);
  ok('touching an SMS topic marks the explicit decision', freshUser.sms_pref_set_at != null, JSON.stringify(freshUser));
  // Unknown topics and unoffered channels are dropped, never stored.
  await call('/api/me/notify-prefs', { topics: { not_a_topic: { email: true }, digest_daily: { sms: true } } }, 'POST', FRESH);
  const junk = Number((await npDb.get("SELECT COUNT(*) AS c FROM notify_prefs WHERE uid = ? AND (topic = 'not_a_topic' OR channel = 'sms' AND topic = 'digest_daily')", [freshUid])).c);
  ok('unknown topic / unoffered channel are never written', junk === 0, 'rows ' + junk);

  console.log('\n— phone on file + SMS master OFF (the bug 028 exists to fix) —');
  const optReq = await call('/api/auth/request', { email: 'prefs-optout@test.com' });
  const optVer = await call('/api/auth/verify', { email: 'prefs-optout@test.com', code: optReq.d.devCode, name: 'Opt Out', phone: '4045559911' });
  const OPT = { 'X-Auth-Token': optVer.d.token };
  const optUid = optVer.d.uid;
  const beforeOpt = await npDb.get('SELECT phone, sms_marketing_consent FROM users WHERE uid = ?', [optUid]);
  ok('phone presence consented them at signup (unchanged behaviour)', Number(beforeOpt.sms_marketing_consent) === 1, JSON.stringify(beforeOpt));
  const offRes = await call('/api/me/notify-prefs', { smsConsent: false }, 'POST', OPT);
  ok('master off reports smsConsent false', offRes.status === 200 && offRes.d.smsConsent === false, JSON.stringify(offRes.d.smsConsent));
  const afterOpt = await npDb.get('SELECT phone, sms_marketing_consent, sms_consent_at, sms_optout_at FROM users WHERE uid = ?', [optUid]);
  ok('THE FIX: phone still on file while opted out', !!afterOpt.phone && Number(afterOpt.sms_marketing_consent) === 0, JSON.stringify(afterOpt));
  ok('the grant timestamp is never cleared (consent history)', afterOpt.sms_consent_at != null, JSON.stringify(afterOpt.sms_consent_at));
  ok('the withdrawal is timestamped too', afterOpt.sms_optout_at != null, JSON.stringify(afterOpt.sms_optout_at));
  // ...and they're out of the SMS audience but still in the email one.
  const audOff = await call('/api/admin/notify/topics', null, 'GET', BOOTH);
  const rl = audOff.d.topics.find(t => t.key === 'room_live');
  ok('audience readout is admin-visible', audOff.status === 200 && rl && typeof rl.channels.sms.count === 'number', JSON.stringify(rl));

  console.log('\n— an explicit opt-out survives re-joining a room —');
  const rejoinSess = await call('/api/session', { name: 'Rejoin Room' }, 'POST', BOOTH);
  const rejoinSid = rejoinSess.d.sessionId;
  const rjReq = await call('/api/join/request', { sessionId: rejoinSid, email: 'prefs-optout@test.com' });
  await call('/api/join/verify', { sessionId: rejoinSid, email: 'prefs-optout@test.com', code: rjReq.d.devCode, name: 'Opt Out', phone: '4045559911' });
  const afterRejoin = await npDb.get('SELECT phone, sms_marketing_consent FROM users WHERE uid = ?', [optUid]);
  ok('re-typing the phone does NOT resurrect consent', Number(afterRejoin.sms_marketing_consent) === 0, JSON.stringify(afterRejoin));
  ok('the number is still saved (a number is data)', !!afterRejoin.phone, JSON.stringify(afterRejoin.phone));
  const rjPart = await npDb.get('SELECT sms_marketing_consent FROM participants WHERE session_id = ? AND user_id = ?', [rejoinSid, optUid]);
  ok('the per-session snapshot mirrors the opt-out', Number(rjPart.sms_marketing_consent) === 0, JSON.stringify(rjPart));
  // The one-tap account path is the third derivation site and the easiest to miss.
  const tapSess = await call('/api/session', { name: 'One Tap Room' }, 'POST', BOOTH);
  await call('/api/join/account', { sessionId: tapSess.d.sessionId }, 'POST', OPT);
  const tapUser = await npDb.get('SELECT sms_marketing_consent FROM users WHERE uid = ?', [optUid]);
  const tapPart = await npDb.get('SELECT sms_marketing_consent FROM participants WHERE session_id = ? AND user_id = ?', [tapSess.d.sessionId, optUid]);
  ok('one-tap join does not resurrect consent either', Number(tapUser.sms_marketing_consent) === 0, JSON.stringify(tapUser));
  ok('one-tap snapshot mirrors the opt-out', Number(tapPart.sms_marketing_consent) === 0, JSON.stringify(tapPart));

  console.log('\n— an explicit opt-IN is equally sticky (the other direction) —');
  const inReq = await call('/api/auth/request', { email: 'prefs-optin@test.com' });
  const inVer = await call('/api/auth/verify', { email: 'prefs-optin@test.com', code: inReq.d.devCode, name: 'Opt In', phone: '4045558822' });
  const INH = { 'X-Auth-Token': inVer.d.token }, inUid = inVer.d.uid;
  await call('/api/me/notify-prefs', { smsConsent: true }, 'POST', INH);
  const inSess = await call('/api/session', { name: 'Sticky In Room' }, 'POST', BOOTH);
  const inJoin = await call('/api/join/request', { sessionId: inSess.d.sessionId, email: 'prefs-optin@test.com' });
  // Joining with NO phone and no keepPhone would previously withdraw consent.
  await call('/api/join/verify', { sessionId: inSess.d.sessionId, email: 'prefs-optin@test.com', code: inJoin.d.devCode, name: 'Opt In', phone: '' });
  const inAfter = await npDb.get('SELECT sms_marketing_consent FROM users WHERE uid = ?', [inUid]);
  ok('joining without a phone does NOT revoke an explicit opt-in', Number(inAfter.sms_marketing_consent) === 1, JSON.stringify(inAfter));

  console.log('\n— the register checkbox, on all three registration paths —');
  // Path 1: /api/auth/verify (team signup)
  const cbAReq = await call('/api/auth/request', { email: 'cb-auth@test.com' });
  const cbAVer = await call('/api/auth/verify', { email: 'cb-auth@test.com', code: cbAReq.d.devCode, name: 'CB Auth', notifyRooms: false });
  const cbAUid = cbAVer.d.uid;
  const cbARows = await npDb.all("SELECT channel, enabled FROM notify_prefs WHERE uid = ? AND topic = 'room_live'", [cbAUid]);
  ok('auth/verify: unchecked writes room_live off on both channels',
    cbARows.length === 2 && cbARows.every(r => Number(r.enabled) === 0), JSON.stringify(cbARows));
  // Path 2: /api/join/verify (the main room register step)
  const cbSess = await call('/api/session', { name: 'Checkbox Room' }, 'POST', BOOTH);
  const cbJReq = await call('/api/join/request', { sessionId: cbSess.d.sessionId, email: 'cb-join@test.com' });
  await call('/api/join/verify', { sessionId: cbSess.d.sessionId, email: 'cb-join@test.com', code: cbJReq.d.devCode, name: 'CB Join', notifyRooms: false });
  const cbJUid = (await npDb.get('SELECT uid FROM users WHERE email = ?', ['cb-join@test.com'])).uid;
  const cbJRows = await npDb.all("SELECT channel, enabled FROM notify_prefs WHERE uid = ? AND topic = 'room_live'", [cbJUid]);
  ok('join/verify: unchecked writes room_live off on both channels',
    cbJRows.length === 2 && cbJRows.every(r => Number(r.enabled) === 0), JSON.stringify(cbJRows));
  // Path 3: /api/join/account (one-tap) — and checking it turns them back ON.
  const cbTapSess = await call('/api/session', { name: 'Checkbox Tap Room' }, 'POST', BOOTH);
  const CBJ = { 'X-Auth-Token': (await call('/api/auth/verify', { email: 'cb-join@test.com', code: (await call('/api/auth/request', { email: 'cb-join@test.com' })).d.devCode })).d.token };
  await call('/api/join/account', { sessionId: cbTapSess.d.sessionId, notifyRooms: true }, 'POST', CBJ);
  const cbTapRows = await npDb.all("SELECT channel, enabled FROM notify_prefs WHERE uid = ? AND topic = 'room_live'", [cbJUid]);
  ok('join/account: checked turns room_live back on', cbTapRows.length === 2 && cbTapRows.every(r => Number(r.enabled) === 1), JSON.stringify(cbTapRows));
  // Omitting the field entirely must write nothing — this is what keeps every older
  // client (and every other test in this file) behaving exactly as before.
  const cbNoneReq = await call('/api/auth/request', { email: 'cb-absent@test.com' });
  const cbNoneVer = await call('/api/auth/verify', { email: 'cb-absent@test.com', code: cbNoneReq.d.devCode, name: 'CB Absent' });
  const cbNoneRows = Number((await npDb.get('SELECT COUNT(*) AS c FROM notify_prefs WHERE uid = ?', [cbNoneVer.d.uid])).c);
  ok('omitting notifyRooms writes NOTHING (old clients never unsubscribe anyone)', cbNoneRows === 0, 'rows ' + cbNoneRows);

  console.log('\n— go-live honours the checkbox —');
  // Sessions are created 'live' by default, so the room has to start 'upcoming' for the
  // go-live transition (and therefore the notify fan-out) to actually happen.
  const glSess = await call('/api/session', { name: 'Gate Room', status: 'upcoming' }, 'POST', BOOTH);
  const glSid = glSess.d.sessionId;
  async function gateJoin(email, name, phone, notifyRooms) {
    const rq = await call('/api/join/request', { sessionId: glSid, email });
    const body = { sessionId: glSid, email, code: rq.d.devCode, name, phone };
    if (notifyRooms !== undefined) body.notifyRooms = notifyRooms;
    await call('/api/join/verify', body);
  }
  await gateJoin('gate-yes@test.com', 'Gate Yes', '3055550001', true);
  await gateJoin('gate-no@test.com', 'Gate No', '3055550002', false);
  await call('/api/admin/session/status', { sessionId: glSid, status: 'live', notify: { email: true, sms: true } }, 'POST', BOOTH);
  const glLog = await npDb.all(
    `SELECT p.email, n.channel FROM notification_log n JOIN participants p ON p.id = n.participant_id WHERE n.session_id = ?`, [glSid]);
  const yesCh = glLog.filter(r => r.email === 'gate-yes@test.com').map(r => r.channel).sort();
  const noCh = glLog.filter(r => r.email === 'gate-no@test.com').map(r => r.channel);
  ok('subscribed A&R gets both channels', yesCh.join(',') === 'email,sms', JSON.stringify(yesCh));
  ok('unsubscribed A&R gets NOTHING on go-live', noCh.length === 0, JSON.stringify(noCh));

  console.log('\n— unsubscribe-all + the email kill switch —');
  const audBefore = (await call('/api/admin/notify/audience', null, 'GET', BOOTH)).d;
  const unsub = await call('/api/me/notify-prefs/unsubscribe-all', {}, 'POST', FRESH);
  ok('unsubscribe-all succeeds', unsub.status === 200 && unsub.d.ok === true, JSON.stringify(unsub.d));
  const afterUnsub = (await call('/api/me/notify-prefs', null, 'GET', FRESH)).d;
  ok('everything is off afterwards', afterUnsub.emailOptOut === true
    && afterUnsub.topics.room_live.channels.email === false
    && afterUnsub.topics.digest_weekly.channels.email === false, JSON.stringify(afterUnsub.topics));
  const audAfter = (await call('/api/admin/notify/audience', null, 'GET', BOOTH)).d;
  ok('the mass-announcement audience shrinks by exactly one', audAfter.email === audBefore.email - 1,
    JSON.stringify([audBefore.email, audAfter.email]));
  const bcast = await call('/api/admin/notify/start', { subject: 'Hi', message: 'Hello A&Rs', email: true }, 'POST', BOOTH);
  const queued = await npDb.get('SELECT COUNT(*) AS c FROM notify_recipients WHERE broadcast_id = ? AND uid = ?', [bcast.d.broadcastId, freshUid]);
  ok('an unsubscribed A&R is never queued for a broadcast', Number(queued.c) === 0, JSON.stringify(queued));

  console.log('\n— manage-link token: scope, tamper, expiry, masking —');
  const linkTok = require('./server')._mintNotifyLink(optUid);
  ok('a link token is minted when the secret is set', typeof linkTok === 'string' && linkTok.startsWith('np1.'), String(linkTok));
  const LINKH = { 'X-Notify-Link': linkTok };
  const linkGet = await call('/api/me/notify-prefs', null, 'GET', LINKH);
  ok('the token reads the prefs it is scoped to', linkGet.status === 200 && !!linkGet.d.topics, JSON.stringify(linkGet.status));
  ok('contact details come back MASKED', linkGet.d.email === 'p•••@test.com' && linkGet.d.phone === '••• 9911', JSON.stringify([linkGet.d.email, linkGet.d.phone]));
  ok('the full email/phone never appear in the body', !JSON.stringify(linkGet.d).includes('prefs-optout@test.com') && !JSON.stringify(linkGet.d).includes('4045559911'));
  ok('the token advertises that it cannot edit the phone', linkGet.d.canEditPhone === false, JSON.stringify(linkGet.d.canEditPhone));
  const linkPhone = await call('/api/me/notify-prefs', { phone: '9995551234' }, 'POST', LINKH);
  ok('a link holder CANNOT redirect the phone number', linkPhone.status === 403, 'status ' + linkPhone.status);
  const stillPhone = await npDb.get('SELECT phone FROM users WHERE uid = ?', [optUid]);
  ok('...and the number really is unchanged', stillPhone.phone === '4045559911', JSON.stringify(stillPhone));
  // SCOPE: the token must not authenticate anything else. This is the assertion that
  // keeps the guarantee true as the codebase grows.
  for (const [path, label] of [['/api/me/profile', 'profile'], ['/api/auth/me', 'auth/me'], ['/api/admin/notify/audience', 'admin audience']]) {
    const r = await call(path, null, 'GET', LINKH);
    ok(`link token is rejected by ${label}`, r.status === 401 || r.status === 403, 'status ' + r.status);
  }
  const tampered = linkTok.slice(0, -1) + (linkTok.slice(-1) === 'A' ? 'B' : 'A');
  const tamperRes = await call('/api/me/notify-prefs', null, 'GET', { 'X-Notify-Link': tampered });
  ok('a tampered signature is rejected', tamperRes.status === 401 && tamperRes.d.error === 'bad_link', JSON.stringify(tamperRes.d));
  ok('malformed and tampered are indistinguishable',
    (await call('/api/me/notify-prefs', null, 'GET', { 'X-Notify-Link': 'garbage' })).d.error === 'bad_link');
  const expiredMsg = `np1.${optUid}.1000000000`;
  const expiredSig = require('crypto').createHmac('sha256', 'test-notify-link-secret').update(expiredMsg).digest('base64url');
  const expRes = await call('/api/me/notify-prefs', null, 'GET', { 'X-Notify-Link': `${expiredMsg}.${expiredSig}` });
  ok('an expired token is rejected, and says so', expRes.status === 401 && expRes.d.error === 'link_expired', JSON.stringify(expRes.d));
  // Fails CLOSED with no secret — but header auth keeps working.
  delete process.env.NOTIFY_LINK_SECRET;
  const noSecret = await call('/api/me/notify-prefs', null, 'GET', LINKH);
  ok('no secret => link auth fails closed (503)', noSecret.status === 503, 'status ' + noSecret.status);
  ok('no secret => minting returns null', require('./server')._mintNotifyLink(optUid) === null);
  const headerStillWorks = await call('/api/me/notify-prefs', null, 'GET', OPT);
  ok('no secret => header auth is unaffected', headerStillWorks.status === 200, 'status ' + headerStillWorks.status);
  process.env.NOTIFY_LINK_SECRET = 'test-notify-link-secret';

  console.log('\n— prefs are deleted with the account —');
  const delRows = Number((await npDb.get('SELECT COUNT(*) AS c FROM notify_prefs WHERE uid = ?', [cbAUid])).c);
  ok('the doomed account has prefs to delete', delRows > 0, 'rows ' + delRows);
  const delRes = await call('/api/admin/users/delete', { uid: cbAUid, confirmName: 'CB Auth' }, 'POST', BOOTH);
  ok('account hard-deleted', delRes.status === 200, JSON.stringify(delRes.d));
  const delAfter = Number((await npDb.get('SELECT COUNT(*) AS c FROM notify_prefs WHERE uid = ?', [cbAUid])).c);
  ok('prefs die with the account', delAfter === 0, 'rows ' + delAfter);

  // ============================ CHARTS ("Makin' It HOT 100") ============================
  console.log('\n— charts: the min-vote floor ranks and excludes, it never reweights —');
  const chSeries = await call('/api/admin/series/create', { title: 'Chart Series', status: 'active' }, 'POST', ADMINH);
  const CHSER = chSeries.d.seriesId;
  // Five A&Rs, so a round can carry anywhere from 2 to 5 votes and cross a floor of 3.
  const chVoters = [];
  const chRoom = async name => {
    const c = await call('/api/session', { name }, 'POST', BOOTH);
    await call('/api/admin/series/tag', { sessionId: c.d.sessionId, seriesId: CHSER }, 'POST', ADMINH);
    return { id: c.d.sessionId, h: { 'X-Admin-Token': c.d.adminToken } };
  };
  const chSeat = async (room, email, name) => {
    const rq = await call('/api/join/request', { sessionId: room.id, email });
    const vr = await call('/api/join/verify', { sessionId: room.id, email, code: rq.d.devCode, name });
    return { 'X-Player-Token': vr.d.token };
  };
  // `tastes` drives both the room average and the vote count.
  const chPlay = async (room, seats, title, artist, tastes, note) => {
    const ar = await call('/api/admin/round', { sessionId: room.id, song_title: title, song_artist: artist, song_note: note || null }, 'POST', room.h);
    await startVoting(room.id, room.h);
    const rid = ar.d.roundId;
    if (!ar.d.opened) await call('/api/admin/round/open', { sessionId: room.id, roundId: rid, minutes: 5 }, 'POST', room.h);
    for (let i = 0; i < tastes.length; i++) await call('/api/vote', { taste: tastes[i], predict: 5 }, 'POST', seats[i]);
    await call('/api/admin/round/close', { sessionId: room.id, roundId: rid }, 'POST', room.h);
    await call('/api/admin/round/ratify', { sessionId: room.id, roundId: rid }, 'POST', room.h);
    return rid;
  };

  const chR1 = await chRoom('Chart Room One');
  const chSeats1 = [];
  for (const [e, n] of [['ch1@fan.com', 'Cee One'], ['ch2@fan.com', 'Cee Two'], ['ch3@fan.com', 'Cee Three'], ['ch4@fan.com', 'Cee Four'], ['ch5@fan.com', 'Cee Five']]) chSeats1.push(await chSeat(chR1, e, n));
  chVoters.push(...chSeats1);
  // 5 votes, avg 7.0 — the honest chart-topper.
  await chPlay(chR1, chSeats1, 'Broad Appeal', 'Big Room', [9, 8, 7, 6, 5], 'IG: bigroom');
  // 2 votes, avg 9.0 — the trap the floor exists to catch.
  await chPlay(chR1, chSeats1, 'Tiny Sample', 'Two Voters', [9, 9]);
  // 4 votes, avg 6.0.
  await chPlay(chR1, chSeats1, 'Solid Middle', 'Mid Artist', [7, 6, 6, 5]);

  const chR2 = await chRoom('Chart Room Two');
  const chSeats2 = [];
  for (const [e, n] of [['ch1@fan.com', 'Cee One'], ['ch2@fan.com', 'Cee Two'], ['ch3@fan.com', 'Cee Three'], ['ch4@fan.com', 'Cee Four']]) chSeats2.push(await chSeat(chR2, e, n));
  // Same record, replayed in a later room and doing WORSE — the dedupe case.
  await chPlay(chR2, chSeats2, 'broad  appeal!', 'Big Room', [5, 5, 4, 4]);
  await chPlay(chR2, chSeats2, 'Room Two Best', 'Second Night', [6, 6, 5, 5]);

  const chGet = (q) => call('/api/admin/charts?' + q, null, 'GET', ADMINH);
  const chBase = `scope=series&seriesId=${CHSER}&minVotes=3`;

  const chTop = await chGet(chBase);
  ok('charts: admin can pull a series chart', chTop.status === 200, JSON.stringify(chTop.d).slice(0, 200));
  const titles = chTop.d.rows.map(r => r.title);
  ok('charts: the 2-vote 9.0 does NOT chart', !titles.includes('Tiny Sample'), JSON.stringify(titles));
  ok('charts: it is reported as excluded, not vanished', chTop.d.excluded.some(r => r.title === 'Tiny Sample'), JSON.stringify(chTop.d.excluded.map(r => r.title)));
  ok('charts: the excluded count is real', chTop.d.summary.excluded === 1, 'excluded ' + chTop.d.summary.excluded);
  ok('charts: #1 is the 5-voter 7.0', chTop.d.rows[0].title === 'Broad Appeal' && chTop.d.rows[0].score === 7, JSON.stringify(chTop.d.rows[0]));
  ok('charts: the printed score is the REAL room average (not shrunk)', chTop.d.rows[0].score === 7 && chTop.d.rows[0].votes === 5, JSON.stringify(chTop.d.rows[0]));
  ok('charts: IG is parsed out of the note', chTop.d.rows[0].ig === 'bigroom', String(chTop.d.rows[0].ig));
  ok('charts: ranks are 1..n with no gaps', chTop.d.rows.every((r, i) => r.rank === i + 1));

  ok('charts: a replayed record charts ONCE', titles.filter(t => /broad/i.test(t)).length === 1, JSON.stringify(titles));
  ok('charts: ...at its BEST showing, with the repeat counted', chTop.d.rows[0].plays === 2, JSON.stringify(chTop.d.rows[0]));
  const cDup = await chGet(chBase + '&dedupe=0');
  ok('charts: dedupe=0 charts both plays', cDup.d.rows.filter(r => /broad/i.test(r.title)).length === 2, JSON.stringify(cDup.d.rows.map(r => r.title)));

  console.log('\n— charts: the floor is a knob, and order/limit are presentation only —');
  const cLow = await chGet(`scope=series&seriesId=${CHSER}&minVotes=0`);
  ok('charts: dropping the floor lets the small sample top the chart', cLow.d.rows[0].title === 'Tiny Sample', JSON.stringify(cLow.d.rows.map(r => r.title)));
  ok('charts: ...and nothing is excluded at a floor of 0', cLow.d.summary.excluded === 0, 'excluded ' + cLow.d.summary.excluded);
  const cCount = await chGet(chBase + '&order=countdown');
  ok('charts: countdown reverses the rows', cCount.d.rows[0].rank === chTop.d.rows.length && cCount.d.rows[cCount.d.rows.length - 1].rank === 1, JSON.stringify(cCount.d.rows.map(r => r.rank)));
  ok('charts: countdown keeps the same #1 record', cCount.d.rows[cCount.d.rows.length - 1].title === chTop.d.rows[0].title);
  const cLim = await chGet(chBase + '&limit=2');
  ok('charts: limit truncates the chart', cLim.d.rows.length === 2, 'rows ' + cLim.d.rows.length);
  ok('charts: ...but the pool count still reports everything', cLim.d.summary.charting === chTop.d.summary.charting, JSON.stringify(cLim.d.summary));

  console.log('\n— charts: Versus rounds never chart (a split is not an average) —');
  const chBin = await chRoom('Chart Versus Room');
  const bSeats = [];
  for (const [e, n] of [['ch1@fan.com', 'Cee One'], ['ch2@fan.com', 'Cee Two'], ['ch3@fan.com', 'Cee Three']]) bSeats.push(await chSeat(chBin, e, n));
  const bAdd = await call('/api/admin/round', { sessionId: chBin.id, song_title: 'Versus A', option_b_title: 'Versus B', poll_type: 'binary' }, 'POST', chBin.h);
  await startVoting(chBin.id, chBin.h);
  if (!bAdd.d.opened) await call('/api/admin/round/open', { sessionId: chBin.id, roundId: bAdd.d.roundId, minutes: 5 }, 'POST', chBin.h);
  for (const s of bSeats) await call('/api/vote', { pick: 'a', predict_split: 60 }, 'POST', s);
  await call('/api/admin/round/close', { sessionId: chBin.id, roundId: bAdd.d.roundId }, 'POST', chBin.h);
  await call('/api/admin/round/ratify', { sessionId: chBin.id, roundId: bAdd.d.roundId }, 'POST', chBin.h);
  const cAll = await chGet(`scope=series&seriesId=${CHSER}&minVotes=0&limit=1000`);
  ok('charts: a Versus round is absent from the chart', !cAll.d.rows.some(r => /Versus/.test(r.title)), JSON.stringify(cAll.d.rows.map(r => r.title)));
  ok('charts: ...and absent from the excluded list too', !cAll.d.excluded.some(r => /Versus/.test(r.title)));

  console.log('\n— charts: Room #1s takes the top record from each room —');
  const cW = await chGet(`scope=series&seriesId=${CHSER}&mode=weekly1s&minVotes=3`);
  ok('charts: one row per room that ran', cW.d.rows.length >= 2, 'rows ' + cW.d.rows.length);
  const w1 = cW.d.rows.find(r => r.room === 'Chart Room One'), w2 = cW.d.rows.find(r => r.room === 'Chart Room Two');
  ok('charts: room one\'s #1 is its best over the floor', w1 && w1.record && w1.record.title === 'Broad Appeal', JSON.stringify(w1 && w1.record));
  ok('charts: room two\'s #1 is its own best, not the series best', w2 && w2.record && w2.record.title === 'Room Two Best', JSON.stringify(w2 && w2.record));
  ok('charts: a room with nothing over the floor reports null, not silence',
    cW.d.rows.some(r => r.record === null) ? cW.d.rows.filter(r => r.record === null).every(r => !!r.room) : true);

  console.log('\n— charts: Top A&Rs matches the public series board —');
  // The A&R board only ranks QUALIFIED profiles, so complete them — otherwise both the
  // chart and the board come back empty and the comparison proves nothing.
  for (let i = 0; i < chSeats1.length; i++) {
    await call('/api/me/profile', { name: 'Cee ' + i, categories: ['Producer'], primaryCategory: 'Producer', location: 'Atlanta, GA', instagram: 'cee' + i }, 'POST', chSeats1[i]);
  }
  const cA = await chGet(`scope=series&seriesId=${CHSER}&mode=ars`);
  const pubBoard = (await call(`/api/admin/series/leaderboard?seriesId=${CHSER}`, null, 'GET', ADMINH)).d.leaderboard;
  ok('charts: the A&R chart is non-empty', cA.d.rows.length > 0, JSON.stringify(cA.d.rows).slice(0, 200));
  ok('charts: its #1 and points match the series board exactly',
    cA.d.rows[0].points === pubBoard[0].points, JSON.stringify([cA.d.rows[0].points, pubBoard[0].points]));
  ok('charts: A&R rows never carry contact PII',
    cA.d.rows.every(r => !('email' in r) && !('phone' in r)), JSON.stringify(Object.keys(cA.d.rows[0])));

  console.log('\n— charts: CSV and caption carry the same rows as the screen —');
  const chCsvRes = await fetch(`${base}/api/admin/charts?${chBase}&format=csv`, { headers: ADMINH });
  const csvTxt = await chCsvRes.text();
  ok('charts: CSV downloads', chCsvRes.status === 200 && /text\/csv/.test(chCsvRes.headers.get('content-type') || ''), chCsvRes.status + ' ' + chCsvRes.headers.get('content-type'));
  ok('charts: CSV is an attachment', /attachment; filename=/.test(chCsvRes.headers.get('content-disposition') || ''));
  ok('charts: CSV header names the floor-relevant columns', /^rank,title,artist,instagram,room_average,votes,plays/.test(csvTxt));
  ok('charts: CSV has one row per charting record', csvTxt.trim().split('\n').length === chTop.d.rows.length + 1, 'lines ' + csvTxt.trim().split('\n').length);
  ok('charts: CSV excludes what the screen excludes', !/Tiny Sample/.test(csvTxt));
  ok('charts: CSV keeps the repeat-play count', /Broad Appeal.*,2,/.test(csvTxt), csvTxt.split('\n')[1]);
  const capRes = await fetch(`${base}/api/admin/charts?${chBase}&format=caption`, { headers: ADMINH });
  const capTxt = await capRes.text();
  ok('charts: caption returns text', capRes.status === 200 && capTxt.length > 40);
  ok('charts: caption carries the score key', /Keep it in the studio/.test(capTxt) && /Potential Single/.test(capTxt), capTxt.slice(0, 200));
  ok('charts: caption sends artists to /review and viewers to /ANR',
    /makinitmag\.com\/review/.test(capTxt) && /makinitmag\.com\/ANR/.test(capTxt), capTxt.slice(-200));
  ok('charts: caption lists the #1 record', capTxt.includes('1. Broad Appeal'), capTxt.slice(0, 300));

  console.log('\n— charts: the carousel renders, and the band edges do not overlap —');
  const slide0 = await fetch(`${base}/api/card/chart?${chBase}&slide=0`, { headers: ADMINH });
  ok('charts: cover slide renders a PNG', slide0.status === 200 && slide0.headers.get('content-type') === 'image/png', slide0.status);
  const slide1 = await fetch(`${base}/api/card/chart?${chBase}&slide=1`, { headers: ADMINH });
  ok('charts: first list slide renders a PNG', slide1.status === 200 && (await slide1.arrayBuffer()).byteLength > 5000);
  const slideN = await fetch(`${base}/api/card/chart?${chBase}&slide=99`, { headers: ADMINH });
  ok('charts: a slide past the end 404s (the client stops there)', slideN.status === 404, 'status ' + slideN.status);
  const bands = require('./share-cards.js').CHART_BANDS;
  ok('charts: every score lands in exactly one band',
    [0, 2.9, 3, 5.9, 6, 9].every(v => bands.filter(b => v >= b.min && (b.max == null || v < b.max)).length === 1),
    JSON.stringify(bands.map(b => b.range)));

  console.log('\n— charts are platform-admin only —');
  const chHostReq = await call('/api/auth/request', { email: 'host@test.com' });
  const chHostVer = await call('/api/auth/verify', { email: 'host@test.com', code: chHostReq.d.devCode });
  const CHHOST = { 'X-Auth-Token': chHostVer.d.token };
  ok('charts: a host cannot pull the chart', (await chGet(chBase)).status === 403 || (await call('/api/admin/charts?' + chBase, null, 'GET', CHHOST)).status === 403);
  ok('charts: an anonymous request is refused', (await call('/api/admin/charts?' + chBase, null, 'GET')).status === 403);
  const anonCard = await fetch(`${base}/api/card/chart?${chBase}&slide=0`);
  ok('charts: the carousel PNG is not public', anonCard.status === 403, 'status ' + anonCard.status);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n— sidebet: the A&R Wars prediction contest (033) —');
  // ═══════════════════════════════════════════════════════════════════════════
  const SB_WARS = Date.now() + 7 * 24 * 3600 * 1000;
  const SB_CLOSE = SB_WARS - 3600 * 1000;

  ok('sidebet: nothing open reads as no contest',
    (await call('/api/sidebet', null, 'GET')).d.pack === null);

  const sbBad = await call('/api/admin/sidebet',
    { name: 'Bad dates', picksRequired: 6, warsAt: SB_WARS, closesAt: SB_WARS + 1000 }, 'POST', ADMINH);
  ok('sidebet: a cut-off after the tournament is refused', sbBad.status === 400, JSON.stringify(sbBad.d));

  const sbMake = await call('/api/admin/sidebet', {
    name: 'Test Service Pack', picksRequired: 6, prizeText: '$150',
    warsAt: SB_WARS, closesAt: SB_CLOSE, status: 'draft',
  }, 'POST', ADMINH);
  ok('sidebet: iteration created', sbMake.status === 200 && sbMake.d.id, JSON.stringify(sbMake.d));
  const PACK = sbMake.d.id;

  ok('sidebet: a host cannot create an iteration',
    (await call('/api/admin/sidebet', { name: 'x', warsAt: SB_WARS, closesAt: SB_CLOSE }, 'POST', CHHOST)).status === 403);
  ok('sidebet: an anonymous request cannot list iterations',
    (await call('/api/admin/sidebet', null, 'GET')).status === 403);

  // --- songs (CSV rows) ---
  const sbSongs = Array.from({ length: 10 }, (_, i) => ({ title: `Song ${i + 1}`, artist: `Artist ${i + 1}` }));
  ok('sidebet: a duplicate row is refused',
    (await call('/api/admin/sidebet/songs', { packId: PACK, songs: [...sbSongs, sbSongs[0]] }, 'POST', ADMINH)).status === 400);
  ok('sidebet: a row with no title is refused',
    (await call('/api/admin/sidebet/songs', { packId: PACK, songs: [{ title: '', artist: 'x' }] }, 'POST', ADMINH)).status === 400);
  ok('sidebet: fewer songs than picks is refused',
    (await call('/api/admin/sidebet/songs', { packId: PACK, songs: sbSongs.slice(0, 3) }, 'POST', ADMINH)).status === 400);
  const sbLoad = await call('/api/admin/sidebet/songs', { packId: PACK, songs: sbSongs }, 'POST', ADMINH);
  ok('sidebet: 10 songs loaded', sbLoad.status === 200 && sbLoad.d.songs === 10, JSON.stringify(sbLoad.d));

  // --- open it ---
  await call('/api/admin/sidebet', { id: PACK, name: 'Test Service Pack', picksRequired: 6, warsAt: SB_WARS, closesAt: SB_CLOSE, status: 'open' }, 'POST', ADMINH);
  const sbPub = await call('/api/sidebet', null, 'GET');
  ok('sidebet: the open pack is public', sbPub.status === 200 && sbPub.d.pack && sbPub.d.songs.length === 10, JSON.stringify(sbPub.d.pack));
  ok('sidebet: an anonymous read carries no entry', sbPub.d.entry === null);
  // SEALED: the public shape must not leak how many people picked what — the tiebreak
  // ranking is built from it, so a visible count makes copying the crowd optimal.
  ok('sidebet: no pick counts anywhere in the public payload',
    !/\bcount\b|\bpicks?Count\b|\bpopular/i.test(JSON.stringify(sbPub.d)), JSON.stringify(sbPub.d).slice(0, 200));
  ok('sidebet: the public song shape is title/artist only',
    Object.keys(sbPub.d.songs[0]).sort().join(',') === 'artist,id,title');

  // Only one open at a time — /sidebet resolves to a single pack with no disambiguation.
  const sbSecond = await call('/api/admin/sidebet', { name: 'Second', picksRequired: 6, warsAt: SB_WARS, closesAt: SB_CLOSE, status: 'open' }, 'POST', ADMINH);
  ok('sidebet: a second open iteration is refused', sbSecond.status === 400, JSON.stringify(sbSecond.d));

  const SBIDS = sbPub.d.songs.map(s => s.id);

  // --- entering ---
  ok('sidebet: an unverified visitor cannot enter',
    (await call('/api/sidebet/entry', { picks: SBIDS.slice(0, 6) })).status === 401);

  async function sbEntrant(email) {
    const rq = await call('/api/auth/request', { email });
    const vf = await call('/api/auth/verify', { email, code: rq.d.devCode, name: email.split('@')[0] });
    return { 'X-Auth-Token': vf.d.token };
  }
  const E1 = await sbEntrant('bet1@test.com');
  const E2 = await sbEntrant('bet2@test.com');
  const E3 = await sbEntrant('bet3@test.com');

  ok('sidebet: too few picks is refused',
    (await call('/api/sidebet/entry', { picks: SBIDS.slice(0, 3) }, 'POST', E1)).status === 400);
  ok('sidebet: a duplicate pick is refused',
    (await call('/api/sidebet/entry', { picks: [SBIDS[0], SBIDS[0], SBIDS[1], SBIDS[2], SBIDS[3], SBIDS[4]] }, 'POST', E1)).status === 400);
  ok('sidebet: a song outside the pack is refused',
    (await call('/api/sidebet/entry', { picks: [...SBIDS.slice(0, 5), 'not-a-song'] }, 'POST', E1)).status === 400);

  // E1 nails the first six in consensus order; E2 has the same six reversed; E3 misses two.
  const e1 = await call('/api/sidebet/entry', { picks: [SBIDS[0], SBIDS[1], SBIDS[2], SBIDS[3], SBIDS[4], SBIDS[5]] }, 'POST', E1);
  ok('sidebet: entry saved', e1.status === 200 && e1.d.entryNo === 1 && e1.d.edited === false, JSON.stringify(e1.d));
  await call('/api/sidebet/entry', { picks: [SBIDS[5], SBIDS[4], SBIDS[3], SBIDS[2], SBIDS[1], SBIDS[0]] }, 'POST', E2);
  await call('/api/sidebet/entry', { picks: [SBIDS[0], SBIDS[1], SBIDS[2], SBIDS[3], SBIDS[8], SBIDS[9]] }, 'POST', E3);

  const sbMine = await call('/api/sidebet', null, 'GET', E1);
  ok('sidebet: my own entry comes back in order',
    JSON.stringify(sbMine.d.entry.picks) === JSON.stringify([SBIDS[0], SBIDS[1], SBIDS[2], SBIDS[3], SBIDS[4], SBIDS[5]]));
  ok('sidebet: no score before settle', sbMine.d.entry.correct === null && sbMine.d.entry.rank === null);
  ok('sidebet: results are absent before settle', sbMine.d.results === undefined);

  // Editing keeps ONE row (the unique index is what makes "one entry per person" real).
  const e1b = await call('/api/sidebet/entry', { picks: [SBIDS[1], SBIDS[0], SBIDS[2], SBIDS[3], SBIDS[4], SBIDS[5]] }, 'POST', E1);
  ok('sidebet: re-entering edits rather than duplicating', e1b.status === 200 && e1b.d.edited === true && e1b.d.entryNo === 1);
  const sbList1 = await call('/api/admin/sidebet', null, 'GET', ADMINH);
  ok('sidebet: still three entries after an edit',
    sbList1.d.packs.find(x => x.id === PACK).entries === 3,
    JSON.stringify(sbList1.d.packs.find(x => x.id === PACK)));
  // Put E1 back on the consensus order for the scoring assertions below.
  await call('/api/sidebet/entry', { picks: [SBIDS[0], SBIDS[1], SBIDS[2], SBIDS[3], SBIDS[4], SBIDS[5]] }, 'POST', E1);

  // Songs can't be swapped under live entries — every pick points at a pack_songs row.
  ok('sidebet: the song list cannot be replaced once entries exist',
    (await call('/api/admin/sidebet/songs', { packId: PACK, songs: sbSongs }, 'POST', ADMINH)).status === 400);
  // Nor can the pick count, which would invalidate every stored entry's length.
  ok('sidebet: picks-required cannot change once entries exist',
    (await call('/api/admin/sidebet', { id: PACK, name: 'Test Service Pack', picksRequired: 8, warsAt: SB_WARS, closesAt: SB_CLOSE, status: 'open' }, 'POST', ADMINH)).status === 400);

  // --- settle ---
  const sbCk = await call(`/api/admin/sidebet/checklist?packId=${PACK}`, null, 'GET', ADMINH);
  ok('sidebet: the checklist lists every song', sbCk.status === 200 && sbCk.d.songs.length === 10);
  ok('sidebet: a host cannot read the checklist',
    (await call(`/api/admin/sidebet/checklist?packId=${PACK}`, null, 'GET', CHHOST)).status === 403);

  const sbWrongCount = await call('/api/admin/sidebet/settle', { packId: PACK, played: SBIDS.slice(0, 5) }, 'POST', ADMINH);
  ok('sidebet: settling with the wrong count is blocked', sbWrongCount.status === 400, JSON.stringify(sbWrongCount.d));
  ok('sidebet: settling with a song outside the pack is blocked',
    (await call('/api/admin/sidebet/settle', { packId: PACK, played: [...SBIDS.slice(0, 5), 'ghost'] }, 'POST', ADMINH)).status === 400);

  const sbSettle = await call('/api/admin/sidebet/settle', { packId: PACK, played: SBIDS.slice(0, 6) }, 'POST', ADMINH);
  ok('sidebet: settled', sbSettle.status === 200 && sbSettle.d.entries === 3, JSON.stringify(sbSettle.d));
  const sbRows = sbSettle.d.results;
  // E1 and E2 both picked all six; E1's order matches the consensus ranking and E2's is
  // the exact reverse, so E1 wins on distance. E3's four correct can't catch either.
  ok('sidebet: the closest order wins the tie', sbRows[0].correct === 6 && sbRows[0].distance < sbRows[1].distance,
    JSON.stringify(sbRows));
  ok('sidebet: ranks run 1,2,3', sbRows.map(r => r.rank).join(',') === '1,2,3', JSON.stringify(sbRows.map(r => r.rank)));
  ok('sidebet: the entry that missed two scores 4', sbRows[2].correct === 4, JSON.stringify(sbRows[2]));
  // PII discipline: the public standings carry a display name and score, nothing else.
  ok('sidebet: standings carry no email or phone',
    !/@|phone/i.test(JSON.stringify(sbRows)), JSON.stringify(sbRows));

  const sbAfter = await call('/api/sidebet', null, 'GET', E1);
  ok('sidebet: my score is readable after settle', sbAfter.d.entry.correct === 6 && sbAfter.d.entry.rank === 1, JSON.stringify(sbAfter.d.entry));
  ok('sidebet: results are public after settle', Array.isArray(sbAfter.d.results) && sbAfter.d.results.length === 3);
  ok('sidebet: a settled pack is closed to new entries',
    (await call('/api/sidebet/entry', { packId: PACK, picks: SBIDS.slice(0, 6) }, 'POST', E2)).status === 400);

  // Settle is re-runnable off a corrected checklist — the whole reason the host confirms.
  const sbRe = await call('/api/admin/sidebet/settle', { packId: PACK, played: [...SBIDS.slice(0, 4), SBIDS[8], SBIDS[9]] }, 'POST', ADMINH);
  ok('sidebet: a corrected checklist re-scores everyone', sbRe.status === 200 && sbRe.d.results[0].correct === 6,
    JSON.stringify(sbRe.d.results));


  // --- the played set DERIVES from Versus rounds queued out of the pack ---
  // This is what saves the host re-ticking every box on settle night. It only works if
  // the ids survive the round insert, so the assertion goes through the real endpoints.
  const sbDerWars = Date.now() + 3 * 864e5, sbDerClose = sbDerWars - 3600e3;
  const derPack = await call('/api/admin/sidebet', {
    name: 'Derive Pack', picksRequired: 2, warsAt: sbDerWars, closesAt: sbDerClose,
    sessionId: SID, status: 'draft',
  }, 'POST', ADMINH);
  await call('/api/admin/sidebet/songs',
    { packId: derPack.d.id, songs: [{ title: 'Alpha', artist: 'A' }, { title: 'Bravo', artist: 'B' }, { title: 'Charlie', artist: 'C' }] },
    'POST', ADMINH);
  const derCk0 = await call(`/api/admin/sidebet/checklist?packId=${derPack.d.id}`, null, 'GET', ADMINH);
  ok('sidebet/derive: nothing is pre-ticked before any matchup runs',
    derCk0.d.songs.every(s => !s.played && !s.derived));

  const derIds = derCk0.d.songs.map(s => s.id);
  await call('/api/admin/round', {
    sessionId: SID, poll_type: 'binary', song_title: 'Alpha', option_b_title: 'Bravo',
    pack_song_a: derIds[0], pack_song_b: derIds[1],
  }, 'POST', AH);
  await startVoting(SID, AH);

  const derCk = await call(`/api/admin/sidebet/checklist?packId=${derPack.d.id}`, null, 'GET', ADMINH);
  const derBy = Object.fromEntries(derCk.d.songs.map(s => [s.id, s]));
  ok('sidebet/derive: both sides of the matchup are pre-ticked',
    derBy[derIds[0]].derived && derBy[derIds[1]].derived, JSON.stringify(derCk.d.songs));
  ok('sidebet/derive: a song that never played is not ticked', !derBy[derIds[2]].derived);

  // An id from ANOTHER pack must never stick — it would mark the wrong song as played.
  const foreign = await call('/api/admin/round', {
    sessionId: SID, poll_type: 'binary', song_title: 'Ghost A', option_b_title: 'Ghost B',
    pack_song_a: SBIDS[0], pack_song_b: 'nonsense-id',
  }, 'POST', AH);
  ok('sidebet/derive: the round is still accepted with unusable pack ids', foreign.status === 200);
  await startVoting(SID, AH);
  const derCk2 = await call(`/api/admin/sidebet/checklist?packId=${derPack.d.id}`, null, 'GET', ADMINH);
  ok('sidebet/derive: an id from a different pack is dropped, not stamped',
    derCk2.d.songs.filter(s => s.derived).length === 2, JSON.stringify(derCk2.d.songs.filter(s => s.derived)));

  // --- the cut-off is enforced at the server, not just hidden in the UI ---
  // Both timestamps in the PAST (cut-off still before the tournament, so it validates):
  // the pack is nominally 'open' but its window has already elapsed.
  const sbLate = await call('/api/admin/sidebet', {
    name: 'Closing Pack', picksRequired: 2, warsAt: Date.now() - 1000, closesAt: Date.now() - 5000, status: 'open',
  }, 'POST', ADMINH);
  await call('/api/admin/sidebet/songs', { packId: sbLate.d.id, songs: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }, 'POST', ADMINH);
  const lateSongs = (await call('/api/sidebet', null, 'GET')).d.songs.map(s => s.id);
  const sbTooLate = await call('/api/sidebet/entry', { packId: sbLate.d.id, picks: lateSongs.slice(0, 2) }, 'POST', E1);
  ok('sidebet: an entry after the cut-off is refused by the server', sbTooLate.status === 400, JSON.stringify(sbTooLate.d));
  ok('sidebet: a closed pack reports itself closed',
    (await call('/api/sidebet', null, 'GET')).d.pack.open === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });
