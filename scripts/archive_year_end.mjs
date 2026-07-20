// ============================================================================
// 연말 아카이빙 — 매년 1월 초, 방금 끝난 연도의 CSV/order.csv·issue.csv를
// CSV_BANK/archive/{연도}/order_{연도}.csv·issue_{연도}.csv 로 고정 보존한다.
// 대시보드(index.html의 loadPriorYearArchive())가 이 경로를 연도 하드코딩 없이
// 매년 자동 조회해 YoY 비교에 쓴다 — 이 스크립트만 매년 정상 동작하면 코드 수정 불필요.
//
// 이미 해당 연도 아카이브가 있으면 건드리지 않는다(덮어쓰기로 인한 데이터 유실 방지 —
// 다시 만들고 싶으면 기존 CSV_BANK/archive/{연도}/ 파일을 먼저 지운 뒤 재실행).
//
// 환경변수:
//   ARCHIVE_YEAR (선택) — 아카이빙할 연도를 강제 지정. 비워두면 실행 시점(UTC) 기준
//   "작년"을 자동 계산한다(정기 스케줄은 매년 1/2 00:10 KST에 실행되도록 되어 있어
//   실행 시점의 작년 = 방금 끝난 연도).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const year = process.env.ARCHIVE_YEAR ? parseInt(process.env.ARCHIVE_YEAR, 10) : (new Date().getUTCFullYear() - 1);

// order.csv의 날짜 컬럼(과업지시일자)으로 연도 정합성을 검증하고, 통과해야만
// order/issue 둘 다 아카이빙한다(둘은 같은 시점 스냅샷). issue.csv는 날짜 컬럼명이
// 여러 개(실제입하일/입하예정일 등)라 자체 검증 없이 order 검증 결과를 따른다.
const SOURCES = [
  { live: 'CSV/order.csv', base: 'order' },
  { live: 'CSV/issue.csv', base: 'issue' },
];

function parseCsvLines(text) {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  return { header: lines[0].split(','), rows: lines.slice(1) };
}

function yearSanityCheck(file, dateCol) {
  const text = fs.readFileSync(file, 'utf8');
  const { header, rows } = parseCsvLines(text);
  const idx = header.indexOf(dateCol);
  if (idx === -1 || !rows.length) return { ok: true, reason: '날짜 컬럼 확인 불가 — 검증 생략' };
  let match = 0, total = 0;
  for (const line of rows) {
    const cell = (line.split(',')[idx] || '').trim();
    if (!cell) continue;
    total++;
    if (cell.startsWith(String(year) + '.')) match++;
  }
  if (!total) return { ok: true, reason: '날짜 값 없음 — 검증 생략' };
  const ratio = match / total;
  return { ok: ratio >= 0.5, reason: `${year}년 데이터 비율 ${(ratio * 100).toFixed(0)}%`, ratio };
}

// order.csv의 연도 검증이 전체를 게이트한다 — order/issue는 같은 시점의 스냅샷이라
// order가 이미 새해 데이터로 덮어써졌다면 issue도 마찬가지이므로 함께 중단한다.
const orderCheck = fs.existsSync('CSV/order.csv') ? yearSanityCheck('CSV/order.csv', '과업지시일자') : { ok: false, reason: 'CSV/order.csv 없음' };
if (!orderCheck.ok) {
  console.warn(`연도 검증 실패(${orderCheck.reason}) — CSV/order.csv가 ${year}년 데이터가 아닌 것 같아 전체 아카이빙을 중단합니다. CSV_BANK/{연도}_W##/ 주간 아카이브의 마지막 주차 파일을 수동 복사하세요.`);
  process.exit(0);
}
console.log(`연도 검증 통과(${orderCheck.reason})`);

let changed = false;
for (const { live, base } of SOURCES) {
  const destDir = path.join('CSV_BANK', 'archive', String(year));
  const dest = path.join(destDir, `${base}_${year}.csv`);

  if (fs.existsSync(dest)) {
    console.log(`[${base}] 이미 아카이브됨(${dest}) — 건너뜀`);
    continue;
  }
  if (!fs.existsSync(live)) {
    console.log(`[${base}] ${live} 없음 — 건너뜀`);
    continue;
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(live, dest);
  console.log(`[${base}] 아카이브: ${live} → ${dest}`);
  changed = true;
}

console.log(changed ? `완료 — ${year}년 아카이브 생성됨` : '완료 — 변경 없음(이미 아카이브됨 또는 검증 실패)');
