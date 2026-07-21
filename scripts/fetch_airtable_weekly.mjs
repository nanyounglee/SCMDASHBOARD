// ============================================================================
// Airtable → CSV 주간 자동 커밋 스크립트 (GitHub Actions에서 실행)
// - 진행현황 뷰를 CSV/progress_YYYY_WNN.csv 로, (선택) 매출결산 뷰를
//   CSV/project_YYYY_WNN.csv 로 저장한다. 주차는 Asia/Seoul 기준 ISO 주차.
// - cellFormat=string + timeZone=Asia/Seoul 로 요청해 Airtable UI에 보이는
//   표시 형식 그대로(예: 날짜 2026.7.14) 문자열을 받는다 — 대시보드의
//   기존 CSV 파서/날짜 정규식과 형식이 어긋나지 않도록 하기 위함.
// - 컬럼 순서는 CSV/ 안의 가장 최근 동일 prefix 파일 헤더를 재사용한다
//   (대시보드가 기대하는 컬럼 구성 유지). 기존 파일이 없으면 필드 등장 순.
// - 지난 주차 파일은 CSV_BANK/<연도>_W<주차>/ 로 이동(대시보드 폴백 경로).
//
// 필요 환경변수:
//   AIRTABLE_TOKEN     (secret) data.records:read 스코프의 Personal Access Token
//   AIRTABLE_BASE_ID   예: appkRWtF2j99XgBTq
//   PROGRESS_TABLE     진행현황 테이블 이름 또는 tbl ID
//   PROGRESS_VIEW      진행현황 뷰 이름 또는 viw ID
//   PROJECT_TABLE / PROJECT_VIEW  (선택) 매출결산 테이블·뷰 — 없으면 건너뜀
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
if (!TOKEN || !BASE) { console.log('AIRTABLE_TOKEN / AIRTABLE_BASE_ID 미설정 — 진행현황 자동화를 건너뜁니다.'); process.exit(0); }

// ---- Asia/Seoul 기준 오늘 날짜의 ISO 주차 ----
function seoulToday() {
  const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function isoWeekOf(t) {
  const day = t.getUTCDay() || 7;
  t = new Date(t); t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil((((t - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7);
  return { y, w };
}
const { y: CUR_Y, w: CUR_W } = isoWeekOf(seoulToday());
const wk = (y, w) => `${y}_W${String(w).padStart(2, '0')}`;
console.log(`기준 주차(Asia/Seoul): ${wk(CUR_Y, CUR_W)}`);

// ---- Airtable 전체 레코드 페치 (100건 페이지네이션) ----
async function fetchView(table, view) {
  const records = [];
  let offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}`);
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
    if (offset) await new Promise(res => setTimeout(res, 250)); // rate limit(5 req/s) 여유
  } while (offset);
  return records;
}

// ---- CSV 직렬화 (RFC4180 인용, BOM 포함 — 기존 Airtable 내보내기 파일과 동일) ----
const q = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(headers, records) {
  const lines = [headers.map(q).join(',')];
  for (const rec of records) lines.push(headers.map(h => q(rec.fields[h])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---- 기존 최신 파일에서 헤더 재사용 (대시보드 컬럼 호환 유지) ----
function latestExistingHeaders(prefix) {
  // v22.2 감사 수정: CSV_BANK에는 주차 폴더 외에 파일(sup_YYYY_MM.csv 등)도 놓일 수 있어
  // 디렉토리만 골라야 함 — 파일을 readdirSync 하면 ENOTDIR로 워크플로 전체가 죽음
  const bankDirs = fs.existsSync('CSV_BANK')
    ? fs.readdirSync('CSV_BANK', { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join('CSV_BANK', e.name))
    : [];
  const dirs = ['CSV', ...bankDirs];
  let best = null; // {y,w,file}
  for (const dir of dirs) {
    let files;
    try { files = fs.readdirSync(dir); } catch (e) { continue; }
    for (const f of files) {
      const m = f.match(new RegExp(`^${prefix}_(\\d{4})_W(\\d{2})\\.csv$`));
      if (m) { const y = +m[1], w = +m[2]; if (!best || y > best.y || (y === best.y && w > best.w)) best = { y, w, file: path.join(dir, f) }; }
    }
  }
  if (!best) return null;
  const first = fs.readFileSync(best.file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0];
  // 헤더 행 파싱(인용 지원)
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < first.length; i++) {
    const c = first[i];
    if (inQ) { if (c === '"') { if (first[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  console.log(`  헤더 재사용: ${best.file} (${out.length}개 컬럼)`);
  return out;
}

// ---- 지난 주차 파일을 CSV_BANK/<연도_주차>/ 로 아카이브 ----
function archiveOld(prefix) {
  for (const f of fs.readdirSync('CSV')) {
    const m = f.match(new RegExp(`^${prefix}_(\\d{4})_W(\\d{2})\\.csv$`));
    if (!m) continue;
    const y = +m[1], w = +m[2];
    if (y === CUR_Y && w === CUR_W) continue;
    const destDir = path.join('CSV_BANK', wk(y, w));
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(path.join('CSV', f), path.join(destDir, f));
    console.log(`  아카이브: CSV/${f} → ${destDir}/`);
  }
}

async function runJob(prefix, table, view) {
  console.log(`[${prefix}] 테이블="${table}" 뷰="${view}" 페치 중…`);
  const records = await fetchView(table, view);
  console.log(`  ${records.length}건 수신`);
  if (!records.length) { console.warn(`  레코드 0건 — 파일을 만들지 않고 건너뜁니다(기존 파일 유지).`); return false; }
  const apiFields = [...new Set(records.flatMap(r => Object.keys(r.fields)))];
  let headers = latestExistingHeaders(prefix);
  if (!headers) { // 첫 실행 폴백: 레코드 등장 순 필드
    headers = apiFields;
    console.log(`  기존 파일 없음 — API 필드 순 헤더 사용(${headers.length}개)`);
  } else {
    // v22.2 감사 수정: 기존 헤더를 그대로 동결하면 Airtable에 새로 생긴 필드가 영영 CSV에서
    // 빠짐 — 기존 순서 유지 + 신규 필드를 뒤에 병합(대시보드 파서는 이름 기반이라 뒤 추가는 안전)
    const added = apiFields.filter(h => !headers.includes(h));
    if (added.length) { headers = headers.concat(added); console.log(`  신규 필드 ${added.length}개 헤더 뒤에 추가: ${added.join(', ')}`); }
  }
  const out = path.join('CSV', `${prefix}_${wk(CUR_Y, CUR_W)}.csv`);
  fs.writeFileSync(out, toCsv(headers, records));
  console.log(`  저장: ${out}`);
  archiveOld(prefix);
  return true;
}

let changed = false;
changed = await runJob('progress', process.env.PROGRESS_TABLE, process.env.PROGRESS_VIEW) || changed;
if (process.env.PROJECT_TABLE && process.env.PROJECT_VIEW) {
  changed = await runJob('project', process.env.PROJECT_TABLE, process.env.PROJECT_VIEW) || changed;
} else {
  console.log('[project] PROJECT_TABLE/PROJECT_VIEW 미설정 — 건너뜀');
}
console.log(changed ? '완료 — 커밋 대상 변경 있음' : '완료 — 변경 없음');
