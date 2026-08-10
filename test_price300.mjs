// 단가 변동 300개 기준 자동 산출 자체검증 — node test_price300.mjs
// index.html의 priceTierChange()를 실 parts_price_history.json + price_chg.csv로 검증한다.
// (v23.18: 주간리포트 4-1 "변동 내용 (300개 기준)"이 수기 입력을 대체하므로, 에폭 선택 규칙이
//  깨지면 리포트에 잘못된 단가가 그대로 실린다 — 여기서 막는다)
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const html = fs.readFileSync('index.html', 'utf8').split('\n');
const start = html.findIndex((l, i) => i > 500 && l.trim() === '<script>');
const end = html.findIndex((l, i) => i > start && l.trim() === '</script>');
assert(start > 0 && end > start, '메인 <script> 블록을 찾지 못함');
const src = html.slice(start + 1, end).join('\n') + '\n;globalThis.__setPH=j=>{PRICE_HISTORY=j};';

const noop = () => {};
const ctx = vm.createContext({
  console, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: noop },
  URLSearchParams, location: { search: '' }, navigator: { userAgent: '' },
  Chart: function () { this.destroy = noop; }, fetch: () => Promise.reject(0),
  localStorage: { getItem: () => null, setItem: noop }, setTimeout, setInterval: () => 0, clearInterval: noop,
});
ctx.window = ctx; ctx.addEventListener = noop;
try { vm.runInContext(src, ctx); } catch (e) { /* DOM 의존 초기화 실패는 무시 */ }
const { priceTierChange, parseAnyDate, __setPH } = ctx;
assert(typeof priceTierChange === 'function', 'priceTierChange 로드 실패');

// --- 이력 미로드 상태에서는 '미반영'이 아니라 '미로드'로 구분해야 한다 (전 행 오탐 방지) ---
assert(/미로드/.test(priceTierChange('PT1', new Date(), 300).fail), '이력 미로드를 구분하지 않음');

const hist = JSON.parse(fs.readFileSync('data/parts_price_history.json', 'utf8'));
__setPH(hist);
const i300 = hist.tierSteps.indexOf(300);
assert(i300 >= 0, 'tierSteps에 300 구간 없음');

// --- 합성 케이스: 에폭 선택 규칙 ---
__setPH({
  tierSteps: hist.tierSteps,
  epochs: {
    PTX: [
      { from: '0000-01-01', tiers: Array(10).fill(100) },
      { from: '2026-07-29', tiers: hist.tierSteps.map((_, i) => (i === i300 ? 130 : 100)) },
    ],
  },
});
const hit = priceTierChange('PTX', parseAnyDate('2026.7.28'), 300);
assert.strictEqual(hit.before, 100, '변경 전 단가');
assert.strictEqual(hit.after, 130, '변경 후 단가');
assert(Math.abs(hit.pct - 30) < 0.01, `증감률 30% 기대, 실제 ${hit.pct}`);
// 요청일이 에폭보다 하루 넘게 뒤면(창 밖) 이번 변동으로 보지 않는다
assert(priceTierChange('PTX', parseAnyDate('2026.7.31'), 300).fail, '에폭보다 늦은 요청일이 매칭됨');
// 창(+14일)을 벗어난 과거 요청일도 매칭되면 안 된다
assert(priceTierChange('PTX', parseAnyDate('2026.7.1'), 300).fail, '창을 벗어난 요청일이 매칭됨');
// 300개 구간이 안 바뀌면 다른 구간이 바뀌었어도 산출하지 않는다
__setPH({ tierSteps: hist.tierSteps, epochs: { PTY: [
  { from: '0000-01-01', tiers: Array(10).fill(100) },
  { from: '2026-07-29', tiers: hist.tierSteps.map((_, i) => (i === 0 ? 999 : 100)) },
] } });
assert(/변동 없음/.test(priceTierChange('PTY', parseAnyDate('2026.7.28'), 300).fail), '300개 무변동을 산출함');

// --- 실 데이터 회귀 가드: price_chg.csv에서 최소 몇 건은 산출돼야 한다 ---
__setPH(hist);
const csv = ctx.parseCSV(fs.readFileSync('CSV/price_chg.csv', 'utf8'));
const key = n => Object.keys(csv[0]).find(k => k.replace(/^﻿/, '') === n);
const kParts = key('대상 파츠명 (Shift+Space)'), kGoods = key('대상 굿즈명');
const kReq = key('요청일자'), kConf = key('Confirmation'), kChg = key('변동사항 (Shift+Space로 전체 내용을 확인하세요)');
assert(kParts && kReq && kChg, 'price_chg.csv 헤더가 예상과 다름');
let ok = 0;
for (const r of csv) {
  if (String(r[kConf] || '').trim() === '반려') continue;
  const pt = (String(`${r[kParts]} ${r[kGoods]} ${r[kChg]}`).match(/PT\d+/) || [])[0];
  if (!pt) continue;
  if (priceTierChange(pt, parseAnyDate(String(r[kReq] || '').trim()), 300).before != null) ok++;
}
assert(ok > 0, 'price_chg.csv에서 300개 기준 산출 0건 — 에폭 선택 규칙이나 이력 파일 형식 확인 필요');

console.log(`OK — 300개 기준 자동 산출 ${ok}건 / 이력 보유 ${Object.keys(hist.epochs).length}개 PT`);
