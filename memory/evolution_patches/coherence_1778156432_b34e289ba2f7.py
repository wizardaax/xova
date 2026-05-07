"""Patch by coherence_agent — Add phi_weighted_ma() and coherence_trend() to rff_score.py. Detected coherence trend=-0.147 over 6 
"""
# Target: C:\Xova\plugins\rff_score.py
# Generated: 2026-05-07T12:20:32Z
# PatchID: b34e289ba2f7



# ── Coherence agent evolution patch (auto-written 2026-05-07) ──────
# Detected trend=-0.147 in last 6 cycles. Added φ-weighted MA
# so downstream agents can smooth noisy coherence readings.

import math as _math

_PHI_COHERENCE = (1 + _math.sqrt(5)) / 2  # golden ratio weight


def phi_weighted_ma(scores: list, alpha: float = None) -> float:
    """φ-weighted exponential moving average for coherence stability.

    Uses golden ratio as default decay factor — faster response to recent
    scores while retaining long-term memory proportional to φ.

    Args:
        scores: list of coherence floats in chronological order
        alpha:  decay weight; defaults to 1/φ ≈ 0.618
    Returns:
        smoothed coherence float in [0, 1]
    """
    if not scores:
        return 0.0
    if alpha is None:
        alpha = 1.0 / _PHI_COHERENCE  # ≈ 0.618
    result = float(scores[0])
    for s in scores[1:]:
        result = alpha * float(s) + (1.0 - alpha) * result
    return round(max(0.0, min(1.0, result)), 6)


def coherence_trend(scores: list) -> float:
    """Return linear trend of coherence over the window (positive=improving)."""
    n = len(scores)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(scores) / n
    num = sum((i - x_mean) * (scores[i] - y_mean) for i in range(n))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return round(num / den, 6) if den else 0.0
