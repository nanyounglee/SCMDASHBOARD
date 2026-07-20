# SCM 대시보드 v19 변경 내역 (2026.07.20)

팀 공유용 — 변경 1건당 1줄 요약입니다. 상세 사용법은 `docs/SCM_DASHBOARD_사용자가이드_v19.html`, 구현 로직은 `docs/SCM_DASHBOARD_로직설명_v19.html` 참고.

## 이슈 현황 — 분석 모듈 신규
- 이슈 현황 상단에 종합 현황 스타일의 분석 모듈이 생겼습니다:
  - **기간 이슈 건수 · 기간 발주 TASK · 이슈율(이슈÷TASK×100)** KPI 3장 — 이슈율에는 전년 동기 대비 **%p 증감**이 함께 표시됩니다
  - **월별 이슈 추이 라인차트** (품질/수량/운영/전체, 올해 1~12월)
  - **이슈율 2025 vs 2026 동기 비교 라인차트** — 2025년 원본 RAW(발주+이슈)로 월별 이슈율(%)을 산출해 올해와 겹쳐 보여줍니다
- 기존 전체/품질/수량/운영/제품×협력사 이슈율 탭은 그대로 유지됩니다 (점검 결과 탭 자체는 정상 동작 — 화면이 이상하게 보였다면 브라우저 캐시 문제일 가능성이 높으니 Ctrl+F5 후 확인해주세요)

## 발주 진행현황 — 이번 주 파일 미업로드 경고
- **이번 주 진행현황 CSV가 아직 커밋되지 않으면 노란 경고 배너**가 표시됩니다 (예: "이번 주(2026-W30) CSV 미업로드 — 2026-W29 기준 표시 중")
- 원인 확인: 이 저장소에는 매주 자동 커밋하는 워크플로가 **없습니다** — W29 파일도 7/14에 수동 커밋된 것입니다. 매주 월요일 에어테이블 진행현황 뷰에서 CSV를 내려받아 `CSV/progress_연도_W주차.csv`로 커밋해야 합니다(경고 배너에 파일명 안내 포함)

## Airtable → GitHub 주간 자동 커밋 (신규 인프라, 확장)
- **매주 월요일 09:00 KST에 에어테이블 원본을 자동으로 CSV 커밋**하는 GitHub Actions 워크플로를 추가했습니다. 처음엔 진행현황 뷰만 대상이었는데, **발주_RAW·이슈_RAW·공급망_RAW·고객인지이슈_RAW·품절리스트·파츠·굿즈마스터까지 확장**했습니다 — 사실상 대시보드가 CSV로 불러오는 항목 중 Airtable 소스는 전부 자동화 가능합니다
  - 주차별 신규 파일(진행현황·매출결산): `.github/workflows/weekly-airtable.yml` + `scripts/fetch_airtable_weekly.mjs`
  - 고정 파일명 CSV(발주_RAW 등): 같은 워크플로 + `scripts/fetch_airtable_sources.mjs` — 덮어쓰기 전 `archive_csv.ps1`과 동일하게 이전 버전을 `CSV_BANK/`로 보존(협력사는 월간 스냅샷도 별도 보존, 신규/거래종료 협력사 판별에 필요)
  - 식별자를 모를 때 쓰는 읽기 전용 탐색 워크플로도 추가: `.github/workflows/airtable-discover.yml` — 접근 가능한 모든 Airtable Base/Table/View 이름과 ID를 로그로 출력
- Airtable API를 `cellFormat=string · timeZone=Asia/Seoul`로 호출해 화면 표시 형식 그대로(날짜 `2026.7.14` 등) 받고, 기존 CSV 헤더 순서를 재사용해 대시보드와 컬럼 호환을 유지합니다
- **활성화하려면 저장소 설정이 필요합니다** — 상세 절차는 `docs/SCM_DASHBOARD_ARCHITECTURE.md` §9 "Airtable 소스 CSV 자동 커밋" 참고. 요약: ① `AIRTABLE_TOKEN` 시크릿 등록(스코프 2개) ② `airtable-discover` 워크플로 실행해 정확한 base/table/view 확인 ③ `AIRTABLE_SOURCES` 변수(JSON)에 원하는 만큼 채워 넣기(일부만 채워도 그 항목만 자동화) ④ `weekly-airtable-progress` 수동 실행으로 검증
- **분기별평가·재고 관련 CSV(inv_weekly·sales_monthly·dashboard_*3종)는 GSheets 소스라 이 방식으로 자동화되지 않습니다** — Google Sheets API 또는 GSheets Apps Script→GitHub push 방식이 별도로 필요합니다

## 제품별 판매량 추이 — 검색 연동 + 서울디지털 제외
- 상단 검색창(제품명/협력사명/굿즈코드)이 이 화면에도 **실시간 반영**됩니다 — 이전에는 이 화면만 검색에 무반응이었습니다
- **제품별 발주 요약 테이블에서 주 제작처(최다 발주 기준)가 서울디지털인쇄협동조합인 제품을 제외**하고, 제작 협력사 컬럼을 추가했습니다 (상단 Top10 추이 차트는 전체 기준 유지)
