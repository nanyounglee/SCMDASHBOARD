// 사용자가이드·로직설명 PDF를 docs/src의 HTML 원고에서 만든다 — node scripts/build_docs_pdf.mjs
//
// 2026-07-24판(v23)은 PDF만 커밋되고 원고가 저장소에 없어 7주 넘게 갱신이 멈춰 있었다.
// 원고(docs/src/*.html)를 고친 뒤 이 스크립트만 다시 돌리면 docs/의 PDF가 새로 나온다.
// 버전 표기가 바뀌면 VERSION과 원고 머리말의 기준일을 함께 고친다.
import fs from 'fs';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = 'v1.0';
const DOCS = [
  ['SCM_DASHBOARD_사용자가이드.html', `SCM_DASHBOARD_사용자가이드_${VERSION}.pdf`, '사용자 가이드'],
  ['SCM_DASHBOARD_로직설명.html', `SCM_DASHBOARD_로직설명_${VERSION}.pdf`, '데이터 로직 설명서'],
];
// 설치된 Chrome/Edge를 쓴다 — puppeteer 번들 Chromium을 따로 내려받지 않아도 되게
const BROWSER = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

const only = process.argv[2];   // 파일명 일부를 주면 그 문서만 만든다 (예: 로직설명)
const browser = await puppeteer.launch({executablePath: BROWSER, headless: true});
try {
  for (const [src, out, label] of DOCS) {
    if (only && !src.includes(only)) continue;
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, 'docs', 'src', src)).href, {waitUntil: 'load'});
    await page.pdf({
      path: path.join(ROOT, 'docs', out),
      format: 'A4',
      printBackground: true,
      margin: {top: '14mm', bottom: '15mm', left: '14mm', right: '14mm'},
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7.5px;color:#888;padding:0 14mm;display:flex;justify-content:space-between;font-family:'Malgun Gothic',sans-serif">`
        + `<span>SCM 통합운영 대시보드 ${VERSION} · ${label}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    await page.close();
    console.log('saved: docs/' + out);
  }
} finally {
  await browser.close();
}
