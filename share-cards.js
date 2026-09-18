// share-cards.js — server-side render of the shareable report graphics (3:4, 1080×1440)
// to PNG, using Satori (HTML/flex -> SVG) + resvg (SVG -> PNG). No headless browser, so it
// stays serverless-friendly (the whole point — see docs/multi-tenant-roadmap + the outage rule).
//
// Card types: 'score' (personal), 'ars' (Top 8 A&Rs), 'songs' (Top 8 Records), 'promo';
// the artist's Track Report is 'trackPage' (see below), the daily graphics 'recap*' / 'resultsSlide' /
// 'winnerPost' (the Top Track / Top A&R of the Day and of the Week collab posts).
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
const MONO = 'Space Mono', SANS = 'DM Sans', DISPLAY = 'Archivo';

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
    // Archivo is the brand's display face (anr-brand skill). The older cards were built on
    // DM Sans before the brand system existed and stay that way; the recap graphics are
    // the first cards built to the brand, so they carry it. Static weights only.
    f('archivo-v25-latin-800.ttf', DISPLAY, 800),
    f('archivo-v25-latin-900.ttf', DISPLAY, 900),
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
  // Top-right pill: the award hook. (The artist's Track Report is not on this frame — it is
  // its own element, 'trackPage', built to the brand.)
  const pill = text({ fontFamily: MONO, fontWeight: 700, fontSize: 17, letterSpacing: 1, color: C.bg,
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

// ============ The A&R Meeting Recap — daily stream graphics ============
// Two formats off ONE data shape { date, artists[], ars[] }:
//   'recapCover'  1080×1920 (9:16) — the Instagram Live cover
//   'recapThumb'  1920×1080 (16:9) — the YouTube thumbnail
// Built to the brand (anr-brand skill): Archivo display + Space Mono data, signal green as
// the ONLY accent (a live stream = green; nothing here is head-to-head or money), and the
// 13° device as the block, the rule, the tick bullets and a cut on one edge of the names
// panel. Copy is the operator's, verbatim. The approved look is the Chrome-rendered
// public/graphics/meeting-recap.html in the main checkout; this is that design in Satori so
// it renders on the serverless publish path with no headless browser.
//
// The names panel takes the day's ARTISTS in drop order and the Top 8 A&Rs ALPHABETISED:
// the stream is a countdown that reveals the ranking, so nothing on the cover may be in
// rank order. Empty lists render as ruled blank lines so the panel reads as intentional.
const RECAP_SIZES = { recapCover: [1080, 1920], recapThumb: [1920, 1080] };
const RECAP = {
  bg: '#0e0c1a', panel: '#171328', line: '#2e2750', fg: '#eae9f2', dim: '#9793b4',
  green: '#4bb749', greenInk: '#06210b',
};
const RECAP_TITLE = 'The A&R Meeting Recap';
const RECAP_TIME = 'Daily at 2PM';   // the reveal stream (operator schedule, 2026-09-13)
const RECAP_CTA = [
  { label: 'Submit Music', url: 'makinitmag.com/Review' },
  { label: 'Become an A&R', url: JOIN_URL },
];
const SKEW = -13, TAN13 = Math.tan(13 * Math.PI / 180);

let _logo = null;
function logoDataUri() {
  if (!_logo) _logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'makinit-logo-white.png')).toString('base64');
  return _logo;
}
// The mark: a skewed green square holding "A&R", the glyphs un-skewed inside it.
function arBlock(size, fontSize) {
  return h({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: size, height: size, background: RECAP.green, borderRadius: Math.round(size * 0.075),
    transform: `skewX(${SKEW}deg)` },
    text({ transform: `skewX(${-SKEW}deg)`, fontFamily: DISPLAY, fontWeight: 900, fontSize,
      letterSpacing: -Math.round(fontSize * 0.05), color: RECAP.greenInk, lineHeight: 1 }, 'A&R'));
}
function tick(w, hgt, mr) {
  return h({ width: w, height: hgt, background: RECAP.green, transform: `skewX(${SKEW}deg)`, flexShrink: 0, marginRight: mr }, '');
}
function recapTitle(lines, fontSize) {
  // "A&R" is the mark, so it takes the green; every other word stays ink.
  const st = { fontFamily: DISPLAY, fontWeight: 900, fontSize, lineHeight: 0.88, textTransform: 'uppercase',
    letterSpacing: -Math.round(fontSize * 0.04), ...NOWRAP };
  return col({}, lines.map(words => row({ alignItems: 'flex-end' }, words.map((w, i) =>
    text({ ...st, color: w === 'A&R' ? RECAP.green : RECAP.fg, marginLeft: i ? Math.round(fontSize * 0.18) : 0 }, w)))));
}
function recapRule(w, hgt, mt, mb) {
  return h({ width: w, height: hgt, background: RECAP.green, transform: `skewX(${SKEW}deg)`, marginTop: mt, marginBottom: mb, marginLeft: 4 }, '');
}
function recapDate(date, fontSize) {
  return text({ fontFamily: MONO, fontWeight: 700, fontSize, lineHeight: 1, letterSpacing: -Math.round(fontSize * 0.02), color: RECAP.fg, ...NOWRAP }, date);
}
function recapTime(fontSize, mt) {
  return text({ fontFamily: MONO, fontWeight: 700, fontSize, color: RECAP.green, textTransform: 'uppercase', letterSpacing: Math.round(fontSize * 0.18), lineHeight: 1, marginTop: mt, ...NOWRAP }, RECAP_TIME);
}
function recapCta(c, { tickW, tickH, tickMr, labelSize, labelW, urlSize, urlMl }) {
  return row({}, [
    tick(tickW, tickH, tickMr),
    text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: labelSize, letterSpacing: -Math.round(labelSize * 0.03), lineHeight: 1, color: RECAP.fg, ...(labelW ? { width: labelW } : {}), ...NOWRAP }, c.label),
    text({ fontFamily: MONO, fontWeight: 400, fontSize: urlSize, lineHeight: 1, color: RECAP.dim, marginLeft: urlMl || 0, ...NOWRAP }, c.url),
  ]);
}

// The credits panel. Think movie-poster credits: big enough to read when you go looking,
// small enough never to compete with the title or the date. Space Mono regular (a name here
// is a catalog string, not a headline), muted ink, no rules. ONE font size for the whole
// block, fitted so the LONGEST name fits its column — a handle is never clipped unless it
// would not fit even at the floor size. The panel's height fits the count, so a four-record
// day gets a small block and a sixteen-record day a taller one, and the 13° cut on its right
// edge (Satori has no clip-path polygon, so it is a skewed rectangle inside an overflow-
// hidden box) only ever costs the lowest rows of the last column a little width.
//
// `groups` are the columns, left to right: [{ label, names }]. Equal widths.
const CREDITS_INK = '#b9b5d2';
const MONO_EM = 0.6;   // Space Mono advance width, in em
function creditsPanel({ left, top, bottom, width, padT, padR, padB, padL, gap, capSize, minRows, fs: [lo, hi], groups }) {
  const n = groups.length;
  const colW = Math.floor((width - padL - padR - gap * (n - 1)) / n);
  const rows = Math.max(minRows, ...groups.map(g => g.names.length));
  const capH = capSize + Math.round(capSize * 0.7);
  // Geometry for a candidate size; the inset only touches the LAST column.
  const geo = (fs) => {
    const rowH = Math.round(fs * 1.55);
    const height = padT + capH + rows * rowH + padB;
    const off = Math.ceil(height * TAN13);
    const inset = (ci, i) => ci === n - 1 ? Math.ceil(off * ((padT + capH + (i + 1) * rowH) / height)) + 4 : 0;
    return { fs, rowH, height, off, inset };
  };
  // Two passes: size for the longest name at the largest geometry, then settle.
  let g = geo(hi);
  let fit = hi;
  groups.forEach((grp, ci) => grp.names.forEach((nm, i) => {
    const avail = colW - g.inset(ci, i);
    fit = Math.min(fit, avail / (MONO_EM * Math.max(1, String(nm).length)));
  }));
  g = geo(Math.max(lo, Math.min(hi, Math.floor(fit))));
  const { fs, rowH, height, off, inset } = g;
  const y = top != null ? top : bottom - height;
  const bg = h({ position: 'absolute', top: 0, left: -off - 40, width: width + 40, height, background: RECAP.panel,
    transform: `skewX(${SKEW}deg)`, transformOrigin: 'top left' }, '');
  const cols = [];
  groups.forEach((grp, ci) => {
    if (ci) cols.push(h({ width: gap, flexShrink: 0 }, ''));
    const lines = [];
    for (let i = 0; i < rows; i++) {
      const avail = colW - inset(ci, i);
      const maxChars = Math.max(4, Math.floor(avail / (MONO_EM * fs)));
      lines.push(h({ display: 'flex', alignItems: 'center', width: avail, height: rowH, flexShrink: 0, overflow: 'hidden' },
        text({ fontFamily: MONO, fontWeight: 400, fontSize: fs, lineHeight: 1, color: CREDITS_INK, ...NOWRAP }, clip(grp.names[i] || '', maxChars))));
    }
    cols.push(col({ width: colW, height: height - padT - padB, flexShrink: 0, overflow: 'hidden' }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: capSize, textTransform: 'uppercase', letterSpacing: Math.round(capSize * 0.22),
        color: RECAP.dim, opacity: 0.75, height: capH, ...NOWRAP }, grp.label || ''),
      ...lines,
    ]));
  });
  return h({ position: 'absolute', left, top: y, width, height, overflow: 'hidden', display: 'flex' }, [
    bg,
    h({ position: 'absolute', left: 0, top: 0, width, height, display: 'flex', flexDirection: 'row',
      padding: `${padT}px ${padR}px ${padB}px ${padL}px` }, cols),
  ]);
}

function elementRecapCover(d) {
  const W0 = 1080, H0 = 1920;
  const artists = d.artists || [], ars = d.ars || [];
  // Up to 8 artists is one column beside the A&Rs. A bigger day splits the artists across
  // two columns (drop order, top to bottom then across) so the block stays short.
  const split = artists.length > 8;
  const half = Math.ceil(artists.length / 2);
  const groups = split
    ? [{ label: 'Artists', names: artists.slice(0, half) }, { label: '', names: artists.slice(half) }, { label: 'A&Rs', names: ars }]
    : [{ label: 'Artists', names: artists }, { label: 'A&Rs', names: ars }];
  return h({ position: 'relative', display: 'flex', width: W0, height: H0, background: RECAP.bg }, [
    // head — under IG Live's top chrome (~220px)
    h({ position: 'absolute', left: 80, right: 80, top: 250, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, [
      arBlock(190, 78),
      { type: 'img', props: { src: logoDataUri(), style: { height: 44, opacity: 0.94 } } },
    ]),
    // mid — title + date in the middle third, clear of both IG strips
    h({ position: 'absolute', left: 80, right: 80, top: 600, display: 'flex', flexDirection: 'column' }, [
      recapTitle([['The', 'A&R'], ['Meeting'], ['Recap']], 136),
      recapRule(260, 12, 36, 34),
      recapDate(d.date, 196),
      recapTime(34, 22),
    ]),
    h({ position: 'absolute', left: 80, right: 80, top: 1330, display: 'flex', flexDirection: 'column', gap: 22 },
      RECAP_CTA.map(c => recapCta(c, { tickW: 14, tickH: 34, tickMr: 22, labelSize: 46, labelW: 440, urlSize: 30 }))),
    // credits — bottom-anchored, so a short day leaves ground rather than an empty field
    creditsPanel({ left: 80, bottom: 1880, width: 920, padT: 26, padR: 30, padB: 26, padL: 50, gap: 30,
      capSize: 19, minRows: 4, fs: [17, 24], groups }),
  ]);
}

function elementRecapThumb(d) {
  const W0 = 1920, H0 = 1080;
  const artists = d.artists || [], ars = d.ars || [];
  const groups = [{ label: 'Artists', names: artists }, { label: 'A&Rs', names: ars }];
  return h({ position: 'relative', display: 'flex', width: W0, height: H0, background: RECAP.bg }, [
    h({ position: 'absolute', left: 90, top: 80, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 40 }, [
      arBlock(120, 50),
      { type: 'img', props: { src: logoDataUri(), style: { height: 38, opacity: 0.94 } } },
    ]),
    h({ position: 'absolute', left: 90, top: 250, width: 1140, display: 'flex', flexDirection: 'column' }, [
      recapTitle([['The', 'A&R', 'Meeting'], ['Recap']], 118),
      recapRule(220, 11, 30, 26),
      recapDate(d.date, 220),
      recapTime(30, 16),
    ]),
    h({ position: 'absolute', left: 90, top: 905, display: 'flex', flexDirection: 'row', gap: 70 },
      RECAP_CTA.map(c => recapCta(c, { tickW: 12, tickH: 30, tickMr: 18, labelSize: 38, urlSize: 26, urlMl: 18 }))),
    // credits — top-right, right of the title; the bottom-right (x>1500, y>880) stays clear
    // for YouTube's duration badge.
    creditsPanel({ left: 1250, top: 80, width: 600, padT: 28, padR: 30, padB: 28, padL: 34, gap: 30,
      capSize: 18, minRows: 4, fs: [18, 26], groups }),
  ]);
}


// ============ Referral graphics — the A&R's own promo set ============
// Four per-user graphics off ONE data shape { name, category, location, photo, qrJoin, qrSubmit }
// (photo and the two QRs are data URIs, prepared by the caller — this module never fetches):
//   'referCard'   1080×1350 — the A&R Team card (portrait); face, name, title, both QRs
//   'referStory'  1080×1920 — the same as a story
//   'referJoin'   1080×1350 — "Join the A&R Team." on the green cut, the join QR
//   'referSubmit' 1080×1350 — "Submit your music." on the purple cut, the submit QR
// Built to the approved canvas (design/refer, 2026-09-18) and the brand: Archivo display,
// Space Mono labels, the 13° cut as a colour field that stays BELOW the copy on the two
// flyers (never behind type), gold on the $1,000 and nothing else. The copy is the
// operator's, verbatim ("Official A&R", "$1,000 Giveaway", "$1,000 Promo Budget").
const REFER_SIZES = { referCard: [1080, 1350], referStory: [1080, 1920], referJoin: [1080, 1350], referSubmit: [1080, 1350] };
const REFER = { ...RECAP, purple: '#6d5fe0', gold: '#f5c518', avBg: '#221b3a' };
const REFER_COPY = {
  title: 'Official A&R · The A&R Team',
  statement: 'I rate new records every day and help choose which artists get covered and who wins the ',
  money: '$1,000 Promo Budget',
  giveaway: '$1,000 GIVEAWAY',
  join: { title: ['Join the', 'A&R Team.'], sub: 'Become an official A&R. Rate new records every day and help choose which artists get covered and who wins the $1,000 Promo Budget.' },
  submit: { title: ['Submit', 'your music.'], sub: 'Get your record rated by the A&R Team, get a full report on what they heard, and enter the $1,000 Giveaway for a $1,000 Promo Budget.' },
  dm: 'or DM me for the link', dms: 'or DM me for the links', scan: 'Scan the code',
  qrJoin: 'Join the A&R Team', qrSubmit: 'Submit your music',
};
// The block in any fill, letters in any ink (the recap block is green-only).
function referBlock(size, fontSize, fill, ink) {
  return h({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: size, height: size, background: fill, borderRadius: Math.round(size * 0.075),
    transform: `skewX(${SKEW}deg)` },
    text({ transform: `skewX(${-SKEW}deg)`, fontFamily: DISPLAY, fontWeight: 900, fontSize,
      letterSpacing: -Math.round(fontSize * 0.05), color: ink, lineHeight: 1 }, 'A&R'));
}
function referLockup(fill, ink) {
  return row({ gap: 34 }, [
    referBlock(84, 30, fill, ink),
    text({ fontFamily: DISPLAY, fontWeight: 800, fontSize: 52, letterSpacing: 7, textTransform: 'uppercase', color: REFER.fg, ...NOWRAP }, 'Team'),
  ]);
}
function referEndorse(hgt) {
  return row({ gap: hgt }, [
    text({ fontFamily: MONO, fontWeight: 400, fontSize: Math.round(hgt * 1.1), letterSpacing: Math.round(hgt * 0.15), textTransform: 'uppercase', color: REFER.dim, ...NOWRAP }, 'Brought to you by'),
    { type: 'img', props: { src: logoDataUri(), style: { height: hgt } } },
  ]);
}
// A full-bleed colour field cut along the 13° line. `top` is the field's top edge at the LEFT
// margin; the skew lifts the right end by ~23% of the width.
function referCut(fill, top, hgt, Wd) {
  return h({ position: 'absolute', left: -200, top, width: Wd + 400, height: hgt, background: fill,
    transform: `skewY(${SKEW}deg)`, transformOrigin: 'left top' }, '');
}
function referFace(d, size) {
  const border = Math.round(size * 0.02);
  if (d.photo) {
    return { type: 'img', props: { src: d.photo, width: size, height: size,
      style: { width: size, height: size, borderRadius: size, objectFit: 'cover', border: `${border}px solid ${REFER.purple}`, flexShrink: 0 } } };
  }
  const initials = (esc(d.name).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || 'A').toUpperCase();
  return h({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: size, height: size, borderRadius: size, background: REFER.avBg, border: `${border}px solid ${REFER.purple}` },
    text({ fontFamily: DISPLAY, fontWeight: 800, fontSize: Math.round(size * 0.32), letterSpacing: -Math.round(size * 0.012), color: REFER.purple }, initials));
}
function referQr(src, size, label) {
  return col({ gap: 18, flexGrow: 1 }, [
    h({ display: 'flex', padding: 16, background: REFER.fg, alignSelf: 'flex-start' },
      { type: 'img', props: { src, width: size, height: size, style: { width: size, height: size } } }),
    text({ fontFamily: MONO, fontWeight: 400, fontSize: 28, color: REFER.fg, ...NOWRAP }, label),
  ]);
}
// The name, two lines, hard-clipped so a long display name never runs under the QRs.
function referName(name, fontSize) {
  const words = esc(name).trim().split(/\s+/).filter(Boolean);
  const first = clip(words[0] || 'A&R', 14), rest = clip(words.slice(1).join(' '), 14);
  const st = { fontFamily: DISPLAY, fontWeight: 900, fontSize, lineHeight: 0.92, letterSpacing: -Math.round(fontSize * 0.04), color: REFER.fg, ...NOWRAP };
  return col({}, rest ? [text(st, first), text(st, rest)] : [text(st, first)]);
}
function elementReferPerson(d, story) {
  const W0 = 1080, H0 = story ? 1920 : 1350;
  const face = story ? 500 : 300, nameSize = story ? 118 : 88, stmt = story ? 40 : 34, qr = story ? 240 : 176;
  const stStyle = { fontFamily: DISPLAY, fontWeight: 800, fontSize: stmt, lineHeight: 1.25, letterSpacing: -Math.round(stmt * 0.02), color: REFER.fg };
  return h({ position: 'relative', display: 'flex', width: W0, height: H0, background: REFER.bg, overflow: 'hidden' }, [
    referCut(REFER.green, -Math.round(H0 * 0.18), Math.round(H0 * 0.42), W0),
    col({ position: 'absolute', left: 80, right: 80, top: 72, bottom: 72, justifyContent: 'space-between' }, [
      row({ justifyContent: 'space-between' }, [referLockup(REFER.bg, REFER.green)]),
      col({ gap: story ? 44 : 18 }, [
        referFace(d, face),
        col({ gap: 14 }, [
          referName(d.name, nameSize),
          text({ fontFamily: MONO, fontWeight: 400, fontSize: 30, letterSpacing: 6, textTransform: 'uppercase', color: REFER.green, marginTop: 10, ...NOWRAP }, REFER_COPY.title),
          text({ fontFamily: MONO, fontWeight: 400, fontSize: 26, color: REFER.dim, ...NOWRAP }, [d.category, d.location].filter(Boolean).join(' · ')),
        ]),
        // Satori has no inline runs, so the statement is laid as wrapped words: the money
        // words take gold, everything else ink, and the wrap gap stands in for the space.
        row({ flexWrap: 'wrap', maxWidth: 920, columnGap: Math.round(stmt * 0.26), rowGap: 0, alignItems: 'baseline' }, [
          ...REFER_COPY.statement.trim().split(' ').map(w => text(stStyle, w)),
          ...REFER_COPY.money.split(' ').map((w, i, a) => text({ ...stStyle, color: REFER.gold }, w + (i === a.length - 1 ? '.' : ''))),
        ]),
      ]),
      col({ gap: 28 }, [
        h({ height: 2, background: REFER.line, transform: `skewX(${SKEW}deg)` }, ''),
        row({ gap: 40, alignItems: 'flex-start' }, [referQr(d.qrJoin, qr, REFER_COPY.qrJoin), referQr(d.qrSubmit, qr, REFER_COPY.qrSubmit)]),
        text({ fontFamily: MONO, fontWeight: 400, fontSize: 26, color: REFER.dim, ...NOWRAP }, REFER_COPY.dms),
        referEndorse(22),
      ]),
    ]),
  ]);
}
function elementReferFlyer(d, kind) {
  const W0 = 1080, H0 = 1350;
  const join = kind === 'referJoin';
  const fill = join ? REFER.green : REFER.purple, onFill = join ? REFER.bg : REFER.fg;
  const c = join ? REFER_COPY.join : REFER_COPY.submit;
  const tSt = { fontFamily: DISPLAY, fontWeight: 900, fontSize: 128, lineHeight: 0.92, letterSpacing: -5, color: REFER.fg, ...NOWRAP };
  return h({ position: 'relative', display: 'flex', width: W0, height: H0, background: REFER.bg, overflow: 'hidden' }, [
    // the colour field: its top edge at the left margin sits at 1170, so the copy above is
    // always on ink and the QR + "scan" line below are always on colour.
    referCut(fill, 1170, 800, W0),
    col({ position: 'absolute', left: 80, right: 80, top: 72, bottom: 72, justifyContent: 'space-between' }, [
      row({ justifyContent: 'space-between' }, [referLockup(fill, join ? REFER.greenInk : REFER.fg), referEndorse(22)]),
      col({ gap: 28 }, [
        row({ gap: 18 }, [
          h({ width: 6, height: 34, background: REFER.gold, transform: `skewX(${SKEW}deg)`, flexShrink: 0 }, ''),
          text({ fontFamily: MONO, fontWeight: 700, fontSize: 40, letterSpacing: 2, color: REFER.gold, ...NOWRAP }, REFER_COPY.giveaway),
        ]),
        col({}, c.title.map(l => text(tSt, l))),
        text({ fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, lineHeight: 1.3, letterSpacing: -1, color: REFER.dim, maxWidth: 880 }, c.sub),
      ]),
      row({ justifyContent: 'space-between', alignItems: 'flex-end', gap: 40 }, [
        col({ gap: 14, paddingBottom: 20 }, [
          text({ fontFamily: MONO, fontWeight: 400, fontSize: 30, color: onFill, ...NOWRAP }, REFER_COPY.scan),
          text({ fontFamily: MONO, fontWeight: 400, fontSize: 26, color: onFill, opacity: 0.75, ...NOWRAP }, REFER_COPY.dm),
        ]),
        h({ display: 'flex', padding: 20, background: REFER.fg, flexShrink: 0 },
          { type: 'img', props: { src: join ? d.qrJoin : d.qrSubmit, width: 240, height: 240, style: { width: 240, height: 240 } } }),
      ]),
    ]),
  ]);
}
// ============ The A&R Meeting results carousels — posted after the reveal stream ============
// Two Instagram carousels off ONE element type, 'resultsSlide', 1080×1350 a slide:
//   set 'song'  slide 1 the top record · list slides: the other records RANKED, NO SCORES
//               (operator, 2026-09-13) · last slide: "Submit your music"
//   set 'ar'    slide 1 the top A&R (with the profile photo when there is one) · list slides:
//               the other top A&Rs with points · last slide: "Join the A&R Team"
// The list is split evenly across as many slides as it needs (six rows a slide), so a
// fourteen-record day is five slides and a four-record day is three. Posted AFTER the reveal,
// so ranks are public. Gold marks first place (the trophy) and the $500 only. Built to the
// approved mockup public/brand/daily/carousel.html; the layout numbers here are that file's.
//
// Data shape (built by server.js resultsCarouselData):
//   { set, slide, total, date, kind: 'hero'|'list'|'cta',
//     hero: { label, title, sub, subDim, handle, photo? (data URI) },
//     rows: [{ rank: '02', line1, line2, value }], listLabel,
//     cta: { eyebrow, head: [lines], body, url } }
const RESULTS_SIZE = [1080, 1350];
const RESULTS_GOLD = '#f5c518';
const RESULTS_PER_SLIDE = 6;
const RESULTS_URL = JOIN_URL;
// A stroke trophy on the 24 grid, gold: the brand draws icons, never emoji.
let _trophy = null;
function trophyDataUri() {
  if (!_trophy) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + RESULTS_GOLD
      + '" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter">'
      + '<path d="M7 4 H17 V9 A5 5 0 0 1 7 9 Z"/><path d="M7 6 H4 V8 A3 3 0 0 0 7 10"/><path d="M17 6 H20 V8 A3 3 0 0 1 17 10"/>'
      + '<path d="M12 14 V17"/><path d="M9 17 H15 V20 H9 Z"/></svg>';
    _trophy = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  }
  return _trophy;
}
const RES_DISPLAY = (fontSize, color, extra = {}) => ({ fontFamily: DISPLAY, fontWeight: 900, fontSize, lineHeight: 1,
  letterSpacing: -Math.round(fontSize * 0.04), color, ...NOWRAP, ...extra });
function resultsLockup() {
  // [A&R] MEETING — the stage 1 lockup in Satori: the block, then the word, no article.
  return h({ position: 'absolute', left: 80, top: 150, display: 'flex', flexDirection: 'row', alignItems: 'center' }, [
    arBlock(120, 47),
    text(RES_DISPLAY(112, RECAP.fg, { textTransform: 'uppercase', marginLeft: 30 }), 'Meeting'),
  ]);
}
function resultsField(height, cutTop) {
  // The 13° cut: a green box sheared with skewY so its top edge rises to the right (1080·tan13 = 249px).
  // Satori skews about the box's CENTRE whatever transform-origin says, so the box is placed
  // half a shear higher (540 · tan13 = 124px) to land its left edge at cutTop.
  const boxH = height * 2 + 300;
  return h({ position: 'absolute', left: 0, top: 1350 - height, width: 1080, height, overflow: 'hidden', display: 'flex' }, [
    h({ position: 'absolute', left: 0, top: cutTop - Math.round(540 * TAN13), width: 1080, height: boxH, background: RECAP.green,
      transform: 'skewY(-13deg)' }, ''),
  ]);
}
function resultsFoot(leftTxt, rightTxt) {
  const st = { fontFamily: MONO, fontWeight: 700, fontSize: 28, letterSpacing: 1, color: RECAP.bg, ...NOWRAP };
  return h({ position: 'absolute', left: 80, right: 80, bottom: 72, display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }, [
    text(st, leftTxt || ''), text(st, rightTxt || ''),
  ]);
}
function resultsEyebrow(label) {
  return row({ position: 'absolute', left: 80, top: 420 }, [
    tick(8, 22, 13),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 26, letterSpacing: 3.6, textTransform: 'uppercase', color: RECAP.dim, ...NOWRAP }, label),
  ]);
}
function resultsPager(slide, total) {
  return text({ position: 'absolute', right: 80, top: 420, fontFamily: MONO, fontWeight: 700, fontSize: 26, letterSpacing: 3.6, color: RECAP.dim, ...NOWRAP }, slide + ' / ' + total);
}
// A headline line with "$500" in gold and everything else in ink.
function resultsHeadLine(line, fontSize) {
  const parts = String(line).split('$500');
  const kids = [];
  // Leading/trailing spaces collapse in Satori, so they become non-breaking ones.
  const keep = t => t.replace(/^ /, '\u00A0').replace(/ $/, '\u00A0');
  parts.forEach((part, i) => {
    if (i) kids.push(text(RES_DISPLAY(fontSize, RESULTS_GOLD, { lineHeight: 1.04 }), '$500'));
    if (part) kids.push(text(RES_DISPLAY(fontSize, RECAP.fg, { lineHeight: 1.04 }), keep(part)));
  });
  return row({ alignItems: 'flex-end' }, kids);
}
function elementResultsSlide(d) {
  const kids = [
    h({ position: 'absolute', left: 80, top: 80, display: 'flex' }, [{ type: 'img', props: { src: logoDataUri(), style: { height: 36 } } }]),
    resultsLockup(),
  ];
  const kind = d.kind || (d.slide === 1 ? 'hero' : (d.slide >= d.total ? 'cta' : 'list'));
  if (kind === 'hero') {
    const hero = d.hero || {};
    const hasPhoto = !!hero.photo;
    // trophy · label · date on one line, moderate size (operator: "#1 Song" at 168px was too big)
    kids.push(h({ position: 'absolute', left: 80, top: 440, display: 'flex', flexDirection: 'row', alignItems: 'center' }, [
      { type: 'img', props: { src: trophyDataUri(), style: { width: 96, height: 96, marginRight: 22 } } },
      text(RES_DISPLAY(96, RECAP.fg, { lineHeight: 0.9 }), hero.label || ''),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 40, letterSpacing: 1, color: RECAP.dim, marginLeft: 22, marginTop: 30, ...NOWRAP }, d.date || ''),
    ]));
    kids.push(col({ position: 'absolute', left: 80, top: 600, width: hasPhoto ? 560 : 920 }, [
      text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 84, lineHeight: 0.96, letterSpacing: -3, color: RECAP.fg }, clip(hero.title, hasPhoto ? 30 : 50)),
      text({ fontFamily: DISPLAY, fontWeight: 800, fontSize: 46, lineHeight: 1.15, letterSpacing: -1, color: hero.subDim ? RECAP.dim : RECAP.fg, marginTop: 46 }, clip(hero.sub, 40)),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 34, color: RECAP.dim, marginTop: 22, ...NOWRAP }, hero.handle || ''),
    ]));
    if (hasPhoto) {
      // The block device holding a picture: skewed frame, upright image.
      kids.push(h({ position: 'absolute', right: 80, top: 600, width: 300, height: 300, overflow: 'hidden', borderRadius: 12,
        background: RECAP.panel, transform: 'skewX(-13deg)', display: 'flex' }, [
        { type: 'img', props: { src: hero.photo, style: { position: 'absolute', left: -40, top: 0, width: 380, height: 300, objectFit: 'cover', transform: 'skewX(13deg)' } } },
      ]));
    }
    kids.push(resultsField(300, 120), resultsFoot('1 / ' + d.total, RESULTS_URL));
  } else if (kind === 'list') {
    kids.push(resultsEyebrow((d.listLabel || 'Also played') + ' · ' + (d.date || '')), resultsPager(d.slide, d.total));
    const rows = (d.rows || []).map(r => row({ paddingTop: 16, paddingBottom: 16, borderBottom: '1px solid ' + RECAP.line, width: 920 }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: RECAP.dim, width: 76, flexShrink: 0 }, r.rank),
      row({ flexGrow: 1, flexShrink: 1, overflow: 'hidden', marginLeft: 18 }, [
        text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 36, letterSpacing: -1, lineHeight: 1.1, color: RECAP.fg, ...NOWRAP }, clip(r.line1, 26)),
        text({ fontFamily: SANS, fontWeight: 400, fontSize: 30, color: RECAP.dim, marginLeft: 12, ...NOWRAP }, r.line2 ? '· ' + clip(r.line2, 22) : ''),
      ]),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 32, color: RECAP.fg, marginLeft: 18, flexShrink: 0, ...NOWRAP }, r.value == null ? '' : String(r.value)),
    ]));
    kids.push(col({ position: 'absolute', left: 80, top: 490, width: 920 }, rows));
    kids.push(resultsField(250, 90), resultsFoot(d.footLeft || (d.slide + ' / ' + d.total), RESULTS_URL));
  } else {
    const c = d.cta || {};
    kids.push(resultsEyebrow(c.eyebrow || ''), resultsPager(d.slide, d.total));
    kids.push(col({ position: 'absolute', left: 80, top: 470, width: 920 }, (c.head || []).map(line => resultsHeadLine(line, 104))));
    kids.push(text({ position: 'absolute', left: 80, top: 880, width: 760, fontFamily: SANS, fontWeight: 400, fontSize: 36, lineHeight: 1.3, color: RECAP.dim }, c.body || ''));
    kids.push(resultsField(440, 240));
    kids.push(text({ position: 'absolute', left: 80, bottom: 96, fontFamily: MONO, fontWeight: 700, fontSize: 44, color: RECAP.bg, ...NOWRAP }, c.url || ''));
  }
  return h({ position: 'relative', display: 'flex', width: RESULTS_SIZE[0], height: RESULTS_SIZE[1], background: RECAP.bg }, kids);
}

// ============ The winner posts — one 'winnerPost' element, 1080×1350 ============
// One portrait graphic per person, posted as an Instagram COLLAB post so it lands on their
// feed too (operator, 2026-09-18). Four posts off one element: Top Track / Top A&R of the Day
// (the daily #1s from the recap) and of the Week (with a strap saying what the week earns).
// Built to the approved mockup public/brand/winners/winner.html AFTER it was stripped
// ("flyers look too busy"): the lockup, the stacked title with its date, the person, ONE
// line of numbers, the field. No trophy, no labelled cells, no rank (TOP TRACK already says
// #1). The letter grade sits in the block device. Gold on the money only.
//
// Data shape (server.js winnerDayData / winnerWeekData):
//   { kind: 'track'|'ar', period: 'day'|'week', label, sub: 'of the Day', date: '09.12.26' or a range,
//     strap: null | 'Placed in the next $1,000 Tournament', title, by, handle, photo? (data URI),
//     line: { score?, drop? } | { grade, points, bullseyes }, cta: { label, url } }
const WINNER_SIZE = [1080, 1350];
// A line with every dollar amount in gold and the rest in ink (Satori collapses leading and
// trailing spaces, so they become non-breaking ones).
function winnerGoldLine(str, style) {
  const keep = t => t.replace(/^ /, '\u00A0').replace(/ $/, '\u00A0');
  return row({ alignItems: 'flex-end' }, String(str).split(/(\$[\d,]+)/).filter(Boolean).map(part =>
    text({ ...style, color: /^\$[\d,]+$/.test(part) ? RESULTS_GOLD : style.color }, keep(part))));
}
function elementWinnerPost(d) {
  const line = d.line || {}, hasPhoto = !!d.photo, strap = d.strap ? 64 : 0;
  const kids = [
    h({ position: 'absolute', left: 80, top: 80, display: 'flex' }, [{ type: 'img', props: { src: logoDataUri(), style: { height: 36 } } }]),
    resultsLockup(),
    // the title, stacked: TOP TRACK / of the Day · 09.12.26
    col({ position: 'absolute', left: 80, top: 430 }, [
      text(RES_DISPLAY(104, RECAP.fg, { lineHeight: 0.88, textTransform: 'uppercase' }), d.label || ''),
      row({ marginTop: 16, alignItems: 'flex-end' }, [
        text({ fontFamily: DISPLAY, fontWeight: 700, fontSize: 46, lineHeight: 1, letterSpacing: -1, color: RECAP.dim, ...NOWRAP }, d.sub || ''),
        text({ fontFamily: MONO, fontWeight: 700, fontSize: 32, lineHeight: 1, color: RECAP.dim, marginLeft: 10, marginBottom: 4, ...NOWRAP }, d.date ? '· ' + d.date : ''),
      ]),
    ]),
  ];
  if (d.strap) {
    kids.push(row({ position: 'absolute', left: 80, top: 616 }, [
      tick(10, 30, 16),
      winnerGoldLine(d.strap, { fontFamily: DISPLAY, fontWeight: 700, fontSize: 35, lineHeight: 1, letterSpacing: -1, color: RECAP.fg, ...NOWRAP }),
    ]));
  }
  // The person: the title steps down with its length (Satori cannot measure a wrap), and
  // everything under it flows in the same column so a two-line title pushes the rest down.
  const title = clip(d.title, hasPhoto ? 44 : 70);
  const colW = hasPhoto ? 560 : 920;
  const handleDrops = d.kind === 'track' && (clip(d.by, 26).length + (d.handle || '').length) > 34;
  // Satori cannot measure a wrap, so the title's line count is estimated from its length
  // (Archivo 900 runs ~0.56em a character) and the size steps down until the numbers line
  // clears the 13° cut at its right edge (cut y = 1160 − x·tan13°), as the mockup does.
  const numChars = d.kind === 'ar' ? 4 + String(line.points).length + 8 + 3 + String(line.bullseyes).length + 10
    : (line.score != null ? 6 + String(line.score).length : 0) + (line.drop ? 3 + 8 + String(line.drop).length : 0);
  const numRight = 80 + numChars * (hasPhoto ? 30 : 36) * 0.6 + (d.kind === 'ar' ? 110 : 0);
  const cutAt = x => 1160 - x * TAN13;
  let fs = 58;
  for (const size of [84, 68, 58]) {
    const lines = Math.max(1, Math.ceil(title.length * size * 0.56 / colW));
    const bottom = 640 + strap + lines * size * 0.96 + 26 + 48 + (handleDrops ? 42 : 0) + 44 + (hasPhoto ? 30 : 36);
    if (bottom <= cutAt(numRight) - 16) { fs = size; break; }
  }
  // Satori collapses a leading or trailing space, so the joins are non-breaking spaces. Beside a
  // photo the line has 620px (the photo starts at x=700), so it steps down a size there.
  const NB = '\u00A0', numSize = hasPhoto ? 30 : 36;
  const numStyle = { fontFamily: MONO, fontWeight: 700, fontSize: numSize, lineHeight: 1, color: RECAP.dim, ...NOWRAP };
  const numVal = { ...numStyle, color: RECAP.fg };
  let numbers;
  if (d.kind === 'ar') {
    numbers = row({ marginTop: 44, alignItems: 'center' }, [
      h({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: hasPhoto ? 72 : 84, height: hasPhoto ? 58 : 68, background: RECAP.green,
        borderRadius: 4, transform: `skewX(${SKEW}deg)`, marginRight: hasPhoto ? 22 : 30, flexShrink: 0 },
        text({ transform: `skewX(${-SKEW}deg)`, fontFamily: DISPLAY, fontWeight: 900, fontSize: hasPhoto ? 44 : 50, letterSpacing: -2, color: RECAP.greenInk, lineHeight: 1 }, line.grade || '')),
      text(numVal, String(line.points == null ? '' : line.points)), text(numStyle, NB + 'points'),
      text(numStyle, NB + '·' + NB),
      text(numVal, String(line.bullseyes == null ? '' : line.bullseyes)), text(numStyle, NB + 'bullseyes'),
    ]);
  } else {
    const bits = [];
    if (line.score != null && line.score !== '') bits.push(text(numStyle, 'Score' + NB), text(numVal, String(line.score)));
    if (line.drop) { if (bits.length) bits.push(text(numStyle, NB + '·' + NB)); bits.push(text(numStyle, 'Dropped' + NB), text(numVal, line.drop)); }
    numbers = bits.length ? row({ marginTop: 44, alignItems: 'center' }, bits) : text({}, '');
  }
  const subRow = d.kind === 'ar'
    ? row({ marginTop: 26, alignItems: 'flex-end' }, [
        text({ fontFamily: DISPLAY, fontWeight: 700, fontSize: 42, lineHeight: 1.15, letterSpacing: -1, color: RECAP.fg, ...NOWRAP }, clip(d.by, 22)),
        text({ fontFamily: DISPLAY, fontWeight: 500, fontSize: 42, lineHeight: 1.15, color: RECAP.dim, ...NOWRAP }, d.handle ? '\u00A0· ' + clip(d.handle, 24) : ''),
      ])
    // A long artist name and the handle would run off the edge on one line, so the handle drops
    // under the name when the two together would not fit (as the mockup wraps it).
    : (handleDrops
        ? col({ marginTop: 26, alignItems: 'flex-start' }, [
            text({ fontFamily: DISPLAY, fontWeight: 700, fontSize: 42, lineHeight: 1.15, letterSpacing: -1, color: RECAP.fg, ...NOWRAP }, 'by ' + clip(d.by, 26)),
            text({ fontFamily: MONO, fontWeight: 700, fontSize: 32, lineHeight: 1.15, color: RECAP.dim, marginTop: 10, ...NOWRAP }, d.handle || ''),
          ])
        : row({ marginTop: 26, alignItems: 'flex-end' }, [
            text({ fontFamily: DISPLAY, fontWeight: 700, fontSize: 42, lineHeight: 1.15, letterSpacing: -1, color: RECAP.fg, ...NOWRAP }, 'by ' + clip(d.by, 26)),
            text({ fontFamily: MONO, fontWeight: 700, fontSize: 32, lineHeight: 1.15, color: RECAP.dim, marginLeft: 14, marginBottom: 2, ...NOWRAP }, d.handle || ''),
          ]));
  kids.push(col({ position: 'absolute', left: 80, top: 640 + strap, width: hasPhoto ? 560 : 920 }, [
    text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: fs, lineHeight: 0.96, letterSpacing: -Math.round(fs * 0.04), color: RECAP.fg }, title),
    subRow,
    numbers,
  ]));
  if (hasPhoto) {
    kids.push(h({ position: 'absolute', right: 80, top: 640 + strap, width: 300, height: 300, overflow: 'hidden', borderRadius: 12,
      background: RECAP.panel, transform: `skewX(${SKEW}deg)`, display: 'flex' }, [
      { type: 'img', props: { src: d.photo, style: { position: 'absolute', left: -40, top: 0, width: 380, height: 300, objectFit: 'cover', transform: `skewX(${-SKEW}deg)` } } },
    ]));
  }
  const cta = d.cta || {};
  kids.push(resultsField(300, 110));
  kids.push(col({ position: 'absolute', left: 80, bottom: 64 }, [
    text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 42, lineHeight: 1, letterSpacing: -1, color: RECAP.bg, ...NOWRAP }, cta.label || ''),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 34, lineHeight: 1, color: RECAP.bg, marginTop: 12, ...NOWRAP }, cta.url || ''),
  ]));
  return h({ position: 'relative', display: 'flex', width: WINNER_SIZE[0], height: WINNER_SIZE[1], background: RECAP.bg }, kids);
}

// ============ The Track Report — the artist's report, one 'trackPage' element ============
// Spec: docs/specs/track-report-spec.md. Design: the Room Report Redesign mockup
// (mim repo docs/mockups/anr-room-report-v2.html) — the report opens with a DECISION and every
// headline is a sentence derived from the numbers (track-report.js); nothing is hand-written.
// 1080×1350 (4:5) like the results carousels, so the artist can post it as one Instagram
// carousel. Built to the brand: Archivo + Space Mono, the [A&R] MEETING / [A&R] ROOM lockup,
// green = scoring, purple = the prediction game (head-to-head with the room's guess), NO gold
// anywhere (nothing here is money or first place), the 13° device as block, tick and rule, and
// the cut only on the share page, where there is no type to run it behind.
//
// Kinds (server.js trackReportPages decides which a record gets):
//   decision · split · against · whofor · setup · next · comments · share
// Data shape: { kind, page, total, title, artist, handle, meta, what, votes, mean, band,
//   sub, shape, hist, modes, median, tail, against, dist, who, roles, cities, setup,
//   predictMean, steps, comments }.
const TRACK_SIZE = [1080, 1350];
const TRACK = { ...RECAP, purple: '#6d5fe0', ink2: '#b9b5d2', track: '#221d3a' };
const TRACK_TAG = 'Track Report';
const TRACK_LEFT = 80, TRACK_W = 920, TRACK_TOP = 300, TRACK_H = 900;

function trackHeadline(lines, max = 88) {
  // Archivo 900 runs ~0.56em a glyph; fit the longest line to the column, floor 54px.
  const longest = Math.max(1, ...lines.map(l => String(l).length));
  const fs = Math.max(54, Math.min(max, Math.floor(TRACK_W / (0.56 * longest))));
  return col({}, lines.map(l => text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: fs, lineHeight: 0.98,
    letterSpacing: -Math.round(fs * 0.04), color: RECAP.fg, ...NOWRAP }, l)));
}
function trackBody(str, { size = 30, color = RECAP.dim, mt = 0, weight = 400 } = {}) {
  return text({ fontFamily: SANS, fontWeight: weight, fontSize: size, lineHeight: 1.4, color, marginTop: mt, width: TRACK_W }, str);
}
function trackPull(str, tone = 'green') {
  const c = tone === 'purple' ? TRACK.purple : tone === 'plain' ? RECAP.line : RECAP.green;
  const bg = tone === 'purple' ? 'rgba(109,95,224,0.12)' : tone === 'plain' ? RECAP.panel : 'rgba(75,183,73,0.10)';
  return row({ marginTop: 'auto', width: TRACK_W, background: bg, borderLeft: `6px solid ${c}`, borderRadius: 6, padding: '24px 28px', alignItems: 'flex-start' }, [
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 28, lineHeight: 1.4, color: RECAP.fg, width: TRACK_W - 62 }, str),
  ]);
}
function trackEyebrow(str, mt = 0) {
  return row({ marginTop: mt }, [tick(7, 20, 12),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: RECAP.dim, ...NOWRAP }, str)]);
}
function trackStat(label, value) {
  return row({ justifyContent: 'space-between', width: TRACK_W, paddingTop: 12, paddingBottom: 12, borderBottom: `1px solid ${TRACK.track}` }, [
    text({ fontFamily: SANS, fontWeight: 400, fontSize: 28, color: RECAP.dim, ...NOWRAP }, label),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: RECAP.fg, ...NOWRAP }, String(value)),
  ]);
}
function trackAxis(labels, width = TRACK_W) {
  // Evenly spaced tick labels under a bar chart, one per bar.
  return row({ width, marginTop: 8 }, labels.map(l => text({ fontFamily: MONO, fontWeight: 400, fontSize: 20, color: RECAP.dim,
    flexGrow: 1, flexBasis: 0, textAlign: 'center', ...NOWRAP }, l)));
}
// A column chart: bars[] = { v, hi (ink instead of green), label (above) }.
function trackBars(bars, height, gap = 10) {
  const max = Math.max(1, ...bars.map(b => b.v));
  return row({ alignItems: 'flex-end', width: TRACK_W, height: height + 40, gap }, bars.map(b => col(
    { flexGrow: 1, flexBasis: 0, alignItems: 'center', justifyContent: 'flex-end', height: height + 40 }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: b.hi ? RECAP.fg : RECAP.dim, marginBottom: 8, ...NOWRAP }, b.label == null ? '' : String(b.label)),
      h({ width: '100%', height: Math.max(4, Math.round(b.v / max * height)), background: b.hi ? RECAP.fg : RECAP.green,
          opacity: b.hi ? 1 : 0.85, borderRadius: 3 }, ''),
    ])));
}
function trackSegRow(it, unit) {
  return row({ width: TRACK_W, marginBottom: 14 }, [
    text({ fontFamily: SANS, fontWeight: 700, fontSize: 28, color: RECAP.fg, width: 290, flexShrink: 0, ...NOWRAP }, clip(it.name, 16)),
    h({ width: 380, height: 14, background: TRACK.track, borderRadius: 7, display: 'flex', flexShrink: 0, marginLeft: 20 }, [
      h({ width: Math.round(Math.min(1, it.avg / CHART_SCALE_MAX) * 380), height: 14, borderRadius: 7, background: RECAP.green }, '') ]),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: RECAP.fg, width: 90, textAlign: 'right', flexShrink: 0, marginLeft: 20, ...NOWRAP }, Number(it.avg).toFixed(1)),
    text({ fontFamily: MONO, fontWeight: 400, fontSize: 22, color: RECAP.dim, width: 120, textAlign: 'right', flexShrink: 0, ...NOWRAP }, `${it.n} ${unit}`),
  ]);
}
function trackRecordLine(d, mt = 0) {
  return text({ fontFamily: MONO, fontWeight: 700, fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', color: RECAP.dim, marginTop: mt, ...NOWRAP },
    clip([d.title, d.artist].filter(Boolean).join(' · '), 34));
}

function trackContent(d) {
  const k = d.kind;
  if (k === 'decision') {
    const band = d.band || {};
    return [
      trackRecordLine(d),
      col({ marginTop: 26 }, [trackHeadline(band.headline || [], 96)]),
      trackBody(d.sub || '', { mt: 30 }),
      row({ marginTop: 'auto', alignItems: 'flex-end' }, [
        text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 132, lineHeight: 0.9, letterSpacing: -6, color: RECAP.fg, ...NOWRAP }, d.mean),
        text({ fontFamily: MONO, fontWeight: 700, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase', color: RECAP.dim, marginLeft: 24, marginBottom: 10, ...NOWRAP },
          `/ ${CHART_SCALE_MAX} · ${band.label || ''}`),
      ]),
    ];
  }
  if (k === 'split') {
    const sh = d.shape || {};
    const hist = d.hist || [];
    const bars = hist.map((c, i) => ({ v: c, hi: (d.modes || []).includes(i) && c > 0, label: c || '' }));
    return [
      trackHeadline(sh.headline || [], 80),
      col({ marginTop: 30 }, [trackBars(bars, 180, 10), trackAxis(hist.map((_, i) => String(i)))]),
      col({ marginTop: 16 }, [
        trackStat('Average', d.mean),
        trackStat('Middle score', d.median),
        trackStat('Scored it 7 or higher', `${d.tail} of ${d.votes}`),
      ]),
      trackPull(sh.pull || ''),
    ];
  }
  if (k === 'against') {
    const ag = d.against || {}, dist = d.dist || { buckets: [] };
    const bars = dist.buckets.map((c, i) => ({ v: c, hi: i === ag.you, label: i === ag.you ? 'THIS RECORD' : (i === ag.mid ? 'MIDDLE' : '') }));
    // The label sits above a half-point bar and would collide with a neighbour's; only the
    // two markers carry one, and they read from the legend when adjacent.
    const axis = dist.buckets.map((_, i) => i % 4 === 0 ? String(i / 2) : '');
    return [
      trackHeadline(ag.headline || [], 80),
      col({ marginTop: 36 }, [trackBars(bars, 210, 6), trackAxis(axis)]),
      col({ marginTop: 20 }, [
        trackStat(`Every record ${d.what === 'A&R Room' ? 'the A&R Room' : 'the A&R Meeting'} has rated`, dist.n),
        trackStat('The middle of the room', Number(dist.median).toFixed(1)),
        trackStat('This record', d.mean),
      ]),
      trackPull(ag.pull || '', 'purple'),
    ];
  }
  if (k === 'whofor') {
    const who = d.who || {};
    const kids = [trackHeadline(who.headline || [], 80),
      trackBody(`The same record, scored by ${(d.roles || []).length + (d.cities || []).length} groups of A&Rs.`, { mt: 20, size: 28 })];
    if ((d.roles || []).length) kids.push(col({ marginTop: 26 }, [trackEyebrow('By role'), col({ marginTop: 16 }, d.roles.map(r => trackSegRow(r, 'A&Rs')))]));
    if ((d.cities || []).length) kids.push(col({ marginTop: 16 }, [trackEyebrow('By city'), col({ marginTop: 16 }, d.cities.map(r => trackSegRow(r, 'A&Rs')))]));
    kids.push(trackPull(who.pull || ''));
    return kids;
  }
  if (k === 'setup') {
    const su = d.setup || {};
    const big = (v, label, dim) => col({ alignItems: 'flex-start' }, [
      text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 150, lineHeight: 0.9, letterSpacing: -7, color: dim ? RECAP.dim : RECAP.fg, ...NOWRAP }, v),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: RECAP.dim, marginTop: 14, ...NOWRAP }, label),
    ]);
    return [
      trackHeadline(su.headline || [], 80),
      row({ marginTop: 56, alignItems: 'flex-end', gap: 44 }, [
        big(d.predictMean, 'Expected', true),
        h({ width: 12, height: 110, background: TRACK.purple, transform: `skewX(${SKEW}deg)`, marginBottom: 60, flexShrink: 0 }, ''),
        big(d.mean, 'Delivered', false),
        text({ fontFamily: MONO, fontWeight: 700, fontSize: 40, color: TRACK.purple, marginBottom: 74, marginLeft: 'auto', ...NOWRAP }, su.label || ''),
      ]),
      trackBody(`The A&Rs guessed ${d.predictMean} from the setup, then heard it and landed on ${d.mean}.`, { mt: 40 }),
      trackPull(su.pull || '', 'purple'),
    ];
  }
  if (k === 'next') {
    const steps = (d.steps || []).map((s, i) => row({ width: TRACK_W, marginTop: i ? 28 : 0, alignItems: 'flex-start' }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 26, color: RECAP.green, width: 70, flexShrink: 0, marginTop: 8, ...NOWRAP }, '0' + (i + 1)),
      col({ width: TRACK_W - 70 }, [
        text({ fontFamily: SANS, fontWeight: 800, fontSize: 32, lineHeight: 1.3, color: RECAP.fg, width: TRACK_W - 70 }, s.lead),
        text({ fontFamily: SANS, fontWeight: 400, fontSize: 28, lineHeight: 1.4, color: RECAP.dim, marginTop: 6, width: TRACK_W - 70 }, s.rest),
      ]),
    ]));
    return [
      trackHeadline(['Three things', 'to do next.'], 80),
      col({ marginTop: 40 }, steps),
      trackPull('Every line on this page comes from the numbers on the other pages — the decision, the biggest gap between groups of A&Rs, and the setup. Nothing is written by hand.', 'plain'),
    ];
  }
  if (k === 'comments') {
    const quotes = (d.comments || []).map((c, i) => row({ width: TRACK_W, marginTop: i ? 30 : 0, alignItems: 'flex-start' }, [
      h({ width: 6, alignSelf: 'stretch', background: RECAP.green, transform: `skewX(${SKEW}deg)`, flexShrink: 0, marginRight: 30, marginTop: 6 }, ''),
      col({ width: TRACK_W - 36 }, [
        text({ fontFamily: SANS, fontWeight: 400, fontSize: 30, lineHeight: 1.4, color: RECAP.fg, width: TRACK_W - 36 }, '“' + esc(c.body) + '”'),
        text({ fontFamily: SANS, fontWeight: 800, fontSize: 26, color: RECAP.fg, marginTop: 14, ...NOWRAP }, clip(c.name, 40)),
        text({ fontFamily: MONO, fontWeight: 400, fontSize: 22, color: RECAP.dim, marginTop: 4, ...NOWRAP },
          [c.role, c.location].filter(Boolean).join(' · ')),
      ]),
    ]));
    return [
      trackHeadline(['What the', 'A&Rs said.'], 80),
      col({ marginTop: 36 }, quotes),
      text({ fontFamily: SANS, fontWeight: 400, fontSize: 22, lineHeight: 1.4, color: RECAP.dim, marginTop: 'auto', width: TRACK_W },
        'Comments are the personal opinions of individual A&Rs who scored the record. Not every A&R left one.'),
    ];
  }
  return [];
}

function elementTrackPage(d) {
  const [W0, H0] = TRACK_SIZE;
  const what = d.what === 'A&R Room' ? 'Room' : 'Meeting';
  const header = [
    h({ position: 'absolute', left: TRACK_LEFT, top: 72, display: 'flex' }, [{ type: 'img', props: { src: logoDataUri(), style: { height: 32 } } }]),
    h({ position: 'absolute', left: TRACK_LEFT, top: 136, display: 'flex', flexDirection: 'row', alignItems: 'center' }, [
      arBlock(68, 27),
      text(RES_DISPLAY(62, RECAP.fg, { textTransform: 'uppercase', marginLeft: 18 }), what),
    ]),
    col({ position: 'absolute', right: TRACK_LEFT, top: 146, alignItems: 'flex-end' }, [
      row({}, [tick(7, 20, 12), text({ fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: RECAP.dim, ...NOWRAP }, TRACK_TAG)]),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 4, color: RECAP.dim, marginTop: 10, ...NOWRAP }, `${d.page || 1} / ${d.total || 1}`),
    ]),
    h({ position: 'absolute', left: TRACK_LEFT + 4, top: 236, width: 160, height: 8, background: RECAP.green, transform: `skewX(${SKEW}deg)` }, ''),
  ];
  if (d.kind === 'share') {
    // The postable page: title, artist, "N A&Rs heard it". NO SCORE — postable at 2.1 or 8.4.
    // The one page that takes the cut, because nothing runs across it.
    const n = String(d.votes || 0);
    const shareTitle = clip(d.title, 30);
    const shareTitleSize = Math.max(48, Math.min(88, Math.floor(TRACK_W / (0.56 * Math.max(1, shareTitle.length)))));
    return h({ position: 'relative', display: 'flex', width: W0, height: H0, background: RECAP.bg }, [
      ...header,
      col({ position: 'absolute', left: TRACK_LEFT, top: 320, width: TRACK_W, alignItems: 'center' }, [
        text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: shareTitleSize, lineHeight: 0.96, letterSpacing: -Math.round(shareTitleSize * 0.04), color: RECAP.fg, ...NOWRAP }, shareTitle),
        text({ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44, lineHeight: 1.1, letterSpacing: -1, color: RECAP.dim, marginTop: 26, textAlign: 'center', ...NOWRAP }, clip(d.artist || '', 36)),
        d.handle ? text({ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: RECAP.dim, marginTop: 14, ...NOWRAP }, d.handle) : text({}, ''),
        h({ width: 160, height: 8, background: RECAP.green, transform: `skewX(${SKEW}deg)`, marginTop: 44, marginBottom: 36 }, ''),
        text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 210, lineHeight: 0.9, letterSpacing: -10, color: RECAP.green, ...NOWRAP }, n),
        text({ fontFamily: MONO, fontWeight: 700, fontSize: 28, letterSpacing: 5, textTransform: 'uppercase', color: RECAP.fg, marginTop: 26, ...NOWRAP }, 'A&Rs heard it'),
        text({ fontFamily: MONO, fontWeight: 700, fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', color: RECAP.dim, marginTop: 12, ...NOWRAP },
          `Rated at the A&R ${what} · ${d.dateLabel || ''}`),
      ]),
      resultsField(230, 90),
      resultsFoot('Submit your music', SUBMIT_URL),
    ]);
  }
  const content = col({ position: 'absolute', left: TRACK_LEFT, top: TRACK_TOP, width: TRACK_W, height: TRACK_H, overflow: 'hidden' }, trackContent(d));
  const foot = h({ position: 'absolute', left: TRACK_LEFT, right: TRACK_LEFT, bottom: 64, display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
    borderTop: `1px solid ${RECAP.line}`, paddingTop: 22 }, [
    text({ fontFamily: MONO, fontWeight: 400, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase', color: RECAP.dim, ...NOWRAP }, clip(d.meta || '', 56)),
    row({}, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 20, letterSpacing: 2, color: RECAP.fg, ...NOWRAP }, 'makinitmag.com'),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 20, letterSpacing: 2, color: RECAP.green, ...NOWRAP }, '/ANR'),
    ]),
  ]);
  return h({ position: 'relative', display: 'flex', width: W0, height: H0, background: RECAP.bg }, [...header, content, foot]);
}

function element(type, data = {}) {
  const showNumbers = !!data.showNumbers;
  if (type === 'score') return frame({ title: 'A&R Record', sub: data.session || null, body: bodyScore(data) });
  if (type === 'ars')   return frame({ title: 'Top 8 A&Rs', sub: data.scope || data.session || null, body: bodyArs(data.list || [], showNumbers) });
  if (type === 'songs') return frame({ title: 'Top 8 Records', sub: data.session || null, body: bodySongs(data.list || [], showNumbers) });
  if (type === 'promo') return frame({ title: 'Join the A&R Team', sub: 'Free to join', body: bodyPromo() });
  if (type === 'trackPage') return elementTrackPage(data);
  if (type === 'chartCover') return frame({ title: null, sub: null, body: bodyChartCover(data) });
  if (type === 'chartList') return frame({ titleSize: 66, title: clip(data.title, 18), sub: data.sub, body: bodyChartList(data) });
  if (type === 'recapCover') return elementRecapCover(data);
  if (type === 'recapThumb') return elementRecapThumb(data);
  if (type === 'referCard') return elementReferPerson(data, false);
  if (type === 'referStory') return elementReferPerson(data, true);
  if (type === 'referJoin' || type === 'referSubmit') return elementReferFlyer(data, type);
  if (type === 'resultsSlide') return elementResultsSlide(data);
  if (type === 'winnerPost') return elementWinnerPost(data);
  throw new Error('unknown card type: ' + type);
}

// ---- render to PNG ----
let _satori = null, _Resvg = null;
// Every card is 3:4 except the recap graphics, which carry their own size.
function sizeOf(type) { return RECAP_SIZES[type] || REFER_SIZES[type] || [W, H]; }
function sizeOf(type) { return type === 'resultsSlide' ? RESULTS_SIZE : type === 'winnerPost' ? WINNER_SIZE : type === 'trackPage' ? TRACK_SIZE : (RECAP_SIZES[type] || [W, H]); }
async function renderPng(type, data) {
  if (!_satori) { const m = require('satori'); _satori = m.default || m; }
  if (!_Resvg) { _Resvg = require('@resvg/resvg-js').Resvg; }
  const [w, hgt] = sizeOf(type);
  const svg = await _satori(element(type, data), { width: w, height: hgt, fonts: fonts() });
  const png = new _Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
  return png;
}

module.exports = { renderPng, element, sizeOf, REFER_SIZES, REFER_COPY, W, H, PRIZE, CHART_BANDS, CHART_SCALE_MAX, SUBMIT_URL, JOIN_URL, RECAP_TITLE, RECAP_TIME, RECAP_CTA };
module.exports = { renderPng, element, sizeOf, W, H, PRIZE, CHART_BANDS, CHART_SCALE_MAX, SUBMIT_URL, JOIN_URL, RECAP_TITLE, RECAP_TIME, RECAP_CTA, RESULTS_PER_SLIDE, TRACK_SIZE, TRACK_TAG, WINNER_SIZE };
