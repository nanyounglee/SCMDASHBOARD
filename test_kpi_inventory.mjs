// 재고 KPI 정합 자체검증 — node test_kpi_inventory.mjs
// (v23.38: 3M 회전율(실측 0.45~1.07)을 연간 목표 6과, SKU 기준 품절률을 굿즈 기준 목표 3%와
//  비교하던 정의 불일치 회귀 방지 — 목표축이 다시 섞이면 여기서 깨진다)
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');
const start = lines.findIndex((l, i) => i > 500 && l.trim() === '<script>');
const end = lines.findIndex((l, i) => i > start && l.trim() === '</script>');
assert(start > 0 && end > start, '메인 <script> 블록을 찾지 못함');

const store = {};
const ctx = vm.createContext({
  console, document: { addEventListener: () => {}, getElementById: () => null }, window: {},
  Chart: function () {}, URLSearchParams, location: { search: '' },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
});
try { vm.runInContext(lines.slice(start + 1, end).join('\n'), ctx); }
catch (e) { if (!/document|window|Chart|location/.test(String(e))) throw e; }

const KPI_DEFS = vm.runInContext('KPI_DEFS', ctx);
const computeKPIs = vm.runInContext('computeKPIs', ctx);
const D = vm.runInContext('D', ctx);

// 실제 사전집계 CSV 투입
const txt = fs.readFileSync('CSV/dashboard_period_summary.csv', 'utf8').replace(/^\uFEFF/, '');
const [head, ...body] = txt.trim().split(/\r?\n/);
const cols = head.split(',');
D.dashboard_period_summary = body.map(l => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
// 체화 비율·품절 해소일은 스냅샷/출시일/품절이력이 있어야 산출된다 — 파서는 대시보드 것을 재사용
const parseCSV = vm.runInContext('parseCSV', ctx);
for (const k of ['dashboard_sku_snapshot', 'parts_master', 'sales_status_history']) {
  D[k] = parseCSV(fs.readFileSync(`CSV/${k}.csv`, 'utf8'));
}

const def = id => KPI_DEFS.find(d => d.id === id);
const { current } = computeKPIs();
const latest = D.dashboard_period_summary.filter(r => r.period_unit === 'weekly').pop();

// ① 3M 회전율은 3M 목표축(1.0)과 비교한다 — 연간 목표 6이 붙어 있으면 정의상 영구 미달
assert.strictEqual(def('inv_turnover').target, 1, '3M 회전율 목표가 3M 기준이 아님');
assert.strictEqual(current.inv_turnover, +latest.turnover_3m, '3M 회전율 값이 turnover_3m가 아님');
assert(current.inv_turnover > 0.3 && current.inv_turnover < 2, '3M 회전율 실측 범위(0.3~2) 이탈');

// ② 연간 목표 6은 연환산 지표에만 붙는다
const yr = def('inv_turnover_yr');
assert(yr && yr.target === 6, '연환산 회전율 지표(target 6) 없음');
const base = new Date(...latest.base_date.split('-').map((v, i) => i === 1 ? +v - 1 : +v));
const elapsed = (base - new Date(base.getFullYear(), 0, 1)) / 86400000 + 1;
const expect = +latest.turnover_ytd * 365 / elapsed;
assert(Math.abs(current.inv_turnover_yr - expect) < 1e-9, `연환산 회전율 불일치: ${current.inv_turnover_yr} ≠ ${expect}`);
assert(current.inv_turnover_yr > +latest.turnover_ytd, '연환산이 YTD보다 작음 — 경과일수 계산 오류');

// ③ 품절률은 SKU 기준 — 굿즈 기준 목표 3%를 그대로 쓰고 있으면 축이 다시 섞인 것
assert.notStrictEqual(def('inv_stockout').target, 3, '품절률 목표가 굿즈 기준 3% 그대로');
assert.strictEqual(current.inv_stockout, +latest.stockout_rate * 100, '품절률 값이 stockout_rate가 아님');
assert(Math.abs(current.inv_stockout - (+latest.stockout_count / +latest.managed_count * 100)) < 0.01,
  '품절률 분모가 관리대상 SKU(managed_count)가 아님');

// ④ 목표 입력칸이 소수 목표(1.0/2.5/98.44)를 받을 수 있어야 한다
assert(/value="\$\{d\.target\}" step="any"/.test(html), '목표값 입력 step이 정수 고정');

// ④-2 도움말의 지표 수는 KPI_DEFS와 맞아야 한다 (12로 하드코딩된 채 13개였던 이력이 있다)
assert(html.includes(`${KPI_DEFS.length}개 지표`), `도움말 지표 수가 KPI_DEFS(${KPI_DEFS.length})와 불일치`);

// ⑤ 장기미회전 재고 비율 — 분자/분모가 같은 모집단(관리대상 Product Parts)이어야 한다.
//    period_summary.inv_amount(전체 재고)를 분모로 쓰면 비율이 구조적으로 낮게 나온다.
const psrStagnantList_ = vm.runInContext('psrStagnantList_', ctx);
const getAggSkuRows = vm.runInContext('getAggSkuRows', ctx);
const isAggManaged = vm.runInContext('isAggManaged', ctx);
const isAggProduct = vm.runInContext('isAggProduct', ctx);
const toNum = vm.runInContext('toNum', ctx);
const baseRows = getAggSkuRows('weekly', latest.period_key).filter(x => isAggManaged(x) && isAggProduct(x));
const baseAmt = baseRows.reduce((s, x) => s + toNum(x.inv_amount), 0);
const stagAmt = psrStagnantList_('weekly', latest.period_key, latest.base_date)
  .reduce((s, x) => s + x.inventoryAmountValue, 0);
assert(baseAmt > 0 && stagAmt > 0, '체화/모수 재고금액이 0 — 스냅샷 로드 실패');
assert(baseAmt < toNum(latest.inv_amount), '모수가 전체 재고와 같음 — 관리대상 필터가 빠졌다');
assert(Math.abs(current.inv_stagnant - stagAmt / baseAmt * 100) < 1e-9, '체화 비율이 같은 모집단 산식과 불일치');
assert(current.inv_stagnant > 0 && current.inv_stagnant < 100, '체화 비율 범위 이탈');

// ⑥ 품절 해소 소요일 — 미해소 건('end time' 공란)이 섞이면 안 되고, 의도적 품절은 제외
const closed = D.sales_status_history.filter(x => String(x['판매상태']||'').includes('일시품절') && String(x['end time']||'').trim());
assert(closed.length > 50, `해소된 일시품절 표본 부족: ${closed.length}건`);
assert(current.inv_stockout_days > 0 && current.inv_stockout_days < 365, '품절 해소 소요일 범위 이탈');
assert(!D.sales_status_history.some(x => String(x['판매상태']||'') === '의도적 품절' && String(x['end time']||'').trim() === ''
  && current.inv_stockout_days === null), '의도적 품절이 계산에 섞임');

console.log('OK — 3M', current.inv_turnover.toFixed(3), '/ 목표 1  ·  연환산',
  current.inv_turnover_yr.toFixed(2), '/ 목표 6  ·  품절률', current.inv_stockout.toFixed(2) + '%',
  '/ 목표', def('inv_stockout').target + '%');
console.log('     체화', current.inv_stagnant.toFixed(2) + '%', '/ 목표', def('inv_stagnant').target + '%',
  ` (${stagAmt.toLocaleString()} / ${baseAmt.toLocaleString()}원)  ·  품절 해소`,
  current.inv_stockout_days.toFixed(0) + '일', '/ 목표', def('inv_stockout_days').target + '일',
  `(최근 12개월 해소분, 기준 ${latest.base_date})`);
