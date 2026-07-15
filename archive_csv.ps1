# =============================================================
# CSV weekly archive script
# Usage: powershell -ExecutionPolicy Bypass -File .\archive_csv.ps1
#
# Workflow (run BEFORE dropping in this week's new CSV files):
#   1. Run this script — every *.csv currently in CSV\ is MOVED to
#      CSV_BANK\<ISO-year>_W<ISO-week>\  (week taken from each file's
#      last-modified time, i.e. the week it was uploaded)
#   2. Copy the new CSV exports into CSV\ (same filenames as before:
#      order.csv, issue.csv, sup.csv, ci.csv, ...)
#   3. Deploy as usual (deploy_v13.ps1)
#
# _manifest.json stays in CSV\ (it maps dataset keys to filenames and
# is not a data file). CSV_BANK IS committed to git (v13): the dashboard
# falls back to CSV_BANK/<year>_W<week>/ when comparing weekly progress
# files, so the archive must be deployed with the site.
#
# v14: also saves CSV_BANK/sup_YYYY_MM.csv (one snapshot per calendar month)
# so the 월간 공지사항 card can show 신규/거래종료 협력사 month over month.
# =============================================================
$ErrorActionPreference = "Stop"
Set-Location "C:\Users\user\Documents\Claude\Projects\SCMNEST\SCMDASHBOARD"

# ISO-8601 week via the Thursday rule (works on Windows PowerShell 5.1)
function Get-IsoWeekFolder([datetime]$d) {
  $offset = ([int]$d.DayOfWeek + 6) % 7          # Monday = 0 ... Sunday = 6
  $thu = $d.Date.AddDays(3 - $offset)            # Thursday of that ISO week
  $week = [int][math]::Floor(($thu.DayOfYear - 1) / 7) + 1
  return "{0}_W{1:D2}" -f $thu.Year, $week
}

$csvDir  = "CSV"
$bankDir = "CSV_BANK"
if (-not (Test-Path $csvDir)) { throw "CSV folder not found: $csvDir" }
New-Item -ItemType Directory -Force -Path $bankDir | Out-Null

# --- Vendor (sup.csv) monthly snapshot ---
# Copies today's outgoing CSV\sup.csv into CSV_BANK\sup_YYYY_MM.csv (keyed by the
# file's own last-modified month) BEFORE it gets moved/replaced below, so the
# dashboard can diff "이번 달 신규/거래종료 협력사" month over month. Skips if a
# snapshot for that month already exists (keeps the earliest known state of the
# month instead of clobbering it if this script is re-run mid-month).
$supFile = Join-Path $csvDir "sup.csv"
if (Test-Path $supFile) {
  $supInfo = Get-Item $supFile
  $supYm = "{0}_{1:D2}" -f $supInfo.LastWriteTime.Year, $supInfo.LastWriteTime.Month
  $supSnapshot = Join-Path $bankDir ("sup_{0}.csv" -f $supYm)
  if (-not (Test-Path $supSnapshot)) {
    Copy-Item $supFile $supSnapshot
    Write-Host ("Vendor monthly snapshot saved: {0}" -f $supSnapshot) -ForegroundColor Cyan
  } else {
    Write-Host ("Vendor monthly snapshot already exists for {0}, skipped." -f $supYm) -ForegroundColor DarkGray
  }
}

$files = Get-ChildItem $csvDir -Filter "*.csv" -File
if (-not $files) {
  Write-Host "Nothing to archive - CSV folder has no .csv files." -ForegroundColor Yellow
  Write-Host "Drop this week's new CSV files into CSV\ now."
  exit 0
}

function Move-ToBank([System.IO.FileInfo]$f, [string]$weekFolder) {
  $destDir = Join-Path $bankDir $weekFolder
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  $dest = Join-Path $destDir $f.Name
  if (Test-Path $dest) {
    # same filename already archived for that week - keep both, suffix with timestamp
    $stamp = $f.LastWriteTime.ToString("yyyyMMdd_HHmmss")
    $dest = Join-Path $destDir ("{0}_{1}{2}" -f $f.BaseName, $stamp, $f.Extension)
  }
  Move-Item $f.FullName $dest
  Write-Host ("Archived: {0}  ->  {1}" -f $f.Name, $dest)
}

$moved = 0
# 1) Weekly-named files (progress_YYYY_Www.csv / project_YYYY_Www.csv):
#    keep only the NEWEST week per prefix in CSV\; older ones move to
#    CSV_BANK\<year>_W<week>\ using the week from the FILENAME.
#    (The dashboard compares this week vs last week and falls back to
#     CSV_BANK for the previous file, so CSV_BANK must stay committed.)
$weeklyPattern = '^(progress|project)_(\d{4})_W(\d{2})\.csv$'
$weekly = $files | Where-Object { $_.Name -match $weeklyPattern }
foreach ($grp in ($weekly | Group-Object { ($_.Name -split '_')[0] })) {
  $sorted = $grp.Group | Sort-Object Name -Descending   # name sort = week sort (zero-padded)
  foreach ($f in ($sorted | Select-Object -Skip 1)) {
    $null = $f.Name -match $weeklyPattern
    Move-ToBank $f ("{0}_W{1}" -f $Matches[2], $Matches[3])
    $moved++
  }
  Write-Host ("Kept latest {0} file: {1}" -f $grp.Name, $sorted[0].Name) -ForegroundColor Cyan
}

# 2) All other CSVs: move everything, archived by upload week (LastWriteTime)
foreach ($f in ($files | Where-Object { $_.Name -notmatch $weeklyPattern })) {
  if (-not (Test-Path $f.FullName)) { continue }
  Move-ToBank $f (Get-IsoWeekFolder $f.LastWriteTime)
  $moved++
}

Write-Host ""
Write-Host ("Done. {0} file(s) moved to {1}\." -f $moved, $bankDir) -ForegroundColor Green
Write-Host "NEXT STEP: copy this week's new CSV exports into CSV\ (same filenames)," -ForegroundColor Cyan
Write-Host "then run deploy_v13.ps1. The dashboard auto-load reads CSV\ on page load." -ForegroundColor Cyan
