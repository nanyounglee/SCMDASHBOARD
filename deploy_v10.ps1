# =============================================================
# SCM 대시보드 배포 스크립트 v10 (PC에서 실행) — 이후 정기 배포용
# 실행이 막히면:  powershell -ExecutionPolicy Bypass -File .\deploy_v10.ps1
# 배포 후 자동검증까지: powershell -ExecutionPolicy Bypass -File .\deploy_v10.ps1 -Verify
#
# v8/v9 스크립트와 로직 동일(자가진단, 버전 자동카운트, rebase 동기화, -Verify).
# 파일명만 v10으로 단일화 — merge_resolve_v10.ps1로 원격(haeun)·로컬(v9) 병합을
# 마친 뒤부터는 이 스크립트로 정기 배포한다.
# =============================================================
param([switch]$Verify)
$ErrorActionPreference = "Stop"
Set-Location "C:\Users\user\Documents\Claude\Projects\SCMNEST\SCMDASHBOARD"

function Assert-Git { if ($LASTEXITCODE -ne 0) { throw "git 명령 실패 — 직전 단계를 확인하세요" } }

# ── 0) git 저장소 자가진단/복구 ──────────────────────────────
if (Test-Path ".git\index.lock") {
  if (Get-Process git -ErrorAction SilentlyContinue) {
    throw "다른 git 프로세스가 실행 중입니다. 종료 후 다시 실행하세요."
  }
  Remove-Item ".git\index.lock" -Force
  Write-Host "복구: 잔류 index.lock 제거" -ForegroundColor Yellow
}
git status --porcelain *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "git index 손상 감지 → 재생성"
  Remove-Item ".git\index" -Force -ErrorAction SilentlyContinue
  git reset --quiet
  git status --porcelain *> $null
  if ($LASTEXITCODE -ne 0) { throw "index 자동복구 실패 — 수동 확인 필요" }
  Write-Host "복구: index 재생성 완료" -ForegroundColor Yellow
}

# ── 1) 현재 CSV → 영문 고정 파일명 복사 (원본 보존) ──────────
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

# ── 2) 버전 스냅샷 (자동 카운트) ─────────────────────────────
New-Item -ItemType Directory -Force -Path "archive" | Out-Null
$nums = @(Get-ChildItem ".", "archive" -Filter "scm_dashboard_v*.html" -File |
  ForEach-Object { if ($_.BaseName -match '_v(\d+)$') { [int]$Matches[1] } })
$cur = 0
if ($nums.Count -gt 0) { $cur = ($nums | Measure-Object -Maximum).Maximum }
$latest = "scm_dashboard_v$cur.html"
if (($cur -gt 0) -and (Test-Path $latest) -and
    ((Get-FileHash "index.html").Hash -eq (Get-FileHash $latest).Hash)) {
  Write-Host "index.html = v$cur 스냅샷과 동일 → 버전 유지 (v$cur)"
} else {
  $new = $cur + 1
  if (Test-Path $latest) { Move-Item $latest "archive\" -Force }
  Copy-Item "index.html" "scm_dashboard_v$new.html" -Force
  Write-Host "스냅샷: scm_dashboard_v$new.html 생성 (이전 v$cur → archive)" -ForegroundColor Cyan
}

# ── 3) 커밋 ─────────────────────────────────────────────────
git add -A; Assert-Git
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $msg = "deploy: 대시보드 갱신 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  git commit -m $msg; Assert-Git
  Write-Host "커밋: $msg"
} else {
  Write-Host "커밋할 변경 없음 — 계속 진행"
}

# ── 4) 원격 동기화 (안전: 원격 최신을 덮어쓰지 않음) ─────────
git fetch origin; Assert-Git
$local  = git rev-parse HEAD
$remote = git rev-parse origin/main
$base   = git merge-base HEAD origin/main
if ($remote -eq $local) {
  Write-Host "원격과 동일 — 푸시할 내용 없음"
} elseif ($base -eq $remote) {
  # 로컬이 앞섬 → 그대로 푸시
} elseif ($base -eq $local) {
  Write-Host "원격이 앞서 있음 → rebase로 최신 반영 후 푸시"
  git rebase origin/main; Assert-Git
} else {
  Write-Host "로컬/원격 분기 감지 → rebase 시도"
  git rebase origin/main
  if ($LASTEXITCODE -ne 0) {
    git rebase --abort
    throw "충돌 발생: 원격에 로컬에 없는 변경이 있습니다. 'git log HEAD..origin/main'으로 확인 후 수동 해결하세요(다른 팀원이 동시에 수정 중일 수 있음)."
  }
}
git push origin main; Assert-Git

# ── 5) 배포 확인 ─────────────────────────────────────────────
Write-Host ""
Write-Host "완료. 1~3분 후: https://nanyounglee.github.io/SCMDASHBOARD/" -ForegroundColor Green
Write-Host "확인: 페이지 소스에 autoLoadRaw / order.csv 가 있으면 정상 배포." -ForegroundColor Green

if ($Verify) {
  Write-Host "90초 대기 후 배포 자동검증..." -ForegroundColor Cyan
  Start-Sleep -Seconds 90
  try {
    $html = (Invoke-WebRequest "https://nanyounglee.github.io/SCMDASHBOARD/index.html?nocache=$(Get-Random)" -UseBasicParsing).Content
    if ($html -match 'autoLoadRaw') {
      Write-Host "검증 성공: autoLoadRaw 포함 — 최신 버전 배포 확인" -ForegroundColor Green
    } else {
      Write-Warning "autoLoadRaw 미발견 — Pages 빌드 지연 가능. 2~3분 후 브라우저에서 Ctrl+F5로 확인하세요."
    }
  } catch {
    Write-Warning "검증 요청 실패: $($_.Exception.Message) — 잠시 후 브라우저로 확인하세요."
  }
}
