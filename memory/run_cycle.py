"""
Xova → CognitiveCycle bridge.

Usage:  python C:\\Xova\\memory\\run_cycle.py "<goal>"

Runs one pass of the 13-agent cognitive cycle, writes a stamped log to
C:\\Xova\\memory\\cycles\\<timestamp>__<crest>.json, and prints a JSON
summary to stdout for Xova to display.

Stdlib + the local snell_vern_matrix package only — no external deps.
"""

from __future__ import annotations

import json
import os
import sys

# Force UTF-8 stdout so the crest glyphs (△▽◆◇…) survive Windows cp1252.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Locate the Snell-Vern source tree on disk.
_REPO_SRC = r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src"
if os.path.isdir(_REPO_SRC) and _REPO_SRC not in sys.path:
    sys.path.insert(0, _REPO_SRC)

try:
    from snell_vern_matrix.agents.cognitive_cycle import CognitiveCycle
except Exception as e:
    print(json.dumps({"error": f"cognitive_cycle unavailable: {e}"}))
    sys.exit(1)

LOG_DIR = r"C:\Xova\memory\cycles"


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no goal provided"}))
        return 2
    if len(sys.argv) >= 3 and sys.argv[1] == "--goal-file":
        try:
            with open(sys.argv[2], encoding="utf-8") as _f:
                goal = _f.read().strip()
        except Exception as _e:
            print(json.dumps({"error": f"cannot read goal file: {_e}"}))
            return 2
    else:
        goal = " ".join(sys.argv[1:])

    cc = CognitiveCycle(log_dir=LOG_DIR)
    result = cc.run(goal)

    summary = result.summary()
    summary["log_dir"] = LOG_DIR
    summary["results_preview"] = [
        {
            "agent": r.get("agent"),
            "task": r.get("task"),
            "coherence_score": r.get("coherence_score"),
            "coherence_gated": r.get("coherence_gated"),
        }
        for r in result.results[:3]
    ]
    # Surface real memory-keeper hits to Xova so the cycle pays off in chat.
    memory_results = [r for r in result.results if r.get("action") == "searched"]
    if memory_results:
        m = memory_results[0]
        summary["memory_query"] = m.get("query")
        summary["memory_total_hits"] = m.get("total_hits", 0)
        summary["memory_top"] = [
            {
                "name": hit.get("name"),
                "ext": hit.get("ext"),
                "score": hit.get("score"),
                "name_hit": hit.get("name_hit"),
            }
            for hit in m.get("top", [])[:5]
        ]

    # Surface lucas/fibonacci math output too.
    math_results = [r for r in result.results if r.get("action") in ("sequence", "convergence")]
    if math_results:
        m = math_results[0]
        if m.get("action") == "sequence":
            summary["math_action"] = "sequence"
            summary["math_values"] = m.get("values")
        else:
            summary["math_action"] = "convergence"
            summary["math_ratio"] = m.get("ratio")
            summary["math_phi"] = m.get("phi")
            summary["math_error"] = m.get("error")
            summary["math_converged"] = m.get("converged")

    # Surface coherence monitor — long-term drift across last 12 cycles.
    monitor_results = [r for r in result.results if "agents_below_threshold" in r and r.get("agent", "").endswith("-13")]
    if monitor_results:
        m = monitor_results[0]
        summary["monitor_avg_coherence"] = m.get("average_coherence")
        summary["monitor_system_healthy"] = m.get("system_healthy")
        summary["monitor_below_threshold"] = m.get("agents_below_threshold")

    # Surface CI sentinel — workflow file discovery across repos.
    ci_results = [r for r in result.results if r.get("action") == "audit" and r.get("agent", "").endswith("-02")]
    if ci_results:
        c = ci_results[0]
        summary["ci_total_repos"] = c.get("total_repos", 0)
        summary["ci_with_ci"] = c.get("with_ci", 0)
        summary["ci_without_ci"] = c.get("without_ci", 0)
        summary["ci_total_workflows"] = c.get("total_workflows", 0)
        summary["ci_no_ci_repos"] = [
            r["name"] for r in c.get("rows", []) if not r.get("has_ci")
        ][:6]

    # Surface doc keeper — docstring coverage + README audit.
    doc_results = [r for r in result.results if r.get("action") == "audit" and r.get("agent", "").endswith("-12")]
    if doc_results:
        d = doc_results[0]
        summary["doc_py_files"] = d.get("py_files", 0)
        summary["doc_module_cov"] = d.get("module_doc_coverage", 0.0)
        summary["doc_func_cov"] = d.get("function_doc_coverage", 0.0)
        summary["doc_class_cov"] = d.get("class_doc_coverage", 0.0)
        rd = d.get("readme") or {}
        summary["doc_readme_exists"] = rd.get("exists", False)
        summary["doc_readme_age_days"] = rd.get("age_days")

    # Surface repo sync — git status across wizardaax repos.
    sync_results = [r for r in result.results if r.get("action") == "status" and r.get("agent", "").endswith("-10")]
    if sync_results:
        s = sync_results[0]
        summary["sync_total"] = s.get("total", 0)
        summary["sync_clean"] = s.get("clean_count", 0)
        summary["sync_dirty"] = s.get("dirty_count", 0)
        summary["sync_ahead"] = s.get("ahead_count", 0)
        summary["sync_behind"] = s.get("behind_count", 0)
        # Trim repo list to dirty ones (those are what need attention)
        summary["sync_dirty_repos"] = [
            {"name": r["name"], "dirty": r.get("dirty_count", 0), "branch": r.get("branch", "?")}
            for r in s.get("repos", []) if not r.get("error") and not r.get("clean", True)
        ][:8]

    # Surface ternary logic — SCE-88 ternary balance evaluation.
    ternary_results = [r for r in result.results if "stability" in r and r.get("agent", "").endswith("-08")]
    if ternary_results:
        t = ternary_results[0]
        summary["ternary_stability"] = t.get("stability")
        summary["ternary_balance"] = t.get("balance")

    # Surface self-model observer — GlyphPhaseEngine + Lucas + field run on goal.
    obs_results = [r for r in result.results if "observation" in r and r.get("agent", "").endswith("-09")]
    if obs_results:
        o = obs_results[0]["observation"]
        summary["observe_delta"] = o.get("delta")
        summary["observe_uncertainty"] = o.get("uncertainty")
        summary["observe_coherence"] = o.get("coherence")

    # Surface phase tracker — GlyphPhaseEngine-style state.
    phase_results = [r for r in result.results if "current_phase" in r and r.get("agent", "").endswith("-05")]
    if phase_results:
        p = phase_results[0]
        summary["phase_state"] = p.get("current_phase")
        summary["phase_drift"] = p.get("drift_detected", False)
        summary["phase_history_len"] = p.get("history_length", 0)

    # Surface constraint guardian — SCE-88 invariant check.
    constraint_results = [r for r in result.results if "valid" in r and r.get("agent", "").endswith("-04")]
    if constraint_results:
        c = constraint_results[0]
        summary["constraint_valid"] = c.get("valid", False)
        summary["constraint_violations"] = c.get("violations", [])

    # Surface test validator — actual pytest run.
    test_results = [r for r in result.results if r.get("action") == "run" and r.get("agent", "").endswith("-11")]
    if test_results:
        t = test_results[0]
        summary["test_ran"] = t.get("ran", False)
        if t.get("ran"):
            summary["test_passed"] = t.get("passed", 0)
            summary["test_failed"] = t.get("failed", 0)
            summary["test_coverage"] = t.get("coverage", 0.0)
            summary["test_regression"] = t.get("regression_detected", False)
            summary["test_exit"] = t.get("exit_code", -1)
            summary["test_repo"] = t.get("repo_path", "")
        else:
            summary["test_reason"] = t.get("reason", "unknown")

    # Surface field weaver (r=a√n, θ=nφ phyllotaxis spiral OR AEON thrust).
    field_results = [r for r in result.results if r.get("agent", "").endswith("-07")]
    if field_results:
        f = field_results[0]
        if f.get("action") == "aeon" and f.get("ran"):
            summary["field_action"] = "aeon"
            consts = f.get("constants", {})
            summary["aeon_omega_n"] = consts.get("omega_n")
            summary["aeon_drive_freq_hz"] = consts.get("drive_freq_hz")
            summary["aeon_n3_medium"] = consts.get("n3_medium")
            summary["aeon_coupling_k"] = consts.get("coupling_k")
            ts = f.get("thrust_series", [])
            summary["aeon_thrust_series"] = [
                {"t": s.get("t"), "dphi_dt": s.get("dphi_dt"), "thrust": s.get("thrust")}
                for s in ts[:5]
            ]
            val = f.get("validation", {})
            summary["aeon_validation_matched"] = val.get("matched")
            summary["aeon_validation_max_err"] = val.get("max_rel_err")
        elif "golden_angle" in f:
            summary["field_golden_angle"] = f.get("golden_angle")
            if "points" in f:
                summary["field_action"] = "field"
                summary["field_points"] = f["points"][:8]
                summary["field_point_count"] = len(f["points"])
            elif "radius" in f:
                summary["field_action"] = "analysis"
                summary["field_radius"] = f.get("radius")
                summary["field_angle"] = f.get("angle")

    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
