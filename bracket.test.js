'use strict';
const B = require('./bracket');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function throws(label, fn) {
  try { fn(); fail++; console.log(`FAIL ${label}: did not throw`); } catch { pass++; }
}

const comps = [1, 2, 3, 4, 5, 6, 7, 8].map(s => ({ id: 'c' + s, seed: s }));
const find = (ms, rn, sl) => ms.find(m => m.round_no === rn && m.slot === sl);

// ---------------------------------------------------------------------------
// building
// ---------------------------------------------------------------------------
{
  const ms = B.buildBracket(comps);
  eq('7 matches', ms.length, 7);
  eq('round 1 pairs are 1v8 4v5 3v6 2v7', ms.filter(m => m.round_no === 1).map(m => [m.a_id, m.b_id]),
    [['c1', 'c8'], ['c4', 'c5'], ['c3', 'c6'], ['c2', 'c7']]);
  eq('later rounds start empty', ms.filter(m => m.round_no > 1).map(m => [m.a_id, m.b_id, m.winner_id]),
    [[null, null, null], [null, null, null], [null, null, null]]);
  eq('seed order does not matter', B.buildBracket([...comps].reverse())[0].a_id, 'c1');
}
throws('needs exactly 8', () => B.buildBracket(comps.slice(0, 7)));
throws('duplicate seed refused', () => B.buildBracket(comps.map(c => ({ ...c, seed: 1 }))));
throws('seed 9 refused', () => B.buildBracket(comps.map((c, i) => ({ ...c, seed: i + 2 }))));

// ---------------------------------------------------------------------------
// where a winner goes
// ---------------------------------------------------------------------------
eq('r1 slot1 → r2 slot1 side a', B.nextSlot({ round_no: 1, slot: 1 }), { round_no: 2, slot: 1, side: 'a' });
eq('r1 slot2 → r2 slot1 side b', B.nextSlot({ round_no: 1, slot: 2 }), { round_no: 2, slot: 1, side: 'b' });
eq('r1 slot4 → r2 slot2 side b', B.nextSlot({ round_no: 1, slot: 4 }), { round_no: 2, slot: 2, side: 'b' });
eq('r2 slot2 → final side b', B.nextSlot({ round_no: 2, slot: 2 }), { round_no: 3, slot: 1, side: 'b' });
eq('the final goes nowhere', B.nextSlot({ round_no: 3, slot: 1 }), null);

// ---------------------------------------------------------------------------
// reading a poll
// ---------------------------------------------------------------------------
eq('A wins above 50', B.pollWinner({ split_a: 61, votes: 40 }), 'A');
eq('B wins below 50', B.pollWinner({ split_a: 49, votes: 40 }), 'B');
eq('50 is a tie', B.pollWinner({ split_a: 50, votes: 40 }), null);
eq('unratified is nothing', B.pollWinner({ split_a: null, votes: 40 }), null);
eq('zero votes decides nothing', B.pollWinner({ split_a: 100, votes: 0 }), null);

// ---------------------------------------------------------------------------
// deciding a match
// ---------------------------------------------------------------------------
eq('one-poll match resolves on its poll', B.decideMatch([{ split_a: 70, votes: 10 }], 1).winner, 'A');
eq('one-poll tie stays open', B.decideMatch([{ split_a: 50, votes: 10 }], 1), { winner: null, a: 0, b: 0, played: 1, needed: 1, complete: true });
eq('no polls yet', B.decideMatch([], 1), { winner: null, a: 0, b: 0, played: 0, needed: 1, complete: false });
// The 3-poll final: decided at 2 wins, but not complete until all 3 have run (Pick the Hits).
eq('final 2-0 is decided but not complete', B.decideMatch([{ split_a: 60, votes: 9 }, { split_a: 55, votes: 9 }], 3),
  { winner: 'A', a: 2, b: 0, played: 2, needed: 3, complete: false });
eq('final 1-1 is open', B.decideMatch([{ split_a: 60, votes: 9 }, { split_a: 40, votes: 9 }], 3).winner, null);
eq('final 1-2 goes to B', B.decideMatch([{ split_a: 60, votes: 9 }, { split_a: 40, votes: 9 }, { split_a: 30, votes: 9 }], 3).winner, 'B');
eq('a tied poll in the final counts for nobody', B.decideMatch([{ split_a: 50, votes: 9 }, { split_a: 50, votes: 9 }, { split_a: 51, votes: 9 }], 3),
  { winner: null, a: 1, b: 0, played: 3, needed: 3, complete: true });
eq('final_polls is never assumed', B.decideMatch([{ split_a: 60, votes: 9 }, { split_a: 60, votes: 9 }, { split_a: 60, votes: 9 }], 5).winner, 'A');
eq('needed defaults to 1 on junk', B.decideMatch([{ split_a: 60, votes: 9 }], 0).needed, 1);

// ---------------------------------------------------------------------------
// applying + clearing winners
// ---------------------------------------------------------------------------
{
  const ms0 = B.buildBracket(comps);
  const ms1 = B.applyWinner(ms0, 1, 1, 'c8');
  eq('input not mutated', find(ms0, 1, 1).winner_id, null);
  eq('winner set', find(ms1, 1, 1).winner_id, 'c8');
  eq('winner carried into r2 slot1 side a', find(ms1, 2, 1).a_id, 'c8');
  const ms2 = B.applyWinner(ms1, 1, 2, 'c4');
  eq('second winner is side b', [find(ms2, 2, 1).a_id, find(ms2, 2, 1).b_id], ['c8', 'c4']);
  throws('winner must be in the match', () => B.applyWinner(ms2, 1, 3, 'c1'));
  throws('no such match', () => B.applyWinner(ms2, 4, 1, 'c1'));

  // run it through to a champion
  let ms = ms2;
  ms = B.applyWinner(ms, 1, 3, 'c3');
  ms = B.applyWinner(ms, 1, 4, 'c2');
  eq('stage after round 1', B.stage(ms), 'final4');
  eq('survivors after round 1', B.survivors(ms, comps.map(c => c.id)).sort(), ['c2', 'c3', 'c4', 'c8']);
  ms = B.applyWinner(ms, 2, 1, 'c8');
  eq('stage with one semi left', B.stage(ms), 'final4');
  ms = B.applyWinner(ms, 2, 2, 'c2');
  eq('stage after semis', B.stage(ms), 'final2');
  eq('final is c8 v c2', [find(ms, 3, 1).a_id, find(ms, 3, 1).b_id], ['c8', 'c2']);
  eq('no champion yet', B.champion(ms), null);
  ms = B.applyWinner(ms, 3, 1, 'c2');
  eq('champion', B.champion(ms), 'c2');
  eq('stage champion', B.stage(ms), 'champion');

  // override a semi: everything downstream clears, the other semi stands
  const back = B.clearWinner(ms, 2, 1);
  eq('semi cleared', find(back, 2, 1).winner_id, null);
  eq('final side a emptied', find(back, 3, 1).a_id, null);
  eq('final winner cleared', find(back, 3, 1).winner_id, null);
  eq('other semi untouched', find(back, 2, 2).winner_id, 'c2');
  eq('final side b kept', find(back, 3, 1).b_id, 'c2');
  eq('stage rolls back', B.stage(back), 'final4');
  // clearing round 1 slot 1 empties r2 slot1 side a and the chain beyond it
  const back2 = B.clearWinner(ms, 1, 1);
  eq('r1 clear → r2 slot empties', find(back2, 2, 1).a_id, null);
  eq('r1 clear → r2 winner gone', find(back2, 2, 1).winner_id, null);
  eq('r1 clear → final empties on that side', [find(back2, 3, 1).a_id, find(back2, 3, 1).winner_id], [null, null]);
}
eq('stage on a fresh bracket', B.stage(B.buildBracket(comps)), 'field');

// ---------------------------------------------------------------------------
// seeding by points
// ---------------------------------------------------------------------------
{
  const s = B.seedByPoints([{ id: 'x', name: 'B', points: 100 }, { id: 'y', name: 'A', points: 300 }, { id: 'z', name: 'A', points: 100 }, { id: 'w', name: 'C' }]);
  eq('most points seeds 1', s.map(c => [c.id, c.seed]), [['y', 1], ['z', 2], ['x', 3], ['w', 4]]);
}

console.log(`bracket.test.js: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
