"""Patch by sentinel_agent — Add violation_rate() to sce88_gate.py. Computes rolling SCE-88 violation rate per hour from the log,
"""
# Target: C:\Xova\plugins\sce88_gate.py
# Generated: 2026-05-07T12:20:33Z
# PatchID: 3e2a0c4ed37f



# ── Sentinel agent evolution patch (auto-written) ────────────────────────────
# Violation rate tracking: raw count doesn't show trend. Rate over window
# tells sentinel whether the system is improving or degrading.


def violation_rate(violations_log_path: str, window_seconds: float = 3600.0) -> dict:
    """Compute SCE-88 violation rate over a rolling time window.

    Args:
        violations_log_path: path to sentinel_violations.jsonl
        window_seconds:      rolling window (default: 1 hour)
    Returns:
        dict with count, rate_per_hour, is_escalating
    """
    import time as _time
    import json as _json
    now = _time.time()
    cutoff = now - window_seconds
    count = 0
    oldest_ts = now

    try:
        with open(violations_log_path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    v = _json.loads(line)
                    ts = float(v.get("ts", 0))
                    src = str(v.get("source", ""))
                    if ts >= cutoff and "test" not in src:
                        count += 1
                        if ts < oldest_ts:
                            oldest_ts = ts
                except Exception:
                    pass
    except FileNotFoundError:
        pass

    elapsed = now - oldest_ts if count > 0 else window_seconds
    rate = count / (elapsed / 3600.0) if elapsed > 0 else 0.0
    return {
        "window_s": window_seconds,
        "count": count,
        "rate_per_hour": round(rate, 4),
        "is_escalating": rate > 5.0,
    }
