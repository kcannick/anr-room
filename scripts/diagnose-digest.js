'use strict';
// READ-ONLY diagnostic: why did an A&R Daily digest go out with no "how you did" block?
//
// Run against production:
//   DATABASE_URL='postgres://…' node scripts/diagnose-digest.js
// Or a local SQLite db:
//   SQLITE_PATH=./anr-room.db node scripts/diagnose-digest.js
//
// It writes NOTHING. Every statement is a SELECT.
//
// The personalised block renders only when BOTH hold (server.js, drainDigest →
// dailyDigestEmailHtml):
//   1. a participants row exists for (session_id, users.uid) with verified = 1
//   2. buildRecap returns a non-empty rounds[] — i.e. that participant has votes
//      joined to rounds whose status is 'ratified'
// If either fails the email still sends, just without the block. This tells you which.

const db = require('../db');

const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);

(async () => {
  await db.init();
  console.log(`\nengine: ${db.engine}\n`);

  const days = await db.all(
    `SELECT id, name, drop_day, status, async_state, series_id,
            window_opens_at, window_closes_at, results_at, published_at
       FROM sessions
      WHERE mode = 'async' AND deleted_at IS NULL
      ORDER BY drop_day DESC LIMIT 5`, []);

  if (!days.length) { console.log('No A&R Daily sessions found.'); process.exit(0); }

  for (const s of days) {
    console.log('='.repeat(72));
    console.log(`DAY ${s.drop_day}   session ${s.id}`);
    console.log(`  status=${s.status}  async_state=${s.async_state}  series_id=${s.series_id || 'NULL  <-- points reach no board'}`);
    console.log(`  published_at=${s.published_at ? new Date(Number(s.published_at)).toISOString() : 'NULL'}`);

    // ---- 1. are the rounds actually ratified, with a room average? ----
    const rounds = await db.all(
      `SELECT status, COUNT(*) AS c, SUM(CASE WHEN room_average IS NULL THEN 1 ELSE 0 END) AS no_avg
         FROM rounds WHERE session_id = ? GROUP BY status`, [s.id]);
    console.log('  rounds by status:', rounds.map(r => `${r.status}=${r.c}${Number(r.no_avg) ? ` (${r.no_avg} with NO room_average)` : ''}`).join('  ') || 'none');

    const votes = await db.get(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN v.points IS NULL THEN 1 ELSE 0 END) AS unscored,
              COUNT(DISTINCT v.participant_id) AS voters
         FROM votes v JOIN rounds r ON r.id = v.round_id WHERE r.session_id = ?`, [s.id]);
    console.log(`  votes: ${votes.total} from ${votes.voters} A&Rs` + (Number(votes.unscored) ? `  <-- ${votes.unscored} NEVER SCORED` : ''));

    // ---- 2. was a digest broadcast created, and who was queued? ----
    const bc = await db.get(
      "SELECT * FROM notify_broadcasts WHERE kind = 'digest_daily' AND ref_id = ?", [s.id]);
    if (!bc) {
      console.log('  DIGEST: no broadcast row  <-- the digest was never enqueued for this day');
      console.log('          (so any email A&Rs got was something else — a go-live notice, or the artist report)');
      continue;
    }
    const rcp = await db.all(
      'SELECT status, COUNT(*) AS c FROM notify_recipients WHERE broadcast_id = ? GROUP BY status', [bc.id]);
    console.log(`  DIGEST broadcast ${bc.id}  subject="${bc.subject}"`);
    console.log('  recipients:', rcp.map(r => `${r.status}=${r.c}`).join('  ') || 'NONE QUEUED');

    // ---- 3. per recipient: would the personalised block have rendered? ----
    const rows = await db.all(
      `SELECT nr.uid, nr.dest, nr.status,
              p.id AS pid, p.verified,
              (SELECT COUNT(*) FROM votes v JOIN rounds r ON r.id = v.round_id
                WHERE v.participant_id = p.id AND r.session_id = ?) AS votes_any,
              (SELECT COUNT(*) FROM votes v JOIN rounds r ON r.id = v.round_id
                WHERE v.participant_id = p.id AND r.status = 'ratified') AS votes_ratified
         FROM notify_recipients nr
         LEFT JOIN participants p ON p.session_id = ? AND p.user_id = nr.uid
        WHERE nr.broadcast_id = ?
        ORDER BY nr.dest LIMIT 40`, [s.id, s.id, bc.id]);

    if (rows.length) {
      console.log('');
      console.log('  ' + pad('RECIPIENT', 30) + pad('PARTICIPANT', 14) + pad('VERIFIED', 10)
        + pad('VOTES', 7) + pad('ON RATIFIED', 13) + 'BLOCK?');
      console.log('  ' + '-'.repeat(88));
      let blocked = 0;
      for (const r of rows) {
        const wouldRender = !!r.pid && Number(r.verified) === 1 && Number(r.votes_ratified) > 0;
        if (!wouldRender) blocked++;
        console.log('  ' + pad(r.dest, 30) + pad(r.pid || 'MISSING', 14)
          + pad(r.pid ? (Number(r.verified) === 1 ? 'yes' : 'NO') : '-', 10)
          + pad(r.votes_any || 0, 7) + pad(r.votes_ratified || 0, 13)
          + (wouldRender ? 'yes' : 'NO  <--'));
      }
      console.log('');
      console.log(`  ${blocked} of ${rows.length} recipients would get NO "how you did" block.`);
      if (blocked) {
        const noP = rows.filter(r => !r.pid).length;
        const noVotes = rows.filter(r => r.pid && !Number(r.votes_any)).length;
        const notRatified = rows.filter(r => r.pid && Number(r.votes_any) && !Number(r.votes_ratified)).length;
        const unverified = rows.filter(r => r.pid && Number(r.verified) !== 1).length;
        console.log('  CAUSE BREAKDOWN:');
        if (noP) console.log(`    ${noP} have NO participants row for this day — they were mailed but never played,`);
        if (noP) console.log(`         which is correct behaviour: the audience is everyone, the block is only for players.`);
        if (unverified) console.log(`    ${unverified} have a participants row that is NOT verified=1  <-- BUG`);
        if (noVotes) console.log(`    ${noVotes} have a participants row but cast no votes (did not play)`);
        if (notRatified) console.log(`    ${notRatified} HAVE VOTES BUT NONE ON A RATIFIED ROUND  <-- BUG: the day was published before it tallied`);
      }
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log('Read the last two DAY blocks. If people who genuinely played show BLOCK? = NO,');
  console.log('the CAUSE BREAKDOWN line marked BUG is your answer.');
  process.exit(0);
})().catch(e => { console.error('diagnostic failed:', e); process.exit(1); });
