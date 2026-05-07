"""
field_weave.py — phi-spiral field weave generator for AEON.

The AEON engine advances phase by dphi_dt * dt per step, stepping along
a Fibonacci spiral in phase space. Each point is separated by the golden
angle (137.507764° ≈ 2.399963 rad), which maximises packing density and
produces the divergence sequence L(n)/L(n-1) → phi.

Computes:
  - N_POINTS phi-spiral coordinates (r_n, theta_n)
  - Field coherence: variance of consecutive angular gaps from golden_angle
  - Radial growth consistency: how well r_n = phi^n holds
  - Golden angle deviation: |actual_gap - golden_angle| mean
  - Weave score: 0.5*coherence + 0.3*radial + 0.2*angle_fidelity

Cross-validates with AEON constants (GOLDEN_ANGLE_DEG, PHI).
Publishes xova.field_weave to context_broker.
"""
import json, math, os, sys, time

_BROKER_PATH   = r"C:\Xova\memory\context_broker.json"
_REPO_ROOT     = r"D:\github\wizardaax\ziltrix-sch-core"

PHI            = (1 + math.sqrt(5)) / 2
GOLDEN_ANGLE   = 2 * math.pi - 2 * math.pi / PHI   # ≈ 2.3999632 rad
GOLDEN_DEG     = math.degrees(GOLDEN_ANGLE)          # ≈ 137.5077641°
N_POINTS       = 50


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


def _get_aeon_golden_angle() -> float | None:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        slot = data.get("slots", {}).get("xova.aeon_last_run", {})
        c = slot.get("constants", {})
        gad = c.get("GOLDEN_ANGLE_DEG") or c.get("golden_angle_deg")
        if gad:
            return float(gad)
    except Exception:
        pass
    try:
        if _REPO_ROOT not in sys.path:
            sys.path.insert(0, _REPO_ROOT)
        import aeon_engine
        return float(getattr(aeon_engine, "GOLDEN_ANGLE_DEG", GOLDEN_DEG))
    except Exception:
        return None


def _std(vals: list[float]) -> float:
    if len(vals) < 2:
        return 0.0
    mu = sum(vals) / len(vals)
    return math.sqrt(sum((v - mu) ** 2 for v in vals) / len(vals))


def action_run() -> dict:
    # Generate phi-spiral points
    points = []
    for n in range(N_POINTS):
        r     = PHI ** (n / N_POINTS)        # normalised radial growth
        theta = n * GOLDEN_ANGLE
        x     = r * math.cos(theta)
        y     = r * math.sin(theta)
        points.append({"n": n, "r": round(r, 6), "theta": round(theta % (2 * math.pi), 6),
                       "x": round(x, 6), "y": round(y, 6)})

    # Consecutive angular gaps (should all be GOLDEN_ANGLE)
    thetas = [p["theta"] for p in points]
    gaps   = [(thetas[i + 1] - thetas[i]) % (2 * math.pi) for i in range(len(thetas) - 1)]
    angle_stdev  = _std(gaps)
    mean_gap     = sum(gaps) / len(gaps) if gaps else GOLDEN_ANGLE
    angle_dev    = abs(mean_gap - GOLDEN_ANGLE)
    angle_fid    = max(0.0, 1.0 - angle_dev / 0.01)

    # Radial growth: r_n = phi^(n/N) — check consistency
    rs           = [p["r"] for p in points]
    expected_rs  = [PHI ** (n / N_POINTS) for n in range(N_POINTS)]
    radial_errs  = [abs(rs[i] - expected_rs[i]) for i in range(N_POINTS)]
    radial_ok    = all(e < 1e-6 for e in radial_errs)
    radial_score = 1.0 if radial_ok else max(0.0, 1.0 - sum(radial_errs) / N_POINTS)

    # Coherence: low variance in angular gaps
    coh_score    = max(0.0, 1.0 - angle_stdev / 0.1)

    # AEON golden angle match
    aeon_gad     = _get_aeon_golden_angle()
    if aeon_gad is not None:
        aeon_match = abs(aeon_gad - GOLDEN_DEG) / GOLDEN_DEG
        angle_fid  = min(angle_fid, max(0.0, 1.0 - aeon_match * 1e4))
    else:
        aeon_gad = None

    score = round(0.5 * coh_score + 0.3 * radial_score + 0.2 * angle_fid, 4)

    payload = {
        "ok":           True,
        "n_points":     N_POINTS,
        "phi":          round(PHI, 8),
        "golden_angle": round(GOLDEN_ANGLE, 8),
        "golden_deg":   round(GOLDEN_DEG, 6),
        "aeon_golden_deg": aeon_gad,
        "coh_score":    round(coh_score, 4),
        "radial_score": round(radial_score, 4),
        "angle_fid":    round(angle_fid, 4),
        "score":        score,
        "mean_gap":     round(mean_gap, 8),
        "angle_stdev":  round(angle_stdev, 10),
        "points_sample": points[:10],
        "ts":           time.time(),
    }
    _write_context_slot("xova.field_weave", payload)
    return payload


def action_status() -> dict:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        slot = data.get("slots", {}).get("xova.field_weave")
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



# ── Field agent evolution patch (auto-written) ────────────────────────────────
# Golden angle drift: when computed angle deviates from 137.507764..° the
# spiral packing loses φ-harmonic structure. Alert when drift exceeds tolerance.

_GOLDEN_DEG_EXACT = 137.50776405003785  # 2π(1 - 1/φ) in degrees


def golden_angle_drift_alert(computed_deg: float,
                              tolerance_deg: float = 0.001) -> dict:
    """Alert when computed golden angle drifts beyond tolerance.

    Args:
        computed_deg:   the golden angle from field_weave output
        tolerance_deg:  max acceptable deviation (default 0.001°)
    Returns:
        dict with drift_deg, is_alert, severity
    """
    drift = abs(computed_deg - _GOLDEN_DEG_EXACT)
    if drift < tolerance_deg:
        severity = "none"
    elif drift < tolerance_deg * 10:
        severity = "minor"
    elif drift < tolerance_deg * 100:
        severity = "major"
    else:
        severity = "critical"
    return {
        "computed_deg": computed_deg,
        "expected_deg": _GOLDEN_DEG_EXACT,
        "drift_deg": round(drift, 8),
        "is_alert": drift >= tolerance_deg,
        "severity": severity,
    }
