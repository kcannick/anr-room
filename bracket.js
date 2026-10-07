'use strict';
// Tournament bracket — pure functions, no DB. Shared by A&R Wars and the $1,000 Music Review
// Tournament: the shape is the same (8 seeds, single elimination, 8 → 4 → 2 → 1), only who
// sits in the seats differs. Spec: docs/specs/tournament-spec.md §3.
//
// A "match" here is { round_no, slot, a_id, b_id, winner_id }. Polls are the binary Versus
// rounds that decided it: { split_a, votes } — split_a is the percentage of the room that
// picked side A once the round is ratified (null before), votes the number of ballots.

const FIELD = 8;
// Standard seeding: the top seed meets the bottom seed, and the two halves of the draw are
// built so seeds 1 and 2 can only meet in the final.
const ROUND1_PAIRS = [[1, 8], [4, 5], [3, 6], [2, 7]];

// Build the 7 matches of a fresh bracket from the seeded competitors.
// competitors: [{ id, seed }] — exactly FIELD rows, seeds 1..FIELD, each once.
function buildBracket(competitors) {
  if (!Array.isArray(competitors) || competitors.length !== FIELD) {
    throw new Error(`A bracket needs exactly ${FIELD} competitors`);
  }
  const bySeed = new Map();
  for (const c of competitors) {
    const s = Number(c.seed);
    if (!Number.isInteger(s) || s < 1 || s > FIELD || bySeed.has(s)) throw new Error('Seeds must be 1..8, each once');
    bySeed.set(s, c.id);
  }
  const matches = ROUND1_PAIRS.map(([a, b], i) => ({ round_no: 1, slot: i + 1, a_id: bySeed.get(a), b_id: bySeed.get(b), winner_id: null }));
  matches.push({ round_no: 2, slot: 1, a_id: null, b_id: null, winner_id: null });
  matches.push({ round_no: 2, slot: 2, a_id: null, b_id: null, winner_id: null });
  matches.push({ round_no: 3, slot: 1, a_id: null, b_id: null, winner_id: null });
  return matches;
}

// Where a match's winner goes: the next round's slot and side.
function nextSlot(match) {
  if (match.round_no >= 3) return null;
  return { round_no: match.round_no + 1, slot: Math.ceil(match.slot / 2), side: match.slot % 2 === 1 ? 'a' : 'b' };
}

// Which side a single ratified poll went to. 'A' | 'B' | null (tie, no votes, not ratified).
function pollWinner(poll) {
  if (!poll || poll.split_a == null || !(Number(poll.votes) > 0)) return null;
  const a = Number(poll.split_a);
  if (a > 50) return 'A';
  if (a < 50) return 'B';
  return null;
}

// Decide a match from its polls. pollsNeeded is 1 for rounds 1–2 and tournaments.final_polls
// for the final: the side with a MAJORITY of that many polls wins. A one-poll match therefore
// resolves on that poll; a 3-poll final resolves at 2 wins even if the third still has to be
// played (Pick the Hits counts on all 18 songs, so the console keeps asking for it).
// Returns { winner: 'A'|'B'|null, a, b, played, needed, complete }.
function decideMatch(polls, pollsNeeded = 1) {
  const needed = Math.max(1, Number(pollsNeeded) || 1);
  const majority = Math.floor(needed / 2) + 1;
  let a = 0, b = 0, played = 0;
  for (const p of polls || []) {
    const w = pollWinner(p);
    if (p && p.split_a != null) played++;
    if (w === 'A') a++; else if (w === 'B') b++;
  }
  const winner = a >= majority ? 'A' : b >= majority ? 'B' : null;
  return { winner, a, b, played, needed, complete: played >= needed };
}

// Apply a winner to the bracket: set it on the match, carry it into the next slot. Returns a
// NEW array (the input is not mutated) so a caller can diff what changed.
function applyWinner(matches, roundNo, slot, winnerId) {
  const out = matches.map(m => ({ ...m }));
  const m = out.find(x => x.round_no === roundNo && x.slot === slot);
  if (!m) throw new Error('No such match');
  if (winnerId !== m.a_id && winnerId !== m.b_id) throw new Error('Winner is not in this match');
  m.winner_id = winnerId;
  const nx = nextSlot(m);
  if (nx) {
    const n = out.find(x => x.round_no === nx.round_no && x.slot === nx.slot);
    n[nx.side + '_id'] = winnerId;
  }
  return out;
}

// Undo a decision (host override, or a corrected poll): clear the winner and everything that
// depended on it downstream — the slot it fed, that match's winner, and so on to the final.
function clearWinner(matches, roundNo, slot) {
  const out = matches.map(m => ({ ...m }));
  const walk = (rn, sl) => {
    const m = out.find(x => x.round_no === rn && x.slot === sl);
    if (!m) return;
    m.winner_id = null;
    const nx = nextSlot(m);
    if (!nx) return;
    const n = out.find(x => x.round_no === nx.round_no && x.slot === nx.slot);
    n[nx.side + '_id'] = null;
    walk(nx.round_no, nx.slot);
  };
  walk(roundNo, slot);
  return out;
}

// The champion, when the final is decided.
function champion(matches) {
  const f = (matches || []).find(m => m.round_no === 3 && m.slot === 1);
  return f && f.winner_id ? f.winner_id : null;
}

// Which competitors are still in: everyone, minus the losers of decided matches.
function survivors(matches, competitorIds) {
  const out = new Set(competitorIds);
  for (const m of matches || []) {
    if (!m.winner_id) continue;
    const loser = m.winner_id === m.a_id ? m.b_id : m.a_id;
    if (loser) out.delete(loser);
  }
  return [...out];
}

// The promo stage the graphics render at, read off the bracket: field → final4 → final2 →
// champion. A stage is reached only when EVERY match of the round before it is decided —
// a Final 4 graphic with three names and a blank is not a graphic.
function stage(matches) {
  const decided = rn => (matches || []).filter(m => m.round_no === rn).every(m => !!m.winner_id);
  if (champion(matches)) return 'champion';
  if (decided(2)) return 'final2';
  if (decided(1)) return 'final4';
  return 'field';
}

// Order a list of competitors by Series points for one-press seeding (ties: name, then id so
// the result is stable). Returns the same objects with seed assigned 1..n.
function seedByPoints(competitors) {
  const sorted = [...competitors].sort((x, y) =>
    (Number(y.points) || 0) - (Number(x.points) || 0) ||
    String(x.name || '').localeCompare(String(y.name || '')) ||
    String(x.id).localeCompare(String(y.id)));
  return sorted.map((c, i) => ({ ...c, seed: i + 1 }));
}

module.exports = { FIELD, ROUND1_PAIRS, buildBracket, nextSlot, pollWinner, decideMatch, applyWinner, clearWinner, champion, survivors, stage, seedByPoints };
