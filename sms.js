'use strict';
// SMS sender abstraction. Pick provider with SMS_PROVIDER:
//   console (default) -> prints the message to the server log (dev / until Twilio is wired)
//   twilio            -> needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either
//                        TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM (an SMS-capable number)
//
// Every send returns { ok, channel } or { ok:false, error }. Non-fatal by contract — callers
// log and continue, exactly like email.js. Only send marketing/notification SMS to
// numbers with explicit consent (sms_marketing_consent) — that gate lives in the caller.
//
// SMS vs MMS (operator, 2026-09-20): a text that carries an emoji, or runs past 160
// characters, goes out as MMS instead. Carriers bill SMS per SEGMENT, and one emoji (or any
// character outside the GSM-7 alphabet — an em dash, curly quotes) switches the whole
// message to UCS-2, where a segment is 70 characters instead of 160. A short-looking text
// with one 🎧 is then three segments. An MMS is billed once regardless of length, so it is
// the cheaper channel exactly when a text would split. The decision is made HERE, once,
// so every caller (go-live texts, artist notices, announcements, the test button) gets it.
// Twilio sends a message as MMS when it carries a MediaUrl, so the switch is a small brand
// mark attached to the message (SMS_MMS_MEDIA_URL; defaults to the site's mark). MMS needs
// an MMS-capable US/Canada number or Messaging Service. SMS_MMS_AUTO=0 turns the switch off.

const PROVIDER = (process.env.SMS_PROVIDER || 'console').toLowerCase();
const SMS_SINGLE_SEGMENT = 160;

// The GSM 03.38 basic alphabet plus its extension table. Anything outside it (emoji, em
// dashes, curly quotes, most accented capitals) forces the whole message to UCS-2.
const GSM7 = new Set(('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
  + '\f^{}\\[~]|€').split(''));

function isGsm7(body) {
  for (const ch of String(body || '')) if (!GSM7.has(ch)) return false;
  return true;
}

// How a carrier would bill this body as SMS: the encoding it forces and the segment count.
function smsSegments(body) {
  const s = String(body || '');
  const gsm = isGsm7(s);
  // Extension characters cost two septets in GSM-7; every code point costs one UCS-2 unit
  // (astral characters such as emoji cost two).
  let units = 0;
  if (gsm) { for (const ch of s) units += '\f^{}\\[~]|€'.includes(ch) ? 2 : 1; }
  else { units = s.length; }
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
  return { encoding: gsm ? 'gsm7' : 'ucs2', units, segments };
}

// The operator's rule, verbatim: an emoji (or anything else that leaves GSM-7) or more than
// 160 characters means MMS. Length is counted in characters as a person would count them.
function shouldSendAsMms(body) {
  if (process.env.SMS_MMS_AUTO === '0') return false;
  const s = String(body || '');
  return !isGsm7(s) || [...s].length > SMS_SINGLE_SEGMENT;
}

function mmsMediaUrl() {
  const base = (process.env.PUBLIC_BASE_URL || 'https://anr.makinitmag.com').replace(/\/+$/, '');
  return process.env.SMS_MMS_MEDIA_URL || `${base}/mark-color.png`;
}

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

async function sendViaTwilio(to, body, { mms = false } = {}) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set');
  const form = new URLSearchParams({ To: to, Body: body });
  if (mms) form.set('MediaUrl', mmsMediaUrl());
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else if (process.env.TWILIO_FROM) form.set('From', process.env.TWILIO_FROM);
  else throw new Error('TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM required');
  const res = await fetch(`${process.env.TWILIO_API_BASE || 'https://api.twilio.com'}/2010-04-01/Accounts/${sid}/Messages.json`, {
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
  const mms = shouldSendAsMms(body);
  const channel = mms ? 'mms' : 'sms';
  if (PROVIDER === 'console') {
    console.log(`\n[${channel.toUpperCase()}] ${num} :: ${body}\n`);
    return { ok: true, channel };
  }
  try {
    if (PROVIDER === 'twilio') await sendViaTwilio(num, body, { mms });
    else throw new Error(`Unknown SMS_PROVIDER: ${PROVIDER}`);
    return { ok: true, channel };
  } catch (e) {
    console.error(`[${channel.toUpperCase()}] send failed via ${PROVIDER}: ${e.message}`);
    return { ok: false, error: e.message, channel };
  }
}

module.exports = { sendSms, PROVIDER, normalize, isGsm7, smsSegments, shouldSendAsMms, mmsMediaUrl, SMS_SINGLE_SEGMENT };
