"""
sce88_gate.py — SCE-88 constraint validation gate.

Validates coherence, uncertainty, and ternary balance against the
Snell-Vern constraint rules. Returns advisory pass/fail — never blocks.

CLI:
    python sce88_gate.py --coherence 0.75 --uncertainty 0.3
                         --t0 0.1 --t1 0.0 --t2 -0.1
                         --context "forge_inbox"
Output (JSON to stdout):
    {"ok": true, "passed": true, "violations": [], "coherence": 0.75,
     "uncertainty": 0.3, "ternary": [0.1, 0.0, -0.1], "ms": 2}

Stdlib only. No network. Graceful fallback if Snell-Vern import fails.
"""
from __future__ import annotations
import argparse, json, os, sys, time

_SV_AVAILABLE = False
_validate_coherence = _validate_uncertainty = _validate_ternary_balance = None
ConstraintViolation = Exception  # fallback type alias

try:
    sys.path.insert(0, r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src")
    from snell_vern_matrix.self_model import (
        _validate_coherence,       # type: ignore[assignment]
        _validate_uncertainty,     # type: ignore[assignment]
        _validate_ternary_balance, # type: ignore[assignment]
        ConstraintViolation,       # type: ignore[assignment]
    )
    _SV_AVAILABLE = True
except Exception:
    pass


def check(
    coherence: float = 0.7,
    uncertainty: float = 0.3,
    t0: float = 0.1,
    t1: float = 0.0,
    t2: float = -0.1,
    context: str = "unknown",
) -> dict:
    t0_ms = time.monotonic()
    violations: list[str] = []

    if _SV_AVAILABLE:
        try:
            _validate_coherence(coherence)
        except ConstraintViolation as e:
            violations.append(f"REQ-01 coherence: {e}")
        except Exception as e:
            violations.append(f"REQ-01 coherence error: {e}")

        try:
            _validate_uncertainty(uncertainty)
        except ConstraintViolation as e:
            violations.append(f"REQ-03 uncertainty: {e}")
        except Exception as e:
            violations.append(f"REQ-03 uncertainty error: {e}")

        try:
            _validate_ternary_balance((t0, t1, t2))
        except ConstraintViolation as e:
            violations.append(f"REQ-04/05 ternary: {e}")
        except Exception as e:
            violations.append(f"REQ-04/05 ternary error: {e}")
    else:
        # Manual fallback — pure stdlib, mirrors Snell-Vern rules
        if not (0.0 <= coherence <= 1.0):
            violations.append(f"REQ-01 coherence out of [0,1]: {coherence}")
        if not (0.0 <= uncertainty <= 1.0):
            violations.append(f"REQ-03 uncertainty out of [0,1]: {uncertainty}")
        for i, v in enumerate([t0, t1, t2]):
            if not (-1.0 <= v <= 1.0):
                violations.append(f"REQ-04 t{i} out of [-1,1]: {v}")
        if abs(t0 + t1 + t2) > 1.0:
            violations.append(f"REQ-05 |t0+t1+t2|={abs(t0+t1+t2):.3f} > 1")

    elapsed_ms = int((time.monotonic() - t0_ms) * 1000)
    return {
        "ok":         True,
        "passed":     len(violations) == 0,
        "violations": violations,
        "coherence":  coherence,
        "uncertainty": uncertainty,
        "ternary":    [t0, t1, t2],
        "context":    context,
        "sv_available": _SV_AVAILABLE,
        "ms":         elapsed_ms,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="SCE-88 constraint gate")
    ap.add_argument("--coherence",   type=float, default=0.7)
    ap.add_argument("--uncertainty", type=float, default=0.3)
    ap.add_argument("--t0",         type=float, default=0.1)
    ap.add_argument("--t1",         type=float, default=0.0)
    ap.add_argument("--t2",         type=float, default=-0.1)
    ap.add_argument("--context",    type=str,   default="unknown")
    args = ap.parse_args()
    result = check(
        coherence=args.coherence,
        uncertainty=args.uncertainty,
        t0=args.t0, t1=args.t1, t2=args.t2,
        context=args.context,
    )
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
