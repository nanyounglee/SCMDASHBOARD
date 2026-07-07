# =============================================================
# SCM 대시보드 v9(로컬) + v8(haeun.kim 원격) 병합 → v10 확정 배포 (1회용, PC에서 실행)
# 실행:  powershell -ExecutionPolicy Bypass -File .\merge_resolve_v10.ps1
#
# 배경
#  - 원격 main이 haeun.kim님의 커밋 5개(도넛차트 3종, 매입재고 대시보드,
#    GSheets 재고요약 3종 연동, sales_monthly 갱신)로 로컬보다 앞서 있었음.
#  - 그 사이 로컬 v9는 등급평가 반기환산+4단계(A/B/C/D), hasNoReceipt 리팩터,
#    재제작률 산출방식 변경 등 KPI 로직을 독자적으로 수정.
#  - 두 브랜치가 index.html의 겹치는 함수(포트폴리오 렌더, 재고 상세 모달)를
#    다르게 고쳐 자동 리베이스가 충돌 → 이 스크립트에서 3-way 병합을 마친
#    index.html(_merge_staging\index_v10_merged.html)을 원격 tip 위에
#    새 커밋 하나로 얹어 충돌 없이 푸시한다.
#
# 이 스크립트는 1회만 실행. 이후 정기 배포는 deploy_v10.ps1 사용.
# =============================================================
$ErrorActionPreference = "Stop"
Set-Location "C:\Users\user\Documents\Claude\Projects\SCMNEST\SCMDASHBOARD"

function Assert-Git { if ($LASTEXITCODE -ne 0) { throw "git 명령 실패 — 직전 단계를 확인하세요" } }

if (-not (Test-Path "_merge_staging\index_v10_merged.html")) {
  throw "_merge_staging\index_v10_merged.html 이 없습니다 — 병합 산출물이 준비되지 않았습니다."
}

# ── 0) git 자가진단/복구 ──────────────────────────────────────
if (Test-Path ".git\index.lock") {
  if (Get-Process git -ErrorAction SilentlyContinue) { throw "다른 git 프로세스 실행 중 — 종료 후 재시도" }
  Remove-Item ".git\index.lock" -Force
  Write-Host "복구: 잔류 index.lock 제거" -ForegroundColor Yellow
}

# ── 1) 원격 fetch 후 로컬을 원격 tip으로 정렬 ─────────────────
#     (미커밋 변경은 _merge_staging에 이미 백업되어 있으므로 안전)
git fetch origin; Assert-Git
Write-Host "원격 main 최신 커밋으로 정렬 중 (git reset --hard origin/main)..." -ForegroundColor Cyan
git reset --hard origin/main; Assert-Git

# ── 2) 병합본 반영 ────────────────────────────────────────────
Copy-Item "_merge_staging\index_v10_merged.html" "index.html" -Force
Write-Host "반영: index.html ← 병합본 (haeun 기능 + 로컬 v9 로직 모두 포함)"

if (Test-Path "_merge_staging\ARCHITECTURE_local.md") {
  Copy-Item "_merge_staging\ARCHITECTURE_local.md" "docs\SCM_DASHBOARD_ARCHITECTURE.md" -Force
  Write-Host "반영: docs\SCM_DASHBOARD_ARCHITECTURE.md ← 로컬 수정본 (원격 미변경분이라 충돌 없음)"
}

# ── 3) CSV 원본 → 영문 고정 파일명 복사 (원본 보존) ───────────
$map = @{
  "CSV\SCM_발주_RAW(2026).csv"              = "CSV\order.csv"
  "CSV\SCM_이슈_RAW(2026).csv"              = "CSV\issue.csv"
  "CSV\SCM_공급망_RAW(2026).csv"            = "CSV\sup.csv"
  "CSV\SCM_고객인지이슈_RAW(2026).csv"      = "CSV\ci.csv"
  "CSV\품절리스트_26.6.24.csv"              = "CSV\stockout_list.csv"
  "CSV\S&OP 대시보드_inventory_weekly.csv"  = "CSV\inv_weekly.csv"
  "CSV\S&OP 대시보드_sales_monthly.csv"     = "CSV\sales_monthly.csv"
}
foreach ($src in $map.Keys) {
  if (Test-Path $src) { Copy-Item $src $map[$src] -Force; Write-Host "복사: $($map[$src])" }
  else { Write-Warning "원본 없음(건너뜀): $src" }
}

# ── 4) 버전 정리: 기존 스냅샷 archive 이동 + v10 생성 ─────────
New-Item -ItemType Directory -Force -Path "archive" | Out-Null
if (Test-Path "scm_dashboard_v7.html") { Move-Item "scm_dashboard_v7.html" "archive\" -Force; Write-Host "정리: v7 → archive" }
if (Test-Path "scm_dashboard_v8.html") { Move-Item "scm_dashboard_v8.html" "archive\" -Force; Write-Host "정리: v8(haeun 원격 스냅샷) → archive" }
if (Test-Path "scm_dashboard_v9.html") { Move-Item "scm_dashboard_v9.html" "archive\" -Force; Write-Host "정리: v9(로컬 병합 전 스냅샷) → archive" }
Copy-Item "index.html" "scm_dashboard_v10.html" -Force
Write-Host "스냅샷: scm_dashboard_v10.html 생성 (haeun v8 + 로컬 v9 병합본)" -ForegroundColor Cyan

# ── 5) 배포 스크립트 정리 (v8/v9 → v10 단일화) ────────────────
if (Test-Path "deploy_v8.ps1") { Remove-Item "deploy_v8.ps1" -Force }
if (Test-Path "deploy_v9.ps1") { Remove-Item "deploy_v9.ps1" -Force }
Write-Host "정리: deploy_v8.ps1 / deploy_v9.ps1 제거 (이후 deploy_v10.ps1 사용)"

# ── 6) 커밋 & 푸시 ─────────────────────────────────────────────
git add -A; Assert-Git
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $msg = "merge: haeun 원격 v8(도넛차트·GSheets 재고요약 연동) + 로컬 v9(등급 반기환산·KPI 리팩터) 병합 → v10"
  git commit -m $msg; Assert-Git
  Write-Host "커밋: $msg"
} else {
  Write-Host "커밋할 변경 없음"
}
git push origin main; Assert-Git

Write-Host ""
Write-Host "완료. 1~3분 후: https://nanyounglee.github.io/SCMDASHBOARD/" -ForegroundColor Green
Write-Host "확인: 재고 카테고리 도넛차트(haeun 기능)와 협력사 등급 A/B/C/D 4단계(v9 기능)가 함께 보이면 병합 성공." -ForegroundColor Green
Write-Host "_merge_staging 폴더는 백업용이니 확인 후 삭제해도 됩니다." -ForegroundColor DarkGray
