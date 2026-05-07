"""Patch by memory_agent — Add slot_health_score() to context_broker.py. Scores overall memory health from slot freshness + cri
"""
# Target: C:\Xova\plugins\context_broker.py
# Generated: 2026-05-07T12:20:33Z
# PatchID: a2efc49c38ff



# ── Memory agent evolution patch (auto-written) ──────────────────────────────
# Slot health: not all slots are equal. Critical slots being stale or missing
# should lower an overall memory health score the mesh can act on.

_CRITICAL_SLOTS = [
    "forge.current_task",
    "agents.last_cycles",
    "xova.ternary_eval",
    "xova.ci_health",
    "federation.heartbeat",
]


def slot_health_score(store_path: str, stale_threshold_s: float = 7200.0) -> dict:
    """Score overall context_broker health based on slot freshness and completeness.

    Args:
        store_path:        path to context_broker.json
        stale_threshold_s: seconds before a slot is considered stale (2h default)
    Returns:
        dict with score [0,1], missing, stale, total_slots
    """
    import json as _json, time as _time
    now = _time.time()
    try:
        with open(store_path, encoding="utf-8") as fh:
            data = _json.load(fh)
        slots = data.get("slots", {})
    except Exception:
        return {"score": 0.0, "missing": _CRITICAL_SLOTS, "stale": [], "total_slots": 0}

    missing = [k for k in _CRITICAL_SLOTS if k not in slots]
    stale = []
    for key, val in slots.items():
        if isinstance(val, dict):
            ts = val.get("ts") or val.get("updated_at") or 0
            if ts and (now - float(ts)) > stale_threshold_s:
                stale.append(key)

    n = len(slots)
    missing_penalty = len(missing) / max(len(_CRITICAL_SLOTS), 1)
    stale_penalty = min(len(stale) / max(n, 1), 0.5)
    score = max(0.0, 1.0 - missing_penalty - stale_penalty)
    return {
        "score": round(score, 4),
        "missing": missing,
        "stale_count": len(stale),
        "stale_slots": stale[:5],
        "total_slots": n,
    }
