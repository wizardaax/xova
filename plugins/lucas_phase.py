"""
lucas_phase.py — Lucas sequence / golden-ratio phase analysis for AEON.

Lucas sequence: L(0)=2, L(1)=1, L(n)=L(n-1)+L(n-2)
Consecutive ratios L(n)/L(n-1) converge to phi = (1+sqrt(5))/2 = 1.61803...

Cross-validates phi convergence against the AEON engine's PHI constant.
Computes a phase stability score:
  - convergence_score: how tight is L(n)/L(n-1) to phi at N_TERMS
  - consistency_score: std(ratios[-10:]) < PHI_TOL
  - aeon_match_score: |aeon_phi - phi| / phi (lower = better match)
  Final score = 0.5*convergence + 0.3*consistency + 0.2*aeon_match

Publishes xova.lucas_phase to context_broker.
CLI: --action run | status
"""
import json, math, os, sys, time

_BROKER_PATH = r"C:\Xova\memory\context_broker.json"
_REPO_ROOT   = r"D:\github\wizardaax\ziltrix-sch-core"

PHI          = (1 + math.sqrt(5)) / 2   # 1.6180339887...
PSI          = (1 - math.sqrt(5)) / 2   # -0.6180339887...
N_TERMS      = 60
PHI_TOL      = 1e-10    # convergence tolerance at N=60


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


def _lucas_sequence(n: int) -> list[int]:
    seq = [2, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]


def _ratios(seq: list[int]) -> list[float]:
    return [seq[i + 1] / seq[i] for i in range(len(seq) - 1)]


def _std(vals: list[float]) -> float:
    if len(vals) < 2:
        return 0.0
    mu = sum(vals) / len(vals)
    var = sum((v - mu) ** 2 for v in vals) / len(vals)
    return math.sqrt(var)


def _get_aeon_phi() -> float | None:
    """Try to get PHI from the AEON engine constants in context_broker."""
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        # Try aeon_last_run slot
        slot = data.get("slots", {}).get("xova.aeon_last_run", {})
        constants = slot.get("constants", {})
        phi_val = constants.get("PHI") or constants.get("phi")
        if phi_val:
            return float(phi_val)
    except Exception:
        pass
    # Try importing aeon_engine directly
    try:
        if _REPO_ROOT not in sys.path:
            sys.path.insert(0, _REPO_ROOT)
        import aeon_engine
        return float(getattr(aeon_engine, "PHI", PHI))
    except Exception:
        return None


def action_run() -> dict:
    seq     = _lucas_sequence(N_TERMS)
    ratios  = _ratios(seq)

    # Convergence at final ratio
    final_ratio  = ratios[-1]
    conv_err     = abs(final_ratio - PHI)
    conv_score   = max(0.0, 1.0 - conv_err / 1e-6)  # < 1e-6 error → near perfect

    # Consistency: std of last 10 ratios
    last_stdev   = _std(ratios[-10:])
    cons_score   = max(0.0, 1.0 - last_stdev / PHI_TOL)

    # AEON match
    aeon_phi     = _get_aeon_phi()
    if aeon_phi is not None:
        match_err  = abs(aeon_phi - PHI) / PHI
        match_score = max(0.0, 1.0 - match_err * 1e6)
    else:
        aeon_phi    = None
        match_score = 0.5   # uncertain — half credit

    score = round(0.5 * conv_score + 0.3 * cons_score + 0.2 * match_score, 4)

    # Phase identity: binet's formula check L(n) = phi^n + psi^n
    binet_errors = []
    for i, v in enumerate(seq[:20]):
        binet = PHI ** i + PSI ** i
        binet_errors.append(abs(round(binet) - v))
    binet_ok = all(e < 0.5 for e in binet_errors)

    payload = {
        "ok":            True,
        "n_terms":       N_TERMS,
        "final_ratio":   round(final_ratio, 12),
        "phi":           round(PHI, 12),
        "conv_err":      conv_err,
        "conv_score":    round(conv_score, 4),
        "cons_score":    round(cons_score, 4),
        "match_score":   round(match_score, 4),
        "score":         score,
        "aeon_phi":      aeon_phi,
        "binet_ok":      binet_ok,
        "last_stdev":    last_stdev,
        "seq_sample":    seq[:10],
        "ts":            time.time(),
    }
    _write_context_slot("xova.lucas_phase", payload)
    return payload


def action_status() -> dict:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        slot = data.get("slots", {}).get("xova.lucas_phase")
        if slot:
            return {"ok": True, "cached": True, **slot}
    except Exception:
        pass
    return {"ok": True, "cached": False, "score": None}


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="run", choices=["run", "status"])
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    result = action_run() if args.action == "run" else action_status()
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))



# ── Phase agent evolution patch (auto-written) ────────────────────────────────
# Phase drift can occur when Lucas ratios diverge from phi across cycles.
# This function tracks inter-cycle drift and flags when correction is needed.


def phase_drift_detect(ratios: list, phi: float = 1.6180339887498949) -> dict:
    """Detect phase drift by comparing Lucas ratios to phi across a window.

    Args:
        ratios: list of final_ratio values from successive lucas_phase runs
        phi:    target golden ratio (default: precise phi)
    Returns:
        dict with drift_magnitude, is_drifting, correction_direction
    """
    if not ratios:
        return {"drift_magnitude": 0.0, "is_drifting": False, "correction_direction": 0}

    errors = [abs(r - phi) for r in ratios]
    mean_err = sum(errors) / len(errors)
    # Trend: is drift growing or shrinking?
    if len(errors) > 1:
        trend = errors[-1] - errors[0]
    else:
        trend = 0.0

    threshold = 1e-6
    return {
        "drift_magnitude": round(mean_err, 10),
        "is_drifting": mean_err > threshold,
        "correction_direction": 1 if trend > 0 else (-1 if trend < 0 else 0),
        "window_size": len(ratios),
    }
