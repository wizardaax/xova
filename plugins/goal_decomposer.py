"""
goal_decomposer.py — swarm-based goal decomposition for the federation.

Reads the active goal, uses CognitiveCycle.decompose() to get task types,
runs each task locally via AgentOrchestrator (all 13 Snell-Vern agents),
routes a task message to each matching federation agent inbox, then writes
aggregated results + progress note to goal_manager.

Actions:
  decompose  [--goal-id ID]  full cycle: decompose -> run -> route -> report
  status                     show last dispatch record
"""
import argparse, json, os, subprocess, sys, time

# ── paths ─────────────────────────────────────────────────────────────────────
SNELL_VERN_SRC  = r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src"
GOAL_STORE      = r"C:\Xova\memory\goal_store.json"
GOAL_MANAGER    = r"C:\Xova\plugins\goal_manager.py"
SELF_EVAL       = r"C:\Xova\plugins\self_eval.py"
FED_MANAGER     = r"C:\Xova\plugins\federation_manager.py"
FED_GRAPH       = r"C:\Xova\memory\federation_graph.json"
DISPATCH_STORE    = r"C:\Xova\memory\swarm_dispatch.json"
FORGE_INBOX_WRITE = r"C:\Xova\plugins\forge_inbox_write.py"
NO_WIN            = 0x08000000

# agents whose inbox is a special format — skip generic JSON write
_SKIP_INBOX = {"agent-10-memory", "agent-03-mesh"}

# ── TaskType → federation agent id ───────────────────────────────────────────
TASK_AGENT_MAP: dict[str, str] = {
    # lowercase values from TaskType.value
    "coordination":   "agent-01-forge",
    "ci_health":      "agent-11-repo",
    "memory":         "agent-10-memory",
    "constraint":     "agent-07-sentinel",
    "phase":          "agent-08-phase",
    "math":           "agent-09-field",
    "field":          "agent-09-field",
    "ternary":        "agent-09-field",
    "observation":    "agent-13-coherence",
    "sync":           "agent-11-repo",
    "testing":        "agent-01-forge",
    "documentation":  "agent-11-repo",
    "coherence":      "agent-13-coherence",
}

# ── helpers ───────────────────────────────────────────────────────────────────

def _load_goal(goal_id: str | None) -> tuple[str, str] | None:
    """Return (goal_id, goal_text) or None."""
    try:
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        gid = goal_id or store.get("active_goal")
        if not gid:
            return None
        g = store["goals"].get(gid)
        if not g:
            return None
        return gid, g["text"]
    except Exception:
        return None


def _load_fed_graph() -> dict:
    try:
        with open(FED_GRAPH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"agents": []}


def _agent_inbox(agent_id: str, graph: dict) -> str | None:
    for a in graph.get("agents", []):
        if a["id"] == agent_id:
            return a.get("inbox")
    return None


def _write_inbox(inbox_path: str, agent_name: str, task_type: str,
                 goal_id: str, goal_text: str, payload: dict) -> bool:
    """Write a task entry to a federation agent inbox file."""
    try:
        os.makedirs(os.path.dirname(inbox_path), exist_ok=True)
        entry = {
            "ts":        time.time(),
            "from":      "swarm_governor",
            "to":        agent_name,
            "task_type": task_type,
            "goal_id":   goal_id,
            "goal":      goal_text[:200],
            "payload":   payload,
            "status":    "dispatched",
        }
        existing: list = []
        if os.path.isfile(inbox_path):
            try:
                with open(inbox_path, encoding="utf-8") as fh:
                    data = json.load(fh)
                existing = data if isinstance(data, list) else [data]
            except Exception:
                pass
        existing.append(entry)
        with open(inbox_path, "w", encoding="utf-8") as fh:
            json.dump(existing[-50:], fh, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def _run_goal_manager(args: list[str]) -> dict:
    try:
        r = subprocess.run(
            [sys.executable, GOAL_MANAGER] + args,
            capture_output=True, text=True, timeout=8,
            creationflags=NO_WIN, encoding="utf-8",
        )
        return json.loads(r.stdout.strip()) if r.stdout.strip() else {}
    except Exception:
        return {}


def _run_self_eval(output: str, goal: str, goal_id: str) -> float:
    try:
        r = subprocess.run(
            [sys.executable, SELF_EVAL,
             "--action", "eval", "--agent", "swarm",
             "--goal",    goal[:500],
             "--goal-id", goal_id,
             "--output",  output[:600]],
            capture_output=True, text=True, timeout=8,
            creationflags=NO_WIN, encoding="utf-8",
        )
        data = json.loads(r.stdout.strip()) if r.stdout.strip() else {}
        return float(data.get("score", 0.0))
    except Exception:
        return 0.0


def _save_dispatch(record: dict) -> None:
    os.makedirs(os.path.dirname(DISPATCH_STORE), exist_ok=True)
    tmp = DISPATCH_STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(record, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, DISPATCH_STORE)


def _load_dispatch() -> dict:
    try:
        with open(DISPATCH_STORE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


# ── main action ───────────────────────────────────────────────────────────────

def action_decompose(goal_id: str | None) -> dict:
    result = _load_goal(goal_id)
    if not result:
        return {"ok": False, "error": "no active goal"}
    gid, goal_text = result

    # ── 1. Import swarm + decompose ───────────────────────────────────────────
    sys.path.insert(0, SNELL_VERN_SRC)
    try:
        from snell_vern_matrix.agents.cognitive_cycle import CognitiveCycle   # type: ignore[import]
        from snell_vern_matrix.agents.orchestrator    import AgentOrchestrator # type: ignore[import]
    except Exception as e:
        return {"ok": False, "error": f"swarm import failed: {e}"}

    cycle = CognitiveCycle()
    task_types = cycle.decompose(goal_text)          # list[TaskType]
    type_names = [t.value if hasattr(t, "value") else str(t) for t in task_types]

    # ── 2. Run all agents via Orchestrator ────────────────────────────────────
    t0 = time.time()
    try:
        result_obj = cycle.run(goal_text)
        agent_results = result_obj.results
        avg_coh       = result_obj.average_coherence
    except Exception as e:
        return {"ok": False, "error": f"cycle.run failed: {e}"}
    elapsed = round(time.time() - t0, 2)

    # ── 3. Route tasks to federation agent inboxes ────────────────────────────
    graph    = _load_fed_graph()
    routed   = []
    seen_agents: set[str] = set()

    for task_type in task_types:
        tname    = task_type.value if hasattr(task_type, "value") else str(task_type)
        agent_id = TASK_AGENT_MAP.get(tname)
        if not agent_id or agent_id in seen_agents:
            continue
        seen_agents.add(agent_id)
        if agent_id in _SKIP_INBOX:
            continue
        inbox = _agent_inbox(agent_id, graph)
        if not inbox:
            continue
        agent_name = next((a["name"] for a in graph["agents"] if a["id"] == agent_id), agent_id)
        # Build task message
        task_msg = (
            f"[swarm task: {tname}] goal: {goal_text[:120]} "
            f"| avg_coh: {avg_coh:.3f} | run: {gid}"
        )
        if agent_id == "agent-01-forge":
            # Route via forge_inbox_write so forge_listener picks it up
            try:
                subprocess.run(
                    [sys.executable, FORGE_INBOX_WRITE,
                     "--from", "swarm_governor",
                     "--content", task_msg[:400],
                     "--priority", "normal"],
                    capture_output=True, timeout=5,
                    creationflags=NO_WIN,
                )
                ok = True
            except Exception:
                ok = False
        else:
            payload = {"goal": goal_text[:150], "task_type": tname,
                       "avg_coherence": avg_coh, "task_msg": task_msg}
            ok = _write_inbox(inbox, agent_name, tname, gid, goal_text, payload)
        routed.append({"agent": agent_name, "task_type": tname, "delivered": ok})

    # ── 4. Aggregate results summary ──────────────────────────────────────────
    passed  = sum(1 for r in agent_results if r.get("status") == "completed")
    gated   = sum(1 for r in agent_results if r.get("coherence_gated"))
    summary = (
        f"swarm decomposed goal into {len(type_names)} tasks "
        f"({', '.join(type_names[:5])}{'…' if len(type_names) > 5 else ''}) · "
        f"{passed}/{len(agent_results)} agents passed · "
        f"avg coh {avg_coh:.3f} · {gated} gated · "
        f"{len(routed)} federation routes dispatched in {elapsed}s"
    )

    # ── 5. Write goal progress ────────────────────────────────────────────────
    _run_goal_manager([
        "--action", "progress",
        "--id",     gid,
        "--note",   summary,
        "--coherence", str(round(avg_coh, 4)),
        "--agent",  "swarm",
    ])

    # ── 6. Self-eval swarm output vs goal ─────────────────────────────────────
    eval_score = _run_self_eval(summary + " " + goal_text, goal_text, gid)

    # ── 7. Save dispatch record ───────────────────────────────────────────────
    dispatch = {
        "run_id":         f"run-{int(time.time())}",
        "goal_id":        gid,
        "goal_text":      goal_text[:200],
        "dispatched_at":  time.time(),
        "task_types":     type_names,
        "routed":         routed,
        "passed":         passed,
        "total_agents":   len(agent_results),
        "avg_coherence":  round(avg_coh, 4),
        "gated":          gated,
        "eval_score":     round(eval_score, 4),
        "elapsed_s":      elapsed,
    }
    _save_dispatch(dispatch)

    return {
        "ok":           True,
        "run_id":       dispatch["run_id"],
        "goal_id":      gid,
        "task_types":   type_names,
        "routed":       len(routed),
        "passed":       passed,
        "avg_coherence": round(avg_coh, 4),
        "eval_score":   round(eval_score, 4),
        "elapsed_s":    elapsed,
        "summary":      summary,
    }


def action_status() -> dict:
    d = _load_dispatch()
    if not d:
        return {"ok": True, "dispatch": None}
    return {"ok": True, "dispatch": d}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action",  default="status",
                    choices=["decompose", "status"])
    ap.add_argument("--goal-id", default="", dest="goal_id")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")

    if args.action == "decompose":
        result = action_decompose(args.goal_id or None)
    else:
        result = action_status()

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
