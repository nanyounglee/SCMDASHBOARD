// 매출 귀속 마감일 자체검증 — node test_rev_cutoff.mjs
// 1~7월분은 개별 마감일(REV_CUTOFF), 8월분부터는 그 달 말일(사용자 확정 2026-09-14).
// 매출 현황 카드·매출 목표 표가 이 두 함수로 귀속월과 마감일을 정한다 — 경계가 틀리면 월 매출이 조용히 옆 달로 옮겨간다.
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
const { revMonthOfShipDate: mon, revCutoffLabel: cut } = ctx;
assert(typeof mon === 'function' && typeof cut === 'function', '마감 함수 로드 실패');

// 1~7월분: 개별 마감일 그대로
assert.strictEqual(cut('2026.2'), '2026-03-17');
assert.strictEqual(cut('2026.7'), '2026-08-04');
// 8월분부터: 월 말일 (연도 넘김·윤년 포함)
assert.strictEqual(cut('2026.8'), '2026-08-31');
assert.strictEqual(cut('2026.9'), '2026-09-30');
assert.strictEqual(cut('2026.12'), '2026-12-31');
assert.strictEqual(cut('2027.2'), '2027-02-28');
assert.strictEqual(cut('2028.2'), '2028-02-29');
// 규칙 이전 연도·잘못된 키는 마감일이 없다
assert.strictEqual(cut('2025.12'), null);
assert.strictEqual(cut('2026.13'), null);
assert.strictEqual(cut(''), null);

// 경계: 7월분 마감 다음날부터 8월분
assert.strictEqual(mon('2026-08-04'), '2026.7');
assert.strictEqual(mon('2026-08-05'), '2026.8');
assert.strictEqual(mon('2026-08-31'), '2026.8');
assert.strictEqual(mon('2026-09-01'), '2026.9');
assert.strictEqual(mon('2027-01-01'), '2027.1');

// 불변식: 2026-08-05 ~ 2028-12-31 모든 날짜가 «직전 달 마감일 < 날짜 ≤ 그 달 마감일»인 달로 귀속된다
const p2 = n => String(n).padStart(2, '0');
let days = 0;
for (let d = new Date(2026, 7, 5); d <= new Date(2028, 11, 31); d.setDate(d.getDate() + 1)) {
  const ds = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const mk = mon(ds), [y, m] = mk.split('.').map(Number);
  const prev = m === 1 ? `${y - 1}.12` : `${y}.${m - 1}`;
  assert(ds <= cut(mk), `${ds} → ${mk}인데 그 달 마감일 ${cut(mk)}보다 늦음`);
  assert(ds > cut(prev), `${ds} → ${mk}인데 직전 달 마감일 ${cut(prev)} 이전`);
  days++;
}
console.log(`OK — 매출 마감: 7월분까지 개별 마감일, 8월분부터 월 말일 (${days}일 경계 검증)`);
