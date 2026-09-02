'use strict';
const { consensusRanking, scoreEntry, rankEntries, validatePicks } = require('./sidebet');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// ---------------------------------------------------------------------------
// consensus ranking — played songs ordered by how many entrants picked them
// ---------------------------------------------------------------------------
{
  const played = [{ id: 'a', row_no: 5 }, { id: 'b', row_no: 2 }, { id: 'c', row_no: 9 }];
  const pos = consensusRanking(played, { a: 10, b: 40, c: 25 });
  eq('most-picked is #1', [pos.get('b'), pos.get('c'), pos.get('a')], [1, 2, 3]);
}
// A count tie falls back to CSV row order — the whole reason row_no is load-bearing.
// Without it the two songs have no defined order and the metric isn't reproducible.
{
  const played = [{ id: 'x', row_no: 40 }, { id: 'y', row_no: 3 }];
  const pos = consensusRanking(played, { x: 12, y: 12 });
  eq('count tie breaks on CSV row order', [pos.get('y'), pos.get('x')], [1, 2]);
}
// A played song nobody picked still gets a position (count 0), at the bottom.
{
  const played = [{ id: 'p', row_no: 1 }, { id: 'q', row_no: 2 }];
  const pos = consensusRanking(played, { p: 0, q: 3 });
  eq('a song nobody picked ranks last, not undefined', [pos.get('q'), pos.get('p')], [1, 2]);
}
// Counts as a Map (what settle actually passes) behaves identically to an object.
{
  const played = [{ id: 'a', row_no: 1 }, { id: 'b', row_no: 2 }];
  const m = consensusRanking(played, new Map([['a', 1], ['b', 9]]));
  eq('Map and object counts agree', [m.get('b'), m.get('a')], [1, 2]);
}

// ---------------------------------------------------------------------------
// scoring one entry
// ---------------------------------------------------------------------------
const truth = new Set(['s1', 's2', 's3']);
const consensus = new Map([['s1', 1], ['s2', 2], ['s3', 3]]);

eq('perfect entry: all right, zero distance',
  scoreEntry([{ pack_song_id: 's1', position: 1 }, { pack_song_id: 's2', position: 2 }, { pack_song_id: 's3', position: 3 }], truth, consensus),
  { correct: 3, distance: 0 });

// Same three songs, reversed: still 3 correct, but the order is as wrong as it gets.
eq('right songs, reversed order',
  scoreEntry([{ pack_song_id: 's3', position: 1 }, { pack_song_id: 's2', position: 2 }, { pack_song_id: 's1', position: 3 }], truth, consensus),
  { correct: 3, distance: 4 });   // |1-3| + |2-2| + |3-1|

// A wrong pick contributes nothing to distance — it has no consensus position, and
// distance only ever separates entries that already tied on `correct`.
eq('a wrong pick adds no distance',
  scoreEntry([{ pack_song_id: 's1', position: 1 }, { pack_song_id: 'zz', position: 2 }], truth, consensus),
  { correct: 1, distance: 0 });

eq('nothing right', scoreEntry([{ pack_song_id: 'nope', position: 1 }], truth, consensus), { correct: 0, distance: 0 });

// ---------------------------------------------------------------------------
// ranking the field — most correct, then order distance, then earliest
// ---------------------------------------------------------------------------
{
  const r = rankEntries([
    { id: 'low',  correct: 12, distance: 0,  updated_at: 1 },
    { id: 'best', correct: 15, distance: 22, updated_at: 500 },
    { id: 'mid',  correct: 15, distance: 31, updated_at: 2 },
  ]);
  // 'low' has a PERFECT distance and the earliest timestamp and still loses: correct
  // count is strictly first, and distance never rescues a lower count.
  eq('most correct wins outright', r.map(x => x.id), ['best', 'mid', 'low']);
  eq('ranks are 1..n', r.map(x => x.rank), [1, 2, 3]);
}
{
  // Same correct count -> closer order wins, regardless of who entered first.
  const r = rankEntries([
    { id: 'late-but-closer', correct: 15, distance: 10, updated_at: 999 },
    { id: 'early-but-off',   correct: 15, distance: 40, updated_at: 1 },
  ]);
  eq('order breaks a tie on correct', r.map(x => x.id), ['late-but-closer', 'early-but-off']);
}
{
  // Dead heat on correct AND distance -> earliest final edit takes it.
  const r = rankEntries([
    { id: 'later',   correct: 9, distance: 5, updated_at: 200 },
    { id: 'earlier', correct: 9, distance: 5, updated_at: 100 },
  ]);
  eq('earliest final edit is the last resort', r.map(x => x.id), ['earlier', 'later']);
}
{
  // Identical on all three keys: share a rank, and the next rank skips. An arbitrary
  // silent winner would be worse than a tie the operator can see and resolve.
  const r = rankEntries([
    { id: 'a', correct: 9, distance: 5, updated_at: 100 },
    { id: 'b', correct: 9, distance: 5, updated_at: 100 },
    { id: 'c', correct: 8, distance: 0, updated_at: 1 },
  ]);
  eq('a true dead heat shares a rank and skips the next', r.map(x => x.rank), [1, 1, 3]);
}
eq('empty field ranks to nothing', rankEntries([]), []);

// ---------------------------------------------------------------------------
// pick validation — this is what stands between the contest and a malformed entry
// ---------------------------------------------------------------------------
const valid = new Set(['a', 'b', 'c']);
eq('exactly the required count passes', validatePicks(['a', 'b', 'c'], valid, 3), { ok: true });
eq('too few is refused', validatePicks(['a', 'b'], valid, 3).ok, false);
eq('too many is refused', validatePicks(['a', 'b', 'c', 'a'], valid, 3).ok, false);
eq('a song outside the pack is refused', validatePicks(['a', 'b', 'zz'], valid, 3).ok, false);
eq('the same song twice is refused', validatePicks(['a', 'b', 'b'], valid, 3).ok, false);
eq('a non-list is refused', validatePicks('abc', valid, 3).ok, false);
eq('a non-string id is refused', validatePicks(['a', 'b', 7], valid, 3).ok, false);
eq('the error names the shortfall', validatePicks(['a'], valid, 18).error, 'Pick exactly 18 songs (you sent 1)');

// ---------------------------------------------------------------------------
// end-to-end of the pure layer: the worked example from the spec
// ---------------------------------------------------------------------------
{
  // 3 songs played. Denise and Marcus both get all 3; Denise's order is closer to how
  // the field picked, so she takes it even though Marcus entered first.
  const played = [{ id: 's1', row_no: 1 }, { id: 's2', row_no: 2 }, { id: 's3', row_no: 3 }];
  const counts = { s1: 100, s2: 50, s3: 10 };          // consensus: s1, s2, s3
  const pos = consensusRanking(played, counts);
  const truthSet = new Set(['s1', 's2', 's3']);
  const denise = scoreEntry([{ pack_song_id: 's1', position: 1 }, { pack_song_id: 's2', position: 2 }, { pack_song_id: 's3', position: 3 }], truthSet, pos);
  const marcus = scoreEntry([{ pack_song_id: 's2', position: 1 }, { pack_song_id: 's1', position: 2 }, { pack_song_id: 's3', position: 3 }], truthSet, pos);
  const r = rankEntries([
    { id: 'marcus', updated_at: 1, ...marcus },
    { id: 'denise', updated_at: 900, ...denise },
  ]);
  eq('worked example: closer order beats an earlier entry', r.map(x => x.id), ['denise', 'marcus']);
  eq('worked example: both got everything right', r.map(x => x.correct), [3, 3]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
