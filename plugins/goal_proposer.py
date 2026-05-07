"""
goal_proposer.py — Round 110: gap-driven sub-goal proposal.

Reads self_eval_store (missed keywords) + phi_ucb_state (underexplored goals)
+ goal_store (active master goal) and proposes 2-3 sub-goals that target
identified evaluation gaps.

Actions:
  propose   [--apply] [--parent GOAL-ID]
            Proposes goals; --apply creates them in goal_store.json.
  list      List pending proposals from goal_proposals.json.
  accept    --id PROPOSAL-ID  Accept a pending proposal → creates the goal.
  reject    --id PROPOSAL-ID  Reject a pending proposal.
"""
import argparse, json, os, sys, time, uuid

GOAL_STORE      = r"C:\Xova\memory\goal_store.json"
SELF_EVAL_STORE = r"C:\Xova\memory\self_eval_store.json"
UCB_STATE_PATH  = r"C:\Xova\memory\phi_ucb_state.json"
PROPOSAL_STORE  = r"C:\Xova\memory\goal_proposals.json"

sys.path.insert(0, os.path.dirname(__file__))

ROTATING_GOALS = [
    "observe field coherence and run aeon thrust analysis",
    "test and validate all agents and check ci health",
    "sync repos and audit documentation",
    "analyze lucas fibonacci convergence and phase state",
    "memory recall corpus and check coherence monitor",
    "ternary logic evaluation and constraint guardian check",
    "self model observation and field weave spiral",
]

GOAL_DOMAINS = [
    "aeon thrust", "CI health", "repo sync", "Lucas phase",
    "corpus recall", "ternary logic", "field weave",
]

KEYWORD_TEMPLATES: dict[str, str] = {
    "build":        "build: enhance {domain} pipeline and validate output quality",
    "cognitive":    "cognition: add {domain} context to cycle summary and self-eval",
    "evaluate":     "evaluate: score {domain} output against master goal keywords",
    "initiate":     "initiate: trigger {domain} work autonomously when score < 0.6",
    "loop":         "close loop: connect {domain} self-eval scores to UCB reward blend",
    "modify":       "adapt: update {domain} agent strategy from self-eval gradient",
    "tasks":        "tasks: decompose master goal into {domain} executable sub-tasks",
    "sessions":     "session: preserve {domain} context across mesh restarts",
    "carry":        "carry: propagate {domain} goal state through session boundaries",
    "autonomously": "autonomous: schedule {domain} without waiting for human input",
    "persistent":   "persist: ensure {domain} goal context survives process restarts",
    "behaviour":    "adapt: adjust {domain} agent behaviour based on reward signal",
}

DEFAULT_MISSED = ["build", "evaluate", "loop"]
MAX_PROPOSALS  = 3
PROPOSAL_TTL   = 86_400  # proposals expire after 24 hours


def _load_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _active_goal() -> tuple[str, str]:
    """Return (id, text) of current active master goal, or ('', '')."""
    store = _load_json(GOAL_STORE, {})
    gid = store.get("active_goal") or ""
    if not gid:
        return "", ""
    g = store.get("goals", {}).get(gid, {})
    return gid, g.get("text", "")


def _sub_goals_active(parent_id: str) -> list[dict]:
    """Return active/paused sub-goals whose parent matches parent_id."""
    store = _load_json(GOAL_STORE, {})
    return [
        g for g in store.get("goals", {}).values()
        if g.get("parent") == parent_id and g.get("status") in ("active", "paused")
    ]


def _missed_keywords() -> list[str]:
    """Return list of most-missed keywords from the mesh agent's self-eval history."""
    store = _load_json(SELF_EVAL_STORE, {})
    # Aggregate misses across recent mesh history entries
    counts: dict[str, int] = {}
    for entry in store.get("history", []):
        if entry.get("agent") in ("mesh", "swarm"):
            for kw in entry.get("missed", []):
                counts[kw] = counts.get(kw, 0) + 1
    if counts:
        return [k for k, _ in sorted(counts.items(), key=lambda x: -x[1])]
    # Fall back to strategy field
    strat = store.get("strategies", {}).get("mesh", {}).get("strategy", "")
    if "refocus on:" in strat:
        bracket = strat.split("refocus on:")[-1].strip().strip("[]")
        return [kw.strip() for kw in bracket.split(",") if kw.strip()]
    return DEFAULT_MISSED


def _weakest_domain() -> str:
    """Return domain name of the ROTATING_GOAL with the lowest UCB Q value."""
    state = _load_json(UCB_STATE_PATH, [])
    if not state or len(state) != len(ROTATING_GOALS):
        return GOAL_DOMAINS[0]
    # Lowest Q → least reward so far → most underexplored
    idx = min(range(len(state)), key=lambda i: (state[i].get("q", 0.0), state[i].get("n", 0)))
    return GOAL_DOMAINS[idx]


def _existing_proposals() -> list[dict]:
    data = _load_json(PROPOSAL_STORE, {"proposals": []})
    now = time.time()
    # Expire old proposals
    return [p for p in data.get("proposals", []) if p.get("ts", 0) + PROPOSAL_TTL > now and p.get("status") == "pending"]


def _save_proposals(proposals: list[dict]) -> None:
    existing = _load_json(PROPOSAL_STORE, {"proposals": []})
    all_p = [p for p in existing.get("proposals", []) if p.get("status") != "pending"]
    all_p.extend(proposals)
    _save_json(PROPOSAL_STORE, {"version": 1, "proposals": all_p, "updated_at": time.time()})


def _make_proposals(parent_id: str, missed: list[str], domain: str) -> list[dict]:
    seen_texts: set[str] = set()
    proposals: list[dict] = []
    for kw in missed:
        if len(proposals) >= MAX_PROPOSALS:
            break
        tmpl = KEYWORD_TEMPLATES.get(kw)
        if not tmpl:
            continue
        text = tmpl.format(domain=domain)
        if text in seen_texts:
            continue
        seen_texts.add(text)
        proposals.append({
            "id":        "prop-" + uuid.uuid4().hex[:8],
            "text":      text,
            "keyword":   kw,
            "domain":    domain,
            "parent_id": parent_id,
            "status":    "pending",
            "ts":        time.time(),
        })
    return proposals


def _create_goal(text: str, parent_id: str) -> dict:
    from goal_manager import action_set
    return action_set(text=text, priority=5, owner="mesh", parent=parent_id)


def action_propose(apply: bool, parent_override: str | None) -> dict:
    gid, gtext = _active_goal()
    parent_id  = parent_override or gid

    if not parent_id:
        return {"ok": False, "error": "no active goal to propose against"}

    # Don't propose if active sub-goals already exist
    existing_subs = _sub_goals_active(parent_id)
    if existing_subs and not apply:
        return {"ok": True, "proposals": [], "note": f"{len(existing_subs)} active sub-goals already exist", "parent": parent_id}

    missed = _missed_keywords()
    domain = _weakest_domain()
    proposals = _make_proposals(parent_id, missed, domain)

    if not proposals:
        return {"ok": True, "proposals": [], "note": "no keyword templates matched missed keywords"}

    if apply:
        created = []
        for p in proposals:
            res = _create_goal(p["text"], p["parent_id"])
            if res.get("ok"):
                p["status"]     = "accepted"
                p["goal_id"]    = res.get("id")
                created.append(res.get("id"))
        _save_proposals(proposals)
        return {"ok": True, "proposals": proposals, "applied": created, "parent": parent_id,
                "missed": missed[:MAX_PROPOSALS], "domain": domain}
    else:
        _save_proposals(proposals)
        return {"ok": True, "proposals": proposals, "parent": parent_id,
                "missed": missed[:MAX_PROPOSALS], "domain": domain}


def action_list_proposals() -> dict:
    proposals = _existing_proposals()
    return {"ok": True, "count": len(proposals), "proposals": proposals}


def action_accept(prop_id: str) -> dict:
    data = _load_json(PROPOSAL_STORE, {"proposals": []})
    for p in data.get("proposals", []):
        if p["id"] == prop_id:
            if p.get("status") != "pending":
                return {"ok": False, "error": f"proposal not pending: {p.get('status')}"}
            res = _create_goal(p["text"], p["parent_id"])
            if res.get("ok"):
                p["status"]  = "accepted"
                p["goal_id"] = res.get("id")
                _save_json(PROPOSAL_STORE, data)
                return {"ok": True, "goal_id": res.get("id"), "text": p["text"]}
            return {"ok": False, "error": f"goal_manager failed: {res}"}
    return {"ok": False, "error": f"proposal not found: {prop_id}"}


def action_reject(prop_id: str) -> dict:
    data = _load_json(PROPOSAL_STORE, {"proposals": []})
    for p in data.get("proposals", []):
        if p["id"] == prop_id:
            p["status"] = "rejected"
            _save_json(PROPOSAL_STORE, data)
            return {"ok": True, "id": prop_id}
    return {"ok": False, "error": f"proposal not found: {prop_id}"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="propose",
                    choices=["propose", "list", "accept", "reject"])
    ap.add_argument("--apply",  action="store_true",
                    help="Immediately create goals (skip pending state)")
    ap.add_argument("--parent", default="",  help="Override parent goal ID")
    ap.add_argument("--id",     default="",  help="Proposal ID for accept/reject")
    args = ap.parse_args()

    if args.action == "propose":
        result = action_propose(apply=args.apply, parent_override=args.parent or None)
    elif args.action == "list":
        result = action_list_proposals()
    elif args.action == "accept":
        result = action_accept(args.id)
    elif args.action == "reject":
        result = action_reject(args.id)
    else:
        result = {"ok": False, "error": f"unknown action: {args.action}"}

    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import sys as _s, json as _j
        _s.stdout.reconfigure(encoding="utf-8")
        print(_j.dumps({"ok": False, "error": str(e)}))
