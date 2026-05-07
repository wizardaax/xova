"""
agent_write_code.py — Agent autonomous code-writing and patch submission.

Each agent in the fleet can call this to:
  1. Inspect its domain state (from context_broker + its plugin file)
  2. WRITE actual Python code that improves that plugin
  3. Save the patch to memory/evolution_patches/<agent>_<ts>_<hash>.py
  4. Submit the patch entry to memory/agent_patch_queue.jsonl for Adam's review

This is the difference between evaluation and evolution:
- agent_evolve.py  → evaluation (find gaps)
- agent_write_code.py → evolution (write code to fix gaps)

The patch is real, runnable Python. Adam reviews and applies via:
  python agent_write_code.py --apply <patch_id>

Stdlib only. No network. 100-year rule. All patches append-only in queue.
"""
from __future__ import annotations
import argparse, ast, hashlib, json, os, subprocess, sys, time

PATCHES_DIR   = r"C:\Xova\memory\evolution_patches"
PATCH_QUEUE   = r"C:\Xova\memory\agent_patch_queue.jsonl"
CONTEXT_BROKER = r"C:\Xova\memory\context_broker.json"
FORGE_REPORT  = r"C:\Xova\plugins\forge_report.py"
ACTION_TRACE  = r"C:\Xova\plugins\action_trace_write.py"
NO_WIN        = 0x08000000


def _read_broker() -> dict:
    try:
        with open(CONTEXT_BROKER, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _slot_value(broker: dict, key: str):
    slot = broker.get("slots", {}).get(key, {})
    if isinstance(slot, dict) and "value" in slot:
        return slot["value"]
    # some slots store directly (no value wrapper)
    return slot if slot else None


def _read_plugin(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _patch_id(agent: str, ts: float) -> str:
    seed = f"{agent}-{ts}"
    return hashlib.sha256(seed.encode()).hexdigest()[:12]


def _validate_syntax(code: str) -> tuple[bool, str]:
    try:
        ast.parse(code)
        return True, ""
    except SyntaxError as e:
        return False, f"SyntaxError line {e.lineno}: {e.msg}"


def _report(agent: str, text: str) -> None:
    try:
        subprocess.run([sys.executable, FORGE_REPORT,
                        "--text", text[:300], "--from", agent],
                       capture_output=True, timeout=10, creationflags=NO_WIN)
    except Exception:
        pass


def _trace(action: str, plugin: str, summary: str) -> None:
    try:
        subprocess.run([sys.executable, ACTION_TRACE,
                        "--action", action, "--plugin", plugin,
                        "--summary", summary[:200]],
                       capture_output=True, timeout=10, creationflags=NO_WIN)
    except Exception:
        pass


# ── Per-agent code writers ────────────────────────────────────────────────────
# Each returns (target_plugin_path, new_code_to_append, description)

def _write_coherence_patch(broker: dict) -> tuple[str, str, str]:
    """Coherence agent: add φ-weighted moving average to rff_score.py."""
    target = r"C:\Xova\plugins\rff_score.py"
    existing = _read_plugin(target)

    if "phi_weighted_ma" in existing:
        return target, "", "phi_weighted_ma already present — no patch needed"

    cycles = _slot_value(broker, "agents.last_cycles") or []
    cohs = [c.get("avg_coherence", 0) for c in cycles if isinstance(c, dict)]
    trend = (cohs[-1] - cohs[0]) if len(cohs) > 1 else 0.0

    code = f'''

# ── Coherence agent evolution patch (auto-written {time.strftime("%Y-%m-%d")}) ──────
# Detected trend={trend:.3f} in last {len(cohs)} cycles. Added φ-weighted MA
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
'''
    return target, code, (
        f"Add phi_weighted_ma() and coherence_trend() to rff_score.py. "
        f"Detected coherence trend={trend:.3f} over {len(cohs)} cycles — "
        f"smooth MA needed for stable downstream signals."
    )


def _write_phase_patch(broker: dict) -> tuple[str, str, str]:
    """Phase agent: add phase-drift detector to lucas_phase.py."""
    target = r"C:\Xova\plugins\lucas_phase.py"
    existing = _read_plugin(target)

    if "phase_drift_detect" in existing:
        return target, "", "phase_drift_detect already present — no patch needed"

    code = '''

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
'''
    return target, code, (
        "Add phase_drift_detect() to lucas_phase.py. "
        "Tracks Lucas ratio drift from phi across cycles, "
        "returns magnitude + correction direction for mesh use."
    )


def _write_field_patch(broker: dict) -> tuple[str, str, str]:
    """Field agent: add golden angle drift alerter to field_weave.py."""
    target = r"C:\Xova\plugins\field_weave.py"
    existing = _read_plugin(target)

    if "golden_angle_drift_alert" in existing:
        return target, "", "golden_angle_drift_alert already present — no patch needed"

    code = '''

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
'''
    return target, code, (
        "Add golden_angle_drift_alert() to field_weave.py. "
        "Detects when spiral golden angle deviates from 137.50776405° "
        "with severity grading: none/minor/major/critical."
    )


def _write_sentinel_patch(broker: dict) -> tuple[str, str, str]:
    """Sentinel agent: add rate-of-violation tracker to sce88_gate.py."""
    target = r"C:\Xova\plugins\sce88_gate.py"
    existing = _read_plugin(target)

    if "violation_rate" in existing:
        return target, "", "violation_rate already present — no patch needed"

    code = '''

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
'''
    return target, code, (
        "Add violation_rate() to sce88_gate.py. "
        "Computes rolling SCE-88 violation rate per hour from the log, "
        "flags is_escalating when rate > 5/hr."
    )


def _write_memory_patch(broker: dict) -> tuple[str, str, str]:
    """Memory agent: add slot health scorer to context_broker.py."""
    target = r"C:\Xova\plugins\context_broker.py"
    existing = _read_plugin(target)

    if "slot_health_score" in existing:
        return target, "", "slot_health_score already present — no patch needed"

    code = '''

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
'''
    return target, code, (
        "Add slot_health_score() to context_broker.py. "
        "Scores overall memory health from slot freshness + critical slot presence. "
        "Mesh can gate tasks when score < 0.7."
    )


def _write_corpus_patch(broker: dict) -> tuple[str, str, str]:
    """Corpus agent: add knowledge gap detector to corpus_recall.py."""
    target = r"C:\Xova\plugins\corpus_recall.py"
    existing = _read_plugin(target)

    if "knowledge_gap_score" in existing:
        return target, "", "knowledge_gap_score already present — no patch needed"

    code = '''

# ── Corpus agent evolution patch (auto-written) ──────────────────────────────
# Knowledge gap scoring: corpus size alone doesn\'t reveal gaps. This
# computes a per-domain gap score so curiosity_engine can target sparse areas.


def knowledge_gap_score(corpus_path: str, domain_keywords: list = None) -> dict:
    """Score knowledge gaps across domain keywords in the corpus index.

    Args:
        corpus_path:     path to corpus_index.json
        domain_keywords: list of domain terms to check (default: AEON domains)
    Returns:
        dict with gap_scores per domain, weakest_domain, overall_gap
    """
    import json as _json
    if domain_keywords is None:
        domain_keywords = ["aeon", "thrust", "coherence", "lucas", "fibonacci",
                           "phi", "ternary", "snell", "field", "riemann"]
    try:
        with open(corpus_path, encoding="utf-8") as fh:
            entries = _json.load(fh)
        if not isinstance(entries, list):
            entries = []
    except Exception:
        return {"gap_scores": {}, "weakest_domain": None, "overall_gap": 1.0}

    total = max(len(entries), 1)
    counts = {kw: 0 for kw in domain_keywords}
    for entry in entries:
        text = str(entry.get("excerpt", "") + " " + entry.get("path", "")).lower()
        for kw in domain_keywords:
            if kw in text:
                counts[kw] += 1

    gap_scores = {kw: round(1.0 - counts[kw] / total, 4) for kw in domain_keywords}
    weakest = max(gap_scores, key=gap_scores.get) if gap_scores else None
    overall = sum(gap_scores.values()) / len(gap_scores) if gap_scores else 1.0
    return {
        "gap_scores": gap_scores,
        "weakest_domain": weakest,
        "overall_gap": round(overall, 4),
        "entry_counts": counts,
    }
'''
    return target, code, (
        "Add knowledge_gap_score() to corpus_recall.py. "
        "Scores per-domain knowledge gaps in corpus index across AEON keywords. "
        "Feeds curiosity_engine with specific sparse domains to explore."
    )


def _write_repo_patch(broker: dict) -> tuple[str, str, str]:
    """Repo agent: add divergence scorer to ci_health.py."""
    target = r"C:\Xova\plugins\ci_health.py"
    existing = _read_plugin(target)

    if "repo_divergence_score" in existing:
        return target, "", "repo_divergence_score already present — no patch needed"

    code = '''

# ── Repo agent evolution patch (auto-written) ────────────────────────────────
# Repo divergence: ahead/dirty counts don\'t capture urgency. A divergence
# score lets mesh_runner prioritise sync tasks by severity.


def repo_divergence_score(repos: list) -> dict:
    """Compute a divergence urgency score from repo status list.

    Args:
        repos: list of repo dicts (name, ahead, dirty, clean, ok)
    Returns:
        dict with score [0=clean, 1=critical], worst_repo, breakdown
    """
    if not repos:
        return {"score": 0.0, "worst_repo": None, "breakdown": []}

    breakdown = []
    for r in repos:
        ahead = int(r.get("ahead", 0))
        dirty = int(r.get("dirty", 0))
        ci_fail = not r.get("ok", True)
        # Weight: CI failure > divergence > dirty
        penalty = (2.0 if ci_fail else 0.0) + min(ahead * 0.2, 1.0) + min(dirty * 0.1, 0.5)
        breakdown.append({"name": r.get("name", "?"), "penalty": round(penalty, 3)})

    penalties = [b["penalty"] for b in breakdown]
    worst_idx = penalties.index(max(penalties))
    score = min(sum(penalties) / len(penalties), 1.0)
    return {
        "score": round(score, 4),
        "worst_repo": breakdown[worst_idx]["name"],
        "breakdown": breakdown,
        "is_critical": score > 0.5,
    }
'''
    return target, code, (
        "Add repo_divergence_score() to ci_health.py. "
        "Computes urgency score from CI failures, ahead commits, dirty state. "
        "Lets mesh_runner triage repo sync tasks by severity."
    )


_WRITERS = {
    "coherence": _write_coherence_patch,
    "phase":     _write_phase_patch,
    "field":     _write_field_patch,
    "sentinel":  _write_sentinel_patch,
    "memory":    _write_memory_patch,
    "corpus":    _write_corpus_patch,
    "repo":      _write_repo_patch,
}


def write_patch(agent: str) -> dict:
    """Agent writes its own Python patch, saves it, queues for review."""
    broker = _read_broker()
    writer = _WRITERS.get(agent)
    if not writer:
        return {"ok": False, "error": f"no code writer for agent '{agent}'"}

    target, code, description = writer(broker)

    if not code:
        _report(f"{agent}_agent", f"{agent} code-writer: {description}")
        return {"ok": True, "agent": agent, "skipped": True, "reason": description}

    # Validate syntax before saving
    valid, err = _validate_syntax(code)
    if not valid:
        return {"ok": False, "agent": agent, "error": f"syntax error in generated code: {err}"}

    # Save patch file
    ts = time.time()
    pid = _patch_id(agent, ts)
    os.makedirs(PATCHES_DIR, exist_ok=True)
    patch_filename = f"{agent}_{int(ts)}_{pid}.py"
    patch_path = os.path.join(PATCHES_DIR, patch_filename)
    with open(patch_path, "w", encoding="utf-8") as f:
        f.write(f'"""Patch by {agent}_agent — {description[:100]}\n"""\n')
        f.write(f"# Target: {target}\n")
        f.write(f"# Generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ts))}\n")
        f.write(f"# PatchID: {pid}\n\n")
        f.write(code)

    # Queue entry
    entry = {
        "id":          pid,
        "agent":       agent,
        "target":      target,
        "patch_file":  patch_path,
        "description": description,
        "ts":          ts,
        "status":      "pending",
        "syntax_ok":   True,
    }
    with open(PATCH_QUEUE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    _report(f"{agent}_agent",
            f"{agent} wrote code patch → {patch_filename}: {description[:120]}")
    _trace("write", f"agent_write_code.{agent}",
           f"{agent} wrote Python patch for {os.path.basename(target)}: {pid}")

    return {
        "ok":          True,
        "agent":       agent,
        "patch_id":    pid,
        "patch_file":  patch_path,
        "target":      target,
        "description": description,
        "lines":       len(code.splitlines()),
    }


def apply_patch(patch_id: str) -> dict:
    """Adam calls this to append approved patch code to its target plugin."""
    # Read queue
    entries = []
    try:
        with open(PATCH_QUEUE, encoding="utf-8") as f:
            for line in f:
                try:
                    entries.append(json.loads(line))
                except Exception:
                    pass
    except FileNotFoundError:
        return {"ok": False, "error": "patch queue not found"}

    match = next((e for e in entries if e.get("id") == patch_id), None)
    if not match:
        return {"ok": False, "error": f"patch {patch_id} not found"}
    if match.get("status") == "applied":
        return {"ok": False, "error": "already applied"}

    target = match["target"]
    patch_file = match["patch_file"]

    # Read the code from the patch file (strip header)
    try:
        with open(patch_file, encoding="utf-8") as f:
            raw = f.read()
        # Strip the 4-line header (docstring + comments)
        lines = raw.splitlines()
        code_start = next((i for i, l in enumerate(lines) if l.startswith("# Target:")), 0) + 4
        code = "\n".join(lines[code_start:])
    except Exception as exc:
        return {"ok": False, "error": f"cannot read patch file: {exc}"}

    # Validate syntax once more before applying
    valid, err = _validate_syntax(code)
    if not valid:
        return {"ok": False, "error": f"syntax check failed: {err}"}

    # Append to target plugin
    try:
        with open(target, "a", encoding="utf-8") as f:
            f.write("\n" + code + "\n")
    except Exception as exc:
        return {"ok": False, "error": f"append to target failed: {exc}"}

    # Mark applied in queue (rewrite)
    for e in entries:
        if e.get("id") == patch_id:
            e["status"] = "applied"
            e["applied_at"] = time.time()
    with open(PATCH_QUEUE, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")

    return {"ok": True, "applied": patch_id, "target": target}


def main() -> None:
    ap = argparse.ArgumentParser(description="Agent autonomous code writer")
    ap.add_argument("--agent",  choices=list(_WRITERS.keys()),
                    help="Agent to run code-writing for")
    ap.add_argument("--all",    action="store_true",
                    help="Run all agents")
    ap.add_argument("--apply",  metavar="PATCH_ID",
                    help="Apply an approved patch by ID (Adam only)")
    ap.add_argument("--list",   action="store_true",
                    help="List pending patches")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")

    if args.list:
        try:
            with open(PATCH_QUEUE, encoding="utf-8") as f:
                entries = [json.loads(l) for l in f if l.strip()]
            pending = [e for e in entries if e.get("status") == "pending"]
            print(json.dumps({"pending": len(pending), "entries": pending},
                             ensure_ascii=False, indent=2))
        except FileNotFoundError:
            print(json.dumps({"pending": 0, "entries": []}))
        return

    if args.apply:
        print(json.dumps(apply_patch(args.apply), ensure_ascii=False, indent=2))
        return

    agents = list(_WRITERS.keys()) if args.all else ([args.agent] if args.agent else [])
    if not agents:
        ap.print_help()
        return

    results = []
    for agent in agents:
        result = write_patch(agent)
        results.append(result)
        print(json.dumps(result, ensure_ascii=False, indent=2))

    if len(results) > 1:
        ok = sum(1 for r in results if r.get("ok"))
        print(json.dumps({"summary": f"{ok}/{len(results)} agents wrote patches"},
                         ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
