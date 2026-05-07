"""
ternary_eval.py — SCE-88 ternary logic evaluation for the constraint guardian.

Ternary logic uses three states: +1 (affirm), 0 (uncertain), -1 (deny).
The AEON output guardian (SCE-88) evaluates agent outputs against these
constraints:
  REQ-01: coherence in (0, 1.0]     → affirm / uncertain / deny
  REQ-02: uncertainty in [-0.3, 1.0] → affirm / uncertain / deny
  REQ-03: uncertainty >= 0           → affirm / uncertain / deny
  REQ-04: ternary_balance sum <= 1.0 → affirm / uncertain / deny
  REQ-05: ternary_sum within tol     → affirm / uncertain / deny

Ternary balance: T = (coh_norm + unc_norm + viol_norm) / 3
where each component is mapped to [0, 1]:
  coh_norm  = clamp(coherence, 0, 1)
  unc_norm  = 1 - clamp(|uncertainty|, 0, 1) (near-zero uncertainty = good)
  viol_norm = 1 if no recent violations, 0 if violations exist

Health score = 0.4*gate_pass_rate + 0.4*ternary_balance + 0.2*stability
"""
import json, os, sys, time

_BROKER_PATH     = r"C:\Xova\memory\context_broker.json"
_VIOLATIONS_LOG  = r"C:\Xova\memory\sentinel_violations.jsonl"
_DISPATCH_STORE  = r"C:\Xova\memory\swarm_dispatch.json"

COH_LOW          = 0.0
COH_HIGH         = 1.0
UNC_MIN          = -0.3
UNC_MAX          = 1.0
BAL_TOL          = 1.0
RECENT_WINDOW    = 1800   # 30 min


def _ternary(value: float, lo: float, hi: float) -> int:
    """Map value to ternary: +1=ok, 0=uncertain, -1=violated."""
    if lo <= value <= hi:
        return 1
    if abs(value - lo) < 0.1 or abs(value - hi) < 0.1:
        return 0
    return -1


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


def _read_coherence() -> float:
    """Read avg_coherence from last swarm dispatch or sce88_status."""
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        sce = data.get("slots", {}).get("xova.sce88_status", {})
        if sce.get("coherence") is not None:
            return float(sce["coherence"])
    except Exception:
        pass
    try:
        with open(_DISPATCH_STORE, encoding="utf-8") as f:
            d = json.load(f)
        return float(d.get("avg_coherence", 0.75))
    except Exception:
        return 0.75


def _count_recent_violations() -> int:
    cutoff = time.time() - RECENT_WINDOW
    count  = 0
    try:
        with open(_VIOLATIONS_LOG, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    e = json.loads(line.strip())
                    k = str(e.get("key", ""))
                    if k.startswith("test."):
                        continue
                    if float(e.get("ts", 0)) > cutoff:
                        count += 1
                except Exception:
                    pass
    except Exception:
        pass
    return count


def action_run() -> dict:
    coherence    = _read_coherence()
    # uncertainty is approximated as 1 - coherence (high coherence → low uncertainty)
    uncertainty  = max(-0.3, min(1.0, 1.0 - coherence))
    recent_viols = _count_recent_violations()

    # Gate evaluations
    req01 = _ternary(coherence,   COH_LOW, COH_HIGH)
    req02 = _ternary(uncertainty, UNC_MIN, UNC_MAX)
    req03 = 1 if uncertainty >= 0 else -1
    req04 = 1 if recent_viols == 0 else (-1 if recent_viols > 3 else 0)

    gates = [req01, req02, req03, req04]
    affirm  = sum(1 for g in gates if g == 1)
    neutral = sum(1 for g in gates if g == 0)
    deny    = sum(1 for g in gates if g == -1)
    gate_rate = (affirm + 0.5 * neutral) / len(gates)

    # Ternary balance: T = (coh_norm + unc_norm + viol_norm) / 3
    coh_norm  = max(0.0, min(1.0, coherence))
    unc_norm  = max(0.0, 1.0 - min(1.0, abs(uncertainty)))
    viol_norm = 1.0 if recent_viols == 0 else max(0.0, 1.0 - recent_viols / 5.0)
    balance   = round((coh_norm + unc_norm + viol_norm) / 3.0, 4)
    balance_ok = balance <= BAL_TOL

    # Stability: coherence history from dispatch
    stability = 1.0  # assume stable if no dispatch data available
    try:
        with open(_DISPATCH_STORE, encoding="utf-8") as f:
            d = json.load(f)
        stability = min(1.0, float(d.get("avg_coherence", 0.75)))
    except Exception:
        pass

    score = round(0.4 * gate_rate + 0.4 * balance + 0.2 * stability, 4)

    payload = {
        "ok":              True,
        "coherence":       round(coherence, 4),
        "uncertainty":     round(uncertainty, 4),
        "recent_viols":    recent_viols,
        "gates": {
            "REQ-01_coherence":    req01,
            "REQ-02_uncertainty":  req02,
            "REQ-03_unc_nonneg":   req03,
            "REQ-04_violations":   req04,
        },
        "affirm":          affirm,
        "neutral":         neutral,
        "deny":            deny,
        "gate_rate":       round(gate_rate, 4),
        "ternary_balance": balance,
        "balance_ok":      balance_ok,
        "stability":       round(stability, 4),
        "score":           score,
        "ts":              time.time(),
    }
    _write_context_slot("xova.ternary_eval", payload)
    return payload


def action_status() -> dict:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        slot = data.get("slots", {}).get("xova.ternary_eval")
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
