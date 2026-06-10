# SCM 외주생산파트 운영 대시보드 — 프로젝트 설계 아키텍처

> 버전: v2.0 | 작성일: 2026-06-10 | 작성: 이난영 / Claude AI  
> 대상: 팀원 공유, 유지보수, 버그 대응

---

## 1. 시스템 개요

### 목적
외주생산파트가 에어테이블에서 주기적으로 export한 CSV를 브라우저에 업로드하여  
발주·매입·이슈·협력사 현황을 실시간으로 시각화하는 **완전 오프라인 독립 HTML 대시보드**.

### 핵심 특성
- **서버 없음** — 단일 `.html` 파일 하나로 동작. 외부 API 호출 없음.
- **데이터 업로드 방식** — Airtable live connection 대신 CSV export → 브라우저 업로드
- **파싱은 브라우저 JS** — 모든 집계·필터·차트 렌더링이 브라우저에서 실행
- **localStorage** — 마지막 업로드 일시를 로컬에 저장 (데이터 자체는 저장 안 함)

### 배포 위치
| 파일 | 위치 |
|---|---|
| 운영 대시보드 | `scm_dashboard_v2.html` (로컬) |
| GitHub Pages | https://nanyounglee.github.io/SCMDASHBOARD/ |
| 레포지토리 | https://github.com/nanyounglee/SCMDASHBOARD |

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                        Airtable (원천 데이터)                  │
│  task-SCMKPI_Raw (발주 통합)  │  이슈RAW  │  공급망RAW  │  CI RAW│
└──────────────┬───────────────────────────────────────────────┘
               │  주 1회 이상 CSV Export (수동)
               ▼
┌──────────────────────────────────────────────────────────────┐
│                   브라우저 (scm_dashboard_v2.html)              │
│                                                              │
│  ┌──────────────┐    ┌──────────────────────────────────┐   │
│  │  CSV Upload  │───▶│         parseCSV()               │   │
│  │  (4개 파일)   │    │  UTF-8 BOM 제거, 따옴표 처리      │   │
│  └──────────────┘    └──────────────┬───────────────────┘   │
│                                     │                        │
│                      ┌──────────────▼───────────────────┐   │
│                      │         데이터 집계 엔진           │   │
│                      │  isStock() │ purchaseByMonth()    │   │
│                      │  partsType() │ catTags()          │   │
│                      └──────────────┬───────────────────┘   │
│                                     │                        │
│                      ┌──────────────▼───────────────────┐   │
│                      │    UI 렌더링 (Chart.js 4.4.1)    │   │
│                      │  KPI 카드 │ 테이블 │ 모달 │ 차트  │   │
│                      └──────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
               │  git push (deploy_scmdashboard.ps1)
               ▼
┌──────────────────────────────────────────────────────────────┐
│              GitHub Pages (공유 URL)                          │
│          https://nanyounglee.github.io/SCMDASHBOARD/         │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 입력 CSV 파일 4종 — Airtable 매핑

### 3-1. 발주_RAW (`task-SCMKPI_Raw.csv`)

**Airtable 테이블**: SCM KPI → task-SCMKPI_Raw 뷰  
**용도**: 발주 TASK 카운트, 매입금액 집계, Top20/Bottom20, 프로젝트별 매입

| CSV 컬럼명 | Airtable 필드 | 사용 목적 | 비고 |
|---|---|---|---|
| `과업지시일자` | 과업지시일자 | **발주 TASK 월 기준 필드** | `2026.6.3` 형식 |
| `발주번호` | 발주번호 | 비스포크 산출물 식별자 | |
| `산출물` | 산출물 | Top20/Bottom20 아이템명 | 비어있으면 비스포크 |
| `수주처` | 수주처 | 협력사명 | |
| `과업담당자_이름` | 과업담당자_이름 | 담당자별 집계 | |
| `발주지시수량` | 발주지시수량 | 발주량 집계 | |
| `공급가액` | 공급가액 | 매입금액 (VAT 별도) | `₩1,200,000` 형식 |
| `세금계산서작성월 (from 지출결의)` | 세금계산서작성월 | **매입금액 월 기준** | `25년 6월` 또는 `,`로 분할 |
| `합계_분할` | 합계_분할 | 분할 세금계산서 월별 금액 | `₩2,400,000, ₩32,400,000` |
| `파츠유형` | 파츠유형 *(추가 예정)* | Product Parts 필터 | 없으면 sync_item 파싱 |
| `sync_item이니셔티브` | sync_item이니셔티브 | 굿즈코드 추출 | `BRPR_PT4421-...` 형식 |
| `movement_산출이동` | movement_산출이동 | 재고생산 판별 | '재고' 포함 여부 |
| `project` | project | 재고생산 판별 + 프로젝트 집계 | `PNA51823-OSSTUDIO` 형식 |
| `긴급여부` | 긴급여부 | 긴급발주 카운트 | `긴급` 문자열 |

### 3-2. 이슈_RAW (`KPI_이슈_RAW(2026).csv`)

**Airtable 테이블**: SCM KPI → KPI_이슈_RAW 뷰  
**용도**: 이슈건수 KPI, 이슈 탭 상세, 이슈 추이 차트

| CSV 컬럼명 | Airtable 필드 | 사용 목적 | 비고 |
|---|---|---|---|
| `실제입하일` | 실제입하일 | **이슈 월 필터 기준** (우선) | `2026.6.3` 형식 |
| `입하예정일` | 입하예정일 | 실제입하일 없을 때 대체 | |
| `이슈카테고리` | 이슈카테고리 | 품질/수량/운영 분류 | 복합값 가능: `수량이슈, 품질이슈` |
| `project_name` | project_name | 테이블 표시 | |
| `item (통합) (from order)` | item (통합) | 제품명 | |
| `프로젝트_발주자` | 프로젝트_발주자 | 담당자 | |
| `품질이슈내용` | 품질이슈내용 | 품질 탭 상세 | |
| `품질등급최초판정` | 품질등급최초판정 | 품질 등급 | |
| `수량이슈내용` | 수량이슈내용 | 수량 탭 상세 | |
| `수량이슈대응방안` | 수량이슈대응방안 | 수량 탭 대응 | |
| `운영이슈내용(by물류)` | 운영이슈내용(by물류) | 운영 탭 상세 | |
| `운영이슈개선방안_SCM` | 운영이슈개선방안_SCM | 운영 탭 개선방안 | |

### 3-3. 공급망_RAW (`공급망_RAW(2026).csv`)

**Airtable 테이블**: 공급망 관리 → 공급망_RAW 뷰  
**용도**: 협력사 마스터 목록, 제조유형 매핑, 협력사 탭 표시

> ⚠️ 이 파일은 이슈 로그가 아니라 **협력사 마스터**입니다. 이슈 데이터는 이슈_RAW에서 가져옵니다.

| CSV 컬럼명 | Airtable 필드 | 사용 목적 | 비고 |
|---|---|---|---|
| `협력사 이름` | 협력사 이름 | 협력사 식별키 | |
| `1. 제조유형` | 1. 제조유형 | 제조유형 도넛차트, 매핑 | 턴키제작/외주용역/단순구매 |
| `협력사 Status` | 협력사 Status | 거래중 여부 | 비어있으면 **거래중** 처리 |
| `인쇄` | 인쇄 | 협력사 탭 표시 | |
| `발주담당자` | 발주담당자 | 협력사 탭 표시 | |
| `협력사 결제조건` | 협력사 결제조건 | 협력사 탭 표시 | |

### 3-4. 고객인지이슈_RAW (`KPI_고객인지이슈_RAW.csv`)

**Airtable 테이블**: SCM KPI → 고객인지이슈_RAW 뷰  
**용도**: 고객인지이슈 KPI, 고객인지 탭

| CSV 컬럼명 | Airtable 필드 | 사용 목적 | 비고 |
|---|---|---|---|
| `등록일자` | 등록일자 | 월 필터 기준 | `2026.6.3.` 형식 |
| `프로젝트명` | 프로젝트명 | 테이블 표시 | |
| `관련제품` | 관련제품 | 테이블 표시 | |
| `작성자명` | 작성자명 | 작성자별 차트 | |
| `이슈내용` | 이슈내용 | 상세 표시 | |
| `상태` | 상태 | 상태 태그 | |

---

## 4. 핵심 파싱 로직

### 4-1. 발주 TASK 카운트 (KPI 카드 #1)

```javascript
// 기준: 과업지시일자 월 기준 행 카운트 (재고생산 제외)
const f = D.order.filter(r =>
  pOrderMonth(r['과업지시일자']) === SEL_MONTH && !isStock(r)
);
// KPI 값 = f.length
```

**재고생산 판별 (`isStock`)**:
```javascript
function isStock(r) {
  return (r['movement_산출이동']||'').includes('재고')
      || (r['project']||'').includes('재고');
}
```

### 4-2. 월 매입금액 (KPI 카드 #2) — ⭐ 핵심 로직

세금계산서 분할(split) 케이스를 처리하는 핵심 함수:

```javascript
function purchaseByMonth(row) {
  const taxMonths = pTaxMonth(row['세금계산서작성월 (from 지출결의)'] || '');
  if (!taxMonths.length) return {};

  // 단일 월: 그냥 공급가액 전체
  if (taxMonths.length === 1) return { [taxMonths[0]]: pa(row['공급가액']) };

  // 분할 케이스: 합계_분할 필드에 월별 금액이 있으면 사용
  // 없거나 모두 0이면 공급가액을 월수로 균등 분할
  const splitAmts = pSplitAmounts(row['합계_분할'] || '');
  const result = {};
  taxMonths.forEach((m, i) => {
    const amt = (splitAmts[i] && splitAmts[i] > 0)
      ? splitAmts[i]
      : pa(row['공급가액']) / taxMonths.length;
    result[m] = (result[m] || 0) + amt;
  });
  return result;
}
```

**집계 방식**: 각 row에서 `purchaseByMonth(r)[SEL_MONTH]` 값을 합산  
→ 한 발주건이 2개월에 걸쳐 있어도 월별로 정확히 분리됨

### 4-3. 이슈카테고리 중복 카운트

복합 이슈 (예: `"수량이슈, 품질이슈"`) → 각 카테고리에 +1씩 카운트:

```javascript
f.forEach(r => {
  const c = r['이슈카테고리'] || '';
  if (c.includes('품질')) q++;  // 품질에도 +1
  if (c.includes('수량')) n++;  // 수량에도 +1
  if (c.includes('운영')) o++;  // 운영에도 +1
});
// 총 이슈건수 = f.length (행 기준), 카테고리별 합계 ≥ f.length
```

### 4-4. 파츠유형 판별

```javascript
function partsType(r) {
  // 우선: 파츠유형 컬럼 직접 사용 (Airtable에 추가되면 자동 활성화)
  return r['파츠유형'] || '';
  // 컬럼 추가 전: sync_item이니셔티브 앞 4자리 굿즈코드로 추론
  // (BRPR, BRPK 등 Product Parts 코드 목록 관리 필요)
}
```

### 4-5. 비스포크 산출물 처리

```javascript
const prod = r['산출물'] || '';
const key = prod || '[비스포크] ' + r['발주번호'];
// → 산출물이 비어있으면 발주번호 표시 (담당자가 에어테이블에서 확인 가능)
```

### 4-6. 협력사 Status 빈값 처리

```javascript
const st = r['협력사 Status'] || '거래중';  // 빈값 → 거래중
```

### 4-7. 날짜 파싱 함수 모음

```javascript
// 과업지시일자 파싱: "2026.6.3" → "2026.6"
function pOrderMonth(s) {
  const m = (s||'').match(/(\d{4})\.(\d{1,2})/);
  return m ? `${m[1]}.${parseInt(m[2])}` : null;
}

// 세금계산서 월 파싱: "25년 6월, 25년 7월" → ["2025.6", "2025.7"]
function pTaxMonth(s) {
  return s.split(',').map(p => {
    const m = p.trim().match(/(\d{2})년\s*(\d{1,2})월/);
    return m ? `20${m[1]}.${parseInt(m[2])}` : null;
  }).filter(Boolean);
}

// 분할금액 파싱: "₩2,400,000, ₩32,400,000" → [2400000, 32400000]
function pSplitAmounts(s) {
  return s.split(',').map(p => pa(p.trim()));
}

// 이슈 월 파싱: 실제입하일 또는 입하예정일
function pIssueMonth(r) {
  const d = (r['실제입하일'] || r['입하예정일'] || '');
  const m = d.match(/(\d{4})\.(\d{1,2})/);
  return m ? `${m[1]}.${parseInt(m[2])}` : null;
}
```

---

## 5. UI 섹션 구조

```
sidebar 네비게이션
├── 종합 현황 (overview)
│   ├── KPI 카드 5개 (발주TASK, 매입금액, 이슈건수, 긴급발주, 고객인지이슈)
│   ├── 월별 매입 추이 (Chart.js line)
│   ├── 이슈 유형 분포 (Chart.js doughnut)
│   ├── 담당자별 발주 (Chart.js bar)
│   ├── 월별 이슈 추이 (Chart.js line, 3색)
│   └── 제조유형 매입비중 (Chart.js doughnut)
├── 발주 현황 (order)
│   ├── 탭1: 발주량 Top 20 (Product Parts 필터)
│   ├── 탭2: Bottom 20 (미발주 포함, 비스포크 표시)
│   ├── 탭3: 프로젝트별 매입 Top 20 (분할합산)
│   └── 탭4: 발주빈도 Top 20
├── 매입 현황 (purchase)
│   ├── 협력사별 매입 Top 10 바 차트
│   ├── 제조유형 도넛 차트
│   └── 협력사별 매입 상세 Top 20 (비중 프로그레스바)
├── 이슈 현황 (issue)
│   ├── 탭: 전체 / 품질이슈 / 수량이슈 / 운영이슈
│   └── 각 탭: 해당 월 필터 테이블
├── 고객인지 이슈 (customer)
│   ├── 연도별 추이 바 차트
│   ├── 작성자별 건수 바 차트
│   └── 목록 테이블
├── 협력사 현황 (supplier)
│   ├── KPI: 총 협력사 / 턴키제작 / 단순구매
│   └── 협력사 목록 테이블 (실시간 검색)
├── AI 어시스턴트 (ai)
│   └── 규칙 기반 쿼리 분석 (analyzeQ)
└── 리포트 생성 (report)
    ├── 주간 리포트 .md 생성
    ├── KPI 요약 CSV 내보내기
    └── 외부 링크 모음
```

---

## 6. AI 어시스턴트 로직

외부 LLM API 없이 **규칙 기반**으로 동작합니다.

```javascript
function analyzeQ(q) {
  // 1. 협력사명 매칭: 업로드된 공급망_RAW 또는 발주_RAW의 수주처와 비교
  //    → 협력사 발주건수, 매입금액, 최근 3개월 추이, 품질이슈 카운트 반환
  //    → 품질이슈 3건 이상: "협력사 변경 검토 기준 도달" 경고 + 링크

  // 2. "긴급" 키워드 → 긴급 발주 목록 및 담당자별 집계

  // 3. "품질이슈 + 협력사" → 품질이슈 다발 담당 Top 5

  // 4. 담당자명 (육승미, 김민지 등) → 해당 월 발주 요약

  // 5. "전월/매입" → 전월 대비 매입금액 증감 비교

  // fallback: 안내 메시지
}
```

**담당자 목록** (하드코딩, 변경 시 수정 필요):
```javascript
const MGRS = ['육승미', '김민지', '남인호', '김하은', '이난영', '김민정', '김영준'];
```

---

## 7. 버전 관리 및 파일 구조

```
/외주생산파트 먼슬리리포트/
├── scm_dashboard_v1.html       ← 초기 버전 (보관)
├── scm_dashboard_v2.html       ← 현행 운영 버전
├── deploy_scmdashboard.ps1     ← Windows 배포 스크립트
├── deploy_scmdashboard.sh      ← Linux/Mac 배포 스크립트
├── AGENT_MONTHLY_REPORT.md     ← 월간 리포트 에이전트 설계서
├── CLAUDE.md                   ← 에이전트 핵심 지침
├── SCM_DASHBOARD_ARCHITECTURE.md ← 이 파일
└── ...월간 리포트 파일들...
```

**버전 규칙**: 로직 변경 시 `scm_dashboard_v3.html` 형식으로 새 파일 생성.  
이전 버전은 삭제 금지. 배포 스크립트는 최신 버전을 자동 탐색.

---

## 8. GitHub Pages 배포 방법

### Windows (PowerShell)
```powershell
cd "C:\Users\user\Documents\Claude\Projects\외주생산파트 먼슬리리포트"
.\deploy_scmdashboard.ps1
```

### 배포 스크립트 동작
1. `scm_dashboard_v*.html` 중 최신 파일 자동 탐색
2. `https://github.com/nanyounglee/SCMDASHBOARD.git` 클론/풀
3. `index.html`로 복사
4. `git add -A` → `git commit` → `git push`

**배포 URL**: https://nanyounglee.github.io/SCMDASHBOARD/

---

## 9. 주간 업데이트 절차 (팀원용)

```
1. Airtable에서 각 뷰 → CSV Export (4개 파일)
   - task-SCMKPI_Raw 뷰 → 발주_RAW
   - KPI_이슈_RAW 뷰 → 이슈_RAW
   - 공급망_RAW 뷰 → 공급망_RAW
   - 고객인지이슈_RAW 뷰 → 고객인지이슈_RAW

2. 브라우저에서 scm_dashboard_v2.html 열기 (로컬) 또는
   https://nanyounglee.github.io/SCMDASHBOARD/ 접속

3. 상단 업로드 영역에 4개 CSV 드래그&드롭

4. 우측 상단 업로드 일시 확인 → 원하는 월 칩 선택

5. (선택) .\deploy_scmdashboard.ps1 실행 → GitHub Pages 업데이트
```

---

## 10. 자주 발생하는 버그 및 해결

### Bug 1: 수치가 0으로 표시됨
**원인**: CSV 컬럼명이 변경됨  
**확인**: 브라우저 개발자도구(F12) → Console 탭에서 첫 번째 row 출력  
**해결**: HTML 소스에서 해당 컬럼명 검색 후 수정

### Bug 2: 월 칩이 안 생김
**원인**: 날짜 형식 불일치 (`2026-06-03` vs `2026.6.3`)  
**확인**: `pOrderMonth()`, `pIssueMonth()` 함수의 regex 패턴 확인  
**해결**: 에어테이블 날짜 필드 형식을 `YYYY.M.D` 형식으로 통일

### Bug 3: 매입금액 이중집계
**원인**: 분할 세금계산서 처리 오류  
**확인**: `purchaseByMonth()` 함수 디버깅 → 해당 row의 `합계_분할` 필드값 확인  
**해결**: `합계_분할` 필드가 에어테이블에 정확히 입력되었는지 확인

### Bug 4: 이슈건수가 KPI_DASHBOARD와 다름
**원인**: 복합 이슈카테고리 중복 카운트 또는 날짜 필터 기준 차이  
**확인**: 이슈_RAW CSV에서 해당 월 행을 수동으로 카운트하여 비교  
**해결**: `pIssueMonth()` 날짜 필터 기준(실제입하일 vs 입하예정일) 재검토

### Bug 5: 차트가 빈 상태
**원인**: Chart.js 로드 실패 (오프라인 환경) 또는 canvas ID 충돌  
**확인**: Network 탭에서 CDN 로드 상태 확인  
**해결**: Chart.js를 HTML에 인라인 번들링 (오프라인 필요 시)

---

## 11. 관련 링크 모음

| 리소스 | URL |
|---|---|
| SCM 대시보드 | https://nanyounglee.github.io/SCMDASHBOARD/ |
| 협력사 변경 대시보드 | https://nanyounglee.github.io/scm_vendor_change/ |
| 월간 리포트 | https://nanyounglee.github.io/scm-monthly-report/ |
| Sincerely-SCM GitHub | https://github.com/Sincerely-SCM |
| SCM_KPI 구글시트 | https://docs.google.com/spreadsheets/d/1rIAqlD18gwSTXY50BkXtz_kAJoDIkmmqZpfmFfl7yrQ |
| Airtable 하도급계약 | https://airtable.com/appAbBz1Y48qhpHwz/tbl5BjEkhn3CUMIlI/viwSUzY9yUXcbfYed |

---

## 12. 향후 추가 예정 기능

| 기능 | 상태 | 비고 |
|---|---|---|
| 파츠유형 직접 컬럼 | 에어테이블 작업 대기 | 추가되면 자동 적용 |
| 선매입재고 대시보드 | 미착수 | 별도 CSV 설계 필요 |
| S&OP 대시보드 | 미착수 | |
| 하도급법 관리 탭 | 미착수 | |
| 보관재고 대행 탭 | 미착수 | |
| 체크파이널 RAW 탭 | 미착수 | 5번째 CSV 업로드존 추가 |

---

*문서 기준: scm_dashboard_v2.html (2026-06-10)*  
*변경 시 이 문서도 함께 업데이트 바랍니다.*
