// scripts/quote_constants.json을 index.html에서 다시 만든다 — node scripts/gen_quote_constants.mjs
//
// 이 파일은 원래 손으로 관리하는 스냅샷이었다. 그래서 2026-09-14 단가표 갱신 때
// 대시보드는 40지종인데 엑셀 견적서는 27지종 그대로였다(관리비 최소도 15만에 멈춰 있었다).
// 이제 index.html의 엔진에서 그대로 뽑는다 — 단가표를 고치면 이 스크립트만 다시 돌리면 된다.
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {C, FN} from './qc_engine_export.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'scripts', 'quote_constants.json');

// 파생 지류는 엑셀 쪽에서 derived_papers.json으로 따로 얹는다 — 여기엔 정식 지종만 담는다.
const DERIVED = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'derived_papers.json'), 'utf8'));
const papers = Object.fromEntries(
  Object.entries(C.QC_PAPER_PRICES).filter(([k]) => !(k in DERIVED)));

const sizes = C.QC_SIZE_ORDER;
const out = {
  QC_SIZE_COLS: C.QC_SIZE_COLS,
  QC_SIZE_ORDER: sizes,
  QC_PAPER_STD: C.QC_PAPER_STD,
  QC_BIG_SIZES: C.QC_BIG_SIZES,
  QC_CARTON_SMALL: C.QC_CARTON_SMALL,
  QC_FORM_TYPES: C.QC_FORM_TYPES,
  QC_CORR_APPLY: C.QC_CORR_APPLY,
  QC_CORR_PRICES: C.QC_CORR_PRICES,
  QC_PAPER_PRICES: papers,
  // 엑셀은 함수를 못 쓰니 규격별 단가를 미리 펼쳐서 조회표로 넘긴다
  tomson: sizes.map(s => [s, FN.qcTomsonUnit(s)]),
  spec: sizes.map(s => [s, FN.qcSpecUnit(s)]),
  lam: Object.fromEntries(sizes.map(s => [s, [FN.qcLamUnit('2합', s), FN.qcLamUnit('3합', s)]])),
  parts: C.QC_FORM_TYPES.map(t => {
    const p = FN.qcParts(t, 100, 100, 100);
    return {t, n: p.length, labels: p.map(x => x.label)};
  }),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(`quote_constants.json 갱신 — 지종 ${Object.keys(papers).length}종 · 규격 ${sizes.length} · 형태 ${out.parts.length}`);
