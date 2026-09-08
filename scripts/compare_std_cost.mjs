// 표준원가(실제 매입 단가) vs 견적 계산기 산출로직 — 어디서 얼마나 벌어지는지 본다.
//   node scripts/compare_std_cost.mjs
//
// 세 가지로 돌려 비교한다. 계산기는 «1통 = 판걸이 1개» 기준이라, 실제 인쇄처럼 한 장에 여러 개를
// 앉히는(판걸이/터잡기) 것을 반영하지 않으면 작은 박스일수록 원가가 크게 부풀려진다.
//   A. 국전 고정 · 판걸이 1        — 지금 계산기 기본값으로 그냥 돌린 것
//   B. 최소 표준용지 · 판걸이 1     — 전개 크기가 들어가는 가장 작은 규격을 골라준 것
//   C. 최소 표준용지 · 판걸이 자동  — 그 규격에 전개면이 몇 개 앉는지로 판걸이를 계산한 것
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {qcCalc} from './qc_engine_export.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8'));
const items = rd('quote_products.json');
const K = rd('quote_constants.json');
const STD = K.QC_PAPER_STD;                       // 면적 오름차순 10종
const TIERS = [100, 300, 500, 1000, 3000, 5000, 10000, 30000];

// 전개 W×H가 들어가는 가장 작은 표준용지 (90° 회전 허용) — 계산기 qcRecommendStd와 같은 규칙
const fitSheet = (w, h) => STD.find(s => (w <= s.w && h <= s.h) || (w <= s.h && h <= s.w)) || null;
// 그 용지에 전개면이 몇 개 앉는가 (가로/세로 두 방향 중 많은 쪽)
const upCount = (w, h, s) => Math.max(
  Math.floor(s.w / w) * Math.floor(s.h / h),
  Math.floor(s.w / h) * Math.floor(s.h / w)) || 1;

// 박스 형태별 전개 크기 — 계산기 qcParts와 같은 식(파트1 기준)
const unfold = (t, W, D, H) =>
  t === '단박스' ? [(W + D) * 2 + 50, D * 2 + H + 70]
  : t === '테일러드 스트랩 박스 커스텀' ? [W + H * 4 + 72, D + H * 4 + 72]
  : t === 'SolidG형 커스텀' ? [W + H * 4 + 60, D * 2 + H * 3 + 60]
  : [W + 30, (D + H) * 2 + 50];

const run = (p, q, mode) => {
  const [uw, uh] = unfold(p.박스형태, p.W, p.D, p.H);
  const sheet = fitSheet(uw, uh);
  const size = mode === 'A' ? '국전' : (sheet ? sheet.name : '전지');
  const gan = mode === 'C' && sheet ? upCount(uw, uh, sheet) : 1;
  const r = qcCalc({
    type: p.박스형태, width: p.W, depth: p.D, height: p.H, qty: q, ganjuk: gan,
    paperType1: p.지종, paperSize1: size, paperType2: p.지종, paperSize2: size,
    print: p.인쇄도수 > 0, printColors: p.인쇄도수,
    coating: p.코팅, coatingType: p.코팅면, tomson: p.톰슨, adhesive: p.접착,
    epoxy: p.에폭시, foil: p.금은박, emboss: p.형압,
    corrType: p.골판지, corrMat: p.골판지재질, margin: 0,
  });
  return r.error ? null : {perUnit: (r.제조원가 + r.관리비) / q, gan, size, uw, uh};
};

const usable = items.filter(p => p.지종 && p.박스형태 && p.W && Object.keys(p.표준원가).length);
const stats = {};
const detail = [];
for (const p of usable) {
  for (const q of TIERS) {
    const std = p.표준원가[String(q)];
    if (!std) continue;
    for (const mode of ['A', 'B', 'C']) {
      const r = run(p, q, mode);
      if (!r) continue;
      (stats[mode] = stats[mode] || []).push(r.perUnit / std);
      if (q === 1000) detail.push({p, mode, std, ...r});
    }
  }
}

const q50 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const band = (a, lo, hi) => (a.filter(x => x >= lo && x <= hi).length / a.length * 100).toFixed(0);
const LBL = {A: 'A 국전 고정 · 판걸이 1', B: 'B 최소 표준용지 · 판걸이 1', C: 'C 최소 표준용지 · 판걸이 자동'};

console.log(`비교 대상: 제품 ${usable.length}종 (지종·박스형태·치수·표준원가 전부 있는 건)\n`);
console.log('배율 = 산출로직 개당원가(관리비 포함) ÷ 표준원가.  1.00이면 일치, 2.00이면 산출이 2배 비쌈\n');
for (const m of ['A', 'B', 'C']) {
  const a = stats[m] || [];
  if (!a.length) continue;
  const s = [...a].sort((x, y) => x - y);
  console.log(`${LBL[m]}   n=${a.length}`);
  console.log(`   중앙 ${q50(a).toFixed(2)}배 · 25% ${s[Math.floor(s.length * .25)].toFixed(2)} · 75% ${s[Math.floor(s.length * .75)].toFixed(2)} · 최소 ${s[0].toFixed(2)} · 최대 ${s[s.length - 1].toFixed(2)}`);
  console.log(`   ±20% 이내 ${band(a, .8, 1.2)}% · ±50% 이내 ${band(a, .5, 1.5)}% · 2배 이상 과대 ${band(a, 2, 1e9)}%\n`);
}

console.log('── 1,000개 기준 제품별 (C: 판걸이 자동) ──');
detail.filter(d => d.mode === 'C').sort((a, b) => b.perUnit / b.std - a.perUnit / a.std).forEach(d => {
  const f = (d.perUnit / d.std).toFixed(2);
  console.log(`  ${f.padStart(6)}배  표준 ${Math.round(d.std).toLocaleString().padStart(6)}원 → 산출 ${Math.round(d.perUnit).toLocaleString().padStart(6)}원  `
    + `[${d.size} ${d.gan}up] ${d.p.대분류.slice(0, 12).padEnd(13)} ${d.p.파츠명.slice(0, 34)}`);
});
