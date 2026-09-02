/* The A&R Team — shared join / auth plumbing.
 *
 * Extracted VERBATIM from play.html so a second player surface (daily.html) can join a
 * session without a second copy of this that has to stay bug-for-bug identical forever.
 * There is no build step here, so a shared <script src> is exactly how tokens.css and
 * ui.css are already shared between surfaces.
 *
 * What lives here: the per-session token storage (including the one-time legacy
 * migration), the api()/apiRaw() wrappers, the three join calls, the logged-in one-tap
 * register, the 403 access_code_required handling, and renderAuthScreens() which injects
 * the account / email / code markup for a page that does not carry it statically.
 *
 * What does NOT live here: anything that knows what a screen looks like after you are in.
 * The page owns show() and what happens once a token exists — passed in via configure().
 */
(function (w) {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // Session id comes STRICTLY from the URL. We do NOT fall back to a stored session —
  // that was the source of "Session A link opened Session B": a stale value winning over
  // the actual link. No ?s= => no session (handled in each page's boot).
  const SID = new URLSearchParams(location.search).get('s');

  // GA4 engagement events (no-op when analytics is disabled or gtag hasn't loaded).
  function track(name, params) { try { if (w.gtag) w.gtag('event', name, params || {}); } catch (e) {} }

  // Player tokens are PER SESSION. A single global token meant a token from session A
  // would authenticate you into session A even when you opened a session B link (the
  // token resolves to one participant/session server-side). Scope the key by session id.
  function tokenKey(sid) { return 'rt_token_' + (sid || ''); }
  function getToken() { return SID ? localStorage.getItem(tokenKey(SID)) : null; }
  function setToken(t) { if (SID) localStorage.setItem(tokenKey(SID), t); }
  function clearToken() { if (SID) localStorage.removeItem(tokenKey(SID)); }

  // One-time migration: an older build stored a single global 'rt_token' tied to whatever
  // session was last joined. If we're on that same session, preserve it under the new key;
  // otherwise drop it so it can't leak across sessions.
  (function migrateLegacyToken() {
    const legacy = localStorage.getItem('rt_token'), legacySid = localStorage.getItem('rt_sid');
    if (legacy) {
      if (SID && legacySid === SID && !localStorage.getItem(tokenKey(SID))) localStorage.setItem(tokenKey(SID), legacy);
      localStorage.removeItem('rt_token'); localStorage.removeItem('rt_sid');
    }
  })();

  const api = async (path, body, method = 'POST') => {
    const h = { 'Content-Type': 'application/json' };
    const tok = getToken(); if (tok) h['X-Player-Token'] = tok;
    const r = await fetch(path, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d;
  };

  // Raw fetch that returns {status,data} without throwing — lets callers intercept the
  // 428 check-in gate and the 403 access-code gate distinctly from real errors.
  async function apiRaw(path, body) {
    const h = { 'Content-Type': 'application/json' };
    const tok = getToken(); if (tok) h['X-Player-Token'] = tok;
    const r = await fetch(path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    return { status: r.status, data: d };
  }

  // Incoming referral code from the share link (?ref=CODE). Persist per-session so it
  // survives the email->code step. Cleared once we've joined.
  const INCOMING_REF = (new URLSearchParams(location.search).get('ref') || '').trim().toUpperCase();
  if (INCOMING_REF) localStorage.setItem('rt_ref_' + (SID || ''), INCOMING_REF);

  // ---- page hooks. The page owns its own screens and what happens after a join. ----
  let show = function () {};
  let onJoined = function () {};
  // The one-tap register screen's wording is surface-specific: a live show says "enter
  // the evaluation", A&R Daily says something else entirely. Default is the live copy.
  let accountCopy = function (info) {
    const live = info && info.status === 'live';
    return {
      eyebrow: live ? 'Enter this evaluation session' : 'Claim your A&R profile',
      title: (info && info.name) || 'Evaluation session',
      sub: live
        ? 'Enter as an A&R and join the live evaluation.'
        : 'Continue to claim your A&R profile. We’ll notify you when this evaluation session opens.',
      cta: live ? 'Enter the evaluation' : 'Claim my A&R profile',
    };
  };

  function configure(opts) {
    if (!opts) return;
    if (opts.show) show = opts.show;
    if (opts.onJoined) onJoined = opts.onJoined;
    if (opts.accountCopy) accountCopy = opts.accountCopy;
  }

  // Logged-in one-tap register (no OTP) — offered when there's an account token but no
  // participant token for this session yet.
  async function tryAccountRegister(info) {
    const at = localStorage.getItem('rt_auth_token');
    let me = null; try { me = await fetch('/api/auth/me', { headers: { 'X-Auth-Token': at } }).then(r => r.ok ? r.json() : null); } catch (e) {}
    if (!me || !me.uid) { show('email'); return; }
    const c = accountCopy(info);
    $('#acctEyebrow').textContent = c.eyebrow;
    $('#acctHi').textContent = c.title;
    $('#acctSub').textContent = c.sub;
    $('#btnAcctJoin').textContent = c.cta;
    show('account');
  }

  // Returning-player prefill: name is filled; the phone is shown MASKED (we never receive
  // the real number here). Having a number on file means they're already opted in to SMS,
  // so the masked hint doubles as the opt-in indicator. phonePrefilled => "stored number
  // on file, field left as the mask" so verify can tell the server to keep it.
  let phonePrefilled = false;
  function applyPrefill(pf) {
    phonePrefilled = false;
    const nameEl = $('#name'), phoneEl = $('#phone');
    if (!pf) { if (phoneEl) { phoneEl.value = ''; phoneEl.placeholder = '(555) 123-4567'; } return; }
    if (nameEl && pf.name) nameEl.value = pf.name;
    if (phoneEl) {
      if (pf.hasPhone) {
        phoneEl.value = '';
        phoneEl.placeholder = pf.phoneHint + ' (on file — tap to change)';
        phonePrefilled = true;
      } else { phoneEl.value = ''; phoneEl.placeholder = '(555) 123-4567'; }
    }
  }

  // Bind the three join handlers. Called once by a page whose auth markup is static, and
  // after renderAuthScreens() by a page that injects it.
  function bindJoinHandlers() {
    $('#btnAcctJoin').onclick = async () => {
      $('#acctErr').textContent = ''; $('#btnAcctJoin').disabled = true;
      try {
        const r = await fetch('/api/join/account', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': localStorage.getItem('rt_auth_token') }, body: JSON.stringify({ sessionId: SID, accessCode: $('#acctCode').value.trim(), notifyRooms: $('#acctNotifyRooms').checked }) });
        const d = await r.json();
        if (r.status === 403 && d.error === 'access_code_required') {
          $('#acctCodeRow').classList.remove('hide');
          $('#acctErr').textContent = d.message || 'This room is invite-only — enter the room code.';
          $('#acctCode').focus(); $('#btnAcctJoin').disabled = false;
          return;
        }
        if (!r.ok) throw new Error(d.error || "We couldn't complete your registration.");
        track('session_register', { method: 'account' });
        setToken(d.token); onJoined();
      } catch (e) { $('#acctErr').textContent = e.message; $('#btnAcctJoin').disabled = false; }
    };
    $('#btnAcctOther').onclick = () => { if (history.length > 1) history.back(); else location.href = '/'; };

    $('#btnRequest').onclick = async () => {
      const email = $('#email').value.trim(); $('#emailErr').textContent = '';
      if (!email) return $('#emailErr').textContent = 'Enter your email';
      $('#btnRequest').disabled = true;
      try {
        const out = await apiRaw('/api/join/request', { sessionId: SID, email, accessCode: $('#roomCode').value.trim() });
        if (out.status === 403 && out.data.error === 'access_code_required') {
          // Invite-only room: surface the code field and let them retry.
          $('#roomCodeRow').classList.remove('hide');
          $('#emailErr').textContent = out.data.message || 'This room is invite-only — enter the room code.';
          $('#roomCode').focus();
          $('#btnRequest').disabled = false;
          return;
        }
        if (out.status !== 200) throw new Error(out.data.error || 'Something went wrong');
        const d = out.data;
        $('#emailEcho').textContent = email; localStorage.setItem('rt_email', email);
        if (d.devCode) { $('#devCodeBox').classList.remove('hide'); $('#devCodeBox').textContent = 'Dev mode — your code is ' + d.devCode; }
        else $('#devCodeBox').classList.add('hide');
        applyPrefill(d.prefill);
        show('code');
      } catch (e) { $('#emailErr').textContent = e.message; }
      $('#btnRequest').disabled = false;
    };

    $('#btnBack').onclick = () => { show('email'); };

    $('#btnVerify').onclick = async () => {
      $('#codeErr').textContent = '';
      const code = $('#code').value.trim(), name = $('#name').value.trim();
      if (!code) return $('#codeErr').textContent = 'Enter your access code';
      if (!name) return $('#codeErr').textContent = 'Enter your name';
      const phone = $('#phone') ? $('#phone').value.trim() : '';
      // If a returning user has a number on file and left the field untouched (still the
      // mask), tell the server to keep it (and keep them opted in). A newly typed number is
      // sent and replaces it. No stored number + empty field => no phone => no SMS consent.
      const keepPhone = phonePrefilled && phone.length === 0;
      const ref = localStorage.getItem('rt_ref_' + SID) || '';
      $('#btnVerify').disabled = true;
      try {
        const d = await api('/api/join/verify', { sessionId: SID, email: localStorage.getItem('rt_email'), code, name, phone, keepPhone, ref, notifyRooms: $('#notifyRooms').checked });
        track('session_register', { method: 'otp' });
        setToken(d.token);
        localStorage.removeItem('rt_ref_' + SID);
        onJoined();
      } catch (e) { $('#codeErr').textContent = e.message; }
      $('#btnVerify').disabled = false;
    };
  }

  // The account / email / code markup, for a page that does not carry it statically.
  // Same structure and the same ids as play.html's, so one set of handlers drives both.
  // The COPY is the A&R Team wording (a session, not a room) rather than the broadcast's;
  // play.html keeps its own static markup and is untouched by this file's strings.
  const AUTH_MARKUP = `
  <!-- JOIN: logged-in one-tap register (uses the A&R account, no code) -->
  <section id="screen-account" class="center stack hide">
    <div class="panel stack" style="text-align:center">
      <div class="eyebrow" id="acctEyebrow">Register as an A&amp;R</div>
      <h2 style="margin:6px 0;font-size:24px" id="acctHi">A&amp;R Daily</h2>
      <p class="dim" id="acctSub" style="font-size:14px;margin:0">Continue to claim your A&amp;R profile.</p>
      <div class="hide" id="acctCodeRow" style="width:100%"><label>Access code <span class="dim" style="font-weight:400">(from your invite)</span></label>
        <input id="acctCode" autocomplete="off" placeholder="e.g. VIP2026" maxlength="24" style="text-transform:uppercase"></div>
      <label class="pref-row" for="acctNotifyRooms" style="text-align:left">
        <input type="checkbox" id="acctNotifyRooms" checked>
        <span><b>Notify me when a session goes live</b>
          <small>Email, plus a text if you have a number on file.</small></span>
      </label>
      <button class="btn" id="btnAcctJoin">Claim my A&amp;R profile</button>
      <button class="btn ghost" id="btnAcctOther">Cancel</button>
      <div class="err" id="acctErr"></div>
    </div>
  </section>

  <!-- JOIN: email -->
  <section id="screen-email" class="center stack hide">
    <div class="panel stack">
      <div><div class="eyebrow">Step 1</div><h2 style="margin-top:6px">Join the A&amp;R Team</h2>
        <p class="dim" style="margin:8px 0 0;font-size:14px">Enter your email and we'll send a six-digit access code.</p></div>
      <div><label>Email</label><input id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com"></div>
      <div class="hide" id="roomCodeRow"><label>Access code <span class="dim" style="font-weight:400">(from your invite)</span></label>
        <input id="roomCode" autocomplete="off" placeholder="e.g. VIP2026" maxlength="24" style="text-transform:uppercase"></div>
      <button class="btn" id="btnRequest">Send my access code</button>
      <div class="err" id="emailErr"></div>
    </div>
  </section>

  <!-- JOIN: code -->
  <section id="screen-code" class="center stack hide">
    <div class="panel stack">
      <div><div class="eyebrow">Step 2</div><h2 style="margin-top:6px">Enter your access code</h2>
        <p class="dim" style="margin:8px 0 0;font-size:14px">Code sent to <span id="emailEcho" style="color:var(--ink)"></span>. If it isn't in your inbox, check <strong style="color:var(--ink)">Spam</strong> or <strong style="color:var(--ink)">Promotions</strong>.</p></div>
      <input id="code" class="code" inputmode="numeric" maxlength="6" placeholder="••••••">
      <div id="devCodeBox" class="note hide"></div>
      <div><label>Display name (shown in the A&amp;R rankings)</label><input id="name" placeholder="e.g. Maya"></div>
      <div>
        <label>Mobile number <span class="dim" style="font-weight:400">(optional)</span></label>
        <input id="phone" type="tel" inputmode="tel" placeholder="(555) 123-4567">
        <p class="dim" style="font-size:12px;line-height:1.5;margin:7px 2px 0">By entering your number you agree to receive texts when a session goes live and about future A&amp;R events. Message &amp; data rates may apply; reply STOP to opt out. Optional—not required to participate.</p>
      </div>
      <label class="pref-row" for="notifyRooms">
        <input type="checkbox" id="notifyRooms" checked>
        <span><b>Notify me when a session goes live</b>
          <small>Email, plus a text if you added a number. Change this any time in your A&amp;R record.</small></span>
      </label>
      <button class="btn" id="btnVerify">Join the team</button>
      <button class="btn ghost" id="btnBack">Use a different email</button>
      <div class="err" id="codeErr"></div>
    </div>
  </section>`;

  function renderAuthScreens(container) {
    const el = typeof container === 'string' ? $(container) : container;
    if (!el) return;
    el.insertAdjacentHTML('beforeend', AUTH_MARKUP);
  }

  w.ANRAuth = {
    $: $, SID: SID, track: track,
    tokenKey: tokenKey, getToken: getToken, setToken: setToken, clearToken: clearToken,
    api: api, apiRaw: apiRaw,
    INCOMING_REF: INCOMING_REF,
    configure: configure,
    tryAccountRegister: tryAccountRegister,
    applyPrefill: applyPrefill,
    bindJoinHandlers: bindJoinHandlers,
    renderAuthScreens: renderAuthScreens,
  };
})(window);
