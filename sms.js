'use strict';
// SMS sender abstraction. Pick provider with SMS_PROVIDER:
//   console (default) -> prints the message to the server log (dev / until Twilio is wired)
//   twilio            -> needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either
//                        TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM (an SMS-capable number)
//
// Every send returns { ok } or { ok:false, error }. Non-fatal by contract — callers
// log and continue, exactly like email.js. Only send marketing/notification SMS to
// numbers with explicit consent (sms_marketing_consent) — that gate lives in the caller.

const PROVIDER = (process.env.SMS_PROVIDER || 'console').toLowerCase();

// Normalize to E.164-ish: keep a leading +, strip other non-digits. US 10-digit -> +1.
function normalize(to) {
  const raw = String(to || '').trim();
  const plus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (plus) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '+' + digits;
}

async function sendViaTwilio(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set');
  const form = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else if (process.env.TWILIO_FROM) form.set('From', process.env.TWILIO_FROM);
  else throw new Error('TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM required');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  return true;
}

async function sendSms(to, body) {
  const num = normalize(to);
  if (!num) return { ok: false, error: 'no destination' };
  if (PROVIDER === 'console') {
    console.log(`\n[SMS] ${num} :: ${body}\n`);
    return { ok: true };
  }
  try {
    if (PROVIDER === 'twilio') await sendViaTwilio(num, body);
    else throw new Error(`Unknown SMS_PROVIDER: ${PROVIDER}`);
    return { ok: true };
  } catch (e) {
    console.error(`[SMS] send failed via ${PROVIDER}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendSms, PROVIDER, normalize };
