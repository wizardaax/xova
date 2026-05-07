"""
goal_manager.py — persistent goal state for the Xova agent fleet.

Goals survive process restarts. Agents read the active goal at startup and
write progress notes as they work. SCE-88 coherence is recorded per note.

Actions:
  set      --text "..." [--priority 1] [--owner mesh] [--parent GOAL-ID]
  get      [--id GOAL-ID]  (omit --id to get active goal)
  list     [--status active|paused|completed|failed]
  progress --id GOAL-ID --note "..." [--coherence 0.75] [--agent mesh]
  complete --id GOAL-ID [--note "..."]
  pause    --id GOAL-ID
  fail     --id GOAL-ID [--note "..."]
  activate --id GOAL-ID
  snapshot
"""
import argparse, json, os, time, uuid

STORE_PATH = r"C:\Xova\memory\goal_store.json"


def _load() -> dict:
    if not os.path.isfile(STORE_PATH):
        return {"version": 1, "active_goal": None, "goals": {}}
    try:
        with open(STORE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"version": 1, "active_goal": None, "goals": {}}


def _save(store: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    store["updated_at"] = time.time()
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, indent=2, sort_keys=False)
    os.replace(tmp, STORE_PATH)


def _make_id() -> str:
    return "goal-" + uuid.uuid4().hex[:8]


def action_set(text: str, priority: int, owner: str, parent: str | None) -> dict:
    store = _load()
    gid = _make_id()
    now = time.time()
    goal = {
        "id":         gid,
        "text":       text,
        "priority":   priority,
        "status":     "active",
        "owner":      owner,
        "parent":     parent,
        "created_at": now,
        "updated_at": now,
        "progress":   [],
    }
    store["goals"][gid] = goal
    # Auto-activate if no active goal
    if not store["active_goal"]:
        store["active_goal"] = gid
    _save(store)
    return {"ok": True, "id": gid, "active": store["active_goal"] == gid}


def action_get(gid: str | None) -> dict:
    store = _load()
    if gid is None:
        gid = store.get("active_goal")
    if not gid:
        return {"ok": False, "error": "no active goal"}
    goal = store["goals"].get(gid)
    if not goal:
        return {"ok": False, "error": f"goal not found: {gid}"}
    return {"ok": True, **goal}


def action_list(status_filter: str | None) -> dict:
    store = _load()
    goals = list(store["goals"].values())
    if status_filter:
        goals = [g for g in goals if g["status"] == status_filter]
    goals.sort(key=lambda g: (-g["priority"], g["created_at"]))
    return {"ok": True, "active_goal": store.get("active_goal"), "count": len(goals), "goals": goals}


def action_progress(gid: str, note: str, coherence: float, agent: str) -> dict:
    store = _load()
    if gid == "active":
        gid = store.get("active_goal") or ""
    goal = store["goals"].get(gid)
    if not goal:
        return {"ok": False, "error": f"goal not found: {gid}"}
    entry = {"ts": time.time(), "note": note, "coherence": coherence, "agent": agent}
    goal["progress"].append(entry)
    # cap progress at 200 entries
    if len(goal["progress"]) > 200:
        goal["progress"] = goal["progress"][-200:]
    goal["updated_at"] = time.time()
    _save(store)
    return {"ok": True, "id": gid, "progress_count": len(goal["progress"])}


def action_complete(gid: str, note: str) -> dict:
    store = _load()
    goal = store["goals"].get(gid)
    if not goal:
        return {"ok": False, "error": f"goal not found: {gid}"}
    goal["status"] = "completed"
    goal["updated_at"] = time.time()
    if note:
        goal["progress"].append({"ts": time.time(), "note": f"[completed] {note}", "coherence": 0.0, "agent": "system"})
    if store["active_goal"] == gid:
        # promote next highest-priority active goal
        candidates = [g for g in store["goals"].values() if g["status"] == "active" and g["id"] != gid]
        candidates.sort(key=lambda g: -g["priority"])
        store["active_goal"] = candidates[0]["id"] if candidates else None
    _save(store)
    return {"ok": True, "id": gid, "new_active": store["active_goal"]}


def action_pause(gid: str) -> dict:
    store = _load()
    goal = store["goals"].get(gid)
    if not goal:
        return {"ok": False, "error": f"goal not found: {gid}"}
    goal["status"] = "paused"
    goal["updated_at"] = time.time()
    if store["active_goal"] == gid:
        store["active_goal"] = None
    _save(store)
    return {"ok": True, "id": gid}


def action_fail(gid: str, note: str) -> dict:
    store = _load()
    goal = store["goals"].get(gid)
    if not goal:
        return {"ok": False, "error": f"goal not found: {gid}"}
    goal["status"] = "failed"
    goal["updated_at"] = time.time()
    if note:
        goal["progress"].append({"ts": time.time(), "note": f"[failed] {note}", "coherence": 0.0, "agent": "system"})
    if store["active_goal"] == gid:
        store["active_goal"] = None
    _save(store)
    return {"ok": True, "id": gid}


def action_activate(gid: str) -> dict:
    store = _load()
    goal = store["goals"].get(gid)
    if not goal:
        return {"ok": False, "error": f"goal not found: {gid}"}
    goal["status"] = "active"
    goal["updated_at"] = time.time()
    store["active_goal"] = gid
    _save(store)
    return {"ok": True, "id": gid}


def action_priority(gid: str, value: int) -> dict:
    store = _load()
    goal = store["goals"].get(gid)
    if not goal:
        return {"ok": False, "error": f"goal not found: {gid}"}
    goal["priority"] = max(0, value)
    goal["updated_at"] = time.time()
    _save(store)
    return {"ok": True, "id": gid, "priority": goal["priority"]}


def action_snapshot() -> dict:
    store = _load()
    return {"ok": True, "active_goal": store.get("active_goal"),
            "count": len(store["goals"]), "goals": list(store["goals"].values())}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="snapshot",
                    choices=["set", "get", "list", "progress", "complete", "pause", "fail", "activate", "priority", "snapshot"])
    ap.add_argument("--id",        default="")
    ap.add_argument("--text",      default="")
    ap.add_argument("--note",      default="")
    ap.add_argument("--priority",  type=int, default=1)
    ap.add_argument("--owner",     default="mesh")
    ap.add_argument("--parent",    default="")
    ap.add_argument("--coherence", type=float, default=0.0)
    ap.add_argument("--agent",     default="system")
    ap.add_argument("--status",    default="")
    args = ap.parse_args()

    if args.action == "set":
        result = action_set(args.text, args.priority, args.owner, args.parent or None)
    elif args.action == "get":
        result = action_get(args.id or None)
    elif args.action == "list":
        result = action_list(args.status or None)
    elif args.action == "progress":
        result = action_progress(args.id or "active", args.note, args.coherence, args.agent)
    elif args.action == "complete":
        result = action_complete(args.id, args.note)
    elif args.action == "pause":
        result = action_pause(args.id)
    elif args.action == "fail":
        result = action_fail(args.id, args.note)
    elif args.action == "activate":
        result = action_activate(args.id)
    elif args.action == "priority":
        result = action_priority(args.id, args.priority)
    else:
        result = action_snapshot()

    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import sys, json
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
