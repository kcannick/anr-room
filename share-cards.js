// share-cards.js — server-side render of the shareable report graphics (3:4, 1080×1440)
// to PNG, using Satori (HTML/flex -> SVG) + resvg (SVG -> PNG). No headless browser, so it
// stays serverless-friendly (the whole point — see docs/multi-tenant-roadmap + the outage rule).
//
// Card types: 'score' (personal), 'ars' (Top 8 A&Rs), 'songs' (Top 8 Records), 'promo';
// the artist's Track Report is 'trackPage' (see below), the daily graphics 'resultsSlide' / 'countdownSlide' /
// 'winnerPost' (the Top Track / Top A&R of the Day and of the Week collab posts), and the A&R Wars
// set 'tournamentFeed' / 'tournamentStory' / 'tournamentThumb' / 'tournamentBracket'.
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

// ============ Brand tokens for the Archivo cards (results, countdown, winner, refer) ============
// The A&R Meeting Recap cover/thumbnail that first carried these was retired 2026-10-02.
const RECAP = {
  bg: '#0e0c1a', panel: '#171328', line: '#2e2750', fg: '#eae9f2', dim: '#9793b4',
  green: '#4bb749', greenInk: '#06210b',
};
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
// The Top A&R carousel's footer: the page count bottom-left, and the ask WITH the link
// right-justified (operator, 2026-10-03 — a bare URL on the green field had no call to action).
function resultsJoinFoot(pageTxt) {
  return h({ position: 'absolute', left: 80, right: 80, bottom: 72, display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 28, letterSpacing: 1, color: RECAP.bg, ...NOWRAP }, pageTxt || ''),
    col({ alignItems: 'flex-end' }, [
      text(RES_DISPLAY(40, RECAP.bg, { textTransform: 'uppercase', letterSpacing: -1 }), 'Join the A&R Team'),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 30, color: RECAP.bg, marginTop: 8, ...NOWRAP }, RESULTS_URL),
    ]),
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
    kids.push(resultsField(300, 120), resultsJoinFoot('1 / ' + d.total));
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
    kids.push(resultsField(250, 90), resultsJoinFoot(d.slide + ' / ' + d.total));
  } else {
    const c = d.cta || {};
    kids.push(resultsEyebrow(c.eyebrow || ''), resultsPager(d.slide, d.total));
    kids.push(col({ position: 'absolute', left: 80, top: 470, width: 920 }, (c.head || []).map(line => resultsHeadLine(line, 104))));
    // The body sits right under however many headline lines there are (108px a line at 104).
    kids.push(text({ position: 'absolute', left: 80, top: 470 + (c.head || []).length * 108 + 34, width: 920, fontFamily: DISPLAY, fontWeight: 800, fontSize: 46, lineHeight: 1.2, letterSpacing: -1, color: RECAP.dim }, c.body || ''));
    kids.push(resultsField(440, 240), resultsJoinFoot(d.slide + ' / ' + d.total));
  }
  return h({ position: 'relative', display: 'flex', width: RESULTS_SIZE[0], height: RESULTS_SIZE[1], background: RECAP.bg }, kids);
}

// ============ The Makin' It Daily Countdown — one 'countdownSlide' element, 1080×1350 ============
// The carousel that replaced the daily stream AND the Top Track results carousel (operator,
// 2026-10-02): the day's records counted down, ONE RECORD A SLIDE, RANK ONLY — scores are
// private to the artist's Track Report. Built to the approved mockup
// public/brand/countdown/countdown.html; the layout numbers here are that file's.
//   cover   Daily Countdown · the date · the countdown blocks · Ranked by the Makin' It A&R Team · Submit free
//   rank    one per record, #N first: series · blocks · #rank · title · artist · @handle · submit strip.
//           #1 is the gold variant with TOP TRACK OF THE DAY. Every rank slide stands ALONE — an
//           artist reposts only theirs — and NEVER shows the size of the field: the blocks run
//           from the slide's own rank to #1, so #16 of 16 does not read as last (operator).
//   team    Thanks to our A&R Team · Become an A&R · makinitmag.com/ANR
//   cta     Think your music belongs on the Countdown? · $1,000 Music Tournament · makinitmag.com/review
// Gold = first place and money only (the #1 slide, the $1,000). Satori cannot measure a wrap,
// so text sizes step down off character counts, the same estimate the winner post uses.
//
// Data shape (server.js countdownCarouselData):
//   { kind: 'cover'|'rank'|'team'|'cta', date: '10.02.26', count (cover: how many records),
//     rank, title, artist, handle }
const COUNTDOWN_SIZE = [1080, 1350];
const COUNTDOWN_COPY = {
  series: 'Daily Countdown',
  credit: 'Ranked by the Makin’ It A&R Team',
  submit: 'Submit free',
  question: 'Think you should be here?',
  honor: 'Top Track of the Day',
  thanks: ['Thanks to our', 'A&R Team'],
  join: 'Become an A&R',                                          // operator, 2026-10-02
  ask: 'Think your music belongs on the Countdown?',
  lead: ['Submit FREE for your chance to get ranked', 'and qualify for the'],
  prize: ['$1,000', 'Music Tournament'],
};
const CD_INFO_BOTTOM = 1086;
// Satori draws a CSS radial gradient with a visible box edge, so the #1 glow is an SVG.
let _cdGlow = null;
function countdownGlowUri() {
  if (!_cdGlow) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="760"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%">'
      + '<stop offset="0" stop-color="#f5c518" stop-opacity="0.16"/><stop offset="1" stop-color="#f5c518" stop-opacity="0"/></radialGradient></defs>'
      + '<ellipse cx="450" cy="380" rx="450" ry="380" fill="url(#g)"/></svg>';
    _cdGlow = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  }
  return _cdGlow;
}          // the record block ends above the submit strip (1350 − 80 − 150 − 34)
// One skewed block per rank, highest first; the lit one green (gold at #1). One row always:
// the blocks narrow as the count grows, capped so a short run doesn't turn into bricks.
function countdownTicks(from, lit, { max, gap, h: hMax }) {
  const w = Math.min(max, (912 - gap * (from - 1)) / from);
  const hgt = Math.min(hMax, Math.round(w * 0.95));
  const fs = Math.round(Math.max(17, Math.min(hMax * 0.46, w * 0.42)));
  const kids = [];
  for (let r = from; r >= 1; r--) {
    const on = r === lit, col1 = r === 1 ? RESULTS_GOLD : RECAP.green;
    kids.push(h({ display: 'flex', alignItems: 'center', justifyContent: 'center', width: w, height: hgt, marginRight: r > 1 ? gap : 0,
      border: '2px solid ' + (on ? col1 : RECAP.line), background: on ? col1 : 'transparent', borderRadius: 5,
      transform: `skewX(${SKEW}deg)`, flexShrink: 0 }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: fs, lineHeight: 1, color: on ? RECAP.bg : RECAP.dim, transform: `skewX(${-SKEW}deg)`, ...NOWRAP },
        String(r).padStart(2, '0')),
    ]));
  }
  return kids;
}
function countdownMast(d, { date = true, series = true } = {}) {
  const kids = [h({ position: 'absolute', left: 80, top: 80, display: 'flex' }, [{ type: 'img', props: { src: logoDataUri(), style: { height: 34 } } }])];
  if (date) kids.push(text({ position: 'absolute', right: 80, top: 78, fontFamily: MONO, fontWeight: 700, fontSize: 32, lineHeight: 1.2, color: RECAP.dim, ...NOWRAP }, d.date || ''));
  if (series) kids.push(text(RES_DISPLAY(58, RECAP.fg, { position: 'absolute', left: 80, top: 142, textTransform: 'uppercase' }), COUNTDOWN_COPY.series));
  return kids;
}
// How the record's title, artist and handle fit: the title steps down until it is two lines AND
// the block clears the numeral; past the floor it takes a third line and is clipped there.
function countdownFit(d, minTop) {
  const W = 920;
  const title = '“' + clip(d.title || '—', 90) + '”';
  const artist = String(d.artist || '').trim();
  const handle = d.handle || '';
  let artistFs = 34;
  for (const s of [46, 42, 38, 34]) { if (artist.length * s * 0.52 <= W) { artistFs = s; break; } }
  const handleFs = handle ? Math.max(22, Math.min(32, Math.floor(W / (handle.length * 0.6)))) : 0;
  const below = 26 + artistFs * 1.1 + (handle ? 8 + handleFs * 1.3 : 0);
  let fs = 56, lines = 3;
  for (const s of [96, 88, 80, 72, 66, 60, 56]) {
    const n = Math.max(1, Math.ceil(title.length * s * 0.58 / W));
    fs = s; lines = n;
    if (n <= 2 && minTop + n * s * 0.95 + below <= CD_INFO_BOTTOM) break;
  }
  lines = Math.min(lines, 3);
  const h0 = lines * fs * 0.95 + below;
  return { title, artist: clip(artist, Math.floor(W / (artistFs * 0.52))), handle: clip(handle, Math.floor(W / (handleFs * 0.6 || 1))),
    fs, lines, artistFs, handleFs, top: Math.round(Math.max(minTop, CD_INFO_BOTTOM - h0)) };
}
function elementCountdownSlide(d) {
  const kind = d.kind || 'rank';
  const kids = [];
  const field = (height) => resultsField(height, 249);         // the 13° cut, full width
  if (kind === 'cover') {
    kids.push(...countdownMast(d, { date: false, series: false }));
    kids.push(col({ position: 'absolute', left: 74, top: 196 }, ['Daily', 'Countdown'].map(w =>
      text(RES_DISPLAY(136, RECAP.fg, { lineHeight: 0.86, letterSpacing: -6, textTransform: 'uppercase' }), w))));
    kids.push(text({ position: 'absolute', left: 80, top: 490, fontFamily: MONO, fontWeight: 700, fontSize: 104, lineHeight: 1, letterSpacing: -3, color: RECAP.fg, ...NOWRAP }, d.date || ''));
    kids.push(row({ position: 'absolute', left: 84, top: 640 }, countdownTicks(Math.max(1, d.count || 1), 0, { max: 108, gap: 12, h: 64 })));
    kids.push(text(RES_DISPLAY(50, RECAP.fg, { position: 'absolute', left: 80, top: 756 }), COUNTDOWN_COPY.credit));
    kids.push(field(470));
    kids.push(col({ position: 'absolute', left: 80, bottom: 80 }, [
      text(RES_DISPLAY(58, RECAP.bg, { textTransform: 'uppercase' }), COUNTDOWN_COPY.submit),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 36, color: RECAP.bg, marginTop: 12, ...NOWRAP }, SUBMIT_URL),
    ]));
  } else if (kind === 'team') {
    kids.push(...countdownMast(d));
    kids.push(col({ position: 'absolute', left: 76, top: 250 }, ['Thanks to', 'our A&R', 'Team'].map(w =>
      text(RES_DISPLAY(150, RECAP.fg, { lineHeight: 0.86, letterSpacing: -8, textTransform: 'uppercase' }), w))));
    kids.push(field(470));
    kids.push(col({ position: 'absolute', left: 80, bottom: 80 }, [
      text(RES_DISPLAY(58, RECAP.bg, { textTransform: 'uppercase' }), COUNTDOWN_COPY.join),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 36, color: RECAP.bg, marginTop: 12, ...NOWRAP }, JOIN_URL),
    ]));
  } else if (kind === 'cta') {
    kids.push(...countdownMast(d));
    kids.push(text({ position: 'absolute', left: 80, top: 250, width: 920, fontFamily: DISPLAY, fontWeight: 900, fontSize: 88, lineHeight: 0.94, letterSpacing: -4, color: RECAP.fg }, COUNTDOWN_COPY.ask));
    kids.push(col({ position: 'absolute', left: 80, top: 540 }, COUNTDOWN_COPY.lead.map(l =>
      text({ fontFamily: SANS, fontWeight: 400, fontSize: 36, lineHeight: 1.25, color: RECAP.dim, ...NOWRAP }, l))));
    kids.push(col({ position: 'absolute', left: 80, top: 656 }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 112, lineHeight: 1, letterSpacing: -6, color: RESULTS_GOLD, ...NOWRAP }, COUNTDOWN_COPY.prize[0]),
      text(RES_DISPLAY(76, RESULTS_GOLD, { lineHeight: 0.92, textTransform: 'uppercase', letterSpacing: -3 }), COUNTDOWN_COPY.prize[1]),
    ]));
    kids.push(field(360));
    kids.push(text({ position: 'absolute', left: 80, bottom: 80, fontFamily: MONO, fontWeight: 700, fontSize: 44, color: RECAP.bg, ...NOWRAP }, SUBMIT_URL));
  } else {
    const R = Math.max(1, d.rank || 1), top1 = R === 1;
    const accent = top1 ? RESULTS_GOLD : RECAP.green;
    if (top1) {
      // The #1 glow: soft gold behind the numeral, nothing else changes shape.
      kids.push(h({ position: 'absolute', left: -120, top: 120, display: 'flex' }, [{ type: 'img', props: { src: countdownGlowUri(), width: 900, height: 760, style: { width: 900, height: 760 } } }]));
    }
    kids.push(...countdownMast(d));
    kids.push(row({ position: 'absolute', left: 84, top: 226 }, countdownTicks(R, R, { max: 78, gap: 9, h: 46 })));
    kids.push(row({ position: 'absolute', left: 62, top: 250, alignItems: 'flex-start' }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 190, lineHeight: 1, color: accent, marginTop: 92, marginRight: -8, ...NOWRAP }, '#'),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 560, lineHeight: 1, letterSpacing: -22, color: top1 ? RESULTS_GOLD : RECAP.fg, ...NOWRAP }, String(R)),
    ]));
    const f = countdownFit(d, top1 ? 834 : 720);
    const honor = top1 ? [h({ display: 'flex', alignSelf: 'flex-start', marginLeft: 4, marginBottom: 26, background: RESULTS_GOLD, borderRadius: 5,
        transform: `skewX(${SKEW}deg)`, paddingLeft: 26, paddingRight: 26, paddingTop: 12, paddingBottom: 12 }, [
        text(RES_DISPLAY(34, RECAP.bg, { textTransform: 'uppercase', letterSpacing: -1, transform: `skewX(${-SKEW}deg)` }), COUNTDOWN_COPY.honor),
      ])] : [];
    kids.push(col({ position: 'absolute', left: 80, bottom: 1350 - CD_INFO_BOTTOM, width: 920 }, [
      ...honor,
      text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: f.fs, lineHeight: 0.95, letterSpacing: -Math.round(f.fs * 0.04), color: RECAP.fg, width: 920 }, f.title),
      text({ fontFamily: DISPLAY, fontWeight: 800, fontSize: f.artistFs, lineHeight: 1.1, letterSpacing: -1, color: RECAP.fg, marginTop: 26, ...NOWRAP }, f.artist),
      ...(f.handle ? [text({ fontFamily: MONO, fontWeight: 700, fontSize: f.handleFs, lineHeight: 1.3, color: RECAP.dim, marginTop: 8, ...NOWRAP }, f.handle)] : []),
    ]));
    // The submit strip: a rule, the question, the link, one button — under the record, never over it.
    kids.push(h({ position: 'absolute', left: 80, top: 1120, width: 920, height: 2, background: RECAP.line }, ''));
    kids.push(text(RES_DISPLAY(36, RECAP.fg, { position: 'absolute', left: 80, top: 1152, textTransform: 'uppercase', letterSpacing: -1 }), COUNTDOWN_COPY.question));
    kids.push(text({ position: 'absolute', left: 80, top: 1206, fontFamily: MONO, fontWeight: 700, fontSize: 30, color: RECAP.dim, ...NOWRAP }, SUBMIT_URL));
    kids.push(h({ position: 'absolute', right: 90, bottom: 80, height: 72, display: 'flex', alignItems: 'center', background: RECAP.green,
      borderRadius: 6, paddingLeft: 32, paddingRight: 32, transform: `skewX(${SKEW}deg)` }, [
      text(RES_DISPLAY(34, RECAP.bg, { textTransform: 'uppercase', letterSpacing: -1, transform: `skewX(${-SKEW}deg)` }), COUNTDOWN_COPY.submit),
    ]));
  }
  return h({ position: 'relative', display: 'flex', width: COUNTDOWN_SIZE[0], height: COUNTDOWN_SIZE[1], background: RECAP.bg, overflow: 'hidden' }, kids);
}

// ============ The winner posts — one 'winnerPost' element, 1080×1350 ============
// One portrait graphic per person, posted as an Instagram COLLAB post so it lands on their
// feed too (operator, 2026-09-18). Four posts off one element: Top Track / Top A&R of the Day
// (the daily #1s from the recap) and of the Week (with a strap saying what the week earns).
// Built to the approved mockup public/brand/winners/winner.html after two strips ("flyers
// look too busy" 2026-09-18; "information overload for promotional graphics" 2026-09-21):
// the lockup, the stacked title, the person, ONE line, the field. No trophy, no date, no
// score, no grade, no city. A track says "Rated by X A&Rs"; an A&R says "N points". Same day,
// "branding is too big — the title of the promo is TOP TRACK / TOP A&R": the lockup is a small
// header and TOP TRACK OF THE DAY is the hero. Handles print in parentheses, as the operator
// wrote them (twice).
//
// Data shape (server.js winnerDayData / winnerWeekData):
//   { kind: 'track'|'ar', period: 'day'|'week', label, sub: 'of the Day', date (caption only),
//     title, by, handle, photo? (data URI), line: { rated } | { points }, cta: { label, url },
//     selected?: ['Selected for the next', '$1,000 Music Tournament'] (week cards only) }
// WEEK cards (operator, 2026-09-21: "the weekly flyers are about the person placing in the
// tournament — that needs to be BIG"; 10-03: "artist name big with Instagram is the important
// thing"): Congratulations / the NAME in caps / the selection, two or three lines with the money
// in gold / "@handle" with the Instagram glyph, no parentheses. No song title (it rides in the
// caption), no title line, no numbers.
// The profile photo sits top right beside the header so the name runs full width.
const WINNER_SIZE = [1080, 1350];
// A line with every dollar amount in gold and the rest in ink (Satori collapses leading and
// trailing spaces, so they become non-breaking ones).
function winnerGoldLine(str, style) {
  const keep = t => t.replace(/^ /, '\u00A0').replace(/ $/, '\u00A0');
  return row({ alignItems: 'flex-end' }, String(str).split(/(\$[\d,]+)/).filter(Boolean).map(part =>
    text({ ...style, color: /^\$[\d,]+$/.test(part) ? RESULTS_GOLD : style.color }, keep(part))));
}
function winnerHeader() {
  return [
    h({ position: 'absolute', left: 80, top: 64, display: 'flex' }, [{ type: 'img', props: { src: logoDataUri(), style: { height: 30 } } }]),
    h({ position: 'absolute', left: 80, top: 108, display: 'flex', flexDirection: 'row', alignItems: 'center' }, [
      arBlock(60, 24),
      text(RES_DISPLAY(56, RECAP.fg, { textTransform: 'uppercase', marginLeft: 16 }), 'Meeting'),
    ]),
  ];
}
function winnerCta(cta) {
  return col({ position: 'absolute', left: 80, bottom: 64 }, [
    text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 42, lineHeight: 1, letterSpacing: -1, color: RECAP.bg, ...NOWRAP }, cta.label || ''),
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 34, lineHeight: 1, color: RECAP.bg, marginTop: 12, ...NOWRAP }, cta.url || ''),
  ]);
}
// The Instagram glyph on the 24 grid, stroked in the handle's colour: the brand draws icons, never emoji.
const _igIcons = {};
function igIconDataUri(color) {
  if (!_igIcons[color]) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' + color
      + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="' + color + '" stroke="none"/></svg>';
    _igIcons[color] = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  }
  return _igIcons[color];
}
function elementWinnerWeek(d) {
  const kids = winnerHeader();
  kids.push(row({ position: 'absolute', left: 80, top: 300, alignItems: 'center' }, [
    tick(16, 50, 22),
    text(RES_DISPLAY(64, RECAP.fg, { lineHeight: 1, letterSpacing: -2 }), 'Congratulations'),
  ]));
  // The name in caps, at most two lines: the size steps down with the length (Archivo 900 caps ~0.62em a character).
  const name = clip(d.title, 40);
  let fs = 76;
  for (const size of [140, 112, 92, 76]) { if (Math.ceil(name.length / Math.floor(920 / (size * 0.62))) <= 2) { fs = size; break; } }
  const sel = d.selected || [];
  const selStyle = { fontFamily: DISPLAY, fontWeight: 700, fontSize: 56, lineHeight: 1.12, letterSpacing: -2, color: RECAP.fg, ...NOWRAP };
  const small = { fontFamily: MONO, fontWeight: 700, fontSize: 36, lineHeight: 1.3, color: RECAP.dim };
  kids.push(col({ position: 'absolute', left: 80, top: 400, width: 920 }, [
    text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: fs, lineHeight: 0.92, letterSpacing: -Math.round(fs * 0.04), textTransform: 'uppercase', color: RECAP.fg }, name),
    col({ marginTop: 26 }, sel.map((l, i) => i === 0 ? text(selStyle, l) : winnerGoldLine(l, selStyle))),
    // "@handle" with the Instagram glyph, no parentheses (operator, 2026-10-03)
    d.handle ? row({ marginTop: 30, alignItems: 'center' }, [
      { type: 'img', props: { src: igIconDataUri(RECAP.dim), style: { width: 40, height: 40, marginRight: 14 } } },
      text(small, d.handle),
    ]) : text({}, ''),
  ]));
  if (d.photo) {
    kids.push(h({ position: 'absolute', right: 80, top: 64, width: 260, height: 260, overflow: 'hidden', borderRadius: 12,
      background: RECAP.panel, transform: `skewX(${SKEW}deg)`, display: 'flex' }, [
      { type: 'img', props: { src: d.photo, style: { position: 'absolute', left: -35, top: 0, width: 330, height: 260, objectFit: 'cover', transform: `skewX(${-SKEW}deg)` } } },
    ]));
  }
  kids.push(resultsField(300, 110), winnerCta(d.cta || {}));
  return h({ position: 'relative', display: 'flex', width: WINNER_SIZE[0], height: WINNER_SIZE[1], background: RECAP.bg }, kids);
}
// Since 2026-10-03 every winner post is a week card (the daily pair was retired for the
// Daily Countdown carousel); the element name stays so the hosted paths and routes do.
function elementWinnerPost(d) { return elementWinnerWeek(d); }

// ============ A&R Wars — the tournament graphics: feed / story / thumb / bracket ============
// Spec: docs/specs/tournament-spec.md §5 (what each state says) and §10 "Satori data shapes".
// Ported from the approved mockups in public/brand/wars/ (flyer-feed.html, flyer-story.html,
// thumb.html, bracket.html) — every number below is that file's CSS, so the Satori render and
// the Chrome preview in public/brand/wars/preview/ are the same picture.
//
// The weekly seat flyer: ONE BIG slot (that week's qualifier) and EIGHT SMALL seats (everyone
// picked so far; unfilled seats are numbered silhouettes). `big: null` is the final promo's
// question mark ("Who has the Best Ear?", the date and time big). After the event the champion
// takes the big slot with the gold ring. Colour has a job: PURPLE = the contest (the lockup
// block, the tags, the qualifier ring, the question mark, the bracket), GOLD = the prize amount
// and the champion ONLY, GREEN = the date, LIVE and the call to action. The prize prints ONCE
// per graphic (the field block, or the champion headline — the champion state hides the block).
//
//   tournamentFeed    1080×1350   tournamentStory   1080×1920
//   tournamentThumb   1920×1080   tournamentBracket 1080×1350
//
// Data (feed / story / thumb):
//   { lockupWord, eyebrow, dateLabel, timeLabel, stage: 'seat'|'final'|'champion', headline,
//     premise, prizeAmount, prizeLabel,
//     big: { name, handle|null, photo|null, tag|null } | null,
//     seats: [{ n, name|null, photo|null, filled, ring: 'qualifier'|'champion'|null }] ×8,
//     cta: { label, url } }
// Data (bracket):
//   { lockupWord, eyebrow, dateLabel, timeLabel, prizeAmount, prizeLabel?,
//     r1: [{ a: { name, seed, sub, photo }, b, winner: 'a'|'b'|null }] ×4,
//     r2: [{ a|null, b|null, winner }] ×2, final: { a|null, b|null, winner },
//     champion: { name, photo } | null, cta }
// Photos are data URIs prepared by the caller (null → the silhouette); this module never fetches.
const TOURNAMENT_SIZES = { tournamentFeed: [1080, 1350], tournamentStory: [1080, 1920], tournamentThumb: [1920, 1080], tournamentBracket: [1080, 1350] };
const WARS = { ...RECAP, purple: '#6d5fe0', gold: RESULTS_GOLD };
const WARS_PRIZE_LABEL = 'Cash Prize';

// The silhouette: a head and shoulders drawn as stroke SVG in the dim ink — never an emoji.
let _silhouette = null;
function silhouetteDataUri() {
  if (!_silhouette) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="' + WARS.dim
      + '" stroke-width="3" stroke-linecap="round"><circle cx="50" cy="38" r="17"/><path d="M19 96c3-20 16-30 31-30s28 10 31 30"/></svg>';
    _silhouette = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  }
  return _silhouette;
}
// Type that must stay on one line steps down a size until the estimate fits (Archivo mixed case
// ~0.58em a character, caps ~0.62em, Space Mono exactly 0.6em).
function warsFit(str, maxFs, minFs, maxW, em = 0.58) {
  const n = String(str == null ? '' : str).length;
  let fs = maxFs;
  while (fs > minFs && n * fs * em > maxW) fs -= 1;
  return fs;
}
function warsImg(src, size, extra = {}) {
  return { type: 'img', props: { src, width: size, height: size, style: { width: size, height: size, objectFit: 'cover', ...extra } } };
}
// A round slot. `photo` fills it; without one it carries the silhouette on a dim DASHED circle,
// or (`qm`) the purple question mark on a purple dashed circle. `ring` draws OUTSIDE the photo
// (the mockup's `outline`) — negative margins keep the layout where the photo alone would sit.
function warsCircle(size, { photo = null, qm = false, ring = null, ringWidth = 4, dashWidth = 2 } = {}) {
  const dashed = !photo;
  const dashColor = qm ? WARS.purple : WARS.line;
  const dw = dashed ? dashWidth : 0;
  const inner = size - 2 * dw;
  let child;
  if (photo) child = warsImg(photo, size);
  else if (qm) child = text({ fontFamily: MONO, fontWeight: 700, fontSize: Math.round(size * 0.65), lineHeight: 1, color: WARS.purple, marginTop: Math.round(size * -0.04) }, '?');
  else child = warsImg(silhouetteDataUri(), inner);
  const face = h({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: size, height: size,
    borderRadius: size, overflow: 'hidden', background: WARS.panel,
    ...(dashed ? { border: `${dw}px dashed ${dashColor}` } : {}) }, [child]);
  if (!ring) return face;
  const rw = ringWidth, outer = size + 2 * rw;
  return h({ display: 'flex', flexShrink: 0, width: outer, height: outer, borderRadius: outer, border: `${rw}px solid ${ring}`,
    margin: -rw }, [face]);
}
// The [A&R] WARS lockup: the CONTEST PURPLE block (the mark master is purple here, not green)
// with the word in Archivo 900 at build.py's lockup geometry (.9375S, −.04em, .16S past the block).
function warsLockup(S, word) {
  const fs = Math.round(S * 0.39);
  return row({}, [
    h({ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: S, height: S, background: WARS.purple,
      borderRadius: Math.round(S * 0.075), transform: `skewX(${SKEW}deg)` },
      text({ transform: `skewX(${-SKEW}deg)`, fontFamily: DISPLAY, fontWeight: 900, fontSize: fs, letterSpacing: -Math.round(fs * 0.05), color: WARS.fg, lineHeight: 1 }, 'A&R')),
    text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: Math.round(S * 0.9375), lineHeight: 1, letterSpacing: -Math.round(S * 0.9375 * 0.04),
      textTransform: 'uppercase', color: WARS.fg, marginLeft: Math.round(S * 0.16), ...NOWRAP }, word || 'Wars'),
  ]);
}
// The LIVE badge: a green skewed block, the word un-skewed inside it, in the ground colour.
function warsLive(hgt, fs, padX, mr, radius = 4) {
  return h({ display: 'flex', alignItems: 'center', flexShrink: 0, height: hgt, background: WARS.green, borderRadius: radius,
    paddingLeft: padX, paddingRight: padX, marginRight: mr, transform: `skewX(${SKEW}deg)` }, [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: fs, letterSpacing: Math.round(fs * 0.06), lineHeight: 1, color: WARS.bg, transform: `skewX(${-SKEW}deg)`, ...NOWRAP }, 'LIVE'),
  ]);
}
// The seat tag: "QUALIFIED · WEEK 4" on purple, "CHAMPION" on gold with the ground ink.
function warsTag(label, { fill, ink, hgt, fs, mt = 0, ml = 0 }) {
  return h({ display: 'flex', alignItems: 'center', alignSelf: 'flex-start', flexShrink: 0, height: hgt, background: fill, borderRadius: 4,
    paddingLeft: 18, paddingRight: 18, marginTop: mt, marginLeft: ml, transform: `skewX(${SKEW}deg)` }, [
    text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: fs, letterSpacing: -Math.round(fs * 0.01), lineHeight: 1, textTransform: 'uppercase', color: ink, transform: `skewX(${-SKEW}deg)`, ...NOWRAP }, label),
  ]);
}
// A one-line headline with the prize amount in gold and the rest in ink, stepped down to fit.
function warsHeadline(str, prize, maxFs, minFs, maxW, extra = {}) {
  const line = clip(str, 60);
  const fs = warsFit(line, maxFs, minFs, maxW);
  const st = { fontFamily: DISPLAY, fontWeight: 900, fontSize: fs, lineHeight: 1, letterSpacing: -Math.round(fs * 0.04), color: WARS.fg, ...NOWRAP };
  const keep = t => t.replace(/^ /, ' ').replace(/ $/, ' ');
  const parts = prize ? line.split(prize) : [line];
  const kids = [];
  parts.forEach((part, i) => {
    if (i) kids.push(text({ ...st, color: WARS.gold }, prize));
    if (part) kids.push(text(st, keep(part)));
  });
  return row({ alignItems: 'flex-end', ...extra }, kids);
}
// The 13° green field at the foot of a portrait graphic (height, and where the cut meets the
// left edge, measured from the field's top). Same shear as resultsField, any canvas height.
function warsField(Hd, height, cutTop) {
  const boxH = height * 2 + 300;
  return h({ position: 'absolute', left: 0, top: Hd - height, width: 1080, height, overflow: 'hidden', display: 'flex' }, [
    h({ position: 'absolute', left: 0, top: cutTop - Math.round(540 * TAN13), width: 1080, height: boxH, background: WARS.green, transform: 'skewY(-13deg)' }, ''),
  ]);
}
// The eight seats in one row, in the order they qualified; an unfilled seat is a numbered silhouette.
function warsSeats(d, g) {
  const seats = (d.seats || []).slice(0, 8);
  while (seats.length < 8) seats.push({ n: seats.length + 1, filled: false });
  return seats.map((s, i) => {
    const n = s.n || i + 1;
    const filled = !!s.filled;
    const ring = s.ring === 'champion' ? WARS.gold : s.ring === 'qualifier' ? WARS.purple : null;
    // Satori ignores textAlign on a nowrap box, so every label is a nowrap line the column
    // centres. A two-word name wider than the seat breaks at a space on the portrait pieces
    // (the thumbnail keeps one line and steps the size down instead).
    const label = filled ? clip(s.name || '', 24) : 'Seat ' + n;
    const words = label.split(' ');
    let lines = [label];
    if (filled && !g.nowrap && words.length > 1 && label.length * g.nameFs * 0.55 > g.w) {
      const k = Math.max(1, Math.round(words.length / 2));
      lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    }
    const maxW = g.nameMax || g.w + 8;
    const nameFs = Math.min(...lines.map(l => warsFit(l, g.nameFs, 12, maxW, 0.55)));
    const lineStyle = filled
      ? { fontFamily: DISPLAY, fontWeight: 800, fontSize: nameFs, lineHeight: 1.05, letterSpacing: -Math.round(nameFs * 0.03),
          color: s.ring === 'champion' ? WARS.gold : WARS.fg, ...NOWRAP }
      : { fontFamily: MONO, fontWeight: 700, fontSize: g.seatFs, lineHeight: 1.05, letterSpacing: 1, color: WARS.dim, ...NOWRAP };
    return col({ width: g.w, alignItems: 'center', flexShrink: 0 }, [
      warsCircle(g.ph, { photo: filled ? s.photo : null, ring, ringWidth: g.ring, dashWidth: g.dash }),
      col({ marginTop: g.nameMt, alignItems: 'center' }, lines.map(l => text(lineStyle, l))),
    ]);
  });
}
// The big slot laid as a ROW (feed + story): the photo left, the person right. A null `big` is
// the final promo: the question mark, then the date and time big, then the premise.
function warsBigRow(d, g) {
  const champion = d.stage === 'champion';
  const big = d.big;
  const premise = text({ fontFamily: SANS, fontWeight: 400, fontSize: 26, lineHeight: 1.3, letterSpacing: -0.3, color: WARS.fg, marginTop: 20, width: g.premiseW }, d.premise || '');
  let photo, tx;
  if (!big) {
    photo = warsCircle(g.ph, { qm: true, dashWidth: 4 });
    tx = [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: g.when, lineHeight: 1.15, letterSpacing: -Math.round(g.when * 0.02), color: WARS.green, ...NOWRAP }, d.dateLabel || ''),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: g.when, lineHeight: 1.15, letterSpacing: -Math.round(g.when * 0.02), color: WARS.green, ...NOWRAP }, d.timeLabel || ''),
      premise,
    ];
  } else {
    photo = warsCircle(g.ph, { photo: big.photo, ring: champion ? WARS.gold : null, ringWidth: 8 });
    const name = clip(big.name || '', 30);
    const nameFs = warsFit(name, g.nm, 24, g.txW, 0.6);
    tx = [text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: nameFs, lineHeight: 0.95, letterSpacing: -Math.round(nameFs * 0.04), color: champion ? WARS.gold : WARS.fg, ...NOWRAP }, name)];
    if (big.handle) {
      const handle = '@' + String(big.handle).replace(/^@/, '');
      const hFs = warsFit(handle, g.ig, 18, g.txW - g.igi - 10, 0.6);
      tx.push(row({ marginTop: 14 }, [
        { type: 'img', props: { src: igIconDataUri(WARS.dim), style: { width: g.igi, height: g.igi, marginRight: 10, flexShrink: 0 } } },
        text({ fontFamily: MONO, fontWeight: 700, fontSize: hFs, lineHeight: 1, color: WARS.dim, ...NOWRAP }, handle),
      ]));
    }
    if (big.tag) tx.push(warsTag(clip(big.tag, 28), champion ? { fill: WARS.gold, ink: WARS.bg, hgt: g.tagH, fs: g.tagFs, mt: 22, ml: 6 } : { fill: WARS.purple, ink: WARS.fg, hgt: g.tagH, fs: g.tagFs, mt: 22, ml: 6 }));
    tx.push(premise);
  }
  return row({ position: 'absolute', left: g.pad, top: g.top, width: g.W - 2 * g.pad }, [
    photo,
    col({ marginLeft: 44, alignItems: 'flex-start' }, tx),
  ]);
}
// The masthead shared by the three promo pieces: the logo, the event number, the lockup.
function warsMast(d, g) {
  return [
    h({ position: 'absolute', left: g.pad, top: g.logoTop, display: 'flex' }, [{ type: 'img', props: { src: logoDataUri(), style: { height: g.logoH } } }]),
    text({ position: 'absolute', ...(g.numLeft ? { left: g.pad } : { right: g.pad }), top: g.numTop, fontFamily: MONO, fontWeight: 700, fontSize: g.numFs, lineHeight: 1.2, letterSpacing: 0.6, color: WARS.dim, ...NOWRAP }, clip(d.eyebrow || '', 24)),
    h({ position: 'absolute', left: g.pad, top: g.lockTop, display: 'flex' }, [warsLockup(g.S, d.lockupWord)]),
  ];
}
// The event line under the lockup: the LIVE badge + the event on the final promo, else
// "<event> · <date> · <time>" in green mono.
function warsEye(d, g) {
  const st = { fontFamily: MONO, fontWeight: 700, fontSize: 30, lineHeight: 1, letterSpacing: -0.3, color: WARS.green, ...NOWRAP };
  const kids = d.stage === 'final'
    ? [warsLive(38, 22, 12, 16), text(st, clip(d.eyebrow || '', 40))]
    : [text(st, clip([d.eyebrow, d.dateLabel, d.timeLabel].filter(Boolean).join(' · '), 50))];
  return row({ position: 'absolute', left: g.pad, top: g.eyeTop, height: 38 }, kids);
}
// The foot of the portrait pieces: the call to action bottom-left on the green field, the
// prize bottom-right (hidden on the champion graphic, whose headline carries the amount).
function warsFoot(d, g) {
  const cta = d.cta || {};
  const kids = [
    col({ position: 'absolute', left: g.pad, bottom: g.ctaBottom }, [
      text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: g.ctaFs, lineHeight: 1, letterSpacing: -Math.round(g.ctaFs * 0.03), color: WARS.bg, ...NOWRAP }, clip(cta.label || '', 24)),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: g.urlFs, lineHeight: 1, letterSpacing: -0.3, color: WARS.bg, marginTop: g.urlMt, ...NOWRAP }, clip(cta.url || '', 28)),
    ]),
  ];
  if (d.stage !== 'champion' && d.prizeAmount) {
    kids.push(col({ position: 'absolute', right: g.pad, bottom: g.prizeBottom, alignItems: 'flex-end' }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: g.prizeFs, lineHeight: 1, letterSpacing: -Math.round(g.prizeFs * 0.04), color: WARS.bg, ...NOWRAP }, d.prizeAmount),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: g.prizeLabelFs, lineHeight: 1.2, letterSpacing: -0.3, color: WARS.bg, marginTop: 4, ...NOWRAP }, d.prizeLabel || WARS_PRIZE_LABEL),
    ]));
  }
  return kids;
}
// Feed and story share one build; `g` carries the geometry that differs between 4:5 and 9:16
// (the story keeps Instagram's top and bottom 250px clear).
function elementTournamentPortrait(d, story) {
  const [Wd, Hd] = story ? TOURNAMENT_SIZES.tournamentStory : TOURNAMENT_SIZES.tournamentFeed;
  const g = story
    ? { W: Wd, pad: 72, logoTop: 262, logoH: 34, numTop: 258, numFs: 32, lockTop: 330, S: 140, eyeTop: 520, headTop: 572, headFs: 66,
        top: 700, ph: 380, nm: 58, ig: 28, igi: 32, tagH: 44, tagFs: 23, when: 46, premiseW: 512, txW: 936 - 380 - 44,
        seatsTop: 1136, seat: { w: 112, ph: 104, nameFs: 19, nameMt: 10, seatFs: 16, ring: 4, dash: 2 },
        field: [620, 249], ctaBottom: 262, ctaFs: 52, urlFs: 40, urlMt: 14, prizeBottom: 268, prizeFs: 72, prizeLabelFs: 30 }
    : { W: Wd, pad: 72, logoTop: 64, logoH: 32, numTop: 60, numFs: 32, lockTop: 128, S: 120, eyeTop: 288, headTop: 338, headFs: 64,
        top: 440, ph: 340, nm: 60, ig: 30, igi: 34, tagH: 44, tagFs: 24, when: 44, premiseW: 552, txW: 936 - 340 - 44,
        seatsTop: 820, seat: { w: 112, ph: 100, nameFs: 19, nameMt: 10, seatFs: 16, ring: 4, dash: 2 },
        field: [300, 110], ctaBottom: 64, ctaFs: 42, urlFs: 34, urlMt: 12, prizeBottom: 72, prizeFs: 64, prizeLabelFs: 28 };
  const kids = warsMast(d, g);
  kids.push(warsEye(d, g));
  kids.push(warsHeadline(d.headline || '', d.prizeAmount, g.headFs, 36, Wd - 2 * g.pad, { position: 'absolute', left: g.pad, top: g.headTop }));
  kids.push(warsBigRow(d, g));
  kids.push(row({ position: 'absolute', left: g.pad, top: g.seatsTop, width: Wd - 2 * g.pad, justifyContent: 'space-between', alignItems: 'flex-start' }, warsSeats(d, g.seat)));
  kids.push(warsField(Hd, g.field[0], g.field[1]));
  kids.push(...warsFoot(d, g));
  return h({ position: 'relative', display: 'flex', width: Wd, height: Hd, background: WARS.bg, overflow: 'hidden' }, kids);
}
// The livestream thumbnail, 16:9, designed to read at 180px: the lockup, the big face (or the
// question mark), the prize, the date, and a row of eight circles survive; the names are small.
function elementTournamentThumb(d) {
  const [Wd, Hd] = TOURNAMENT_SIZES.tournamentThumb;
  const pad = 96, champion = d.stage === 'champion', big = d.big;
  const kids = warsMast(d, { pad, logoTop: 64, logoH: 40, numTop: 124, numFs: 30, numLeft: true, lockTop: 180, S: 220 });
  // the date, green, with the LIVE badge until the event has happened
  const whenSt = { fontFamily: MONO, fontWeight: 700, fontSize: 56, lineHeight: 1, letterSpacing: -2, color: WARS.green, ...NOWRAP };
  kids.push(row({ position: 'absolute', left: pad, top: 440, height: 64 }, [
    ...(champion ? [] : [warsLive(64, 36, 20, 24, 6)]),
    text(whenSt, clip([d.dateLabel, d.timeLabel].filter(Boolean).join(' · '), 40)),
  ]));
  kids.push(warsHeadline(d.headline || '', d.prizeAmount, 76, 40, 1260, { position: 'absolute', left: pad, top: 530 }));
  if (!champion && d.prizeAmount) {
    kids.push(row({ position: 'absolute', left: pad, top: 620, alignItems: 'flex-end' }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 120, lineHeight: 1, letterSpacing: -7, color: WARS.gold, ...NOWRAP }, d.prizeAmount),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 34, lineHeight: 1, letterSpacing: 3, textTransform: 'uppercase', color: WARS.gold, marginLeft: 22, marginBottom: 6, ...NOWRAP }, d.prizeLabel || WARS_PRIZE_LABEL),
    ]));
  }
  kids.push(text({ position: 'absolute', left: pad, top: champion ? 640 : 752, width: 1260, fontFamily: SANS, fontWeight: 400, fontSize: 27, lineHeight: 1.3, letterSpacing: -0.4, color: WARS.fg }, d.premise || ''));
  // the big slot, top right: the photo, then the person under it
  const bigKids = [];
  if (!big) bigKids.push(warsCircle(420, { qm: true, dashWidth: 5 }));
  else {
    bigKids.push(warsCircle(420, { photo: big.photo, ring: champion ? WARS.gold : null, ringWidth: 10 }));
    const name = clip(big.name || '', 30);
    const nameFs = warsFit(name, 48, 24, 460, 0.6);
    bigKids.push(text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: nameFs, lineHeight: 1, letterSpacing: -Math.round(nameFs * 0.04), textAlign: 'center', color: champion ? WARS.gold : WARS.fg, marginTop: 22, ...NOWRAP }, name));
    if (big.handle) {
      const handle = '@' + String(big.handle).replace(/^@/, '');
      const hFs = warsFit(handle, 26, 16, 460 - 36, 0.6);
      bigKids.push(row({ marginTop: 10 }, [
        { type: 'img', props: { src: igIconDataUri(WARS.dim), style: { width: 28, height: 28, marginRight: 8, flexShrink: 0 } } },
        text({ fontFamily: MONO, fontWeight: 700, fontSize: hFs, lineHeight: 1, color: WARS.dim, ...NOWRAP }, handle),
      ]));
    }
    if (big.tag) bigKids.push(warsTag(clip(big.tag, 28), champion ? { fill: WARS.gold, ink: WARS.bg, hgt: 42, fs: 22, mt: 16 } : { fill: WARS.purple, ink: WARS.fg, hgt: 42, fs: 22, mt: 16 }));
  }
  kids.push(col({ position: 'absolute', right: pad, top: 96, width: 460, alignItems: 'center' }, bigKids));
  // the eight seats along the bottom
  kids.push(row({ position: 'absolute', left: pad, bottom: 56, width: Wd - 2 * pad, justifyContent: 'space-between', alignItems: 'flex-start' },
    warsSeats(d, { w: 190, ph: 150, nameFs: 24, nameMt: 12, seatFs: 20, ring: 5, dash: 3, nowrap: true, nameMax: 200 })));
  return h({ position: 'relative', display: 'flex', width: Wd, height: Hd, background: WARS.bg, overflow: 'hidden' }, kids);
}
// The bracket: 8 → 4 → 2 → 1 drawn left to right. The draw column carries photos, names and
// "#seed · handle-or-city"; later columns the name and seed; empty slots are dashed purple
// boxes; a competitor who lost dims to 40%; a winner's slot takes the purple border. Gold on
// the champion slot and the prize only. Connectors are plain boxes: full purple past a decided
// match, dimmed before it, so the eye follows the result.
function elementTournamentBracket(d) {
  const [Wd, Hd] = TOURNAMENT_SIZES.tournamentBracket;
  const pad = 60;
  const r1 = (d.r1 || []).slice(0, 4), r2 = (d.r2 || []).slice(0, 2), fin = d.final || {}, champ = d.champion || null;
  while (r1.length < 4) r1.push({ a: null, b: null, winner: null });
  while (r2.length < 2) r2.push({ a: null, b: null, winner: null });
  const kids = [
    h({ position: 'absolute', left: pad, top: 60, display: 'flex' }, [{ type: 'img', props: { src: logoDataUri(), style: { height: 30 } } }]),
    text({ position: 'absolute', right: pad, top: 56, fontFamily: MONO, fontWeight: 700, fontSize: 30, lineHeight: 1.27, letterSpacing: 0.6, color: WARS.dim, ...NOWRAP }, clip(d.eyebrow || '', 24)),
    h({ position: 'absolute', left: pad, top: 116, display: 'flex' }, [warsLockup(100, d.lockupWord)]),
    text({ position: 'absolute', left: pad, top: 244, fontFamily: DISPLAY, fontWeight: 900, fontSize: 40, lineHeight: 1, letterSpacing: -1.6, textTransform: 'uppercase', color: WARS.fg, ...NOWRAP }, 'Bracket'),
    col({ position: 'absolute', right: pad, top: 244, alignItems: 'flex-end' }, [d.dateLabel, d.timeLabel].filter(Boolean).map(l =>
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 28, lineHeight: 1.25, letterSpacing: -0.6, color: WARS.green, ...NOWRAP }, clip(l, 30)))),
  ];
  // Geometry (bracket.html): the draw (wide, with photos), the Final 4, the Final 2, the champion.
  const X = [{ x: 60, w: 280 }, { x: 372, w: 190 }, { x: 594, w: 190 }, { x: 816, w: 204 }];
  const SH = 76, PAIR = 12, GAP = 34, TOP = 372;
  const y1 = [];
  for (let i = 0; i < 8; i++) y1.push(TOP + i * SH + Math.floor(i / 2) * (GAP - PAIR) + i * PAIR);
  const mid = y => y + SH / 2;
  const y2 = [0, 1, 2, 3].map(i => (mid(y1[2 * i]) + mid(y1[2 * i + 1])) / 2 - SH / 2);
  const y3 = [0, 1].map(i => (mid(y2[2 * i]) + mid(y2[2 * i + 1])) / 2 - SH / 2);
  const yF = (mid(y3[0]) + mid(y3[1])) / 2;
  // Round labels over each column: the live round on purple, the champion label gold once there is one.
  const live = champ ? 3 : (fin.a || fin.b) ? 2 : r2.some(m => m.a || m.b) ? 1 : 0;
  [['Round 1', 0], ['Final 4', 1], ['Final 2', 2], ['Champion', 3]].forEach(([t, i]) => {
    const gold = i === 3 && champ, on = i === live;
    kids.push(h({ position: 'absolute', left: X[i].x + 6, top: 316, width: X[i].w - 12, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `2px solid ${gold ? WARS.gold : on ? WARS.purple : WARS.line}`, background: gold ? WARS.gold : on ? WARS.purple : 'transparent',
      borderRadius: 4, transform: `skewX(${SKEW}deg)` }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 17, lineHeight: 1, letterSpacing: 0.7, textTransform: 'uppercase', color: gold ? WARS.bg : on ? WARS.fg : WARS.dim, transform: `skewX(${-SKEW}deg)`, ...NOWRAP }, t),
    ]));
  });
  // A slot: a person (state '' | 'won' | 'out'), or an empty dashed box with a label.
  const slot = (x, y, w, state, inner, hgt = SH, extra = {}) => h({ position: 'absolute', left: x, top: y, width: w, height: hgt, display: 'flex', alignItems: 'center',
    borderRadius: 8, background: WARS.panel, border: `2px solid ${state === 'won' ? WARS.purple : WARS.line}`, paddingLeft: 14, paddingRight: 14,
    opacity: state === 'out' ? 0.4 : 1, ...extra }, inner);
  const empty = (x, y, w, label, hgt = SH, inner = null) => h({ position: 'absolute', left: x, top: y, width: w, height: hgt, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: `2px dashed ${WARS.purple}` }, inner || [
    text({ fontFamily: MONO, fontWeight: 700, fontSize: 16, lineHeight: 1, letterSpacing: 0.6, textTransform: 'uppercase', color: WARS.purple, ...NOWRAP }, label),
  ]);
  const person = (c, w, withSub) => {
    const name = clip(c.name || '', 26);
    const nameFs = warsFit(name, 24, 12, w - 96, 0.55);
    const seed = c.seed != null ? '#' + c.seed : '';
    const sub = withSub && c.sub ? seed + ' · ' + c.sub : seed;
    const subFs = warsFit(sub, 16, 11, w - 96, 0.6);
    return [
      warsCircle(52, { photo: c.photo, dashWidth: 0 }),
      col({ marginLeft: 12, alignItems: 'flex-start' }, [
        text({ fontFamily: DISPLAY, fontWeight: 800, fontSize: nameFs, lineHeight: 1, letterSpacing: -Math.round(nameFs * 0.03), color: WARS.fg, ...NOWRAP }, name),
        text({ fontFamily: MONO, fontWeight: 700, fontSize: subFs, lineHeight: 1, color: WARS.dim, marginTop: 6, ...NOWRAP }, sub),
      ]),
    ];
  };
  // Everyone a decided match went against, by seed — a loser dims in EVERY column they
  // appear in, so a finalist who lost dims all the way back to the draw (the mockup's lostIn).
  const outSeeds = new Set();
  for (const m of [...r1, ...r2, fin]) {
    if (!m || !m.winner) continue;
    const loser = m[m.winner === 'a' ? 'b' : 'a'];
    if (loser && loser.seed != null) outSeeds.add(loser.seed);
  }
  const stateOf = (m, side) => {
    const c = m && m[side];
    if (c && outSeeds.has(c.seed)) return 'out';
    return m && m.winner === side ? 'won' : '';
  };
  // Column 1: the draw
  r1.forEach((m, i) => ['a', 'b'].forEach((side, j) => {
    const c = m[side];
    const y = y1[2 * i + j];
    if (!c) { kids.push(empty(X[0].x, y, X[0].w, 'TBD')); return; }
    kids.push(slot(X[0].x, y, X[0].w, stateOf(m, side), person(c, X[0].w, true)));
  }));
  // Column 2: the Final 4 (the winner of each draw matchup; the empty label names the matchup by seed)
  for (let i = 0; i < 4; i++) {
    const m = r2[Math.floor(i / 2)], side = i % 2 ? 'b' : 'a';
    const c = m[side];
    if (!c) {
      const a = r1[i].a, b = r1[i].b;
      kids.push(empty(X[1].x, y2[i], X[1].w, a && b && a.seed != null && b.seed != null ? a.seed + 'v' + b.seed : 'TBD'));
      continue;
    }
    kids.push(slot(X[1].x, y2[i], X[1].w, stateOf(m, side), person(c, X[1].w, false)));
  }
  // Column 3: the Final 2
  for (let i = 0; i < 2; i++) {
    const side = i ? 'b' : 'a', c = fin[side];
    if (!c) { kids.push(empty(X[2].x, y3[i], X[2].w, 'TBD')); continue; }
    kids.push(slot(X[2].x, y3[i], X[2].w, stateOf(fin, side), person(c, X[2].w, false)));
  }
  // Column 4: the champion — gold only here and on the prize
  const prize = d.prizeAmount || '';
  if (!champ) {
    kids.push(empty(X[3].x, yF - 60, X[3].w, 'Champion', 120, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 16, lineHeight: 1, letterSpacing: 0.6, textTransform: 'uppercase', color: WARS.purple, ...NOWRAP }, 'Champion'),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 40, lineHeight: 1, letterSpacing: -2, color: WARS.gold, marginTop: 8, ...NOWRAP }, prize),
    ]));
  } else {
    const name = clip(champ.name || '', 26);
    const nameFs = warsFit(name, 26, 12, X[3].w - 20, 0.55);
    kids.push(h({ position: 'absolute', left: X[3].x, top: yF - 100, width: X[3].w, height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      borderRadius: 8, background: WARS.gold, border: `2px solid ${WARS.gold}`, paddingLeft: 10, paddingRight: 10 }, [
      champ.photo ? warsImg(champ.photo, 72, { borderRadius: 72 }) : h({ display: 'flex', width: 72, height: 72, borderRadius: 72, background: 'rgba(14,12,26,0.18)' }, ''),
      text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 18, lineHeight: 1, letterSpacing: 0.4, textTransform: 'uppercase', color: WARS.bg, marginTop: 10, ...NOWRAP }, 'Champion'),
      text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: nameFs, lineHeight: 1, letterSpacing: -Math.round(nameFs * 0.03), color: WARS.bg, marginTop: 8, ...NOWRAP }, name),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 34, lineHeight: 1, letterSpacing: -1.7, color: WARS.bg, marginTop: 8, ...NOWRAP }, prize),
    ]));
  }
  // Connectors: each pair joins at the gap's centre line, then runs into the next slot.
  const T = 3;
  const line = (x, y, w, hgt, dim) => kids.push(h({ position: 'absolute', left: x, top: y, width: w, height: hgt, background: WARS.purple, opacity: dim ? 0.35 : 1 }, ''));
  const join = (colIdx, ys, i, decided) => {
    const x1 = X[colIdx].x + X[colIdx].w, xm = x1 + (X[colIdx + 1].x - x1) / 2, x2 = X[colIdx + 1].x;
    const a = mid(ys[2 * i]), c = mid(ys[2 * i + 1]), m = (a + c) / 2;
    line(x1, a - T / 2, xm - x1, T, !decided);
    line(x1, c - T / 2, xm - x1, T, !decided);
    line(xm - T / 2, a, T, c - a, !decided);
    line(xm, m - T / 2, x2 - xm, T, !decided);
  };
  for (let i = 0; i < 4; i++) join(0, y1, i, !!r1[i].winner);
  for (let i = 0; i < 2; i++) join(1, y2, i, !!r2[i].winner);
  join(2, y3, 0, !!fin.winner);
  // The call to action over a rule, the prize right
  const cta = d.cta || {};
  kids.push(h({ position: 'absolute', left: pad, right: pad, bottom: 60, borderTop: `2px solid ${WARS.line}`, paddingTop: 28, display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, [
    col({ alignItems: 'flex-start' }, [
      text({ fontFamily: DISPLAY, fontWeight: 900, fontSize: 36, lineHeight: 1, letterSpacing: -1, textTransform: 'uppercase', color: WARS.fg, ...NOWRAP }, clip(cta.label || '', 24)),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 30, lineHeight: 1, color: WARS.green, marginTop: 12, ...NOWRAP }, clip(cta.url || '', 28)),
    ]),
    col({ alignItems: 'flex-end' }, [
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 52, lineHeight: 1, letterSpacing: -2.6, color: WARS.gold, ...NOWRAP }, prize),
      text({ fontFamily: MONO, fontWeight: 700, fontSize: 24, lineHeight: 1.2, color: WARS.dim, marginTop: 2, ...NOWRAP }, d.prizeLabel || WARS_PRIZE_LABEL),
    ]),
  ]));
  return h({ position: 'relative', display: 'flex', width: Wd, height: Hd, background: WARS.bg, overflow: 'hidden' }, kids);
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
  if (type === 'referCard') return elementReferPerson(data, false);
  if (type === 'referStory') return elementReferPerson(data, true);
  if (type === 'referJoin' || type === 'referSubmit') return elementReferFlyer(data, type);
  if (type === 'resultsSlide') return elementResultsSlide(data);
  if (type === 'countdownSlide') return elementCountdownSlide(data);
  if (type === 'winnerPost') return elementWinnerPost(data);
  if (type === 'tournamentFeed') return elementTournamentPortrait(data, false);
  if (type === 'tournamentStory') return elementTournamentPortrait(data, true);
  if (type === 'tournamentThumb') return elementTournamentThumb(data);
  if (type === 'tournamentBracket') return elementTournamentBracket(data);
  throw new Error('unknown card type: ' + type);
}

// ---- render to PNG ----
let _satori = null, _Resvg = null;
// Every card is 3:4 except the recap graphics, which carry their own size.
// ONE size table. A merge once left two sizeOf()s here; the later one lost REFER_SIZES, so
// every referral graphic rendered on the 1080×1440 default and the 1920-tall story was cut
// off at the QR codes (found 2026-09-20). The test suite now pins the refer sizes.
function sizeOf(type) {
  if (type === 'resultsSlide') return RESULTS_SIZE;
  if (type === 'countdownSlide') return COUNTDOWN_SIZE;
  if (type === 'winnerPost') return WINNER_SIZE;
  if (type === 'trackPage') return TRACK_SIZE;
  if (TOURNAMENT_SIZES[type]) return TOURNAMENT_SIZES[type];
  return REFER_SIZES[type] || [W, H];
}
// `outWidth` rasterises the same layout at a smaller width (a thumbnail): the element is
// still laid out at its real size, so a thumbnail is the download, scaled — never a
// separately designed picture that could drift from it.
async function renderPng(type, data, outWidth) {
  if (!_satori) { const m = require('satori'); _satori = m.default || m; }
  if (!_Resvg) { _Resvg = require('@resvg/resvg-js').Resvg; }
  const [w, hgt] = sizeOf(type);
  const svg = await _satori(element(type, data), { width: w, height: hgt, fonts: fonts() });
  const png = new _Resvg(svg, { fitTo: { mode: 'width', value: outWidth && outWidth < w ? outWidth : w } }).render().asPng();
  return png;
}

module.exports = { renderPng, element, sizeOf, REFER_SIZES, REFER_COPY, W, H, PRIZE, CHART_BANDS, CHART_SCALE_MAX, SUBMIT_URL, JOIN_URL, RESULTS_PER_SLIDE, COUNTDOWN_SIZE, COUNTDOWN_COPY, TRACK_SIZE, TRACK_TAG, WINNER_SIZE, TOURNAMENT_SIZES };
