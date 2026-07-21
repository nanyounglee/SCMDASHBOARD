// ============================================================================
// Airtable → 고정 파일명 CSV 다중 소스 자동 커밋 스크립트 (GitHub Actions에서 실행)
//
// progress_/project_ (scripts/fetch_airtable_weekly.mjs)는 파일명에 주차가
// 붙는 "주차별 신규 파일" 방식이지만, order.csv/issue.csv/sup.csv/ci.csv/
// parts.csv/goods_master.csv/stockout_list.csv/quarter_eval.csv 는 대시보드가
// CSV/_manifest.json 으로 고정 파일명을 그대로 자동 로드하는 방식이라
// 매번 "그 자리에서 덮어쓰기" 한다. 이 스크립트는 덮어쓰기 전에 기존
// archive_csv.ps1(수동 실행 스크립트)과 동일한 두 가지 보존 규칙을 재현한다:
//
//   1. 일반 아카이브: 덮어써지는 이전 버전을 CSV_BANK/<연도>_W<주차>/파일명
//      으로 이동해 보존한다. archive_csv.ps1은 로컬 파일의 마지막 수정 시각을
//      "그 파일이 사용된 주차"로 삼았지만, CI 체크아웃에서는 파일의
//      last-modified가 checkout 시각으로 리셋되어 신뢰할 수 없다 — 대신
//      `git log`로 그 파일이 마지막으로 커밋된 날짜를 구해 주차를 계산한다.
//   2. sup.csv 월간 스냅샷: CSV_BANK/sup_YYYY_MM.csv 로 협력사 명단을 매달
//      1회 보존한다(월간 공지사항의 신규/거래종료 협력사 diff가 이 스냅샷에
//      의존한다 — §4-24). 해당 월 스냅샷이 이미 있으면 건드리지 않는다.
//
// 대상이 아닌 파일(order_2025.csv 등 연 1회 갱신되는 과거 연도 원본, 또는
// AIRTABLE_SOURCES 에 없는 항목)은 건드리지 않는다.
//
// 환경변수:
//   AIRTABLE_TOKEN    (secret) data.records:read 스코프의 Personal Access Token
//   AIRTABLE_SOURCES  (variable, JSON) 예:
//     [
//       {"key":"order","base":"appXXXXXXXXXXXXXX","table":"task-SCMKPI_Raw" 또는 tbl…,
//        "view":"task-SCMKPI_Raw" 또는 viw…, "file":"order.csv"},
//       ...
//     ]
//     base/table/view 를 정확히 모르면 scripts/list_airtable_schema.mjs
//     (.github/workflows/airtable-discover.yml)로 먼저 조회한다.
//     이 변수가 없거나 빈 배열이면 스크립트는 아무 것도 하지 않고 종료한다
//     (기존 progress/project 자동화에는 영향 없음).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const TOKEN = process.env.AIRTABLE_TOKEN;
const SOURCES_RAW = process.env.AIRTABLE_SOURCES;

if (!SOURCES_RAW || !SOURCES_RAW.trim()) {
  console.log('AIRTABLE_SOURCES 미설정 — 고정 파일명 CSV 자동화를 건너뜁니다.');
  process.exit(0);
}
let SOURCES;
try { SOURCES = JSON.parse(SOURCES_RAW); } catch (e) {
  console.error('AIRTABLE_SOURCES가 올바른 JSON이 아닙니다:', e.message);
  process.exit(1);
}
if (!Array.isArray(SOURCES) || !SOURCES.length) {
  console.log('AIRTABLE_SOURCES가 빈 배열입니다 — 건너뜁니다.');
  process.exit(0);
}
if (!TOKEN) { console.error('AIRTABLE_TOKEN 환경변수가 필요합니다.'); process.exit(1); }

function isoWeekOf(d) {
  const day = d.getUTCDay() || 7;
  const t = new Date(d); t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil((((t - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7);
  return { y, w };
}
const wk = (y, w) => `${y}_W${String(w).padStart(2, '0')}`;

// ---- 해당 경로가 git에 마지막으로 커밋된 날짜(있으면) ----
function lastCommitDate(relPath) {
  try {
    const out = execSync(`git log -1 --format=%aI -- "${relPath}"`, { encoding: 'utf8' }).trim();
    return out ? new Date(out) : null;
  } catch { return null; }
}

// ---- Airtable 전체 레코드 페치 (100건 페이지네이션) ----
async function fetchView(base, table, view) {
  const records = [];
  let offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`);
    u.searchParams.set('view', view);
    u.searchParams.set('cellFormat', 'string');
    u.searchParams.set('timeZone', 'Asia/Seoul');
    u.searchParams.set('userLocale', 'ko');
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable API ${r.status}: ${await r.text()}`);
    const j = await r.json();
    records.push(...j.records);
    offset = j.offset || null;
    if (offset) await new Promise(res => setTimeout(res, 250));
  } while (offset);
  return records;
}

const q = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(headers, records) {
  const lines = [headers.map(q).join(',')];
  for (const rec of records) lines.push(headers.map(h => q(rec.fields[h])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---- 인용 지원 CSV 헤더(첫 줄)만 파싱 ----
function parseHeaderLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function existingHeaders(file) {
  const p = path.join('CSV', file);
  if (!fs.existsSync(p)) return null;
  const first = fs.readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0];
  return parseHeaderLine(first);
}
// ---- 기존 CSV 전체 행 파싱 (수동 컬럼 보존용) ----
function existingRows(file) {
  const p = path.join('CSV', file);
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (inQ) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ---- 덮어쓰기 전 아카이브: 일반 주차 아카이브 + (sup.csv) 월간 스냅샷 ----
function archiveBeforeOverwrite(file) {
  const p = path.join('CSV', file);
  if (!fs.existsSync(p)) return; // 최초 실행 — 보존할 이전 버전 없음

  const commitDate = lastCommitDate(p) || new Date();

  if (file === 'sup.csv') {
    const y = commitDate.getUTCFullYear(), m = String(commitDate.getUTCMonth() + 1).padStart(2, '0');
    const snap = path.join('CSV_BANK', `sup_${y}_${m}.csv`);
    if (!fs.existsSync(snap)) {
      fs.mkdirSync('CSV_BANK', { recursive: true });
      fs.copyFileSync(p, snap);
      console.log(`  협력사 월간 스냅샷 저장: ${snap}`);
    } else {
      console.log(`  협력사 월간 스냅샷 이미 있음(${y}_${m}) — 건너뜀`);
    }
  }

  const { y, w } = isoWeekOf(commitDate);
  const destDir = path.join('CSV_BANK', wk(y, w));
  fs.mkdirSync(destDir, { recursive: true });
  let dest = path.join(destDir, file);
  if (fs.existsSync(dest)) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const ext = path.extname(file), base = path.basename(file, ext);
    dest = path.join(destDir, `${base}_${stamp}${ext}`);
  }
  fs.renameSync(p, dest);
  console.log(`  아카이브: CSV/${file} → ${dest}`);
}

async function runSource(src) {
  const { key, base, table, view, file } = src;
  if (!base || !table || !view || !file) {
    console.log(`[${key || '?'}] base/table/view/file 중 누락된 값이 있어 건너뜁니다.`);
    return false;
  }
  console.log(`[${key}] base="${base}" table="${table}" view="${view}" → CSV/${file}`);
  const records = await fetchView(base, table, view);
  console.log(`  ${records.length}건 수신`);
  if (!records.length) {
    console.warn(`  레코드 0건 — 파일을 건드리지 않고 건너뜁니다(기존 CSV 유지).`);
    return false;
  }
  const apiFields = [...new Set(records.flatMap(r => Object.keys(r.fields)))];
  let headers = existingHeaders(file);
  if (!headers) {
    headers = apiFields;
    console.log(`  기존 CSV 없음 — API 필드 순 헤더 사용(${headers.length}개)`);
  } else {
    // v22.2 감사 수정: 기존 헤더를 그대로 동결하면 Airtable에 새로 생긴 필드가 영영 CSV에 못
    // 들어오고, 그 상태로는 "내용 동일" 판정에도 걸려 갱신 자체가 스킵됨 — 기존 순서 유지 +
    // 신규 필드를 뒤에 병합(대시보드 파서는 이름 기반이라 뒤 추가는 안전)
    const added = apiFields.filter(h => !headers.includes(h));
    if (added.length) { headers = headers.concat(added); console.log(`  신규 필드 ${added.length}개 헤더 뒤에 추가: ${added.join(', ')}`); }
    console.log(`  헤더 재사용(${headers.length}개 컬럼)`);
    // v22.4: 수동 컬럼 보존 — 기존 CSV에는 있지만 Airtable API가 반환하지 않는 컬럼(예: sup.csv의
    // '업태'·'인쇄' — 원천 테이블에 없어 수기로 삽입한 데이터)은 첫 컬럼(예: '협력사 이름') 값으로
    // 기존 행과 매칭해 값을 이월한다. 이 보존이 없으면 자동 갱신이 돌 때마다 수기 데이터가 지워짐.
    const manualCols = headers.filter(h => !apiFields.includes(h));
    if (manualCols.length) {
      const keyField = src.keyField || headers[0];
      const prev = existingRows(file);
      if (prev && prev.length > 1) {
        const ph = prev[0]; const pKey = ph.indexOf(keyField);
        const pIdx = manualCols.map(c => ph.indexOf(c));
        if (pKey !== -1) {
          const prevMap = {};
          prev.slice(1).forEach(r => { const k = String(r[pKey] || '').trim(); if (k) prevMap[k] = r; });
          let carried = 0;
          records.forEach(rec => {
            const k = String(rec.fields[keyField] ?? '').trim();
            const old = k ? prevMap[k] : null; if (!old) return;
            manualCols.forEach((c, i) => {
              const ov = pIdx[i] !== -1 ? old[pIdx[i]] : '';
              if (ov && (rec.fields[c] == null || String(rec.fields[c]).trim() === '')) { rec.fields[c] = ov; carried++; }
            });
          });
          console.log(`  수동 컬럼 ${manualCols.length}개 보존(${manualCols.join(', ')}) — 키 '${keyField}' 매칭으로 ${carried}개 값 이월`);
        }
      }
    }
  }
  const csvText = toCsv(headers, records);

  // 변경 없음이면 아카이브/덮어쓰기 자체를 건너뛴다 — stockout_list처럼 갱신이
  // 뜸한 소스가 매주 똑같은 내용으로 CSV_BANK를 채우는 것을 방지.
  const curPath = path.join('CSV', file);
  if (fs.existsSync(curPath) && fs.readFileSync(curPath, 'utf8') === csvText) {
    console.log(`  이전과 동일한 내용 — 변경 없음, 건너뜀`);
    return false;
  }

  archiveBeforeOverwrite(file); // 새 데이터를 쓰기 전에 이전 버전부터 보존
  fs.mkdirSync('CSV', { recursive: true });
  fs.writeFileSync(curPath, csvText);
  console.log(`  저장: CSV/${file}`);
  return true;
}

let changed = false;
for (const src of SOURCES) {
  try {
    changed = (await runSource(src)) || changed;
  } catch (e) {
    console.error(`[${src.key || '?'}] 실패: ${e.message}`);
    // 한 소스 실패가 나머지 소스를 막지 않도록 계속 진행
  }
}
console.log(changed ? '완료 — 커밋 대상 변경 있음' : '완료 — 변경 없음');
