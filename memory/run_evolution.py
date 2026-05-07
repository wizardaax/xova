"""Xova → EvolutionEngine bridge.

Runs one pass of the recursive self-evolution pipeline (observe → propose →
simulate → apply) and prints a JSON summary to stdout for Xova to display.

Stdlib + recursive_field_math.evolution.meta_engine only.
"""
from __future__ import annotations

import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Locate the recursive-field-math-pro source tree.
_REPO_SRC = r"D:\github\wizardaax\recursive-field-math-pro\src"
if os.path.isdir(_REPO_SRC) and _REPO_SRC not in sys.path:
    sys.path.insert(0, _REPO_SRC)

try:
    from recursive_field_math.evolution.meta_engine import EvolutionEngine
except Exception as e:
    print(json.dumps({"error": f"meta_engine unavailable: {e}"}))
    sys.exit(1)


def main() -> int:
    e = EvolutionEngine()

    # Stage 1: observe — scan agent metrics, gaps, coherence
    obs = e.observe()
    # Stage 2: propose — generate structural improvement candidates
    props = e.propose()
    # Stage 3: simulate — sandbox each proposal vs SCE-88
    sims = e.simulate(props) if props else []
    # Stage 4: apply — only low-risk patches auto-merge; structural changes need human gate
    applied = e.apply(sims) if sims else []

    state = e.state() if hasattr(e, "state") else {}

    # `applied` may be a dict (single result) or list (batch). Normalise.
    if isinstance(applied, dict):
        applied_list = [applied]
    elif isinstance(applied, list):
        applied_list = applied
    else:
        applied_list = []

    if isinstance(sims, dict):
        sims_list = [sims]
    elif isinstance(sims, list):
        sims_list = sims
    else:
        sims_list = []

    summary = {
        "stages": ["observe", "propose", "simulate", "apply"],
        "observed":   {
            "ok":         obs.get("ok") if isinstance(obs, dict) else None,
            "phase":      obs.get("phase") if isinstance(obs, dict) else None,
            "agents":     len(obs.get("agents", [])) if isinstance(obs, dict) else 0,
            "gaps":       len(obs.get("gaps", [])) if isinstance(obs, dict) else 0,
            "coherence":  obs.get("coherence") if isinstance(obs, dict) else None,
            "summary":    str(obs.get("summary", ""))[:300] if isinstance(obs, dict) else "",
        },
        "proposed":   len(props) if isinstance(props, list) else 0,
        "proposals":  [
            {
                # EvolutionEngine.propose() returns dicts shaped:
                # {id, category, target, description, patch, risk, human_gate, sce88_valid, gap}
                "category":  p.get("category") if isinstance(p, dict) else None,
                "target":    p.get("target") if isinstance(p, dict) else None,
                "description": (p.get("description", "")[:120]) if isinstance(p, dict) else "",
                "human_gate": bool(p.get("human_gate", False)) if isinstance(p, dict) else False,
                "risk":      p.get("risk") if isinstance(p, dict) else None,
                "sce88_valid": p.get("sce88_valid") if isinstance(p, dict) else None,
            }
            for p in (props or [])[:8]
        ] if isinstance(props, list) else [],
        "simulated":  len(sims_list),
        "applied":    len(applied_list),
        "applied_items": [
            {
                "category":  a.get("category") if isinstance(a, dict) else None,
                "target":    a.get("target") if isinstance(a, dict) else None,
                "description": (a.get("description", "")[:120]) if isinstance(a, dict) else "",
                "version":   a.get("version") if isinstance(a, dict) else None,
            }
            for a in applied_list[:8]
        ],
        "state": {
            "phase":              state.get("phase"),
            "observation_count":  state.get("observation_count"),
            "proposal_count":     state.get("proposal_count"),
            "simulation_count":   state.get("simulation_count"),
            "applied_count":      state.get("applied_count"),
        },
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
