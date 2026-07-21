// ============================================================================
// 파츠 표준원가 시점 이력 유지 스크립트 (주간 워크플로에서 parts.csv 갱신 직후 실행)
//
// CSV/parts.csv(방금 갱신된 최신)와 data/parts_price_history.json의 current를
// 비교해, 구간단가가 실제로 바뀐 PT에 "오늘(KST)" 날짜의 에폭을 추가하고
// current를 갱신한다. 대시보드는 이 에폭으로 발주일 시점 단가를 조회한다
// (변경일 이전 발주 = 구단가, 이후 = 신단가 — v21.17 사용자 확정 규칙).
//
// - 0으로의 변경(기재 삭제 성격)은 변경으로 보지 않음 (v21.16 감지 기준과 동일)
// - 신규 PT는 current에만 추가(에폭 불필요 — 전 기간 단일 단가)
// - parts.csv에서 사라진 PT는 current에 그대로 유지(과거 발주 계산용 이력 보존)
// - 이력 파일이 없으면 아무것도 하지 않음(초기 파일은 저장소에 커밋되어 있음)
// ============================================================================
import fs from 'node:fs';

const HIST_PATH = 'data/parts_price_history.json';
const PARTS_PATH = 'CSV/parts.csv';
const TIERS = [1, 50, 100, 300, 500, 1000, 3000, 5000, 10000, 30000];

if (!fs.existsSync(HIST_PATH) || !fs.existsSync(PARTS_PATH)) {
  console.log('이력 파일 또는 parts.csv 없음 — 건너뜁니다.');
  process.exit(0);
}

function parseCSV(txt) {
  const rows = []; let row = [], cur = '', inQ = false;
  txt = txt.replace(/^﻿/, '');
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (inQ) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const hist = JSON.parse(fs.readFileSync(HIST_PATH, 'utf8'));
hist.epochs = hist.epochs || {}; hist.current = hist.current || {};

const d = parseCSV(fs.readFileSync(PARTS_PATH, 'utf8'));
const h = d[0];
const idx = Object.fromEntries(h.map((k, i) => [k, i]));
if (idx['파츠명 (Long ver)'] == null) { console.log('parts.csv 헤더가 예상과 다릅니다 — 건너뜁니다.'); process.exit(0); }

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST
let changed = 0, added = 0, reshaped = 0;
d.slice(1).forEach(r => {
  if (r.length < 5) return;
  const m = String(r[idx['파츠명 (Long ver)']] || '').match(/PT\d+/);
  if (!m) return;
  const id = m[0];
  const now = TIERS.map(t => {
    const v = (r[idx[t + '개_표준원가']] || '').trim();
    return v === '' ? null : parseFloat(v.replace(/,/g, ''));
  });
  const old = hist.current[id];
  if (!old) { hist.current[id] = now; added++; return; }
  let isChanged = false;
  for (let i = 0; i < TIERS.length; i++) {
    const pv = now[i], dv = old[i];
    if (pv == null || dv == null) continue;
    if (pv !== dv && pv !== 0) { isChanged = true; break; }
  }
  if (!isChanged) {
    // v22.2 감사 수정: 값↔미기재(null) 전이는 단가 변경(에폭 대상)은 아니지만 current는 최신
    // 스냅샷으로 맞춰야 함 — 안 맞추면 새로 기재된 구간의 비교 상대가 계속 null로 남아,
    // 그 구간에 이후 실제 단가 변경이 와도 영구히 감지되지 않음(에폭 추가 없이 current만 갱신).
    if (TIERS.some((t, i) => (now[i] == null) !== (old[i] == null))) { hist.current[id] = now; reshaped++; }
    return;
  }
  if (!hist.epochs[id]) hist.epochs[id] = [{ from: '0000-01-01', tiers: old }];
  // 같은 날 중복 실행 방어: 오늘 에폭이 이미 있으면 tiers만 갱신
  const todayEp = hist.epochs[id].find(e => e.from === today);
  if (todayEp) todayEp.tiers = now; else hist.epochs[id].push({ from: today, tiers: now });
  hist.current[id] = now;
  changed++;
});

if (changed || added || reshaped) {
  hist.updatedAt = today;
  fs.writeFileSync(HIST_PATH, JSON.stringify(hist));
  console.log(`단가 변경 ${changed}건 에폭 추가(${today}), 신규 PT ${added}건 등록, 기재 형태 갱신 ${reshaped}건 — ${HIST_PATH} 갱신`);
} else {
  console.log('단가 변경 없음 — 이력 파일 유지');
}
