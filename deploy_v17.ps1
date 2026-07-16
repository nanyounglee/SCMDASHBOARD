# =============================================================
# SCM Dashboard deploy script v17 (run on PC)
# Run: powershell -ExecutionPolicy Bypass -File .\deploy_v17.ps1
# =============================================================
$ErrorActionPreference = "Stop"
# Resolve to the repo root (this script's own folder) so it works on any machine
# without editing a hardcoded path (previously flipped between collaborators).
Set-Location $PSScriptRoot

function Assert-Git { if ($LASTEXITCODE -ne 0) { throw "git command failed - check the previous step" } }

# 0) git repo self-check / recovery
if (Test-Path ".git\index.lock") {
  if (Get-Process git -ErrorAction SilentlyContinue) {
    throw "Another git process is running. Close it and try again."
  }
  Remove-Item ".git\index.lock" -Force
  Write-Host "Recovered: removed leftover index.lock" -ForegroundColor Yellow
}
git status --porcelain *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "git index looks corrupted -> rebuilding"
  Remove-Item ".git\index" -Force -ErrorAction SilentlyContinue
  git reset --quiet
  git status --porcelain *> $null
  if ($LASTEXITCODE -ne 0) { throw "Automatic index recovery failed - manual check needed" }
  Write-Host "Recovered: index rebuilt" -ForegroundColor Yellow
}

# 1) Version snapshot housekeeping
New-Item -ItemType Directory -Force -Path "archive" | Out-Null
# Move any older version snapshots in root to archive (keep only v17)
Get-ChildItem "." -Filter "scm_dashboard_v*.html" -File | Where-Object { $_.Name -ne "scm_dashboard_v17.html" } | ForEach-Object {
  Move-Item $_.FullName "archive\" -Force
  Write-Host "Archived: $($_.Name) -> archive" -ForegroundColor Yellow
}
Copy-Item "index.html" "scm_dashboard_v17.html" -Force
Write-Host "Snapshot created: scm_dashboard_v17.html" -ForegroundColor Cyan

# 1b) Archive superseded v16 docs
New-Item -ItemType Directory -Force -Path "docs\archive" | Out-Null
Get-ChildItem "docs" -Filter "*_v16.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
  Move-Item $_.FullName "docs\archive\" -Force
  Write-Host "Archived: docs/$($_.Name) -> docs/archive" -ForegroundColor Yellow
}
if (Test-Path "docs\CHANGELOG_v16.md") {
  Move-Item "docs\CHANGELOG_v16.md" "docs\archive\" -Force
  Write-Host "Archived: docs/CHANGELOG_v16.md -> docs/archive" -ForegroundColor Yellow
}

# 1c) Remove obsolete deploy script (superseded by this one)
if (Test-Path "deploy_v16.ps1") {
  Remove-Item "deploy_v16.ps1" -Force
  Write-Host "Removed obsolete script: deploy_v16.ps1" -ForegroundColor Yellow
}

# 2) Commit
git add -A; Assert-Git
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $msg = "v17 update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  git commit -m $msg; Assert-Git
  Write-Host "Committed: $msg"
} else {
  Write-Host "Nothing to commit - continuing"
}

# 3) Sync with remote (safe: never overwrites remote history)
git fetch origin; Assert-Git
$local  = git rev-parse HEAD
$remote = git rev-parse origin/main
$base   = git merge-base HEAD origin/main
if ($remote -eq $local) {
  Write-Host "Already up to date with remote - nothing to push"
} elseif ($base -eq $remote) {
  # local is ahead -> push as is
} elseif ($base -eq $local) {
  Write-Host "Remote is ahead -> rebasing onto latest before push"
  git rebase origin/main; Assert-Git
} else {
  Write-Host "Local/remote have diverged -> attempting rebase"
  git rebase origin/main
  if ($LASTEXITCODE -ne 0) {
    git rebase --abort
    throw "Conflict detected: remote has changes not in local. Check 'git log HEAD..origin/main' and resolve manually."
  }
}
git push origin main; Assert-Git

# 4) Confirm
Write-Host ""
Write-Host "Done. In 1-3 minutes: https://nanyounglee.github.io/SCMDASHBOARD/" -ForegroundColor Green
Write-Host "Check: sidebar should show 'SCM.. v17'. On 협력사 현황, confirm the new '협력사 변경 검토 진행 현황' card (above 협력사 목록) loads live counts (전환검토중/확정/완료) and a recent-completed-changes table from scm_vendor_change's bank/ data, and clicking the card opens https://nanyounglee.github.io/scm_vendor_change/ in a new tab." -ForegroundColor Green
