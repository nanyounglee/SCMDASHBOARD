// 긴급 판정 v2 자체검증 — index.html의 판정 코드를 그대로 뽑아 실제 CSV로 돌린다.
//   실행: node tests/urgent_v2.test.mjs
//   목적: holidays.csv 누락·필드명 변경·롤업 날짜(M/D) 연도 추론이 깨지면 여기서 먼저 터지게 한다.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

// --- 판정 블록 추출 (index.html 원본을 그대로 평가) ---
const START = '  // --- 긴급 판정 v2';
const END = '  const pct = (a, b) => b ? (a / b * 100).toFixed(1) : \'0.0\';';
const s = HTML.indexOf(START), e = HTML.indexOf(END);
assert.ok(s > 0 && e > s, 'index.html에서 긴급 판정 v2 블록을 찾지 못함 — 블록 주석이 바뀌었는지 확인');
const BLOCK = HTML.slice(s, e + END.length);

// --- 대시보드 쪽 의존 함수/객체 (index.html과 동일 동작) ---
function parseAnyDate(v) {
  if (!v) return null;
  const t = String(v).trim();
  const m1 = t.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/); if (m1) return new Date(+m1[1], m1[2] - 1, +m1[3]);
  const m2 = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m2) return new Date(+m2[1], m2[2] - 1, +m2[3]);
  const d = new Date(t); return isNaN(d) ? null : d;
}
const pick = (r, k) => Array.isArray(k) ? (k.map(x => r[x]).find(v => v != null && String(v).trim() !== '') ?? '') : (r[k] ?? '');
const F = {
  order: {
    date: '과업지시일자',
    urgent: '긴급여부',
    leadTime: '현 주문수량_아이템 총 제작 리드타임 (from order)',
    pkgDate: ['임가공일자', '임가공 예정일(+요일) Rollup (from Packaging_Schedule) Rollup (from project)'],
    sample: '샘플(OS) 여부',
  },
};

// --- CSV 파서 (따옴표·개행 포함) ---
function parseCSV(txt) {
  const rows = []; let row = [], cur = '', q = false;
  txt = txt.replace(/^﻿/, '');
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const csv = p => parseCSV(readFileSync(new URL(p, import.meta.url), 'utf-8'));

const D = { holidays: csv('../CSV/holidays.csv') };
// W36 회차 아카이브 CSV로 고정 — 현행 order.csv는 사후 입력으로 매주 늘어나 게재값과 어긋난다
const order = csv('../CSV_BANK/2026_W36/order.csv');

// --- 블록 평가 ---
const urgV2 = new Function('D', 'F', 'pick', 'parseAnyDate',
  BLOCK + '\n; return { urgV2, HOLIDAYS, holidayCovers, addBizDays, isBizDay };'
)(D, F, pick, parseAnyDate);

// --- 1. 공휴일 로드 ---
assert.ok(urgV2.HOLIDAYS.set.size >= 15, 'holidays.csv가 비었거나 파싱 실패');
assert.ok(urgV2.holidayCovers(2026), '2026년 공휴일이 holidays.csv에 없음');
assert.equal(urgV2.isBizDay(new Date(2026, 8, 25)), false, '추석(9/25)이 영업일로 잡힘');
assert.equal(urgV2.isBizDay(new Date(2026, 8, 23)), true, '9/23(수)이 비영업일로 잡힘');
assert.equal(urgV2.isBizDay(new Date(2026, 7, 17)), false, '광복절 대체(8/17)가 영업일로 잡힘');

// --- 2. 영업일 가산에 공휴일 반영 ---
//   9/23(수) + 2영업일 → 9/24·25(추석) · 9/26·27(주말) · 9/28(대체공휴일)을 건너뛰어 9/30(수).
//   주말만 제외하면 9/25(금)이 나온다.
assert.deepEqual(urgV2.addBizDays(new Date(2026, 8, 23), 2), new Date(2026, 8, 30),
  '추석 연휴·대체공휴일을 건너뛰지 못함');

// --- 3. 실제 주간 집계 — 구조·범위만 검증 ---
//   원천 order.csv는 사후 입력으로 매주 늘어나 게재값(W36 긴급 18·고위험 7)을 고정 assert하면 매주 깨진다.
//   여기서는 판정이 "돌아가고 있는가"(판정가능 건이 충분하고 긴급⊂판정가능, 고위험⊂긴급, 상세표 필드 존재)만 본다.
const isStock = r => String(r['(기능)재고생산프로젝트'] || '').includes('재고생산');
const inWin = (r, a, b) => { const d = parseAnyDate(r['과업지시일자']); return d && d >= a && d <= b; };
const proj = (a, b) => order.filter(r => inWin(r, a, b) && !isStock(r));

const W36 = urgV2.urgV2(proj(new Date(2026, 7, 28), new Date(2026, 8, 3)));
assert.ok(W36.n >= 150, `W36 판정가능 건이 너무 적음(${W36.n}) — 리드타임/임가공일 필드명 변경 의심`);
assert.ok(W36.urg > 0 && W36.urg <= W36.n, `W36 긴급 ${W36.urg} / 판정가능 ${W36.n}`);
assert.ok(W36.hr <= W36.urg && W36.unreq <= W36.urg, '고위험·미신청은 긴급의 부분집합이어야 함');
assert.equal(W36.rows.length, W36.urg, 'rows는 긴급 건만 담아야 함');
const r0 = W36.rows[0];
assert.ok(r0 && r0.oi instanceof Date && r0.pkg instanceof Date && typeof r0.lead === 'number' && typeof r0.over === 'number',
  '7-D 상세표 필드(oi·pkg·lead·over)가 rows에 없음');

console.log(`OK — 공휴일 ${urgV2.HOLIDAYS.set.size}일 로드`);
console.log(`   W36 판정가능 ${W36.n} · 긴급 ${W36.urg}(${(W36.urg / W36.n * 100).toFixed(1)}%) · 고위험 ${W36.hr} · 미신청 ${W36.unreq}`);
