'use strict';
// The SMS→MMS switch (operator, 2026-09-20): emoji or > 160 characters goes as MMS.
const assert = require('assert');
const { isGsm7, smsSegments, shouldSendAsMms, sendSms, mmsMediaUrl } = require('./sms');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' ' + detail : '')); }
}

(async () => {
  console.log('\n— sms: what forces UCS-2 —');
  ok('plain ASCII is GSM-7', isGsm7('Your record has been rated. Reply STOP to opt out.'));
  ok('the extension table is still GSM-7', isGsm7('[A&R] {room} ~ ^ | \\ €'));
  ok('an emoji leaves GSM-7', !isGsm7('🎧 Test'));
  ok('an em dash leaves GSM-7', !isGsm7('The A&R Room — live'));
  ok('curly quotes leave GSM-7', !isGsm7('“rated”'));

  console.log('\n— sms: segments as a carrier bills them —');
  ok('160 plain characters is one segment', smsSegments('a'.repeat(160)).segments === 1);
  ok('161 plain characters is two segments', smsSegments('a'.repeat(161)).segments === 2);
  ok('an extension character costs two septets', smsSegments('a'.repeat(159) + '€').segments === 2);
  const one = smsSegments('🎧 Test from The A&R Room — your SMS setup is working! Reply STOP to opt out.');
  ok('one emoji makes a 75-character text UCS-2 and two segments', one.encoding === 'ucs2' && one.segments === 2, JSON.stringify(one));
  ok('70 UCS-2 units is one segment, 71 is two', smsSegments('—' + 'a'.repeat(69)).segments === 1 && smsSegments('—' + 'a'.repeat(70)).segments === 2);
  ok('an empty body has no segments', smsSegments('').segments === 0);

  console.log('\n— sms: the operator\'s rule —');
  ok('a short plain text stays SMS', !shouldSendAsMms('The A&R Meeting: "Song" has been rated. Your Track Report is in your email. Reply STOP to opt out.'));
  ok('exactly 160 plain characters stays SMS', !shouldSendAsMms('a'.repeat(160)));
  ok('161 plain characters goes MMS', shouldSendAsMms('a'.repeat(161)));
  ok('an emoji goes MMS whatever the length', shouldSendAsMms('🎧 Live now'));
  ok('an em dash goes MMS too (it splits the text the same way an emoji does)', shouldSendAsMms('A&R Room — live'));
  ok('160 characters counts an emoji as one character, not two', shouldSendAsMms('🎧' + 'a'.repeat(159)) && [...('🎧' + 'a'.repeat(159))].length === 160);
  process.env.SMS_MMS_AUTO = '0';
  ok('SMS_MMS_AUTO=0 turns the switch off', !shouldSendAsMms('🎧 ' + 'a'.repeat(300)));
  delete process.env.SMS_MMS_AUTO;

  console.log('\n— sms: the media that makes Twilio send MMS —');
  ok('defaults to the site mark on the production host', mmsMediaUrl() === 'https://anr.makinitmag.com/mark-color.png', mmsMediaUrl());
  process.env.PUBLIC_BASE_URL = 'https://preview.example/';
  ok('follows PUBLIC_BASE_URL', mmsMediaUrl() === 'https://preview.example/mark-color.png', mmsMediaUrl());
  process.env.SMS_MMS_MEDIA_URL = 'https://cdn.example/m.png';
  ok('SMS_MMS_MEDIA_URL overrides it', mmsMediaUrl() === 'https://cdn.example/m.png');
  delete process.env.SMS_MMS_MEDIA_URL; delete process.env.PUBLIC_BASE_URL;

  console.log('\n— sms: the send reports which channel it used —');
  const a = await sendSms('305-555-1234', 'Plain text.');
  const b = await sendSms('305-555-1234', '🎧 Emoji text.');
  ok('console provider: plain → sms', a.ok && a.channel === 'sms', JSON.stringify(a));
  ok('console provider: emoji → mms', b.ok && b.channel === 'mms', JSON.stringify(b));
  const none = await sendSms('', 'x');
  ok('no destination still fails cleanly', none.ok === false);
  await wireCheck();
})();

// ---- Twilio wire check: MediaUrl rides an MMS and nothing else, in a child with the real provider set ----
async function wireCheck() {
  const http = require('http'); const { execFile } = require('child_process');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { seen.push(new URLSearchParams(b)); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"sid":"SM1"}'); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  // execFile, not spawnSync: a blocking spawn would freeze this process's event loop, and
  // the mock Twilio above lives on it — the child would wait on a server that never answers.
  const child = await new Promise((resolve) => execFile(process.execPath, ['-e', `
    const { sendSms } = require('./sms');
    (async () => {
      const a = await sendSms('+13055551234', 'Plain text.');
      const b = await sendSms('+13055551234', '🎧 Emoji text.');
      const c = await sendSms('+13055551234', 'a'.repeat(161));
      process.stdout.write(JSON.stringify([a, b, c]));
    })();`], { cwd: __dirname, timeout: 20000, env: { ...process.env, SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550000000', TWILIO_API_BASE: base, PUBLIC_BASE_URL: 'https://anr.makinitmag.com' }, encoding: 'utf8' },
    (err, stdout, stderr) => resolve({ stdout: stdout || '', stderr: (stderr || '') + (err ? String(err.message) : '') })));
  srv.close();
  let out = null; try { out = JSON.parse(child.stdout); } catch (e) { /* reported below */ }
  console.log('\n— sms: what actually reaches Twilio —');
  ok('three sends reached the mock Twilio', seen.length === 3 && Array.isArray(out) && out.every(r => r.ok), (child.stderr || '') + child.stdout);
  if (seen.length === 3) {
    ok('a plain text carries no MediaUrl (SMS)', !seen[0].has('MediaUrl') && out[0].channel === 'sms');
    ok('an emoji text carries the mark as MediaUrl (MMS)', seen[1].get('MediaUrl') === 'https://anr.makinitmag.com/mark-color.png' && out[1].channel === 'mms', seen[1].get('MediaUrl'));
    ok('a 161-character text carries MediaUrl (MMS)', seen[2].has('MediaUrl') && out[2].channel === 'mms');
    ok('the body is unchanged either way', seen[1].get('Body') === '🎧 Emoji text.' && seen[0].get('From') === '+15550000000');
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
