"""
aeon_summary.py — Xova plugin: run the AEON thrust simulation.

aeon_summary() is pure stdlib math. Returns constants + thrust series +
PhaseII validation in one dict. No side effects, no threads, no IO.

Prints a single JSON line to stdout. Runnable standalone.
"""

import json
import os
import sys
import tempfile

_REPO_ROOT = r"D:\github\wizardaax\ziltrix-sch-core"
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


def _aeon_summary() -> dict:
    try:
        from aeon_engine import aeon_summary
    except Exception as e:
        return {
            "ok": False,
            "error": "aeon_engine not found",
            "note": "check ziltrix-sch-core path",
            "import_error": str(e),
        }

    try:
        summary = aeon_summary()
    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {"ok": True, "summary": summary}


def main() -> None:
    result = _aeon_summary()
    payload = json.dumps(result, ensure_ascii=False, default=str)

    _out_path = os.path.join(tempfile.gettempdir(), "xova_aeon_summary.json")
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
