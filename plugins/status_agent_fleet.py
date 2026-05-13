"""
status_agent_fleet.py — list which of the 13 xova-agents are currently
running and tail the last log line for each.

Stdlib only. Read-only — never spawns or stops agents.
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
LOG_DIR           = r"C:\Xova\memory"
GLOBAL_STOP_PATH  = r"C:\Xova\memory\agent_fleet_stop"
CREATE_NO_WINDOW  = 0x08000000


def _alive_agents() -> dict[str, int]:
    """Return {agent_name: pid} for agents currently running."""
    cmd = (
        "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" "
        "| Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command", cmd],
            capture_output=True, text=True, timeout=15,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception:
        return {}
    try:
        items = json.loads(r.stdout or "[]")
        if isinstance(items, dict):
            items = [items]
    except Exception:
        return {}
    alive: dict[str, int] = {}
    for it in items:
        line = it.get("CommandLine") or ""
        pid  = it.get("ProcessId")
        if "agent_runtime.py" not in line:
            continue
        toks = line.split()
        for i, t in enumerate(toks):
            if t == "--agent" and i + 1 < len(toks) and toks[i + 1] in AGENTS:
                alive[toks[i + 1]] = pid
                break
    return alive


def _tail_log(name: str) -> str:
    path = os.path.join(LOG_DIR, f"agent_{name}.log")
    if not os.path.isfile(path):
        return "(no log)"
    try:
        with open(path, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 4096))
            tail = fh.read().decode("utf-8", errors="replace")
        lines = [ln for ln in tail.splitlines() if ln.strip()]
        return lines[-1] if lines else "(empty)"
    except Exception as exc:
        return f"(read err: {exc})"


def main() -> int:
    alive = _alive_agents()
    rows: list[dict] = []
    for name in AGENTS:
        pid = alive.get(name)
        rows.append({
            "agent":     name,
            "running":   pid is not None,
            "pid":       pid,
            "last_log":  _tail_log(name)[:160],
        })
    print(json.dumps({
        "alive_count":      len(alive),
        "total":            len(AGENTS),
        "global_stop_set":  os.path.isfile(GLOBAL_STOP_PATH),
        "agents":           rows,
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
