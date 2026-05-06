"""
swarm_status.py — Xova plugin: query SwarmOrchestrator status.

Instantiates SwarmOrchestrator WITHOUT calling start() (which spawns threads).
status() reads from shard/governor state already set up in __init__, so it
works safely as a read-only probe.

Prints a single JSON line to stdout. Runnable standalone.
"""

import json
import os
import sys
import tempfile

_REPO_SRC = r"D:\github\wizardaax\recursive-field-math-pro\src"
if _REPO_SRC not in sys.path:
    sys.path.insert(0, _REPO_SRC)


def _swarm_status() -> dict:
    try:
        from recursive_field_math.swarm.orchestrator import SwarmOrchestrator
    except Exception as e:
        return {
            "ok": True,
            "shards": [],
            "note": "module not available",
            "tasks_completed": 0,
            "avg_coherence": None,
            "import_error": str(e),
        }

    try:
        orch = SwarmOrchestrator()
    except Exception as e:
        return {"ok": False, "error": f"SwarmOrchestrator() instantiation failed: {e}"}

    try:
        status = orch.status()
    except Exception as e:
        return {
            "ok": True,
            "shards": [],
            "note": f"status() unavailable without start(): {e}",
            "tasks_completed": 0,
            "avg_coherence": None,
        }

    return {"ok": True, "status": status}


def main() -> None:
    result = _swarm_status()
    payload = json.dumps(result, ensure_ascii=False, default=str)

    _out_path = os.path.join(tempfile.gettempdir(), "xova_swarm_status.json")
    _tmp_path = _out_path + ".tmp"
    try:
        with open(_tmp_path, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(_tmp_path, _out_path)
    except Exception:
        pass

    print(payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import json as _j; print(_j.dumps({"ok": False, "error": str(e)}))
