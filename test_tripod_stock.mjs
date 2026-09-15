// 캘린더 삼각대 재고 차감 자체검증 — node test_tripod_stock.mjs
// 2026-09-14 기준 재고에서 이후 발주행(sync_itemdb에 삼각대 PT)의 발주지시수량을 뺀다(사용자 지시 2026-09-14).
// 기준일 경계·공용 재고·재고생산 제외가 틀리면 종합 현황의 잔여 재고가 조용히 틀어진다.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const html = fs.readFileSync('index.html', 'utf8').split('\n');
const start = html.findIndex((l, i) => i > 500 && l.trim() === '<script>');
const end = html.findIndex((l, i) => i > start && l.trim() === '</script>');
assert(start > 0 && end > start, '메인 <script> 블록을 찾지 못함');

const noop = () => {};
const ctx = vm.createContext({
  console, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: noop },
  URLSearchParams, location: { search: '' }, navigator: { userAgent: '' },
  Chart: function () { this.destroy = noop; }, fetch: () => Promise.reject(0),
  localStorage: { getItem: () => null, setItem: noop }, setTimeout, setInterval: () => 0, clearInterval: noop,
});
ctx.window = ctx; ctx.addEventListener = noop;
try { vm.runInContext(html.slice(start + 1, end).join('\n'), ctx); } catch (e) { /* DOM 의존 초기화 실패는 무시 */ }
const { tripodStock } = ctx;
assert(typeof tripodStock === 'function', 'tripodStock 로드 실패');

const row = (date, qty, items, project = 'PNA1-고객') => ({ '과업지시일자': date, '발주지시수량': String(qty), sync_itemdb: items, project });
const s = tripodStock([
  row('2026.9.13', 100, 'EDCD_PT1399-에디트캘린더_삼각대_그레이'),                        // 기준일 전 → 제외
  row('2026.9.14', 110, 'EDCD_PT1399-에디트캘린더_삼각대_그레이, EDCD_PT1399-중복'),     // 기준일 당일 포함 · 같은 PT 중복은 1회
  row('2026.10.1', 300, 'PIPR_PT2804-페이퍼링캘린더_삼각대_그레이'),                     // 그레이 공용
  row('2026.11.2', 200, 'CALD_PT5571-페어링캘린더_삼각대_그레이'),                       // 그레이 공용
  row('2026.12.1', 4000, 'TNCL_PT1324-썸네일캘린더_삼각대_블랙', 'PNA2-26년12월_재고생산'), // 재고생산 → 제외
  row('2027.1.5', 50, 'TNCL_PT1324-썸네일캘린더_삼각대_블랙'),                           // 해 넘김 · 블랙 공용
  row('2026.9.20', 70, 'XXXX_PT13990-다른파츠'),                                          // PT1399 접두만 같은 코드 → 제외
  row('', 999, 'EDCD_PT1400-에디트캘린더_삼각대_블랙'),                                   // 날짜 없음 → 제외
]);
const left = Object.fromEntries(s.map(p => [p.pts[0], [p.left, p.orders.length]]));
assert.deepStrictEqual(left.PT1399, [3960 - 110, 1]);
assert.deepStrictEqual(left.PT1400, [2435, 0]);
assert.deepStrictEqual(left.PT5571, [13000 - 500, 2]);
assert.deepStrictEqual(left.PT5572, [6000 - 50, 1]);
// 재고보다 많이 나가면 음수 그대로(부족 수량 표시)
assert.strictEqual(tripodStock([row('2026.9.30', 2500, 'EDCD_PT1400-x')])[1].left, -65);
console.log('OK — 삼각대 재고: 기준일 경계·공용 재고·재고생산 제외·PT 정확 일치 검증');
