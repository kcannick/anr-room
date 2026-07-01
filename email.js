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

// ----- generic transactional send (used by go-live notifications) -----
// Returns { ok } or { ok:false, error }. Non-fatal by contract — callers log + continue.
async function sendEmail(to, subject, html, text) {
  if (PROVIDER === 'console') {
    console.log(`\n[EMAIL] ${to} :: ${subject}\n`);
    return { ok: true };
  }
  try {
    if (PROVIDER === 'resend') await sendViaResend(to, subject, html, text);
    else if (PROVIDER === 'mandrill') await sendViaMandrill(to, subject, html, text);
    else throw new Error(`Unknown EMAIL_PROVIDER: ${PROVIDER}`);
    return { ok: true };
  } catch (e) {
    console.error(`[EMAIL] send failed via ${PROVIDER}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendOtp, PROVIDER, sendFeedback, sendEmail, escapeHtml };

// ----- feedback email (best-effort; optional screenshot attachment) -----
// payload: { message, sessionName, sessionId, fromName, fromEmail, userAgent,
//            image: { dataBase64, mime, filename } | null }
// Returns { ok } or { ok:false, error }. Callers must treat failure as non-fatal.
async function sendFeedback(to, payload) {
  const {
    message = '', sessionName = '', sessionId = '', fromName = '', fromEmail = '',
    userAgent = '', image = null,
  } = payload || {};
  const subject = `A&R Room feedback${sessionName ? ` — ${sessionName}` : ''}`;
  const lines = [
    message,
    '',
    '— context —',
    sessionName ? `Session: ${sessionName} (${sessionId})` : `Session: ${sessionId || 'n/a'}`,
    fromName || fromEmail ? `From: ${fromName || ''} ${fromEmail ? `<${fromEmail}>` : ''}`.trim() : 'From: anonymous',
    userAgent ? `Device: ${userAgent}` : '',
  ].filter(Boolean);
  const text = lines.join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
    <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
    <p style="color:#666;font-size:13px;margin:0">
      <strong>Session:</strong> ${escapeHtml(sessionName || 'n/a')} ${sessionId ? `(${escapeHtml(sessionId)})` : ''}<br>
      <strong>From:</strong> ${escapeHtml(fromName || 'anonymous')} ${fromEmail ? `&lt;${escapeHtml(fromEmail)}&gt;` : ''}<br>
      ${userAgent ? `<strong>Device:</strong> ${escapeHtml(userAgent)}` : ''}
    </p>
  </div>`;

  if (PROVIDER === 'console') {
    console.log(`\n[FEEDBACK] to ${to}${image ? ' (with screenshot)' : ''}\n${text}\n`);
    return { ok: true, devLogged: true };
  }
  try {
    if (PROVIDER === 'resend') {
      const body = { from: FROM, to: [to], subject, html, text };
      if (image && image.dataBase64) {
        body.attachments = [{ filename: image.filename || 'screenshot.png', content: image.dataBase64 }];
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    } else if (PROVIDER === 'mandrill') {
      const msg = {
        from_email: (FROM.match(/<(.+)>/) || [null, FROM])[1],
        from_name: (FROM.match(/^(.*?)</) || [null, 'The A&R Room'])[1].trim(),
        to: [{ email: to, type: 'to' }], subject, html, text,
      };
      if (image && image.dataBase64) {
        msg.attachments = [{ type: image.mime || 'image/png', name: image.filename || 'screenshot.png', content: image.dataBase64 }];
      }
      const res = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: process.env.MANDRILL_API_KEY, message: msg }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (Array.isArray(data) && data[0] && data[0].status === 'rejected')) {
        throw new Error(`Mandrill error: ${JSON.stringify(data)}`);
      }
    } else {
      throw new Error(`Unknown EMAIL_PROVIDER: ${PROVIDER}`);
    }
    console.log(`[FEEDBACK] emailed to ${to} via ${PROVIDER}`);
    return { ok: true };
  } catch (e) {
    console.error(`[FEEDBACK] email failed via ${PROVIDER}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
