'use strict';
// Seed a local dev server with an A&R Wars tournament for console/landing checks.
// Usage: PORT=3998 SQLITE_PATH=./dev-tn.db EMAIL_PROVIDER=console node server.js &
//        node scripts/dev-seed-tournament.js 3998
// Prints the admin auth token to paste into localStorage (rt_auth_token) for /admin.
const base = 'http://localhost:' + (process.argv[2] || 3998);
async function call(path, body, method = 'POST', headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}
(async () => {
  const rq = await call('/api/auth/request', { email: 'admin@local.test' });
  const v = await call('/api/auth/verify', { email: 'admin@local.test', code: rq.d.devCode, name: 'Local Admin' });
  const H = { 'X-Auth-Token': v.d.token };
  const sess = await call('/api/session', { name: 'A&R Wars #1 · Oct 25', pollType: 'binary', scheduledAt: Date.now() + 7 * 86400000 }, 'POST', H);
  const pack = await call('/api/admin/sidebet', { name: 'A&R Service Pack 12', picksRequired: 18, prizeText: '$150', warsAt: Date.now() + 7 * 86400000, closesAt: Date.now() + 6 * 86400000, status: 'draft', sessionId: sess.d.sessionId }, 'POST', H);
  const songs = Array.from({ length: 24 }, (_, i) => ({ title: ['Late Nights', 'Paper Planes', 'Glass House', 'Two Doors', 'Cold Water', 'Neon', 'Half Moon', 'Static'][i % 8] + (i >= 8 ? ' ' + (Math.floor(i / 8) + 1) : ''), artist: ['Ty Rivers', 'Ivy Mae', 'Noor Adeyemi', 'Kenji Park', 'Sol Reyes', 'Mara K', 'Dez', 'Lune'][i % 8] }));
  await call('/api/admin/sidebet/songs', { packId: pack.d.id, songs }, 'POST', H);
  const t = await call('/api/admin/tournament', { kind: 'ar', number: 1, eventLocal: '2026-10-25T19:00', sessionId: sess.d.sessionId, packId: pack.d.id, watchUrl: 'https://www.youtube.com/@makinitmag/live' }, 'POST', H);
  const people = [['Marcus Hale', 'marcushale', 'Atlanta, GA', 12], ['Dana Okafor', 'dana.okafor', 'Houston, TX', 32], ['Jalen Brooks', 'jalenbrooks', 'Chicago, IL', 5], ['Priya Natarajan', 'priya.n', 'Newark, NJ', 47], ['Terrence Mills', 'tmills', 'Memphis, TN', 15], ['Keisha Lang', 'keishalang', 'Charlotte, NC', null], ['Andre Villanueva', '', 'Miami, FL', 56]];
  for (const [i, [name, handle, city, img]] of people.entries()) {
    await call('/api/admin/tournament/competitor', { tournamentId: t.d.id, name, handle, city, photoUrl: img ? `https://i.pravatar.cc/300?img=${img}` : '', qualifiedLabel: `Week ${i + 1}` }, 'POST', H);
  }
  console.log('seeded tournament', t.d.id, 'session', sess.d.sessionId, 'pack', pack.d.id);
  console.log('ADMIN TOKEN', v.d.token);
})().catch(e => { console.error(e); process.exit(1); });
