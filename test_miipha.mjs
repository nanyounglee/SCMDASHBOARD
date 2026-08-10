// 미입하 집계 자체검증 — node test_miipha.mjs
// index.html 인라인 스크립트를 그대로 vm에 올려 hasNoReceipt/noReceiptCheckDate를 실 CSV로 검증한다.
// (v23.17: '1 checked out of' 포맷 매칭 실패 + 과업지시일자 버킷 문제로 미입하가 전 화면 0건이던 회귀 재발 방지)
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');
const src = lines.slice(1039, 12905).join('\n'); // 메인 인라인 <script> 본문

const ctx = vm.createContext({ console, document: null, window: {}, Chart: function () {}, URLSearchParams, location: { search: '' }, localStorage: { getItem: () => null, setItem: () => {} } });
try { vm.runInContext(src, ctx); } catch (e) { if (!/document|window|localStorage|Chart|location/.test(String(e))) throw e; }
const { hasNoReceipt, noReceiptCheckDate, noReceiptMonth } = ctx;
assert(typeof hasNoReceipt === 'function', 'hasNoReceipt 로드 실패');

// --- 포맷 판정 ---
const H = '미입하 발생이력_movement';
const yes = ['checked', ', checked', 'checked, checked', '1 checked out of 1', '2 checked out of 3'];
const no = ['', ',', ', ,', ', , ,', '0 checked out of 1', '0 checked out of 2'];
yes.forEach(v => assert(hasNoReceipt({ [H]: v }), `미입하로 잡혀야 함: ${JSON.stringify(v)}`));
no.forEach(v => assert(!hasNoReceipt({ [H]: v }), `미입하가 아니어야 함: ${JSON.stringify(v)}`));

// --- 판정일 = 입하예정일 + 1일 (확정일 우선) ---
const E = '입하예정일 (from movement_산출물)', FX = '입하확정일 (from movement_산출물)';
assert.strictEqual(noReceiptMonth({ [E]: '2026.7.31' }), '2026.8', '예정일 7.31 → 판정 8월');
assert.strictEqual(noReceiptMonth({ [E]: '2026.8.5', [FX]: '2026.7.30' }), '2026.7', '확정일이 예정일보다 우선');
assert.strictEqual(noReceiptCheckDate({ [E]: '' }), null, '날짜 없으면 null');

// --- 실 CSV 회귀 가드: 현재 order.csv에서 미입하가 0건이면 포맷이 또 바뀐 것 ---
// (split(',')는 따옴표 안 콤마를 무시하므로 건수는 하한값 — 여기선 "0이 아님"만 보면 된다)
const csv = fs.readFileSync('CSV/order.csv', 'utf8').split('\n');
const hdr = csv[0].split(',');
const iH = hdr.indexOf(H), iE = hdr.indexOf(E);
assert(iH >= 0 && iE >= 0, 'order.csv 헤더에 미입하/입하예정일 컬럼 없음');
let hit = 0, dated = 0;
for (const line of csv.slice(1)) {
  const c = line.split(',');
  if (hasNoReceipt({ [H]: c[iH] })) hit++;
  if (noReceiptCheckDate({ [E]: c[iE] })) dated++;
}
assert(hit > 0, `order.csv에서 미입하 0건 — '${H}' 값 포맷이 또 바뀌었는지 확인 필요`);
assert(dated > 0, '입하예정일 파싱 0건 — 날짜 포맷 확인 필요');

console.log(`OK — 미입하 ${hit}건 / 입하예정일 파싱 ${dated}건`);
