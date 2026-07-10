# 구매파트 Apps Script 대시보드 → 통합 대시보드 이식 전략

작성일: 2026-07-06 (v10 반영 현황 갱신: 2026-07-07)  
대상 비교:
- 통합 대시보드: `C:\Users\rlagk\SCMDASHBOARD`
- 기존 구매파트 Apps Script: `C:\Users\rlagk\.clasp`

> **범위 안내 (2026-07-10):** 이후 배포된 v11/v12는 외주생산파트 화면(발주 상세분석 DB원가비교, 공급망 포트폴리오 QCD×관계 Tier, 협력사 상세모달, 제품×협력사 이슈율, 제품별 발주수량 추이)만 변경했다. 이 문서가 다루는 구매전략파트 재고운영 이식 범위·갭 진단은 v11/v12로 인해 달라진 내용이 없으며, 아래 "v10 반영 현황"이 여전히 최신 기준이다.

## v10 반영 현황 (2026-07-07 갱신)

이 문서 작성(07-06) 다음날, haeun.kim님이 원격에 커밋 5개(도넛차트 3종·매입재고 대시보드·GSheets 재고요약 3종 연동·sales_monthly 갱신)를 올렸고, 로컬에서 진행 중이던 공급망 포트폴리오 등급 반기환산 작업(v9)과 병합되어 **v10**으로 배포됨(커밋 `013824d`). 이 문서가 진단한 갭 중 아래는 해소되었고, 나머지는 여전히 유효하다.

| 갭 (07-06 진단) | v10 상태 |
|---|---|
| 기존 집계 시트 3종 부재 | **해소.** `dashboard_period_summary`/`dashboard_group_summary`/`dashboard_sku_snapshot` 3종이 실제 CSV 입력·시그니처(`FILE_SIGNATURES`)로 연동됨. `hasAggInventoryData()`가 3종 존재 여부로 Agg 경로/레거시 경로를 분기 |
| 그룹 집계(카테고리/서브카테고리/생산구분/소싱구분) 부족 | **부분 해소.** `dashboard_group_summary`의 `group_type`별 도넛차트 3종(`renderAggInventoryDonut`) 추가. 다만 조달유형별 집계는 화면에서 미확인 — 실사용 데이터로 재확인 필요 |
| 품절 경과일 로직 차이 | **부분 해소.** `dashboard_sku_snapshot`의 `stockout_days` 컬럼을 그대로 조회(`aggStockoutDays`)하는 구조로 바뀜 — GSheets 쪽에서 기존 주간 이력 기반 로직으로 사전산출하는지는 원본 Apps Script 확인 필요 |
| 회전율 분모 차이(1M/3M/YTD 평균재고 vs 현재 재고금액) | **해소 추정.** Agg 경로는 `turnover_1m`/`turnover_3m`/`turnover_ytd`를 CSV에서 그대로 읽음 — 계산 자체는 GSheets가 담당하므로 기존 Apps Script와 같은 산식일 가능성 높음. **단, 실제로 같은 산식인지는 미검증**(아래 "남은 검증" 참고) |
| 입고예정금액 없음 | **미해소, 자리만 확보.** 재고운영 KPI 카드에 "입고예정금액 - 추후 반영 (incoming_orders CSV 연결 예정)" 플레이스홀더만 추가됨(index.html 2881행) — 실제 데이터 연결은 아직 없음 |
| 매입검토/시즌계획 저장 기능 | **의도적 미해소(1차 제외 유지).** 화면·업로드 슬롯은 존재하나 저장은 여전히 `localStorage` 임시값뿐 |
| 협력사재고 품절 업로드 기능 없음 | **미해소.** 관련 업로드 슬롯/함수 미확인 |
| 주간 재고운영 리포트 축소 | **미확인.** `report` 페이지의 재고 KPI 흐름 반영 여부는 코드 미대조 |
| Product Parts 필터 약함 (`관리대상여부` 공란 시 전체 포함) | Agg 경로에서는 `is_managed==='Y'`만 관리대상으로 판정(`isAggManaged`)하므로 **레거시보다 엄격해짐.** 단 레거시 폴백(`inv_weekly` 직접 사용) 시에는 여전히 기존 폴백 규칙 적용 |

**남은 검증**: 이 표의 "해소"/"부분 해소"는 코드 구조(어떤 CSV·함수를 쓰는지)만 근거로 판단한 것이며, GSheets Apps Script가 실제로 기존 `.clasp`의 `calcAvgInventory_`·`buildStockoutDuration_`과 동일한 산식으로 3종 CSV를 만드는지는 확인하지 않았다. 기존 `.clasp` 화면과 통합 대시보드를 **동일 기준일**로 1:1 대조(문서 6번 항목의 기존 권고)가 여전히 필요하다.

---

## 목적

기존 구매파트 Apps Script 대시보드의 전체 기능을 그대로 옮기는 것이 아니라, 통합 보고용 대시보드에 구매파트 핵심 지표와 화면을 안정적으로 이식하는 것을 목표로 한다.

단, `매입검토`와 `시즌재고 계획`은 1차 이식 범위에서 제외한다. 기존 구매파트 대시보드에서도 아직 확정 운영 기능이 아니고 별도 테이블/프로세스를 쓰고 있으므로, 통합 대시보드에는 우선 KPI와 보고용 재고 지표만 반영한다.

이 문서는 코드 수정 없이 두 폴더의 구조를 비교하고, 이식 대상과 전처리/프론트 계산 경계를 정리한 것이다.

## 구조 비교표

| 구분 | 기존 구매파트 `.clasp` | 통합 대시보드 `SCMDASHBOARD` | 차이 |
|---|---|---|---|
| 실행 구조 | Google Apps Script 웹앱 | GitHub Pages 정적 HTML | 기존은 서버 함수/시트 I/O 가능, 통합은 브라우저 CSV/JSON 계산 |
| 핵심 화면 | `.clasp/Index.html` | `SCMDASHBOARD/index.html` | 둘 다 단일 HTML이지만 기존은 `google.script.run` 호출 |
| 서버 로직 | `Code.js`, `AggregationBase.js`, `Aggregator.js` | 없음 | 통합은 서버 계산 불가 |
| 원천 데이터 | Google Sheets 시트 직접 읽기 | CSV + `data/*.json` | 통합은 업로드/자동로드된 정적 파일만 사용 |
| 사전 집계 | `dashboard_period_summary`, `dashboard_group_summary`, `dashboard_sku_snapshot` 시트 | 현재 없음 | 이 부분이 가장 큰 누락 |
| 저장 기능 | 매입검토/시즌 확정수량을 시트에 저장 | 일부 `localStorage` 저장 | 통합에서는 영구 공유 저장 불가 |

## 기존 구매파트 Apps Script 재고운영 핵심 파일/함수

| 파일 | 역할 | 핵심 함수 |
|---|---|---|
| `.clasp/Aggregator.js` | 원천 시트를 집계 시트로 변환 | `buildSalesMonthly`, `buildInventoryWeekly`, `runAllAggregation`, `runPeriodSummary`, `runGroupSummary`, `runSkuSnapshot`, `runUnitPriceAggregation` |
| `.clasp/AggregationBase.js` | 재고 KPI 계산 엔진 | `loadBaseData_`, `buildPeriodOptions_`, `buildPeriodRows_`, `buildWeeklyRows_`, `buildMonthlyRows_`, `buildQuarterlyRows_`, `buildPeriodRow_`, `buildSummary_`, `addStockoutDuration_`, `getKpiRows_`, `calcAvgInventory_`, `buildInvMap_` |
| `.clasp/Code.js` | 화면에 줄 데이터 API 조립 | `getInitialData`, `getDashboardData`, `getFlowData`, `buildSummaryFromPeriodRow_`, `buildCategorySummaryFromGroup_`, `buildStockoutSummaryFromSku_`, `buildDetailsFromSku_`, `buildSalesHistory_`, `buildStockoutHistoryMap_` |
| `.clasp/Code.js` | 매입검토 | `getPurchaseReviewList`, `searchPartsForReview`, `getSkuCurrentInventory`, `getPurchaseReviewInsight`, `savePurchaseReview`, `deletePurchaseReview` |
| `.clasp/Code.js` | 시즌재고 | `getSeasonPlanAllData`, `getSeasonDiaryPlanData`, `saveSeasonDiaryConfirmedQty`, `buildSeasonDiaryStockMap_` |
| `.clasp/Index.html` | 재고 UI | `renderSummaryView`, `renderFlowView`, `renderStockoutDetailView`, `renderPurchaseReviewView`, `renderPurchaseReviewTable`, `renderSeasonDiaryView`, `renderSeasonAllShell`, `generateWeeklyReportMd` |

## 통합 대시보드 구매파트 담당 파일/함수

현재 통합 대시보드는 사실상 `index.html` 한 파일이 담당한다.

| 영역 | 통합 함수 |
|---|---|
| CSV 로드/인식 | `parseCSV`, `detectCSVType`, `handleUnifiedFiles`, `autoLoadRaw` |
| 재고 공통 헬퍼 | `getInvDates`, `getInvMonths`, `getInvQuarters`, `getSalesQty`, `getThreeMonths`, `getBandForDate`, `getManagedRows` |
| 재고운영 현황 | `renderInventoryOps` |
| 품절 상세 | `renderStockoutDetail`, `calcStockoutDays` |
| 매입 검토 | `renderPurchaseReview` |
| 시즌재고 계획 | `renderSeasonPlan`, `saveSPQty` |
| EOQ/발주알람 | `renderEOQ` |
| 졸업 검토 | `renderGraduation` |
| SKU 상세 모달 | `openModal('inventoryAsset')`, `renderInvModalTable`, `buildInvAccordion` |
| KPI 재고 지표 | `computeKPIs`, `renderKPITracker` |

## 이식해야 하는 핵심 로직

1. 기간 단위 로직

   기존은 `weekly`, `monthly`, `quarterly`를 모두 지원하고, 월/분기는 단순 최신값이 아니라 기간 내 평균 재고를 쓴다. 통합은 현재 최신 기준일 중심이라 이 차이를 보완해야 한다.

2. 평균재고 기반 회전율

   기존은 `calcAvgInventory_`와 `inv_1m_avg`, `inv_3m_avg`, `inv_ytd_avg`를 만들어 회전율을 계산한다. 통합은 현재 `현재 재고금액`을 분모로 쓰는 부분이 많아 기존 KPI와 숫자가 달라질 수 있다.

3. KPI 대상 필터

   기존 기준은 `관리대상 Y + Product Parts`다. 통합은 `관리대상여부`가 비어 있으면 전체를 관리대상으로 간주하고, Product Parts 필터가 약하다. 이 기준은 반드시 맞춰야 한다.

4. 품절 시작일/품절 경과일

   기존은 `inventory_weekly` 주간 이력을 거슬러 올라가 연속 품절 시작일을 추정한다. 통합은 `stockout_list`의 변경일을 주로 쓰거나 fallback 예측을 한다. 기존 방식의 `stockout_start`, `stockout_days`가 필요하다.

5. 그룹 집계

   기존은 카테고리, 서브카테고리, 조달유형, 생산구분, 소싱구분별로 재고금액/비중/판매/회전율을 집계한다. 통합은 카테고리별 재고비중 정도만 있다.

6. 재고단가 산정

   기존은 `raw_발주`의 재고생산 결제완료 데이터를 기준으로 `재고단가_자동`을 만들고, 이전 단가 대비 변경/급변 여부까지 계산한다. 통합은 CSV의 `단가` 또는 `재고금액/재고수량`에 의존한다.

7. 매입검토 인사이트

   기존은 파츠 검색, 최신 SKU 재고, 판매이력, 회전율, MOQ, 리드타임, 마지막 입고 등을 묶어 의사결정 화면을 만든다. 다만 이 영역은 별도 테이블과 운영 프로세스가 있으므로 1차 통합 대상에서 제외한다.

8. 시즌재고 계획

   기존은 `diary/direct/mediated` 3구분, 제품/옵션 단위 집계, 2023~2026 Q4 판매, CX 희망수량, 구매의견, CX의견, 현재고 연결, S&OP 확정수량 저장까지 있다. 이 역시 아직 확정 구현/운영 대상이 아니므로 1차 통합 대상에서 제외한다.

## CSV로 미리 계산해서 넣는 것이 나은 항목

통합 대시보드는 정적 HTML이므로 아래는 CSV 사전 산출이 낫다.

| 항목 | 이유 | 추천 CSV |
|---|---|---|
| 기간별 KPI 요약 | 평균재고/YTD/전주·전월 비교가 복잡함 | `dashboard_period_summary.csv` |
| 그룹별 요약 | 카테고리/서브카테고리/조달/생산/소싱별 회전율 계산 필요 | `dashboard_group_summary.csv` |
| SKU 스냅샷 | 상세 화면의 핵심 데이터이며 계산량 큼 | `dashboard_sku_snapshot.csv` |
| 품절 시작일/경과일 | 주간 이력 연속성 계산 필요 | `dashboard_sku_snapshot.csv`에 포함 |
| 재고단가 자동 산정 | raw_발주, 결제일, 이전 단가 비교 필요 | `unit_price_summary.csv` |
| 입고예정금액 | raw_발주 미입하와 SKU 조인 필요 | `incoming_orders.csv` |
| 주간 리포트용 요약 | 여러 화면 데이터를 조합함 | `weekly_inventory_report_data.csv` 또는 JSON |

## 통합 프론트에서 계산해도 되는 항목

| 항목 | 이유 |
|---|---|
| 최신 기준일 선택 | `period_summary`나 `inv_weekly`에서 간단히 추출 가능 |
| 카드 표시 포맷 | 원/%, 회전율 텍스트 변환은 브라우저 처리 적합 |
| 필터/정렬/검색 | 사용자 상호작용 영역 |
| 카테고리 Top N 표시 | 이미 집계된 CSV 기준으로 slicing만 하면 됨 |
| 모달 정렬 | 재고금액순, 회전율순 같은 정렬 |
| 운영밴드 상태 표시 | 금액과 밴드 값이 있으면 프론트 계산 가능 |
| 간단한 품절 카운트 | 이미 `stockout_days`, `sales_status`가 있으면 가능 |
| 시즌 확정수량 임시 입력 | 1차 통합 제외. 필요 시 개인 브라우저 임시값은 `localStorage`로 가능하지만 운영 원본은 별도 테이블 유지 |

## 현재 통합 대시보드의 누락/잘못 연결된 부분

> ⚠️ 아래 표는 **07-06 진단 시점(v10 병합 이전)** 기준이다. v10 이후 상태는 위 "v10 반영 현황" 표를 우선 참고할 것.

| 문제 | 현재 상태 | 영향 |
|---|---|---|
| 기존 집계 시트 3종 부재 | `dashboard_period_summary/group/sku`가 없음 | 기존 구매 대시보드와 KPI 숫자가 달라질 가능성 큼 |
| 회전율 분모 차이 | 통합은 주로 최신 재고금액 기준 | 기존의 1M/3M/YTD 평균재고 회전율과 불일치 |
| Product Parts 필터 약함 | `getManagedRows`는 관리대상 공란 시 전체 포함 | 품절률/회전율 대상이 넓어질 수 있음 |
| 품절 경과일 로직 차이 | 기존은 주간 이력 기반, 통합은 품절리스트 변경일 중심 | 장기품절 30/60일 판단이 달라질 수 있음 |
| 매입검토/시즌계획 메뉴 존재 | 통합 HTML에는 관련 화면/함수가 있으나 1차 이식 범위에서 제외 | 메뉴 노출 여부를 별도로 정리해야 함 |
| 입고예정금액 없음 | 기존 `getIncomingOrdersSummary` 대응 없음 | 핵심 KPI 카드 하나가 빠짐 |
| 흐름분석 부족 | 기존의 KPI 흐름, 카테고리/조달유형별 회전율 추이 없음 | 보고용 트렌드 화면 약함 |
| 협력사재고 품절 업로드 기능 없음 | 기존은 별도 CSV 업로드/리포트 병합 | 품절 리포트 범위가 선매입 중심으로 제한 |
| 주간 재고운영 리포트 축소 | 통합 `genWeekly`은 발주/이슈 중심 | 구매파트 주간 리포트 내용 미이식 |

## 이식 전략

1. 기존 Apps Script 계산을 그대로 브라우저로 옮기기보다, Apps Script 또는 별도 전처리에서 `dashboard_period_summary`, `dashboard_group_summary`, `dashboard_sku_snapshot`에 해당하는 CSV를 생성하는 쪽이 안정적이다.

2. 통합 대시보드는 그 CSV를 읽어서 보고용 화면을 구성해야 한다. 즉, 프론트는 “계산 엔진”이 아니라 “집계 결과 표시/필터/드릴다운” 역할로 두는 것이 맞다.

3. 1차 이식 범위는 아래가 적당하다.

   - 재고운영 현황 KPI: 재고자산, 1M/3M/YTD 회전율, 품절률, 운영밴드, 입고예정금액
   - 재고 구조: 생산구분, 소싱구분, 카테고리/서브카테고리
   - 품절 상세: 선매입 품절, 장기품절 30/60일
   - 장기미회전재고: 기존 기준 그대로
   - SKU 상세: 판매이력, 품절 주수, 마지막 입고
   - 주간/월간 보고용 재고 KPI 흐름: 재고자산, 회전율, 품절률, 카테고리/조달유형 추이

4. 매입검토와 시즌재고 계획은 1차 통합에서 제외한다. 기존 Apps Script/Sheets 또는 별도 테이블을 계속 원본으로 두고, 통합 대시보드에는 KPI 보고에 필요한 확정된 재고 지표만 반영한다.

5. 저장/편집 기능은 통합 대시보드에서는 우선 제외하는 것이 안전하다. GitHub Pages 정적 앱에서는 공유 저장소가 없기 때문에, 운영 데이터 입력/수정은 기존 원본 테이블에서 처리하고 통합 대시보드는 읽기 전용 보고 화면으로 둔다.

6. 통합 후 KPI 숫자 검증은 반드시 기존 `.clasp` 화면의 최신 주차와 통합 대시보드의 동일 기준일을 1:1로 비교해야 한다. 특히 `재고회전율`, `품절률`, `장기미회전재고`, `운영밴드`는 계산 기준이 조금만 달라도 숫자가 달라진다.
