// 고객 주문(프로젝트) 단위 수량 집계 회귀 테스트 — index.html의 orderUnitRows/orderRole을
// 그대로 뽑아 실제 발주 CSV로 돌린다. 리멤버 타투스티커(TTSK) 26.8월 100개 주문이 210(본품
// 100 + 배경지 110)으로, 9월 1,200개 주문이 2,450으로 잡히던 이중집계 재발 방지용.
//   node test_order_unit.mjs
import assert from 'assert';
import fs from 'fs';

// ---- index.html에서 함수 원문을 읽어 그대로 실행(복붙본이 갈리지 않게) ----
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const grab = name => {
  const i = html.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `index.html에 ${name}()가 없다 — 함수명이 바뀌었는지 확인`);
  let d = 0, s = html.indexOf('{', i);
  for (let j = s; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(i, j + 1);
  }
  throw new Error(`${name}() 본문 파싱 실패`);
};
const src = ['pa', 'orderRole', 'orderUnitKey', 'orderUnitRows'].map(grab).join('\n');
const { orderUnitRows, orderUnitKey } = new Function(`${src}; return {orderUnitRows,orderUnitKey};`)();

// ---- CSV 로드 ----
function parseCSV(text) {
  const rows = []; let cur = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const hdr = rows[0];
  return rows.slice(1).filter(r => r.length > 3).map(r => Object.fromEntries(hdr.map((h, i) => [h, r[i] || ''])));
}
const order = parseCSV(fs.readFileSync(new URL('./CSV/order.csv', import.meta.url), 'utf8').replace(/^﻿/, ''));
const pa = s => parseFloat(String(s || '').replace(/[₩,\s]/g, '')) || 0;
const isStock = r => (r['movement_산출이동'] || '').includes('재고') || (r['project'] || '').includes('재고')
  || (r['sync_itemdb'] || r['sync_item이니셔티브'] || '').includes('STCK');
const goodsCode = r => ((r['sync_itemdb'] || r['sync_item이니셔티브'] || '').match(/([A-Z]{4})_/) || [])[1] || '';
const month = r => { const m = String(r['과업지시일자'] || '').match(/(\d{4})\.(\d{1,2})/); return m ? `${m[1]}.${+m[2]}` : null; };

// 1) 파츠 접미(_A1·_B1)를 뗀 값이 한 프로젝트의 한 굿즈를 가리킨다
assert.strictEqual(orderUnitKey({ task_id: 'PNA53734_리멤버 타투스티커_A1' }), 'PNA53734_리멤버 타투스티커');
assert.strictEqual(orderUnitKey({ task_id: 'PNA53734_리멤버 타투스티커_B1' }), 'PNA53734_리멤버 타투스티커');
// 재제작/추가제작 건은 접미를 떼도 다른 단위로 남아야 한다(합쳐지면 그 달 수량이 사라진다)
assert.notStrictEqual(orderUnitKey({ task_id: 'PNA51935_리멤버 타투스티커_A1' }),
  orderUnitKey({ task_id: 'PNA51935_리멤버 타투스티커_추가제작_A1' }));

// 2) 실제 데이터 — 타투스티커 월별이 고객 주문수량과 일치
const ttsk = orderUnitRows(order.filter(r => !isStock(r) && goodsCode(r) === 'TTSK'
  && !String(r['task_id'] || '').includes('재제작')));
const by = {};
ttsk.forEach(r => { const m = month(r); if (m) by[m] = (by[m] || 0) + pa(r['발주지시수량']); });
assert.strictEqual(by['2026.8'], 100, `26.8월 ${by['2026.8']} (본품 100 + 배경지 110 = 210이면 이중집계 재발)`);
assert.strictEqual(by['2026.9'], 1200, `26.9월 ${by['2026.9']} (1,200 + 1,250 = 2,450이면 이중집계 재발)`);

// 3) 완제품 행이 2개인 세트도 합산되지 않는다 (브랜드 스트랩 단우산: 우산 251 + 펠트봉투 251)
const umb = orderUnitRows(order.filter(r => String(r['task_id'] || '').startsWith('PNA53275_브랜드 스트랩 단우산')));
assert.strictEqual(umb.length, 1);
assert.strictEqual(pa(umb[0]['발주지시수량']), 251, '세트 구성품을 더하면 250개 주문이 500개가 된다');

// 4) 전 굿즈 — 대표수량이 고객주문수량에 못 미치는 주문단위는 1% 미만(원본 수량 0/부분재고 건)
const live = order.filter(r => !isStock(r) && !String(r['task_id'] || '').includes('재제작'));
const units = orderUnitRows(live);
const grp = {}; live.forEach(r => { const k = orderUnitKey(r); (grp[k] = grp[k] || []).push(r); });
// 고객주문수량은 샘플이 "100, 1"처럼 나열되는 행이 있어 대시보드와 같은 pCustQty 규칙(최대값)으로 읽는다
const pCust = s => { s = String(s || '').trim(); return /,\s+/.test(s) ? Math.max(0, ...s.split(',').map(pa)) : pa(s); };
const under = units.filter(r => {
  const c = Math.max(...grp[orderUnitKey(r)].map(x => pCust(x['고객주문수량'])));
  return c > 0 && pa(r['발주지시수량']) < c * 0.95;
}).length;
assert.ok(under / units.length < 0.01, `과소집계 ${under}/${units.length}건 — 대표행 선정 규칙 확인 필요`);

console.log(`OK — 주문단위 ${units.length}건, TTSK 26.8월 ${by['2026.8']}개 / 26.9월 ${by['2026.9']}개, 과소집계 ${under}건`);
