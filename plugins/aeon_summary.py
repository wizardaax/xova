"""
aeon_summary.py — Xova plugin: AEON thrust simulation for AeonThrust.tsx.

AeonThrust.tsx expects: { ok, summary: { thrust_series, validation, constants } }
Constants must use UPPERCASE keys: PHI, PSI_RESONANCE, GOLDEN_ANGLE_DEG, ALPHA_INV.

Strategy (fastest first):
  1. Read xova.aeon_last_run from context_broker.json (live mesh data, ~0ms)
  2. Call aeon_engine.aeon_summary() directly as fallback (~instant)
"""

import json
import os
import sys
import tempfile

_REPO_ROOT      = r"D:\github\wizardaax\ziltrix-sch-core"
_BROKER_PATH    = r"C:\Xova\memory\context_broker.json"

_KEY_MAP = {
    "phi":              "PHI",
    "golden_angle_deg": "GOLDEN_ANGLE_DEG",
    "psi_resonance":    "PSI_RESONANCE",
    "alpha_inv":        "ALPHA_INV",
    "n3_medium":        "N3_MEDIUM",
    "omega_n":          "OMEGA_N",
    "drive_freq_hz":    "DRIVE_FREQ_HZ",
    "coupling_k":       "COUPLING_K",
}


def _map_constants(raw: dict) -> dict:
    return {_KEY_MAP.get(k, k.upper()): v for k, v in raw.items()}


def _from_broker() -> dict | None:
    """Read the last AEON run published by mesh_runner to context_broker.json."""
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            broker = json.load(f)
        slot = broker.get("slots", {}).get("xova.aeon_last_run")
        if not slot or not slot.get("thrust_series"):
            return None
        series = [
            {"t": p.get("t", 0), "phi": p.get("phi", 0), "thrust": p.get("thrust", 0)}
            for p in slot["thrust_series"]
        ]
        consts = _map_constants(slot.get("constants") or {})
        val = {
            "matched":     bool(slot.get("validated", False)),
            "max_rel_err": float(slot.get("max_rel_err") or 0.0),
        }
        return {"thrust_series": series, "validation": val, "constants": consts,
                "source": "live", "cycle": slot.get("cycle")}
    except Exception:
        return None


def _from_engine() -> dict | None:
    """Compute a fresh AEON summary by calling aeon_engine directly."""
    if _REPO_ROOT not in sys.path:
        sys.path.insert(0, _REPO_ROOT)
    try:
        from aeon_engine import aeon_summary as _aeon
        raw = _aeon()
        series = [
            {"t": p["t"], "phi": p["phi"], "thrust": p["thrust"]}
            for p in raw.get("thrust_series", [])
        ]
        consts = _map_constants(raw.get("constants", {}))
        val_raw = raw.get("validation", {})
        val = {
            "matched":     bool(val_raw.get("matched", False)),
            "max_rel_err": float(val_raw.get("max_rel_err") or 0.0),
        }
        return {"thrust_series": series, "validation": val, "constants": consts,
                "source": "engine"}
    except Exception as exc:
        return None


def main() -> None:
    summary = _from_broker() or _from_engine()
    if summary:
        result = {"ok": True, "summary": summary}
    else:
        result = {"ok": False, "error": "aeon_engine unavailable and no broker data"}

    payload = json.dumps(result, ensure_ascii=False, default=str)

    _out_path = os.path.join(tempfile.gettempdir(), "xova_aeon_summary.json")
    try:
        with open(_out_path + ".tmp", "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(_out_path + ".tmp", _out_path)
    except Exception:
        pass

    print(payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import json as _j; print(_j.dumps({"ok": False, "error": str(e)}))
