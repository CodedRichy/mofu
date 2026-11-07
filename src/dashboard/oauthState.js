// OAuth `state` (CSRF protection for the Discord login), issued and checked by the server.
//
// Flow: GET /api/auth/login mints a random state, puts it in a signed httpOnly SameSite=Lax cookie and redirects
// to Discord with the same value. Discord sends the browser back with ?code&state; the page POSTs both to
// /api/auth/callback (same origin, so the cookie rides along). The callback accepts only when the cookie
// signature is valid, it has not expired (10 min), the posted state equals the cookie state (timing-safe), and
// the state has not been used before (one-time). The cookie is cleared on every callback attempt.
//
// Pure module: no express, no store. The secret and clock are passed in so tests can drive it.
const crypto = require('crypto');

const COOKIE_NAME = 'sonder_oauth';
const COOKIE_PATH = '/api/auth';
const TTL_MS = 10 * 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{32,64}$/;

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function sign(secret, payload) {
  return b64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch; compare a digest of each so lengths always match.
  const hx = crypto.createHash('sha256').update(x).digest();
  const hy = crypto.createHash('sha256').update(y).digest();
  return crypto.timingSafeEqual(hx, hy) && x.length === y.length;
}

// Minimal Cookie header parser (no dependency). Returns {} for anything malformed.
function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

function createStateManager({ secret, now = () => Date.now(), ttlMs = TTL_MS } = {}) {
  if (!secret || typeof secret !== 'string') throw new Error('oauth state: secret required');
  const used = new Map(); // state -> expiresAt (one-time use, kept until it would have expired anyway)

  function sweep() {
    const t = now();
    for (const [s, exp] of used) if (t > exp) used.delete(s);
  }

  // Returns { state, cookieValue, expiresAt }.
  function issue() {
    const state = b64url(crypto.randomBytes(24)); // 32 chars, 192 bits
    const expiresAt = now() + ttlMs;
    const payload = `${state}.${expiresAt}`;
    return { state, expiresAt, cookieValue: `${payload}.${sign(secret, payload)}` };
  }

  // Returns { ok: true } or { ok: false, reason }. Consumes the state on success.
  function verify(cookieValue, returnedState) {
    if (typeof returnedState !== 'string' || !STATE_RE.test(returnedState)) return { ok: false, reason: 'bad_state' };
    if (typeof cookieValue !== 'string' || cookieValue.length > 256) return { ok: false, reason: 'no_cookie' };
    const parts = cookieValue.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'no_cookie' };
    const [state, expStr, mac] = parts;
    if (!safeEqual(mac, sign(secret, `${state}.${expStr}`))) return { ok: false, reason: 'bad_signature' };
    const expiresAt = Number(expStr);
    if (!Number.isSafeInteger(expiresAt) || now() > expiresAt) return { ok: false, reason: 'expired' };
    if (!safeEqual(state, returnedState)) return { ok: false, reason: 'mismatch' };
    sweep();
    if (used.has(state)) return { ok: false, reason: 'replayed' };
    used.set(state, expiresAt);
    if (used.size > 50000) used.delete(used.keys().next().value); // hard cap; expired entries go first via sweep
    return { ok: true };
  }

  return { issue, verify, _used: used };
}

// Set-Cookie header values. `secure` should be true whenever the site is served over https.
function setCookieHeader(value, { secure, maxAgeMs = TTL_MS } = {}) {
  return `${COOKIE_NAME}=${value}; Path=${COOKIE_PATH}; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
function clearCookieHeader({ secure } = {}) {
  return `${COOKIE_NAME}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

module.exports = { createStateManager, parseCookies, setCookieHeader, clearCookieHeader, safeEqual, COOKIE_NAME, COOKIE_PATH, TTL_MS };
