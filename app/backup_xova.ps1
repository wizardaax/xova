# backup_xova.ps1
# Nightly mirror of the local-only state across the Xova/Jarvis stack.
#
# What it backs up:
#   - C:\Xova                       (entire tree -- NOT a git repo, fully local)
#   - C:\jarvis\src                 (in case of uncommitted changes)
#   - jarvis.db                     (the SQLite memory graph + voice profile)
#   - .config\jarvis\               (configuration)
#   - .local\share\jarvis\          (knowledge graph, voice profile, prompt dumps)
#   - D:\.claude\projects\C--Users-adz-7\ (Claude session transcripts + auto-memory)
#
# What it skips (explicitly excluded -- reproducible from source):
#   - node_modules, .venv, target, dist, htmlcov, __pycache__, *.pdb, *.lib
#
# Where it goes:
#   Local:        D:\Xova-backups\<yyyy-MM-dd>\          (last 7 daily + 4 weekly)
#   Google Drive: G:\My Drive\Xova-backups\<yyyy-MM-dd>\ (synced to cloud)
#                 G:\My Drive\Xova-backups\Latest\       (always-newest mirror)
#
# To install as a scheduled task:
#   schtasks /create /tn "XovaBackup" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Xova\app\backup_xova.ps1" /sc daily /st 03:00 /f
#
# To run on demand:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Xova\app\backup_xova.ps1

$ErrorActionPreference = "Continue"
$LogFile = "$env:TEMP\xova-backup.log"
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Tee-Object -FilePath $LogFile -Append | Out-Host }

$Stamp     = Get-Date -Format "yyyy-MM-dd"
$BackupRoot = "D:\Xova-backups"
$Dest      = Join-Path $BackupRoot $Stamp

if (-not (Test-Path $BackupRoot)) {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
}

Log "=== Xova backup starting -> $Dest ==="

# Robocopy options:
#   /MIR  -- mirror (delete extras at destination)
#   /XD   -- exclude these directories at any level
#   /XF   -- exclude these file patterns
#   /R:1  -- retry once on locked files (don't hang on running xova.exe)
#   /W:1  -- wait 1s between retries
#   /NP   -- no progress output (less log noise)
#   /NJH /NJS -- no job header / summary in log
$ExcludeDirs = @("node_modules", ".venv", "target", "dist", "htmlcov", "__pycache__", ".turbo", ".next", "build")
$ExcludeFiles = @("*.pdb", "*.lib", "*.tmp", "*.log")

# 1. C:\Xova
Log "[1/5] C:\Xova -> $Dest\Xova"
robocopy "C:\Xova" "$Dest\Xova" /MIR /R:1 /W:1 /NP /NJH /NJS `
    /XD $ExcludeDirs `
    /XF $ExcludeFiles | Out-Null
Log "    robocopy exit=$LASTEXITCODE (0/1/2/3 are success)"

# 2. C:\jarvis source (its .git is backed up; src/ catches uncommitted)
Log "[2/5] C:\jarvis\src -> $Dest\jarvis-src"
robocopy "C:\jarvis\src" "$Dest\jarvis-src" /MIR /R:1 /W:1 /NP /NJH /NJS `
    /XD $ExcludeDirs `
    /XF $ExcludeFiles | Out-Null
Log "    robocopy exit=$LASTEXITCODE"

# 3. jarvis.db (SQLite memory graph)
$JarvisDb = "C:\Users\adz_7\.local\share\jarvis\jarvis.db"
if (Test-Path $JarvisDb) {
    Log "[3/5] jarvis.db -> $Dest\"
    Copy-Item $JarvisDb "$Dest\jarvis.db" -Force
    $size = [math]::Round((Get-Item "$Dest\jarvis.db").Length / 1KB, 1)
    Log "    copied ($size KB)"
} else {
    Log "[3/5] jarvis.db not found at $JarvisDb -- skipped"
}

# 4. .config\jarvis (config.json etc.)
$ConfigDir = "C:\Users\adz_7\.config\jarvis"
if (Test-Path $ConfigDir) {
    Log "[4/5] $ConfigDir -> $Dest\config-jarvis"
    robocopy $ConfigDir "$Dest\config-jarvis" /MIR /R:1 /W:1 /NP /NJH /NJS | Out-Null
    Log "    robocopy exit=$LASTEXITCODE"
} else {
    Log "[4/5] $ConfigDir not found -- skipped"
}

# 5. .local\share\jarvis (everything else: voice profile, prompt dumps, etc.)
$LocalShare = "C:\Users\adz_7\.local\share\jarvis"
if (Test-Path $LocalShare) {
    Log "[5/7] $LocalShare -> $Dest\local-share-jarvis"
    robocopy $LocalShare "$Dest\local-share-jarvis" /MIR /R:1 /W:1 /NP /NJH /NJS `
        /XF "jarvis.db" | Out-Null  # already copied above
    Log "    robocopy exit=$LASTEXITCODE"
}

# 6. Claude conversation transcripts + auto-memory (build context for future sessions)
$ClaudeDir = "D:\.claude\projects\C--Users-adz-7"
if (Test-Path $ClaudeDir) {
    Log "[6/7] $ClaudeDir -> $Dest\claude-sessions"
    robocopy $ClaudeDir "$Dest\claude-sessions" /MIR /R:1 /W:1 /NP /NJH /NJS `
        /XD "shell-snapshots" "todos" "ide" | Out-Null
    Log "    robocopy exit=$LASTEXITCODE"
} else {
    Log "[6/7] $ClaudeDir not found -- skipped"
}

# 7. Mirror to Google Drive Desktop (auto-syncs to cloud)
$GDrive = "G:\My Drive\Xova-backups"
if (Test-Path "G:\My Drive") {
    Log "[7/7] mirror to Google Drive: G:\My Drive\Xova-backups\$Stamp"
    if (-not (Test-Path $GDrive)) { New-Item -ItemType Directory -Path $GDrive -Force | Out-Null }
    # Only push the latest day's tree to Google Drive; on cloud we keep the
    # rolling /Latest pointer (mirror) plus a dated archive.
    robocopy $Dest "$GDrive\Latest" /MIR /R:1 /W:1 /NP /NJH /NJS | Out-Null
    Log "    Latest mirror exit=$LASTEXITCODE"
    # Also keep a date-stamped snapshot for history (smaller, in case sync corrupts Latest)
    $GDateDir = Join-Path $GDrive $Stamp
    robocopy $Dest $GDateDir /MIR /R:1 /W:1 /NP /NJH /NJS | Out-Null
    Log "    dated snapshot exit=$LASTEXITCODE -> $GDateDir"
} else {
    Log "[7/7] G:\My Drive not present -- Google Drive Desktop sync skipped"
}

# Calculate total backup size
$TotalMb = [math]::Round((Get-ChildItem $Dest -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Log "=== Backup complete: $TotalMb MB at $Dest ==="

# --- Retention: keep last 7 daily + 4 weekly ---
$AllBackups = @(Get-ChildItem $BackupRoot -Directory | Sort-Object Name -Descending)
$KeepDaily  = @($AllBackups | Select-Object -First 7)
$Weekly     = @()
foreach ($b in $AllBackups | Select-Object -Skip 7) {
    # Keep Sundays from older backups for "weekly" snapshots (up to 4)
    try {
        $d = [DateTime]::ParseExact($b.Name, 'yyyy-MM-dd', $null)
        if ($d.DayOfWeek -eq 'Sunday' -and $Weekly.Count -lt 4) {
            $Weekly += $b
        }
    } catch {}
}
# Force both sides to arrays before concatenation; PowerShell collapses
# single-element collections to a scalar otherwise and `+` blows up.
$KeepNames = @($KeepDaily | ForEach-Object Name) + @($Weekly | ForEach-Object Name) | Select-Object -Unique
$Keep = $AllBackups | Where-Object { $KeepNames -contains $_.Name }
foreach ($b in $AllBackups) {
    if ($Keep -notcontains $b) {
        Log "pruning old backup: $($b.Name)"
        Remove-Item $b.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Log "retention: keeping $($Keep.Count) backup(s) -- $((($Keep | ForEach-Object Name) -join ', '))"
Log "=== Done ==="
