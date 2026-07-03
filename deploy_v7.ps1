# =============================================================
# SCM 대시보드 v7 배포 스크립트 (PC에서 실행)
# 실행이 막히면:  powershell -ExecutionPolicy Bypass -File .\deploy_v7.ps1
# =============================================================
$ErrorActionPreference = "Stop"
Set-Location "C:\Users\user\Documents\Claude\Projects\SCMNEST\SCMDASHBOARD"

# 1) 현재 CSV → 영문 고정 파일명 복사 (원본 보존)
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

# 2) 버전 스냅샷
if (Test-Path "scm_dashboard_v6.html") {
  New-Item -ItemType Directory -Force -Path "archive" | Out-Null
  Move-Item "scm_dashboard_v6.html" "archive\" -Force
}
Copy-Item "index.html" "scm_dashboard_v7.html" -Force

# 3) 커밋
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "v7: CSV 파서(멀티라인)·굿즈코드/의도적품절/재고 폴백·자동로드+고정파일명·문서 갱신"
} else {
  Write-Host "커밋할 변경 없음(이미 커밋됨) — 계속 진행"
}

# 4) 원격이 앞서 있어도(웹 수동 업로드) 로컬 v7을 우선하여 병합 후 푸시 (비파괴)
git fetch origin
git merge -s ours origin/main -m "merge: v7 우선(원격 수동 업로드분 병합)" --allow-unrelated-histories
git push origin main

Write-Host ""
Write-Host "완료. 1~3분 후: https://nanyounglee.github.io/SCMDASHBOARD/" -ForegroundColor Green
Write-Host "확인: 페이지 소스에 autoLoadRaw / order.csv 가 있으면 v7 정상 배포." -ForegroundColor Green
