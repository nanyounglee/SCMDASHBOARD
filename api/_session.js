// Shared session helpers for the login gate + data proxy.
// Session = base64url(JSON payload) + "." + HMAC-SHA256(payload, SESSION_SECRET) hex.
// No external deps (uses Node's built-in crypto) so it works on Vercel's default Node runtime.
const crypto = require('crypto');

const COOKIE_NAME = 'scm_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(payloadB64) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET env var is not set');
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
}

function createSessionCookie() {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = sign(payloadB64);
  const value = `${payloadB64}.${sig}`;
  const secure = process.env.VERCEL_ENV ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

function isSessionValid(req) {
  const cookies = parseCookies(req.headers.cookie);
  const value = cookies[COOKIE_NAME];
  if (!value) return false;
  const [payloadB64, sig] = value.split('.');
  if (!payloadB64 || !sig) return false;
  let expected;
  try {
    expected = sign(payloadB64);
  } catch (e) {
    return false;
  }
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch (e) {
    return false;
  }
}

module.exports = { COOKIE_NAME, createSessionCookie, isSessionValid };
