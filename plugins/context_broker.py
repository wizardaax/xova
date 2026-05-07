"""
context_broker.py — shared context store for the Xova agent network.

Agents (forge, jarvis, mesh, xova) read and write named slots.
Slots persist to disk; optional TTL for expiry.

Actions:
  set  --key K --value JSON --agent A [--ttl 0] [--tags "t1,t2"]
  get  --key K
  list [--agent A] [--tag T]
  expire
  snapshot
"""
import argparse, json, os, sys, time

STORE_PATH = r"C:\Xova\memory\context_broker.json"

# ── SCE-88 write guard ────────────────────────────────────────────────────────
# Loaded once at import; falls back to stdlib mirror if Snell-Vern unavailable.
_sv_validate_coherence      = None
_sv_validate_uncertainty    = None
_sv_validate_ternary        = None
_sv_ConstraintViolation     = Exception

try:
    import sys as _sys
    _sys.path.insert(0, r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src")
    from snell_vern_matrix.self_model import (      # type: ignore[import]
        _validate_coherence      as _sv_validate_coherence,
        _validate_uncertainty    as _sv_validate_uncertainty,
        _validate_ternary_balance as _sv_validate_ternary,
        ConstraintViolation      as _sv_ConstraintViolation,
    )
except Exception:
    pass


VIOLATIONS_LOG = r"C:\Xova\memory\sentinel_violations.jsonl"
VIOLATIONS_CAP  = 1000


def _append_violation(source: str, context: str, coherence: float,
                      violations: list[str], **extra: object) -> None:
    entry = {"ts": time.time(), "source": source, "context": context,
             "coherence": coherence, "violations": violations, **extra}
    try:
        os.makedirs(os.path.dirname(VIOLATIONS_LOG), exist_ok=True)
        with open(VIOLATIONS_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        # rotate at cap
        with open(VIOLATIONS_LOG, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
        if len(lines) > VIOLATIONS_CAP:
            with open(VIOLATIONS_LOG, "w", encoding="utf-8") as fh:
                fh.writelines(lines[-VIOLATIONS_CAP:])
    except Exception:
        pass


def _extract_coherence(value: object) -> float:
    if isinstance(value, dict):
        c = value.get("coherence") or value.get("coherence_score")
        if isinstance(c, (int, float)):
            return float(c)
    return 0.0


def _sce88_check_value(value: object) -> list[str]:
    """Return a list of violation strings for constraint fields in *value*.
    Empty list means the value passed. Only inspects dict values."""
    if not isinstance(value, dict):
        return []
    violations: list[str] = []

    coh = value.get("coherence") if "coherence" in value else value.get("coherence_score")
    unc = value.get("uncertainty")
    tern = value.get("ternary")

    if coh is not None and isinstance(coh, (int, float)):
        if _sv_validate_coherence:
            try:
                _sv_validate_coherence(float(coh))
            except _sv_ConstraintViolation as e:
                violations.append(f"REQ-01 coherence: {e}")
            except Exception:
                pass
        elif not (0.0 <= float(coh) <= 1.0):
            violations.append(f"REQ-01 coherence {coh} out of [0,1]")

    if unc is not None and isinstance(unc, (int, float)):
        if _sv_validate_uncertainty:
            try:
                _sv_validate_uncertainty(float(unc))
            except _sv_ConstraintViolation as e:
                violations.append(f"REQ-03 uncertainty: {e}")
            except Exception:
                pass
        elif not (0.0 <= float(unc) <= 1.0):
            violations.append(f"REQ-03 uncertainty {unc} out of [0,1]")

    if tern is not None and isinstance(tern, (list, tuple)) and len(tern) == 3:
        t0, t1, t2 = tern
        if _sv_validate_ternary:
            try:
                _sv_validate_ternary((float(t0), float(t1), float(t2)))
            except _sv_ConstraintViolation as e:
                violations.append(f"REQ-04/05 ternary: {e}")
            except Exception:
                pass
        else:
            for i, v in enumerate([t0, t1, t2]):
                if not (-1.0 <= float(v) <= 1.0):
                    violations.append(f"REQ-04 t{i}={v} out of [-1,1]")
            if abs(float(t0) + float(t1) + float(t2)) > 1.0:
                violations.append(f"REQ-05 |sum|={abs(float(t0)+float(t1)+float(t2)):.3f} > 1")

    return violations


def _load() -> dict:
    if not os.path.isfile(STORE_PATH):
        return {"version": 1, "updated_at": time.time(), "slots": {}}
    try:
        with open(STORE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"version": 1, "updated_at": time.time(), "slots": {}}


def _save(store: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    store["updated_at"] = time.time()
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, indent=2, sort_keys=False)
    os.replace(tmp, STORE_PATH)


def _active(slot: dict) -> bool:
    ttl = slot.get("ttl", 0)
    if ttl and ttl > 0:
        return (time.time() - slot["ts"]) < ttl
    return True


def action_set(key: str, value_raw: str, agent: str, ttl: float, tags: list[str]) -> dict:
    try:
        value = json.loads(value_raw)
    except json.JSONDecodeError:
        value = value_raw  # treat as plain string

    violations = _sce88_check_value(value)

    slot: dict = {
        "agent": agent,
        "value": value,
        "ts":    time.time(),
        "ttl":   ttl,
        "tags":  tags,
    }
    if violations:
        slot["sce88_violations"] = violations  # annotate — write still proceeds
        _append_violation("broker", f"set:{key}", _extract_coherence(value), violations, key=key, agent=agent)

    store = _load()
    store["slots"][key] = slot
    _save(store)

    result: dict = {"ok": True, "key": key, "written": True}
    if violations:
        result["sce88_passed"]     = False
        result["sce88_violations"] = violations
    else:
        result["sce88_passed"] = True
    return result


def action_get(key: str) -> dict:
    store = _load()
    slot = store["slots"].get(key)
    if slot is None:
        return {"ok": False, "error": f"key not found: {key}"}
    if not _active(slot):
        return {"ok": False, "error": f"key expired: {key}"}
    return {"ok": True, "key": key, **slot}


def action_list(agent_filter: str | None, tag_filter: str | None) -> dict:
    store = _load()
    result = []
    for key, slot in store["slots"].items():
        if not _active(slot):
            continue
        if agent_filter and slot.get("agent") != agent_filter:
            continue
        if tag_filter and tag_filter not in slot.get("tags", []):
            continue
        result.append({"key": key, **slot})
    result.sort(key=lambda s: s["ts"], reverse=True)
    return {"ok": True, "count": len(result), "slots": result}


def action_expire() -> dict:
    store = _load()
    before = len(store["slots"])
    store["slots"] = {k: v for k, v in store["slots"].items() if _active(v)}
    purged = before - len(store["slots"])
    if purged:
        _save(store)
    return {"ok": True, "purged": purged, "remaining": len(store["slots"])}


def action_snapshot() -> dict:
    store = _load()
    active = {k: v for k, v in store["slots"].items() if _active(v)}
    return {"ok": True, "updated_at": store.get("updated_at", 0),
            "count": len(active), "slots": active}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="snapshot",
                    choices=["set", "get", "list", "expire", "snapshot"])
    ap.add_argument("--key",   default="")
    ap.add_argument("--value", default="null")
    ap.add_argument("--agent", default="forge")
    ap.add_argument("--ttl",   type=float, default=0.0)
    ap.add_argument("--tags",  default="")
    ap.add_argument("--tag",   default="")
    args = ap.parse_args()

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]

    if args.action == "set":
        result = action_set(args.key, args.value, args.agent, args.ttl, tags)
    elif args.action == "get":
        result = action_get(args.key)
    elif args.action == "list":
        result = action_list(args.agent or None, args.tag or None)
    elif args.action == "expire":
        result = action_expire()
    else:
        result = action_snapshot()

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))



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
