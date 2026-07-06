'use strict';
// Pure scoring — no DB, no IO. Verified by scoring.test.js.
//
// Model (re-locked with the product owner, 2026-07-06):
//   The game is played at 0.1 resolution — predictions come in tenths and the room
//   average is ROUNDED to tenths BEFORE scoring, so the number players see on screen
//   IS the scoring target (previously the raw float mean was the target, which made
//   a displayed "avg 5.7 · guess 5.6 · off 0.1" win a Bullseye — technically right
//   against the unrounded mean, visibly wrong to everyone watching).
//   base   = 100 * e^(-error * K)            exponential falloff, K = 0.5
//   bonus  = +25 on an EXACT hit             Bullseye = nailed the tenth = always 125
//   penalty= -10 when error >  FAR           being way off genuinely costs you
//   A single round CAN go negative. The *cumulative* leaderboard total is floored
//   at 0 elsewhere (in the ratify step), so a bad round stings but never sinks a player.

const K = 0.5;
const BULLSEYE = 0.05;  // "exact at 0.1 resolution" (errors are exact tenths; 0 is the only hit)
const BONUS = 25;
const FAR = 5.0;        // more than 5.0 off => penalty
const PENALTY = 10;

// Room average = mean of all taste ratings (0..9), rounded to ONE DECIMAL — the
// displayed value and the scoring target are the same number by construction.
function roomAverage(votes) {
  if (!votes.length) return null;
  return Math.round(votes.reduce((a, v) => a + v.taste, 0) / votes.length * 10) / 10;
}

// Exact-tenths error: both sides are 0.1-resolution values, so compute in integer
// tenths to kill float artifacts (5.7-5.6 must be exactly 0.1, never 0.09999…).
function errTenths(a, b) {
  return Math.abs(Math.round(a * 10) - Math.round(b * 10)) / 10;
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
  return pointsForError(errTenths(predict, roomAvg));
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
      const err = errTenths(v.predict, roomAvg);
      return { ...v, err, points: pointsForError(err), tier: tierForError(err) };
    })
    .sort((a, b) => (a.err - b.err) || (a.locked_at - b.locked_at))
    .map((v, i) => ({ ...v, rank: i + 1 }));
}

// ============================================================================
// BINARY POLL ("Verzuz" mode) — a SECOND poll type, additive. The rating
// functions above are untouched.
//
// A binary round pits Song A vs Song B. Players pick a side, then predict how the
// ROOM will split (A's %, 0..100, since B = 100 - A). Only the predicted split is
// scored — same "read the room" shape as the rating game, on a 0..100 scale.
// Same exponential-falloff curve family, re-tuned for the wider scale.
//   base   = 100 * e^(-error * K_BIN)        K_BIN = 0.035
//   bonus  = +25 when error <= BULLSEYE_BIN  (3 points)   [reuses BONUS]
//   penalty= -10 when error  > FAR_BIN       (35 points)  [reuses PENALTY]
// Constants are prototype-tuned, not data-tuned — calibrate on the first Verzuz event.
const K_BIN = 0.035;
const BULLSEYE_BIN = 3;   // within 3 percentage points of the actual split => bonus
const FAR_BIN = 35;       // more than 35 points off => penalty

// Actual room split: % of locked votes that picked A, rounded to 0..100.
// (B's share is 100 - A.) Empty round => null (no scores, like an empty rating round).
function roomSplitA(votes) {
  if (!votes.length) return null;
  const a = votes.reduce((n, v) => n + (v.pick === 'A' ? 1 : 0), 0);
  return Math.round(100 * (a / votes.length));
}

// Points for a single split prediction. error in percentage points (0..100).
function splitPoints(predictSplit, actualA) {
  const e = Math.abs(Number(predictSplit) - Number(actualA));
  let pts = 100 * Math.exp(-e * K_BIN);
  if (e <= BULLSEYE_BIN) pts += BONUS;
  if (e > FAR_BIN) pts -= PENALTY;
  return Math.max(0, Math.round(pts));
}

// Emotional tier for the binary results screen. Drives copy/animation, NOT the math.
//   bullseye | sharp | close | off | wayoff  (error in points, 0..100 scale)
function splitTier(error) {
  const e = Math.abs(error);
  if (e <= 3) return 'bullseye';
  if (e <= 8) return 'sharp';
  if (e <= 18) return 'close';
  if (e <= 30) return 'off';
  return 'wayoff';
}

// Rank binary votes: closest split prediction first. Tie on error -> earliest lock.
// Returns votes annotated with { err, points, tier, rank }.
function rankBinaryVotes(votes, actualA) {
  return [...votes]
    .map(v => {
      const err = Math.abs(Number(v.predict_split) - Number(actualA));
      return { ...v, err, points: splitPoints(v.predict_split, actualA), tier: splitTier(err) };
    })
    .sort((a, b) => (a.err - b.err) || (a.locked_at - b.locked_at))
    .map((v, i) => ({ ...v, rank: i + 1 }));
}

module.exports = {
  roomAverage, accuracyPoints, pointsForError, tierForError, rankVotes,
  K, BULLSEYE, BONUS, FAR, PENALTY,
  // binary
  roomSplitA, splitPoints, splitTier, rankBinaryVotes,
  K_BIN, BULLSEYE_BIN, FAR_BIN,
};
