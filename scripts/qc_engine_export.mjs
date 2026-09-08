// index.html의 견적 계산 엔진(qcCalc 및 그 의존 함수·상수)을 원문 그대로 뽑아 export한다.
// 복붙본을 두면 대시보드와 갈라지므로 항상 index.html에서 읽는다 — test_quote_xlsx.py의 기준값.
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const grabFn = name => {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`index.html에 ${name}()가 없다`);
  let d = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(i, j + 1);
  }
  throw new Error(`${name}() 본문 파싱 실패`);
};
const grabConst = name => {
  const m = html.match(new RegExp(`^const ${name}=.*$`, 'm'));
  if (!m) throw new Error(`index.html에 const ${name}이 없다`);
  return m[0];
};

const CONSTS = ['QC_SIZE_COLS', 'QC_SIZE_ORDER', 'QC_PAPER_STD', 'QC_BIG_SIZES', 'QC_CARTON_SMALL',
  'QC_FORM_TYPES', 'QC_CORR_APPLY', 'QC_CORR_PRICES', 'QC_PAPER_PRICES'];
const FNS = ['qcPaperPrice', 'qcFindPaper', 'qcLoss', 'qcYeon', 'qcPrintUnit', 'qcTomsonUnit',
  'qcAdhUnit', 'qcSpecUnit', 'qcCorrLoss', 'qcLamUnit', 'qcParts', 'qcRecommendStd', 'qcCalc'];

const src = [...CONSTS.map(grabConst), ...FNS.map(grabFn)].join('\n');
// 계산기 27지종에 없는 지류를 사용자 지정 배수로 파생시켜 단가표에 얹는다(scripts/derived_papers.json).
// 원본 지종 단가가 바뀌면 파생 단가도 따라간다 — 별도 숫자를 박아두지 않는다.
const DERIVED = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'derived_papers.json'), 'utf8'));
const inject = `
const __d = ${JSON.stringify(DERIVED)};
Object.keys(__d).forEach(name => {
  const v = __d[name];
  if (name[0] === '_' || !Array.isArray(v)) return;
  if (!QC_PAPER_PRICES[v[0]]) throw new Error('파생 지류의 원본 지종이 없다: ' + v[0]);
  QC_PAPER_PRICES[name] = QC_PAPER_PRICES[v[0]].map(x => x * v[1]);
});
`;
export const {qcCalc, PAPERS} = new Function(
  `${src}\n${inject}\nreturn {qcCalc, PAPERS: QC_PAPER_PRICES};`)();

if (process.argv[1] && process.argv[1].endsWith('qc_engine_export.mjs')) {
  // stdin으로 시나리오 배열(JSON)을 받아 계산 결과를 stdout(JSON)으로 돌려준다
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const scenarios = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(JSON.stringify(scenarios.map(s => {
    const r = qcCalc(s);
    return r.error ? {error: r.error} : {
      제조원가: r.제조원가, 관리비: r.관리비, 추가비용: r.추가비용합계,
      총원가: r.totalCost, 개당원가: r.perUnit, 마진액: r.marginAmt,
      총판매금액: r.totalPrice, 개당소비자가: r.consumer,
    };
  })));
}
