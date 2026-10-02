// ============================================================================
// 지출결의 원장 → data/data_hist.json 월별 매입 집계 병합 (v1.0, 2026-09-14)
//
// 2024~2025는 Task 일부가 소실돼 발주 행 공급가액 합계가 원장보다 작다(2024 실측 73.6억 vs 82.9억).
// 사용자 확정(2026-09-14): 이 두 해의 매입금액은 소실 전 지출결의 원장 기준으로 본다.
// 대시보드는 data_hist.json의 달(HIST_AGG)을 매입 합계·협력사별 매입의 정답으로 쓰고,
// 발주 행이 있는 해는 제품·굿즈 분해만 행 기준으로 남긴다(index.html histAggOnlyMonths 참고).
//
// 사용: node scripts/merge_ledger_months.mjs <연도> <지출결의.csv> [다른 해 지출결의.csv ...]
//   · 넘긴 파일을 모두 읽어 제목+수주처+세금계산서월+금액으로 중복 제거한다
//     (파일이 결제 연도로 나뉘어 연말·연초 건이 두 파일에 겹친다 — build_history.mjs와 같은 키).
//   · 세금계산서작성월로 버킷팅해 <연도>의 달만 덮어쓴다. 다른 해 계산서월 건은 버린다 —
//     예: 2024 파일의 «25년 1월» 164건은 2025년 매입이므로, 2025를 병합할 때 2024 파일을 함께 넘긴다.
//   · 금액 = 총금액_합계(VAT 포함, 비면 총금액_합계계산) ÷ 1.1. 여러 달에 걸친 계산서는 균등 분할.
// ============================================================================
import fs from 'node:fs';

const [year, ...files] = process.argv.slice(2);
if (!/^\d{4}$/.test(year || '') || !files.length) {
  console.error('사용: node scripts/merge_ledger_months.mjs <연도> <지출결의.csv> [...]');
  process.exit(1);
}
const VAT = 1.1, OUT = 'data/data_hist.json';

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.some(x => x && x.trim())).map(r => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ''])));
}
const pa = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
const taxMonths = s => [...String(s || '').matchAll(/(\d{2})년\s*(\d{1,2})월/g)].map(m => `20${m[1]}.${+m[2]}`);

const seen = new Set(), months = {};
let rowsIn = 0, dup = 0, other = 0;
for (const f of files) {
  for (const r of parseCSV(fs.readFileSync(f, 'utf8'))) {
    rowsIn++;
    const amt = pa(r['총금액_합계'] !== '' && r['총금액_합계'] !== undefined ? r['총금액_합계'] : r['총금액_합계계산']);
    const sup = (r['수주처'] || '').trim(), key = [r['제목'] || '', sup, r['세금계산서작성월'] || '', amt].join('|');
    if (seen.has(key)) { dup++; continue; }
    seen.add(key);
    const ms = taxMonths(r['세금계산서작성월']);
    if (!ms.some(m => m.startsWith(year + '.'))) { other++; continue; }
    for (const m of ms) {
      if (!m.startsWith(year + '.')) continue;
      const b = (months[m] ??= { purchase: 0, purCnt: 0, bySup: {} }), share = amt / VAT / ms.length;
      b.purchase += share; b.purCnt++;
      if (sup) b.bySup[sup] = (b.bySup[sup] || 0) + share;
    }
  }
}
for (const [m, b] of Object.entries(months)) {
  // 계산서월이 잘못 찍힌 단발 행이 가짜 저점을 만들지 않게 5건 미만 달은 뺀다(build_history.mjs와 동일)
  if (b.purCnt < 5) { delete months[m]; continue; }
  b.purchase = Math.round(b.purchase);
  for (const s of Object.keys(b.bySup)) b.bySup[s] = Math.round(b.bySup[s]);
}

const hist = JSON.parse(fs.readFileSync(OUT, 'utf8'));
for (const m of Object.keys(hist.order)) if (m.startsWith(year + '.')) delete hist.order[m];
Object.assign(hist.order, months);
const ledgerYears = [...new Set(Object.keys(hist.order).map(m => m.split('.')[0]))].sort();
hist.meta.basis = '지출결의 총금액 ÷ 1.1 (VAT 제외 환산), 세금계산서작성월 기준';
hist.meta.note = `매입 합계·협력사별 매입은 ${ledgerYears.join('·')}년 이 집계가 정답이다. 발주 행 원본이 없는 해(2022~2023)는 이 집계만 존재하고, 발주 행이 있는 해(2024~)는 Task 일부 소실로 원장 기준을 쓰되 제품·굿즈 분해는 발주 행 기준으로 남는다(사용자 확정 2026-09-14).`;
hist.meta.generated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, JSON.stringify(hist), 'utf8');

const tot = Object.values(months).reduce((s, b) => s + b.purchase, 0);
console.log(`${year}: ${Object.keys(months).length}개월 · ${tot.toLocaleString()}원 · 원장 ${rowsIn}행(중복 ${dup} · 다른 해 계산서월 ${other}행 제외)`);
