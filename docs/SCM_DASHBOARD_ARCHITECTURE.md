# SCM 통합운영 대시보드 — 프로젝트 설계 아키텍처

> 버전: v21.2 | 갱신일: 2026-07-20 | 작성: 이난영 / Claude AI  
> 대상: 구매전략파트 · 외주생산파트 팀원 공유, 유지보수, 버그 대응

---

## 1. 시스템 개요

### 목적
구매전략파트(S&OP/재고운영)와 외주생산파트(발주/협력사/이슈관리)가  
하나의 HTML 대시보드에서 각자의 업무를 리뷰하고 운영 의사결정을 지원하는 **통합 SCM 운영 도구**.

### 핵심 특성
- **서버 없음** — 단일 `.html` 파일 하나로 동작. 외부 API 호출 없음.
- **자동 로드 (v7~)** — GitHub Pages 접속만 하면 `CSV/` 폴더의 고정 파일명 RAW를 자동 fetch. 접속자 수동 업로드 불필요.
- **데이터 입력** — 자동 로드 CSV + 수동 업로드(보정용) + 영구 임베딩 JSON 3종
- **v10부터 구매전략파트(재고운영) 데이터가 "사전집계 우선" 구조로 전환** — GSheets Apps Script가 `dashboard_period_summary` / `dashboard_group_summary` / `dashboard_sku_snapshot` 3종을 미리 계산해 CSV로 내보내고, 브라우저는 이를 그대로 표시(계산 엔진이 아니라 표시·필터·드릴다운 역할). 3종 CSV가 없으면 기존처럼 `inv_weekly`/`sales_monthly`를 브라우저에서 직접 집계하는 레거시 경로로 자동 폴백(`hasAggInventoryData()`).
- **파싱은 브라우저 JS** — 모든 집계·필터·차트 렌더링이 브라우저에서 실행(재고운영 사전집계 3종 제외). v7부터 멀티라인 셀 안전 상태머신 파서.
- **localStorage** — 업로드 일시, 매입검토 편집, 시즌계획 확정수량, JSON 캐시 저장
- **Chart.js 4.4.1** — CDN 로드, 오프라인 시 차트만 미표시
- **html2pdf.js 0.10.1 (v16)** — 협력사 PDF 내보내기 버튼 최초 클릭 시에만 CDN lazy-load, 오프라인 시 안내 후 중단
- **scm_vendor_change bank 연동 (v17)** — 별도 저장소의 GitHub API·bank/ JSON을 실시간 fetch(동일 origin, CORS 무관), 세션당 1회 캐시

### 배포 위치
| 파일 | 위치 |
|---|---|
| 운영 원본 | `index.html` (GitHub Pages가 직접 서빙) |
| 버전 스냅샷 | `scm_dashboard_v20.html` (index.html 복사본, 이전 버전은 `archive/`) |
| GitHub Pages | https://nanyounglee.github.io/SCMDASHBOARD/ |
| 레포지토리 | https://github.com/nanyounglee/SCMDASHBOARD |

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────────┐
│                   Airtable (원천 데이터)                           │
│  SCM KPI 베이스          │  공급망 관리 베이스  │  S&OP GSheets     │
│  · 발주_RAW (task)       │  · 공급망_RAW        │  · inventory_weekly│
│  · 이슈_RAW              │  · 분기별평가         │  · sales_monthly   │
│  · 고객인지이슈_RAW       │                      │  · purchase_review │
│  · 품절리스트             │                      │  · 시즌매입_파츠연결 │
└──────────────┬───────────────────────────────────────────────────┘
               │
               │  ※ 구매전략파트는 v10부터 GSheets Apps Script(재고운영 담당)가
               │    inventory_weekly/sales_monthly를 원본으로 아래 3종을 "사전집계"
               │    → dashboard_period_summary / dashboard_group_summary /
               │      dashboard_sku_snapshot (turnover_1m/3m/ytd, band_status,
               │      stockout_days, group_type/group_name 포함)
               │
               │  CSV Export (수동) — 주 1회 (외주생산) / 필요시 (구매전략)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  데이터 담당자 PC: CSV/ 폴더에 고정 영문 파일명으로 저장             │
│  order.csv · issue.csv · sup.csv · ci.csv · stockout_list.csv     │
│  inv_weekly.csv · sales_monthly.csv                               │
│  → deploy_v8.ps1 실행 (한글 원본 → 고정명 복사 + 커밋 + 푸시)       │
│    또는 GitHub 웹에서 CSV/ 폴더에 직접 업로드(덮어쓰기)             │
└──────────────┬───────────────────────────────────────────────────┘
               │  git push → GitHub Pages 재빌드 (1~3분)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│         접속자 브라우저 (index.html · v14 · 약 6,008줄)              │
│                                                                    │
│  ┌───────────────────────┐  ┌────────────────────────────────┐   │
│  │ autoLoadRaw() 자동 로드 │  │ 영구 임베딩 JSON (data/ 폴더)    │   │
│  │ · CSV/_manifest.json   │  │ · parts_master.json (2,749파츠) │   │
│  │   에서 파일명 매핑 확인  │  │ · data_2025.json (YoY 집계)    │   │
│  │ · 고정명 fetch          │  │ · cost_db.json (공정+단가DB)    │   │
│  │ · 슬롯에 "N행 (자동)"   │  └──────────────┬─────────────────┘   │
│  └──────────┬────────────┘                 │ fetch → localStorage │
│             │  (수동 드래그앤드롭 업로드는 자동 로드분을 덮어씀)       │
│             └─────────────┬─────────────────┘                     │
│                           ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │        데이터 집계 엔진 (v7: 멀티라인 안전 CSV 파서)             │ │
│  │  purchaseByMonth() │ calcElapsedDays() │ calcProjectCost()    │ │
│  │  getReworkCostForProject() │ matchesSearch() │ YoY/MoM        │ │
│  │  getSubcontractRiskRows() │ getPartCostForQty() │ goodsCode() │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │  [v10 신규] 재고운영 Agg 경로 (구매전략파트)                    │ │
│  │  hasAggInventoryData() → true면 아래로, false면 레거시 계산    │ │
│  │  getAggPeriodRows/getAggGroupRows/getAggSkuRows                │ │
│  │  isAggManaged/isAggProduct/isAggStockout/aggStockoutDays       │ │
│  │  renderInventoryOpsFromAgg/renderStockoutDetailFromAgg/        │ │
│  │  renderGraduationFromAgg/renderAggInventoryDonut               │ │
│  └──────────────────────────────────┬───────────────────────────┘ │
│                                     ▼                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              UI 렌더링 (20개 페이지)                           │ │
│  │  KPI 카드 │ Chart.js 차트 │ 테이블 │ 모달 │ 검색 필터          │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 입력 데이터

### 3-0. 자동 로드 & 고정 파일명 (v7 · 배포용)

접속자는 아무것도 업로드하지 않는다. 페이지 로드 시 `autoLoadRaw()`가 실행되어:

1. `CSV/_manifest.json`을 fetch — 있으면 key→파일명 매핑을 덮어씀 (HTML 수정 없이 파일명 변경 가능)
2. 없으면 기본 고정 파일명 사용:

| Key | 고정 파일명 | 원본 (한글) | 갱신 주기 | 담당 |
|---|---|---|---|---|
| `order` | `CSV/order.csv` | SCM_발주_RAW(2026).csv | 주 1회 | 외주생산 |
| `issue` | `CSV/issue.csv` | SCM_이슈_RAW(2026).csv | 주 1회 | 외주생산 |
| `sup` | `CSV/sup.csv` | SCM_공급망_RAW(2026).csv | 주 1회 | 외주생산 |
| `ci` | `CSV/ci.csv` | SCM_고객인지이슈_RAW(2026).csv | 주 1회 | 외주생산 |
| `stockout_list` | `CSV/stockout_list.csv` | 품절리스트_*.csv | 필요시 | 공통 |
| `inv_weekly` | `CSV/inv_weekly.csv` | S&OP 대시보드_inventory_weekly.csv | 필요시 | 구매전략 |
| `sales_monthly` | `CSV/sales_monthly.csv` | S&OP 대시보드_sales_monthly.csv | 필요시 | 구매전략 |

- 자동 로드 성공 시 업로드 슬롯에 **"N행 (자동)"** 표시
- 수동 업로드는 여전히 가능하며 자동 로드분을 덮어씀 (보정용)
- 자동 로드는 https 호스팅에서만 동작. 로컬 `file://`로 열면 수동 업로드 사용

### 3-1. 외주생산파트 CSV (4종 · 주 1회)

#### 발주_RAW (`order.csv`)
**Airtable**: SCM KPI → task-SCMKPI_Raw 뷰

| CSV 컬럼명 | 용도 | 비고 |
|---|---|---|
| `과업지시일자` | 발주 TASK 월 기준 | `2026.6.3` 형식 |
| `발주번호` | 비스포크 산출물 식별 | |
| `산출물` | 제품명 | 비어있으면 비스포크 |
| `수주처` | 협력사명 | |
| `과업담당자_이름` | 담당자별 집계 | |
| `발주지시수량` | 발주량 집계 | |
| `공급가액` | 매입금액 (VAT 별도) | `₩1,200,000` 형식 |
| `세금계산서작성월 (from 지출결의)` | 매입금액 월 기준 | `25년 6월` 형식, 분할 가능 |
| `합계_분할` | 분할 세금계산서 월별 금액 | |
| `파츠유형` | Product Parts 필터 | |
| `sync_itemdb` | 파츠코드·굿즈코드 추출 → 원가 산출 | `BRPR_PT4421-...` 형식. v7에서 `goodsCode()` 소스로 수정 |
| `movement_산출이동` | 재고생산 판별 | '재고' 포함 여부 |
| `project` | 프로젝트 집계 + 재고 판별 | `PNA51823-OSSTUDIO` 형식 |
| `긴급여부` | 긴급발주 카운트 | `긴급` 문자열 |
| `task_id` | 재제작 판별 (실패비용) | '재제작' 포함 여부 |
| `취득원가` | 실패비용 산출 | |
| `R) 판매가(최종)` | 매출액 · 마진율 산출 | |
| `입하예정일 (from movement_산출물)` | 입하경과일 산출 (기준일 1순위) | |
| `입하확정일 (from movement_산출물)` | 입하경과일 산출 (기준일 우선) | |
| `실제입하일 (from movement)` | 입하경과일 산출 (종료일) | |
| `협력사 결제조건 (from 수주처)` | 협력사 정보 | |

#### 이슈_RAW (`issue.csv`)
**Airtable**: SCM KPI → KPI_이슈_RAW 뷰

| CSV 컬럼명 | 용도 |
|---|---|
| `실제입하일` | 이슈 월 필터 (우선) |
| `입하예정일` | 실제입하일 없을 때 대체 |
| `이슈카테고리` | 품질/수량/운영 분류 (복합값 가능) |
| `project_name` | 프로젝트명 |
| `item (통합) (from order)` | 제품명 (제품×협력사 이슈율 매트릭스 조인용, order.csv 산출물과 정확 일치 필요) |
| `입고물품` (v14 신규) | 이슈 목록·검색 표시용 정제된 제품명 (1순위, 비어있으면 위 필드로 폴백) |
| `프로젝트_발주자` | 담당자 |
| `품질이슈내용` | 품질 탭 상세 |
| `품질등급최초판정` | 품질 등급 |
| `품질등급의견판단사유_SCM` | **대응** 컬럼 표시 |
| `수량이슈내용` / `수량이슈대응방안` | 수량 탭 |
| `운영이슈내용(by물류)` / `운영이슈개선방안_SCM` | 운영 탭 |

#### 공급망_RAW (`sup.csv`)
**Airtable**: 공급망 관리 → 공급망_RAW 뷰

| CSV 컬럼명 | 용도 |
|---|---|
| `협력사 이름` | 협력사 식별키 |
| `1. 제조유형` | 턴키제작/외주용역/단순구매 매핑 |
| `업태` | 업태별 매입비중 차트 |
| `인쇄` | 인쇄유형별 차트 |
| `협력사 Status` | 거래중 여부 |
| `발주담당자` | 협력사 MD |
| `협력사 결제조건` | 결제조건 |
| `하도급계약 대상여부` | **하도급법 위험 자동 판별** (`대상` / `비대상`) |

#### 고객인지이슈_RAW (`ci.csv`)
**Airtable**: SCM KPI → 고객인지이슈_RAW 뷰

| CSV 컬럼명 | 용도 |
|---|---|
| `등록일자` | 월 필터 기준 |
| `프로젝트명` | 테이블 표시 + 실패비용 조인 + (v14) order.csv project 조회로 검색 매칭 |
| `관련제품` | 테이블 표시 + (v14) 프로젝트 범위 내 산출물-수주처 검색 매칭(§4-20) |
| `작성자명` | 작성자별 차트 |
| `이슈내용` | 상세 표시 |
| `상태` | 상태 태그 |
| `idx_issue` (v13) | CI_OVERRIDES(대응내용·실패비용 수기입력) 조인 키 |

### 3-1-1. 코스트베이스(파츠리스트) CSV — `parts` (v11 신규)

**Airtable**: SCM KPI → "4. parts" 뷰

| CSV 컬럼명 | 용도 | 비고 |
|---|---|---|
| `파츠명 (Long ver)` | 파츠 식별 | |
| `굿즈 연결 현황 (from item)` | 굿즈→파츠 BOM 역인덱스 소스 | 콤마 구분, 하나의 굿즈에 여러 파츠 연결 |
| `파츠 유형` | Product/Package/Printing 구분 | DB원가 산출 시 전 유형 합산 |
| `1개_표준원가` ~ `30000개_표준원가` | 수량구간별 표준원가 | 10구간(1/50/100/300/500/1000/3000/5000/10000/30000개) |

> `parts` CSV는 발주 상세 분석의 "DB원가비교" 탭(§4-9) 전용 소스다. 없어도 다른 화면은 정상 동작하며, 이 탭만 데이터 없음으로 표시된다.

### 3-2. 구매전략파트 CSV

**[v10 신규] 사전집계 3종 — 재고운영/품절/졸업검토의 기본 소스**

GSheets S&OP Apps Script가 `inventory_weekly`/`sales_monthly` 원본을 기간(주/월/분기)·그룹(카테고리·서브카테고리·조달유형·생산구분·소싱구분) 단위로 미리 계산해 내보낸다. `purchase_dashboard_migration_strategy.md`(2026-07-06)에서 지적된 "사전집계 시트 3종 부재" 갭을 해소한 것으로, 통합 대시보드는 이제 이 3종을 그대로 표시만 한다.

| Key | 파일명 | 출처 | 필수 컬럼 | 비고 |
|---|---|---|---|---|
| `dashboard_period_summary` | (자동/수동) | GSheets S&OP → dashboard_period_summary | period_unit, period_key, inv_amount, turnover_3m (+turnover_1m/ytd, stockout_rate, band_status) | 기간 단위 KPI. `getAggPeriodRows()` |
| `dashboard_group_summary` | (자동/수동) | GSheets S&OP → dashboard_group_summary | group_type, group_name, inv_amount, turnover_3m (+sku_count) | 카테고리/서브카테고리/생산구분/소싱구분별 집계. `getAggGroupRows()`, 도넛차트 3종 소스 |
| `dashboard_sku_snapshot` | (자동/수동) | GSheets S&OP → dashboard_sku_snapshot | parts_no, parts_name, inv_amount, turnover_3m (+is_managed, sales_status, stockout_days) | SKU 단위 상세. `getAggSkuRows()`, 재고자산 모달·품절상세·졸업검토 공통 소스 |

**3종 모두 있어야 Agg 경로 활성화** — `hasAggInventoryData()`가 세 CSV를 모두 확인. 하나라도 없으면 아래 레거시 경로로 폴백.

| Key | 파일명 | 출처 | 필수 컬럼 |
|---|---|---|---|
| `inv_weekly` | inv_weekly.csv | GSheets S&OP → inventory_weekly | 파츠번호, 기준일, 재고수량, 재고금액, 단가, 판매상태, 굿즈카테고리 (※ `관리대상여부` 없으면 폴백: 전 행 관리대상 간주). Agg 3종 부재 시 레거시 프론트 계산의 원본 |
| `sales_monthly` | sales_monthly.csv | GSheets S&OP → sales_monthly | 파츠번호, 기준월, 판매량 |
| `purchase_review` | (수동 업로드) | GSheets S&OP → purchase_review | REVIEW_ID, 파츠번호, 결정상태, 파츠명, 매입계획수량, 매입확정수량 |
| `season_plan` | (수동 업로드) | GSheets S&OP → 시즌매입_파츠연결 | 굿즈명, 옵션, 계획구분, 표준원가, 매입희망수량 |

> `purchase_review`·`season_plan`은 1차 통합 범위에서 제외([[purchase_dashboard_migration_strategy.md]] 참고) — 화면·업로드 슬롯은 남아있으나 운영 원본은 GSheets이며 저장 기능은 없음.

### 3-3. 공통/선택 CSV

| Key | 파일명 | 출처 | 필수 컬럼 |
|---|---|---|---|
| `stockout_list` | stockout_list.csv | Airtable → sales_status_history | 파츠명, 판매상태, 품절 성격, 변경일(인터페이스용), 재고소유구분, 굿즈품절여부 |
| `sales` | (수동 업로드) | GSheets SUPER BASE | 제품명, 주문수량, 판매단가, 소계, 연월 |
| `qms_raw` | (수동 업로드) | Airtable → 품질이슈 뷰 | 발생일, 이슈유형, 파츠번호 |
| `cost_reduction` | (수동 업로드) | Airtable → Movement 데이터 | project, 출고자재, 수량, 실제단가 |

### 3-4. 영구 임베딩 JSON (`data/` 폴더 · 업로드 불필요)

| 파일 | 크기 | 내용 | 갱신 |
|---|---|---|---|
| `data/parts_master.json` | 834KB | 파츠 마스터 2,749개 (코드/파츠명/카테고리/협력사/수량별 원가/MOQ/리드타임 등 18필드) | "파츠 마스터 갱신" 버튼 |
| `data/data_2025.json` | 45KB | 2025년 월별 사전집계 (YoY 폴백 — v21부터 원본은 `CSV_BANK/archive/{연도}/`에서 로드, 이 파일은 원본 미로드 시에만 사용) | 연 1회 재생성 |
| `data/cost_db.json` | 1.3MB | 공정DB 1,623개 + 단가DB 3,549개 (수량별 표준단가 10구간) | 공정/단가 변경 시 |

---

## 4. 핵심 파싱 로직

### 4-0. CSV 파서 (v7 · 멀티라인 셀 안전)
```javascript
// v7: 전체텍스트 상태머신 파서 (q = 따옴표 내부 여부 추적)
// 따옴표 안의 줄바꿈을 레코드 분리로 오인하지 않음.
// v6 이전 라인분할 파서는 이슈내용·변경사유 등 멀티라인 셀에서 레코드가 조각나
// 품절(실제 54행→87행), 이슈(296→953), 고객인지(321→1,216)로 부풀려졌음.
```

### 4-1. 발주 TASK 카운트
```javascript
// 기준: 과업지시일자 월 기준 행 카운트
const allMo = D.order.filter(r => pOrderMonth(r['과업지시일자']) === SEL_MONTH);
const proj = allMo.filter(r => !isStock(r));   // 프로젝트 발주
const stock = allMo.filter(r => isStock(r));    // 재고생산
const urgent = proj.filter(r => r['긴급여부'] === '긴급'
  && r['수주처'] !== '서울디지털인쇄협동조합');  // 긴급 (서울디지털 제외)
```

### 4-2. 월 매입금액 — 세금계산서 분할 처리
```javascript
function purchaseByMonth(row) {
  const taxMonths = pTaxMonth(row['세금계산서작성월 (from 지출결의)']);
  if (taxMonths.length === 1) return { [taxMonths[0]]: pa(row['공급가액']) };
  // 분할: 합계_분할 필드 월별 금액 사용, 없으면 균등 분할
  const splitAmts = pSplitAmounts(row['합계_분할']);
  taxMonths.forEach((m, i) => {
    result[m] = splitAmts[i] > 0 ? splitAmts[i] : 공급가액 / 월수;
  });
}
// v7: KPI 표시 함수 fa() 천만 구간 1자리 소수 표시 (2,500만이 "2천만"으로 보이던 문제 수정)
```

### 4-3. 입하경과일 자동 산출 + 하도급법 위험
```javascript
function calcElapsedDays(row) {
  기준일 = 입하확정일 || 입하예정일;
  종료일 = 실제입하일 || 오늘;
  return (종료일 - 기준일) / 86400000;
}
// 하도급법 위험: 공급망_RAW 하도급대상여부==='대상' + 미입하 + 경과일≥90일
```

### 4-4. 원가 산출 (파츠마스터 + 공정DB)
```javascript
1. sync_itemdb에서 파츠코드 추출 (정규식: [A-Z]{4}_PT\d+)
   // v7: goodsCode()도 sync_itemdb에서 추출 (존재하지 않는 컬럼 참조 버그 수정 → 5,300행 산출)
2. 파츠코드 → parts_master.json 수량별 단가 조회
3. 공정DB → 굿즈코드별 공정 구성 + 표준단가 조회
4. 제품원가 = Σ(파츠별 구간단가 × 수량)
5. 마진율 = (판매가 - 원가) / 판매가
```

### 4-5. 실패비용
```javascript
function getReworkCostForProject(projName) {
  // 발주_RAW에서 동일 project의 task_id에 '재제작' 포함 행의 취득원가 합계
}
// 적용: 이슈현황 전체/품질/수량/운영 탭, 고객인지이슈 모달, 이슈 모달
```

### 4-6. 전년 동기 비교 (YoY) + 전월 대비 (MoM)
```javascript
// YoY: data_2025.json에서 전년 동월 집계 조회 (CSV 업로드 불필요)
get2025Month('2025.6') → {tasks:925, purchase:316712760, urgent:185, ...}

// MoM: getPrevMonth('2026.6') → '2026.5', getPrevMonth('2026.1') → '2025.12'
// v5: 월키 정렬 15곳 monthCmp() 적용 (문자열 정렬로 2025.10이 2025.2 앞에 오던 버그 수정)
```

### 4-7. 품절 집계 (v7 수정)
```javascript
// 의도적/비의도적 품절 분류: '비의도적'이 '의도적' substring 매칭에 걸려
// 의도적 품절이 +17 과다 집계되던 버그 수정 → 정확히 분리
```

### 4-8. 검색 필터
```javascript
function matchesSearch(row, query) {
  // 16개 필드에서 검색어 포함 여부 확인
  // → 모든 KPI, 차트, 테이블에 실시간 적용
}
```

### 4-9. 재고운영 Agg 경로 (v10 신규 · 구매전략파트)
```javascript
function hasAggInventoryData(){
  // dashboard_period_summary/group_summary/sku_snapshot 3종 모두 있어야 true
  return !!(D.dashboard_period_summary && D.dashboard_group_summary && D.dashboard_sku_snapshot);
}
// renderInventoryOps() / renderStockoutDetail() / renderGraduation() 공통 패턴:
//   if (hasAggInventoryData()) { render...FromAgg(); return; }
//   (없으면) 기존 inv_weekly 기반 프론트 계산으로 폴백

function isAggManaged(r){ return String(r.is_managed).trim().toUpperCase()==='Y'; }
function isAggProduct(r){ return String(r.sub_category||r['서브카테고리']).trim()==='Product Parts'; }
function isAggStockout(r){
  const s=String(r.sales_status).trim();
  return s==='일시품절' || s==='비의도적품절';
}
function aggStockoutDays(r){ return toNum(r.stockout_days); } // GSheets가 사전산출, 브라우저는 조회만
```
그룹 도넛차트 3종(`renderAggInventoryDonut`)은 `dashboard_group_summary`의 `group_type`별(생산구분/소싱구분/카테고리) 행을 그대로 그린다 — `purchase_dashboard_migration_strategy.md`의 갭 #5(그룹 집계) 해소.

### 4-10. 발주 상세 분석 3-tab + DB원가 비교 (v11 신규)
```javascript
// openModal('orderTask') → renderOrderTaskModal() : 탭 3개
// ① 발주현황 Top — 기존 굿즈 발주량 내림차순 로직 그대로(renderOrderTaskTop)
// ② 미발주현황 — computeNoOrderStatus(): 굿즈코드 단위로 D.order 전체 히스토리에서
//    마지막 발주월 대비 SEL_MONTH 미발주 품목 집계 (과거 이력 있는 품목만, 비스포크/신제품 제외)
// ③ DB원가비교 — getGoodsPartsIndex()가 '굿즈 연결 현황 (from item)' 컬럼(콤마구분)으로
//    굿즈→파츠 BOM 역인덱스 구성
//    → partTierCost(row,qty): 수량구간 매칭 (발주수량 이하 최대구간, 없으면 다음 구간 폴백,
//      blank와 0을 구분해 0원도 유효값으로 인정)
//    → computeGoodsDbCostForOrder(): 굿즈의 전체 구성 파츠(Product+Package+Printing 전부)
//      단가합 × 수량 = 오더별 DB원가, 월별 합산 후 실제 매입금액과 비교
//      절감율 = (DB원가 - 매입금액) / DB원가 × 100
```

### 4-11. 공급망 포트폴리오 — QCD×관계 Tier (v12, 4분면 기준 교체)
```javascript
// 기존(v9) 매입액×등급 4분면(Core/Strategic/Preferred/General)을 폐기하고
// QCD × 관계 점수 기준 Tier로 교체. 5축 점수 산출 로직(parseQuarterEval/computeFromRaw)은
// 그대로 재사용 — 분류 기준(quadrant 산식)만 교체됐다.
//
// QCD (9점) = TASK 점수 + 매입대금 점수 + 이슈대응 점수  (기존 3-10의 개별 항목 재사용)
// 관계 (6점) = 예외사항 점수 + 대체가능 점수
//
// Tier1 Core       : QCD>=7 AND 관계>=5
// Tier2 Performer   : QCD>=7 AND 관계<5
// Tier3 Developing  : QCD<7  AND 관계>=5
// Tier4 General     : QCD<7  AND 관계<5
//
// A/B/C/D 등급(총점 기준, §3-10)은 폐지되지 않고 Tier와 별도로 계속 표시된다.
// 이번 달 발주실적 있는 협력사만 보기 체크박스(togglePortfolioActive)와
// C/D등급 변경검토 리스트(renderPortfolioChangeReview)가 신규 추가됐다.
```

### 4-12. 협력사 상세 모달 — 연도별 매입추이 + 이슈 상세 (v12)
```javascript
// openSupplierDetailModal() 확장:
// - 연도별(25/26 등) 매입추이 라인차트(ch-sup-detail-trend) 추가
// - "가장 빈번한 발주 제품 Top 3" 드릴다운은 기존 구현 그대로 유지(변경 없음)
// - 이슈 상세 테이블 신규: 이슈_RAW에는 협력사 필드가 없어 프로젝트 코드 접두어로 조인
//   getProjKeySupplierMap(): D.order의 project 필드 접두어(split('-')[0]) → 협력사 매핑
//   getIssuesForSupplier(supName): D.issue의 project_name 접두어를 위 맵과 매칭해 귀속
//   (기존 getReworkCostForProject()와 동일한 조인 패턴 재사용 — 코드 접두어 불일치 시 누락 가능,
//    추정 조인이므로 정밀 매칭 컬럼이 생기면 교체 권장)
```

### 4-13. 제품×협력사 이슈율 매트릭스 (v12 신규)
```javascript
// 이슈 탭에 "제품×협력사 이슈율" 탭 추가 → renderIssueRateMatrix()
// D.order를 (산출물×수주처) 그룹으로 발주건수 집계
// D.issue를 (item(통합)(from order) × projKey→협력사) 그룹으로 이슈건수 집계
// 이슈율 = 이슈건수 / 발주건수 × 100, 행 클릭 시 상세 펼침(toggleIssuePxRow)
```

### 4-14. 제품별 발주수량 추이 (v12, 기준 데이터 교체)
```javascript
// 기존 "제품별 판매량 추이"는 D.sales_monthly/D.sales(사용자가 상시 업로드하지 않는 CSV)에
// 의존해 사실상 항상 빈 화면이었음 — 버그가 아니라 설계상 CSV 의존성 오류였음.
// renderProductTrend()를 D.order 발주지시수량 기준으로 전면 교체:
//   - isStock(재고생산) 행 제외
//   - 산출물(제품명) 없는 비스포크 행 제외
//   - pOrderMonth(과업지시일자) 기준 월별 그룹핑
// 화면 라벨도 "판매량" → "발주수량"으로 변경. 소스: 발주_RAW(order.csv) — 항상 보유하는 CSV.
```

### 4-15. KPI 목표값 리포트 동기화 (v12)
```javascript
// quality_issue 목표 3 → 2.61, delivery_ontime 목표 97 → 98.44(=미입하율 1.56%)
// 신규 KPI: cost_failure(실패비용율) — 목표 1% 이하
//   실패비용율 = 실패비용합계(재제작 취득원가) / 매입금액합계 × 100
//   (취득원가/task_id 컬럼명 가정 — 실제 컬럼명과 다르면 재확인 필요)
```

### 4-16. 기간 통합 선택 (v13)
```javascript
let SEL_RANGE=null; // {y, from, to} | null
function inSelPeriod(mo) {
  if(SEL_RANGE){ const p=String(mo).split('.').map(Number); return p[0]===SEL_RANGE.y&&p[1]>=SEL_RANGE.from&&p[1]<=SEL_RANGE.to; }
  return mo===SEL_MONTH;
}
// 단일 월 칩 대신 "26년 1~7월" 등 기간 칩 선택 시 SEL_RANGE 설정.
// 대부분의 KPI/차트/모달이 SEL_MONTH 단일 비교 대신 inSelPeriod()를 사용하도록 전환됨.
```

### 4-17. 발주 진행현황 탭 (v13 신규)
```javascript
// 주간 CSV(progress_연도_W주차.csv)를 전주 파일과 자동 비교
// 담당자별 진행중/신규/완료 요약, TASK별 입하예정일 기준 진행률·지연일수 산출
// 비고(특이사항) 저장 시 최초/수정 이력을 일시와 함께 병기
// GitHub PAT 연동 시 data/progress_notes.json 자동 커밋(§4-19)
```

### 4-18. 고객인지이슈 대응내용·실패비용 수기입력 (v13)
```javascript
let CI_OVERRIDES={}; // idx_issue 키 → {cost, response 등}
function ciExtraCost(r) {
  const idx=r['idx_issue']; const ov=idx?CI_OVERRIDES[idx]:null;
  return ov&&ov.cost?pa(String(ov.cost)):0;
}
// getReworkCostForProject()의 자동 산출 실패비용에 수기입력분을 더해 합산.
// GitHub PAT 등록 시 data/ci_overrides.json 자동 커밋(디바운스 3초).
```

### 4-19. GitHub 직접 커밋 연동 (v13)
```javascript
// commitFileToGitHub(path, content, message) — 설정 모달(⚙)에서 등록한
// 개인 Fine-grained PAT(Contents Read/Write 권한)로 GitHub Contents API 직접 호출.
// progress_notes.json / ci_overrides.json 저장 시 자동 커밋 → GitHub Pages 재배포(1~2분).
```

### 4-20. 고객인지이슈(ci) 검색 매칭 — 프로젝트 범위 산출물-수주처 조인 (v14 신규)
```javascript
// ci.csv에는 협력사(수주처) 컬럼이 없어 협력사 검색 시 0건으로 집계되던 문제 수정.
// v1(전체 order.csv 대상 부분일치)은 과다매칭(195/1001건) 확인 후 폐기, v2로 재설계:
function getProjectProductIndex() {
  // D.order를 project별로 그룹핑, 그룹 내 {정규화 산출물명, 수주처} 후보 인덱싱
}
function closestSupplierInProject(candidates, token) {
  // 1) 정규화 완전일치 우선 채택
  // 2) 없으면 부분일치(포함관계) 중 길이차 최소 후보 채택
}
function getCiRowSuppliers(r) {
  // r['프로젝트명']으로 후보를 프로젝트 범위로 한정한 뒤 위 함수로 관련제품 각 토큰 매칭
  // 결과를 r.__ciSup에 캐시
}
// matchesSearch()는 ci 행(관련제품 필드 존재)에 한해 위 함수의 매칭 수주처 집합도 비교 대상에 포함.
```
> 검증: Node.js 시뮬레이션으로 재설계 전/후 대조 — 과다매칭 검색어가 0건으로 정리됨을 확인. 전체 1001건 중 23건이 프로젝트 범위 매칭으로 수주처 확보.

### 4-21. issue.csv 입고물품 컬럼 반영 (v14)
```javascript
// issue.csv에 정제된 제품명 컬럼 '입고물품' 추가 (기존 'item (통합) (from order)'는
// 옵션·파츠명이 뒤섞여 표시가 지저분했음 — 예: "톤앤톤쿨러백, 톤앤톤쿨러백, 지퍼, 실크, 실크")
// 이슈 목록·검색 표시명 우선순위: 입고물품 → item (통합) (from order)(폴백) → project_name
// 주의: 제품×협력사 이슈율 매트릭스(§4-13)의 order.csv 조인 필드는 정확 일치가 필요해
//       item (통합) (from order)를 그대로 유지 — 입고물품으로 교체하지 않음.
```

### 4-22. 검색 필터 누락 지점 전수 수정 (v14)
```javascript
// KPI 카드는 검색을 반영하지만, 그 카드를 클릭해 연 모달·서브탭·차트가
// D.order/D.issue를 월/기간 필터만 걸고 재조회해 검색어가 무시되던 지점들을 수정:
//   - renderOrderTaskModal() — inSelPeriod()에 matchesSearch() 결합
//   - type==='purchaseMonth' 모달 — getFilteredOrders()(검색+재고 제외 통합 헬퍼) 사용으로 통일
//   - filterIssueModal() 서브탭(품질/수량/운영) — "전체" 탭에만 있던 검색 필터를 서브탭에도 적용
//   - renderIssueTrendChart()/renderIssueLegend() (이슈 유형 도넛·월별 추이) — 대시보드 화면
//     단계부터 검색 필터가 전혀 없었던 것을 신규 추가
```

### 4-23. 필터 적용 CSV 다운로드 (v14 신규)
```javascript
// exportCurrentTables(): getCurrentSecEl()로 현재 표시 중인 섹션을 찾아
// 그 안의 테이블 DOM을 그대로 CSV 행으로 변환(csvCell 이스케이프) 후 다운로드.
// 별도 재계산 없이 렌더링된 DOM이 소스이므로 검색·기간 필터가 화면과 100% 일치.
```

### 4-24. 월간 공지사항 — 자동집계 + 스냅샷 diff + 수동 예외 (v14 추가분, 난영님 원격 반영)
```javascript
function renderMonthlyNotice() {
  // goods_master.csv 졸업일/출시일, stockout_list.csv 판매상태+변경일을
  // 선택 기준으로 필터해 졸업/출시/품절 제품 3개 박스 렌더
  // + 협력사 변동(신규/거래종료) 박스
}
// 협력사 변동: sup.csv 이번 달 명단 vs 직전 스냅샷(CSV_BANK/sup_YYYY_MM.csv, archive_csv.ps1이 매달 저장)을
// 협력사 이름 기준으로 diff(loadSupRosterDiff/diffSupNames) — 상태변경일 필드가 없어 명단 증감으로 판별
// 스냅샷 diff로 못 잡는 예외는 MANUAL_VENDOR_TERMINATIONS/MANUAL_STOCKOUT 하드코딩 리스트로 보강
```
> §4-26에서 이 함수의 기간 판정 방식이 SEL_MONTH 단일 비교 → SEL_DATE_RANGE 정확 매칭으로 교체됨.

### 4-25. 기간선택 통합 — 주별/월별/분기별/기간지정 (v15 신규)
```javascript
let PERIOD_UNIT='month'; // 'week'|'month'|'quarter'|'custom'
let SEL_DATE_RANGE=null; // {from:Date, to:Date} — 실제 일자 정밀 비교의 단일 소스
// selMonth/selRange/selWeek/selCustomRange 모두 SEL_DATE_RANGE를 설정한 뒤,
// deriveMonthCompat(from,to)로 레거시 SEL_MONTH/SEL_RANGE(월 문자열 기반)를 역산해
// 기존 ~80개 호출부를 무수정으로 유지.
function inSelDateRange(dateStr) {
  // parseAnyDate(dateStr)가 SEL_DATE_RANGE.from~to 사이인지 정확한 날짜로 비교
}
// FROZEN_SECTIONS(13개 화면)는 동일 선택기 UI를 보여주되 month 외 단위 탭을 비활성화
// (세부 필터 로직 업그레이드는 다음 버전 과제) — SOP_SECTIONS(6개, 구매전략파트)는
// 이미 자체 선택기(renderAggPeriodControls)가 있어 이 전역 바 자체를 숨김.
// MoM/YoY 배지 라벨은 periodUnitAdjacentLabel()로 단위별 전환(WoW/MoM/QoQ, 기간지정은 YoY만).
// 매입금액(purchaseByMonth)은 세금계산서작성월이 월 단위로만 존재해 selPeriodMonths()로 항상 월 스냅.
```

### 4-26. 월간 공지사항 — 정확한 날짜/다중월 합산으로 개선 (v15)
```javascript
// §4-24의 renderMonthlyNotice()를 SEL_MONTH 단일 월 비교에서 아래로 교체:
//   - 졸업/출시/품절: monthKeyOfDate(date)===SEL_MONTH → inSelDateRange(date) (정확한 날짜 비교)
//   - 협력사 변동/수동 예외 리스트: monthsTouchedBy(SEL_DATE_RANGE)가 반환하는
//     선택 구간에 걸치는 모든 달에 대해 개별 스냅샷 diff 후 Set으로 합산
// loadSupRosterDiff()의 stillSelected() 가드도 단일 SEL_MONTH 비교 대신
// monthsTouchedBy(SEL_DATE_RANGE).includes(y+'.'+m)로 교체 — 다중월 비동기 fetch 완료 시
// 이미 다른 기간으로 넘어갔으면 재렌더 생략.
```
> 배경: 기간지정(custom) 기본값이 "최근 7일"이라 SEL_MONTH가 항상 최신월로 근사되어,
> MANUAL_VENDOR_TERM_MONTH='2026.6' 같은 특정월 하드코딩 예외가 5~7월처럼 6월을 포함하는
> 임의 구간에서 보이지 않는 문제가 있었음 — 팀원 리포트로 발견.

### 4-27. 협력사 PDF 내보내기 — 상세 스냅샷 + 분석 리포트 (v16 신규)
```javascript
// 협력사 현황 드릴다운(buildSupplierDetail) 헤더에 버튼 2종 추가. html2pdf.js는 최초 클릭 시 CDN lazy-load.
loadHtml2Pdf()           // <script> 주입 + Promise 캐시(_html2pdfLoading), onerror 시 리셋해 재시도 허용

exportSupplierPdf(btn, supName)          // ① 상세 스냅샷
//   드릴다운 DOM cloneNode → 라이브 캔버스의 Chart 인스턴스(Chart.getChart||CHARTS)를
//   toBase64Image() PNG <img>로 치환(차트 미생성 시 영역 제거) → max-height/overflow 펼침 →
//   select·button·id 제거 → detached wrap에 머리말 삽입 → html2pdf A4 저장
//   ※ wrap을 body에 append하면 오버레이 복제 시 높이 0 붕괴(빈 PDF) — 반드시 detached로 전달

exportSupplierAnalysisReport(btn, supName)  // ② 분석 리포트 (A4 2p, 데이터에서 직접 조립)
//   loadPrevYearRaw(prevY): v21부터 loadPriorYearArchive()가 이미 로드한 D.orderPrevYear를 재사용,
//   없으면 CSV_BANK/archive/{연도}/order_{연도}.csv 1회 fetch·캐시(PREV_RAW_CACHE)
//   _repMonthly: 수주처×과업지시월 tasks/qty/amt 집계
//   예상: baseTo=curM-1(완결월), f[k]=Σ올해(1~baseTo)/Σ전년(1~baseTo), proj=전년동월×f[k]
//         canProj = hasPrev && baseTo>=1 (전년無/1월이면 예상 생략)
//   _repSupIssues: 프로젝트 접두어 조인(§4-12 패턴)으로 이슈 귀속, 제품×유형 2건↑ 재발 집계
//   _repTopProds: 발주수량 Top5,  _repLineChart: 외부 라이브러리 없이 SVG 추세선(실선 실적/점선 예상)
//   → 연간요약·YoY·추세선·월별표·Top5·재발이슈·핵심요약 2줄
//   ※ v20까지 별도 로더·별도 파일명으로 2025 데이터가 두 경로로 중복 로드되던 것을 v21에서
//     CSV_BANK/archive/{연도}/ 단일 경로로 통일 완료 (SCM_발주_RAW(2025).csv 등 중복 파일 삭제)
```
> 검증: 발주 5,924행·이슈 344행 + 2025 RAW 13,529행으로 save()를 stub해 생성물 캡처 —
> 5개 섹션·SVG 2개·표 7개가 에러 없이 렌더, 예상 산식·파일명 확인. 제약: 이슈 귀속은 접두어 추정 조인(§4-12 한계 공유),
> YoY·예상은 전년 RAW 보유 전제, 두 버튼 모두 html2pdf CDN 접근 필요.

### 4-28. 리포트/KPI 내보내기 버그 수정 (v16)
```javascript
genWeekly()   // 주간 업무 보고: 긴급 발주에 URGENT_EXCLUDE_SUP(서울디지털인쇄) 제외 적용,
              //   월 매입금액 !isStock 필터 제거(재고생산 포함) → §4-1 KPI 카드와 기준 일치, 재고생산 TASK 별도 병기
exportKPI()   // 'KPI 요약 CSV': 발주 RAW 행 대신 computeKPIs()×KPI_DEFS 실측
              //   (영역·지표·단위·목표·선택월 값·달성여부·산식) 요약 CSV로 교체
```

### 4-27b. 협력사 변경 검토 진행 현황 — scm_vendor_change bank 연동 (v17)
```javascript
// 협력사 현황(supplier) 화면, 협력사 목록 위에 카드 신규. nav()에서 id==='supplier' 최초 진입 시
// loadVendorChangeStatus() 지연 호출(세션당 1회, 캐시 재사용) — refreshAll() 잦은 재실행에도 재조회 안 함.
// 두 사이트 모두 nanyounglee.github.io 아래 다른 경로라 fetch가 동일 origin — CORS 제약 없음.
loadVendorChangeStatus(force):
  1. GET api.github.com/repos/nanyounglee/scm_vendor_change/contents/bank → 파일 목록(download_url)
  2. .json 파일들을 Promise.all 병렬 fetch(실패분은 빈 배열 폴백)
  3. id 기준 병합 → renderVendorChangeStatus()가 단계별 건수 + 최근 완료 변경 표 렌더, 카드 클릭 시 새 탭 이동

// 병합: 같은 id가 팀원별 bank 파일에 다른 진행 상태로 중복 등장 —
// "마지막 파일 우선"은 파일 처리 순서(알파벳순)에 따라 오래된 사본이 최신 사본을 덮어쓸 위험이 있어 채택 안 함
vcStatusRank(status) = 완료:3, 확정:2, 전환검토중:1, 그외:0
merge: workflowStatus = 랭크 최댓값 사본 · completedDate/confirmedDate = 사본 중 최댓값(ISO 날짜 문자열 비교)
       · 기타 필드는 랭크 최댓값 사본을 기준으로 채택
```
> 검증: bank/ 8개 JSON(검토 40건·고유 10건)으로 전환검토중 3/확정 1/완료 6 — scm_vendor_change 라이브 페이지와
> 일치 확인, 파일 처리 순서 무관성 확인. 오프라인/fetch 실패 시 에러 상태로 폴백(카드는 계속 클릭 가능).
> 한계: 팀원이 로컬에서 상태를 바꿨지만 bank로 아직 내보내지 않았으면 반영 안 됨(그 도구의 구조적 제약).

### 4-29. 여분(버퍼) 발주수량 추천 — 이슈 이력 기반 예방원가 분석 (v21.2 신규)
```javascript
// 발주 현황(order) 화면 하단 카드. updateOrderTabs() → renderOrderBuffer().
// 데이터 범위: 당해(D.order/D.issue) + 전년 아카이브(D.orderPrevYear/D.issuePrevYear),
// 상단 기간 필터 무관(표본 확보 목적) · 검색창(matchesSearch)은 반영.
computeBufferRows():
  1. 발주 집계(재고생산 제외, 산출물별): taskCnt·총수량·공급가액·미입하(hasNoReceipt)·
     실패비용(task_id '재제작' 포함 행의 취득원가 합)
  2. 이슈 → 제품 매칭 bufferIssueProductKey(): 입고물품(v14 정제명) 1순위 →
     item(통합) 콤마 토큰 중 발주 RAW에 실재하는 산출물명 첫 일치 (실크·UV 등 공정 토큰 자동 배제)
  3. 수량부족: parseShortageFromText(수량이슈내용) — "N개 발주/M개 입하"·"발주수량 N…입하수량 M"·
     "N개 부족" 3패턴(과입고는 제외), 매칭 실패 시 이동수량_예정 vs 입하수량 컬럼 폴백
     ※ 구조화 컬럼은 조정 후 수치가 기록되는 경우가 많아 텍스트 파싱을 우선한다
  4. 품질불량: Σ불량수량_샘플링검수 ÷ Σ검수수량 (def<=insp 행만)
  5. 권장버퍼% = ceil(수량부족률 + 품질불량률), 1~10% 클램프 (정량 데이터 없으면 null → '—')
     권장여분/회 = ceil(평균 1회 발주수량 × 버퍼%)
  6. 단가: D.parts(파츠리스트 CSV) 있으면 computeGoodsDbCostForOrder() DB원가 우선,
     없으면 평균매입단가(Σ공급가액 ÷ Σ발주수량)
  7. 예방비용 = 여분수량 × 단가 × taskCnt (같은 이력 기간 전체에 버퍼 적용 가정)
     차액 = 실패비용 − 예방비용 (>0 초록 = 버퍼 도입이 재제작보다 경제적)
// 행 클릭(toggleBufferRow) → bufferScenarioHtml(): 버퍼 1/2/3/5/10%+권장 시나리오별
// 여분수량·예방비용·차액·판정 비교 표 인라인 확장 (제품×협력사 매트릭스와 동일 패턴)
```

### 4-30. 고객인지이슈 탭 통합 + 월간 공지사항 접기 (v21.2)
```javascript
// (1) 탭 통합 — 별도 섹션(sec-customer)·사이드바 항목 삭제. 콘텐츠(검수유출 KPI·연도별/작성자별
// 차트·CI 목록)는 #sec-issue 내 .tab-panel(#tab-iss-ci)로 그대로 이동 — DOM id 불변이라
// updateCITabs()/renderCICharts()/classifyCiEscape()/CI_OVERRIDES 로직은 무수정 재사용.
// 실패비용 현황 카드(#ci-failcost-wrap)는 서브탭 밖 sec-issue 본문으로 이동(항상 표시).
// 숨김 패널 안 canvas는 0크기로 그려지므로 swTab에 lazy 재렌더 훅 추가:
//   if (targetId==='tab-iss-ci') renderCICharts();
// nav()의 customer titles/guides/dispatch 제거 · openModal('ci')(overview KPI 카드)는 유지.
// (2) 공지사항 접기 — NOTICE_COLLAPSED(localStorage 'notice_collapsed_v1', 기본 접힘).
// 접힘: notice-body 숨김 + 제목 옆 요약 한 줄(🎓·🚀·🚫·🆕·🔚 건수), 각주 숨김.
// 펼침: noticeBox 컴팩트(패딩 8px·본문 11.5px·max-height 100px), auto-fit 그리드.
// (3) 협력사·매입 통합 — 같은 패턴으로 sec-purchase 섹션·사이드바 항목 삭제, 콘텐츠는
// sec-supplier 내 #tab-sup-pur 탭패널로 DOM id 불변 이동(기본 탭), 기존 supplier 콘텐츠는
// #tab-sup-list 탭패널로 래핑. nav supplier 진입·tab-sup-pur 활성화 시 updatePurchaseTabs()
// 재호출로 숨김 캔버스 0크기 문제 해소. updatePurchaseTabs/updateSupTab 로직은 무수정.
```

### 4-31. 미입하율 추이 차트 + 지점 클릭 MoM/YoY (v21.3)
```javascript
// 미입하율 추이표 카드를 grid-2로 재구성: 좌 차트(#ch-iss-noarrival)+클릭 상세 패널(#iss-noa-info), 우 기존 표.
// renderIssueAnalytics()가 월별 taskCur/noaCur(당해)·taskPrev/noaPrev(전년)에서 rate 배열을 만들어
// 라인차트 3계열(당해/전년 점선/목표 1.56% 상수선) 렌더 + ISS_NOA 모듈 상태에 저장.
// options.onClick → issNoaChartClick(evt):
//   1순위 getElementsAtEventForMode(evt.native,'index',{intersect:false}) 히트 테스트,
//   2순위 ChartEvent 상대좌표 evt.x를 x스케일 getValueForPixel로 월 인덱스 산출(오프셋 없는 이벤트 폴백)
//   → #iss-noa-info에 해당 월 미입하율·미입하/TASK건수·MoM(1월은 전년 12월과 비교)·YoY(%p, 색상 = 상승 빨강) 표시.
// nav issue 진입 시 renderIssueAnalytics() 재호출 — 숨김 상태에서 refreshAll이 그린 이슈 분석 차트
// 3종의 0크기 문제를 CI 차트(§4-30)와 동일 패턴으로 해소.
```

---

## 5. UI 섹션 구조 (20개 페이지 · v21.2: 고객인지이슈→이슈 현황 서브탭, 매입 현황→협력사 현황 서브탭 통합)

```
sidebar 네비게이션
├── [대시보드]
│   └── 종합 현황 (overview) — 기간 단위 4탭(주별/월별/분기별/기간지정) 지원[v15, §4-25]
│       ├── 월간 공지사항[v14 추가분, §4-24] — 졸업/출시/품절 제품, 신규/거래종료 협력사 자동집계
│       │     (v15: 정확한 날짜·다중월 합산으로 개선, §4-26)
│       ├── KPI 5개 (발주TASK, 매입금액, 이슈건수, 긴급발주, 고객인지이슈) + YoY
│       ├── 매입 추이 (월별/주별 · 합산/협력사/업태/굿즈코드)
│       ├── 이슈 유형 분포 (도넛)
│       ├── 담당자별 발주 (바)
│       ├── 월별 이슈 추이 (품질/수량/운영 3색 라인)
│       └── 제조유형 매입비중 (제조유형/업태/굿즈카테고리 전환)
│
├── [S&OP · 재고운영] — 구매전략파트 (v10: 사전집계 3종 있으면 Agg 경로, 없으면 레거시 계산 폴백)
│   ├── 재고운영 현황 (inventory-ops) — KPI(재고자산·1M/3M/YTD회전율·품절율·운영밴드), 재고추이,
│   │     생산구분·소싱구분·카테고리별 도넛차트 3종[v10], 장기미회전재고
│   ├── 품절 상세 (stockout-detail) — 품절일수(사전산출 stockout_days)·재고수량·회전율 상세
│   ├── 매입 검토 (purchase-review) — 파이프라인, 인라인 편집 (1차 통합 제외 대상 · 화면은 유지)
│   ├── 시즌재고 계획 (season-plan) — 3구분 탭, 확정수량 입력 (1차 통합 제외 대상 · 화면은 유지)
│   ├── EOQ · 발주알람 (eoq) — 경제적발주량, 리오더포인트
│   └── 졸업 검토 (graduation) — EOL 후보 (Agg 경로: dashboard_sku_snapshot 기준)
│
├── [발주 · 매입] — 외주생산파트
│   ├── 발주 현황 (order) — 전체 제품 발주량 단일 화면 (MoM/YoY·빈도·연간합, v18에서 Bottom20/프로젝트별/Task 탭 제거)
│   │     ├ 발주 TASK 클릭 모달[v11]: 발주현황Top/미발주현황/DB원가비교 3-tab(§4-10)
│   │     └ 여분(버퍼) 발주수량 추천[v21.2 신규] — 이슈 이력 기반 권장버퍼%·예방/실패비용 차액(§4-29)
│   └── 원가 분석 (cost-analysis) — 월별 요약 / 프로젝트별 상세 (공정DB 대비)
│         ※ 매입 현황은 v21.2에서 협력사 현황(supplier)의 서브탭으로 이동
│
├── [이슈 관리] — 외주생산파트
│   └── 이슈 현황 (issue) — KPI·차트·미입하율 추이표·실패비용 현황(본문 상시 표시[v21.2])
│         ├ 서브탭: 전체/품질/수량/운영/고객인지이슈[v21.2 통합]/제품×협력사 이슈율(§4-13)/재발 이슈[v21.1]
│         └ 고객인지이슈 서브탭 — 검수유출 KPI[v21.1]·연도별/작성자별 차트·대응/실패비용 수기입력(§4-18, §4-30)
│
├── [매출 분석] — 공통
│   ├── 매출/마진 분석 (sales) — 월별 추이, 제품별 비중, 마진율
│   └── 제품별 발주수량 추이 (product-trend)[v12: 판매량→발주수량 기준 교체] — D.order 기반 SKU별 라인차트(§4-14)
│
├── [공급망] — 외주생산파트
│   ├── 공급망 포트폴리오 (portfolio)[v12: QCD×관계 Tier로 기준 교체(§4-11)] — 분기별평가 CSV 기반, 활성 필터 + 변경검토리스트
│   ├── 협력사 · 매입 현황 (supplier)[v21.2: 구 매입 현황(purchase) 흡수, 서브탭 2개]
│   │     ├ [매입 현황] 협력사별 Top10·제조유형/업태/인쇄 차트·매입상세 Top20 (updatePurchaseTabs, DOM id 불변 이동)
│   │     └ [협력사 목록] KPI 4장·변경검토 진행현황(§4-27b)·목록 검색 → 클릭 시 상세모달[v12: 연도별 매입추이+이슈상세(§4-12)]
│   ├── 협력사유형별 제품군 (supplier-product) — 히트맵 매트릭스
│   └── 협력사 변경 검토 ↗ (외부링크)
│
├── [품질관리 · QMS] — 공통
│   └── 품질 현황 (qms) — QI/QC/QA KPI, COPQ 추이 (v5: 월포맷 통일, 재제작률 분모 수정)
│
├── [컴플라이언스]
│   └── 하도급법 위험 (subcontract) — 발주_RAW + 공급망_RAW 자동 산출
│
└── [운영]
    ├── AI 어시스턴트 (ai) — 규칙 기반 쿼리
    └── 리포트 생성 (report) — 주간 .md, KPI CSV 내보내기
```

---

## 6. 모달 상호작용

| 트리거 | 모달 타입 | 내용 |
|---|---|---|
| 발주 TASK 클릭 | `orderTask` | **[v11]** 3-tab: 발주현황Top(전체 굿즈 발주량 내림차순, 프로젝트/재고 구분) / 미발주현황 / DB원가비교 — §4-10 |
| 매입금액 클릭 | `purchase` | 제조유형별 그룹 → 협력사 매입 내림차순 → 협력사 클릭 시 2차 모달(드릴다운 로직은 변경 없음, 유지) |
| 협력사명 클릭 | `supplierDetail` | **[v12]** 연도별(25/26) 매입추이 라인차트 + 빈번 발주 제품 Top 3(기존 유지) + 이슈 상세 — §4-12 |
| 이슈건수 클릭 | `issue` | 전체/품질/수량/운영 탭 필터 + 대응 + 실패비용 |
| 긴급발주 클릭 | `urgent` | 긴급 발주 목록 (서울디지털인쇄협동조합 제외) |
| 고객인지이슈 클릭 | `ci` | 이슈내용 + 실패비용 |
| 매입추이 월 클릭 | `purchaseMonth` | 해당 월 Top5 협력사 + Top5 제품 (카테고리) |
| 재고자산 KPI 클릭 | `inventoryAsset` | SKU별 상세 + 정렬 + 회전율 아코디언 (판매추이/회의이력) |

---

## 7. CSV 자동 인식 시그니처

```javascript
const FILE_SIGNATURES = {
  // [v10 신규] 사전집계 3종 — 우선순위 최상단(period_key 등 공통 컬럼명 충돌 방지 위해 more-specific 필드로 구분)
  dashboard_period_summary: { must: ['period_unit','period_key','inv_amount','turnover_3m'] },
  dashboard_group_summary:  { must: ['period_unit','period_key','group_type','group_name','inv_amount'] },
  dashboard_sku_snapshot:   { must: ['period_unit','period_key','parts_no','parts_name','inv_amount'] },
  // [v11 신규] 코스트베이스(파츠리스트) — DB원가비교 탭(§4-10) 전용
  parts: { must: ['파츠명 (Long ver)','굿즈 연결 현황 (from item)','파츠 유형'] },
  // [v14 신규] 굿즈마스터 — 월간 공지사항 졸업/출시 제품(§4-24) 전용
  goods_master: { must: ['Goods Name','Goods Code','굿즈 Status','출시일','졸업일'] },
  purchase_review: { must: ['REVIEW_ID','파츠번호','결정상태'] },
  season_plan:     { must: ['굿즈명','옵션','계획구분'] },
  inv_weekly:      { must: ['파츠번호','기준일','재고수량','재고금액'] },
  sales_monthly:   { must: ['파츠번호','기준월','판매량'] },
  qms_raw:         { must: ['발생일','이슈유형'], not: ['이슈카테고리'] },
  cost_reduction:  { must: ['절감액','항목'] },
  stockout_list:   { must: ['파츠명','판매상태','품절 성격'] },
  sales:           { must: ['제품명','주문수량','판매단가','소계'] },
  order:           { must: ['과업지시일자','발주번호'] },
  issue:           { must: ['이슈카테고리'], not: ['판매상태','총재고수량'] },
  sup:             { must: ['협력사 이름','1. 제조유형'] },
  ci:              { must: ['등록일자','이슈내용','프로젝트명'], not: ['이슈카테고리'] },
  quarter_eval:    { must: ['협력사','1Q_TASK 점수','1Q_공급망관리등급'] }, // v9: 공급망 포트폴리오 반기환산의 원본
  // must: 모든 필드 존재 + not: 하나라도 있으면 매칭 제외
};
// BOM(UTF-8 0xFEFF) 자동 제거 적용
// 자동 로드(3-0)는 시그니처가 아닌 고정 파일명/manifest 매핑으로 슬롯 결정
```

---

## 8. 버전 관리

### 버전 이력
| 버전 | 커밋 | 내용 |
|---|---|---|
| v4.0 | `bef8f6b` | 통합 대시보드 최초 배포 (22페이지, 17 CSV) |
| v4.0.1 | `d23b146` | CSV 17→12 통합, 파츠마스터/2025/공정DB 영구 임베딩 |
| v4.0.2 | `405b683` | 실패비용/대응, MoM·YoY, 원가분석 월별/프로젝트 탭 |
| v4.1 | `8c0e0c8` | 슬롯 파트별 분리, Critical 파싱 오류 수정 |
| v4.3 | `e90e5f9` | 레포지토리 폴더 정리 (CSV/·data/·docs/·archive/), JSON 경로 수정 |
| v5 | `60f694b` | 월키 정렬 버그 15곳 monthCmp 적용, QMS 월포맷 통일, 재제작률 분모 수정 |
| v6 | `c05c52b` | 대시보드 갱신 배포 (index.html 329줄 추가) |
| v7 | `839f2aa` | CSV 파서 상태머신 교체, goodsCode/의도적품절/재고 폴백 수정, **자동 로드 + 고정 파일명** |
| v7 | `18d23e4` | `.nojekyll` 추가 — GitHub Pages Jekyll 빌드 실패 수정 |
| v8 (haeun.kim 원격) | `246bb15`~`255531a` | 매입재고 대시보드 추가, **GSheets 사전집계 3종(dashboard_period/group_summary, dashboard_sku_snapshot) 연동**, 도넛차트 3종(생산구분/소싱구분/카테고리), 회전율 드릴다운 판매이력 전체표시, sales_monthly 갱신 |
| v9 (로컬) | (병합 전 별도 브랜치) | 공급망 포트폴리오 등급 반기환산(1~6월 기준, 연 400/100/11 TASK·1억/5천만 매입대금 → 반기 절반 환산), A/B/C/D 4단계 재산정(1Q/2Q 등급 상이 시 점수 평균), KPI 리팩터(hasNoReceipt 등) |
| v10 | `013824d` | v8(원격)+v9(로컬) 3-way 병합. 겹치는 함수(포트폴리오 렌더, 재고 상세 모달)를 `merge_resolve_v10.ps1`로 수동 해소. index.html 4,206→4,691줄 (+552/-67, 순증 485줄) |
| v11 | (로컬→PC 배포) | 발주 상세 분석 3-tab화(발주현황Top/미발주현황/DB원가비교, §4-10), `parts` CSV 슬롯(코스트베이스) 신규, BOM 기반 DB원가 산출·수량구간 매칭 로직 신규 |
| v12 | (로컬→PC 배포) | 같은 날 연속 작업. 제품별 발주수량 추이로 기준 교체(§4-14), KPI 목표값 리포트 수치 동기화 + 실패비용율 신규(§4-15), 공급망 포트폴리오 QCD×관계 Tier로 기준 교체(§4-11) + 활성필터·변경검토리스트, 협력사 상세모달 연도별 매입추이+이슈상세 추가(§4-12, 기존 Top3 드릴다운 유지), 이슈 탭에 제품×협력사 이슈율 매트릭스 신규(§4-13) |
| v13 (원격, 파트장님) | `af0ece0` | 발주 진행현황 탭 신규(주간 CSV 비교, §4-17), 기간 통합 선택 SEL_RANGE(§4-16), 재고생산 TASK·매입 별도 KPI 카드, 검색어를 이슈추이·도넛·매입상세 모달에 반영(단, 일부 모달은 검색 필터 결합이 누락된 상태로 병합 전까지 남아있었음 — v14에서 §4-22로 완결), 이슈 상세 3단 구성(추이차트+제품×협력사 매트릭스), 고객인지이슈 대응내용·실패비용 수기입력(CI_OVERRIDES, §4-18), GitHub 직접 커밋 연동(§4-19), 주간 매출결산 CSV 연동, 공급망 포트폴리오 평가기준 단일화, 협력사 발주 거래개월수·활성필터, `archive_csv.ps1`·`deploy_v13.ps1` |
| **v14** | `0cd0407` (병합 커밋) | 같은 날 별도 세션에서 진행되던 작업과 v13(원격 force-push)이 서로 모르는 채 분기 — 병합으로 통합. 세션측 변경: 검색 필터 누락 지점 전수 수정(발주TASK 상세·매입추이 월클릭 상세·이슈 서브탭·이슈유형도넛·월별이슈추이, §4-22), 고객인지이슈 프로젝트범위 매칭 신규(§4-20), issue.csv `입고물품` 컬럼 반영(§4-21), 필터 적용 CSV 다운로드 신규(§4-23), ci.csv 인코딩 CP949→UTF-8 수정. 겹치는 함수(발주TASK 모달·이슈 서브탭 등)는 v13의 `inSelPeriod()`/3단 구성 로직에 세션측 `matchesSearch()` 검색 필터를 결합하는 방식으로 수동 병합. |
| **v14 (추가분, 난영님)** | `d64630e`~`0ee26eb` (원격 직접 푸시) | 위 v14 병합과 별도로 원격(origin/main)에 직접 반영된 작업. 종합 현황(overview)에 **월간 공지사항** 카드 신규 — 졸업 제품(goods_master `졸업일`), 출시 제품(goods_master `출시일`), 품절 제품(stockout_list `판매상태`+`변경일`, "PT번호-제품명"만 표시)을 선택 월 기준 자동 집계(§4-24). 신규 CSV 슬롯 `goods_master`(Airtable Sincerely DB "1. goods" 뷰: Goods Name/Goods Code/굿즈 Status/출시일/졸업일) 추가. 협력사 거래종료는 Airtable에 상태변경일 필드가 없어 "이번 달 신규"를 가려낼 수 없었으나, `archive_csv.ps1`이 매달 아카이브 시점의 `sup.csv`를 `CSV_BANK/sup_YYYY_MM.csv`로 스냅샷 저장하도록 확장하고 대시보드가 이번 달 명단(라이브 `sup.csv` 또는 해당 월 스냅샷) vs 직전 스냅샷을 **협력사 이름 기준으로 diff**하여 신규/거래종료 협력사를 공지사항에 표시하도록 후속 반영(상태변경일 필드 없이도 명단 증감으로 판별). 스냅샷 diff로 잡히지 않는 예외를 위해 `MANUAL_VENDOR_TERMINATIONS`/`MANUAL_STOCKOUT` 하드코딩 리스트 신규 — 거래종료 협력사 6곳(베러웨이시스템즈·포텍·유경·파워·아이큐아이·모아산업)은 6월(26.2Q 마지막 달) 귀속으로 게이팅, 강천FNT는 아직 거래종료 확정 전이라 목록에서 제외. 자동 신규 협력사 비교는 임시 기준선(5월 명단)을 제거하고 다음 달 `archive_csv.ps1` 스냅샷부터 정식 계산되도록 초기화. 협력사 목록 드릴다운을 모달→인라인 확장으로 전환(검색 결과 1건이면 자동 확장, `buildSupplierDetail()` 공용 빌더), 월별 매입금액/MoM 스트립·발주내역 테이블·월별 필터 추가, "발주 제품 전체"는 발주 이력 있는 제품만(발주 수량 병기) 표시, 월간공지·발주진행현황 글씨 크기 확대 |
| **v15** | (병합 후 로컬→PC 배포) | 같은 시점 별도 세션에서 진행되던 작업(로컬, 848958e 기준)과 위 v14 추가분(원격)이 서로 모르는 채 갈라져 있던 것을 `git merge`로 병합(겹치는 `nav()`/`refreshAll()` 자동 병합, 충돌 없음). 세션측 신규: 외주생산파트 핵심 화면(종합현황·발주·매입·이슈·고객인지이슈)의 기간 필터를 **주별/월별/분기별/기간지정 4탭**으로 통합(`PERIOD_UNIT`/`SEL_DATE_RANGE`, §4-25) — MoM/YoY 배지가 WoW/MoM/QoQ/YoY로 단위별 자동 전환, 매입금액은 세금계산서 원본이 월단위라 항상 월 스냅 유지, 아직 세부 로직 미지원인 13개 화면은 동일 UI에 월 외 탭만 비활성 처리("추후 반영" 툴팁). 월간 공지사항(§4-24)을 SEL_MONTH 단일 비교 → SEL_DATE_RANGE 정확 날짜/다중월 합산으로 개선(§4-26, 기간지정으로 5~7월을 잡아도 6월 거래종료 협력사가 보이도록 수정 — 팀원 리포트로 발견). |
| **v15.x** | `9f39b04`~`2d1611e` (원격, seungmi.yook 외) | v15 배포 후 원격에서 이어진 작업. **YoY를 2025 원본 행 기준 정확 비교로 업그레이드**(`9f39b04`): `CSV/order_2025.csv`·`issue_2025.csv` 고정 파일명 추가, `load2025RawData()`→`D.order2025`/`D.issue2025`, `updateKPIs()`·`renderOrdTopTable()` YoY를 `getYoyDateRange()` 정확 일자 비교로 교체(원본 없으면 월 근사 폴백). **이슈현황 탭 기간 필터 버그 수정**(`e9482f1`): 다중 월·분기·주간·기간지정 시 마지막 달만 표시되던 것을 `issueInPeriod()`로 교체. **이슈 집계 기준일 변경**: 품질→`품질이슈내용업데이트`, 운영→`운영이슈내용 업데이트`(없으면 실제입하일 폴백)로 KPI·탭 통일. W29 CSV(order/issue/ci) 갱신. |
| **v16** | (로컬→PC 배포) | 협력사 현황 드릴다운에 PDF 내보내기 2종 신규 — ① 상세 스냅샷(`exportSupplierPdf`, §4-27): 드릴다운 DOM 복제 후 Chart.js 캔버스를 `toBase64Image()` PNG로 치환·스크롤 펼침·조작 요소 제거해 A4 저장. ② 분석 리포트(`exportSupplierAnalysisReport`, §4-27): 전년(2025) RAW를 `loadPrevYearRaw()`로 1회 fetch·캐시하고 완결월(전월까지) YoY 성장률로 잔여 월을 예상 채워, 연간요약·YoY·SVG 추세선(`_repLineChart`)·월별표·Top5·재발이슈·핵심요약 2줄을 A4 2p로 생성. html2pdf.js 0.10.1은 최초 클릭 시에만 CDN lazy-load(`loadHtml2Pdf`). 리포트/내보내기 버그 수정(§4-28): 주간 보고(`genWeekly`) 긴급 발주(서울디지털 제외)·월 매입금액(재고생산 포함)을 KPI 카드 기준과 일치, `exportKPI`를 발주 RAW 행 대신 `computeKPIs()`×`KPI_DEFS` 실측 KPI 요약으로 교체. index.html 버전 라벨 v14→v16 정정(v15 배포 시 미갱신분). **배포 전 원격 v15.x(11커밋)를 fast-forward로 받아 그 위에 통합 — 코드 영역이 겹치지 않아 충돌 없음.** index.html 약 6,842줄. |
| **v17** | (로컬→PC 배포) | 협력사 현황에 **협력사 변경 검토 진행 현황** 카드 신규(§4-27b) — 별도 저장소 scm_vendor_change의 `bank/` 폴더(팀 공유 백업)를 GitHub API로 실시간 fetch(동일 origin, CORS 무관)해 전환검토중/확정/완료 건수와 최근 완료 협력사 변경 목록을 표시, 카드 클릭 시 해당 대시보드로 새 탭 이동(`loadVendorChangeStatus`). 같은 검토 건이 팀원별 백업 파일에 다른 상태로 중복 등장하는 문제를 상태-랭크(완료>확정>전환검토중) + 최신 날짜 채택 방식으로 병합해 파일 처리 순서와 무관하게 안정적인 결과를 보장. index.html 약 6,921줄. |
| **v17.1** | (로컬→PC 배포) | 협력사 PDF 내보내기 2종(§4-27)의 잘림/백지 버그 수정 — ① html2pdf 컨테이너가 A4 내부 폭 194mm(≈733px) 고정인데 wrap이 1000px 고정 폭이라 우측 잘림 → 폭 자동(컨테이너 상속)으로 변경. ② 페이지 스크롤 상태에서 html2canvas가 스크롤 오프셋만큼 내용을 밀어 백지 캡처 → `scrollX/Y:0` 강제, 클론 문서 폭을 왜곡하던 `windowWidth` 옵션 제거. ③ 분석 리포트 SVG 추세선이 html2canvas에서 깨짐 → `_svgsToPng()`(SVG→Image→canvas, 브라우저 네이티브)로 PNG 치환 후 전달. ④ Chart.js 캔버스 비트맵이 비워진 채 캡처되는 경우 → `chart.update('none')+draw()` 동기 리렌더 강제. 실데이터 픽셀 검증(사방 여백·차트 렌더·페이지 분리) 완료. index.html 약 6,968줄. |
| **v18** | (로컬→PC 배포) | 팀 피드백 5건 반영 — ① 이슈 상세 모달의 제품×협력사 매트릭스를 **협력사 단위 통합**으로 재편(`renderIssueModalMatrix`): 동일 협력사 이슈를 제품 구분 없이 합산, 주요 이슈 제품 Top3 병기, 펼침 상세에 제품 컬럼 추가. ② **isStock에 굿즈코드 STCK 판별 추가**: `sync_itemdb`에 STCK 포함 시 재고생산 — 재고 구분 전 화면 일괄 적용. ③ **재고생산(별도) KPI 카드 제거**(KPI 6→5장): 재고생산액·전체 매입 대비 %를 월 매입금액 비고로 통합, 매입금액 모달에 협력사별 프로젝트/재고생산 컬럼, 발주 TASK 모달 발주현황Top을 프로젝트/재고생산 두 섹션으로 분리. ④ **졸업 검토 권장조치 필터**(`GRAD_ACTION_FILTER`): 운영종료 검토/졸업 검토/모니터링 칩, 사전집계·레거시 경로 모두. ⑤ **발주 현황 단일 화면화**: Top20/Bottom20/프로젝트별매입/발주Task 탭과 `renderOrdBotTable`/`renderOrdProjTable`/`updateTaskTabs` 삭제, 숫자 셀 nowrap으로 줄밀림 정리. index.html 약 6,853줄. |
| **v19** | (로컬→PC 배포) | ① **이슈 분석 모듈**(`renderIssueAnalytics`) — 이슈 현황 상단에 기간 이슈/TASK/이슈율(전년 동기 %p 비교) KPI 3장 + 월별 이슈 추이 라인차트(품질/수량/운영) + **이슈율 2025 vs 2026 동기 비교 차트**(자동 로드되는 `D.order2025/D.issue2025` 원본 RAW로 월별 이슈÷TASK×100 산출). ② **발주 진행현황 주차 경고** — 표시 중인 progress 파일의 ISO 주차 < 현재 주차면 경고 배너(필요 파일명 안내); 주간 CSV는 자동 커밋 워크플로가 없어 수동 커밋 필요함을 명시. ③ **제품별 판매량 추이 검색 연동**(`renderProductTrend`에 matchesSearch 적용 + refreshAll 재렌더) + 제품별 발주 요약에서 주 제작처가 서울디지털인쇄협동조합인 제품 제외·제작 협력사 컬럼 추가. index.html 약 6,944줄. |
| **v20** | (로컬→PC 배포) | ① **Airtable 자동 갱신 스케줄 변경**: `weekly-airtable.yml` cron을 월요일 09:00→**목요일 13:00 KST**(`0 4 * * 4`)로 변경. ② **"지금 새로고침" 버튼**(`refreshAirtableNow`) — 업로드 바에 추가, GitHub Actions `workflow_dispatch` REST API로 `weekly-airtable.yml`을 즉시 트리거하고 `pollAirtableRefresh`로 최대 10분간 15초 간격 폴링해 완료 시 `autoLoadRaw()` 자동 재실행. Contents 권한 토큰에 Actions:write 권한 추가 필요(GitHub 연동 설정 안내 갱신). ③ **변경 이력 시스템 신규**(`data/change_log.json`, §9) — 졸업/출시 제품(goods_master 날짜 그대로)·협력사 신규/거래종료(주간 `CSV_BANK/<연도>_W<주차>/sup.csv` 스냅샷 비교로 정밀화, 기존 월단위 비교보다 정밀)를 감지해 영구 기록. 월간 공지사항의 이 4개 섹션을 "선택 기간" → "오늘 기준 최근 30일 롤링"으로 전환(품절만 기존 유지), "전체 변경 이력 보기" 토글 추가. 토큰 없으면 로컬에만 쌓이고 토큰 보유자가 열람 시 병합·커밋(비고/CI 수기입력과 동일 패턴). 로드-감지 순서 경쟁 상태(데이터 로드 전에 이력 로드가 먼저 끝나는 경우) 발견·수정 — `CHANGE_LOG_DETECTED` 플래그로 재렌더마다 재시도. 더 이상 쓰이지 않는 월단위 협력사 비교 코드(`SUP_ROSTER_CACHE`/`loadSupRosterDiff`/`walkSupSnapshot` 등) 제거. index.html 약 7,081줄. |
| **v20.x** | `3e9adbd`~`2ff8539` (원격 직접 푸시) | v20 배포 후 수정분. ① **prevYM() 복원**(`3e9adbd`): v20 정리 때 실수로 삭제되어 협력사 상세 모달·드릴다운이 전부 ReferenceError로 깨졌던 함수 복원 + 전체 제품 발주량 테이블 지표 가운데 정렬. ② **분기별평가 실데이터 반영**(`e38f828`): 사용자 제공 GSheets CSV를 정리해 `CSV/quarter_eval.csv` 생성·`AUTO_CSV_DEFAULT` 등록 — 관계 점수가 전 협력사 기본값(2점) 고정이던 것이 실데이터로 산출되어 Tier가 Core 6·Performer 4로 월간 리포트와 일치(Tier3/4 잔차는 협력사 모수 168 vs 136 범위 차이). ③ **포트폴리오 클릭 인터랙션**(`5335ff4`): Tier 카드 클릭→협력사별 상세 필터링(`clickPortfolioKpi`), 4분면 매트릭스 점 클릭→협력사 상세 모달. ④ **이슈현황 탭 버그 수정 + 미입하율 추이표**(`2ff8539`): `swTab()`이 인라인 display만 바꾸고 CSS `.tab-panel.active` 클래스를 토글하지 않아 전체 탭 외 모든 탭이 빈 화면이던 버그 수정, 월별 미입하율 추이표(전체TASK·미입하건수·미입하율·전년동월·YoY) 신규. |
| **v21.1** | (로컬→PC 배포) | **품질관리 1차 — 검수 유출률 + 재발 이슈 뷰.** ① `classifyCiEscape()`: 고객인지이슈별로 같은 프로젝트(코드 접두어 조인)에 고객 등록일 이전 내부 이슈 기록이 있었는지로 내부 선행검출/유출 구분 — 내부 이슈 맵은 당해+전년 아카이브 합산(당해만 쓰면 과거 ci가 전부 유출로 오분류되는 편향을 실측으로 확인·수정), 내부 데이터가 없는 연도의 ci는 판정불가(null)로 제외. 고객인지이슈 화면에 KPI 3장(`ci-escape-kpis`)+목록 검출 배지. ② `renderRecurringIssues()`: 제품×협력사 조합 이슈 2회 이상 자동 추출(당해+전년, 전년 귀속은 §3-28 패턴의 별도 projMap), 연도별 건수·유형분포·최근 발생일·연속 재발 배지·행 펼침 — 이슈현황 "재발 이슈" 탭 신규. ③ CSV 폴더 정리(미참조 한글 원본·중복 8종 삭제). ④ `docs/AIRTABLE_품질필드_추가명세.md` 신규 — CAPA·원인분류·수주처 lookup·FAI 테이블·IQC 전수화(movement 테이블 확인)의 Airtable 측 변경 요청서. |
| **v21** | (로컬→PC 배포) | **연도별 데이터 아카이빙 체계 + 협력사 YoY 비교.** ① **범용 아카이브 로더**(`bbd073d`): `CSV/order_2025.csv`·`issue_2025.csv`를 `CSV_BANK/archive/2025/`로 이동, `load2025RawData()`→`loadPriorYearArchive()`(매년 `getFullYear()-1`을 자동 계산해 `CSV_BANK/archive/{연도}/order_{연도}.csv` 조회 — 연도 하드코딩 제거), `D.order2025/issue2025`→`D.orderPrevYear/issuePrevYear` 전면 리네이밍(9개 참조). PDF 분석 리포트의 `loadPrevYearRaw()`도 같은 경로로 통합(가능하면 `D.orderPrevYear` 재사용, 중복 fetch 제거) — 이로써 완전 중복이던 `CSV/SCM_발주_RAW(2025).csv`·`SCM_이슈_RAW(2025).csv` 삭제, 전년도 원본 3중 관리 해소(`data_2025.json` 월집계는 원본 미로드 시 폴백으로 유지). ② **연말 자동 아카이빙 CI**(`525cdd1`): `.github/workflows/yearly-archive.yml` — 매년 1/2 00:10 KST에 `scripts/archive_year_end.mjs`가 직전 연도 order/issue CSV를 `CSV_BANK/archive/{연도}/`로 복사 커밋. order.csv 과업지시일자 연도 비율 50% 이상일 때만 실행(1월 첫 목요일 주간 갱신이 새해 데이터로 덮어쓴 뒤 뒤늦게 돌면 거부, order 검증이 issue까지 게이트), 기존 아카이브 덮어쓰기 방지, `workflow_dispatch`로 연도 지정 수동 실행 가능. ③ **협력사 상세 전년 동기 비교**(`7085a41`): 상세 모달·드릴다운에 YTD(1~당해 최신월) 기준 발주건수·발주수량·매입금액·이슈건수·이슈율 전년 비교표 + YoY 뱃지 + 전년 연간 전체 참고치, 연도별 매입추이 차트에 전년 12개월 라인 오버레이. 전년 이슈 귀속은 전년도 발주 RAW로 project 코드→협력사 맵 별도 구성(당해 맵엔 전년 코드 없음). 전년 이력 없는 협력사는 블록 미표시. index.html 약 7,153줄. |

### 파일 구조
```
SCMDASHBOARD/
├── index.html                       ← 운영 원본 (GitHub Pages 직접 서빙 · v21 · 약 7,153줄)
├── scm_dashboard_v21.html           ← 현행 버전 스냅샷 (index.html 복사본)
├── archive/                         ← 이전 버전 스냅샷 (v3~v15)
├── CSV/                             ← 자동 로드 대상 CSV
│   ├── order.csv · issue.csv · sup.csv · ci.csv
│   ├── stockout_list.csv · inv_weekly.csv · sales_monthly.csv
│   ├── dashboard_period_summary.csv · dashboard_group_summary.csv · dashboard_sku_snapshot.csv  ← v10 신규
│   ├── parts.csv                    ← v11 신규(코스트베이스, 수동 업로드 기본)
│   ├── goods_master.csv             ← v14 신규(굿즈마스터, 월간 공지사항 졸업/출시 제품용, §4-24)
│   ├── progress_연도_W주차.csv · project_연도_W주차.csv  ← v13 신규(발주 진행현황·주간 매출결산)
│   └── _manifest.json               ← key→파일명 매핑 (HTML 수정 없이 파일명 변경)
│       ※ 한글 원본 CSV(SCM_발주_RAW(2026).csv 등)·S&OP 원본·RAW_CSV.zip은 v21에서 정리 —
│         주간 자동 커밋이 고정 영문명 CSV를 직접 갱신하게 되면서 수동 복사용 원본이 불필요해짐
│         (과거 버전은 git 이력·CSV_BANK 주간 아카이브로 보존)
├── CSV_BANK/                        ← v13 신규(주간 progress/project 아카이브) · v14 확장 — archive_csv.ps1이 매달 저장하는 sup.csv 월간 스냅샷(§4-24 diff 대상)
│   └── archive/{연도}/              ← v21 신규 — 전년도 order_{연도}.csv·issue_{연도}.csv 고정 보존 (loadPriorYearArchive()·yearly-archive.yml 대상)
├── data/                            ← 영구 임베딩 JSON
│   ├── parts_master.json · data_2025.json · cost_db.json
│   └── progress_notes.json · ci_overrides.json  ← v13 신규(GitHub 연동 자동 커밋 대상)
├── docs/
│   ├── SCM_DASHBOARD_ARCHITECTURE.md       ← 이 파일 (v21 갱신)
│   ├── CHANGELOG_v21.md                    ← 버전별 변경 내역 (팀 공유용)
│   ├── purchase_dashboard_migration_strategy.md  ← 구매파트 Apps Script 이식 전략 (v10 반영 현황 기준, v11 이후는 범위 밖)
│   ├── SCM_DASHBOARD_로직설명_v21.html  ← 로직 설명서 (v21 갱신)
│   ├── SCM_DASHBOARD_사용자가이드_v21.html  ← 사용자 가이드 (v21 갱신)
│   ├── SCM_KPI_리포트_2026Q2.xlsx
│   └── archive/                     ← 구버전 (v16 이하 로직설명/사용자가이드/CHANGELOG, V4_로직설명_v7.html 등)
├── deploy_v21.ps1                   ← 배포 스크립트 (git 자가복구 + 버전 정리 + 안전 동기화 + 문서/구파일 정리)
├── archive_csv.ps1                  ← v13 신규 — 주간 CSV(progress_/project_)는 최신 1개만 유지 후 CSV_BANK로 이동, v14 확장 — sup.csv 교체 직전 CSV_BANK/sup_YYYY_MM.csv로 월간 스냅샷 저장
├── .nojekyll                        ← Pages Jekyll 비활성화 (빌드 실패 방지)
└── .claude/                         ← Claude 설정
```
> `_merge_staging/`(v10 3-way 병합 1회성 산출물), `deploy_v10.ps1`, `merge_resolve_v10.ps1`은 v12 배포 시 정리(archive 이동 또는 삭제) 완료.
> **v15 협업 이슈:** 로컬 `feature/period-filter` 브랜치가 원격에 직접 푸시된 v14 추가분(4개 커밋)을 모르는 채 갈라져 있었음 — 작업 시작 전 `git fetch origin && git log HEAD..origin/main`으로 뒤처짐 여부를 먼저 확인하는 습관 권장.

### 버전 규칙 (v7~)
- **운영 원본은 `index.html`** — 수정 작업은 index.html에 직접, 로컬 확인은 수동 업로드 모드
- **배포는 `deploy_v{N}.ps1`(현재 `deploy_v21.ps1`)** — 실행 시 자동으로:
  1. git 저장소 자가진단/복구 (index 손상, 잔류 lock)
  2. 한글 원본 CSV → 고정 영문명 복사
  3. index.html이 바뀐 경우에만 `scm_dashboard_v{N+1}.html` 스냅샷 생성 (버전 자동 카운트, 이전 버전 archive 이동)
  4. 커밋 → 원격이 앞서 있으면 rebase (구버전이 원격 최신을 덮어쓰는 사고 방지) → 푸시
- `-Verify` 스위치: 푸시 90초 후 배포 페이지에 `autoLoadRaw` 포함 여부 자동 검증
- **여러 담당자가 각자 브랜치에서 수정할 경우(v10, v14, v15처럼) rebase 자동화가 실패할 수 있음** — 겹치는 함수를 수동 3-way 병합한 뒤(v10처럼 1회용 스크립트를 쓰거나, v14/v15처럼 `git stash`+fast-forward+`git stash pop` 또는 `git merge --no-commit`으로 충돌 지점을 직접 해소) 병합 커밋을 얹는 방식 사용. v14는 `scm_dashboard_v13.html`(스냅샷)이 항상 `index.html`과 바이트 동일하다는 성질을 이용해, index.html 충돌만 해소한 뒤 그 결과를 스냅샷에 그대로 복사하는 방식으로 중복 해소 작업을 줄였다. v15는 로컬 미커밋 변경분을 `git stash`로 빼고 원격 4개 커밋을 fast-forward로 받은 뒤 `git stash pop`으로 재적용 — `nav()`/`refreshAll()` 겹치는 지점이 자동 3-way 병합으로 충돌 없이 해소됨.
- **대시보드 버전 업 시 docs/ 문서(아키텍처 md, 로직설명, 사용자가이드, 이식전략 md)도 같은 커밋에서 갱신**
- **v14부터**: 변경 시 `docs/CHANGELOG_v{N}.md`에 변경 내역을 1줄씩 기록해 팀 공유. 원본 Airtable/GSheets CSV의 **헤더(컬럼명)가 추가·변경되면 반드시 변경 내역에 명시**(예: issue.csv `입고물품` 컬럼 추가) — 다른 파트 CSV 갱신 담당자가 컬럼 의존 로직이 깨졌는지 확인할 수 있어야 한다.
- **v15부터**: 여러 명이 같은 날 각자 세션/브랜치에서 작업할 수 있으니, 작업 시작 전 `git fetch origin && git log HEAD..origin/main`으로 원격에 아직 못 받은 커밋이 있는지 먼저 확인한다.

---

## 9. 주간 업데이트 절차 (v21 · 자동 로드 기준)

### Airtable 소스 CSV 자동 커밋 (v19 신규, v20 확장)
`.github/workflows/weekly-airtable.yml`이 **매주 목요일 13:00 KST**(v20에서 월요일 09:00→변경, cron `0 4 * * 4`)에 Airtable 원본 CSV를 자동으로 갱신·커밋한다. 두 스크립트가 순서대로 실행된다:

1. **`scripts/fetch_airtable_weekly.mjs`** — 진행현황·매출결산처럼 **파일명에 주차가 붙는** 소스(`CSV/progress_YYYY_WNN.csv`, `CSV/project_YYYY_WNN.csv`). 지난 주차 파일은 `CSV_BANK/연도_W주차/`로 자동 아카이브(대시보드가 전주 파일과 비교하므로 보존 필요).
2. **`scripts/fetch_airtable_sources.mjs`** — `order`/`issue`/`sup`/`ci`/`stockout_list`/`parts`/`goods_master`처럼 **대시보드가 고정 파일명으로 자동 로드**하는 소스(`CSV/_manifest.json` 대상, §3-0). `AIRTABLE_SOURCES` 변수(JSON 배열)에 등록된 항목만 처리하며, 덮어쓰기 전 `archive_csv.ps1`과 동일한 두 보존 규칙을 재현한다 — ① 이전 버전을 `CSV_BANK/연도_W주차/파일명`으로 아카이브(주차는 그 파일의 최근 git 커밋일 기준), ② `sup.csv`는 추가로 `CSV_BANK/sup_YYYY_MM.csv` 월간 스냅샷(신규/거래종료 협력사 diff의 원본, §4-24)을 매달 1회 보존. 이전 내용과 완전히 동일하면 아무 것도 건드리지 않는다(불필요한 아카이브 방지).

공통: Airtable API를 `cellFormat=string`+`timeZone=Asia/Seoul`로 호출해 UI 표시 형식 그대로(예: 날짜 `2026.7.14`) 수신하고, 기존 CSV의 헤더 순서를 재사용해 대시보드 컬럼 호환을 유지한다.

**1회 설정 필요**:
1. 저장소 Settings → Secrets: `AIRTABLE_TOKEN`(PAT, **`data.records:read` + `schema.bases:read`** 스코프 — 후자는 아래 탐색 워크플로에 필요)
2. **먼저 base/table/view 식별자를 확인**: Actions 탭 → `airtable-discover` → Run workflow. 접근 가능한 모든 Base/Table/View 이름과 ID가 로그에 출력된다(아무것도 커밋하지 않는 읽기 전용 워크플로). `scripts/list_airtable_schema.mjs` 참고.
3. Variables 등록:
   - `AIRTABLE_BASE_ID`/`PROGRESS_TABLE`/`PROGRESS_VIEW`(+선택 `PROJECT_TABLE`/`PROJECT_VIEW`) — 진행현황/매출결산용(기존)
   - `AIRTABLE_SOURCES` — 고정 파일명 CSV용, JSON 배열. 1단계에서 확인한 값으로 아래 틀을 채운다(`table`/`view`는 이름 또는 `tbl…`/`viw…` ID 모두 가능 — ID를 쓰면 이름이 나중에 바뀌어도 안 깨짐):
     ```json
     [
       {"key":"order","base":"appXXXXXXXXXXXXXX","table":"(SCM KPI 베이스의 발주 테이블)","view":"task-SCMKPI_Raw","file":"order.csv"},
       {"key":"issue","base":"appXXXXXXXXXXXXXX","table":"(SCM KPI 베이스의 이슈 테이블)","view":"KPI_이슈_RAW","file":"issue.csv"},
       {"key":"sup","base":"appYYYYYYYYYYYYYY","table":"(공급망 관리 베이스의 협력사 테이블)","view":"공급망_RAW","file":"sup.csv"},
       {"key":"ci","base":"appXXXXXXXXXXXXXX","table":"(SCM KPI 베이스의 고객인지이슈 테이블)","view":"고객인지이슈_RAW","file":"ci.csv"},
       {"key":"stockout_list","base":"appXXXXXXXXXXXXXX","table":"(sales_status_history 테이블)","view":"(뷰명)","file":"stockout_list.csv"},
       {"key":"parts","base":"appXXXXXXXXXXXXXX","table":"(SCM KPI 베이스의 파츠 테이블)","view":"4. parts","file":"parts.csv"},
       {"key":"goods_master","base":"appZZZZZZZZZZZZZZ","table":"(Sincerely DB 베이스의 goods 테이블)","view":"1. goods","file":"goods_master.csv"}
     ]
     ```
     한 번에 다 채울 필요 없음 — 일부만 넣으면 그 항목만 자동화되고 나머지는 계속 수동. `base`/`table`/`view` 중 하나라도 비어있는 항목은 조용히 건너뛴다.
4. Actions 탭 → `weekly-airtable-progress` → Run workflow로 수동 1회 검증(로그에서 각 소스별 처리 결과 확인).

미설정/실패 시엔 기존처럼 수동 커밋으로 대체 가능 — 대시보드는 진행현황 CSV가 이번 주 파일이 아니면 경고 배너(§v19)로 알려준다.

**"지금 새로고침" 버튼 (v20 신규)** — 매주 목요일을 기다리지 않고 필요할 때 바로 Airtable을 재수집하고 싶을 때 쓴다. 업로드 바의 🔄 지금 새로고침 클릭 → `refreshAirtableNow()`가 GitHub Actions REST API로 `weekly-airtable.yml`에 `workflow_dispatch`를 보내고, `pollAirtableRefresh()`가 15초 간격(최대 10분)으로 실행 상태를 폴링하다가 완료되면 `autoLoadRaw()`를 다시 호출해 최신 CSV를 화면에 반영한다. 이 버튼을 쓰려면 GitHub 연동 토큰(§비고 자동 커밋과 동일 토큰)에 기존 `Contents: Read and write`에 더해 **`Actions: Read and write`** 권한이 추가로 필요하다 — 없으면 401/403/404로 실패하고 화면에 원인 안내가 뜬다.

**협력사·졸업/출시 변경 이력 (v20 신규)** — `data/change_log.json`에 아래 4종 변경을 영구 기록한다:
- 졸업 제품(`product_graduated`)·출시 제품(`product_launched`) — goods_master.csv의 졸업일/출시일을 그대로 사용(정확한 날짜가 원본에 있음). `backfillProductChangeLog()`가 오늘로부터 35일 이내 날짜만 최초 적재 대상으로 삼는다(그보다 오래된 과거 이력은 어차피 30일 노출 창을 벗어나므로 배포 시점에 한꺼번에 쌓지 않음).
- 신규 협력사(`sup_added`)·거래종료 협력사(`sup_terminated`) — 원본에 정확한 상태변경일 필드가 없어, 위 자동 커밋이 매주 남기는 `CSV_BANK/<연도>_W<주차>/sup.csv` 스냅샷을 체인으로 이어 비교(`detectSupplierChanges()`, 최근 6주치). 날짜는 그 주의 월요일로 근사. **v20 배포 시점엔 CSV_BANK가 비어 있어 처음 몇 주는 결과가 없는 게 정상** — 자동 커밋이 누적되면서부터 실제 감지가 시작된다. 그 전까지는 기존 `MANUAL_VENDOR_TERMINATIONS` 수동 리스트가 계속 보강한다.
- 저장 방식은 비고/CI 수기입력(`progress_notes.json`/`ci_overrides.json`)과 동일한 패턴: `localStorage`에 항상 쌓이고, GitHub 토큰이 있는 사람이 열람할 때 `data/change_log.json`과 병합해 자동 커밋. 토큰 없는 사람이 봐도 그 브라우저 안에서는 정상 동작하되 팀 공유는 안 됨.
- 종합 현황 월간 공지사항에서 이 4종은 더 이상 "선택 기간"이 아니라 **오늘 기준 최근 30일 롤링**으로 노출(품절 제품만 기존처럼 선택 기간 유지). 카드 하단 "전체 변경 이력 보기" 토글로 누적된 전체 이력(윈도 밖 포함)을 날짜 내림차순으로 볼 수 있다.
- 로드 순서 경쟁 상태 주의: `data/change_log.json` fetch가 CSV 자동로드보다 먼저 끝나 감지 시점에 `D.goods_master`/`D.sup`가 아직 없을 수 있다 — `CHANGE_LOG_DETECTED` 플래그를 감지 성공 시에만 세워, 실패 시 다음 `renderMonthlyNotice()` 호출(데이터 로드 완료 후 refreshAll 경유)에서 재시도하도록 했다.
- v20에서 대체된 구 방식(월단위 `sup_YYYY_MM.csv` 2개 비교, `SUP_ROSTER_CACHE`/`loadSupRosterDiff`/`walkSupSnapshot`)은 제거했다 — 실사용 중 한 번도 이전 스냅샷을 찾지 못해(리포지토리에 `CSV_BANK`가 아예 없었음) 항상 "비교할 스냅샷 없음"이었던 것으로 확인됨.

**연말 자동 아카이빙 (v21 신규)** — `.github/workflows/yearly-archive.yml`이 **매년 1월 2일 00:10 KST**(cron `10 15 1 1 *`)에 `scripts/archive_year_end.mjs`를 실행해, 직전 연도의 `CSV/order.csv`·`issue.csv`를 `CSV_BANK/archive/{연도}/order_{연도}.csv`·`issue_{연도}.csv`로 복사 커밋한다. 대시보드의 `loadPriorYearArchive()`가 매년 "실행 시점의 작년"을 자동 계산해 이 경로를 조회하므로(`D.orderPrevYear`/`D.issuePrevYear`), **이 워크플로만 정상 실행되면 코드 수정 없이 YoY 비교가 다음 해로 넘어간다**. 안전장치: ① order.csv의 과업지시일자에서 대상 연도 비율이 50% 이상일 때만 실행 — 1월 첫 목요일의 주간 Airtable 갱신이 order.csv를 새해 데이터로 덮어쓴 *뒤에* 뒤늦게 돌면 잘못된 스냅샷을 만들지 않고 거부한다(order 검증 결과가 issue까지 게이트 — 둘은 같은 시점 스냅샷). ② 해당 연도 아카이브가 이미 있으면 덮어쓰지 않음(재실행 무해). ③ 놓친 경우 Actions 탭 → `yearly-archive` → Run workflow(연도 지정 가능)로 수동 실행하되, 이미 거부되는 상황이면 `CSV_BANK/{연도}_W##/`의 마지막 주차 아카이브에서 수동 복사한다. 참고: `data/data_2025.json`(월별 사전집계)은 아카이브 원본 미로드 시의 폴백으로만 유지 — 새로 만들 필요 없음.

**Airtable API가 아닌 소스(자동화 방식이 다름)**: `quarter_eval`(분기별평가)·`inv_weekly`·`sales_monthly`·`dashboard_period_summary`·`dashboard_group_summary`·`dashboard_sku_snapshot`·`purchase_review`·`season_plan`은 **GSheets(구매전략파트 S&OP Apps Script)** 원본이라 Airtable REST API로는 가져올 수 없다 — Google Sheets API(서비스 계정 자격증명 필요) 또는 GSheets Apps Script가 직접 GitHub Contents API로 push하는 방식이 필요하며, 별도 결정·구축이 필요하다. `sales`(GSheets SUPER BASE)도 마찬가지로 별도 소스. `quarter_eval.csv`는 v20.x에서 수동 정리본을 자동 로드에 추가(변경 시 수동 갱신 필요).

### 데이터 담당자 — 외주생산파트 (주 1회)
| 단계 | 작업 | 비고 |
|---|---|---|
| 1 | Airtable에서 CSV Export | 발주_RAW·이슈_RAW·공급망_RAW·고객인지이슈_RAW·품절리스트·파츠·굿즈마스터·진행현황·매출결산(→모두 `AIRTABLE_SOURCES`/진행현황 변수 설정 시 자동 커밋 가능, 위 참고). 분기별평가는 GSheets 소스라 이 자동화 대상 아님(구매전략파트 절차 참고) |
| 2 | 프로젝트 폴더 `CSV/`에 저장 | 한글 원본명 그대로 저장해도 됨. 대용량 CSV는 채팅 붙여넣기보다 로컬 파일 직접 저장 권장(문자 손상 위험, v14) |
| 3 | `deploy_v20.ps1` 실행 | 고정명 복사 + 커밋 + 푸시 자동. 또는 GitHub 웹에서 고정명 파일 직접 덮어쓰기 |
| 4 | 1~3분 후 배포 확인 | `-Verify` 스위치 또는 브라우저 Ctrl+F5 |
| 5 (v14) | 원본 CSV 헤더(컬럼명) 변경 시 `docs/CHANGELOG_v{N}.md`에 기록 후 팀 공유 | 예: issue.csv 입고물품 컬럼 추가 |

### 데이터 담당자 — 구매전략파트 (필요시, v10부터 사전집계 3종 필수)
| 단계 | 작업 | 비고 |
|---|---|---|
| 1 | GSheets S&OP Apps Script에서 `dashboard_period_summary`/`dashboard_group_summary`/`dashboard_sku_snapshot` 3종 생성·Export | 3종 모두 있어야 Agg 경로 작동. 하나라도 없으면 재고 화면이 레거시(inv_weekly 직접계산)로 폴백해 v10 이전 숫자와 달라질 수 있음 |
| 2 | `CSV/`에 저장 후 `deploy_v20.ps1` 실행 | 외주생산파트와 동일 배포 경로 공유 |
| 3 | 배포 후 재고운영/품절상세/졸업검토 화면에서 도넛차트 3종·회전율 숫자 확인 | 기존 GSheets 화면과 동일 기준일로 1:1 대조 권장 |

### 접속자 (팀원)
| 단계 | 작업 |
|---|---|
| 1 | https://nanyounglee.github.io/SCMDASHBOARD/ 접속 — 끝. 자동 로드됨 |
| 2 | 월 칩 선택 → 확인 (YoY 자동 표시) |
| 3 | (선택) 보정 데이터가 있으면 드래그앤드롭 수동 업로드 |

---

## 10. 관련 링크

| 리소스 | URL |
|---|---|
| SCM 대시보드 | https://nanyounglee.github.io/SCMDASHBOARD/ |
| GitHub 저장소 | https://github.com/nanyounglee/SCMDASHBOARD |
| 협력사 변경 대시보드 | https://nanyounglee.github.io/scm_vendor_change/ |
| 월간 리포트 | https://nanyounglee.github.io/scm-monthly-report/ |
| S&OP 대시보드 | Google Apps Script (sincerely.one 내부) |

---

*문서 기준: index.html (scm_dashboard_v21.html) v21 (2026-07-20) · 약 7,153줄 — 연도별 아카이빙 체계(CSV_BANK/archive·yearly-archive.yml·loadPriorYearArchive)·협력사 상세 전년 동기 비교 · v20.x(분기별평가 실데이터·포트폴리오 클릭·이슈탭 수정·미입하율표) · v20(Airtable 목요일 자동 갱신·지금 새로고침·변경 이력 시스템) 기반*  
*대시보드 변경 시 이 문서도 함께 업데이트 바랍니다. 원본 CSV 헤더 변경 시 §8 버전 규칙에 따라 CHANGELOG에도 기록 바랍니다.*
