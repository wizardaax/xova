"""Patch by field_agent — Add golden_angle_drift_alert() to field_weave.py. Detects when spiral golden angle deviates from 137
"""
# Target: C:\Xova\plugins\field_weave.py
# Generated: 2026-05-07T12:20:32Z
# PatchID: 19a404d9829d



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
