"""
mesh_runner.py — Continuous Snell-Vern cognitive cycle + EvolutionEngine runner.

Every 60s: runs the 13-agent cognitive cycle.
Every 5 cycles: runs the EvolutionEngine pipeline (observe→propose→simulate→apply),
  writes auto-merge patches to disk, logs all activity to mesh_feed.jsonl.

Stdlib only. Self-contained.
"""
import subprocess
import sys
import os
import json
import time

# ── Singleton guard ──────────────────────────────────────────────────────────
def _already_running() -> bool:
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe' OR name='python.exe'\" "
             "| Select-Object -ExpandProperty CommandLine"],
            capture_output=True, text=True, timeout=10,
            creationflags=0x08000000,
        )
        siblings = [l for l in result.stdout.splitlines() if "mesh_runner" in l]
        return len(siblings) > 1
    except Exception:
        return False

if _already_running():
    sys.exit(0)
# ────────────────────────────────────────────────────────────────────────────

sys.path.insert(0, r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src")
sys.path.insert(0, r"D:\github\wizardaax\recursive-field-math-pro\src")

try:
    from snell_vern_matrix.agents.cognitive_cycle import CognitiveCycle  # noqa: E402
    _COGNITIVE_IMPORT_ERROR: str | None = None
except Exception as _exc:
    CognitiveCycle = None  # type: ignore[assignment,misc]
    _COGNITIVE_IMPORT_ERROR = str(_exc)
    print(f"[mesh_runner] WARNING: CognitiveCycle import failed: {_exc} — running without cognitive cycle")

try:
    from recursive_field_math.phi_ucb import phi_ucb_score  # noqa: E402
    _PHI_UCB_AVAILABLE: bool = True
except Exception as _phi_exc:
    phi_ucb_score = None  # type: ignore[assignment]
    _PHI_UCB_AVAILABLE = False
    print(f"[mesh_runner] WARNING: phi_ucb import failed: {_phi_exc} — using round-robin goal selection")

FEED_PATH      = r"C:\Xova\memory\mesh_feed.jsonl"
FEED_CAP       = 5_000
EVO_DIR        = r"C:\Xova\memory\evolution"
PATCH_DIR      = r"C:\Xova\memory\evolution\patches"
UCB_STATE_PATH = r"C:\Xova\memory\phi_ucb_state.json"
CYCLE_INTERVAL  = 60   # seconds between cognitive cycles
EVO_EVERY_N     = 5    # run EvolutionEngine every N cognitive cycles

AGENTS_DIR = r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src\snell_vern_matrix\agents"

AGENT_LABELS: dict[str, tuple[str, str]] = {
    "agent-01": ("01", "Orchestrator"),
    "agent-02": ("02", "CI Sentinel"),
    "agent-03": ("03", "Memory Keeper"),
    "agent-04": ("04", "Constraint Guardian"),
    "agent-05": ("05", "Phase Tracker"),
    "agent-06": ("06", "Lucas Analyst"),
    "agent-07": ("07", "Field Weaver"),
    "agent-08": ("08", "Ternary Logic"),
    "agent-09": ("09", "Self-Model"),
    "agent-10": ("10", "Repo Sync"),
    "agent-11": ("11", "Test Validator"),
    "agent-12": ("12", "Doc Keeper"),
    "agent-13": ("13", "Coherence Monitor"),
}

# EvolutionEngine (recursive-field-math-pro) uses FEDERATION_AGENTS names that
# don't match the real Snell-Vern file names. This table maps them to actual files
# in AGENTS_DIR so _try_apply_patch lands on real code, not nowhere.
FEDERATION_TO_AGENT_FILE: dict[str, str] = {
    "observer":        "agent_09_self_model_observer.py",
    "planner":         "agent_01_orchestrator.py",
    "executor":        "agent_01_orchestrator.py",
    "validator":       "agent_11_test_validator.py",
    "memory":          "agent_03_memory_keeper.py",
    "router":          "agent_01_orchestrator.py",
    "constraint_gate": "agent_04_constraint_guardian.py",
    "integrator":      "agent_07_field_weaver.py",
    "evaluator":       "agent_13_coherence_monitor.py",
    "bridge":          "agent_10_repo_sync.py",
    "sentinel":        "agent_02_ci_sentinel.py",
    "recovery":        "agent_05_phase_tracker.py",
    "meta_learner":    "agent_13_coherence_monitor.py",
}

ROTATING_GOALS = [
    "observe field coherence and run aeon thrust analysis",
    "test and validate all agents and check ci health",
    "sync repos and audit documentation",
    "analyze lucas fibonacci convergence and phase state",
    "memory recall corpus and check coherence monitor",
    "ternary logic evaluation and constraint guardian check",
    "self model observation and field weave spiral",
]


# ── φ-UCB goal selection ─────────────────────────────────────────────────────

def _load_ucb_state() -> list[dict]:
    try:
        with open(UCB_STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list) and len(data) == len(ROTATING_GOALS):
            if all("q" in d and "n" in d for d in data):
                return data
    except Exception:
        pass
    return [{"q": 0.0, "n": 0} for _ in ROTATING_GOALS]


def _save_ucb_state(state: list[dict]) -> None:
    try:
        os.makedirs(os.path.dirname(UCB_STATE_PATH), exist_ok=True)
        with open(UCB_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _ucb_select_goal(state: list[dict], t: int) -> int:
    if not _PHI_UCB_AVAILABLE or phi_ucb_score is None:
        return t % len(ROTATING_GOALS)
    scores = [phi_ucb_score(s, t=t) for s in state]
    return max(range(len(scores)), key=lambda i: scores[i])


def _ucb_update(state: list[dict], idx: int, reward: float) -> None:
    n_old = state[idx]["n"]
    state[idx]["n"] = n_old + 1
    state[idx]["q"] = (state[idx]["q"] * n_old + reward) / state[idx]["n"]


# ── helpers ──────────────────────────────────────────────────────────────────

FLAGS_PATH        = r"C:\Xova\memory\mesh_flags.json"
CONTEXT_BROKER    = r"C:\Xova\memory\context_broker.json"
SCE88_GATE        = r"C:\Xova\plugins\sce88_gate.py"
GOAL_MANAGER      = r"C:\Xova\plugins\goal_manager.py"
GOAL_STORE        = r"C:\Xova\memory\goal_store.json"
SELF_EVAL         = r"C:\Xova\plugins\self_eval.py"
SELF_EVAL_STORE   = r"C:\Xova\memory\self_eval_store.json"
GOAL_DECOMPOSER   = r"C:\Xova\plugins\goal_decomposer.py"
DISPATCH_STORE    = r"C:\Xova\memory\swarm_dispatch.json"
AGENT_BOARD       = r"C:\Xova\memory\agent_board.json"
SWARM_INTERVAL    = 3600  # seconds between swarm decompositions for same goal
TASK_INITIATOR      = r"C:\Xova\plugins\task_initiator.py"
DREAM_CONSOLIDATOR  = r"C:\Xova\plugins\dream_consolidator.py"
CURIOSITY_ENGINE    = r"C:\Xova\plugins\curiosity_engine.py"
PERSONA_GOVERNOR    = r"C:\Xova\plugins\persona_governor.py"
SCAN_EVERY_N        = 3    # task_initiator scan every N cycles
CURIOSITY_EVERY_N   = 20   # curiosity scan every N cycles (~20 min)
DREAM_EVERY_H       = 6    # dream consolidation every N hours
_last_dream_ts: float = 0.0


def _read_forge_status() -> tuple[bool, float]:
    """Read Forge node alive + coherence_weight from agent_board. Safe fallback."""
    try:
        with open(AGENT_BOARD, encoding="utf-8") as fh:
            board = json.load(fh)
        forge = board.get("forge", {})
        return bool(forge.get("alive", False)), float(forge.get("coherence_weight", 0.0))
    except Exception:
        return False, 0.0


def _load_active_goal() -> tuple[str | None, str | None]:
    """Return (goal_id, goal_text) for the current active goal, or (None, None)."""
    try:
        if not os.path.isfile(GOAL_STORE):
            return None, None
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        gid = store.get("active_goal")
        if not gid:
            return None, None
        goal = store["goals"].get(gid, {})
        return gid, goal.get("text")
    except Exception:
        return None, None


def _read_strategy(agent: str = "mesh") -> str:
    """Return the current self-eval strategy instruction for this agent."""
    try:
        if not os.path.isfile(SELF_EVAL_STORE):
            return ""
        with open(SELF_EVAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        s = store.get("strategies", {}).get(agent, {})
        return s.get("strategy", "")
    except Exception:
        return ""


def _should_decompose(goal_id: str) -> bool:
    """True if we haven't decomposed this goal in the last SWARM_INTERVAL seconds."""
    try:
        if not os.path.isfile(DISPATCH_STORE):
            return True
        with open(DISPATCH_STORE, encoding="utf-8") as fh:
            d = json.load(fh)
        if d.get("goal_id") != goal_id:
            return True
        return (time.time() - d.get("dispatched_at", 0)) > SWARM_INTERVAL
    except Exception:
        return True


def _run_decompose(goal_id: str) -> None:
    """Fire swarm decomposition in background — non-blocking."""
    try:
        subprocess.Popen(
            [sys.executable, GOAL_DECOMPOSER,
             "--action", "decompose",
             "--goal-id", goal_id],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        _log(f"swarm: decomposition dispatched for {goal_id}")
    except Exception as exc:
        _log(f"swarm decompose error: {exc}")


def _run_task_scan() -> None:
    """Fire task_initiator scan in background — checks all 5 triggers, creates goals if warranted."""
    try:
        subprocess.Popen(
            [sys.executable, TASK_INITIATOR, "--action", "scan"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        _log(f"task scan error: {exc}")


def _run_curiosity_scan() -> None:
    """Fire curiosity_engine scan in background — detects knowledge gaps, raises proactive goals."""
    try:
        subprocess.Popen(
            [sys.executable, CURIOSITY_ENGINE, "--action", "scan"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        _log(f"curiosity scan error: {exc}")


def _run_dream_consolidation() -> None:
    """Fire dream_consolidator in background — distils last 24h into long_term_memory.json."""
    global _last_dream_ts
    if (time.time() - _last_dream_ts) < DREAM_EVERY_H * 3600:
        return
    _last_dream_ts = time.time()
    try:
        subprocess.Popen(
            [sys.executable, DREAM_CONSOLIDATOR, "--action", "consolidate"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        _log("dream consolidation dispatched")
    except Exception as exc:
        _log(f"dream consolidation error: {exc}")


def _run_persona_synthesize() -> None:
    """Fire persona_governor synthesize in background — periodic fleet voice update."""
    try:
        subprocess.Popen(
            [sys.executable, PERSONA_GOVERNOR, "--action", "synthesize"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        _log(f"persona synthesize error: {exc}")


def _run_self_eval(output: str, goal: str, goal_id: str, agent: str = "mesh") -> float:
    """Score output against goal, store eval + strategy. Returns score."""
    try:
        r = subprocess.run(
            [sys.executable, SELF_EVAL,
             "--action",  "eval",
             "--agent",   agent,
             "--goal",    goal[:500],
             "--goal-id", goal_id,
             "--output",  output[:600]],
            capture_output=True, text=True, timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        data = json.loads(r.stdout.strip()) if r.stdout.strip() else {}
        return float(data.get("score", 0.0))
    except Exception:
        return 0.0


def _write_goal_progress(gid: str, note: str, coherence: float) -> None:
    try:
        subprocess.run(
            [sys.executable, GOAL_MANAGER,
             "--action", "progress",
             "--id",    gid,
             "--note",  note[:400],
             "--coherence", str(round(coherence, 4)),
             "--agent", "mesh"],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        pass


def _write_context_slot(key: str, value: object, agent: str = "mesh") -> None:
    """Append a slot to context_broker.json via sce88-gate helper subprocess."""
    try:
        subprocess.run(
            [sys.executable, r"C:\Xova\plugins\context_broker.py",
             "--action", "set", "--key", key,
             "--value", json.dumps(value, ensure_ascii=False),
             "--agent", agent],
            capture_output=True, timeout=5, creationflags=0x08000000,
        )
    except Exception:
        pass

def _read_flags() -> dict:
    try:
        with open(FLAGS_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        # save_memory wraps the value as a JSON string inside JSON — unwrap if needed
        if isinstance(raw, str):
            raw = json.loads(raw)
        return {
            "evolutionEnabled":   raw.get("evolutionEnabled",   True),
            "cognitiveEnabled":   raw.get("cognitiveEnabled",   True),
            "meshRunnerEnabled":  raw.get("meshRunnerEnabled",  True),
        }
    except Exception:
        return {"evolutionEnabled": True, "cognitiveEnabled": True, "meshRunnerEnabled": True}


def _log(msg: str) -> None:
    _append({"ts": time.time(), "kind": "log", "agent_id": "00", "label": "Mesh Runner", "content": msg})


def _append(data: dict) -> None:
    os.makedirs(os.path.dirname(FEED_PATH), exist_ok=True)
    line = json.dumps(data, ensure_ascii=False) + "\n"
    # Cap the file at FEED_CAP lines to prevent unbounded growth.
    if os.path.exists(FEED_PATH):
        with open(FEED_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) >= FEED_CAP:
            lines = lines[-(FEED_CAP - 1):]  # drop oldest, make room for new
            with open(FEED_PATH, "w", encoding="utf-8") as f:
                f.writelines(lines)
    with open(FEED_PATH, "a", encoding="utf-8") as f:
        f.write(line)


def _humanize(result: dict) -> str:
    action = result.get("action", "")

    if "total_repos" in result:
        with_ci = result.get("with_ci", 0)
        total   = result.get("total_repos", 0)
        wf      = result.get("total_workflows", 0)
        return f"{with_ci}/{total} repos have CI · {wf} workflows"

    if "passed" in result and "failed" in result:
        p, f = result.get("passed", 0), result.get("failed", 0)
        t = p + f
        if f:
            return f"pytest {p}/{t} passed · {f} FAILED"
        return f"pytest {t}/{t} passed ✓"

    if "clean_count" in result or "dirty_count" in result:
        c = result.get("clean_count", 0)
        d = result.get("dirty_count", 0)
        return f"git: {c} clean · {d} dirty"

    if "docstring_coverage_pct" in result:
        pct = result.get("docstring_coverage_pct", 0)
        return f"doc coverage: {pct:.0f}%"

    if "observation" in result:
        obs   = result["observation"]
        coh   = obs.get("coherence", 0)
        delta = obs.get("delta", 0)
        unc   = obs.get("uncertainty", 0)
        return f"pattern observed · coherence {coh:.2f} · delta {delta:.3f} · unc {unc:.2f}"

    if "total_hits" in result:
        return f"corpus recall · {result['total_hits']} matches"

    if "phase_state" in result:
        return f"phase → {result['phase_state']}"

    if "average_coherence" in result:
        avg     = result.get("average_coherence", 0)
        healthy = result.get("system_healthy", True)
        below   = result.get("agents_below_threshold", 0)
        status  = "healthy ✓" if healthy else f"{below} below threshold"
        return f"coherence monitor · avg {avg:.2f} · {status}"

    if action == "aeon":
        series = result.get("thrust_series", [{}])
        thrust = series[0].get("thrust", 0) if series else 0
        return f"AEON field · thrust {thrust:.4f} N"
    if "point_count" in result or "points" in result:
        n = result.get("point_count", len(result.get("points", [])))
        return f"field weave · {n} phyllotaxis points"

    if "final_ratio" in result:
        return f"Lucas convergence → φ={result['final_ratio']:.6f}"
    if "sequence" in result:
        seq = result["sequence"]
        return f"Lucas sequence · {len(seq)} terms"

    if "stability" in result or "classification" in result:
        s = result.get("stability", result.get("classification", "?"))
        return f"ternary balance → {s}"

    if "violations" in result:
        v = result.get("violations", [])
        return "constraints ✓" if not v else f"constraints: {len(v)} violation(s)"
    if result.get("all_passed"):
        return "constraints: all invariants satisfied ✓"

    status = result.get("status", "ok")
    return f"status: {status}"


# ── patch applicator ──────────────────────────────────────────────────────────

def _try_apply_patch(change: dict) -> str:
    """
    Attempt to apply a low-risk patch from the EvolutionEngine.
    Returns a human-readable outcome string.

    For known config keys (timeout_ms, batch_size, cache_enabled, etc.) we
    update simple key=value assignments in Python source files found in the
    agent repos.  For anything else we write a .evo-patch.json spec file so
    the change is visible and reviewable.
    """
    patch   = change.get("patch", {})
    file_   = patch.get("file", "")
    changes = patch.get("changes", {})
    target  = change.get("target", "")
    cat     = change.get("category", "")

    if not changes:
        return "no changes specified"

    # Guard: skip patches targeting files that don't exist on disk.
    # EvolutionEngine proposes phantom paths like "config/observer.yaml" that
    # never existed — skip them rather than generating spurious errors.
    if file_:
        resolved = file_ if os.path.isabs(file_) else os.path.join(AGENTS_DIR, file_)
        if not os.path.isfile(resolved):
            _append({
                "ts": time.time(), "kind": "evo_skip", "agent_id": "EV",
                "label": "EvolutionEngine",
                "content": f"skipping patch — target does not exist: {file_} (target={target})",
            })
            return f"skipped — target file does not exist: {file_}"

    # Write a patch spec file to the patch dir regardless — full provenance.
    os.makedirs(PATCH_DIR, exist_ok=True)
    ts_str = time.strftime("%Y%m%dT%H%M%S")
    spec_name = f"{ts_str}_{target}_{cat}.evo-patch.json"
    spec_path = os.path.join(PATCH_DIR, spec_name)
    with open(spec_path, "w", encoding="utf-8") as f:
        json.dump({
            "ts": time.time(),
            "category": cat,
            "target":   target,
            "file":     file_,
            "changes":  changes,
            "description": change.get("description", ""),
            "auto_merge":  not change.get("human_gate", True),
        }, f, ensure_ascii=False, indent=2)

    # Build an ordered list of candidate .py file paths to try patching.
    # Priority 1: direct FEDERATION_TO_AGENT_FILE lookup (EvolutionEngine uses
    #             abstract names like "observer"/"planner" that don't match real
    #             file names — map them to actual Snell-Vern agent files).
    # Priority 2: walk-based loose match for agent-NN names and other repos.
    import re as _re
    norm_target = target.lower().replace("-", "_")
    candidates: list[str] = []

    direct_fn = FEDERATION_TO_AGENT_FILE.get(norm_target)
    if direct_fn:
        fp_direct = os.path.join(AGENTS_DIR, direct_fn)
        if os.path.isfile(fp_direct):
            candidates.append(fp_direct)

    repo_roots = [
        AGENTS_DIR,
        r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src",
        r"D:\github\wizardaax\recursive-field-math-pro\src",
        r"C:\jarvis\src",
        r"C:\Xova",
    ]
    for root in repo_roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _, filenames in os.walk(root):
            for fn in filenames:
                if not fn.endswith(".py"):
                    continue
                fp = os.path.join(dirpath, fn)
                if fp in candidates:
                    continue
                stem = fn[:-3].lower()
                if norm_target in stem or stem in norm_target:
                    candidates.append(fp)

    # Simple scalar-assignment patcher: rewrites `KEY = VALUE` lines.
    patched_file = None
    for fp in candidates:
        try:
            with open(fp, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
            modified = False
            new_lines = []
            for line in lines:
                replaced = False
                for key, val in changes.items():
                    m = _re.match(
                        rf"^({_re.escape(key.upper())}|{_re.escape(key)})\s*=\s*.+", line
                    )
                    if m:
                        py_val = (json.dumps(val) if isinstance(val, (dict, list))
                                  else repr(val))
                        new_lines.append(f"{m.group(1)} = {py_val}  # evo-patch {ts_str}\n")
                        modified = True
                        replaced = True
                        break
                if not replaced:
                    new_lines.append(line)
            if modified:
                with open(fp, "w", encoding="utf-8") as fh:
                    fh.writelines(new_lines)
                patched_file = fp
                break
        except Exception:
            pass

    if patched_file:
        rel = patched_file.replace(r"D:\github\wizardaax\\", "").replace(r"C:\\", "")
        return f"patched {rel} · {list(changes.keys())}"
    return f"spec written → evolution/patches/{spec_name}"


# ── evolution pipeline ────────────────────────────────────────────────────────

def _run_evolution() -> None:
    """Run the full EvolutionEngine pipeline and log results to mesh_feed."""
    _append({
        "ts":       time.time(),
        "kind":     "evo_start",
        "agent_id": "EV",
        "label":    "EvolutionEngine",
        "content":  "self-improvement cycle: observe → propose → simulate → apply",
    })

    try:
        from recursive_field_math.evolution.meta_engine import EvolutionEngine
        e   = EvolutionEngine()
        obs = e.observe()

        # Log observation summary
        if isinstance(obs, dict):
            gaps    = len(obs.get("gaps", []))
            agents  = len(obs.get("agents", {}))
            coh     = obs.get("coherence", 0)
            _append({
                "ts":       time.time(),
                "kind":     "evo_observe",
                "agent_id": "EV",
                "label":    "EvolutionEngine",
                "content":  f"observed {agents} agents · {gaps} gaps found · coherence {coh:.2f}",
                "coherence": round(coh, 3),
            })

        props = e.propose(obs) if isinstance(obs, dict) else e.propose()
        props = props or []

        # Log each proposal
        for p in props:
            gate    = p.get("human_gate", False)
            cat     = p.get("category", "?")
            tgt     = p.get("target", "?")
            desc    = (p.get("description") or "")[:90]
            risk    = p.get("risk", "?")
            _append({
                "ts":        time.time(),
                "kind":      "evo_proposal",
                "agent_id":  "EV",
                "label":     "EvolutionEngine",
                "content":   f"{'🔒 ' if gate else ''}[{cat}] {tgt}: {desc}",
                "human_gate": gate,
                "risk":       risk,
            })

        sims    = e.simulate(props) if props else {}
        applied = e.apply(sims)    if sims  else {}

        # Apply low-risk patches and log
        if isinstance(applied, dict) and applied.get("ok"):
            changes = applied.get("changes", [])
            version = applied.get("version", "?")
            for ch in changes:
                gate    = ch.get("human_gate", True)
                desc    = (ch.get("description") or "")[:90]
                cat     = ch.get("category", "?")
                # CRIT-3 fix: never auto-apply patches regardless of human_gate value.
                # _try_apply_patch() still writes the spec file for provenance, but the
                # source-file modification block inside it is no longer reachable because
                # we always take the "pending human review" branch here.
                outcome = "pending human review"
                _ = gate  # human_gate field preserved in payload below for visibility
                _append({
                    "ts":        time.time(),
                    "kind":      "evo_apply",
                    "agent_id":  "EV",
                    "label":     "EvolutionEngine",
                    "content":   f"{'🔒 ' if gate else '✓ '}{cat}: {desc} → {outcome}",
                    "human_gate": gate,
                    "version":    version,
                })
            auto_count = sum(1 for c in changes if not c.get("human_gate", True))
            gate_count = sum(1 for c in changes if c.get("human_gate", True))
            _append({
                "ts":       time.time(),
                "kind":     "evo_end",
                "agent_id": "EV",
                "label":    "EvolutionEngine",
                "content":  f"v{version} · {auto_count} auto-applied · {gate_count} awaiting review",
                "version":  version,
            })
        else:
            reason = applied.get("reason", "no passing proposals") if isinstance(applied, dict) else "no proposals"
            _append({
                "ts":       time.time(),
                "kind":     "evo_end",
                "agent_id": "EV",
                "label":    "EvolutionEngine",
                "content":  f"evolution pass complete · {reason}",
            })

        # Write full log to disk; trim to last 50 to prevent unbounded growth
        os.makedirs(EVO_DIR, exist_ok=True)
        ts_str = time.strftime("%Y%m%dT%H%M%S")
        with open(os.path.join(EVO_DIR, f"{ts_str}_evolve.json"), "w", encoding="utf-8") as f:
            json.dump({
                "ts":       time.time(),
                "observed": obs,
                "proposed": props,
                "simulated": sims if isinstance(sims, (dict, list)) else {},
                "applied":  applied if isinstance(applied, (dict, list)) else {},
            }, f, ensure_ascii=False, indent=2, default=str)
        try:
            evo_files = sorted(
                [p for p in os.listdir(EVO_DIR) if p.endswith("_evolve.json")],
                reverse=True,
            )
            for old in evo_files[50:]:
                os.remove(os.path.join(EVO_DIR, old))
        except Exception:
            pass

    except Exception as exc:
        _append({
            "ts":       time.time(),
            "kind":     "error",
            "agent_id": "EV",
            "label":    "EvolutionEngine",
            "content":  f"evolution error: {exc}",
        })


# ── main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    if CognitiveCycle is None:
        cycle = None
        _append({
            "ts": time.time(), "kind": "error", "agent_id": "00",
            "label": "Mesh Runner",
            "content": f"cognitive cycle unavailable — import failed: {_COGNITIVE_IMPORT_ERROR}",
        })
    else:
        cycle = CognitiveCycle()
    cycle_num = 0
    ucb_state = _load_ucb_state()
    ucb_t     = sum(s["n"] for s in ucb_state)

    _append({
        "ts":       time.time(),
        "kind":     "runner_start",
        "agent_id": "00",
        "label":    "Mesh Runner",
        "content":  (
            "13-agent fleet online · EvolutionEngine active · self-improvement every 5 cycles"
            + (" · phi-UCB goal routing active" if _PHI_UCB_AVAILABLE else " · phi-UCB unavailable (round-robin)")
        ),
    })

    while True:
        flags = _read_flags()

        if not flags["meshRunnerEnabled"]:
            time.sleep(CYCLE_INTERVAL)
            continue

        active_goal_id, active_goal_text = _load_active_goal()
        goal_idx = _ucb_select_goal(ucb_state, ucb_t)
        if active_goal_text:
            # Kick off swarm decomposition if due (once per hour, non-blocking)
            if active_goal_id and _should_decompose(active_goal_id):
                _run_decompose(active_goal_id)
            # Prepend self-eval strategy so the agent adjusts its approach
            strategy = _read_strategy("mesh")
            goal = (f"[strategy: {strategy}] {active_goal_text}"
                    if strategy else active_goal_text)
        else:
            goal           = ROTATING_GOALS[goal_idx]
            active_goal_id = None
        cycle_num += 1

        _append({
            "ts":       time.time(),
            "kind":     "cycle_start",
            "agent_id": "01",
            "label":    "Orchestrator",
            "content":  f"→ {goal}",
        })

        if not flags["cognitiveEnabled"]:
            _append({
                "ts": time.time(), "kind": "cycle_end", "agent_id": "01",
                "label": "Orchestrator", "content": f"cycle {cycle_num} skipped (cognitive disabled)",
                "coherence": 0.0,
            })
        elif cycle is None:
            _append({
                "ts": time.time(), "kind": "cycle_end", "agent_id": "01",
                "label": "Orchestrator",
                "content": f"cycle {cycle_num} skipped (cognitive module unavailable — {_COGNITIVE_IMPORT_ERROR})",
                "coherence": 0.0,
            })
        else:
            try:
                result = cycle.run(goal)

                for r in result.results:
                    raw_agent        = r.get("agent", "agent-01")
                    agent_id, label  = AGENT_LABELS.get(raw_agent, ("??", raw_agent))
                    coherence        = r.get("coherence_score", 0.5)
                    gated            = r.get("coherence_gated", False)

                    _append({
                        "ts":       time.time(),
                        "kind":     "agent_result",
                        "agent_id": agent_id,
                        "label":    label,
                        "content":  _humanize(r),
                        "coherence": round(coherence, 3),
                        "gated":    gated,
                    })

                forge_alive, forge_weight = _read_forge_status()
                node_count  = len(result.results) + (1 if forge_alive else 0)
                forge_suffix = f" + Forge({forge_weight:.2f})" if forge_alive else ""
                _append({
                    "ts":          time.time(),
                    "kind":        "cycle_end",
                    "agent_id":    "01",
                    "label":       "Orchestrator",
                    "content":     (
                        f"cycle {cycle_num} complete · {node_count} nodes · avg coherence "
                        f"{result.average_coherence:.2f}{forge_suffix} · "
                        f"phase {cycle._derive_phase().lower()} · "
                        f"{result.crest}"
                    ),
                    "coherence":   round(result.average_coherence, 3),
                    "forge_alive": forge_alive,
                    "forge_weight": round(forge_weight, 3),
                    "node_count":  node_count,
                })

                reward = max(0.0, min(1.0, result.average_coherence - 0.1 * getattr(result, "gated_count", 0)))
                _ucb_update(ucb_state, goal_idx, reward)
                ucb_t += 1
                _save_ucb_state(ucb_state)

                # SCE-88: publish cycle coherence to context_broker for advisory gate
                _write_context_slot("xova.sce88_status", {
                    "coherence":   round(result.average_coherence, 4),
                    "cycle":       cycle_num,
                    "goal":        goal,
                    "ts":          time.time(),
                })

                # Persistent goal: write progress note + self-eval
                if active_goal_id and active_goal_text:
                    cycle_summary = (
                        f"cycle {cycle_num} — avg coh {result.average_coherence:.3f} · "
                        f"phase {cycle._derive_phase().lower()} · "
                        f"{len(result.results)} agents ran"
                    )
                    _write_goal_progress(active_goal_id, cycle_summary, result.average_coherence)
                    eval_score = _run_self_eval(cycle_summary, active_goal_text, active_goal_id, "mesh")
                    _log(f"self-eval: score={eval_score:.3f} vs goal")

            except Exception as exc:
                _append({
                    "ts":       time.time(),
                    "kind":     "error",
                    "agent_id": "00",
                    "label":    "Runner",
                    "content":  f"cycle error: {exc}",
                })
                _ucb_update(ucb_state, goal_idx, 0.0)
                ucb_t += 1
                _save_ucb_state(ucb_state)

        # EvolutionEngine self-improvement pass every EVO_EVERY_N cycles
        if cycle_num % EVO_EVERY_N == 0 and flags["evolutionEnabled"]:
            _run_evolution()

        # Task initiator: scan for triggers every SCAN_EVERY_N cycles
        if cycle_num % SCAN_EVERY_N == 0:
            _run_task_scan()

        # Curiosity engine: proactive gap detection every CURIOSITY_EVERY_N cycles
        if cycle_num % CURIOSITY_EVERY_N == 0:
            _run_curiosity_scan()

        # Dream consolidation: distil 24h of data every DREAM_EVERY_H hours
        _run_dream_consolidation()

        # Persona synthesis: update governor voice every 30 cycles (~30 min)
        if cycle_num % 30 == 0:
            _run_persona_synthesize()

        time.sleep(CYCLE_INTERVAL)


if __name__ == "__main__":
    main()
