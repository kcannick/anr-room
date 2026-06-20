'use strict';
// Email sender abstraction. Pick provider with EMAIL_PROVIDER:
//   console  (default) -> prints the code to the server log + returns it for on-screen fallback
//   resend             -> needs RESEND_API_KEY, EMAIL_FROM
//   mandrill           -> needs MANDRILL_API_KEY, EMAIL_FROM  (Mailchimp Transactional)
//
// Every provider returns { ok, devCode? }. devCode is only populated in console
// mode (or when a real send fails) so the admin screen can still read the code aloud.

const PROVIDER = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
const FROM = process.env.EMAIL_FROM || 'RoomTone <onboarding@resend.dev>';

function bodyText(code, sessionName) {
  return `Your code for ${sessionName} is ${code}\n\nIt expires in 10 minutes.`;
}
function bodyHtml(code, sessionName) {
  return `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5">
    <p>Your code to join <strong>${escapeHtml(sessionName)}</strong>:</p>
    <p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:12px 0">${code}</p>
    <p style="color:#666">Expires in 10 minutes. If you didn't request this, ignore it.</p>
  </div>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function sendViaResend(to, subject, html, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}

async function sendViaMandrill(to, subject, html, text) {
  const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: process.env.MANDRILL_API_KEY,
      message: {
        from_email: (FROM.match(/<(.+)>/) || [null, FROM])[1],
        from_name: (FROM.match(/^(.*?)</) || [null, 'The A&R Room'])[1].trim(),
        to: [{ email: to, type: 'to' }],
        subject, html, text,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (Array.isArray(data) && data[0] && data[0].status === 'rejected')) {
    throw new Error(`Mandrill error: ${JSON.stringify(data)}`);
  }
  return true;
}

async function sendOtp(to, code, sessionName) {
  const subject = `${code} is your code for ${sessionName}`;
  const html = bodyHtml(code, sessionName);
  const text = bodyText(code, sessionName);

  if (PROVIDER === 'console') {
    console.log(`\n[OTP] ${to} -> ${code}  (session: ${sessionName})\n`);
    return { ok: true, devCode: code };
  }
  try {
    if (PROVIDER === 'resend') await sendViaResend(to, subject, html, text);
    else if (PROVIDER === 'mandrill') await sendViaMandrill(to, subject, html, text);
    else throw new Error(`Unknown EMAIL_PROVIDER: ${PROVIDER}`);
    console.log(`[OTP] sent to ${to} via ${PROVIDER}`);
    return { ok: true };
  } catch (e) {
    // Never let a failed send block the event — surface the code to the admin log
    // and to the API caller so the admin screen can show it.
    console.error(`[OTP] send failed via ${PROVIDER}: ${e.message}. Falling back to on-screen code.`);
    console.log(`\n[OTP-FALLBACK] ${to} -> ${code}\n`);
    return { ok: true, devCode: code, fallback: true };
  }
}

module.exports = { sendOtp, PROVIDER };
