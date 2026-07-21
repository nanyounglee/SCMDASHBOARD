// Fetch fixed dashboard CSV files from Google Sheets and write them into CSV/.
//
// Required GitHub Actions variables:
//   GOOGLE_SHEETS_ID
//   GOOGLE_SHEETS_CSV_SOURCES
//
// GOOGLE_SHEETS_CSV_SOURCES example:
// [
//   {"key":"dashboard_period_summary","sheet":"dashboard_period_summary","gid":"0","file":"dashboard_period_summary.csv"},
//   {"key":"raw_purchase","sheet":"raw_발주","gid":"123456789","file":"raw_발주.csv"}
// ]
//
// If GOOGLE_SERVICE_ACCOUNT_JSON is set as a secret, the script reads private
// sheets through the Google Sheets API. Without it, it uses the public CSV
// export endpoint, so the spreadsheet must be accessible to the runner.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SOURCES_RAW = process.env.GOOGLE_SHEETS_CSV_SOURCES;
const SERVICE_ACCOUNT_RAW = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!SPREADSHEET_ID || !SOURCES_RAW || !SOURCES_RAW.trim()) {
  console.log('GOOGLE_SHEETS_ID / GOOGLE_SHEETS_CSV_SOURCES not set. Skipping Google Sheets CSV fetch.');
  process.exit(0);
}

let SOURCES;
try {
  SOURCES = JSON.parse(SOURCES_RAW);
} catch (e) {
  console.error('GOOGLE_SHEETS_CSV_SOURCES must be valid JSON:', e.message);
  process.exit(1);
}

if (!Array.isArray(SOURCES) || !SOURCES.length) {
  console.log('GOOGLE_SHEETS_CSV_SOURCES is empty. Skipping Google Sheets CSV fetch.');
  process.exit(0);
}

let serviceAccount = null;
if (SERVICE_ACCOUNT_RAW && SERVICE_ACCOUNT_RAW.trim()) {
  try {
    serviceAccount = JSON.parse(SERVICE_ACCOUNT_RAW);
  } catch (e) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON:', e.message);
    process.exit(1);
  }
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken() {
  if (!serviceAccount) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(serviceAccount.private_key, 'base64url');
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${await response.text()}`);
  const json = await response.json();
  return json.access_token;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function valuesToCsv(values) {
  return '\uFEFF' + (values || []).map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function sheetRange(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

async function fetchViaSheetsApi(src, token) {
  if (!src.sheet) throw new Error('sheet is required when using GOOGLE_SERVICE_ACCOUNT_JSON');
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetRange(src.sheet))}`);
  url.searchParams.set('majorDimension', 'ROWS');
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  url.searchParams.set('dateTimeRenderOption', 'FORMATTED_STRING');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
  const json = await response.json();
  return valuesToCsv(json.values || []);
}

async function fetchViaPublicExport(src) {
  if (!src.gid && src.gid !== 0) throw new Error('gid is required when GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export`);
  url.searchParams.set('format', 'csv');
  url.searchParams.set('gid', String(src.gid));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Sheets export ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text.charCodeAt(0) === 0xFEFF ? text : '\uFEFF' + text;
}

function isoWeekOf(d) {
  const day = d.getUTCDay() || 7;
  const t = new Date(d);
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil((((t - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7);
  return { y, w };
}

const wk = (y, w) => `${y}_W${String(w).padStart(2, '0')}`;

function lastCommitDate(relPath) {
  try {
    const out = execSync(`git log -1 --format=%aI -- "${relPath}"`, { encoding: 'utf8' }).trim();
    return out ? new Date(out) : null;
  } catch {
    return null;
  }
}

function archiveBeforeOverwrite(file) {
  const currentPath = path.join('CSV', file);
  if (!fs.existsSync(currentPath)) return;

  const commitDate = lastCommitDate(currentPath) || new Date();
  const { y, w } = isoWeekOf(commitDate);
  const destDir = path.join('CSV_BANK', wk(y, w), 'google_sheets');
  fs.mkdirSync(destDir, { recursive: true });

  let dest = path.join(destDir, file);
  if (fs.existsSync(dest)) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    dest = path.join(destDir, `${base}_${stamp}${ext}`);
  }
  fs.renameSync(currentPath, dest);
  console.log(`  archived CSV/${file} -> ${dest}`);
}

async function runSource(src, token) {
  const file = src.file || `${src.key || src.sheet}.csv`;
  if (!file || file.includes('/') || file.includes('\\')) {
    throw new Error(`Invalid file name for ${src.key || src.sheet || '?'}: ${file}`);
  }

  console.log(`[${src.key || src.sheet || file}] -> CSV/${file}`);
  const csvText = token ? await fetchViaSheetsApi(src, token) : await fetchViaPublicExport(src);
  if (!csvText.trim()) {
    console.warn('  empty CSV. Existing file preserved.');
    return false;
  }

  const currentPath = path.join('CSV', file);
  if (fs.existsSync(currentPath) && fs.readFileSync(currentPath, 'utf8') === csvText) {
    console.log('  unchanged');
    return false;
  }

  archiveBeforeOverwrite(file);
  fs.mkdirSync('CSV', { recursive: true });
  fs.writeFileSync(currentPath, csvText, 'utf8');
  console.log(`  saved CSV/${file}`);
  return true;
}

const token = await getAccessToken();
let changed = false;
let failures = 0;
for (const src of SOURCES) {
  try {
    changed = (await runSource(src, token)) || changed;
  } catch (e) {
    console.error(`[${src.key || src.sheet || '?'}] failed: ${e.message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`Google Sheets CSV fetch failed for ${failures} source(s). No commit should be created.`);
  process.exit(1);
}

console.log(changed ? 'Google Sheets CSV fetch completed with changes.' : 'Google Sheets CSV fetch completed with no changes.');
