"""
start_agent_fleet.py — launch the 13 xova-agent runtimes as pythonw daemons.

Idempotent: re-running skips any agents already alive. Staggers starts by
5 s each so initial cycles don't all hit broker / SCE-88 simultaneously.

Output goes to C:\\Xova\\memory\\agent_<name>.log (the same paths that went
dark on 2026-05-08; this revives them).

Companion scripts:
    python stop_agent_fleet.py    — graceful exit via stop signal
    python status_agent_fleet.py  — show alive/dead per agent

Stdlib only. RULE 3 compliant: never starts a process that's already alive,
never proposes restart of an existing one — only spawns missing ones.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

AGENTS = [
    "forge", "jarvis", "mesh", "browser", "corpus", "evolution",
    "sentinel", "phase", "field", "memory", "repo", "voice", "coherence",
]
RUNTIME           = r"C:\Xova\plugins\agent_runtime.py"
LOG_DIR           = r"C:\Xova\memory"
GLOBAL_STOP_PATH  = r"C:\Xova\memory\agent_fleet_stop"
PYTHONW           = "pythonw.exe"
CREATE_NO_WINDOW  = 0x08000000


def _alive_agents() -> set[str]:
    """Return set of agent names currently running agent_runtime.py.

    Uses Get-CimInstance (same pattern as xova_watchdog._find_with_status).
    """
    cmd = (
        "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" "
        "| Select-Object -ExpandProperty CommandLine"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", cmd],
            capture_output=True, text=True, timeout=15,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception:
        return set()
    alive: set[str] = set()
    for line in (r.stdout or "").splitlines():
        if "agent_runtime.py" not in line:
            continue
        toks = line.split()
        for i, t in enumerate(toks):
            if t == "--agent" and i + 1 < len(toks):
                if toks[i + 1] in AGENTS:
                    alive.add(toks[i + 1])
    return alive


def main() -> int:
    if not os.path.isfile(RUNTIME):
        print(f"missing: {RUNTIME}", file=sys.stderr)
        return 1

    # Clear any prior global stop signal so newly-launched agents aren't
    # gated off immediately on startup.
    if os.path.isfile(GLOBAL_STOP_PATH):
        try:
            os.remove(GLOBAL_STOP_PATH)
        except Exception:
            pass

    alive = _alive_agents()
    started: list[dict] = []
    skipped: list[str]  = []

    for i, name in enumerate(AGENTS):
        if name in alive:
            skipped.append(name)
            continue
        log_path = os.path.join(LOG_DIR, f"agent_{name}.log")
        try:
            log_fh = open(log_path, "ab")  # append, binary so subprocess can dup
            p = subprocess.Popen(
                [PYTHONW, RUNTIME,
                 "--agent", name,
                 "--start-delay", str(i * 5)],
                stdout=log_fh,
                stderr=subprocess.STDOUT,
                creationflags=CREATE_NO_WINDOW,
            )
            started.append({"agent": name, "pid": p.pid, "log": log_path,
                            "start_delay_s": i * 5})
        except Exception as exc:
            started.append({"agent": name, "error": str(exc)})

    print(json.dumps({
        "started":       started,
        "already_alive": skipped,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
