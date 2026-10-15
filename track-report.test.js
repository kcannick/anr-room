// track-report.test.js — the Track Report's derived sentences. Run: node track-report.test.js
const tr = require('./track-report');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra != null ? ' — ' + extra : '')); }
}
const noSell = /\bpool\b|\blottery\b|\bqueue\b|\bsubmission\b|\bfinalizer\b|\bratif/i;
const flat = (o) => JSON.stringify(o);

console.log('— bands: sentences, not grades —');
ok('2.9 keeps it in the studio', tr.bandFor(2.9).key === 'studio');
ok('3.0 is release-ready (lower-inclusive edge)', tr.bandFor(3.0).key === 'release');
ok('5.9 is still release', tr.bandFor(5.9).key === 'release');
ok('6.0 is invest (lower-inclusive edge)', tr.bandFor(6.0).key === 'invest');
ok('the release headline is the instruction', tr.bandFor(4.3).headline.join(' ') === 'Release it. Spend at least $300 on it.');
console.log('— what to spend (operator, 2026-10-15) —');
const sp = (m) => tr.bandFor(m).spend;
ok('under 3: do not invest', sp(2.9) === 'none' && /Don’t invest/.test(tr.bandFor(2.9).money));
ok('3–4: up to $300', sp(3) === 'up300' && sp(3.9) === 'up300' && /up to \$300 over the first 3 months/.test(tr.bandFor(3.5).money));
ok('4–5: at least $300', sp(4) === 'min300' && sp(4.9) === 'min300');
ok('5–6: at least $800, no more than $1,000 without a response', sp(5) === 'min800' && /at least \$800/.test(tr.bandFor(5.5).money) && /more than \$1,000 unless/.test(tr.bandFor(5.5).moneyRest));
ok('6–7: invest at least $1,500', sp(6) === 'min1500' && /Invest at least \$1,500 over the first 3 months/.test(tr.bandFor(6.2).money) && sp(6.9) === 'min1500' && /\$1,500/.test(tr.bandFor(6.2).headline.join(' ')));
ok('7+: work out what you can afford', sp(7) === 'single' && /how long you’re willing to push this as a single/.test(tr.bandFor(8.4).moneyRest));
ok('spend tiers ignore calibrated band edges', tr.bandFor(3.2, [3.5, 6]).spend === 'up300' && tr.bandFor(3.2, [3.5, 6]).key === 'studio');
ok('edges are a parameter (calibration is a two-number change)', tr.bandFor(4.3, [4.5, 7]).key === 'studio' && tr.bandFor(7.2, [4.5, 7]).key === 'invest');
ok('band labels match the chart key', tr.BANDS.map(b => b.label).join('|') === 'Keep it in the studio|Release Ready|Potential Single');

console.log('— shape: consensus / divided / spread / thin —');
// The real Jul 21 "Get Well Soon" histogram: 30 votes, 4.3, two thirds on 3 or 4.
const gws = [0, 0, 2, 6, 14, 3, 2, 1, 1, 1];
const s1 = tr.shapeOf(gws, 30);
ok('Get Well Soon reads as consensus', s1.key === 'consensus', s1.key);
ok('…with three believers in the headline', s1.headline.join(' ') === 'Agreement, with three believers.', flat(s1.headline));
ok('median off the histogram is 4', s1.median === 4);
ok('the tail is the 7+ count', s1.tail === 3);
ok('the pull names the share within a point of the middle', /77% of the A&Rs scored it within a point of 4/.test(s1.pull), s1.pull);
const s2 = tr.shapeOf([4, 0, 0, 1, 0, 1, 0, 0, 5, 4], 15);
ok('a 0-versus-8 split is divided', s2.key === 'divided', s2.key);
ok('divided headline', s2.headline.join(' ') === 'A divided room.');
const s3 = tr.shapeOf([1, 1, 2, 3, 5, 3, 2, 2, 1, 0], 20);
ok('a centre with long tails is spread', s3.key === 'spread', s3.key + ' ' + s3.nearPct);
ok('spread headline carries the tail', /A wide spread, with three believers\./.test(s3.headline.join(' ')), flat(s3.headline));
const s4 = tr.shapeOf([0, 0, 0, 1, 2, 1, 0, 0, 0, 0], 4);
ok('fewer than 8 A&Rs is thin', s4.key === 'thin');
ok('thin copy counts in words', /^Four A&Rs scored it/.test(s4.pull), s4.pull);
ok('one believer is singular', tr.shapeOf([0, 0, 0, 4, 6, 2, 0, 1, 0, 0], 13).headline.join(' ') === 'Agreement, with one believer.');
ok('no votes -> null', tr.shapeOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0) === null);
ok('consensus with no tail is plain agreement', tr.shapeOf([0, 0, 0, 5, 10, 5, 0, 0, 0, 0], 20).headline.join(' ') === 'Agreement.');

console.log('— against the room: a marker on the real curve, never a percentile —');
const series = [];
for (let i = 0; i < 100; i++) series.push(2 + (i % 50) / 10); // 2.0 … 6.9, twice
const dist = tr.distribution(series);
ok('distribution counts', dist.n === 100);
ok('quartiles bracket the middle half', dist.q1 < dist.median && dist.median < dist.q3);
ok('buckets are half-point wide across the scale', dist.buckets.length === 18 && dist.buckets.reduce((a, x) => a + x, 0) === 100);
ok('a 9.0 lands in the last bucket, not off the end', tr.bucketOf(9) === 17);
const ar1 = tr.againstRoom(4.5, dist);
ok('near the median reads as the middle', ar1.headline.join(' ') === 'Right at the middle of the room.', flat(ar1.headline));
ok('the pull states the middle half as a range', /Half of everything the A&R Meeting hears scores between \d\.\d and \d\.\d\./.test(ar1.pull), ar1.pull);
ok('well above', tr.againstRoom(8.0, dist).headline.join(' ') === 'Well above most records.');
ok('above the middle, inside the middle half, says so honestly', tr.againstRoom(5.0, dist).where === 'inside');
ok('above the top quartile is "above"', tr.againstRoom(6.5, dist).where === 'above');
ok('below most', tr.againstRoom(2.0, dist).headline.join(' ') === 'Below most records.');
ok('below the middle', tr.againstRoom(3.6, dist).headline.join(' ') === 'Below the middle of the room.');
ok('no distribution -> null (the card is skipped, not faked)', tr.againstRoom(4, null) === null);
ok('the room can be named', /the A&R Room hears/.test(tr.againstRoom(4.5, dist, 'the A&R Room').pull));
ok('no percentile anywhere', !/%/.test(ar1.pull + ar1.headline.join(' ')));

console.log('— who it’s for: segments as targeting —');
const roles = [{ name: 'Artist', n: 8, avg: 5.3 }, { name: 'DJ', n: 3, avg: 5.0 }, { name: 'Producer', n: 3, avg: 4.0 }, { name: 'Manager', n: 6, avg: 3.7 }];
const w1 = tr.whoFor(roles, [{ name: 'Atlanta', n: 9, avg: 4.4 }]);
ok('top vs bottom role is the headline', w1.headline.join(' ') === 'Artists. Not managers.', flat(w1.headline));
ok('the gap is recorded for the next-actions card', w1.gap && w1.gap.kind === 'role' && w1.gap.top === 'Artists' && w1.gap.bottom === 'Managers');
ok('the pull states both scores', /Artists scored it 5\.3; managers scored it 3\.7/.test(w1.pull), w1.pull);
const w2 = tr.whoFor([{ name: 'DJ', n: 4, avg: 4.5 }, { name: 'Artist', n: 5, avg: 4.2 }], []);
ok('a gap under 0.8 is "everyone about the same"', w2.headline.join(' ') === 'Everyone heard about the same record.' && !w2.gap);
const w3 = tr.whoFor([], [{ name: 'Atlanta', n: 5, avg: 5.5 }, { name: 'Houston', n: 4, avg: 4.1 }]);
ok('with no role gap, a city gap leads', w3.headline.join(' ') === 'Start in Atlanta.' && w3.gap.kind === 'city');
ok('a single segment is still a card', /Producers/.test(tr.whoFor([{ name: 'Producer', n: 3, avg: 4 }], []).headline.join(' ')));
ok('no segments -> null', tr.whoFor([], []) === null);
ok('roles pluralise', tr.plural('DJ') === 'DJs' && tr.plural('Listener / Fan') === 'Listeners' && tr.plural('Booking') === 'Booking agents');

console.log('— setup vs record: the prediction gap has a meaning —');
const g1 = tr.setupVsRecord(4.6, 4.3);
ok('predicted above delivered = the A&Rs expected more', g1.key === 'over' && g1.headline.join(' ') === 'The A&Rs expected a little more.', flat(g1.headline));
ok('a big miss: saw more in it than it delivered', tr.setupVsRecord(5.5, 4.3).headline.join(' ') === 'The A&Rs saw more in it than it delivered.');
ok('the label is signed', g1.label === '-0.3');
const g2 = tr.setupVsRecord(4.0, 4.4);
ok('delivered above predicted = it outperformed', g2.key === 'under' && /outperformed what the A&Rs expected/.test(g2.pull));
ok('a big beat says outperformed', tr.setupVsRecord(3.0, 4.5).headline.join(' ') === 'It outperformed expectations.');
ok('+ sign on the label', g2.label === '+0.4');
ok('within 0.15 is even', tr.setupVsRecord(4.4, 4.5).key === 'even');
ok('no prediction -> null', tr.setupVsRecord(null, 4.5) === null);

console.log('— what now: three actions, all derived —');
const band = tr.bandFor(4.3);
const n1 = tr.nextActions({ band, who: w1, setup: g1 });
ok('exactly three', n1.length === 3);
ok('01 is the band', n1[0].lead === 'Release it.');
ok('02 is what to spend', n1[1].lead === 'Spend at least $300 over the first 3 months.', n1[1].lead);
ok('03 is the segment gap', n1[2].lead === 'Send it to artists, not managers.', n1[2].lead);
const n2 = tr.nextActions({ band, who: w2, setup: null });
ok('no gap -> still the money line', n2[1].lead === 'Spend at least $300 over the first 3 months.');
ok('no prediction and no gap -> bring the next one', n2[2].lead === 'Bring the next one.');
const n3 = tr.nextActions({ band: tr.bandFor(7.1), who: null, setup: tr.setupVsRecord(7.0, 7.1) });
ok('invest band opens with the push', n3[0].lead === 'Release it and plan a push.');
ok('even -> trust the score', n3[2].lead === 'Trust the score.');
const n4 = tr.nextActions({ band: tr.bandFor(2.1), who: w3, setup: null });
ok('studio band: do not release this version', n4[0].lead === 'Don’t release this version.');
ok('studio: do not invest, then the city gap', n4[1].lead === 'Don’t invest in this version.' && n4[2].lead === 'Start in Atlanta.');
const n5 = tr.nextActions({ band, who: null, setup: g1 });
ok('no gap -> the prediction direction fills slot 3', /Another pass at the song/.test(n5[2].lead));

console.log('— the decision card’s sub-line —');
const d1 = tr.decisionSub(30, s1, band);
ok('counts in words, names the middle and the tail', d1 === 'Thirty A&Rs heard it. Most of the room landed on 4 — but three of them scored it 7 or higher, and that tail is the part worth chasing.', d1);
ok('counts read as words to ninety-nine, digits after', /^Thirty/.test(d1) && /^Twelve A&Rs/.test(tr.decisionSub(12, null, band)) && tr.numWord(23) === 'twenty-three' && tr.numWord(120) === '120');
ok('divided copy', /did not agree/.test(tr.decisionSub(15, s2, band)));

console.log('— copy rules: nothing about the machine —');
const allCopy = [s1, s2, s3, s4, ar1, w1, w2, w3, g1, g2].filter(Boolean).map(o => o.pull + ' ' + (o.headline || []).join(' ')).join(' ')
  + n1.concat(n2, n3, n4).map(s => s.lead + ' ' + s.rest).join(' ') + d1 + tr.BANDS.map(b => b.action + b.actionRest).join(' ') + tr.SPEND.map(t => t.headline.join(' ') + t.money + t.moneyRest).join(' ');
ok('no pool / lottery / queue / submission / ratified anywhere', !noSell.test(allCopy), (allCopy.match(noSell) || [''])[0]);
ok('no emoji, no exclamation marks', !/[!\u{1F300}-\u{1FAFF}]/u.test(allCopy));

console.log('— comments: paged by length —');
const short = { body: 'Great hook.' }, long = { body: 'x'.repeat(500) };
ok('three short notes share a page', tr.pageComments([short, short, short]).length === 1);
ok('a 500-char note gets its own page after two long ones', tr.pageComments([long, long, long]).length === 3);
ok('empty -> no pages', tr.pageComments([]).length === 0);
ok('order is preserved', tr.pageComments([short, long, short]).flat().map(c => c.body.length).join() === '11,500,11');

console.log('— series quartiles for the operator —');
const sq = tr.seriesQuartiles([1, 2, 3, 4, 5, 6, 7, 8, 9]);
ok('median 5, quartiles 3 and 7', sq.median === 5 && sq.q1 === 3 && sq.q3 === 7);
ok('empty -> null', tr.seriesQuartiles([]) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
