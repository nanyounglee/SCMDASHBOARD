// POST /api/login  { password: string }
// Checks the password against GATE_PASSWORD and, on success, sets a signed
// session cookie. The frontend gate calls this instead of unlocking locally,
// so the actual data endpoints (/api/data/*) can trust the cookie.
const { createSessionCookie } = require('./_session');

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const password = body && body.password;
  if (!process.env.GATE_PASSWORD) {
    res.status(500).json({ ok: false, error: 'GATE_PASSWORD env var is not set' });
    return;
  }
  if (password !== process.env.GATE_PASSWORD) {
    res.status(401).json({ ok: false, error: '비밀번호가 올바르지 않습니다' });
    return;
  }
  res.setHeader('Set-Cookie', createSessionCookie());
  res.status(200).json({ ok: true });
};
