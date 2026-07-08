'use strict';
const { roomAverage, pointsForError, accuracyPoints, tierForError, rankVotes } = require('./scoring');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function approx(label, got, want, tol = 1e-9) {
  const ok = Math.abs(got - want) <= tol;
  if (ok) pass++; else { fail++; console.log(`FAIL ${label}: got ${got} want ~${want}`); }
}

// ---- room average (rounded to tenths: the DISPLAYED value IS the scoring target) ----
eq('roomAverage', roomAverage([{taste:8},{taste:6},{taste:7},{taste:5}]), 6.5);
eq('roomAverage solo', roomAverage([{taste:9}]), 9);
eq('roomAverage empty', roomAverage([]), null);
// 5.6538... displays as 5.7 — and now SCORES as 5.7 too (the on-screen bug: a 5.6
// guess showed "avg 5.7 · off 0.1 · 🎯 bullseye +122" because the raw mean was the target).
eq('roomAverage rounds to displayed tenth', roomAverage([{taste:5},{taste:6},{taste:6},{taste:5},{taste:6},{taste:6},{taste:5},{taste:6},{taste:6},{taste:6},{taste:5},{taste:6},{taste:6}]), 5.7);
// HALF-UP at the boundary: a true mean of exactly 5.65 (sum 113 over 20 votes) must
// round UP to 5.7 — naive float rounding sees 56.4999…93 and drops it to 5.6.
const halfUp = [ ...Array(16).fill({taste:6}), {taste:5},{taste:4},{taste:4},{taste:4} ]; // 96+17=113, n=20
eq('exact .x5 mean rounds UP (5.65 -> 5.7)', roomAverage(halfUp), 5.7);
// ...and the player who guessed 5.7 gets the full bullseye: 100 + 25.
{
  const avg = roomAverage(halfUp);
  const r = rankVotes([{ user:'W', taste:6, predict:5.7, locked_at:1 }], avg)[0];
  eq('5.7 guess vs 5.65 mean = exact hit', [r.err, r.points, r.tier], [0, 125, 'bullseye']);
}
eq('exact .x5 mean rounds UP (6.45 -> 6.5)', roomAverage([...Array(9).fill({taste:7}), ...Array(11).fill({taste:6})]), 6.5);

// ---- points model: exp k=0.5, +25 on an EXACT hit only, -10 penalty>5.0 ----
// Bullseye = nailed the tenth = always exactly 125.
eq('exact = 125', pointsForError(0), 125);
// one tick (0.1) off -> NO bonus: 100*e^(-0.05) = 95
eq('0.1 off = 95, no bonus', pointsForError(0.1), Math.round(100*Math.exp(-0.05)));
eq('0.11 off no bonus', pointsForError(0.11), Math.round(100*Math.exp(-0.055)));
// mid errors (no bonus, no penalty)
eq('1.0 off', pointsForError(1.0), Math.round(100*Math.exp(-0.5)));   // 61
eq('2.0 off', pointsForError(2.0), Math.round(100*Math.exp(-1.0)));   // 37
eq('5.0 off (no penalty yet)', pointsForError(5.0), Math.round(100*Math.exp(-2.5))); // 29? -> e^-2.5=.082 ->8
// penalty kicks in strictly past 5.0
eq('5.0 exactly = no penalty', pointsForError(5.0), Math.round(100*Math.exp(-2.5)));
eq('5.5 off = penalty applied', pointsForError(5.5), Math.round(100*Math.exp(-2.75)) - 10);
// far off goes negative
const far = pointsForError(8);
eq('8 off is negative', far < 0, true);
// sign independence (error magnitude only)
eq('negative error same as positive', pointsForError(-2), pointsForError(2));

// accuracyPoints wraps pointsForError on the exact-tenths error
eq('accuracyPoints exact', accuracyPoints(6.5, 6.5), 125);
eq('accuracyPoints 1 off', accuracyPoints(7.5, 6.5), pointsForError(1));
// float-artifact regression: 5.7-5.6 must be EXACTLY 0.1 (never 0.0999…), and an
// exact hit expressed as 0.30000000000000004-style floats still scores 125.
eq('tenths math is exact', accuracyPoints(5.6, 5.7), pointsForError(0.1));
eq('float artifacts cannot fake or lose a bullseye', accuracyPoints(0.1+0.2, 0.3), 125);

// ---- tiers (bullseye = exact hit; one tick off is sharp) ----
eq('tier bullseye', tierForError(0), 'bullseye');
eq('tier one tick off = sharp', tierForError(0.1), 'sharp');
eq('tier sharp', tierForError(0.4), 'sharp');
eq('tier sharp edge', tierForError(0.5), 'sharp');
eq('tier close', tierForError(1.2), 'close');
eq('tier close edge', tierForError(1.5), 'close');
eq('tier off', tierForError(3), 'off');
eq('tier off edge', tierForError(5.0), 'off');
eq('tier wayoff', tierForError(5.1), 'wayoff');

// ---- ranking + tie-break + annotations ----
const sample = [
  { user:'A', taste:8, predict:7.0, locked_at:100 },  // err .5 from avg 6.5
  { user:'B', taste:6, predict:7.5, locked_at:120 },  // err 1.0
  { user:'C', taste:7, predict:7.0, locked_at:90  },  // err .5, earlier than A
  { user:'D', taste:5, predict:2.0, locked_at:110 },  // err 4.5
];
const avg = roomAverage(sample); // 6.5
const ranked = rankVotes(sample, avg);
eq('rank order (tie -> earliest lock)', ranked.map(r=>r.user), ['C','A','B','D']);
eq('winner C', ranked[0].user, 'C');
approx('C err 0.5', ranked[0].err, 0.5);
eq('annotates tier', ranked[0].tier, 'sharp');
eq('annotates points', ranked[0].points, pointsForError(0.5));

// solo
const solo = rankVotes([{user:'X',taste:9,predict:9,locked_at:1}], 9);
eq('solo exact bullseye', solo[0].tier, 'bullseye');
eq('solo exact 125', solo[0].points, 125);
eq('solo rank 1', solo[0].rank, 1);

// ============================================================================
// BINARY POLL scoring
const { roomSplitA, splitPoints, splitTier, rankBinaryVotes, K_BIN, BONUS: B_BONUS, PENALTY: B_PENALTY } = require('./scoring');

// ---- roomSplitA ----
eq('split 3 of 4 picked A = 75', roomSplitA([{pick:'A'},{pick:'A'},{pick:'A'},{pick:'B'}]), 75);
eq('split unanimous A = 100', roomSplitA([{pick:'A'},{pick:'A'}]), 100);
eq('split unanimous B = 0', roomSplitA([{pick:'B'},{pick:'B'}]), 0);
eq('split tie = 50', roomSplitA([{pick:'A'},{pick:'B'}]), 50);
eq('split empty = null', roomSplitA([]), null);
eq('split rounds (1 of 3) = 33', roomSplitA([{pick:'A'},{pick:'B'},{pick:'B'}]), 33);

// ---- splitPoints: exp k=0.035, +25 bullseye<=3, -10 penalty>35, floored at 0 ----
eq('split exact = 125', splitPoints(75, 75), 125);
eq('split 3 off = bonus band', splitPoints(72, 75), Math.round(100*Math.exp(-3*K_BIN)+B_BONUS));
eq('split 4 off no bonus', splitPoints(71, 75), Math.round(100*Math.exp(-4*K_BIN)));
eq('split 10 off', splitPoints(60, 50), Math.round(100*Math.exp(-10*K_BIN)));
eq('split 35 off (no penalty yet)', splitPoints(85, 50), Math.round(100*Math.exp(-35*K_BIN)));
eq('split 40 off = penalty applied', splitPoints(90, 50), Math.max(0, Math.round(100*Math.exp(-40*K_BIN)) - B_PENALTY));
eq('split predict 100 on unanimous = bullseye 125', splitPoints(100, 100), 125);
eq('split never negative (floored at 0)', splitPoints(0, 100) >= 0, true);
eq('split sign independence', splitPoints(60, 50), splitPoints(40, 50));

// ---- splitTier ----
eq('split tier bullseye', splitTier(2), 'bullseye');
eq('split tier bullseye edge', splitTier(3), 'bullseye');
eq('split tier sharp', splitTier(6), 'sharp');
eq('split tier sharp edge', splitTier(8), 'sharp');
eq('split tier close', splitTier(15), 'close');
eq('split tier close edge', splitTier(18), 'close');
eq('split tier off', splitTier(25), 'off');
eq('split tier off edge', splitTier(30), 'off');
eq('split tier wayoff', splitTier(31), 'wayoff');

// ---- rankBinaryVotes: ranking + tie-break + annotations ----
const bsample = [
  { user:'A', pick:'A', predict_split:60, locked_at:100 }, // actual 75 -> err 15
  { user:'B', pick:'A', predict_split:70, locked_at:120 }, // err 5
  { user:'C', pick:'B', predict_split:70, locked_at:90  }, // err 5, earlier than B
  { user:'D', pick:'B', predict_split:20, locked_at:110 }, // err 55
];
const actualA = roomSplitA(bsample); // 50 (2 A, 2 B)
eq('bsample actual split = 50', actualA, 50);
const branked = rankBinaryVotes(bsample, actualA);
// errors from 50: A|60-50|=10, B|70-50|=20, C|70-50|=20, D|20-50|=30
eq('binary rank order', branked.map(r=>r.user), ['A','C','B','D']);
eq('binary winner A', branked[0].user, 'A');
approx('binary A err 10', branked[0].err, 10);
eq('binary annotates tier', branked[0].tier, 'close');
eq('binary annotates points', branked[0].points, splitPoints(60, 50));
eq('binary tie -> earliest lock (C before B)', branked[1].user, 'C');

// binary solo exact
const bsolo = rankBinaryVotes([{user:'X', pick:'A', predict_split:100, locked_at:1}], 100);
eq('binary solo exact bullseye', bsolo[0].tier, 'bullseye');
eq('binary solo exact 125', bsolo[0].points, 125);
eq('binary solo rank 1', bsolo[0].rank, 1);

// ===========================================================================
// ACCURACY % + ABSOLUTE GRADE (poll-type-agnostic recap metrics)
// ===========================================================================
const { roundAccuracy, gradeForAccuracy } = require('./scoring');

// ---- roundAccuracy: distance vs the full scale, 0..100, floored ----
approx('accuracy exact rating (err 0, /9) = 100', roundAccuracy(0, 9), 100);
approx('accuracy exact binary (err 0, /100) = 100', roundAccuracy(0, 100), 100);
approx('accuracy rating err 0.9 /9 = 90', roundAccuracy(0.9, 9), 90);
approx('accuracy binary err 13 /100 = 87', roundAccuracy(13, 100), 87);
approx('accuracy rating worst (err 9) = 0', roundAccuracy(9, 9), 0);
approx('accuracy floored at 0 (err beyond scale)', roundAccuracy(120, 100), 0);
eq('accuracy null err -> null', roundAccuracy(null, 9), null);

// ---- gradeForAccuracy: absolute bands ----
eq('grade A+ at 97', gradeForAccuracy(97), 'A+');
eq('grade A+ boundary 96.7', gradeForAccuracy(96.7), 'A+');
eq('grade A just below A+', gradeForAccuracy(96.6), 'A');
eq('grade B+ at 84.44', gradeForAccuracy(84.44), 'B+');
eq('grade B just below B+', gradeForAccuracy(84.3), 'B');
eq('grade F at bottom', gradeForAccuracy(10), 'F');
eq('grade null -> null (no rounds)', gradeForAccuracy(null), null);

// ---- equivalence: accuracy-grade reproduces the OLD rating grade bands ----
// old gradeForAvgError bands: A+<=0.3, A<=0.6, A-<=1.0, B+<=1.4, B<=1.9 ...
// accuracy for a pure-rating session = 100*(1 - avgErr/9).
const accFromAvgErr = e => 100 * (1 - e / 9);
eq('equiv: avgErr 0.3 -> A+', gradeForAccuracy(accFromAvgErr(0.3)), 'A+');
eq('equiv: avgErr 0.6 -> A',  gradeForAccuracy(accFromAvgErr(0.6)), 'A');
eq('equiv: avgErr 1.0 -> A-', gradeForAccuracy(accFromAvgErr(1.0)), 'A-');
eq('equiv: avgErr 1.4 -> B+', gradeForAccuracy(accFromAvgErr(1.4)), 'B+');
eq('equiv: avgErr 1.9 -> B',  gradeForAccuracy(accFromAvgErr(1.9)), 'B');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
