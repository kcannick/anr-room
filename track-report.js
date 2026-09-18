// track-report.js — every sentence on the artist's Track Report, derived from numbers the
// server already computes. Pure: no DB, no I/O, unit-tested like scoring.js and sidebet.js.
//
// The design (docs/specs/track-report-spec.md, §2): the report opens with a DECISION, not a
// score. An artist doesn't need a grade — they need to know what to do with the record on
// Monday. So every card's headline is a sentence the artist can act on, and every one of them
// is a function of the same data (the band, the histogram's shape, the segment gap, the
// prediction gap). Nothing is written by hand per record, so no two cards can disagree.
//
// Copy rules (spec §6, enforced): say what the artist gets, never how the machine works —
// no "pool", "queue", "submission", "ratified". Reader is an independent artist, ~24.
// Bands are sentences, not grades. Gold is money and first place only, so nothing here is
// gold (the graphics honour that; this module only supplies words).
//
// The 0-9 scale is the rating ceiling today; SCALE_MAX moves with the 0-10 switch and the
// band edges should be revisited in that change (see the scoring-scale-0-10 plan).

const SCALE_MAX = 9;

// Band edges — LOWER-INCLUSIVE, half-open, the same cuts the charts print (share-cards
// CHART_BANDS: 0–2.9 / 3–5.9 / 6+). Calibrating them to the real score distribution is an
// operator decision (spec §2, open); `seriesQuartiles()` below hands the operator the data,
// and `bandFor()` takes edges as an argument so the decision is a two-number change.
const DEFAULT_EDGES = [3, 6];

// The three decisions. `label` is the short band name the charts already use (the artist
// may have seen it on a HOT 100 graphic); `headline` is the instruction, as lines.
const BANDS = [
  { key: 'studio', label: 'Keep it in the studio',
    headline: ['Keep working', 'on it.'],
    action: 'Don’t release this version.',
    actionRest: 'The A&Rs did not hear a finished record. Work on it and bring back the next version.',
    money: 'Keep the money.', moneyRest: 'Spend it on the next version, not on this one.' },
  { key: 'release', label: 'Release Ready',
    headline: ['Release it.', 'Don’t put money', 'behind it yet.'],
    action: 'Release it.',
    actionRest: 'It cleared the bar most records don’t. It’s a discography record, not a campaign record.',
    money: 'Hold the ad budget.', moneyRest: 'Nothing here says this one converts strangers. Put the money behind the next 6+.' },
  { key: 'invest', label: 'Potential Single',
    headline: ['Release it.', 'This one is worth', 'investing in.'],
    action: 'Release it and plan a push.',
    actionRest: 'It scored where the A&R Meeting’s singles score. Treat it as a campaign record.',
    money: 'Put a budget behind it.', moneyRest: 'This is the record to spend on. Start with the people who scored it highest.' },
];

function bandFor(mean, edges = DEFAULT_EDGES) {
  const m = Number(mean);
  const idx = m < edges[0] ? 0 : m < edges[1] ? 1 : 2;
  return { idx, ...BANDS[idx] };
}

// ---- words ----
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
// Counts read as words up to ninety-nine ("Thirty A&Rs heard it."); bigger stays digits.
const numWord = (n) => n < 0 || n > 99 || !Number.isInteger(n) ? String(n)
  : n < 20 ? SMALL[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + SMALL[n % 10] : '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt1 = (x) => Number(x).toFixed(1);
const fmtScore = (x) => Number.isInteger(Number(x)) ? String(x) : fmt1(x);

// ---- card 2: how it split ----
// Three shapes, all read off the histogram: CONSENSUS (most of the room within a point of
// the middle score), DIVIDED (no centre at all), and SPREAD (a centre, but a long tail).
// THIN is a small room, where a shape would be reading tea leaves.
// `tail` — the A&Rs who scored it 7+ — is the most valuable fact in the report to an artist
// (spec §2), so it is in the headline whenever it exists.
function shapeOf(hist, n) {
  const h = (hist || []).map(Number);
  const total = n || h.reduce((a, x) => a + x, 0);
  if (!total) return null;
  // median from the histogram
  let acc = 0, median = 0;
  const half = total / 2;
  for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc >= half) { median = i; break; } }
  const near = (h[median - 1] || 0) + h[median] + (h[median + 1] || 0);
  const nearPct = Math.round(near / total * 100);
  // "far" is everything three or more points from the middle — a second camp, not a tail.
  const far = h.reduce((a, x, i) => Math.abs(i - median) >= 3 ? a + x : a, 0);
  const tail = h.slice(7).reduce((a, x) => a + x, 0);
  const lo = h.findIndex(x => x > 0), hi = h.length - 1 - h.slice().reverse().findIndex(x => x > 0);
  const believers = tail === 1 ? 'one believer' : `${numWord(tail)} believers`;
  let key, headline, pull;
  if (total < 8) {
    key = 'thin';
    headline = ['A small room.'];
    pull = `${cap(numWord(total))} A&Rs scored it, between ${lo} and ${hi}. That is enough for a score, not enough to call a shape — the next time it is heard will say more.`;
  } else if (far / total >= 0.3) {
    key = 'divided';
    headline = ['A divided room.'];
    pull = `The scores run from ${lo} to ${hi} with no centre. That’s a record people argue about — harder to read from an average, easier to build a campaign on, because some of them really heard it.`;
  } else if (near / total >= 0.6) {
    key = 'consensus';
    headline = tail ? ['Agreement,', `with ${believers}.`] : ['Agreement.'];
    pull = `${nearPct}% of the A&Rs scored it within a point of ${median}. That’s a record people agree about — safer, and rarer to build a campaign on than one that divides them.`
      + (tail ? ` The ${tail === 1 ? 'one who' : numWord(tail) + ' who'} scored it 7 or higher ${tail === 1 ? 'is' : 'are'} the part worth chasing.` : '');
  } else {
    key = 'spread';
    headline = tail ? ['A wide spread,', `with ${believers}.`] : ['A wide spread.'];
    pull = `${nearPct}% of the A&Rs landed within a point of ${median}; the rest spread from ${lo} to ${hi}. There is a centre, but the room did not hear the same record.`;
  }
  return { key, headline, pull, median, tail, nearPct, lo, hi };
}

// ---- card 3: against the room ----
// Where this record sits on the real distribution of everything the Meeting has rated.
// Replaces "Top 61%" (which only flatters below about 25%). The curve is the score
// distribution bucketed at 0.5; the artist's record and the middle are both marked.
const BUCKET = 0.5;
function distribution(averages) {
  const xs = (averages || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return null;
  const q = (p) => {
    const pos = (n - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  };
  const buckets = Array(Math.round(SCALE_MAX / BUCKET)).fill(0);
  xs.forEach(x => { buckets[Math.min(buckets.length - 1, Math.max(0, Math.floor(x / BUCKET)))]++; });
  return { n, avg: xs.reduce((a, x) => a + x, 0) / n, median: q(0.5), q1: q(0.25), q3: q(0.75), buckets };
}
const bucketOf = (x) => Math.min(Math.round(SCALE_MAX / BUCKET) - 1, Math.max(0, Math.floor(Number(x) / BUCKET)));

function againstRoom(mean, dist, what = 'the A&R Meeting') {
  if (!dist) return null;
  const m = Number(mean);
  const d = m - dist.median;
  let headline, where;
  if (Math.abs(d) < 0.3) { headline = ['Right at the', 'middle of the room.']; where = 'inside'; }
  else if (d >= 1.5) { headline = ['Well above', 'most records.']; where = 'above'; }
  else if (d > 0) { headline = ['Above the middle', 'of the room.']; where = m > dist.q3 ? 'above' : 'inside'; }
  else if (d <= -1.5) { headline = ['Below', 'most records.']; where = 'below'; }
  else { headline = ['Below the middle', 'of the room.']; where = m < dist.q1 ? 'below' : 'inside'; }
  const range = `between ${fmt1(dist.q1)} and ${fmt1(dist.q3)}`;
  const pull = `Half of everything ${what} hears scores ${range}. `
    + (where === 'above' ? 'Landing above that range is a real result — most records don’t.'
      : where === 'below' ? 'This one landed under that range. The room hears a lot of records; this was not one it rated.'
      : 'This one sits in that range — a typical result for the room, which most records get.');
  return { headline, pull, where, diff: d, you: bucketOf(m), mid: bucketOf(dist.median) };
}

// ---- card 4: who it's for ----
// Segments (role, city) with 3+ A&Rs each, as targeting. A gap of PLURAL_GAP or more between
// the top and bottom role is a headline; less is "everyone about the same", which is also
// a finding. Role names are the profile categories, pluralised for a sentence.
const PLURAL = {
  'DJ': 'DJs', 'Producer': 'Producers', 'Engineer': 'Engineers', 'Manager': 'Managers',
  'Event Promoter': 'Event promoters', 'Booking': 'Booking agents', 'Artist': 'Artists',
  'Creative Director': 'Creative directors', 'Videographer': 'Videographers',
  'Photographer': 'Photographers', 'Content Creator': 'Content creators', 'Marketing': 'Marketers',
  'Executive': 'Executives', 'Media': 'Media', 'Listener / Fan': 'Listeners',
};
const plural = (name) => PLURAL[name] || name;
const SEGMENT_GAP = 0.8;

function whoFor(roles, cities) {
  const rs = roles || [], cs = cities || [];
  if (!rs.length && !cs.length) return null;
  let headline, pull, gap = null;
  if (rs.length >= 2 && rs[0].avg - rs[rs.length - 1].avg >= SEGMENT_GAP) {
    const top = rs[0], bot = rs[rs.length - 1];
    gap = { kind: 'role', top: plural(top.name), bottom: plural(bot.name), diff: top.avg - bot.avg };
    headline = [`${plural(top.name)}.`, `Not ${plural(bot.name).toLowerCase()}.`];
    pull = `${plural(top.name)} scored it ${fmt1(top.avg)}; ${plural(bot.name).toLowerCase()} scored it ${fmt1(bot.avg)}. Send it to the people who heard it first.`;
  } else if (cs.length >= 2 && cs[0].avg - cs[cs.length - 1].avg >= SEGMENT_GAP) {
    const top = cs[0], bot = cs[cs.length - 1];
    gap = { kind: 'city', top: top.name, bottom: bot.name, diff: top.avg - bot.avg };
    headline = [`Start in ${top.name}.`];
    pull = `A&Rs in ${top.name} scored it ${fmt1(top.avg)}; in ${bot.name}, ${fmt1(bot.avg)}. That is where the first push goes.`;
  } else if (rs.length >= 2 || cs.length >= 2) {
    headline = ['Everyone heard', 'about the same record.'];
    pull = 'No group of A&Rs scored this much differently from the rest. Target by audience, not by role or city.';
  } else {
    const only = rs[0] || cs[0];
    headline = [`${rs[0] ? plural(only.name) : only.name}`, 'heard it.'];
    pull = `Only one group had enough A&Rs to score on its own. ${rs[0] ? plural(only.name) : 'A&Rs in ' + only.name} put it at ${fmt1(only.avg)}.`;
  }
  return { headline, pull, gap };
}

// ---- card 5: setup vs record ----
// The room predicted the average, then delivered one. The GAP is the Meeting's own
// diagnostic: predicted above delivered means the presentation oversells; below means the
// record is better than its packaging. Within GAP_EVEN of zero, the setup told the truth.
const GAP_EVEN = 0.15, GAP_BIG = 0.6;
function setupVsRecord(predictMean, mean) {
  if (predictMean == null || !Number.isFinite(Number(predictMean))) return null;
  const d = Number(mean) - Number(predictMean);
  let key, headline, pull;
  if (Math.abs(d) < GAP_EVEN) {
    key = 'even';
    headline = ['It gave what', 'it promised.'];
    pull = 'The setup and the record match. Whatever the score is, the title, the artwork and the intro are telling the truth about it.';
  } else if (d < 0) {
    key = 'over';
    headline = d <= -GAP_BIG ? ['It promised more', 'than it gave.'] : ['It promised a little', 'more than it gave.'];
    pull = `A ${d <= -GAP_BIG ? 'gap' : 'small gap'} the wrong way. The title, the artwork and the intro are doing more work than the record is — worth another pass at the song before another pass at the marketing.`;
  } else {
    key = 'under';
    headline = d >= GAP_BIG ? ['It gave more', 'than it promised.'] : ['It gave a little', 'more than it promised.'];
    pull = 'The record is better than its setup. The title, the artwork and the intro are costing you plays — fix the packaging before you spend on the song.';
  }
  return { key, headline, pull, diff: d, label: (d >= 0 ? '+' : '') + fmt1(d) };
}

// ---- card 6: what now ----
// Three next actions from three rules: the band, the biggest segment gap, the prediction
// direction. Every record gets exactly three; when a rule has nothing to say, the band's
// money line fills the slot.
function nextActions({ band, who, setup }) {
  const steps = [];
  steps.push({ lead: band.action, rest: band.actionRest });
  const g = who && who.gap;
  if (g && g.kind === 'role') {
    steps.push({ lead: `Send it to ${g.top.toLowerCase()}, not ${g.bottom.toLowerCase()}.`,
      rest: `They scored it ${fmt1(g.diff)} higher. That’s your first push.` });
  } else if (g && g.kind === 'city') {
    steps.push({ lead: `Start in ${g.top}.`, rest: `A&Rs there scored it ${fmt1(g.diff)} higher than in ${g.bottom}. Push it there first.` });
  } else {
    steps.push({ lead: band.money, rest: band.moneyRest });
  }
  if (setup && setup.key === 'over') steps.push({ lead: 'Another pass at the song before another pass at the marketing.', rest: 'The setup promised more than the record gave.' });
  else if (setup && setup.key === 'under') steps.push({ lead: 'Fix the packaging.', rest: 'The record is better than its setup. The title, artwork and intro are costing plays.' });
  else if (setup) steps.push({ lead: 'Keep the packaging.', rest: 'The setup told the truth about the record. Change the song before you change the presentation.' });
  else if (g) steps.push({ lead: band.money, rest: band.moneyRest });
  else steps.push({ lead: 'Bring the next one.', rest: 'The room scores what it hears. The fastest way to a better report is a better record.' });
  return steps.slice(0, 3);
}

// ---- card 1: the decision ----
function decisionSub(n, shape, band) {
  const heard = `${cap(numWord(n))} A&Rs heard it.`;
  if (!shape) return heard;
  if (shape.key === 'consensus') {
    return `${heard} Most of the room landed on ${shape.median}`
      + (shape.tail ? ` — but ${numWord(shape.tail)} of them scored it 7 or higher, and that tail is the part worth chasing.` : '.')
      + (band.key === 'studio' ? ' Nobody heard a finished record.' : '');
  }
  if (shape.key === 'divided') return `${heard} They did not agree: scores ran from ${shape.lo} to ${shape.hi}, and ${shape.tail ? numWord(shape.tail) + ' of them scored it 7 or higher.' : 'none of them scored it 7 or higher.'}`;
  if (shape.key === 'thin') return `${heard} Too few to read a pattern into, enough to score it.`;
  return `${heard} The centre was ${shape.median}, with scores spread from ${shape.lo} to ${shape.hi}` + (shape.tail ? ` and ${numWord(shape.tail)} at 7 or higher.` : '.');
}

// ---- comments: page them ----
// A comment is up to 500 chars. Pages take as many as fit an estimated height budget so a
// long note gets its own page and three short ones share one.
function pageComments(comments, { budget = 980, perLine = 58, lineH = 44, base = 120 } = {}) {
  const pages = [];
  let cur = [], used = 0;
  for (const c of comments || []) {
    const est = Math.ceil(String(c.body || '').length / perLine) * lineH + base;
    if (cur.length && used + est > budget) { pages.push(cur); cur = []; used = 0; }
    cur.push(c); used += est;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

// Series quartiles for the operator's band-calibration decision (spec §2, open item 1).
function seriesQuartiles(averages) {
  const d = distribution(averages);
  return d ? { n: d.n, q1: d.q1, median: d.median, q3: d.q3, avg: d.avg } : null;
}

module.exports = {
  SCALE_MAX, DEFAULT_EDGES, BANDS, BUCKET, SEGMENT_GAP, GAP_EVEN, GAP_BIG,
  bandFor, shapeOf, distribution, bucketOf, againstRoom, whoFor, setupVsRecord, nextActions,
  decisionSub, pageComments, seriesQuartiles, numWord, plural, fmtScore,
};
