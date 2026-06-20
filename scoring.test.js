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

// ---- room average ----
eq('roomAverage', roomAverage([{taste:8},{taste:6},{taste:7},{taste:5}]), 6.5);
eq('roomAverage solo', roomAverage([{taste:9}]), 9);
eq('roomAverage empty', roomAverage([]), null);

// ---- points model: exp k=0.5, +25 bullseye<=0.1, -10 penalty>5.0 ----
// exact -> 100 + 25 = 125
eq('exact = 125', pointsForError(0), 125);
// within bullseye band (0.1) still gets bonus: 100*e^(-0.05)+25
eq('0.1 off = bonus band', pointsForError(0.1), Math.round(100*Math.exp(-0.05)+25));
// just past bullseye -> no bonus, big drop (the intended cliff)
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

// accuracyPoints wraps pointsForError on (predict - avg)
eq('accuracyPoints exact', accuracyPoints(6.5, 6.5), 125);
eq('accuracyPoints 1 off', accuracyPoints(7.5, 6.5), pointsForError(1));

// ---- tiers ----
eq('tier bullseye', tierForError(0.05), 'bullseye');
eq('tier bullseye edge', tierForError(0.1), 'bullseye');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
