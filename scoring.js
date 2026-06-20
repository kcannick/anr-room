'use strict';
// Pure scoring — no DB, no IO. Verified by scoring.test.js.
//
// Model (locked with the product owner):
//   base   = 100 * e^(-error * K)            exponential falloff, K = 0.5
//   bonus  = +25 when error <= BULLSEYE       "bullseye band" (reliable, not luck-of-the-decimal)
//   penalty= -10 when error >  FAR            being way off genuinely costs you
//   A single round CAN go negative. The *cumulative* leaderboard total is floored
//   at 0 elsewhere (in the ratify step), so a bad round stings but never sinks a player.

const K = 0.5;
const BULLSEYE = 0.1;   // within 0.1 of room average => bonus
const BONUS = 25;
const FAR = 5.0;        // more than 5.0 off => penalty
const PENALTY = 10;

// Room average = mean of all taste ratings (1..10) in a round.
function roomAverage(votes) {
  if (!votes.length) return null;
  return votes.reduce((a, v) => a + v.taste, 0) / votes.length;
}

// Points for a single prediction error.
function pointsForError(error) {
  const e = Math.abs(error);
  let pts = 100 * Math.exp(-e * K);
  if (e <= BULLSEYE) pts += BONUS;
  if (e > FAR) pts -= PENALTY;
  return Math.round(pts);
}

function accuracyPoints(predict, roomAvg) {
  return pointsForError(predict - roomAvg);
}

// Emotional tier for the results screen. Drives animation/copy, NOT the math.
//   bullseye | sharp | close | off | wayoff
function tierForError(error) {
  const e = Math.abs(error);
  if (e <= BULLSEYE) return 'bullseye';
  if (e <= 0.5) return 'sharp';
  if (e <= 1.5) return 'close';
  if (e <= FAR) return 'off';
  return 'wayoff';
}

// Rank votes: closest prediction first. Tie on error -> earliest lock wins.
// Returns votes annotated with { err, points, tier, rank }.
function rankVotes(votes, roomAvg) {
  return [...votes]
    .map(v => {
      const err = Math.abs(v.predict - roomAvg);
      return { ...v, err, points: pointsForError(err), tier: tierForError(err) };
    })
    .sort((a, b) => (a.err - b.err) || (a.locked_at - b.locked_at))
    .map((v, i) => ({ ...v, rank: i + 1 }));
}

module.exports = {
  roomAverage, accuracyPoints, pointsForError, tierForError, rankVotes,
  K, BULLSEYE, BONUS, FAR, PENALTY,
};
