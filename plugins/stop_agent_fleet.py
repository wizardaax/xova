"""
stop_agent_fleet.py — graceful stop of the 13 xova-agent runtimes via signal
file. Never uses Stop-Process / taskkill (CLAUDE.md RULE 3).

Writes C:\\Xova\\memory\\agent_fleet_stop. Each agent checks for this file
at the top of its 60 s cycle and exits cleanly. Worst-case wait: 60 s + the
current cycle's work (typically ~1 s).

Stdlib only.

Optional: --agent <name> stops only one agent via that agent's per-repo
stop_signal file (D:\\github\\wizardaax\\xova-agent-NN-name\\memory\\stop_signal).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

AGENTS = [
    "forge", "jarvis", "mesh", "browser", "corpus", "evolution",
    "sentinel", "phase", "field", "memory", "repo", "voice", "coherence",
]
AGENT_REPO = {
    "forge":     "xova-agent-01-forge",
    "jarvis":    "xova-agent-02-jarvis",
    "mesh":      "xova-agent-03-mesh",
    "browser":   "xova-agent-04-browser",
    "corpus":    "xova-agent-05-corpus",
    "evolution": "xova-agent-06-evolution",
    "sentinel":  "xova-agent-07-sentinel",
    "phase":     "xova-agent-08-phase",
    "field":     "xova-agent-09-field",
    "memory":    "xova-agent-10-memory",
    "repo":      "xova-agent-11-repo",
    "voice":     "xova-agent-12-voice",
    "coherence": "xova-agent-13-coherence",
}
REPOS_DIR         = r"D:\github\wizardaax"
GLOBAL_STOP_PATH  = r"C:\Xova\memory\agent_fleet_stop"
POLL_S            = 5
MAX_WAIT_S        = 120
CREATE_NO_WINDOW  = 0x08000000


def _alive_agents() -> set[str]:
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
            if t == "--agent" and i + 1 < len(toks) and toks[i + 1] in AGENTS:
                alive.add(toks[i + 1])
    return alive


def _create_stop_file(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f"stop requested at {time.time()}\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="Stop xova-agent fleet via signal file.")
    ap.add_argument("--agent", choices=AGENTS, default=None,
                    help="Stop one agent (default: all 13).")
    ap.add_argument("--wait", action="store_true",
                    help="Poll until agent(s) exit or MAX_WAIT_S.")
    args = ap.parse_args()

    targets: list[str]
    if args.agent:
        repo = AGENT_REPO[args.agent]
        path = os.path.join(REPOS_DIR, repo, "memory", "stop_signal")
        _create_stop_file(path)
        targets = [args.agent]
        print(f"stop signal written for {args.agent}: {path}")
    else:
        _create_stop_file(GLOBAL_STOP_PATH)
        targets = list(AGENTS)
        print(f"global stop signal written: {GLOBAL_STOP_PATH}")

    if not args.wait:
        print("(use --wait to poll until exit)")
        return 0

    elapsed = 0
    while elapsed < MAX_WAIT_S:
        alive = _alive_agents() & set(targets)
        if not alive:
            print(json.dumps({"exited": targets, "elapsed_s": elapsed}, indent=2))
            return 0
        print(f"waiting on {sorted(alive)} (elapsed {elapsed}s)")
        time.sleep(POLL_S)
        elapsed += POLL_S
    alive = _alive_agents() & set(targets)
    print(json.dumps({
        "still_alive_after_timeout": sorted(alive),
        "elapsed_s": elapsed,
    }, indent=2))
    return 1 if alive else 0


if __name__ == "__main__":
    sys.exit(main())
