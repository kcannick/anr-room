// share-cards.js — server-side render of the shareable report graphics (3:4, 1080×1440)
// to PNG, using Satori (HTML/flex -> SVG) + resvg (SVG -> PNG). No headless browser, so it
// stays serverless-friendly (the whole point — see docs/multi-tenant-roadmap + the outage rule).
//
// Card types: 'score' (personal), 'ars' (Top 8 A&Rs), 'songs' (Top 8 Records), 'promo'.
// Rank-only by default; raw numbers optional. Every card carries the eyebrow "The A&R Room",
// the big card title, the session/scope subhead, the $500 award pill, makinitmag.com/ANR, @Makinit4indies.
//
// Design tokens mirror the app + docs/mockups/anr-share-graphics-mockups.html.

const fs = require('fs');
const path = require('path');

const W = 1080, H = 1440;
const PRIZE = '$500';

// Two URLs, two audiences — never collapse them. /review is where ARTISTS submit (it
// mirrors the built-in submit fallback in server.js); /ANR is where VIEWERS join the team.
const SUBMIT_URL = 'makinitmag.com/review';
const JOIN_URL = 'makinitmag.com/ANR';

// The score key printed on the chart graphics (operator copy, 2026-08-05). Bands are
// LOWER-INCLUSIVE and stated as half-open ranges so 3.0 and 6.0 each land in exactly one
// band — the operator's original "0-3 / 3-6 / 6+" double-counted both edges.
// CHART_SCALE_MAX is the rating ceiling; it moves 9 -> 10 with the scale switch, and the
// band cuts should be revisited in the same change (see the scoring-scale-0-10 plan).
const CHART_SCALE_MAX = 9;
const CHART_BANDS = [
  { min: 0, max: 3, range: '0–2.9', short: 'Studio', label: 'Keep it in the studio' },
  { min: 3, max: 6, range: '3–5.9', short: 'Release Ready', label: 'Release Ready' },
  { min: 6, max: null, range: '6+', short: 'Potential Single', label: 'Potential Single' },
];

// ---- design tokens ----
const C = {
  bg: '#0d0b16', ink: '#f3f0fb', inkDim: '#a9a2c9', inkFaint: '#6f688f',
  signal: '#4bb749', accent: '#6d5fe0', gold: '#f5c518', hot: '#ff5d6c',
  line: '#2e2750', panel: 'rgba(23,19,40,0.66)', avBg: '#2c2352',
};
const MONO = 'Space Mono', SANS = 'DM Sans';

// ---- fonts (loaded once) ----
let _fonts = null;
function fonts() {
  if (_fonts) return _fonts;
  const dir = path.join(__dirname, 'assets', 'fonts');
  const f = (file, name, weight) => ({ name, weight, style: 'normal', data: fs.readFileSync(path.join(dir, file)) });
  _fonts = [
    f('dm-sans-v17-latin-regular.ttf', SANS, 400),
    f('dm-sans-v17-latin-700.ttf', SANS, 700),
    f('dm-sans-v17-latin-800.ttf', SANS, 800),
    f('dm-sans-v17-latin-900.ttf', SANS, 900),
    f('space-mono-v17-latin-regular.ttf', MONO, 400),
    f('space-mono-v17-latin-700.ttf', MONO, 700),
  ];
  return _fonts;
}

// ---- hyperscript: build Satori's element tree directly ----
// Satori requires an explicit display:flex on any node with >1 child; `col`/`row` set it.
function h(style, children) {
  return { type: 'div', props: { style, children } };
}
function col(style, children) { return h({ display: 'flex', flexDirection: 'column', ...style }, children); }
function row(style, children) { return h({ display: 'flex', flexDirection: 'row', alignItems: 'center', ...style }, children); }
function text(style, str) { return { type: 'div', props: { style, children: String(str == null ? '' : str) } }; }
function esc(s) { return String(s == null ? '' : s); }
// Satori has no reliable CSS ellipsis, so hard-clip long names/titles to one clean line.
function clip(s, n) { s = (s == null ? '' : String(s)).trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
const NOWRAP = { whiteSpace: 'nowrap' };

// A small round avatar with initials (photo support comes later via <img>).
function avatar(name, size) {
  const initials = (esc(name).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || 'A').toUpperCase();
  return h({
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: size, height: size, borderRadius: size, background: C.avBg,
    border: '2px solid rgba(255,255,255,0.10)', color: '#cfc7f4',
    fontFamily: SANS, fontWeight: 800, fontSize: Math.round(size * 0.34),
  }, initials);
}

// ---- shared frame: header (eyebrow / title / sub + award pill), body, footer ----
function frame(opts) {
  const { title, sub, body } = opts;
  const eyeStyle = { fontFamily: MONO, fontWeight: 700, fontSize: 21, letterSpacing: 5, textTransform: 'uppercase' };
  const eyebrow = row({}, [
    text({ ...eyeStyle, color: C.inkDim }, 'The A&R'),
    text({ ...eyeStyle, color: C.signal, marginLeft: 12 }, 'Room'),
  ]);
  // Top-right pill: the award hook by default; Official Room Reports carry their own badge
  // (they're a paid artist product — the $500 pitch stays in the footer instead).
  const pill = opts.pill === 'report'
    ? text({ fontFamily: MONO, fontWeight: 700, fontSize: 17, letterSpacing: 1, color: C.gold,
        border: `2px solid ${C.gold}`, padding: '9px 18px', borderRadius: 999, flexShrink: 0 }, 'OFFICIAL ROOM REPORT')
    : text({ fontFamily: MONO, fontWeight: 700, fontSize: 17, letterSpacing: 1, color: C.bg,
        background: C.gold, padding: '11px 20px', borderRadius: 999, flexShrink: 0 }, `${PRIZE} A&R AWARD`);
  // A null title leaves the header as eyebrow + pill only — the chart COVER carries its
  // own oversized title in the body, centred, and would collide with a header one.
  const headLeft = [eyebrow];
  if (title) headLeft.push(text({ marginTop: 16, fontFamily: SANS, fontWeight: 900, fontSize: opts.titleSize || 78, color: C.ink, lineHeight: 1, ...NOWRAP }, title));
  if (sub) headLeft.push(row({ marginTop: title ? 18 : 14 }, [
    h({ width: 12, height: 12, borderRadius: 12, background: C.signal, marginRight: 12, flexShrink: 0 }, ''),
    text({ fontFamily: SANS, fontWeight: 700, fontSize: 27, color: C.ink, ...NOWRAP }, sub),
  ]));
  const header = row({ justifyContent: 'space-between', alignItems: 'flex-start' }, [
    col({}, headLeft),
    pill,
  ]);
  const footer = row({ justifyContent: 'space-between', alignItems: 'center',
    borderTop: `1px solid ${C.line}`, paddingTop: 30 }, [
    row({}, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 26, color: C.ink }, 'makinitmag.com'),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 26, color: C.signal }, '/ANR'),
    ]),
    col({ alignItems: 'flex-end' }, [
      text({ fontFamily: SANS, fontWeight: 400, fontSize: 16, color: C.inkFaint }, 'Follow'),
      text({ fontFamily: SANS, fontWeight: 800, fontSize: 26, color: C.ink }, '@Makinit4indies'),
    ]),
  ]);
  return col({
    width: W, height: H, background: `linear-gradient(176deg, #241a4d 0%, ${C.bg} 50%)`,
    padding: '58px 68px 44px', justifyContent: 'flex-start',
  }, [
    header,
    col({ flexGrow: 1, justifyContent: 'center', paddingTop: 16, paddingBottom: 16 }, [body]),
    footer,
  ]);
}

const RANK_COLOR = ['#f5c518', '#cdd1e6', '#e59b6b']; // gold / silver / bronze for 1–3

// ---- Top 8 A&Rs (rank-only default; showNumbers adds points) ----
function bodyArs(list, showNumbers) {
  return col({ gap: 11 }, list.slice(0, 8).map((p, i) => {
    const rc = RANK_COLOR[i] || C.inkFaint;
    return row({
      background: C.panel, border: `1px solid ${i === 0 ? 'rgba(245,197,24,0.45)' : C.line}`,
      borderRadius: 18, padding: '14px 26px',
    }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 40, color: rc, width: 60, textAlign: 'center', flexShrink: 0 }, i + 1),
      avatar(p.name, 74),
      col({ flexGrow: 1, flexShrink: 1, marginLeft: 22, overflow: 'hidden' }, [
        text({ fontFamily: SANS, fontWeight: 800, fontSize: 34, color: C.ink, ...NOWRAP }, clip(p.name, 24)),
        text({ fontFamily: SANS, fontWeight: 700, fontSize: 22, color: C.accent, ...NOWRAP }, p.ig ? '@' + clip(p.ig.replace(/^@/, ''), 24) : ''),
      ]),
      showNumbers ? text({ fontFamily: MONO, fontWeight: 700, fontSize: 40, color: C.signal, flexShrink: 0 }, (p.points || 0).toLocaleString()) : text({}, ''),
    ]);
  }));
}

// ---- Top 8 Records (rank-only default; showNumbers adds the room score) ----
function bodySongs(list, showNumbers) {
  return col({ gap: 11 }, list.slice(0, 8).map((s, i) => {
    const rc = RANK_COLOR[i] || C.inkFaint;
    const artist = [s.artist, s.ig ? '@' + s.ig.replace(/^@/, '') : ''].filter(Boolean).join(' · ');
    return row({
      background: C.panel, border: `1px solid ${i === 0 ? 'rgba(245,197,24,0.45)' : C.line}`,
      borderRadius: 18, padding: '18px 26px',
    }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 40, color: rc, width: 60, textAlign: 'center', flexShrink: 0 }, i + 1),
      col({ flexGrow: 1, flexShrink: 1, marginLeft: 20, overflow: 'hidden' }, [
        text({ fontFamily: SANS, fontWeight: 800, fontSize: 34, color: C.ink, ...NOWRAP }, clip(s.title, 26)),
        text({ fontFamily: SANS, fontWeight: 400, fontSize: 23, color: C.inkDim, ...NOWRAP }, clip(artist, 34)),
      ]),
      showNumbers ? text({ fontFamily: MONO, fontWeight: 700, fontSize: 46, color: C.signal, flexShrink: 0 }, (s.score != null ? Number(s.score).toFixed(1) : '')) : text({}, ''),
    ]);
  }));
}

// ---- A&R Record card (rank-forward; points optional) ----
function bodyScore(d) {
  const stat = (v, k, dashed) => col({
    flexGrow: 1, flexBasis: 0, alignItems: 'center', background: 'rgba(23,19,40,0.7)',
    border: `1px ${dashed ? 'dashed' : 'solid'} ${dashed ? '#3a3363' : C.line}`, borderRadius: 20, padding: '24px 10px',
  }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 50, color: C.ink }, v),
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 19, color: C.inkFaint, marginTop: 6 }, k),
  ]);
  const stats = [];
  if (d.bullseyes != null) stats.push(stat(d.bullseyes, 'Exact Reads', false));
  if (d.rounds != null) stats.push(stat(d.rounds, 'Rounds', false));
  if (d.points != null) stats.push(stat((d.points || 0).toLocaleString(), 'Points', true));
  return col({ alignItems: 'center' }, [
    avatar(d.name, 210),
    text({ fontFamily: SANS, fontWeight: 900, fontSize: 56, color: C.ink, marginTop: 26, ...NOWRAP }, clip(d.name, 20)),
    text({ fontFamily: SANS, fontWeight: 700, fontSize: 26, color: C.accent, marginTop: 8 }, d.ig ? '@' + d.ig.replace(/^@/, '') : ''),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 168, color: C.signal, marginTop: 30, lineHeight: 1 }, '#' + d.rank),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 24, letterSpacing: 5, textTransform: 'uppercase', color: C.inkFaint, marginTop: 8 }, 'in a field of ' + d.total + ' A&Rs'),
    stats.length ? row({ marginTop: 44, gap: 20, width: '100%' }, stats) : text({}, ''),
  ]);
}

// ---- Promo / Register ----
function bodyPromo() {
  const step = (n, t) => col({
    flexGrow: 1, flexBasis: 0, alignItems: 'center', background: 'rgba(23,19,40,0.7)',
    border: `1px solid ${C.line}`, borderRadius: 18, padding: '22px 12px',
  }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: C.accent }, n),
    text({ fontFamily: SANS, fontWeight: 700, fontSize: 22, color: C.ink, marginTop: 8, textAlign: 'center' }, t),
  ]);
  return col({ alignItems: 'center' }, [
    col({ alignItems: 'center' }, [
      text({ fontFamily: SANS, fontWeight: 800, fontSize: 52, color: C.ink, textAlign: 'center', lineHeight: 1.15 }, 'Evaluate the music.'),
      text({ fontFamily: SANS, fontWeight: 800, fontSize: 52, color: C.ink, textAlign: 'center', lineHeight: 1.15 }, 'Predict the room.'),
    ]),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 150, color: C.gold, marginTop: 26, lineHeight: 1 }, PRIZE),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: C.inkFaint, marginTop: 8 }, `Top A&Rs compete for ${PRIZE} monthly`),
    row({ marginTop: 44, gap: 14, width: '100%' }, [step('1', 'Evaluate'), step('2', 'Predict'), step('3', 'Rank')]),
    text({ fontFamily: SANS, fontWeight: 800, fontSize: 30, color: '#08240a', background: C.signal, padding: '22px 44px', borderRadius: 16, marginTop: 46 }, 'Claim your profile at makinitmag.com/ANR'),
  ]);
}

// ============ Song Report (paid artist tier) — 3 pages ============
// Design: docs/mockups/song-report-v1.html. All aggregate data; no emoji
// (no emoji font is bundled) and no mixed-weight paragraphs (Satori has no
// inline rich text) — explainers are a bold lead line + a plain line.

// Page 1 — the flex: big room score, heat + votes chips. Share-friendly.
function bodyReport1(d) {
  const chip = (str, goldish) => text({
    fontFamily: SANS, fontWeight: 800, fontSize: 28, color: goldish ? C.gold : C.ink,
    border: `2px solid ${goldish ? 'rgba(245,197,24,0.55)' : C.line}`, background: C.panel,
    borderRadius: 999, padding: '16px 30px',
  }, str);
  return col({ alignItems: 'center' }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 290, color: C.signal, lineHeight: 1 }, d.mean),
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 32, color: C.inkFaint, marginTop: 4 }, 'out of 9'),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 25, letterSpacing: 7, textTransform: 'uppercase', color: C.inkDim, marginTop: 22 }, 'Final room score'),
    row({ marginTop: 48, gap: 18 }, [
      chip(`Room favorite · ${d.heatPct}% scored it 8+`, true),
      chip(`Evaluated by ${d.votes} verified A&Rs`, false),
    ]),
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 25, color: C.inkDim, marginTop: 46 }, `Evaluated live in The A&R Room · ${d.dateLabel}`),
  ]);
}

// Page 2 — the numbers: stat tiles + plain-English explainers + histogram + perception gap.
function bodyReport2(d) {
  const tile = (v, k, gold) => col({
    flexGrow: 1, flexBasis: 0, alignItems: 'center', background: C.panel,
    border: `1px solid ${gold ? 'rgba(245,197,24,0.45)' : C.line}`, borderRadius: 20, padding: '20px 8px',
  }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 60, color: gold ? C.gold : C.signal }, v),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 18, letterSpacing: 4, textTransform: 'uppercase', color: C.inkFaint, marginTop: 8 }, k),
  ]);
  const expl = (dotColor, lead, rest) => row({ alignItems: 'flex-start' }, [
    h({ width: 12, height: 12, borderRadius: 12, background: dotColor, marginTop: 11, marginRight: 16, flexShrink: 0 }, ''),
    col({ flexGrow: 1, flexShrink: 1 }, [
      text({ fontFamily: SANS, fontWeight: 800, fontSize: 25, color: C.ink }, lead),
      text({ fontFamily: SANS, fontWeight: 400, fontSize: 23, color: C.inkDim, lineHeight: 1.35, marginTop: 2 }, rest),
    ]),
  ]);
  const maxC = Math.max(1, ...d.hist);
  const bars = row({ alignItems: 'flex-end', marginTop: 14, gap: 12 }, d.hist.map((c, i) => col(
    { flexGrow: 1, flexBasis: 0, alignItems: 'center', justifyContent: 'flex-end' }, [
      text({ fontFamily: MONO, fontWeight: 400, fontSize: 19, color: C.inkDim, marginBottom: 6 }, c || ' '),
      h({ width: '100%', height: Math.max(6, Math.round(c / maxC * 150)),
          background: d.modes.includes(i) && c > 0 ? C.gold : C.signal, borderRadius: 8 }, ''),
      text({ fontFamily: MONO, fontWeight: 400, fontSize: 19, color: C.inkFaint, marginTop: 6 }, i),
    ])));
  const gap = d.predictMean == null ? text({}, '') : row({
    marginTop: 34, background: C.panel, border: `1px solid rgba(109,95,224,0.6)`,
    borderRadius: 20, padding: '22px 28px', alignItems: 'center',
  }, [
    col({ flexGrow: 1, flexShrink: 1 }, [
      text({ fontFamily: SANS, fontWeight: 800, fontSize: 24, color: C.ink }, 'Prediction vs. final score'),
      text({ fontFamily: SANS, fontWeight: 400, fontSize: 22, color: C.inkDim, lineHeight: 1.35, marginTop: 4 },
        `The room predicted ${d.predictMean} before the reveal and delivered a final score of ${d.mean}. ${d.gapWord}.`),
    ]),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 52, color: d.gapUp ? C.signal : C.inkDim, marginLeft: 24, flexShrink: 0 }, d.gapLabel),
  ]);
  return col({}, [
    row({ gap: 18 }, [tile(d.votes, 'A&Rs', false), tile(d.mean, 'Final score', false), tile(d.median, 'Median', true), tile(d.mode, 'Most common', true)]),
    col({ marginTop: 30, gap: 16 }, [
      expl(C.signal, `Final score ${d.mean}`, 'The average of all eligible A&R evaluations.'),
      expl(C.gold, `Median ${d.median}`, d.medianNote),
      expl(C.gold, `Most common ${d.mode}`, 'The score submitted most often by the room.'),
    ]),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 21, letterSpacing: 5, textTransform: 'uppercase', color: C.inkFaint, marginTop: 34 }, 'How the room scored it'),
    bars,
    gap,
  ]);
}

// Page 3 — who felt it: segments (3+ voters each) + context tiles.
function bodyReport3(d) {
  // Fixed column widths — Satori's flexGrow tracks are unreliable inside nested rows.
  const segBlock = (label, items, unit) => !items.length ? col({}, []) : col({ marginTop: 26 }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 21, letterSpacing: 5, textTransform: 'uppercase', color: C.inkFaint, marginBottom: 12 }, label),
    col({ gap: 10 }, items.map((it, i) => row({}, [
      text({ fontFamily: SANS, fontWeight: 700, fontSize: 26, color: C.ink, width: 258, flexShrink: 0, ...NOWRAP }, clip(it.name, 17)),
      h({ width: 396, height: 22, background: '#1c1631', borderRadius: 11, display: 'flex', flexShrink: 0 }, [
        h({ width: Math.round(it.avg / 9 * 396), height: 22, borderRadius: 11, background: i === 0 ? C.gold : C.signal }, ''),
      ]),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 28, color: i === 0 ? C.gold : C.signal, width: 104, textAlign: 'right', flexShrink: 0 }, it.avg.toFixed(1)),
      text({ fontFamily: SANS, fontWeight: 400, fontSize: 20, color: C.inkFaint, width: 128, textAlign: 'right', flexShrink: 0 }, `${it.n} ${unit}`),
    ]))),
  ]);
  const ctxBox = (v, k) => col({
    flexGrow: 1, flexBasis: 0, alignItems: 'center', background: C.panel,
    border: `1px solid ${C.line}`, borderRadius: 20, padding: '24px 10px',
  }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 50, color: C.gold, ...NOWRAP }, v),
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 21, color: C.inkDim, marginTop: 8, textAlign: 'center', lineHeight: 1.3 }, k),
  ]);
  const boxes = [];
  if (d.rankInRoom) boxes.push(ctxBox(`#${d.rankInRoom.rank}`, `of ${d.rankInRoom.total} records in this session`));
  if (d.seriesPct) boxes.push(ctxBox(`Top ${d.seriesPct.pct}%`, `of ${d.seriesPct.total} records this series`));
  if (d.pools) boxes.push(ctxBox(`${d.pools.in.avg.toFixed(1)} / ${d.pools.remote.avg.toFixed(1)}`, 'in-room vs. remote evaluations'));
  return col({}, [
    segBlock('By professional role', d.roles || [], 'A&Rs'),
    segBlock('By city', d.cities || [], 'A&Rs'),
    boxes.length ? row({ marginTop: 34, gap: 18 }, boxes) : col({}, []),
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 19, color: C.inkFaint, lineHeight: 1.45, marginTop: 30 },
      `Aggregated results only. A segment appears when at least three A&Rs qualify. Based on ${d.votes} verified evaluations, one per A&R, submitted before the reveal.`),
  ]);
}

// ---- Chart carousel: cover slide + list slides ("Makin' It HOT 100") ----
// The cover carries the oversized title itself (frame's header title is suppressed), the
// period, what the room is, the score key, and the join CTA. List slides repeat the key in
// one line so someone who swipes past the cover can still decode an 8.6.
const BAND_COLOR = [C.inkFaint, C.gold, C.signal];

function bandKeyRow(b, i) {
  return row({
    background: C.panel, border: `1px solid ${i === 2 ? 'rgba(75,183,73,0.45)' : C.line}`,
    borderRadius: 14, padding: '14px 22px', width: '100%',
  }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 26, color: BAND_COLOR[i], width: 110, flexShrink: 0 }, b.range),
    text({ fontFamily: SANS, fontWeight: 700, fontSize: 26, color: C.ink, ...NOWRAP }, b.label),
  ]);
}

function bodyChartCover(d) {
  const words = esc(d.title).trim().split(/\s+/);
  const hot = words.length > 2 ? words.slice(-2).join(' ') : words.slice(-1).join(' ');
  const top = words.length > 2 ? words.slice(0, -2).join(' ') : words.slice(0, -1).join(' ');
  const bands = d.bands || CHART_BANDS;
  return col({ alignItems: 'center', width: '100%' }, [
    top ? text({ fontFamily: SANS, fontWeight: 900, fontSize: 96, color: C.ink, lineHeight: 1.02, ...NOWRAP }, top.toUpperCase()) : text({}, ''),
    text({ fontFamily: SANS, fontWeight: 900, fontSize: 96, color: C.hot, lineHeight: 1.02, ...NOWRAP }, hot.toUpperCase()),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 32, letterSpacing: 8, textTransform: 'uppercase', color: C.gold, marginTop: 18, ...NOWRAP }, clip(d.sub, 30)),
    h({ width: 150, height: 4, background: C.signal, marginTop: 30, marginBottom: 30 }, ''),
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 27, color: C.inkDim }, 'Tracks submitted to the A&R Room'),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 29, color: C.ink, marginTop: 8 }, SUBMIT_URL),
    col({ gap: 12, width: '100%', marginTop: 38 }, bands.map(bandKeyRow)),
    text({ fontFamily: SANS, fontWeight: 800, fontSize: 34, color: C.ink, marginTop: 40 }, 'Join the A&R Team'),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: C.signal, marginTop: 8 }, JOIN_URL),
  ]);
}

// Rows arrive pre-normalized ({rank, line1, line2, value}) so this stays dumb about
// whether it's ranking records or A&Rs. Density flips to one line past 12 per slide —
// 20 two-line rows don't fit 1440px, and a clipped chart is worse than a terse one.
function bodyChartList(d) {
  const rows = d.rows || [], per = rows.length;
  const tight = per > 12;
  // Row heights are budgeted against the ~1045px the frame leaves below the header and
  // key line. 20 two-line rows can't fit 1440px, and 20 loose one-line rows overflow the
  // footer — hence the explicit lineHeight, which Satori otherwise pads unpredictably.
  const s = tight
    ? { pad: '5px 18px', gap: 5, rank: 22, title: 22, sub: 18, val: 24, rankW: 56, rad: 12, clipT: 28, clipS: 22 }
    : { pad: '11px 24px', gap: 10, rank: 36, title: 33, sub: 22, val: 40, rankW: 74, rad: 16, clipT: 25, clipS: 32 };
  const key = row({ justifyContent: 'center', gap: 26, marginBottom: 18 },
    (d.bands || CHART_BANDS).map((b, i) => row({ gap: 8 }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 19, color: BAND_COLOR[i] }, b.range),
      text({ fontFamily: SANS, fontWeight: 400, fontSize: 19, color: C.inkFaint, ...NOWRAP }, b.short),
    ])));
  const list = col({ gap: s.gap, width: '100%' }, rows.map(r => {
    // `top` is explicit, not `rank === 1` — a Room #1s slide is ten different #1s and
    // must not gold-plate all ten (or, worse, only the first).
    const first = !!r.top;
    const line = col({ flexGrow: 1, flexShrink: 1, marginLeft: 8, overflow: 'hidden' }, tight
      ? [text({ fontFamily: SANS, fontWeight: 700, fontSize: s.title, lineHeight: 1.15, color: C.ink, ...NOWRAP },
          clip(r.line1, s.clipT) + (r.line2 ? '  ·  ' + clip(r.line2, s.clipS) : ''))]
      : [
          text({ fontFamily: SANS, fontWeight: 800, fontSize: s.title, lineHeight: 1.2, color: C.ink, ...NOWRAP }, clip(r.line1, s.clipT)),
          text({ fontFamily: SANS, fontWeight: 400, fontSize: s.sub, lineHeight: 1.2, color: C.inkDim, ...NOWRAP }, clip(r.line2 || '', s.clipS)),
        ]);
    return row({
      background: C.panel, border: `1px solid ${first ? 'rgba(245,197,24,0.45)' : C.line}`,
      borderRadius: s.rad, padding: s.pad, width: '100%', flexShrink: 0,
    }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: s.rank, color: first ? C.gold : C.inkFaint, width: s.rankW, flexShrink: 0 }, r.rank),
      line,
      text({ fontFamily: MONO, fontWeight: 700, fontSize: s.val, color: C.signal, flexShrink: 0 }, r.value),
    ]);
  }));
  return col({ width: '100%' }, [key, list]);
}

// ---- element builders per type ----
function element(type, data = {}) {
  const showNumbers = !!data.showNumbers;
  if (type === 'score') return frame({ title: 'A&R Record', sub: data.session || null, body: bodyScore(data) });
  if (type === 'ars')   return frame({ title: 'Top 8 A&Rs', sub: data.scope || data.session || null, body: bodyArs(data.list || [], showNumbers) });
  if (type === 'songs') return frame({ title: 'Top 8 Records', sub: data.session || null, body: bodySongs(data.list || [], showNumbers) });
  if (type === 'promo') return frame({ title: 'Join the A&R Team', sub: 'Free to join', body: bodyPromo() });
  if (type === 'report1') return frame({ pill: 'report', title: clip(data.title, 18), sub: data.sub, body: bodyReport1(data) });
  if (type === 'report2') return frame({ pill: 'report', titleSize: 60, title: "The room's verdict", sub: data.sub, body: bodyReport2(data) });
  if (type === 'report3') return frame({ pill: 'report', titleSize: 60, title: 'Who connected', sub: data.sub, body: bodyReport3(data) });
  if (type === 'chartCover') return frame({ title: null, sub: null, body: bodyChartCover(data) });
  if (type === 'chartList') return frame({ titleSize: 66, title: clip(data.title, 18), sub: data.sub, body: bodyChartList(data) });
  throw new Error('unknown card type: ' + type);
}

// ---- render to PNG ----
let _satori = null, _Resvg = null;
async function renderPng(type, data) {
  if (!_satori) { const m = require('satori'); _satori = m.default || m; }
  if (!_Resvg) { _Resvg = require('@resvg/resvg-js').Resvg; }
  const svg = await _satori(element(type, data), { width: W, height: H, fonts: fonts() });
  const png = new _Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  return png;
}

module.exports = { renderPng, element, W, H, PRIZE, CHART_BANDS, CHART_SCALE_MAX, SUBMIT_URL, JOIN_URL };
