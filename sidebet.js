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

// ===========================================================================
// PICK THE HITS (operator, 2026-11-11). The tournament is gone, so nothing is
// "played" any more. Every ballot ranks N songs (N = picks_required, set per pack; 16 by default): a #1 pick
// is worth N points to that song, #2 is worth N-1 … #N is worth 1. Songs rank by
// their total. The ballot closest to that final order wins the cash.
//
// Only ELIGIBLE ballots go in (complete A&R Team profile, active account) — an
// unfinished ballot counts for nothing, not the winner and not the song ranking.
// The caller filters; these functions trust what they are handed.
// ===========================================================================

// ballots: [{ picks: [{ pack_song_id, position }] }]
// songs:   [{ id, row_no }]
// returns: [{ id, points, pickers, ones, rank }] sorted best first. rank is 1-based
//          for every song with points; a song nobody picked has rank null.
// Ties: points, then how many ballots picked it, then CSV row order (fixed before any
// entry existed, so the order is reproducible from the stored rows alone).
function weightedTally(ballots, songs, n) {
  const by = new Map(songs.map(s => [s.id, { id: s.id, row_no: Number(s.row_no), points: 0, pickers: 0, ones: 0 }]));
  for (const b of ballots) {
    for (const p of b.picks) {
      const s = by.get(p.pack_song_id);
      const pos = Number(p.position);
      if (!s || !(pos >= 1 && pos <= n)) continue;
      s.points += n + 1 - pos;
      s.pickers++;
      if (pos === 1) s.ones++;
    }
  }
  const sorted = [...by.values()].sort((a, b) =>
    (b.points - a.points) || (b.pickers - a.pickers) || (a.row_no - b.row_no));
  return sorted.map((s, i) => ({ id: s.id, points: s.points, pickers: s.pickers, ones: s.ones,
    rank: s.points > 0 ? i + 1 : null }));
}

// How far one ballot is from the final order. Over every song in the final top N:
// |where the ballot put it − where it finished|, and a song the ballot left out counts
// as position N+1. Lower is closer. `hits` = how many of the final top N the ballot
// had at all; `exact` = how many it had in exactly the right spot.
//   finalTop: [songId, …] in final order (length ≤ n)
function ballotDistance(picks, finalTop, n) {
  const pos = new Map(picks.map(p => [p.pack_song_id, Number(p.position)]));
  let distance = 0, hits = 0, exact = 0;
  finalTop.forEach((sid, i) => {
    const at = pos.get(sid);
    const bp = at || n + 1;
    distance += Math.abs(bp - (i + 1));
    if (at) hits++;
    if (at === i + 1) exact++;
  });
  return { distance, hits, exact };
}

// Closest first; a tie goes to the ballot that was final earliest (updated_at — the
// list that actually competed, not a first draft). Same shared-rank rule as rankEntries.
function rankByDistance(entries) {
  const sorted = [...entries].sort((a, b) =>
    (a.distance - b.distance) || (Number(a.updated_at) - Number(b.updated_at)));
  let lastKey = null, lastRank = 0;
  return sorted.map((e, i) => {
    const key = `${e.distance}|${e.updated_at}`;
    const rank = key === lastKey ? lastRank : i + 1;
    lastKey = key; lastRank = rank;
    return { ...e, rank };
  });
}

module.exports = { consensusRanking, scoreEntry, rankEntries, validatePicks, weightedTally, ballotDistance, rankByDistance };
