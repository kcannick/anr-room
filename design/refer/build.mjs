import fs from 'node:fs';

// Deterministic fake QR (25 modules) with the three finder patterns — a placeholder for
// the real code the server will render into the same slot.
function qr(size, fg, bg) {
  const n = 25, m = size / n;
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cells = [];
  const finder = (ox, oy) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const ring = x === 0 || y === 0 || x === 6 || y === 6; const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
    if (ring || core) cells.push([ox + x, oy + y]); } };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  const inFinder = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inFinder(x, y) && rnd() < 0.45) cells.push([x, y]);
  const rects = cells.map(([x, y]) => `<rect x="${(x * m).toFixed(1)}" y="${(y * m).toFixed(1)}" width="${(m + 0.3).toFixed(1)}" height="${(m + 0.3).toFixed(1)}"></rect>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="display:block;background:${bg}"><g fill="${fg}">${rects}</g></svg>`;
}

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;800;900&amp;family=Space+Mono:wght@400;700&amp;display=swap">`;
const HEAD = (extra = '') => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>
    body { margin: 0; background: #0E0C1A; color: #EAE9F2; font-family: Archivo, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    a { color: #4bb749; text-decoration: none; } a:hover { color: #379235; }
    ${extra}
  </style>
</helmet>`;
const FOOT = `</x-dc>
</body>
</html>`;

const MONO = `font-family: 'Space Mono', Menlo, monospace;`;
// The block mark, at a given size. Same geometry as daily.html's .mark (skew -13deg).
const mark = (s, fill = '#4bb749', ink) => { ink = ink || '#0E0C1A'; return  `<div style="width: ${s}px; height: ${s}px; background: ${fill}; transform: skewX(-13deg); flex: none; display: flex; align-items: center; justify-content: center;"><span style="transform: skewX(13deg); font-weight: 900; font-size: ${Math.round(s * .35)}px; letter-spacing: -0.02em; color: ${ink};">A&amp;R</span></div>`; };
const lockup = (s, word, fill, ink) => `<div style="display: flex; align-items: center; gap: ${Math.round(s * .4)}px;">${mark(s, fill, ink)}<span style="font-weight: 800; font-size: ${Math.round(s * .62)}px; letter-spacing: 0.14em; text-transform: uppercase;">${word}</span></div>`;

// ---------- Main: the /refer page (phone, 390 wide, flows) ----------
const copyIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>`;
const dlIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>`;
const linkRow = (url) => `<div style="display: flex; align-items: center; gap: 8px; background: #0a0814; border: 1px solid #2e2750; border-radius: 12px; padding: 12px 13px;">
        <span style="${MONO} font-size: 13px; color: #EAE9F2; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${url}</span>
        <button style="display: flex; align-items: center; gap: 6px; background: #4bb749; color: #0E0C1A; border: 0; border-radius: 10px; padding: 9px 12px; font-family: inherit; font-weight: 800; font-size: 13px; cursor: pointer; height: 44px;">${copyIcon}Copy</button>
      </div>`;
const stat = (k, v, color = '#EAE9F2') => `<div style="flex: 1; background: #0a0814; border: 1px solid #2e2750; border-radius: 12px; padding: 12px 10px; text-align: center;"><div style="${MONO} font-size: 9.5px; letter-spacing: 0.15em; text-transform: uppercase; color: #9793B4;">${k}</div><div style="${MONO} font-size: 22px; font-weight: 700; margin-top: 5px; color: ${color};">${v}</div></div>`;
const sectionHead = (t, tick = '#4bb749') => `<div style="display: flex; align-items: center; gap: 9px;"><span style="display: block; width: 3px; height: 12px; transform: skewX(-13deg); background: ${tick};"></span><span style="${MONO} font-size: 10.5px; letter-spacing: 0.2em; text-transform: uppercase; color: #9793B4;">${t}</span></div>`;
const gfxRow = (thumb, title, sub) => `<div style="display: flex; align-items: center; gap: 12px; background: #0a0814; border: 1px solid #2e2750; border-radius: 12px; padding: 10px 12px 10px 10px;">
        ${thumb}
        <div style="flex: 1; min-width: 0;"><div style="font-weight: 800; font-size: 14px;">${title}</div><div style="${MONO} font-size: 10.5px; color: #9793B4; margin-top: 3px;">${sub}</div></div>
        <button style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: transparent; border: 1px solid #2e2750; border-radius: 10px; color: #EAE9F2; cursor: pointer;">${dlIcon}</button>
      </div>`;
const thumbPortrait = `<div style="width: 44px; height: 55px; flex: none; background: #171328; border: 1px solid #2e2750; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;"><div style="width: 20px; height: 20px; border-radius: 50%; background: #6d5fe0;"></div><div style="width: 24px; height: 3px; background: #EAE9F2;"></div></div>`;
const thumbStory = `<div style="width: 31px; height: 55px; flex: none; margin: 0 6px; background: #171328; border: 1px solid #2e2750; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;"><div style="width: 16px; height: 16px; border-radius: 50%; background: #6d5fe0;"></div><div style="width: 18px; height: 3px; background: #EAE9F2;"></div></div>`;
const thumbBlock = (fill) => `<div style="width: 44px; height: 55px; flex: none; background: #171328; border: 1px solid #2e2750; border-radius: 6px; display: flex; align-items: center; justify-content: center;">${mark(18, fill)}</div>`;

const main = HEAD() + `
<div style="width: 390px; min-height: 1820px; background: #0E0C1A; padding: 20px 20px 28px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">

  <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
    <div style="display: flex; align-items: center; gap: 10px;">${mark(30)}<span style="font-weight: 800; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">A&amp;R Team</span></div>
    <div style="${MONO} font-size: 11px; color: #9793B4; border: 1px solid #2e2750; border-radius: 999px; padding: 5px 11px; white-space: nowrap;">Jordan Reyes · <b style="color: #EAE9F2;">12,480</b> pts</div>
  </div>

  <div style="display: flex; flex-direction: column; gap: 8px;">
    <h1 style="margin: 0; font-weight: 900; font-size: 30px; letter-spacing: -0.04em; line-height: 1.05;">Earn bonus points</h1>
    <p style="margin: 0; font-size: 14.5px; line-height: 1.5; color: #9793B4;">Two ways to earn on top of your daily play. Each has its own link.</p>
  </div>

  <div style="display: flex; flex-direction: column; gap: 10px;">
    ${sectionHead('Your links')}
    <div style="font-size: 12.5px; font-weight: 600;">Join the A&amp;R Team</div>
    ${linkRow('anr.makinitmag.com/?ref=JR7K2')}
    <div style="font-size: 12.5px; font-weight: 600; margin-top: 4px;">Submit music</div>
    ${linkRow('makinitmag.com/review?ref=u_8f3k2q')}
    <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #9793B4;">Anyone who joins or submits through your link counts as yours.</p>
  </div>

  <div style="background: #171328; border: 1px solid #2e2750; border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 14px;">
    ${sectionHead('Refer an A&amp;R')}
    <h2 style="margin: 0; font-weight: 800; font-size: 20px; letter-spacing: -0.03em; line-height: 1.15;">Refer someone new and earn up to 240 points.</h2>
    <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #9793B4;">Earn bonus points for helping grow the A&amp;R Team. You earn 1 point for every round your referral comes within 1.5 of the average, for their first 30 days.</p>
    <div style="display: flex; gap: 10px;">${stat('Referred', '3')}${stat('Active', '2')}${stat('Earned', '+161', '#4bb749')}</div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center; ${MONO} font-size: 12px;"><span>Dana M.</span><span style="color: #9793B4;">day 9 of 30 · <b style="color: #EAE9F2;">+71</b></span></div>
      <div style="display: flex; justify-content: space-between; align-items: center; ${MONO} font-size: 12px;"><span>Chris O.</span><span style="color: #9793B4;">day 22 of 30 · <b style="color: #EAE9F2;">+90</b></span></div>
      <div style="display: flex; justify-content: space-between; align-items: center; ${MONO} font-size: 12px;"><span>Sam T.</span><span style="color: #9793B4;">joined, not yet played</span></div>
    </div>
  </div>

  <div style="background: #171328; border: 1px solid #2e2750; border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 14px;">
    ${sectionHead('Refer an artist')}
    <h2 style="margin: 0; font-weight: 800; font-size: 20px; letter-spacing: -0.03em; line-height: 1.15;">Refer artists to submit their music.</h2>
    <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #9793B4;">Earn bonus points by discovering new talent. You earn points based on the referred artist's score: 5 times the average. A 7.1 earns 36 points.</p>
    <div style="display: flex; align-items: center; gap: 9px; background: rgba(245,197,24,.08); border: 1px solid #F5C518; border-radius: 11px; padding: 10px 12px; font-size: 13px; line-height: 1.45;"><span style="display: block; width: 3px; height: 12px; transform: skewX(-13deg); background: #F5C518; flex: none;"></span><span>Every artist who submits is entered in the <b style="${MONO} color: #F5C518;">$1,000 Giveaway</b> for a $1,000 Promo Budget.</span></div>
    <div style="display: flex; gap: 10px;">${stat('Submitted', '4')}${stat('Rated', '3')}${stat('Earned', '+97', '#4bb749')}</div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center; ${MONO} font-size: 12px;"><span>Nia Cole · Late Bus</span><span style="color: #9793B4;">7.4 · <b style="color: #EAE9F2;">+37</b></span></div>
      <div style="display: flex; justify-content: space-between; align-items: center; ${MONO} font-size: 12px;"><span>KP · Overtime</span><span style="color: #9793B4;">6.2 · <b style="color: #EAE9F2;">+31</b></span></div>
      <div style="display: flex; justify-content: space-between; align-items: center; ${MONO} font-size: 12px;"><span>Rell · Sideways</span><span style="color: #9793B4;">submitted, not yet rated</span></div>
    </div>
  </div>

  <div style="display: flex; flex-direction: column; gap: 10px;">
    ${sectionHead('Your graphics', '#6d5fe0')}
    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9793B4;">Each one carries your link as a QR code. Your card and story carry both. Post it, put the link in your bio, or send the link by DM.</p>
    ${gfxRow(thumbPortrait, 'Your A&amp;R Team card', 'Portrait · 1080 × 1350')}
    ${gfxRow(thumbStory, 'Your A&amp;R Team story', 'Story · 1080 × 1920')}
    ${gfxRow(thumbBlock('#4bb749'), 'Join the A&amp;R Team', 'Portrait · 1080 × 1350')}
    ${gfxRow(thumbBlock('#6d5fe0'), 'Submit your music', 'Portrait · 1080 × 1350')}
    <div style="background: #0a0814; border: 1px solid #2e2750; border-radius: 12px; padding: 11px 13px; font-size: 13px; color: #9793B4; line-height: 1.5;">Your card uses your profile photo. <a href="#">Add a photo</a> to use your face on it.</div>
  </div>

  <div style="display: flex; align-items: center; justify-content: center; gap: 9px; padding-top: 4px;"><span style="${MONO} font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #9793B4;">Brought to you by</span><img src="makinit-logo-white.png" style="height: 13px; width: auto; opacity: 0.75;" alt="Makin' It"></div>
</div>
` + FOOT;

// ---------- Graphics ----------
const face = (d) => `<div style="width: ${d}px; height: ${d}px; border-radius: 50%; background: #221b3a; border: ${Math.round(d * .02)}px solid #6d5fe0; display: flex; align-items: center; justify-content: center; flex: none;"><span style="font-weight: 800; font-size: ${Math.round(d * .32)}px; letter-spacing: -0.04em; color: #6d5fe0;">JR</span></div>`;
const endorse = (h) => `<div style="display: flex; align-items: center; gap: ${h}px;"><span style="${MONO} font-size: ${Math.round(h * 1.1)}px; letter-spacing: 0.15em; text-transform: uppercase; color: #9793B4;">Brought to you by</span><img src="makinit-logo-white.png" style="height: ${h}px; width: auto;" alt="Makin' It"></div>`;
const qrOne = (size, label) => `<div style="display: flex; flex-direction: column; gap: 18px; flex: 1;">
    <div style="padding: 16px; background: #EAE9F2; align-self: flex-start;">${qr(size, '#0E0C1A', '#EAE9F2')}</div>
    <div style="${MONO} font-size: 28px; line-height: 1.3; color: #EAE9F2;">${label}</div>
  </div>`;
const qrPanel = (size) => `<div style="display: flex; flex-direction: column; gap: 28px;">
    <div style="display: flex; gap: 40px;">${qrOne(size, 'Join the A&amp;R Team')}${qrOne(size, 'Submit your music')}</div>
    <div style="${MONO} font-size: 26px; color: #9793B4;">or DM me for the links</div>
  </div>`;

// A&R Team card (portrait 1080x1350). Cut: green field top-left, ink below, along the 13° line.
const personCard = (W, H, big) => HEAD() + `
<div style="position: relative; width: ${W}px; height: ${H}px; background: #0E0C1A; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; padding: 72px 80px; box-sizing: border-box;">
  <div style="position: absolute; left: -200px; top: -${Math.round(H * .18)}px; width: ${W + 400}px; height: ${Math.round(H * .42)}px; background: #4bb749; transform: skewY(-13deg); transform-origin: left top;"></div>

  <div style="position: relative; display: flex; align-items: center; justify-content: space-between;">
    ${lockup(84, 'Team', '#0E0C1A', '#4bb749')}
  </div>

  <div style="position: relative; display: flex; flex-direction: column; gap: ${big ? 44 : 18}px;">
    ${face(big ? 500 : 300)}
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div style="font-weight: 900; font-size: ${big ? 118 : 88}px; letter-spacing: -0.04em; line-height: 0.92;">Jordan<br>Reyes</div>
      <div style="${MONO} font-size: 30px; letter-spacing: 0.2em; text-transform: uppercase; color: #4bb749; margin-top: 10px;">Official A&amp;R · The A&amp;R Team</div>
      <div style="${MONO} font-size: 26px; color: #9793B4;">Producer · Atlanta, GA</div>
    </div>
    <div style="font-weight: 600; font-size: ${big ? 40 : 34}px; line-height: 1.25; letter-spacing: -0.02em; max-width: 880px;">I rate new records every day and help choose which artists get covered and who wins the <span style="color: #F5C518;">$1,000 Promo Budget</span>.</div>
  </div>

  <div style="position: relative; display: flex; flex-direction: column; gap: 28px;">
    <div style="height: 2px; background: #2e2750; transform: skewX(-13deg);"></div>
    ${qrPanel(big ? 240 : 176)}
    ${endorse(22)}
  </div>
</div>
` + FOOT;

const cta = (title, sub, fill, dark, money) => HEAD() + `
<div style="position: relative; width: 1080px; height: 1350px; background: #0E0C1A; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; padding: 72px 80px; box-sizing: border-box;">
  <div style="position: absolute; left: -200px; bottom: -620px; width: 1480px; height: 800px; background: ${fill}; transform: skewY(-13deg); transform-origin: left bottom;"></div>

  <div style="position: relative; display: flex; align-items: center; justify-content: space-between;">
    ${lockup(84, 'Team', fill)}
    ${endorse(22)}
  </div>

  <div style="position: relative; display: flex; flex-direction: column; gap: 28px;">
    ${money ? `<div style="display: flex; align-items: center; gap: 18px;"><span style="display: block; width: 6px; height: 34px; transform: skewX(-13deg); background: #F5C518;"></span><span style="${MONO} font-size: 40px; font-weight: 700; letter-spacing: 0.06em; color: #F5C518;">${money}</span></div>` : ''}
    <div style="font-weight: 900; font-size: 128px; letter-spacing: -0.04em; line-height: 0.92;">${title}</div>
    <div style="font-weight: 600; font-size: 38px; line-height: 1.3; letter-spacing: -0.02em; color: #9793B4; max-width: 880px;">${sub}</div>
  </div>

  <div style="position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 40px;">
    <div style="display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px;"><div style="${MONO} font-size: 30px; line-height: 1.3; color: ${dark};">Scan the code</div><div style="${MONO} font-size: 26px; color: ${dark}; opacity: 0.75;">or DM me for the link</div></div>
    <div style="padding: 20px; background: #EAE9F2; flex: none;">${qr(240, '#0E0C1A', '#EAE9F2')}</div>
  </div>
</div>
` + FOOT;

fs.writeFileSync('Main.dc.html', main);
fs.writeFileSync('Portrait.dc.html', personCard(1080, 1350, false));
fs.writeFileSync('Story.dc.html', personCard(1080, 1920, true));
fs.writeFileSync('JoinTeam.dc.html', cta('Join the<br>A&amp;R Team.', 'Become an official A&amp;R. Rate new records every day and help choose which artists get covered and who wins the $1,000 Promo Budget.', '#4bb749', '#0E0C1A', '$1,000 GIVEAWAY'));
fs.writeFileSync('SubmitMusic.dc.html', cta('Submit<br>your music.', 'Get your record rated by the A&amp;R Team, get a full report on what they heard, and enter the $1,000 Giveaway for a $1,000 Promo Budget.', '#6d5fe0', '#EAE9F2', '$1,000 GIVEAWAY'));

fs.writeFileSync('canvas.json', JSON.stringify({
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: 390, h: 1820, title: 'Refer page (/refer)', expand: 'fit' },
    { file: 'Portrait.dc.html', x: 520, y: 0, w: 1080, h: 1350, title: 'A&R Team card · 1080×1350' },
    { file: 'Story.dc.html', x: 1720, y: 0, w: 1080, h: 1920, title: 'A&R Team story · 1080×1920' },
    { file: 'JoinTeam.dc.html', x: 2920, y: 0, w: 1080, h: 1350, title: 'Join the A&R Team · 1080×1350' },
    { file: 'SubmitMusic.dc.html', x: 4120, y: 0, w: 1080, h: 1350, title: 'Submit your music · 1080×1350' },
  ],
  annotations: [
    { id: 'numbers', x: 0, y: -260, w: 380, text: 'Numbers shown are samples. Rules as drafted: A&R referral = 1 pt per round the referral lands within 1.5 of the average, first 30 days, cap 240. Artist referral = 5 x the average, rounded.' },
    { id: 'one-link', x: 520, y: -200, w: 420, text: 'Two links per A&R: join = anr.makinitmag.com/?ref=CODE, submit = makinitmag.com/review?ref=<user uid>. The card and story carry both QRs; the Join and Submit graphics carry one each.' },
    { id: 'photo', x: 1720, y: -200, w: 380, text: 'The face is the profile photo. The initials block is the fallback when there is none; the page asks them to add one.' },
  ],
  launch: { view: 'canvas' },
}, null, 2));
console.log('written');
