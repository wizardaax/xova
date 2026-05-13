# start_xova.ps1 - Xova launcher (no-rebuild path, fully hidden)
# Equivalent to start_xova.bat but produces zero visible terminal.
# Invoke via start_xova.vbs (WScript.Shell Run with window style 0).
#
# Does NOT call cargo build / npm run tauri build / npm run tauri dev.
# Only starts the existing target\debug\xova.exe + Vite dev server.

$ErrorActionPreference = "SilentlyContinue"

$AppDir      = Join-Path $PSScriptRoot "app"
$ExePath     = Join-Path $PSScriptRoot "app\src-tauri\target\debug\xova.exe"
$LogFile     = "C:\Xova\memory\vite.log"
$LauncherLog = "C:\Xova\memory\launcher.log"

# Ensure log directory exists
$LogDir = Split-Path $LogFile -Parent
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# Enrich PATH from registry — VBS launches with a minimal system PATH that
# lacks user-profile entries (nodejs, Python, Git, cargo, etc.) which causes
# Vite's node_modules chain to fail silently. Reading Machine + User from the
# registry is authoritative and stays correct without hardcoding any paths.
$machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$userPath    = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if ($machinePath -or $userPath) {
    $env:PATH = "$machinePath;$userPath"
}

# Startup banner - time + full PATH so cold-boot env problems are visible
Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] LAUNCH START"
Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] PATH=$env:PATH"

# 0. Patch xova.exe PE subsystem CUI->GUI if needed.
#    The debug binary is compiled as a console-subsystem (CUI) exe because
#    #![windows_subsystem="windows"] is gated on !debug_assertions. CUI means
#    Windows creates a black console window on every launch before any
#    CREATE_NO_WINDOW flag can stop it. Patching 2 bytes in the PE header
#    (same field the Rust attribute sets at compile time) fixes it permanently
#    until the next cargo build, at which point this code re-patches.
#    xova.exe is not running at this point so no file-lock issue.
if (Test-Path $ExePath) {
    $bytes = [System.IO.File]::ReadAllBytes($ExePath)
    $peOffset        = [System.BitConverter]::ToInt32($bytes, 0x3C)
    $subsystemOffset = $peOffset + 0x5C
    $subsystem       = [System.BitConverter]::ToUInt16($bytes, $subsystemOffset)
    if ($subsystem -eq 3) {
        $bytes[$subsystemOffset]     = 2
        $bytes[$subsystemOffset + 1] = 0
        [System.IO.File]::WriteAllBytes($ExePath, $bytes)
        Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] patched xova.exe PE subsystem 3->2 (CUI->GUI)"
    }
}

# 1. Check if Vite is already up on :5174 before starting a second instance
$viteUp = $false
try {
    $req = [System.Net.WebRequest]::Create("http://localhost:5174/")
    $req.Timeout = 1000
    $res = $req.GetResponse()
    $res.Close()
    $viteUp = $true
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] Vite already up on :5174 - skipping npm start"
} catch {}

if (-not $viteUp) {
    # Start Vite dev server directly via node.exe — no cmd.exe wrapper.
    # Hidden cmd.exe with /c kills the entire child process tree on exit,
    # taking Vite with it. Direct node launch (pythonw-style) keeps Vite
    # alive as a detached child owned by session 0 / the desktop window station.
    try {
        $viteJs  = Join-Path $AppDir "node_modules\vite\bin\vite.js"
        $psiVite = New-Object System.Diagnostics.ProcessStartInfo
        $psiVite.FileName         = "C:\Program Files\nodejs\node.exe"
        $psiVite.Arguments        = "`"$viteJs`""
        $psiVite.WorkingDirectory = $AppDir
        $psiVite.UseShellExecute  = $false
        $psiVite.CreateNoWindow   = $true
        $npmProc = [System.Diagnostics.Process]::Start($psiVite)
        if ($npmProc -and $npmProc.Id) {
            Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] node vite.js OK - PID $($npmProc.Id)"
        } else {
            Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] node vite.js FAILED - no process returned"
        }
    } catch {
        Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] node vite.js EXCEPTION - $_"
    }

    # 2. Wait for Vite to respond on localhost:5174 (max 30s)
    $tries = 0
    while ($tries -lt 30) {
        Start-Sleep -Seconds 1
        try {
            $req = [System.Net.WebRequest]::Create("http://localhost:5174/")
            $req.Timeout = 2000
            $res = $req.GetResponse()
            $res.Close()
            $viteUp = $true
            break
        } catch {}
        $tries++
    }

    if (-not $viteUp) {
        Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] WARNING: Vite not up after 30s - launching xova.exe anyway"
    }
}

# 3. Start lifecycle watchdog (manages jarvis daemon + mesh_runner lifespan).
# Singleton check: skip launch if a watchdog is already running so we never
# accumulate multiple watchdog instances across successive launcher invocations.
$watchdogRunning = Get-CimInstance Win32_Process -Filter "name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*xova_watchdog*" }
if ($watchdogRunning) {
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] watchdog already running (PID $($watchdogRunning | Select-Object -First 1 -ExpandProperty ProcessId)) - skipping launch"
} else {
    Start-Process -FilePath "pythonw.exe" `
        -ArgumentList "C:\Xova\xova_watchdog.py" `
        -WorkingDirectory "C:\Xova" `
        -WindowStyle Hidden
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] watchdog launched"
}

# 5. Launch xova.exe - subsystem is now GUI so no console window will appear.
$xovaProc = Get-Process -Name "xova" -ErrorAction SilentlyContinue
if ($xovaProc) {
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] xova.exe already running (PID $($xovaProc.Id)) - skipping launch"
} else {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName         = $ExePath
    $psi.WorkingDirectory = $AppDir
    $psi.UseShellExecute  = $false
    $psi.CreateNoWindow   = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null
}

# 6. Launch the 13-agent_runtime fleet (singleton-checked).
# Without this, agent_runtime daemons don't auto-restore after reboot —
# only the 5 watchdog-managed daemons (mesh_runner/forge_listener/absorb_loop/
# coherence_sentinel/jarvis) come back automatically. start_agent_fleet.py
# is idempotent: it skips agents already alive and only launches missing ones.
# Added 2026-05-14 per Adam: "the app has to remember — that's the point of context".
$fleetAlive = Get-CimInstance Win32_Process -Filter "name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*agent_runtime.py*" }
$fleetCount = if ($fleetAlive) { @($fleetAlive).Count } else { 0 }
if ($fleetCount -ge 13) {
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] agent fleet already alive ($fleetCount/13) - skipping launch"
} else {
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] launching agent fleet ($fleetCount/13 currently alive)"
    Start-Process -FilePath "pythonw.exe" `
        -ArgumentList "C:\Xova\plugins\start_agent_fleet.py" `
        -WorkingDirectory "C:\Xova" `
        -WindowStyle Hidden
}

# 7. Launch phone_gateway (port 7340 — phone↔PC bridge per project_s26_phone_bridge).
$gatewayAlive = Get-CimInstance Win32_Process -Filter "name='pythonw.exe' OR name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*phone_gateway*" -and $_.CommandLine -notlike "*phone_gateway_ctrl*" }
if ($gatewayAlive) {
    $gwPid = @($gatewayAlive)[0].ProcessId
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] phone_gateway already running (PID $gwPid) - skipping launch"
} else {
    Start-Process -FilePath "pythonw.exe" `
        -ArgumentList "C:\Xova\plugins\phone_gateway.py" `
        -WorkingDirectory "C:\Xova" `
        -WindowStyle Hidden
    Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] phone_gateway launched"
}

Add-Content -Path $LauncherLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start_xova] LAUNCH COMPLETE"
