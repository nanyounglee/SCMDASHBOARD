// GET /api/data?path=CSV/order.csv, /api/data?path=CSV_BANK/2026_W30/order_....csv, etc.
// Requires a valid session cookie (set by /api/login). On success, proxies the
// file from the private data repo using a server-side GitHub token — the
// token never reaches the browser, only the file contents do.
//
// v23.7: originally implemented as a nested catch-all route
// (api/data/[...path].js mapping /api/data/*), but on the deployed Vercel
// project any request path with 2+ segments under /api/data/ returned a
// platform-level 404 while 1-segment paths worked fine (confirmed by live
// testing) — switched to a flat function reading the file path from a query
// string, which sidesteps path-segment routing entirely.
//
// v23.7b: GitHub's default Contents API response (base64 JSON) only includes
// `content` for files <=1MB — order.csv (~60MB) came back without it
// ("unexpected GitHub API response") since larger files omit the field.
// Requesting the raw media type instead returns the file bytes directly in
// the response body regardless of size, and we stream that straight through
// to the client rather than buffering it into one Buffer first.
const { Readable } = require('stream');
const { isSessionValid } = require('./_session');

const EXT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

module.exports = async (req, res) => {
  if (!isSessionValid(req)) {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다' });
    return;
  }
  const raw = req.query.path;
  const filePathRaw = Array.isArray(raw) ? raw[0] : raw;
  if (!filePathRaw) {
    res.status(400).json({ ok: false, error: 'invalid path' });
    return;
  }
  const parts = filePathRaw.split('/');
  if (!parts.length || parts.some((p) => !p || p === '..' || p === '.')) {
    res.status(400).json({ ok: false, error: 'invalid path' });
    return;
  }
  const filePath = parts.map(encodeURIComponent).join('/');
  const repo = process.env.DATA_REPO; // e.g. "nanyounglee/-private-repo"
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    res.status(500).json({ ok: false, error: 'DATA_REPO or GITHUB_TOKEN env var is not set' });
    return;
  }

  let ghRes;
  try {
    ghRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'GitHub API 호출 실패: ' + e.message });
    return;
  }

  if (ghRes.status === 404) {
    res.status(404).json({ ok: false, error: 'file not found' });
    return;
  }
  if (!ghRes.ok || !ghRes.body) {
    res.status(502).json({ ok: false, error: `GitHub API ${ghRes.status}` });
    return;
  }

  const ext = (filePath.split('.').pop() || '').toLowerCase();
  res.setHeader('Content-Type', EXT_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  Readable.fromWeb(ghRes.body).pipe(res);
};
