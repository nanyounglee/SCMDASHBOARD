// 매입 지출결의 원장 기준 자체검증 — node test_ledger_hist.mjs
// 2024는 Task 일부 소실로 매입 합계·협력사별 매입을 지출결의 원장(data/data_hist.json)으로 덮는다(사용자 확정 2026-09-14).
// 발주 행이 있는 해의 굿즈·제품 분해까지 지워지거나, 원장↔발주 행 경계에서 기준이 다른 YoY가 나오면 여기서 깨진다.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

// ① 산출물: 2024 12개월 = 원장 계산서월 2024년분 ÷1.1 («25년 1월» 164건은 2025년 몫이라 제외), 2022~2023 유지
const hist = JSON.parse(fs.readFileSync('data/data_hist.json', 'utf8'));
const monthsOf = y => Object.keys(hist.order).filter(m => m.startsWith(y + '.'));
const sumY = y => monthsOf(y).reduce((s, m) => s + hist.order[m].purchase, 0);
assert.strictEqual(sumY(2024), 8293795698, '2024 원장 합계');
assert.strictEqual(monthsOf(2024).length, 12);
assert.strictEqual(monthsOf(2022).length + monthsOf(2023).length, 19, '2022~2023 집계 유지');

// ② 화면 규칙 — 대시보드 스크립트를 DOM 스텁 위에서 실행
const html = fs.readFileSync('index.html', 'utf8').split('\n');
const start = html.findIndex((l, i) => i > 500 && l.trim() === '<script>');
const end = html.findIndex((l, i) => i > start && l.trim() === '</script>');
const els = {};
const el = id => (els[id] ??= { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, getContext: () => ({}), querySelectorAll: () => [], querySelector: () => null });
let chart = null;
const ctx = vm.createContext({
  console, document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
  URLSearchParams, location: { search: '' }, navigator: { userAgent: '' },
  Chart: function (c, cfg) { chart = cfg; this.destroy = () => {}; }, fetch: () => new Promise(() => {}),
  localStorage: { getItem: () => null, setItem() {} }, setTimeout: () => 0, setInterval: () => 0, clearInterval() {},
});
ctx.window = ctx; ctx.addEventListener = () => {};
try { vm.runInContext(html.slice(start + 1, end).join('\n'), ctx); } catch (e) { /* DOM 의존 초기화 실패는 무시 */ }
const run = code => vm.runInContext(code, ctx);
run(`(()=>{
  HIST_AGG={'2023.5':{purchase:10,purCnt:5,bySup:{'A사':10}}, '2024.3':{purchase:130,purCnt:5,bySup:{'A사':130}}}; HIST_ISSUE={};
  const row=(d,tax,amt)=>({'과업지시일자':d,'세금계산서작성월 (from 지출결의)':tax,'공급가액':String(amt),'수주처':'A사','sync_itemdb':'ABCD_1'});
  D.order=[row('2026.03.05','26년 3월',70)];
  D.orderHist=[row('2024.03.02','24년 3월',100), row('2024.12.20','25년 1월',50), row('2025.03.10','25년 3월',90)];
  D.issue=[]; D.issueHist=[];
})()`);

const M = run('buildYearlyBuckets()');
assert.strictEqual(M['2024.3'].purchase, 130, '원장 달은 발주 행 합계를 덮는다');
assert.strictEqual(M['2024.3'].purAgg, true);
assert.strictEqual(M['2025.1'].purchase, 50, '다음 해 계산서월 건은 다음 해 매입');
assert.strictEqual(M['2025.1'].purAgg, false);
assert.deepStrictEqual(Array.from(run('[...histAggOnlyMonths()]')), ['2023.5'], '발주 행이 있는 2024는 «원장만 있는 달»이 아니다');

// 연도별 실적 비교: 원장(2024)↔발주 행(2025) 경계의 매입 YoY는 «—», 같은 기준(2025↔2026)은 유지
el('yoy-years-mode').value = 'full';
run('renderYearlyYoY()');
const trs = els['tb-yoy-years'].innerHTML.split('<tr').slice(1);
const cells = y => { const tr = trs.find(t => t.includes(`<td>${y}`)); assert(tr, `${y} 행 없음`); return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]); };
assert(cells(2024)[3].includes('지출결의 원장 기준'), '2024 매입에 원장 «집계» 태그');
assert(cells(2025)[4].includes('—') && !cells(2025)[4].includes('%'), '원장↔발주 행 경계 매입 YoY는 비교하지 않음');
assert(cells(2026)[4].includes('-22.2%'), '같은 기준끼리는 매입 YoY 유지');
assert(els['yoy-years-note'].innerHTML.includes('매입 YoY 일부'));

// 매입 추이: 합산·협력사별은 원장 값, 굿즈코드별은 2024 발주 행 값을 남기고 행 없는 2023 달만 뺀다
const valueAt = (label, mo) => { const L = chart.data.labels; assert.strictEqual(new Set(L).size, L.length, '축 라벨 중복');
  const i = L.indexOf(run(`fmtMonthShort('${mo}')`)); assert(i >= 0, `${mo} 축 없음`); return chart.data.datasets.find(d => d.label === label).data[i]; };
el('purchase-trend-unit').value = 'monthly';
el('purchase-trend-type').value = 'monthly'; run('renderPurchaseTrend()');
assert.strictEqual(valueAt('매입금액', '2024.3'), 130);
el('purchase-trend-type').value = 'supplier'; run('renderPurchaseTrend()');
assert.strictEqual(valueAt('A사', '2024.3'), 130, '협력사별 2024는 원장 값');
el('purchase-trend-type').value = 'goods'; run('renderPurchaseTrend()');
assert.strictEqual(valueAt('ABCD', '2024.3'), 100, '굿즈코드별 2024는 발주 행 값 유지');
assert(!chart.data.labels.includes(run(`fmtMonthShort('2023.5')`)), '발주 행 없는 2023 달은 굿즈코드별에서 제외');

// 월 드릴다운: 2024 달은 제품 표를 남기고, 2023 달만 제품 분해 불가
run(`openModal('purchaseMonth','2024.3')`);
assert(els['modal-body'].innerHTML.includes('제품은 원장에 정보가 없어'), '2024 달 안내');
assert(!els['modal-body'].innerHTML.includes('제품 분해 불가'));
run(`openModal('purchaseMonth','2023.5')`);
assert(els['modal-body'].innerHTML.includes('제품 분해 불가'), '2023 달은 제품 분해 불가');

console.log('OK — 매입 원장 기준: 2024 = 8,293,795,698원(12개월) · 원장↔발주 행 경계 YoY 생략 · 2024 굿즈/제품 분해 유지');
