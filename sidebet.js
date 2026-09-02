'use strict';
// Scoring for the A&R Wars side contest ("the sidebet"). Pure functions, no I/O —
// same shape as scoring.js, and unit-tested for the same reason: this decides who
// gets handed cash, so it has to be reproducible from the stored rows alone.
//
// The contest is SET MEMBERSHIP, not ratings. An entrant predicts which songs from
// the monthly service pack will actually be PLAYED at A&R Wars. Nothing here reads
// votes, room averages, or the series board.
//
// Winner chain (operator, 2026-08-30):
//   1. most correct        — how many of your picks were actually played
//   2. order distance      — Spearman footrule against the CONSENSUS RANKING
//   3. earliest updated_at — the entry that actually competed, not the first draft

// ---------------------------------------------------------------------------
// The consensus ranking: the played songs, ordered by how many entrants picked
// them (most-picked first).
//
// This is built FROM THE ENTRIES, which is exactly why pick counts stay sealed
// until settle — if entrants could see it, copying the crowd would maximise both
// the correct count AND the tiebreak, every entry would converge, and the winner
// would be whoever submitted first.
//
// Count ties break on row_no (CSV row order), fixed before any entry existed.
// Without that the metric is not reproducible, and it decides a cash prize.
//
//   playedSongs: [{ id, row_no }]  — the truth set
//   counts:      Map|object  songId -> how many entries picked it
//   returns:     Map songId -> 1-based consensus position
// ---------------------------------------------------------------------------
function consensusRanking(playedSongs, counts) {
  const get = (id) => {
    const v = counts instanceof Map ? counts.get(id) : counts[id];
    return Number(v) || 0;
  };
  const ordered = [...playedSongs].sort((a, b) => {
    const d = get(b.id) - get(a.id);
    if (d !== 0) return d;
    return Number(a.row_no) - Number(b.row_no);
  });
  const pos = new Map();
  ordered.forEach((s, i) => pos.set(s.id, i + 1));
  return pos;
}

// ---------------------------------------------------------------------------
// Score one entry.
//
//   picks:     [{ pack_song_id, position }]  — position is 1..picks_required
//   truth:     Set of played song ids
//   consensus: Map songId -> consensus position (from consensusRanking)
//
// `distance` sums only over the CORRECT picks. A wrong pick has no consensus
// position to compare against, and distance only ever separates entries that
// already tied on `correct` — so within any tie group the sums cover the same
// number of terms and stay like-for-like.
// ---------------------------------------------------------------------------
function scoreEntry(picks, truth, consensus) {
  let correct = 0, distance = 0;
  for (const p of picks) {
    if (!truth.has(p.pack_song_id)) continue;
    correct++;
    const cpos = consensus.get(p.pack_song_id);
    if (cpos != null) distance += Math.abs(Number(p.position) - Number(cpos));
  }
  return { correct, distance };
}

// ---------------------------------------------------------------------------
// Order scored entries and assign ranks.
//
//   entries: [{ id, correct, distance, updated_at }]
//
// Standard competition ranking: entries identical on all three keys share a rank
// and the next rank skips accordingly. That is vanishingly unlikely (it needs the
// same picks, the same order AND the same millisecond) but a silent arbitrary
// winner would be worse than an explicit shared rank the operator can see.
// ---------------------------------------------------------------------------
function rankEntries(entries) {
  const sorted = [...entries].sort((a, b) =>
    (b.correct - a.correct) ||
    (a.distance - b.distance) ||
    (Number(a.updated_at) - Number(b.updated_at))
  );
  let lastKey = null, lastRank = 0;
  return sorted.map((e, i) => {
    const key = `${e.correct}|${e.distance}|${e.updated_at}`;
    const rank = key === lastKey ? lastRank : i + 1;
    lastKey = key; lastRank = rank;
    return { ...e, rank };
  });
}

// ---------------------------------------------------------------------------
// Validate a submitted list of song ids against a pack.
// Returns { ok: true } or { ok: false, error } — the message is user-facing.
//
// Order IS the submission: position comes from array index, so the client never
// sends positions and they can never disagree with the list.
// ---------------------------------------------------------------------------
function validatePicks(songIds, validIdSet, picksRequired) {
  if (!Array.isArray(songIds)) return { ok: false, error: 'Picks must be a list' };
  if (songIds.length !== picksRequired) {
    return { ok: false, error: `Pick exactly ${picksRequired} songs (you sent ${songIds.length})` };
  }
  const seen = new Set();
  for (const sid of songIds) {
    if (typeof sid !== 'string' || !sid) return { ok: false, error: 'Bad song id' };
    if (!validIdSet.has(sid)) return { ok: false, error: 'That song is not in this pack' };
    if (seen.has(sid)) return { ok: false, error: 'The same song was picked twice' };
    seen.add(sid);
  }
  return { ok: true };
}

module.exports = { consensusRanking, scoreEntry, rankEntries, validatePicks };
