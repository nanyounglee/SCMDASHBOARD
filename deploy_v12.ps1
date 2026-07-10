# =============================================================
# SCM Dashboard deploy script v12 (run on PC)
# Run: powershell -ExecutionPolicy Bypass -File .\deploy_v12.ps1
#
# Note: due to a sandbox file-sync issue during this session, a file
# named scm_dashboard_v11.html ended up containing v12 content
# (index.html correctly has v12). v11 was never pushed separately,
# so no version history is lost. This script cleans up the naming,
# creates the correctly-named scm_dashboard_v12.html snapshot, then
# commits and pushes.
# =============================================================
$ErrorActionPreference = "Stop"
Set-Location "C:\Users\user\Documents\Claude\Projects\SCMNEST\SCMDASHBOARD"

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

# 1) Fix version file naming
New-Item -ItemType Directory -Force -Path "archive" | Out-Null
if (Test-Path "scm_dashboard_v11.html") {
  $sameAsIndex = (Get-FileHash "index.html").Hash -eq (Get-FileHash "scm_dashboard_v11.html").Hash
  if ($sameAsIndex) {
    Remove-Item "scm_dashboard_v11.html" -Force
    Write-Host "Cleaned up: removed scm_dashboard_v11.html (identical to index.html = actually v12)" -ForegroundColor Yellow
  } else {
    Move-Item "scm_dashboard_v11.html" "archive\scm_dashboard_v11.html" -Force
    Write-Host "Archived: scm_dashboard_v11.html -> archive (content differs from index.html, kept)" -ForegroundColor Yellow
  }
}
# Move any other stray version snapshots in root to archive
Get-ChildItem "." -Filter "scm_dashboard_v*.html" -File | Where-Object { $_.Name -ne "scm_dashboard_v12.html" } | ForEach-Object {
  Move-Item $_.FullName "archive\" -Force
  Write-Host "Archived: $($_.Name) -> archive" -ForegroundColor Yellow
}
Copy-Item "index.html" "scm_dashboard_v12.html" -Force
Write-Host "Snapshot created: scm_dashboard_v12.html" -ForegroundColor Cyan

# 1b) Archive old docs (v10 logic doc / user guide) now superseded by v12 docs
# (use a wildcard match on the ASCII "_v10." suffix instead of spelling the Korean
#  filenames here, to avoid any PowerShell console encoding/codepage risk)
New-Item -ItemType Directory -Force -Path "docs\archive" | Out-Null
Get-ChildItem "docs" -Filter "*_v10.html" -File -ErrorAction SilentlyContinue | ForEach-Object {
  Move-Item $_.FullName "docs\archive\" -Force
  Write-Host "Archived: docs/$($_.Name) -> docs/archive" -ForegroundColor Yellow
}
Get-ChildItem "docs" -Filter "*_v10.pdf" -File -ErrorAction SilentlyContinue | ForEach-Object {
  Move-Item $_.FullName "docs\archive\" -Force
  Write-Host "Archived: docs/$($_.Name) -> docs/archive" -ForegroundColor Yellow
}

# 1c) Remove obsolete deploy/merge scripts (superseded by this script)
$oldScripts = @("deploy_v10.ps1", "merge_resolve_v10.ps1")
foreach ($s in $oldScripts) {
  if (Test-Path $s) {
    Remove-Item $s -Force
    Write-Host "Removed obsolete script: $s" -ForegroundColor Yellow
  }
}

# 1d) Remove one-time v10 merge staging folder (no longer needed)
if (Test-Path "_merge_staging") {
  Remove-Item "_merge_staging" -Recurse -Force
  Write-Host "Removed obsolete folder: _merge_staging" -ForegroundColor Yellow
}

# 2) Commit
git add -A; Assert-Git
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $msg = "v12: order detail (no-order status + DB cost compare) / portfolio switched to QCD-relationship tier / supplier detail yearly trend + issues / product x supplier issue rate / product order-qty trend / KPI targets synced / docs updated to v12 + removed obsolete deploy files $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
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
Write-Host "Check: sidebar should show 'SCM.. v12'." -ForegroundColor Green
