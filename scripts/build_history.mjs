// ============================================================================
// 과거 이력(2022~2024) 빌드 — Airtable 수동 export CSV를 대시보드가 이미 읽는
// 두 가지 포맷으로 변환한다.
//
//  1) CSV_BANK/archive/2024/order_2024.csv
//     "Raw Data_Task (2024).csv"(13,145행, 행 단위)에 지출결의 CSV에서 조인한
//     '세금계산서작성월 (from 지출결의)' 컬럼을 붙여 2025 아카이브와 동일 스키마로 만든다.
//     → 제품별 발주추이·협력사별 매입추이·굿즈코드별 추이가 전부 기존 코드로 동작.
//
//  2) data/data_hist.json
//     2022~2023은 행 단위 소스가 없다(2023 Task export는 이슈 발생 건만 담긴 787행 부분집합,
//     2022는 Task export 자체가 없음). 지출결의 CSV만으로 월별 집계(purchase/bySup)를 만든다.
//     data_2025.json과 같은 모양이라 대시보드에서 같은 조회 함수로 읽는다.
//
// 기준 차이(대시보드 각주에도 표기됨):
//   2024~ = 발주 행의 공급가액(VAT 제외), 2022~2023 = 지출결의 총금액 ÷ 1.1.
//   2025년 실측 비교상 발주 기준이 지출결의 기준의 88~97% 수준 — 지출결의가 배송비·
//   비굿즈 지출까지 포함하기 때문. 연도 경계에서 그만큼 단차가 생길 수 있다.
//
// 실행: node scripts/build_history.mjs
//   SRC_DIR 환경변수로 CSV 위치 지정(기본 ~/Downloads)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SRC = process.env.SRC_DIR || path.join(os.homedir(), 'Downloads');
const VAT = 1.1;

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
      else if (c !== '\r') cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() || [];
  return {
    header,
    rows: rows.filter(r => r.some(x => x && x.trim()))
      .map(r => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ''])))
  };
}
const esc = v => /[",\n\r]/.test(v ?? '') ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');
const toCSV = (header, rows) =>
  '﻿' + [header.join(','), ...rows.map(r => header.map(h => esc(r[h])).join(','))].join('\n') + '\n';

const pa = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
// "24년 11월" / "25년11월" → "2024.11". 한 셀에 여러 월이 올 수 있어 배열로 돌려준다.
function taxMonths(s) {
  const out = []; const re = /(\d{2})년\s*(\d{1,2})월/g; let m;
  while ((m = re.exec(s || ''))) out.push(`20${m[1]}.${+m[2]}`);
  return out;
}
const read = f => {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) throw new Error(`소스 없음: ${p}`);
  return parseCSV(fs.readFileSync(p, 'utf8'));
};

// ---------------------------------------------------------------- 지출결의 병합
// 파일이 결제 연도로 나뉘어 있어 연말·연초 건이 두 파일에 겹쳐 들어온다(2024↔2025 198건 실측).
// 제목+수주처+세금계산서월+금액으로 중복 제거한 뒤 세금계산서작성월로 다시 버킷팅한다.
const seen = new Set();
const journal = [];
for (const y of [2022, 2023, 2024, 2025]) {
  const { rows } = read(`SCM_raw data_지출결의(${y}).csv`);
  for (const r of rows) {
    const amt = pa(r['총금액_합계'] !== undefined && r['총금액_합계'] !== '' ? r['총금액_합계'] : r['총금액_합계계산']);
    const rec = { title: r['제목'] || '', sup: (r['수주처'] || '').trim(), month: r['세금계산서작성월'] || '', amt, task: r['task'] || '', po: r['발주번호'] || '' };
    const k = `${rec.title}|${rec.sup}|${rec.month}|${rec.amt}`;
    if (seen.has(k)) continue;
    seen.add(k);
    journal.push(rec);
  }
}
console.log(`지출결의 병합: ${journal.length}건 (중복 제거 후)`);

// ------------------------------------------------- 1) order_2024.csv (행 단위)
const taxByTask = {}, taxByPO = {};
for (const r of journal) {
  if (!r.month) continue;
  for (const t of r.task.split(',').map(s => s.trim()).filter(Boolean)) (taxByTask[t] ??= []).push(r.month);
  for (const p of r.po.split(',').map(s => s.trim()).filter(Boolean)) (taxByPO[p] ??= []).push(r.month);
}
const TAX_COL = '세금계산서작성월 (from 지출결의)';
const t24 = read('Raw Data_Task (2024).csv');
// «과업지시서»는 Airtable 첨부 URL이라 이 export 본문의 46%(5MB)를 혼자 차지하는데
// 대시보드는 읽지 않는다. 나머지 컬럼은 2025 아카이브보다 넓으므로(산출물_옵션·과업지시상태·
// 발주담당자 등) 그대로 살려둔다 — 좁히면 옵션 분석 같은 화면이 2024년만 비게 된다.
// 「(기능) 시안이슈_시안링크(ai/pdf)」는 Dropbox 공유 링크(115행)인데 대시보드가 읽지 않는다.
// GitHub Pages로 공개되는 저장소라 쓰지도 않는 공유 링크를 늘릴 이유가 없어 함께 뺀다.
const DROP = ['과업지시서', '(기능) 시안이슈_시안링크(ai/pdf)'];
const outHeader = [...t24.header.filter(h => !DROP.includes(h)), ...(t24.header.includes(TAX_COL) ? [] : [TAX_COL])];
let joined = 0;
for (const r of t24.rows) {
  const hit = taxByTask[r['task_id']] || taxByPO[(r['발주번호'] || '').trim()];
  // 미매칭 행은 빈 값으로 둔다 — 2025 아카이브에도 지출결의 미연결 행(1,408건)이 같은 상태로 있고,
  // 매입 집계에서 자연히 빠지는 것이 과업지시월로 대체 추정하는 것보다 기준이 일관된다.
  r[TAX_COL] = hit ? [...new Set(hit)].join(', ') : '';
  if (hit) joined++;
}
const destDir = path.join('CSV_BANK', 'archive', '2024');
fs.mkdirSync(destDir, { recursive: true });
fs.writeFileSync(path.join(destDir, 'order_2024.csv'), toCSV(outHeader, t24.rows), 'utf8');
console.log(`order_2024.csv: ${t24.rows.length}행, 세금계산서월 조인 ${joined}건 (${(joined / t24.rows.length * 100).toFixed(1)}%)`);

// -------------------------------------------- 2) data_hist.json (2022~2023 집계)
const order = {};
for (const r of journal) {
  const months = taxMonths(r.month);
  if (!months.length) continue;
  if (+months[0].split('.')[0] >= 2024) continue; // 2024~ 는 행 단위 아카이브가 담당
  const share = r.amt / VAT / months.length;
  for (const m of months) {
    const b = (order[m] ??= { purchase: 0, purCnt: 0, bySup: {} });
    b.purchase += share;
    b.purCnt++;
    if (r.sup) b.bySup[r.sup] = (b.bySup[r.sup] || 0) + share;
  }
}
for (const b of Object.values(order)) {
  b.purchase = Math.round(b.purchase);
  for (const s of Object.keys(b.bySup)) b.bySup[s] = Math.round(b.bySup[s]);
}
// 세금계산서월이 잘못 찍힌 단발 행(2022.3 1건 / 2022.4 2건 실측)은 추이선에 0에 가까운
// 가짜 저점으로 그려진다. 5건 미만 월은 실제 영업월이 아니므로 뺀다.
for (const [m, b] of Object.entries(order)) if (b.purCnt < 5) delete order[m];

// 이슈 export(2023/2024)는 movement 단위 issue.csv와 스키마가 달라(이슈카테고리 없음)
// 카테고리 분해가 불가능하다. 월별 총건수만 담는다.
const issue = {};
for (const y of [2023, 2024]) {
  for (const r of read(`Raw Data_이슈 (${y}).csv`).rows) {
    const m = String(r['과업지시일자'] || '').match(/^(\d{4})\.(\d{1,2})/);
    if (!m) continue;
    const k = `${m[1]}.${+m[2]}`;
    (issue[k] ??= { total: 0 }).total++;
  }
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/data_hist.json', JSON.stringify({
  meta: {
    basis: '지출결의 총금액 ÷ 1.1 (VAT 제외 환산), 세금계산서작성월 기준',
    note: '2024년 이후는 CSV_BANK/archive/{연도}/order_{연도}.csv 행 단위 데이터가 담당한다. 2022~2023은 행 단위 소스가 없어 이 집계만 존재하므로 협력사·합산 매입금액만 조회 가능하다.',
    issueNote: '이슈는 과업지시월 기준 총건수만 — export 스키마에 이슈카테고리가 없어 품질/수량/운영 분해 불가.',
    generated: new Date().toISOString().slice(0, 10)
  },
  order, issue
}, null, 0), 'utf8');

const ms = Object.keys(order).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
console.log(`data_hist.json: ${ms.length}개월 (${ms[0]}~${ms[ms.length - 1]}), 매입 합계 ${Object.values(order).reduce((s, b) => s + b.purchase, 0).toLocaleString()}원`);
console.log(`  이슈 집계 ${Object.keys(issue).length}개월`);
