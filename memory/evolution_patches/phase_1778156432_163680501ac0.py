"""Patch by phase_agent — Add phase_drift_detect() to lucas_phase.py. Tracks Lucas ratio drift from phi across cycles, returns
"""
# Target: C:\Xova\plugins\lucas_phase.py
# Generated: 2026-05-07T12:20:32Z
# PatchID: 163680501ac0



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
