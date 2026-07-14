# SCM 통합운영 대시보드 — 프로젝트 설계 아키텍처

> 버전: v14 | 갱신일: 2026-07-14 | 작성: 이난영 / Claude AI  
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

### 배포 위치
| 파일 | 위치 |
|---|---|
| 운영 원본 | `index.html` (GitHub Pages가 직접 서빙) |
| 버전 스냅샷 | `scm_dashboard_v14.html` (index.html 복사본, 이전 버전은 `archive/`) |
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
│  │              UI 렌더링 (22개 페이지)                           │ │
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
| `data/data_2025.json` | 45KB | 2025년 월별 사전집계 (발주/매입/이슈 YoY 비교용) | 연 1회 재생성 |
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

---

## 5. UI 섹션 구조 (22개 페이지)

```
sidebar 네비게이션
├── [대시보드]
│   └── 종합 현황 (overview)
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
│   ├── 발주 현황 (order) — 전체제품 MoM/YoY, Bottom20, 프로젝트별, 빈도, Task
│   │     └ 발주 TASK 클릭 모달[v11]: 발주현황Top/미발주현황/DB원가비교 3-tab(§4-10)
│   ├── 매입 현황 (purchase) — 협력사별 Top10, 제조유형/업태/인쇄 차트
│   └── 원가 분석 (cost-analysis) — 월별 요약 / 프로젝트별 상세 (공정DB 대비)
│
├── [이슈 관리] — 외주생산파트
│   ├── 이슈 현황 (issue) — 전체/품질/수량/운영 + 대응 + 실패비용
│   │     └ 제품×협력사 이슈율[v12 신규 탭] — renderIssueRateMatrix()(§4-13)
│   └── 고객인지 이슈 (customer) — 연도별/작성자별 + 실패비용
│
├── [매출 분석] — 공통
│   ├── 매출/마진 분석 (sales) — 월별 추이, 제품별 비중, 마진율
│   └── 제품별 발주수량 추이 (product-trend)[v12: 판매량→발주수량 기준 교체] — D.order 기반 SKU별 라인차트(§4-14)
│
├── [공급망] — 외주생산파트
│   ├── 공급망 포트폴리오 (portfolio)[v12: QCD×관계 Tier로 기준 교체(§4-11)] — 분기별평가 CSV 기반, 활성 필터 + 변경검토리스트
│   ├── 협력사 현황 (supplier) — 목록, 검색 → 클릭 시 상세모달[v12: 연도별 매입추이+이슈상세 추가(§4-12)]
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

### 파일 구조
```
SCMDASHBOARD/
├── index.html                       ← 운영 원본 (GitHub Pages 직접 서빙 · v14 · 약 6,008줄)
├── scm_dashboard_v14.html           ← 현행 버전 스냅샷 (index.html 복사본)
├── archive/                         ← 이전 버전 스냅샷 (v3~v13)
├── CSV/                             ← 자동 로드 대상 CSV
│   ├── order.csv · issue.csv · sup.csv · ci.csv
│   ├── stockout_list.csv · inv_weekly.csv · sales_monthly.csv
│   ├── dashboard_period_summary.csv · dashboard_group_summary.csv · dashboard_sku_snapshot.csv  ← v10 신규
│   ├── parts.csv                    ← v11 신규(코스트베이스, 수동 업로드 기본)
│   ├── progress_연도_W주차.csv · project_연도_W주차.csv  ← v13 신규(발주 진행현황·주간 매출결산)
│   ├── _manifest.json               ← key→파일명 매핑 (HTML 수정 없이 파일명 변경)
│   └── (한글 원본 CSV — 보존용)
├── data/                            ← 영구 임베딩 JSON
│   ├── parts_master.json · data_2025.json · cost_db.json
│   └── progress_notes.json · ci_overrides.json  ← v13 신규(GitHub 연동 자동 커밋 대상)
├── docs/
│   ├── SCM_DASHBOARD_ARCHITECTURE.md       ← 이 파일 (v14 갱신)
│   ├── CHANGELOG_v14.md                    ← 버전별 변경 내역 (v14 신규, 팀 공유용)
│   ├── purchase_dashboard_migration_strategy.md  ← 구매파트 Apps Script 이식 전략 (v10 반영 현황 기준, v11 이후는 범위 밖)
│   ├── SCM_DASHBOARD_로직설명_v14.html  ← 로직 설명서 (v14 갱신)
│   ├── SCM_DASHBOARD_사용자가이드_v14.html  ← 사용자 가이드 (v14 갱신)
│   ├── SCM_KPI_리포트_2026Q2.xlsx
│   └── archive/                     ← 구버전 (v13 이하 로직설명/사용자가이드/CHANGELOG, V4_로직설명_v7.html 등)
├── deploy_v14.ps1                   ← 배포 스크립트 (git 자가복구 + 버전 정리 + 안전 동기화 + 문서/구파일 정리)
├── archive_csv.ps1                  ← v13 신규 — 주간 CSV(progress_/project_)는 최신 1개만 유지 후 CSV_BANK로 이동
├── .nojekyll                        ← Pages Jekyll 비활성화 (빌드 실패 방지)
└── .claude/                         ← Claude 설정
```
> `_merge_staging/`(v10 3-way 병합 1회성 산출물), `deploy_v10.ps1`, `merge_resolve_v10.ps1`은 v12 배포 시 정리(archive 이동 또는 삭제) 완료.

### 버전 규칙 (v7~)
- **운영 원본은 `index.html`** — 수정 작업은 index.html에 직접, 로컬 확인은 수동 업로드 모드
- **배포는 `deploy_v{N}.ps1`(현재 `deploy_v14.ps1`)** — 실행 시 자동으로:
  1. git 저장소 자가진단/복구 (index 손상, 잔류 lock)
  2. 한글 원본 CSV → 고정 영문명 복사
  3. index.html이 바뀐 경우에만 `scm_dashboard_v{N+1}.html` 스냅샷 생성 (버전 자동 카운트, 이전 버전 archive 이동)
  4. 커밋 → 원격이 앞서 있으면 rebase (구버전이 원격 최신을 덮어쓰는 사고 방지) → 푸시
- `-Verify` 스위치: 푸시 90초 후 배포 페이지에 `autoLoadRaw` 포함 여부 자동 검증
- **여러 담당자가 각자 브랜치에서 수정할 경우(v10, v14처럼) rebase 자동화가 실패할 수 있음** — 겹치는 함수를 수동 3-way 병합한 뒤(v10처럼 1회용 스크립트를 쓰거나, v14처럼 `git merge --no-commit`으로 충돌 지점을 직접 해소) 병합 커밋을 얹는 방식 사용. v14는 `scm_dashboard_v13.html`(스냅샷)이 항상 `index.html`과 바이트 동일하다는 성질을 이용해, index.html 충돌만 해소한 뒤 그 결과를 스냅샷에 그대로 복사하는 방식으로 중복 해소 작업을 줄였다.
- **대시보드 버전 업 시 docs/ 문서(아키텍처 md, 로직설명, 사용자가이드, 이식전략 md)도 같은 커밋에서 갱신**
- **v14부터**: 변경 시 `docs/CHANGELOG_v{N}.md`에 변경 내역을 1줄씩 기록해 팀 공유. 원본 Airtable/GSheets CSV의 **헤더(컬럼명)가 추가·변경되면 반드시 변경 내역에 명시**(예: issue.csv `입고물품` 컬럼 추가) — 다른 파트 CSV 갱신 담당자가 컬럼 의존 로직이 깨졌는지 확인할 수 있어야 한다.

---

## 9. 주간 업데이트 절차 (v14 · 자동 로드 기준)

### 데이터 담당자 — 외주생산파트 (주 1회)
| 단계 | 작업 | 비고 |
|---|---|---|
| 1 | Airtable에서 CSV Export | 발주_RAW, 이슈_RAW, 공급망_RAW, 고객인지이슈_RAW, 분기별평가, (v13) 진행현황·매출결산 |
| 2 | 프로젝트 폴더 `CSV/`에 저장 | 한글 원본명 그대로 저장해도 됨. 대용량 CSV는 채팅 붙여넣기보다 로컬 파일 직접 저장 권장(문자 손상 위험, v14) |
| 3 | `deploy_v14.ps1` 실행 | 고정명 복사 + 커밋 + 푸시 자동. 또는 GitHub 웹에서 고정명 파일 직접 덮어쓰기 |
| 4 | 1~3분 후 배포 확인 | `-Verify` 스위치 또는 브라우저 Ctrl+F5 |
| 5 (v14) | 원본 CSV 헤더(컬럼명) 변경 시 `docs/CHANGELOG_v{N}.md`에 기록 후 팀 공유 | 예: issue.csv 입고물품 컬럼 추가 |

### 데이터 담당자 — 구매전략파트 (필요시, v10부터 사전집계 3종 필수)
| 단계 | 작업 | 비고 |
|---|---|---|
| 1 | GSheets S&OP Apps Script에서 `dashboard_period_summary`/`dashboard_group_summary`/`dashboard_sku_snapshot` 3종 생성·Export | 3종 모두 있어야 Agg 경로 작동. 하나라도 없으면 재고 화면이 레거시(inv_weekly 직접계산)로 폴백해 v10 이전 숫자와 달라질 수 있음 |
| 2 | `CSV/`에 저장 후 `deploy_v14.ps1` 실행 | 외주생산파트와 동일 배포 경로 공유 |
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

*문서 기준: index.html (scm_dashboard_v14.html) v14 (2026-07-14) · 약 6,008줄 — 원격 v13(파트장님) + 세션 검색필터/CI매칭 수정 병합*  
*대시보드 변경 시 이 문서도 함께 업데이트 바랍니다. 원본 CSV 헤더 변경 시 §8 버전 규칙에 따라 CHANGELOG에도 기록 바랍니다.*
