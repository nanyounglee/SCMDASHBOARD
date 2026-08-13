// 주간 리포트 주차 스냅샷 자체검증 — node test_wr_snapshot.mjs
// "전주" 열이 지난주 리포트 게재값으로 고정되는지 확인한다.
// (v23.20: 원천 CSV 사후 입력으로 W32 TASK가 232→287건으로 늘어 WoW가 -25.9% 대신 -40.1%로
//  과장되던 회귀 재발 방지 — 스냅샷이 있으면 게재값, 없으면 현 데이터 계산값)
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');
const start = lines.findIndex((l, i) => i > 500 && l.trim() === '<script>');
const end = lines.findIndex((l, i) => i > start && l.trim() === '</script>');
assert(start > 0 && end > start, '메인 <script> 블록을 찾지 못함');
const src = lines.slice(start + 1, end).join('\n');

// 브라우저 localStorage 대역
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const ctx = vm.createContext({ console, document: { addEventListener: () => {}, getElementById: () => null }, window: {}, Chart: function () {}, URLSearchParams, location: { search: '' }, localStorage });
try { vm.runInContext(src, ctx); } catch (e) { if (!/document|window|Chart|location/.test(String(e))) throw e; }
const { wrSnapAll, wrSnapMerge, wrSnapSave, wrParseFinalReport } = ctx;
// wrKey는 const 선언이라 컨텍스트의 프로퍼티로 안 올라온다 — 렉시컬 스코프에서 직접 꺼낸다
const wrKey = vm.runInContext('wrKey', ctx);
assert(typeof wrSnapMerge === 'function', 'wrSnapMerge 로드 실패');
assert(typeof wrParseFinalReport === 'function', 'wrParseFinalReport 로드 실패');

// 현 데이터에서 계산한 "전주" 값 — W32를 지금 재조회하면 나오는 부풀려진 수치
const live = { proj: 265, stock: 22, projAmt: 16183033, stockAmt: 65313727, projConf: 50, stockConf: 17,
               urg: 45, urgRate: '17.0', miipha: 8, miiphaRate: '4.7', quality: 5, qty: 3, op: 2, ci: 3,
               gradeRate: '100.0', failCost: 0 };

// --- 시드 회차: 게재값이 계산값을 덮어써야 한다 ---
const w32 = wrSnapMerge('2026-W32', live);
assert.strictEqual(w32.proj, 214, '발주 TASK는 W32 게재값 214건이어야 함');
assert.strictEqual(w32.stock, 18, '재고생산 TASK는 W32 게재값 18건이어야 함');
assert.strictEqual(w32.projAmt, 12934033, '발주 매입금액은 W32 게재값이어야 함');
assert.strictEqual(w32.urg, 41, '긴급건수는 W32 게재값 41건이어야 함');
assert.strictEqual(w32.quality, 4, '품질이슈는 W32 게재값 4건이어야 함');
assert.strictEqual(w32.qty, 1, '수량이슈는 W32 게재값 1건이어야 함');
// 미입하만 예외 — 당시 게재값 0건은 판정 로직 반영 전 오류값이라 재산출값 8건으로 시드
assert.strictEqual(w32.miipha, 8, '미입하는 현 판정로직 재산출값 8건이어야 함');
// 시드에는 그 회차에 실린 이슈 키가 함께 들어 있어야 이월 판정이 가능하다
assert.strictEqual(w32.reported.ci.length, 2, 'W32 확정본의 고객인지이슈 2건이 키로 남아야 함');
assert.strictEqual(w32.reported.quality.length, 4, 'W32 품질이슈 4건');
assert.strictEqual(w32.reported.op.length, 2, 'W32 운영이슈 2건');

// 시드는 각 주차 **자기 리포트**의 1-1 게재값이다 — 뒤 회차 리포트의 1-3(그 시점 재조회값)이 아니다.
//   W32 리포트의 1-3에는 W30이 90건으로 적혀 있지만, W30 리포트 자신의 1-1은 70건이다.
const w30 = wrSnapMerge('2026-W30', live);
assert.strictEqual(w30.proj, 70, 'W30 발주건수는 W30 리포트 자체 게재값 70건');
assert.strictEqual(w30.miipha, 2, 'W30 미입하는 재산출값 2건');
assert.strictEqual(w30.projAmt, 5294780, 'W31 이전 라벨 `매입금액 (과업지시일자 기준)`도 발주 매입금액으로 읽어야 함');
// 회의 중 손으로 정정한 셀(`75.0% → 100.0%(회의 중 정정)`)은 정정 후 값을 취한다
assert.strictEqual(wrSnapMerge('2026-W32', live).gradeRate, '100.0', 'W32 등급일치율은 정정 후 100.0%');

// --- 스냅샷이 없는 회차는 계산값 그대로 (스냅샷 도입 전 동작) ---
// (vm 컨텍스트 객체는 프로토타입이 달라 deepStrictEqual이 실패 — 호스트 realm으로 펼쳐서 비교)
assert.deepStrictEqual({ ...wrSnapMerge('2026-W01', live) }, live, '미저장 회차는 현 데이터 계산값 그대로');

// --- 저장 → 다음 주 재사용, 저장값이 시드보다 우선 ---
wrSnapSave('2026-W33', { proj: 154, stock: 18, projAmt: 9576648, urg: 14, miipha: 1 });
assert.strictEqual(wrSnapMerge('2026-W33', live).proj, 154, '저장한 W33 값을 다음 주가 읽어야 함');
wrSnapSave('2026-W32', { proj: 999 });
assert.strictEqual(wrSnapAll()['2026-W32'].proj, 999, '저장값이 시드를 덮어써야 함');

// --- 확정 리포트(.md) 파싱 --------------------------------------------------
// 실제 최종본과 같은 흔들림을 넣어 둔다 — 정렬용 공백, **굵게**, ├/└, <sup> 꼬리표,
// 그리고 사용자가 표에서 빼 버린 행(금액 입력완료율)까지.
const finalMd = `# [주간 외주생산 리포트]
기준주차: 2026-W33 (8.10-8.16) | 집계구간: 8.06(목)13:00-8.13(목)12:59

### 1-1. 이번 주 KPI 상세

| 지표              | 이번 주 (2026-W33)     | 전주 (2026-W32)       | WoW                   |
| --------------- | ------------------- | ------------------- | --------------------- |
| **TASK 합계**     | **172건**            | **232건**            | ▼60건 (-25.9%)         |
| ├ 발주 TASK       | 154건 (89.5%)        | 214건 (92.2%)        | ▼60건 (-28.0%)         |
| └ 재고생산 TASK     | 18건 (10.5%)         | 18건 (7.8%)          | 유지                    |
| **매입금액 합계**     | **28,543,055원**     | **48,066,851원**     | ▼19,523,796원 (-40.6%) |
| ├ 발주 매입금액       | 9,576,648원 (33.6%)  | 12,934,033원 (26.9%) | ▼3,357,385원 (-26.0%)  |
| └ 재고생산 매입금액     | 18,966,407원 (66.4%) | 35,132,818원 (73.1%) | ▼16,166,411원 (-46.0%) |
| 긴급건수            | 14건 (9.1%)          | 41건 (19.2%)         | ▼27건 (-65.9%)         |
| 미입하 TASK <sup>재산출</sup> | 1건 (0.5%)   | 8건 (4.7%)           | ▼7건 (-87.5%)          |
| 품질이슈            | 1건                  | 4건                  | ▼3건 (-75.0%)          |
| 수량이슈            | 3건                  | 1건                  | ▲2건 (+200.0%)         |
| 운영이슈            | 3건                  | 2건                  | ▲1건 (+50.0%)          |
| 고객인지이슈          | 0건                  | 2건                  | ▼2건 (-100.0%)         |
| 품질등급 일치율        | 0.0%                | 100.0%              | ▼100.0%p              |
| 실패비용 (재제작 취득원가) | 0원                  | 0원                  | 유지                    |

### 1-2. 월별 KPI 누적 현황

### 1-3. 최근 4주 추이

| 지표 | 2026-W30 | 2026-W31 | 2026-W32 | **2026-W33** |
| 발주건수 | 90건 | 215건 | 214건 | **154건** |
| 긴급건수 | 3건 | 38건 | 41건 | **14건** |
`;
const parsed = wrParseFinalReport(finalMd);
assert(!parsed.error, '확정 리포트 파싱 실패: ' + parsed.error);
assert.strictEqual(parsed.label, '2026-W33', '기준주차를 머리글에서 읽어야 함');
assert.strictEqual(parsed.snap.proj, 154, '├/└ 와 정렬 공백을 걷어내고 발주 TASK를 읽어야 함');
assert.strictEqual(parsed.snap.stock, 18);
assert.strictEqual(parsed.snap.projAmt, 9576648, '천단위 콤마 제거');
assert.strictEqual(parsed.snap.stockAmt, 18966407);
assert.strictEqual(parsed.snap.urg, 14);
assert.strictEqual(parsed.snap.urgRate, '9.1');
assert.strictEqual(parsed.snap.miipha, 1, '<sup> 꼬리표가 붙어도 미입하 행을 인식해야 함');
assert.strictEqual(parsed.snap.miiphaRate, '0.5');
assert.strictEqual(parsed.snap.quality, 1);
assert.strictEqual(parsed.snap.qty, 3);
assert.strictEqual(parsed.snap.op, 3);
assert.strictEqual(parsed.snap.ci, 0);
assert.strictEqual(parsed.snap.gradeRate, '0.0');
assert.strictEqual(parsed.snap.failCost, 0);
// 1-3 추이표의 동명 행(발주건수/긴급건수)이 1-1 값을 덮어쓰면 안 된다
assert.strictEqual(parsed.snap.urg, 14, '1-3 추이표 행에 오염되면 안 됨');
// 표에서 뺀 행은 없는 채로 저장 → 병합 시 계산값이 살아남는다
assert.ok(!('projConf' in parsed.snap), '삭제된 행은 스냅샷에 없어야 함');
assert.strictEqual(wrSnapMerge('2026-W98', Object.assign({}, live, parsed.snap)).projConf, live.projConf,
  '없는 필드는 현 데이터 계산값 유지');

assert.ok(wrParseFinalReport('# 아무 문서\n내용 없음').error, '주간 리포트가 아니면 오류를 돌려줘야 함');
assert.ok(wrParseFinalReport('기준주차: 2026-W40\n표 없음').error, '1-1 표가 없으면 오류');

// --- 섹션 2 이슈 키 추출 (미보고 이월의 기준) ------------------------------
// 키는 원천 CSV 행에서 만든 값과 반드시 같아야 한다 — 생성기가 쓰는 wrKey를 그대로 쓴다.
const md2 = `기준주차: 2026-W40

### 1-1. 이번 주 KPI 상세

| 지표 | 이번 주 | 전주 | WoW |
|---|---|---|---|
| ├ 발주 TASK | 10건 | 9건 | ▲1건 |

### 1-2. 월별

### 2-1. 고객인지이슈

| 품목 | 프로젝트명 | 이슈 내용 요약 | 발생원인 | SCM 대응 |
|---|---|---|---|---|
| 아이덴티티 스티커팩 <sup>이월</sup> | PNA52321-소만사 | 시안 작업 중 오타 발생 | (확인필요) | (확인필요) |

### 2-2. 품질이슈

| 품목 | 협력사 | 이슈유형 | 이슈 내용 요약 | SCM 대응 | 처리결과 | 비용 |
|---|---|---|---|---|---|---|
| 에디트캘린더+인쇄 | (주)청산인쇄 | 인쇄 | 커버 페이지 인쇄 누락 | 감리 개선 | C급→B급 | 0원 |

### 2-3. 수량이슈

| 품목 | 협력사 | 이슈내용 | SCM 대응 |
|---|---|---|---|
| 킵세이프마그넷배터리MAX | 감성코퍼레이션 주식회사 | 입하 수량 80 | (확인필요) |

### 2-4. 운영이슈

| 품목 | 협력사 | 이슈내용 | SCM 대응 |
|---|---|---|---|
| 레더라벨 | 유엘상사 | MM 상이 | (확인필요) |

## 3. 이슈 유형별 리뷰
`;
const p2 = wrParseFinalReport(md2);
assert(!p2.error, '섹션 2 파싱 실패: ' + p2.error);
assert.deepStrictEqual([...p2.snap.reported.ci], [wrKey('아이덴티티 스티커팩', 'PNA52321-소만사', '시안 작업 중 오타 발생')],
  '<sup>이월</sup> 꼬리표는 키에서 떨어져 나가야 함 — 안 그러면 다음 주에 또 이월된다');
assert.deepStrictEqual([...p2.snap.reported.quality], [wrKey('에디트캘린더+인쇄', '(주)청산인쇄', '커버 페이지 인쇄 누락')],
  '2-2는 3번째가 아니라 4번째 셀(이슈 내용 요약)로 키를 만들어야 함');
assert.strictEqual(p2.snap.reported.qty.length, 1, '2-3 수량이슈 1건');
assert.strictEqual(p2.snap.reported.op.length, 1, '2-4 운영이슈 1건 — ## 3 앞에서 끊겨야 함');
// 헤더행·구분선이 키로 새어 들어가면 안 된다
Object.values(p2.snap.reported).flat().forEach(k => {
  assert.ok(!k.startsWith('품목|'), '헤더 행이 키에 섞임: ' + k);
  assert.ok(!/^-+\|/.test(k), '구분선이 키에 섞임: ' + k);
});

console.log('OK — 주간 리포트 스냅샷 검증 통과');
