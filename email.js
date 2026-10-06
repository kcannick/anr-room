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

// ----- per-send options (2026-10-06) -----
// opts.tag          one word naming the STREAM (daily_open, digest_daily, otp, ...). Goes to the
//                   provider as a tag, so its own reporting can split opens by stream — the
//                   October audit had to join on subject lines because nothing was tagged.
// opts.unsubscribe  a URL that unsubscribes with ONE POST and no page. Sent as the
//                   List-Unsubscribe / List-Unsubscribe-Post headers Gmail and Yahoo require of
//                   bulk senders; the inbox shows its own Unsubscribe button and the complaint
//                   never becomes a spam report. Transactional mail (codes, artist reports)
//                   passes none.
function sendHeaders(opts) {
  const h = {};
  if (opts && opts.unsubscribe) {
    h['List-Unsubscribe'] = `<${opts.unsubscribe}>`;
    h['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  return h;
}
const TAG_RE = /^[a-z0-9_-]{1,50}$/;

async function sendViaResend(to, subject, html, text, opts = {}) {
  const body = { from: FROM, to: [to], subject, html, text };
  const headers = sendHeaders(opts);
  if (Object.keys(headers).length) body.headers = headers;
  if (opts.tag && TAG_RE.test(opts.tag)) body.tags = [{ name: 'stream', value: opts.tag }];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}

// Mandrill answers a send with the address's fate: `rejected` + reject_reason when the
// address is on its rejection list (hard-bounce, spam, unsub, invalid ...). That reason is
// the only bounce signal this app gets (no webhook), so it rides the thrown error as
// `.reject` for sendEmail to hand back.
async function sendViaMandrill(to, subject, html, text, opts = {}) {
  const message = {
    from_email: (FROM.match(/<(.+)>/) || [null, FROM])[1],
    from_name: (FROM.match(/^(.*?)</) || [null, 'The A&R Room'])[1].trim(),
    to: [{ email: to, type: 'to' }],
    subject, html, text,
  };
  const headers = sendHeaders(opts);
  if (Object.keys(headers).length) message.headers = headers;
  if (opts.tag && TAG_RE.test(opts.tag)) message.tags = [opts.tag];
  const res = await fetch((process.env.MANDRILL_API_BASE || 'https://mandrillapp.com/api/1.0/') + 'messages/send.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: process.env.MANDRILL_API_KEY, message }),
  });
  const data = await res.json().catch(() => ({}));
  const first = Array.isArray(data) ? data[0] : null;
  if (!res.ok || (first && (first.status === 'rejected' || first.status === 'invalid'))) {
    const err = new Error(`Mandrill error: ${JSON.stringify(data)}`);
    err.reject = first ? (first.status === 'invalid' ? 'invalid' : (first.reject_reason || 'rejected')) : null;
    throw err;
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
    if (PROVIDER === 'resend') await sendViaResend(to, subject, html, text, { tag: 'otp' });
    else if (PROVIDER === 'mandrill') await sendViaMandrill(to, subject, html, text, { tag: 'otp' });
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
// Returns { ok } or { ok:false, error, reject }. Non-fatal by contract — callers log + continue.
// `reject` is the provider's reason when the ADDRESS was refused (hard-bounce, invalid, spam,
// unsub, ...) as opposed to the request failing; callers use it to stop mailing that address.
// opts: { tag, unsubscribe } — see sendHeaders().
async function sendEmail(to, subject, html, text, opts = {}) {
  if (PROVIDER === 'console') {
    console.log(`\n[EMAIL] ${to} :: ${subject}${opts.tag ? ` [${opts.tag}]` : ''}\n`);
    return { ok: true };
  }
  try {
    if (PROVIDER === 'resend') await sendViaResend(to, subject, html, text, opts);
    else if (PROVIDER === 'mandrill') await sendViaMandrill(to, subject, html, text, opts);
    else throw new Error(`Unknown EMAIL_PROVIDER: ${PROVIDER}`);
    return { ok: true };
  } catch (e) {
    console.error(`[EMAIL] send failed via ${PROVIDER}: ${e.message}`);
    return { ok: false, error: e.message, reject: e.reject || null };
  }
}
// Reject reasons that mean "this address is dead or does not want us" — the ones that set
// users.email_bounced_at. soft-bounce and rule/custom rejections are NOT here: a full inbox
// comes back. Mandrill's `unsub` is a provider-side unsubscribe we never saw happen; it is
// treated as one, and the person's profile is still the way back.
const DEAD_REJECTS = new Set(['hard-bounce', 'invalid', 'spam', 'unsub']);
function isDeadAddress(reject) { return !!reject && DEAD_REJECTS.has(String(reject)); }

module.exports = { sendOtp, PROVIDER, sendFeedback, sendEmail, escapeHtml, isDeadAddress, sendHeaders };

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
