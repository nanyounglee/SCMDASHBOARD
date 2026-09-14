// 견적 계산 엔진 v1.0 자체검증 — node test_quote_v10.mjs
// 외주버전 2026-09-11판 반영분(지종 40종·PET 동적단가·UV·관리비 12만·최소마진 구간제)이
// 깨지면 영업 견적이 조용히 틀린 금액으로 나간다 — 여기서 막는다.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const html = fs.readFileSync('index.html', 'utf8').split('\n');
const start = html.findIndex((l, i) => i > 500 && l.trim() === '<script>');
const end = html.findIndex((l, i) => i > start && l.trim() === '</script>');
assert(start > 0 && end > start, '메인 <script> 블록을 찾지 못함');
// const 선언은 vm 컨텍스트의 프로퍼티가 되지 않는다(함수 선언만 올라온다) — 끝에서 직접 내보낸다
const src = html.slice(start + 1, end).join('\n')
  + '\n;globalThis.__qc={QC_PAPER_PRICES,QC_UV_DEGREE,qcPaperKey};';

const noop = () => {};
const ctx = vm.createContext({
  console, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: noop },
  URLSearchParams, location: { search: '' }, navigator: { userAgent: '' },
  Chart: function () { this.destroy = noop; }, fetch: () => Promise.reject(0),
  localStorage: { getItem: () => null, setItem: noop }, setTimeout, setInterval: () => 0, clearInterval: noop,
});
ctx.window = ctx; ctx.addEventListener = noop;
try { vm.runInContext(src, ctx); } catch (e) { /* DOM 의존 초기화 실패는 무시 */ }
const { qcCalc, qcFindPaper } = ctx;
assert(typeof qcCalc === 'function', 'qcCalc 로드 실패');
assert(ctx.__qc, '상수 내보내기 실패 — 메인 스크립트가 끝까지 실행되지 않음');
const { QC_PAPER_PRICES, QC_UV_DEGREE, qcPaperKey } = ctx.__qc;

// 기본 견적 조건 — 나머지 항목은 전부 끈 상태에서 한 가지씩만 켜서 차액을 본다
const base = {
  type: '단박스', width: 100, depth: 100, height: 100, qty: 1000, ganjuk: 1,
  paperType1: 'RIV350g', paperSize1: '국전', paperType2: 'RIV300g', paperSize2: '국전',
  print: false, printColors: 0, coating: false, tomson: false, adhesive: false,
  epoxy: false, foil: false, emboss: false, uvPrint: false, uvPrintType: '4도',
  corrType: '해당없음', backPaperOn: false, extras: [], margin: 30,
};
const run = o => { const r = qcCalc({ ...base, ...o }); assert(!r.error, r.error); return r; };

// ── 1. 지종표: 40종 · 신규 13종 존재 · 모조쇼핑백지160g 단가 개정 ──────────────
assert.strictEqual(Object.keys(QC_PAPER_PRICES).length, 40, '지종 수가 40이 아님');
for (const k of ['용지없음', 'RIV450g', '뉴에코블랙400g', 'E보드270g G03', 'E보드310g G04',
  'E보드350g G04', '문보드450g', '모조쇼핑백지140g', 'PET 0.2t', 'PET 0.4t'])
  assert(QC_PAPER_PRICES[k], `신규 지종 누락: ${k}`);
assert.strictEqual(QC_PAPER_PRICES['모조쇼핑백지160g'][0], 230.14, '모조쇼핑백지160g 전지 단가 미개정');

// v1.0 이전 이력의 소문자 키가 새 키로 되돌아와야 한다 (조용한 지종 바꿔치기 방지)
assert.strictEqual(qcPaperKey('riv350g'), 'RIV350g');
assert.strictEqual(qcPaperKey('ab라이트270g'), 'AB라이트270g');
assert.strictEqual(qcPaperKey('sc240g'), 'sc240g');

// ── 2. PET: 전개면적 × 두께 × 4,000원/kg ÷ 1e6, 올림 ────────────────────────
const pet = qcFindPaper('PET 0.3t', '국전', 450, 270);
assert(pet.valid && pet.isPET, 'PET 단가 산출 실패');
assert.strictEqual(pet.price, Math.ceil(450 * 270 * 0.3 * 4000 / 1e6), 'PET 장당단가 공식 불일치');
assert.strictEqual(pet.size, '-', 'PET는 규격이 없어야 함');
assert(!qcFindPaper('PET 0.3t', '국전', 0, 0).valid, '치수 없는 PET가 유효로 나옴');

// ── 3. 관리비 최소 12만 (15만 아님) ────────────────────────────────────────
// 제조원가가 120만 미만이 되도록 수량을 줄여 최소값이 걸리게 한다
const small = run({ qty: 100 });
assert(small.제조원가 < 1200000, '전제 실패: 제조원가가 120만 이상');
assert.strictEqual(small.관리비, 120000, `관리비 최소가 12만이 아님: ${small.관리비}`);
// 제조원가가 120만을 넘으면 10% 정률로 돌아간다
const big = run({ qty: 20000 });
assert.strictEqual(big.관리비, Math.round(big.제조원가 * 0.1), '관리비 10% 정률 계산 오류');

// ── 4. 최소마진 구간제 (500↑ 20만 / 100~499 10만 / 100미만 5만) ─────────────
for (const [qty, want] of [[1000, 200000], [500, 200000], [499, 100000], [100, 100000], [99, 50000], [50, 50000]]) {
  const r = run({ qty, margin: 0 });   // 마진율 0 → 항상 최소마진이 걸린다
  assert.strictEqual(r.marginAmt, want, `수량 ${qty}의 최소마진이 ${want}가 아닌 ${r.marginAmt}`);
}
// 정률이 최소를 넘으면 정률이 이긴다
const hi = run({ qty: 20000, margin: 30 });
assert.strictEqual(hi.marginAmt, hi.totalCost * 0.3, '마진율 30%가 최소마진에 눌림');

// ── 5. UV 인쇄: max(20만, 도수 × 통수 × 40원) · 원단1에만 1회 ────────────────
// deepEqual — vm 컨텍스트의 객체라 프로토타입이 달라 deepStrictEqual은 항상 실패한다
assert.deepEqual({ ...QC_UV_DEGREE }, { '4도': 4, '4도+별색1도': 6, '4도+별색2도': 8 });
const uvOff = run({ qty: 10000 });
for (const [type, deg] of Object.entries(QC_UV_DEGREE)) {
  const uvOn = run({ qty: 10000, uvPrint: true, uvPrintType: type });
  const want = Math.max(200000, deg * 10000 * 40);
  assert.strictEqual(uvOn.제조원가 - uvOff.제조원가, want, `UV ${type} 금액 불일치`);
}
// 소량이면 최소 20만원이 걸린다
const uvMin = run({ qty: 100, uvPrint: true });
const uvMinOff = run({ qty: 100 });
assert.strictEqual(uvMin.제조원가 - uvMinOff.제조원가, 200000, 'UV 최소 20만원 미적용');
// 원단 2장짜리 형태에서도 UV는 한 번만 붙는다
const two = run({ type: 'open페이퍼박스/motion박스', qty: 10000, uvPrint: true });
const twoOff = run({ type: 'open페이퍼박스/motion박스', qty: 10000 });
assert.strictEqual(two.제조원가 - twoOff.제조원가, 4 * 10000 * 40, 'UV가 원단2에도 중복 부과됨');

// ── 6. 회귀: 기존 로직(여분·연수·자동상향·골판지)은 그대로여야 한다 ──────────
const reg = run({ qty: 3000, print: true, printColors: 4, coating: true, coatingType: '단면', tomson: true, adhesive: true });
assert.strictEqual(reg.lossSheets, 300, '여분 장수 규칙이 바뀜 (501~5,000개 = 300장)');
assert.strictEqual(reg.tong, 3000, '통수 = 수량 ÷ 판걸이');
assert.strictEqual(reg.realSheets, 3300, '실통수 = 통수 + 여분');
// 0원 규격 자동 상향: sc400g은 국전 단가가 0이라 전지로 올라가야 한다
const up = qcFindPaper('sc400g', '국전', 500, 400);
assert(up.valid && up.upgraded && up.size === '전지', `자동상향 실패: ${JSON.stringify(up)}`);
// 총원가 = 제조 + 관리 + 추가, 판매 = 총원가 + 마진
assert.strictEqual(reg.totalCost, reg.제조원가 + reg.관리비 + reg.추가비용합계, '총원가 합산식 불일치');
assert.strictEqual(reg.totalPrice, reg.totalCost + reg.marginAmt, '판매금액 합산식 불일치');

console.log('✅ 견적 엔진 v1.0 검증 통과 — 지종 40종 · PET 동적단가 · UV · 관리비 12만 · 최소마진 구간제');
