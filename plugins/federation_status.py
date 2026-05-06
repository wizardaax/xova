"""
federation_status.py — Xova plugin: query FederationMesh status.

FederationMesh.__init__() needs no args. get_status() and coherence_snapshot()
are safe on an empty registry (returns global_coherence=0.5, repos={}).

Prints a single JSON line to stdout. Runnable standalone.
"""

import json
import os
import sys
import tempfile

_REPO_SRC = r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src"
if _REPO_SRC not in sys.path:
    sys.path.insert(0, _REPO_SRC)


def _federation_status() -> dict:
    try:
        from snell_vern_matrix.federation.mesh import FederationMesh
    except Exception as e:
        return {
            "ok": True,
            "repos": [],
            "global_coherence": None,
            "note": "module not available",
            "import_error": str(e),
        }

    try:
        mesh = FederationMesh()
    except Exception as e:
        return {"ok": False, "error": f"FederationMesh() instantiation failed: {e}"}

    try:
        status = mesh.get_status()
    except Exception as e:
        status = {"error": str(e)}

    try:
        coherence = mesh.coherence_snapshot().to_dict()
    except Exception as e:
        coherence = {"error": str(e)}

    return {"ok": True, "status": status, "coherence": coherence}


def main() -> None:
    result = _federation_status()
    payload = json.dumps(result, ensure_ascii=False, default=str)

    _out_path = os.path.join(tempfile.gettempdir(), "xova_federation_status.json")
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
