#!/usr/bin/env node
// Render the A&R Wars Satori set with placeholder data, for eyeballing against the Chrome
// mockups in public/brand/wars/preview/. Writes public/brand/wars/preview/satori-*.png.
//   node scripts/render-tournament-samples.js
// Photos are pravatar stand-ins fetched into data URIs; offline they fall back to null (the
// silhouette), which is also what production does when a profile photo cannot be fetched.
// Every competitor here is invented (the same placeholders as the mockups' DATA block).
const fs = require('fs');
const path = require('path');
const { renderPng, TOURNAMENT_SIZES } = require('../share-cards');

const OUT = path.join(__dirname, '..', 'public', 'brand', 'wars', 'preview');
const PEOPLE = [
  { seed: 1, name: 'Taliyah Rae',    handle: 'taliyahrae',      city: 'Atlanta, GA',     img: 47 },
  { seed: 2, name: 'Marcus Lane',    handle: 'marcuslanemusic', city: 'Houston, TX',     img: 12 },
  { seed: 3, name: 'Deja Simone',    handle: 'dejasimone',      city: 'Chicago, IL',     img: 32 },
  { seed: 4, name: 'Bryce Holloway', handle: null,              city: 'Charlotte, NC',   img: 52 },
  { seed: 5, name: 'Nia Monroe',     handle: 'niamonroe',       city: 'Memphis, TN',     img: 25 },
  { seed: 6, name: 'Andre Mitchell', handle: 'andremitchell',   city: 'Detroit, MI',     img: 60 },
  { seed: 7, name: 'Kiana Ross',     handle: 'kianarossmusic',  city: 'Los Angeles, CA', img: 44 },
  { seed: 8, name: 'Jordyn Price',   handle: 'jordynprice',     city: 'Brooklyn, NY',    img: 16 },
];
const EVENT = { lockupWord: 'WARS', eyebrow: 'A&R Wars #1', dateLabel: 'Sunday, October 25', timeLabel: '7:00 PM ET',
  prizeAmount: '$500', prizeLabel: 'Cash Prize',
  premise: '8 A&Rs play the songs they scouted. You vote on every matchup. The winner takes the cash prize.' };
const URL = 'makinitmag.com/ANR';

async function fetchPhoto(img) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://i.pravatar.cc/300?img=${img}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return 'data:' + (r.headers.get('content-type') || 'image/jpeg') + ';base64,' + buf.toString('base64');
  } catch (e) {
    return null;
  }
}

// The promo set at a stage. `filled` seats are in qualifying order; `big` is that week's
// qualifier (seat), the question mark (final) or the winner (champion).
function promoData(stage, filled, winnerSeat) {
  const seats = PEOPLE.map((p, i) => {
    const n = i + 1, isFilled = n <= filled;
    const ring = stage === 'champion' ? (n === winnerSeat ? 'champion' : null) : stage === 'seat' ? (n === filled ? 'qualifier' : null) : null;
    return { n, name: isFilled ? p.name : null, photo: isFilled ? p.photo : null, filled: isFilled, ring };
  });
  let big = null, headline, cta;
  if (stage === 'seat') {
    const p = PEOPLE[filled - 1];
    big = { name: p.name, handle: p.handle, photo: p.photo, tag: 'Qualified · Week ' + filled };
    headline = p.name + ' qualified.';
    cta = { label: 'Watch live at', url: URL };
  } else if (stage === 'final') {
    headline = 'Who has the Best Ear?';
    cta = { label: 'Vote live at', url: URL };
  } else {
    const p = PEOPLE[winnerSeat - 1];
    big = { name: p.name, handle: p.handle, photo: p.photo, tag: 'Champion' };
    headline = p.name + ' wins ' + EVENT.prizeAmount + '.';
    cta = { label: 'Watch the replay', url: URL };
  }
  return { ...EVENT, stage, headline, big, seats, cta };
}

// The bracket: seeds pair 1v8, 4v5, 3v6, 2v7; the sample results are the mockup's.
function bracketData(stage) {
  const bySeed = s => { const p = PEOPLE[s - 1]; return { name: p.name, seed: p.seed, sub: p.handle ? '@' + p.handle : p.city, photo: p.photo }; };
  const pairs = [[1, 8], [4, 5], [3, 6], [2, 7]];
  const r1w = { field: [], final4: [1, 5, 3, 7], final2: [1, 5, 3, 7], champion: [1, 5, 3, 7] }[stage];
  const r2w = { field: [], final4: [], final2: [5, 3], champion: [5, 3] }[stage];
  const winner = stage === 'champion' ? 3 : null;
  const r1 = pairs.map(([a, b], i) => ({ a: bySeed(a), b: bySeed(b), winner: r1w.length ? (r1w[i] === a ? 'a' : 'b') : null }));
  const r2 = [0, 1].map(i => {
    const a = r1w[2 * i] ? bySeed(r1w[2 * i]) : null, b = r1w[2 * i + 1] ? bySeed(r1w[2 * i + 1]) : null;
    return { a, b, winner: r2w.length ? (r2w[i] === (a && a.seed) ? 'a' : 'b') : null };
  });
  const final = { a: r2w[0] ? bySeed(r2w[0]) : null, b: r2w[1] ? bySeed(r2w[1]) : null, winner: winner ? (winner === r2w[0] ? 'a' : 'b') : null };
  const champion = winner ? { name: PEOPLE[winner - 1].name, photo: PEOPLE[winner - 1].photo } : null;
  return { lockupWord: EVENT.lockupWord, eyebrow: EVENT.eyebrow, dateLabel: EVENT.dateLabel, timeLabel: EVENT.timeLabel,
    prizeAmount: EVENT.prizeAmount, prizeLabel: EVENT.prizeLabel, r1, r2, final, champion,
    cta: { label: winner ? 'Watch the replay' : 'Vote live', url: URL } };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const photos = await Promise.all(PEOPLE.map(p => fetchPhoto(p.img)));
  const online = photos.some(Boolean);
  PEOPLE.forEach((p, i) => { p.photo = photos[i]; });
  // one seat deliberately without a photo (seat 2) and one without a handle (seat 4, Bryce)
  if (online) PEOPLE[1].photo = null;
  console.log(online ? 'photos: pravatar fetched (seat 2 left without one on purpose)' : 'photos: OFFLINE, every slot renders the silhouette');

  const jobs = [];
  for (const [kind, type] of [['feed', 'tournamentFeed'], ['story', 'tournamentStory'], ['thumb', 'tournamentThumb']]) {
    jobs.push([`satori-${kind}-seat4`, type, promoData('seat', 4)]);
    jobs.push([`satori-${kind}-final`, type, promoData('final', 8)]);
    jobs.push([`satori-${kind}-champion`, type, promoData('champion', 8, 3)]);
  }
  for (const stage of ['field', 'final4', 'champion']) jobs.push([`satori-bracket-${stage}`, 'tournamentBracket', bracketData(stage)]);

  for (const [name, type, data] of jobs) {
    const t0 = Date.now();
    const png = await renderPng(type, data);
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, png);
    console.log(`${name}.png  ${TOURNAMENT_SIZES[type].join('x')}  ${(png.length / 1024).toFixed(0)}KB  ${Date.now() - t0}ms`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
