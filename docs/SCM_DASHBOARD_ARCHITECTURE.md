# SCM 통합운영 대시보드 — 프로젝트 설계 아키텍처

> 버전: v4.1 | 작성일: 2026-06-25 | 작성: 이난영 / Claude AI  
> 대상: 구매전략파트 · 외주생산파트 팀원 공유, 유지보수, 버그 대응

---

## 1. 시스템 개요

### 목적
구매전략파트(S&OP/재고운영)와 외주생산파트(발주/협력사/이슈관리)가  
하나의 HTML 대시보드에서 각자의 업무를 리뷰하고 운영 의사결정을 지원하는 **통합 SCM 운영 도구**.

### 핵심 특성
- **서버 없음** — 단일 `.html` 파일 하나로 동작. 외부 API 호출 없음.
- **데이터 입력** — CSV 업로드 (Airtable/GSheets Export) + 영구 임베딩 JSON 3종
- **파싱은 브라우저 JS** — 모든 집계·필터·차트 렌더링이 브라우저에서 실행
- **localStorage** — 업로드 일시, 매입검토 편집, 시즌계획 확정수량, JSON 캐시 저장
- **Chart.js 4.4.1** — CDN 로드, 오프라인 시 차트만 미표시

### 배포 위치
| 파일 | 위치 |
|---|---|
| 운영 대시보드 | `scm_dashboard_v4.html` (로컬) |
| GitHub Pages | https://nanyounglee.github.io/SCMDASHBOARD/ |
| 레포지토리 | https://github.com/nanyounglee/SCMDASHBOARD |

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────────┐
│                   Airtable (원천 데이터)                           │
│  SCM KPI 베이스          │  공급망 관리 베이스  │  S&OP GSheets     │
│  · 발주_RAW (task)       │  · 공급망_RAW        │  · inventory_weekly│
│  · 이슈_RAW              │                      │  · sales_monthly   │
│  · 고객인지이슈_RAW       │                      │  · purchase_review │
│  · 품절리스트             │                      │  · 시즌매입_파츠연결 │
└──────────────┬───────────────────────────────────────────────────┘
               │  CSV Export (수동) — 주 1회 (외주생산) / 필요시 (구매전략)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│            브라우저 (scm_dashboard_v4.html · 211KB)                │
│                                                                    │
│  ┌─────────────────┐   ┌──────────────────────────────────────┐  │
│  │ CSV 업로드 (12슬롯) │   │ 영구 임베딩 JSON (자동 로드)          │  │
│  │ · 외주생산 4종     │   │ · parts_master.json (834KB·2,749파츠) │  │
│  │ · 구매전략 4종     │   │ · data_2025.json (45KB·월별집계)      │  │
│  │ · 공통/선택 4종    │   │ · cost_db.json (1.3MB·공정+단가DB)   │  │
│  └────────┬────────┘   └──────────────┬───────────────────────┘  │
│           │    통합 드래그앤드롭         │   fetch → localStorage 캐시│
│           │    (CSV 헤더 자동 인식)      │                           │
│           └─────────────┬──────────────┘                           │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    데이터 집계 엔진                             │ │
│  │  purchaseByMonth() │ calcElapsedDays() │ calcProjectCost()    │ │
│  │  getReworkCostForProject() │ matchesSearch() │ YoY/MoM        │ │
│  │  getSubcontractRiskRows() │ getPartCostForQty()               │ │
│  └──────────────────────────────────┬───────────────────────────┘ │
│                                     ▼                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              UI 렌더링 (22개 페이지)                           │ │
│  │  KPI 카드 │ Chart.js 차트 │ 테이블 │ 모달 │ 검색 필터          │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
               │  git push (index.html 복사)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│              GitHub Pages (공유 URL)                                │
│          https://nanyounglee.github.io/SCMDASHBOARD/               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 입력 데이터 — CSV 12종 + 영구 임베딩 JSON 3종

### 3-1. 외주생산파트 CSV (4종 · 주 1회)

#### 발주_RAW (`SCM_KPI_발주_RAW.csv`)
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
| `sync_itemdb` | 파츠코드 추출 → 원가 산출 | `BRPR_PT4421-...` 형식 |
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

#### 이슈_RAW (`KPI_이슈_RAW.csv`)
**Airtable**: SCM KPI → KPI_이슈_RAW 뷰

| CSV 컬럼명 | 용도 |
|---|---|
| `실제입하일` | 이슈 월 필터 (우선) |
| `입하예정일` | 실제입하일 없을 때 대체 |
| `이슈카테고리` | 품질/수량/운영 분류 (복합값 가능) |
| `project_name` | 프로젝트명 |
| `item (통합) (from order)` | 제품명 |
| `프로젝트_발주자` | 담당자 |
| `품질이슈내용` | 품질 탭 상세 |
| `품질등급최초판정` | 품질 등급 |
| `품질등급의견판단사유_SCM` | **대응** 컬럼 표시 |
| `수량이슈내용` / `수량이슈대응방안` | 수량 탭 |
| `운영이슈내용(by물류)` / `운영이슈개선방안_SCM` | 운영 탭 |

#### 공급망_RAW (`SCM_KPI_공급망_RAW.csv`)
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

#### 고객인지이슈_RAW (`KPI_고객인지이슈_RAW.csv`)
**Airtable**: SCM KPI → 고객인지이슈_RAW 뷰

| CSV 컬럼명 | 용도 |
|---|---|
| `등록일자` | 월 필터 기준 |
| `프로젝트명` | 테이블 표시 + 실패비용 조인 |
| `관련제품` | 테이블 표시 |
| `작성자명` | 작성자별 차트 |
| `이슈내용` | 상세 표시 |
| `상태` | 상태 태그 |

### 3-2. 구매전략파트 CSV (4종 · 필요시)

| Key | 파일명 | 출처 | 필수 컬럼 |
|---|---|---|---|
| `inv_weekly` | S&OP 재고주간 | GSheets S&OP → inventory_weekly | 파츠번호, 기준일, 재고수량, 재고금액, 단가, 판매상태, 관리대상여부, 굿즈카테고리 |
| `sales_monthly` | S&OP 매출월간 | GSheets S&OP → sales_monthly | 파츠번호, 기준월, 판매량 |
| `purchase_review` | 매입검토현황 | GSheets S&OP → purchase_review | REVIEW_ID, 파츠번호, 결정상태, 파츠명, 매입계획수량, 매입확정수량 |
| `season_plan` | 시즌재고계획 | GSheets S&OP → 시즌매입_파츠연결 | 굿즈명, 옵션, 계획구분, 표준원가, 매입희망수량 |

### 3-3. 공통/선택 CSV (4종)

| Key | 파일명 | 출처 | 필수 컬럼 |
|---|---|---|---|
| `stockout_list` | 품절리스트 | Airtable → sales_status_history | 파츠명, 판매상태, 품절 성격, 변경일(인터페이스용), 재고소유구분, 굿즈품절여부 |
| `sales` | 판매주문 | GSheets SUPER BASE | 제품명, 주문수량, 판매단가, 소계, 연월 |
| `qms_raw` | QMS 품질 | Airtable → 품질이슈 뷰 | 발생일, 이슈유형, 파츠번호 |
| `cost_reduction` | 원가/Movement | Airtable → Movement 데이터 | project, 출고자재, 수량, 실제단가 |

### 3-4. 영구 임베딩 JSON (업로드 불필요)

| 파일 | 크기 | 내용 | 갱신 |
|---|---|---|---|
| `parts_master.json` | 834KB | 파츠 마스터 2,749개 (코드/파츠명/카테고리/협력사/수량별 원가/MOQ/리드타임 등 18필드) | "파츠 마스터 갱신" 버튼 |
| `data_2025.json` | 45KB | 2025년 월별 사전집계 (발주/매입/이슈 YoY 비교용) | 연 1회 재생성 |
| `cost_db.json` | 1.3MB | 공정DB 1,623개 + 단가DB 3,549개 (수량별 표준단가 10구간) | 공정/단가 변경 시 |

---

## 4. 핵심 파싱 로직

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
// 발주현황 Top 탭: 제품별 MoM/YoY 증감률 표시
```

### 4-7. 검색 필터
```javascript
function matchesSearch(row, query) {
  // 16개 필드에서 검색어 포함 여부 확인
  // → 모든 KPI, 차트, 테이블에 실시간 적용
}
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
├── [S&OP · 재고운영] — 구매전략파트
│   ├── 재고운영 현황 (inventory-ops) — KPI, 재고추이, 카테고리별, 운영밴드
│   ├── 품절 상세 (stockout-detail) — 품절예측, 사유별/소유별 분포
│   ├── 매입 검토 (purchase-review) — 파이프라인, 인라인 편집
│   ├── 시즌재고 계획 (season-plan) — 3구분 탭, 확정수량 입력
│   ├── EOQ · 발주알람 (eoq) — 경제적발주량, 리오더포인트
│   └── 졸업 검토 (graduation) — EOL 후보
│
├── [발주 · 매입] — 외주생산파트
│   ├── 발주 현황 (order) — 전체제품 MoM/YoY, Bottom20, 프로젝트별, 빈도, Task
│   ├── 매입 현황 (purchase) — 협력사별 Top10, 제조유형/업태/인쇄 차트
│   └── 원가 분석 (cost-analysis) — 월별 요약 / 프로젝트별 상세 (공정DB 대비)
│
├── [이슈 관리] — 외주생산파트
│   ├── 이슈 현황 (issue) — 전체/품질/수량/운영 + 대응 + 실패비용
│   └── 고객인지 이슈 (customer) — 연도별/작성자별 + 실패비용
│
├── [매출 분석] — 공통
│   ├── 매출/마진 분석 (sales) — 월별 추이, 제품별 비중, 마진율
│   └── 제품별 판매량 추이 (product-trend) — SKU별 라인차트
│
├── [공급망] — 외주생산파트
│   ├── 협력사 현황 (supplier) — 목록, 검색
│   ├── 협력사유형별 제품군 (supplier-product) — 히트맵 매트릭스
│   └── 협력사 변경 검토 ↗ (외부링크)
│
├── [품질관리 · QMS] — 공통
│   └── 품질 현황 (qms) — QI/QC/QA KPI, COPQ 추이
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
| 발주 TASK 클릭 | `orderTask` | 전체 굿즈 발주량 내림차순 (프로젝트/재고 구분) |
| 매입금액 클릭 | `purchase` | 제조유형별 그룹 → 협력사 매입 내림차순 → 협력사 클릭 시 2차 모달 |
| 협력사명 클릭 | `supplierDetail` | 매입추이 6개월 (정확한 숫자) + 빈번 발주 제품 Top 3 |
| 이슈건수 클릭 | `issue` | 전체/품질/수량/운영 탭 필터 + 대응 + 실패비용 |
| 긴급발주 클릭 | `urgent` | 긴급 발주 목록 (서울디지털인쇄협동조합 제외) |
| 고객인지이슈 클릭 | `ci` | 이슈내용 + 실패비용 |
| 매입추이 월 클릭 | `purchaseMonth` | 해당 월 Top5 협력사 + Top5 제품 (카테고리) |
| 재고자산 KPI 클릭 | `inventoryAsset` | SKU별 상세 + 정렬 + 회전율 아코디언 (판매추이/회의이력) |

---

## 7. CSV 자동 인식 시그니처

```javascript
const FILE_SIGNATURES = {
  purchase_review: { must: ['REVIEW_ID','파츠번호','결정상태'] },
  season_plan:     { must: ['굿즈명','옵션','계획구분'] },
  inv_weekly:      { must: ['파츠번호','기준일','재고수량','재고금액'] },
  stockout_list:   { must: ['파츠명','판매상태','품절 성격'] },
  order:           { must: ['과업지시일자','발주번호'] },
  issue:           { must: ['이슈카테고리'], not: ['판매상태','총재고수량'] },
  sup:             { must: ['협력사 이름','1. 제조유형'] },
  ci:              { must: ['등록일자','이슈내용','프로젝트명'], not: ['이슈카테고리'] },
  // must: 모든 필드 존재 + not: 하나라도 있으면 매칭 제외
};
// BOM(UTF-8 0xFEFF) 자동 제거 적용
```

---

## 8. 버전 관리

### 버전 이력
| 버전 | 태그 | 내용 |
|---|---|---|
| v4.0 | `bef8f6b` | 통합 대시보드 최초 배포 (22페이지, 17 CSV) |
| v4.0.1 | `d23b146` | CSV 17→12 통합, 파츠마스터/2025/공정DB 영구 임베딩 |
| v4.0.2 | `405b683` | 실패비용/대응, MoM·YoY, 원가분석 월별/프로젝트 탭 |
| v4.1 | `8c0e0c8` | 슬롯 파트별 분리, Critical 파싱 오류 수정 |

### 파일 구조
```
SCMDASHBOARD/
├── scm_dashboard_v3.html          ← 이전 버전 (보관)
├── scm_dashboard_v4.html          ← 현행 운영 버전
├── index.html                     ← GitHub Pages 배포 (v4 복사본)
├── parts_master.json              ← 파츠 마스터 임베딩
├── data_2025.json                 ← 2025년 YoY 데이터
├── cost_db.json                   ← 공정DB + 단가DB
├── SCM_DASHBOARD_ARCHITECTURE.md  ← 이 파일
├── SCM_DASHBOARD_V4_로직설명.html  ← 로직 설명서 원본
├── SCM_DASHBOARD_V4_로직설명.pdf   ← 로직 설명서 PDF
├── package.json                   ← puppeteer (PDF 생성용)
└── .claude/                       ← Claude Code 설정
```

### 버전 규칙
- 수정 작업: 로컬에서 `scm_dashboard_v4.html` 수정 → `localhost:8080`에서 확인
- 배포 요청 시: `index.html` 복사 → `git commit` → `git tag vX.Y` → `git push --tags`
- `v4.{minor}`: 기능 추가 시 minor 증가

---

## 9. 주간 업데이트 절차

| 단계 | 작업 | 비고 |
|---|---|---|
| 1 | Airtable에서 4개 CSV Export | 발주_RAW, 이슈_RAW, 공급망_RAW, 고객인지이슈_RAW |
| 2 | 대시보드 접속 | https://nanyounglee.github.io/SCMDASHBOARD/ |
| 3 | 통합 드래그앤드롭에 파일 드래그 | 자동 인식 — 파일명 무관 |
| 4 | 월 칩 선택 → 확인 | YoY는 자동 표시 |
| 5 | (선택) S&OP CSV 추가 | 구매전략 기능 사용 시만 |

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

*문서 기준: scm_dashboard_v4.html v4.1 (2026-06-25) · 3,121줄*  
*변경 시 이 문서도 함께 업데이트 바랍니다.*
