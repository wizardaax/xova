"""
xova_watchdog.py — Xova lifecycle controller.

Polls every 5 s. Keeps jarvis daemon + mesh_runner alive while xova.exe
is running; shuts both down when xova.exe exits. Stdlib only.
Logs to C:\\Xova\\memory\\watchdog.log.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

# ── Singleton guard ──────────────────────────────────────────────────────────
# Exit immediately if another xova_watchdog.py is already running.
# Uses WMI/PowerShell to list pythonw processes with xova_watchdog in cmdline,
# filtering out our own PID so we don't count ourselves.
def _already_running() -> bool:
    try:
        own_pid = os.getpid()
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe' OR name='python.exe'\" "
             "| Select-Object -ExpandProperty CommandLine"],
            capture_output=True, text=True, timeout=10,
            creationflags=0x08000000,
        )
        lines = result.stdout.splitlines()
        siblings = [l for l in lines if "xova_watchdog" in l]
        # More than one entry means at least one sibling exists (we are also in the list).
        return len(siblings) > 1
    except Exception:
        return False  # can't tell — let this instance continue

if _already_running():
    sys.exit(0)  # another watchdog is alive; this duplicate exits silently
# ────────────────────────────────────────────────────────────────────────────

POLL_SEC             = 5
VENV_PYTHONW         = r"C:\jarvis\.venv\Scripts\pythonw.exe"   # jarvis venv — for jarvis.daemon
MESH_PYTHONW         = r"C:\Users\adz_7\AppData\Local\Programs\Python\Python313\pythonw.exe"  # absolute path — no PATH dependency
JARVIS_SRC           = r"C:\jarvis\src"
JARVIS_DIR           = r"C:\jarvis"
MESH_SCRIPT          = r"C:\Xova\mesh_runner.py"
FORGE_SCRIPT         = r"C:\Xova\forge_listener.py"
ABSORB_SCRIPT        = r"C:\Xova\absorb_loop.py"
XOVA_DIR             = r"C:\Xova"
LOG_PATH             = r"C:\Xova\memory\watchdog.log"
NO_WIN               = 0x08000000   # CREATE_NO_WINDOW
JARVIS_KILL_COOLDOWN = 30.0         # seconds — cannot kill Jarvis more than once per 30s
AGENT_BOARD_PATH     = r"C:\Xova\memory\agent_board.json"

# Tracks the last time we killed Jarvis (monotonic wall time).
_last_jarvis_kill: float = 0.0


LOG_CAP = 500


def _write_xova_heartbeat(alive: bool) -> None:
    """Atomic read-modify-write of xova entry in agent_board.json.

    Only touches the 'xova' key — never clobbers other agents' data.
    Silently swallows all exceptions so a broken board never crashes the watchdog.
    """
    try:
        try:
            with open(AGENT_BOARD_PATH, "r", encoding="utf-8") as fh:
                board = json.load(fh)
        except FileNotFoundError:
            board = {}
        except json.JSONDecodeError:
            _log("board JSON corrupt — skipping heartbeat write to avoid clobbering xova.alive")
            return

        now_ms = int(time.time() * 1000)
        if "xova" not in board or not isinstance(board["xova"], dict):
            board["xova"] = {}

        board["xova"]["alive"]     = alive
        board["xova"]["last_seen"] = now_ms if alive else board["xova"].get("last_seen", 0)

        tmp = AGENT_BOARD_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(board, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, AGENT_BOARD_PATH)
    except Exception:
        pass  # board write failure must never crash the watchdog


def _log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} [watchdog] {msg}"
    print(line)
    try:
        try:
            with open(LOG_PATH, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
        except FileNotFoundError:
            lines = []
        lines.append(line + "\n")
        if len(lines) > LOG_CAP:
            lines = lines[-(LOG_CAP - 1):]
        with open(LOG_PATH, "w", encoding="utf-8") as fh:
            fh.writelines(lines)
    except Exception:
        pass


def _xova_alive() -> bool:
    """True if xova.exe is in the process list."""
    try:
        out = subprocess.check_output(
            ["tasklist", "/FI", "IMAGENAME eq xova.exe", "/FO", "CSV", "/NH"],
            creationflags=NO_WIN,
            stderr=subprocess.DEVNULL,
            timeout=10,
        ).decode(errors="replace")
        return "xova.exe" in out
    except subprocess.TimeoutExpired:
        _log("tasklist timed out — assuming xova alive")
        return True
    except Exception as exc:
        _log(f"_xova_alive check failed: {exc}")
        return False


def _procs_json() -> list[dict]:
    """Return list of {pid, name, cmdline} for all pythonw.exe or python.exe processes."""
    ps_cmd = (
        "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe' OR name='python.exe'\" "
        "| Select-Object ProcessId,Name,CommandLine "
        "| ConvertTo-Json -Compress"
    )
    try:
        raw = subprocess.check_output(
            ["powershell", "-NonInteractive", "-Command", ps_cmd],
            creationflags=NO_WIN,
            stderr=subprocess.DEVNULL,
        ).decode(errors="replace").strip()
        if not raw:
            return []
        parsed = json.loads(raw)
        # ConvertTo-Json returns object (not array) when there is exactly 1 match
        if isinstance(parsed, dict):
            parsed = [parsed]
        return parsed
    except Exception:
        return []


def _find(keyword: str) -> list[int]:
    """PIDs of pythonw.exe processes whose CommandLine contains keyword."""
    return [
        int(p["ProcessId"])
        for p in _procs_json()
        if p.get("CommandLine") and keyword in p["CommandLine"]
    ]


def _find_with_status(keyword: str) -> tuple[list[int], bool]:
    """Like _find() but also returns whether Get-CimInstance actually succeeded.
    Returns (pids, True) on success — empty list means genuinely no match.
    Returns ([], False) if the PowerShell query itself failed — callers must
    treat the process state as unknown, not as 'no process found'."""
    ps_cmd = (
        "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe' OR name='python.exe'\" "
        "| Select-Object ProcessId,Name,CommandLine "
        "| ConvertTo-Json -Compress"
    )
    try:
        raw = subprocess.check_output(
            ["powershell", "-NonInteractive", "-Command", ps_cmd],
            creationflags=NO_WIN,
            stderr=subprocess.DEVNULL,
            timeout=10,
        ).decode(errors="replace").strip()
        if not raw:
            return [], True   # query succeeded, no python processes at all
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            parsed = [parsed]
        return [
            int(p["ProcessId"])
            for p in parsed
            if p.get("CommandLine") and keyword in p["CommandLine"]
        ], True
    except Exception:
        return [], False      # query failed — state is unknown


FORGE_MIN_AGE_BEFORE_KILL = 30.0   # AUDIT-2-020: don't kill forge_listener until it has been alive ≥30 s
MIN_PROCESS_AGE_SEC       = 30     # AUDIT-2-020: unified threshold — applies to all _kill_if_old_enough calls


def _process_age_seconds(pid: int) -> float | None:
    """Return how many seconds a process has been running, or None if unknown.

    Uses wmic via subprocess (stdlib-only).  Parses the Win32 DMTF datetime
    format: YYYYMMDDHHmmss.ffffff+TZO (e.g. 20260506123456.000000+600).
    Returns None if the query fails so callers can decide conservatively.
    (AUDIT-2-020)
    """
    import datetime
    try:
        result = subprocess.run(
            ["wmic", "process", "where", f"ProcessId={pid}",
             "get", "CreationDate", "/format:value"],
            capture_output=True, text=True, timeout=8,
            creationflags=NO_WIN,
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("CreationDate=") and len(line) > 13:
                raw = line.split("=", 1)[1].strip()
                # DMTF: YYYYMMDDHHmmss.ffffff+TZO  (e.g. 20260506123456.000000+600)
                if len(raw) >= 14:
                    dt_str = raw[:14]   # YYYYMMDDHHmmss
                    try:
                        dt = datetime.datetime.strptime(dt_str, "%Y%m%d%H%M%S")
                        # wmic returns local time; compare to local now.
                        return (datetime.datetime.now() - dt).total_seconds()
                    except ValueError:
                        return None
    except Exception:
        pass
    return None


def _kill_if_old_enough(pids: list[int], label: str) -> None:
    """Kill each pid only if it has been running >= MIN_PROCESS_AGE_SEC seconds.

    Young processes (still initialising) are skipped with a log entry so they
    get a chance to reach a healthy state before the next poll cycle.
    (AUDIT-2-020: process-age guard before kill.)
    """
    for pid in pids:
        age = _process_age_seconds(pid)
        if age is not None and age < MIN_PROCESS_AGE_SEC:
            _log(
                f"AUDIT-2-020: skipping kill of {label} PID {pid} "
                f"— process too young to kill ({age:.1f}s old, threshold {MIN_PROCESS_AGE_SEC}s)"
            )
            continue
        try:
            subprocess.call(
                ["taskkill", "/F", "/PID", str(pid)],
                creationflags=NO_WIN,
                stderr=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
            )
            _log(f"killed {label} PID {pid} (age {age:.1f}s)" if age is not None else f"killed {label} PID {pid} (age unknown)")
        except Exception as exc:
            _log(f"kill {label} PID {pid} failed: {exc}")


def _kill(pids: list[int]) -> None:
    """Kill pids unconditionally (used for legacy call-sites where age guard is not needed)."""
    for pid in pids:
        try:
            subprocess.call(
                ["taskkill", "/F", "/PID", str(pid)],
                creationflags=NO_WIN,
                stderr=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
            )
            _log(f"killed PID {pid}")
        except Exception as exc:
            _log(f"kill PID {pid} failed: {exc}")


def _start_jarvis() -> None:
    global _last_jarvis_kill

    # Re-query with success tracking before any kill decision.
    # Rules (per HIGH-5 audit fix):
    #   - Only kill if Get-CimInstance succeeded AND found existing PIDs.
    #   - If the query failed → state unknown → skip kill, skip start, log and return.
    #   - If the query succeeded but returned empty → nothing to kill, safe to start.
    #   - Enforce a 30-second cooldown between kills to prevent the spurious-kill loop.
    existing, query_ok = _find_with_status("jarvis.daemon")

    if not query_ok:
        _log("Get-CimInstance query failed — skipping jarvis kill and start (state unknown)")
        return

    if existing:
        now = time.time()
        secs_since_last_kill = now - _last_jarvis_kill
        if secs_since_last_kill < JARVIS_KILL_COOLDOWN:
            remaining = JARVIS_KILL_COOLDOWN - secs_since_last_kill
            _log(f"kill cooldown active ({remaining:.0f}s remaining) — not killing jarvis pids {existing}")
            return  # existing Jarvis is alive; wait for cooldown before considering another kill
        _log(f"killing existing jarvis pids before restart: {existing}")
        _kill_if_old_enough(existing, "jarvis.daemon")   # AUDIT-2-020: age-guarded kill
        _last_jarvis_kill = time.time()
        time.sleep(1)   # brief pause so sockets/files are released

    env = os.environ.copy()
    env["PYTHONPATH"] = JARVIS_SRC
    try:
        proc = subprocess.Popen(
            [VENV_PYTHONW, "-m", "jarvis.daemon"],
            cwd=JARVIS_DIR,
            env=env,
            creationflags=NO_WIN,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log(f"started jarvis daemon PID {proc.pid}")
    except Exception as exc:
        _log(f"start jarvis failed: {exc}")


def _start_mesh() -> None:
    try:
        proc = subprocess.Popen(
            [MESH_PYTHONW, MESH_SCRIPT],
            cwd=XOVA_DIR,
            creationflags=NO_WIN,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log(f"started mesh_runner PID {proc.pid}")
    except Exception as exc:
        _log(f"start mesh_runner failed: {exc}")


def _start_forge_listener() -> None:
    try:
        proc = subprocess.Popen(
            [MESH_PYTHONW, FORGE_SCRIPT],
            cwd=XOVA_DIR,
            creationflags=NO_WIN,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log(f"started forge_listener PID {proc.pid}")
    except Exception as exc:
        _log(f"start forge_listener failed: {exc}")


def _start_absorb() -> None:
    try:
        proc = subprocess.Popen(
            [MESH_PYTHONW, ABSORB_SCRIPT],
            cwd=XOVA_DIR,
            creationflags=NO_WIN,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _log(f"started absorb_loop PID {proc.pid}")
    except Exception as exc:
        _log(f"start absorb_loop failed: {exc}")


def main() -> None:
    _log("watchdog started")
    prev_xova = _xova_alive()
    _log(f"initial xova state: {'alive' if prev_xova else 'dead'}")

    while True:
        time.sleep(POLL_SEC)
        xova = _xova_alive()

        if xova:
            # Xova is running — write heartbeat, ensure all children are alive.
            _write_xova_heartbeat(True)
            jarvis_pids  = _find("jarvis.daemon")
            mesh_pids    = _find("mesh_runner.py")
            forge_pids   = _find("forge_listener.py")
            absorb_pids  = _find("absorb_loop.py")

            if not jarvis_pids:
                _log("jarvis daemon not found — starting")
                _start_jarvis()

            if not mesh_pids:
                _log("mesh_runner not found — starting")
                _start_mesh()

            if not forge_pids:
                _log("forge_listener not found — starting")
                _start_forge_listener()

            if not absorb_pids:
                _log("absorb_loop not found — starting")
                _start_absorb()

        else:
            # Xova has exited — write heartbeat, shut everything down.
            _write_xova_heartbeat(False)
            if prev_xova:
                _log("xova.exe exited — shutting down children")

            jarvis_pids = _find("jarvis.daemon")
            mesh_pids   = _find("mesh_runner.py")
            forge_pids  = _find("forge_listener.py")
            absorb_pids = _find("absorb_loop.py")

            if jarvis_pids:
                _log(f"killing jarvis pids {jarvis_pids}")
                _kill_if_old_enough(jarvis_pids, "jarvis.daemon")   # AUDIT-2-020

            if mesh_pids:
                _log(f"killing mesh_runner pids {mesh_pids}")
                _kill_if_old_enough(mesh_pids, "mesh_runner")       # AUDIT-2-020

            if forge_pids:
                _log(f"killing forge_listener pids {forge_pids}")
                _kill_if_old_enough(forge_pids, "forge_listener")   # AUDIT-2-020

            if absorb_pids:
                _log(f"killing absorb_loop pids {absorb_pids}")
                _kill_if_old_enough(absorb_pids, "absorb_loop")     # AUDIT-2-020

            if not prev_xova:
                # Xova still dead — nothing to do, sleep and check again.
                pass

        prev_xova = xova


if __name__ == "__main__":
    main()
