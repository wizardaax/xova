"""
aeon_sweep.py — AEON Sprint 4: parameter sensitivity sweep.

Varies coupling_k from 0.5x to 2.0x baseline in N_POINTS steps.
For each k_factor records peak_thrust and quality_score.
Publishes xova.aeon_sweep_result to context_broker.json.
Output: { ok, sweep: [ {k_factor, k_value, peak_thrust, quality, validated} ] }
"""
import json
import os
import sys
import time

_REPO_ROOT   = r"D:\github\wizardaax\ziltrix-sch-core"
_BROKER_PATH = r"C:\Xova\memory\context_broker.json"

N_POINTS   = 10
K_MIN_MULT = 0.5    # 50% of baseline
K_MAX_MULT = 2.0    # 200% of baseline


def _write_context_slot(key: str, value: object) -> None:
    try:
        data: dict = {}
        if os.path.exists(_BROKER_PATH):
            with open(_BROKER_PATH, encoding="utf-8") as f:
                data = json.load(f)
        if "slots" not in data:
            data["slots"] = {}
        data["slots"][key] = value
        tmp = _BROKER_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        os.replace(tmp, _BROKER_PATH)
    except Exception:
        pass


def _quality(val: dict, series: list, n_steps: int = 10) -> float:
    import math
    validated   = bool(val.get("matched", False))
    max_rel_err = float(val.get("max_rel_err") or 1.0)
    thrusts     = [abs(p.get("thrust", 0)) if isinstance(p, dict) else abs(p.thrust)
                   for p in series]
    _min = min(thrusts) if thrusts else 1e-30
    _max = max(thrusts) if thrusts else 0.0
    dynamic     = _max / _min if _min > 0 else 1.0
    val_sc  = 1.0 if validated else max(0.0, 1.0 - max_rel_err * 5)
    err_sc  = max(0.0, 1.0 - max_rel_err / 0.1)
    dep_sc  = min(1.0, len(series) / 10.0)
    rng_sc  = min(1.0, math.log10(dynamic + 1))
    return round(0.4 * val_sc + 0.3 * err_sc + 0.2 * dep_sc + 0.1 * rng_sc, 4)


def run_sweep() -> dict:
    if _REPO_ROOT not in sys.path:
        sys.path.insert(0, _REPO_ROOT)
    try:
        import aeon_engine
    except ImportError as e:
        return {"ok": False, "error": f"aeon_engine import failed: {e}"}

    k_base  = aeon_engine.COUPLING_K
    step    = (K_MAX_MULT - K_MIN_MULT) / (N_POINTS - 1)
    results = []

    for i in range(N_POINTS):
        k_factor = round(K_MIN_MULT + i * step, 4)
        k_value  = k_base * k_factor
        try:
            samples = aeon_engine.aeon_thrust_series(n_steps=10, k=k_value)
            thrusts = [abs(s.thrust) for s in samples]
            peak    = max(thrusts) if thrusts else 0.0
            val_raw = aeon_engine.validate_against_phaseii(samples[:5])
            q       = _quality(val_raw, samples, 10)
            results.append({
                "k_factor":    k_factor,
                "k_value":     k_value,
                "peak_thrust": peak,
                "quality":     q,
                "validated":   bool(val_raw.get("matched", False)),
                "max_rel_err": round(float(val_raw.get("max_rel_err") or 0.0), 6),
            })
        except Exception as exc:
            results.append({
                "k_factor": k_factor,
                "k_value":  k_value,
                "error":    str(exc),
            })

    # Find optimal k_factor (highest peak_thrust among validated runs)
    valid = [r for r in results if r.get("validated") and "peak_thrust" in r]
    optimal = max(valid, key=lambda r: r["peak_thrust"]) if valid else None

    sweep = {
        "ok":      True,
        "k_base":  k_base,
        "n_points": N_POINTS,
        "k_range": [K_MIN_MULT, K_MAX_MULT],
        "sweep":   results,
        "optimal": optimal,
        "ts":      time.time(),
    }

    _write_context_slot("xova.aeon_sweep_result", sweep)
    return sweep


def main() -> None:
    result = run_sweep()
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import json as _j
        sys.stdout.reconfigure(encoding="utf-8")
        print(_j.dumps({"ok": False, "error": str(e)}))
