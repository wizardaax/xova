"""
aeon_summary.py — Xova plugin: AEON thrust simulation for AeonThrust.tsx.

AeonThrust.tsx expects: { ok, summary: { thrust_series, validation, constants, quality } }
Constants must use UPPERCASE keys: PHI, PSI_RESONANCE, GOLDEN_ANGLE_DEG, ALPHA_INV.

AEON Sprint 3 additions:
  - Extended thrust series: n_steps=10 (was 5) — shows full resonant ramp
  - quality_score: 0.0–1.0 composite (validation + thrust range + series depth)
  - quality fields: validated, max_rel_err, n_steps, peak_thrust, score

Strategy (fastest first):
  1. Read xova.aeon_last_run from context_broker.json (live mesh data, ~0ms)
  2. Call aeon_engine.aeon_summary() directly as fallback (~instant)
  3. If extended=True (default), call aeon_thrust_series(n_steps=10) for richer data
"""

import json
import os
import sys
import tempfile

_REPO_ROOT      = r"D:\github\wizardaax\ziltrix-sch-core"
_BROKER_PATH    = r"C:\Xova\memory\context_broker.json"
_AEON_LOG_PATH  = r"C:\Xova\memory\aeon_run_log.jsonl"
_N_STEPS        = 10  # Sprint 3: extended series (PhaseII ref uses 5; 10 shows full ramp)

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


def _quality_score(validation: dict, thrust_series: list, n_steps: int) -> dict:
    """Compute a 0.0–1.0 composite quality score for an AEON run."""
    validated   = bool(validation.get("matched", False))
    max_rel_err = float(validation.get("max_rel_err") or 1.0)
    n_points    = len(thrust_series)

    # Thrust range: more steps → larger dynamic range → higher score
    thrusts = [abs(p.get("thrust", 0)) for p in thrust_series]
    peak    = max(thrusts) if thrusts else 0.0
    dynamic = (max(thrusts) / min(thrusts)) if thrusts and min(thrusts) > 0 else 1.0

    # Score components (all 0..1):
    # 1. Validation: matched=1.0, else penalise by rel_err
    val_score  = 1.0 if validated else max(0.0, 1.0 - max_rel_err * 5)
    # 2. Error tightness: 0% err=1.0, 10% err=0.0
    err_score  = max(0.0, 1.0 - max_rel_err / 0.1)
    # 3. Series depth: n_steps/10 up to 1.0
    depth_score = min(1.0, n_points / 10.0)
    # 4. Dynamic range: log scale, 1 decade=1.0
    import math
    range_score = min(1.0, math.log10(dynamic + 1))

    composite = 0.4 * val_score + 0.3 * err_score + 0.2 * depth_score + 0.1 * range_score

    return {
        "score":      round(composite, 4),
        "validated":  validated,
        "max_rel_err": round(max_rel_err, 6),
        "n_steps":    n_points,
        "peak_thrust": peak,
    }


def _append_log(summary: dict) -> None:
    """Append a timestamped AEON run record to the run log (ring-buffer, max 500 entries)."""
    import time
    try:
        record = {
            "ts":           time.time(),
            "quality":      summary.get("quality", {}).get("score"),
            "peak_thrust":  summary.get("quality", {}).get("peak_thrust"),
            "n_steps":      summary.get("quality", {}).get("n_steps"),
            "validated":    summary.get("quality", {}).get("validated"),
            "source":       summary.get("source", "?"),
        }
        # Read existing, keep last 499, append new
        lines: list[str] = []
        if os.path.exists(_AEON_LOG_PATH):
            try:
                with open(_AEON_LOG_PATH, encoding="utf-8") as fh:
                    lines = fh.read().splitlines()
            except Exception:
                pass
        lines = lines[-499:]
        lines.append(json.dumps(record, ensure_ascii=False))
        with open(_AEON_LOG_PATH, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except Exception:
        pass


def _from_broker() -> dict | None:
    """Read the last AEON run from context_broker.json; extend series if short."""
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
        # If broker series is short (5 pts, PhaseII ref), extend via engine
        if len(series) < _N_STEPS:
            extended = _extend_series(len(series))
            if extended:
                series = extended
        quality = _quality_score(val, series, _N_STEPS)
        return {"thrust_series": series, "validation": val, "constants": consts,
                "quality": quality, "source": "live", "cycle": slot.get("cycle")}
    except Exception:
        return None


def _extend_series(current_n: int) -> list[dict] | None:
    """Ask aeon_engine for a longer series than current_n."""
    if _REPO_ROOT not in sys.path:
        sys.path.insert(0, _REPO_ROOT)
    try:
        import aeon_engine
        samples = aeon_engine.aeon_thrust_series(n_steps=_N_STEPS)
        return [{"t": s.t, "phi": s.phi, "thrust": s.thrust} for s in samples]
    except Exception:
        return None


def _from_engine() -> dict | None:
    """Compute a fresh AEON summary with extended series (n_steps=10)."""
    if _REPO_ROOT not in sys.path:
        sys.path.insert(0, _REPO_ROOT)
    try:
        import aeon_engine
        # Extended series
        samples = aeon_engine.aeon_thrust_series(n_steps=_N_STEPS)
        series  = [{"t": s.t, "phi": s.phi, "thrust": s.thrust} for s in samples]
        # Validation
        val_raw  = aeon_engine.validate_against_phaseii(samples[:5])  # validate vs PhaseII 5-pt ref
        consts   = _map_constants({
            "phi":              aeon_engine.PHI,
            "golden_angle_deg": aeon_engine.GOLDEN_ANGLE_DEG,
            "psi_resonance":    aeon_engine.PSI_RESONANCE,
            "alpha_inv":        aeon_engine.ALPHA_INV,
            "n3_medium":        aeon_engine.N3_MEDIUM,
            "omega_n":          aeon_engine.OMEGA_N,
            "drive_freq_hz":    aeon_engine.DRIVE_FREQ_HZ,
            "coupling_k":       aeon_engine.COUPLING_K,
        })
        val = {
            "matched":     bool(val_raw.get("matched", False)),
            "max_rel_err": float(val_raw.get("max_rel_err") or 0.0),
        }
        quality = _quality_score(val, series, _N_STEPS)
        return {"thrust_series": series, "validation": val, "constants": consts,
                "quality": quality, "source": "engine"}
    except Exception:
        return None


def main() -> None:
    summary = _from_broker() or _from_engine()
    if summary:
        _append_log(summary)
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

    sys.stdout.reconfigure(encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import json as _j
        sys.stdout.reconfigure(encoding="utf-8")
        print(_j.dumps({"ok": False, "error": str(e)}))
