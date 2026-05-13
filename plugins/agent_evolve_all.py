"""
agent_evolve_all.py — sequentially fire all 7 agent_evolve domains.

Wrapper around agent_evolve.py. Runs each of the 7 evolve-agents
(coherence, phase, field, sentinel, memory, corpus, repo) one at a time
so they don't contend for the Ollama lock or write to the same files
simultaneously. Each agent_evolve invocation:
  1. Reads its broker domain
  2. WRITES eval Python code on the fly
  3. Runs it in a sandbox subprocess (30s timeout)
  4. Submits a self-mod proposal via self_modifier.py → persona_governor.consult
     (which calls Xova — she is the operational decider per SCE-88)
  5. Returns gap list + proposal id

Designed to be invoked by Windows Task Scheduler (pythonw, no console).
Logs each run to C:\\Xova\\memory\\schedule\\agent_evolve_all.jsonl.

Stdlib only. RULE 1: ADD only — does NOT modify agent_evolve.py.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

_AGENT_EVOLVE = r"C:\Xova\plugins\agent_evolve.py"
_LOG_PATH     = r"C:\Xova\memory\schedule\agent_evolve_all.jsonl"

# Match the _GENERATORS dict order in agent_evolve.py — domain identifiers
# come from that file's CLI choices.
_AGENTS = [
    ("coherence", "rff_coherence"),
    ("phase",     "lucas_phi"),
    ("field",     "spiral_geometry"),
    ("sentinel",  "sce88_constraint"),
    ("memory",    "context_slots"),
    ("corpus",    "knowledge_coverage"),
    ("repo",      "ci_health"),
]

_PER_AGENT_TIMEOUT_S = 90   # ample budget for sandbox + Xova consult round-trip


def _resolve_python_exe() -> str:
    """Use python.exe (not pythonw.exe) so the sandbox subprocess in
    agent_evolve.py can capture stdout properly — same fix as agent_11."""
    exe = sys.executable
    if exe.lower().endswith("pythonw.exe"):
        cand = exe[:-len("pythonw.exe")] + "python.exe"
        if os.path.exists(cand):
            return cand
    return exe


def _run_one(agent: str, domain: str, py_exe: str) -> dict:
    started = time.time()
    try:
        proc = subprocess.run(
            [py_exe, _AGENT_EVOLVE, "--agent", agent, "--domain", domain],
            capture_output=True, text=True,
            timeout=_PER_AGENT_TIMEOUT_S,
            encoding="utf-8",
        )
    except subprocess.TimeoutExpired:
        return {
            "agent":   agent,
            "domain":  domain,
            "ok":      False,
            "reason":  f"timed out after {_PER_AGENT_TIMEOUT_S}s",
            "elapsed": time.time() - started,
        }
    except Exception as exc:
        return {
            "agent":   agent,
            "domain":  domain,
            "ok":      False,
            "reason":  f"invocation error: {exc}",
            "elapsed": time.time() - started,
        }

    elapsed = time.time() - started
    parsed: dict = {}
    try:
        parsed = json.loads(proc.stdout.strip())
    except Exception:
        parsed = {"_unparsed": True, "stdout_tail": proc.stdout[-500:],
                  "stderr_tail": proc.stderr[-500:]}

    summary = {
        "agent":   agent,
        "domain":  domain,
        "ok":      parsed.get("ok", proc.returncode == 0),
        "healthy": parsed.get("healthy"),
        "gaps":    parsed.get("gaps", []),
        "elapsed": round(elapsed, 2),
        "exit":    proc.returncode,
    }
    prop = parsed.get("proposal")
    if isinstance(prop, dict):
        summary["proposal_ok"] = prop.get("ok")
        summary["proposal_id"] = prop.get("id")
        summary["xova_approved"] = prop.get("approved")
        summary["sce88_pass"] = prop.get("sce88_pass")
        summary["sce88_coherence"] = prop.get("sce88_coherence")
    return summary


def _log_run(record: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_LOG_PATH), exist_ok=True)
        line = json.dumps(record, ensure_ascii=False, default=str)
        # ring buffer 500 lines
        existing: list[str] = []
        if os.path.exists(_LOG_PATH):
            try:
                with open(_LOG_PATH, encoding="utf-8") as fh:
                    existing = fh.read().splitlines()
            except Exception:
                pass
        existing = existing[-499:]
        existing.append(line)
        tmp = _LOG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write("\n".join(existing) + "\n")
        os.replace(tmp, _LOG_PATH)
    except Exception:
        pass


def run_all() -> dict:
    py_exe = _resolve_python_exe()
    started = time.time()
    results: list[dict] = []
    proposals_made = 0
    proposals_approved = 0
    total_gaps = 0

    for agent, domain in _AGENTS:
        r = _run_one(agent, domain, py_exe)
        results.append(r)
        gaps = r.get("gaps") or []
        total_gaps += len(gaps)
        if r.get("proposal_id"):
            proposals_made += 1
            if r.get("xova_approved"):
                proposals_approved += 1

    aggregate = {
        "ts":                 time.time(),
        "elapsed_s":          round(time.time() - started, 2),
        "n_agents":           len(_AGENTS),
        "total_gaps_found":   total_gaps,
        "proposals_made":     proposals_made,
        "proposals_approved": proposals_approved,
        "results":            results,
    }
    _log_run(aggregate)
    return aggregate


def main() -> int:
    result = run_all()
    payload = json.dumps(result, ensure_ascii=False, indent=2, default=str)
    try:
        if sys.stdout is not None:
            try: sys.stdout.reconfigure(encoding="utf-8")
            except Exception: pass
            print(payload)
    except Exception:
        pass
    # exit code reflects whether all agents at least returned (not whether
    # they found gaps — gaps are normal output, not errors).
    any_failed = any(not r.get("ok") for r in result["results"])
    return 1 if any_failed else 0


if __name__ == "__main__":
    sys.exit(main())
