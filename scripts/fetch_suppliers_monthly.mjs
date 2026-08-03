// ============================================================================
// 협력사 마스터 월간 자동 갱신 (GitHub Actions에서 실행)
//
// 배경(2026-08-03): 협력사 신규/거래종료 공지는 대시보드가 CSV_BANK에 쌓인 sup.csv
// 스냅샷을 앞뒤로 비교해 감지하는 구조인데, sup이 AIRTABLE_SOURCES에 등록된 적이 없어
// 스냅샷이 단 하나도 없었다 — 비교 체인이 [현재] 하나뿐이라 감지가 항상 0건이었고,
// 그래서 거래종료 목록을 코드에 하드코딩(MANUAL_VENDOR_TERMINATIONS)해 쓰고 있었다.
// 이 스크립트가 매월 1회 Airtable 협력사 뷰를 받아 CSV/sup.csv를 갱신하면서,
// 덮어쓰기 직전 이전 버전을 CSV_BANK/sup_YYYY_MM.csv 로 보존해 비교 체인을 만든다.
//
// 주간 소스(fetch_airtable_sources.mjs)와 따로 두는 이유: 협력사 마스터는 변동이
// 드물어 주간으로 돌릴 이유가 없고(사용자 요청), 월간 스냅샷 하나로 "이번 달에
// 추가/제외된 업체"가 바로 떨어진다.
//
// 환경변수:
//   AIRTABLE_TOKEN   (secret) data.records:read 스코프 PAT — 없으면 종료(실패 아님)
//   SUPPLIER_BASE / SUPPLIER_TABLE / SUPPLIER_VIEW  (선택) 기본값은 아래 상수
//     https://airtable.com/appAbBz1Y48qhpHwz/tbl5BjEkhn3CUMIlI/viw73sRMI8OFPIwGp
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE  = process.env.SUPPLIER_BASE  || 'appAbBz1Y48qhpHwz';
const TABLE = process.env.SUPPLIER_TABLE || 'tbl5BjEkhn3CUMIlI';
const VIEW  = process.env.SUPPLIER_VIEW  || 'viw73sRMI8OFPIwGp';
const FILE  = 'sup.csv';
const NAME_FIELD = '협력사 이름';
const STATUS_FIELD = '협력사 Status';

// ---- 내보낼 컬럼 허용목록 (v23.13, 2026-08-03) ----
// 이 저장소는 GitHub Pages로 서비스하는 public 저장소다. 첫 실행에서 뷰의 필드를 전부 받아
// 117컬럼을 커밋했는데, 거기에 통장사본·사업자등록증·등기부등본 첨부 링크와 계좌번호·
// 사업자등록번호·대표자·담당자 연락처까지 들어 있었다(협력사 146곳분).
// 대시보드가 실제로 읽는 sup 컬럼은 아래 9개뿐이므로(index.html 참조 횟수로 확인) 그것만 남긴다.
//   - API 제공: 협력사 이름 · 협력사 Status · 발주담당자 · 협력사 결제조건 · 하도급계약 대상여부
//   - 수기 관리(원천에 없음, 아래 보존 로직으로 이월): 업태 · 인쇄 · 1. 제조유형 · 2. Goods Category_1.goods
// 컬럼을 늘려야 하면 SUPPLIER_COLUMNS 변수(쉼표 구분)로 덮어쓰되, 개인정보·금융정보는 넣지 말 것.
const ALLOWED_COLUMNS = (process.env.SUPPLIER_COLUMNS || [
  '협력사 이름', '협력사 Status', '발주담당자', '협력사 결제조건', '하도급계약 대상여부',
  '업태', '인쇄', '1. 제조유형', '2. Goods Category_1.goods',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN) { console.log('AIRTABLE_TOKEN 미설정 — 협력사 자동 갱신을 건너뜁니다.'); process.exit(0); }

// ---- Airtable 전체 레코드 페치 (100건 페이지네이션) ----
async function fetchView() {
  const records = [];
  let offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
    u.searchParams.set('view', VIEW);
    u.searchParams.set('cellFormat', 'string');   // Airtable UI 표시 형식 그대로 — 대시보드 파서와 형식 일치
    u.searchParams.set('timeZone', 'Asia/Seoul');
    u.searchParams.set('userLocale', 'ko');
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable API ${r.status}: ${await r.text()}`);
    const j = await r.json();
    records.push(...j.records);
    offset = j.offset || null;
    if (offset) await new Promise(res => setTimeout(res, 250)); // rate limit(5 req/s) 여유
  } while (offset);
  return records;
}

// ---- CSV 직렬화 (RFC4180 인용, BOM 포함 — 기존 파일과 동일) ----
const q = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (headers, records) =>
  '﻿' + [headers.map(q).join(','), ...records.map(rec => headers.map(h => q(rec.fields[h])).join(','))].join('\r\n') + '\r\n';

// ---- CSV 파싱(인용 지원) ----
function parseCsv(txt) {
  const rows = []; let row = [], cur = '', inQ = false;
  const t = txt.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function readExisting() {
  const p = path.join('CSV', FILE);
  if (!fs.existsSync(p)) return null;
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  if (!rows.length) return null;
  const headers = rows[0];
  const objs = rows.slice(1).filter(r => r.length && r.some(v => v !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, objs };
}

// ---- 덮어쓰기 직전 이전 버전을 그 파일이 커밋된 달의 스냅샷으로 보존 ----
// (대시보드 detectSupplierChanges()가 CSV_BANK/sup_YYYY_MM.csv 체인을 비교한다)
function archiveMonthly() {
  const p = path.join('CSV', FILE);
  if (!fs.existsSync(p)) return null;
  let commitDate;
  try {
    const out = execSync(`git log -1 --format=%aI -- "${p}"`, { encoding: 'utf8' }).trim();
    commitDate = out ? new Date(out) : new Date();
  } catch { commitDate = new Date(); }
  const y = commitDate.getFullYear(), m = String(commitDate.getMonth() + 1).padStart(2, '0');
  const snap = path.join('CSV_BANK', `sup_${y}_${m}.csv`);
  fs.mkdirSync('CSV_BANK', { recursive: true });
  if (fs.existsSync(snap)) { console.log(`  월간 스냅샷 이미 있음(${y}_${m}) — 건너뜀`); return snap; }
  fs.copyFileSync(p, snap);
  console.log(`  월간 스냅샷 저장: ${snap}`);
  return snap;
}

// ---- 실행 ----
console.log(`[협력사] base="${BASE}" table="${TABLE}" view="${VIEW}" → CSV/${FILE}`);
const records = await fetchView();
console.log(`  ${records.length}건 수신`);
if (!records.length) {
  console.warn('  레코드 0건 — 뷰 설정이나 권한 문제일 수 있어 기존 CSV를 그대로 둡니다.');
  process.exit(0);
}

const prev = readExisting();
const apiFields = [...new Set(records.flatMap(r => Object.keys(r.fields)))];
// 허용목록 순서를 그대로 헤더 순서로 쓴다 — 뷰에 새 필드가 생겨도 자동으로 딸려오지 않는다
let headers = ALLOWED_COLUMNS.slice();
const missing = ALLOWED_COLUMNS.filter(c => !apiFields.includes(c) && !(prev && prev.headers.includes(c)));
if (missing.length) console.warn(`  주의: 허용목록 중 원천·기존 CSV 어디에도 없는 컬럼 ${missing.length}개 — ${missing.join(', ')}`);
console.log(`  컬럼 ${apiFields.length}개 중 ${headers.length}개만 내보냄(공개 저장소 — 개인정보·금융정보 제외)`);
if (prev) {
  // 수동 컬럼 보존 — '업태'·'인쇄'·'1. 제조유형'처럼 원천 테이블에 없어 수기로 채운 컬럼은
  // 협력사 이름으로 매칭해 이월한다. 없으면 자동 갱신마다 수기 데이터가 날아간다(v22.4와 동일 규칙).
  const manualCols = headers.filter(h => !apiFields.includes(h));
  if (manualCols.length) {
    const prevMap = {};
    prev.objs.forEach(o => { const k = String(o[NAME_FIELD] || '').trim(); if (k) prevMap[k] = o; });
    let carried = 0;
    records.forEach(rec => {
      const k = String(rec.fields[NAME_FIELD] ?? '').trim();
      const old = k ? prevMap[k] : null; if (!old) return;
      manualCols.forEach(c => {
        if (old[c] && (rec.fields[c] == null || String(rec.fields[c]).trim() === '')) { rec.fields[c] = old[c]; carried++; }
      });
    });
    console.log(`  수동 컬럼 ${manualCols.length}개 보존(${manualCols.join(', ')}) — ${carried}개 값 이월`);
  }
}

const csvText = toCsv(headers, records);
const curPath = path.join('CSV', FILE);
if (fs.existsSync(curPath) && fs.readFileSync(curPath, 'utf8') === csvText) {
  console.log('  이전과 동일한 내용 — 변경 없음, 커밋 대상 없음');
  process.exit(0);
}

// ---- 변동 요약을 워크플로 로그에 남긴다(대시보드 공지는 스냅샷 비교로 별도 산출) ----
if (prev) {
  const nameOf = o => String(o[NAME_FIELD] || '').trim();
  const prevNames = new Set(prev.objs.map(nameOf).filter(Boolean));
  const curNames = new Set(records.map(r => String(r.fields[NAME_FIELD] ?? '').trim()).filter(Boolean));
  const added = [...curNames].filter(n => !prevNames.has(n));
  const removed = [...prevNames].filter(n => !curNames.has(n));
  const prevStatus = {}; prev.objs.forEach(o => { const n = nameOf(o); if (n) prevStatus[n] = String(o[STATUS_FIELD] || '').trim(); });
  const nowTerminated = records
    .filter(r => String(r.fields[STATUS_FIELD] ?? '').trim() === '거래종료')
    .map(r => String(r.fields[NAME_FIELD] ?? '').trim())
    .filter(n => n && prevStatus[n] && prevStatus[n] !== '거래종료');
  console.log(`  신규 ${added.length}곳${added.length ? ': ' + added.join(', ') : ''}`);
  console.log(`  목록에서 제외 ${removed.length}곳${removed.length ? ': ' + removed.join(', ') : ''}`);
  console.log(`  거래종료 전환 ${nowTerminated.length}곳${nowTerminated.length ? ': ' + nowTerminated.join(', ') : ''}`);
}

archiveMonthly();          // 새 데이터를 쓰기 전에 이전 달 상태부터 보존
fs.mkdirSync('CSV', { recursive: true });
fs.writeFileSync(curPath, csvText);
console.log(`  저장: CSV/${FILE} (${records.length}행 × ${headers.length}컬럼)`);
console.log('완료 — 커밋 대상 변경 있음');
