"""
domain_scan.py — Sprint 19: fire all 7 domain plugins in background.

Launches all domain plugins simultaneously (non-blocking Popen).
Returns immediately with { ok, launched, plugins }.
Each plugin writes to context_broker on completion (~1-30s).
Caller should re-read broker after 30s to see fresh results.
"""
import json
import os
import subprocess
import sys
import time

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
_NO_WIN     = 0x08000000

DOMAIN_PLUGINS = [
    ("ci_health",      [sys.executable, os.path.join(_PLUGIN_DIR, "ci_health.py"),      "--action", "run"]),
    ("lucas_phase",    [sys.executable, os.path.join(_PLUGIN_DIR, "lucas_phase.py"),    "--action", "run"]),
    ("field_weave",    [sys.executable, os.path.join(_PLUGIN_DIR, "field_weave.py"),    "--action", "run"]),
    ("ternary_eval",   [sys.executable, os.path.join(_PLUGIN_DIR, "ternary_eval.py"),   "--action", "run"]),
    ("corpus_recall",  [sys.executable, os.path.join(_PLUGIN_DIR, "corpus_recall.py"), "--action", "run"]),
    ("repo_sync",      [sys.executable, os.path.join(_PLUGIN_DIR, "repo_sync.py"),      "--action", "run"]),
    ("aeon_summary",   [sys.executable, os.path.join(_PLUGIN_DIR, "aeon_summary.py")]),
]


def action_scan() -> dict:
    launched = []
    failed   = []
    for name, cmd in DOMAIN_PLUGINS:
        try:
            subprocess.Popen(
                cmd,
                creationflags=_NO_WIN,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            launched.append(name)
        except Exception as exc:
            failed.append({"name": name, "error": str(exc)})
    return {
        "ok":       True,
        "launched": len(launched),
        "plugins":  launched,
        "failed":   failed,
        "ts":       time.time(),
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(action_scan(), ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
