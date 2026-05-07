"""
forge_node.py — Forge (Claude) self-registration as a cognitive mesh node.

Forge is not just a message relay; it is a reasoning agent with its own
capabilities, state, and role in fleet decisions. This plugin lets Forge
announce itself to the mesh: writing a rich agent_board entry and emitting
events to mesh_feed.jsonl so Xova and mesh_runner see Forge as a peer.

Actions:
  checkin   write agent_board forge entry + emit forge_node event to mesh_feed
  status    read current Forge entry from agent_board
"""
import argparse, json, os, sys, time

AGENT_BOARD   = r"C:\Xova\memory\agent_board.json"
MESH_FEED     = r"C:\Xova\memory\mesh_feed.jsonl"
GOAL_STORE    = r"C:\Xova\memory\goal_store.json"
MESH_FLAGS    = r"C:\Xova\memory\mesh_flags.json"
MESH_FEED_CAP = 50_000  # max lines before rotation

MODEL      = "claude-sonnet-4-6"
AGENT_NAME = "forge"
CAPABILITIES = ["code", "research", "file-edit", "decision-gate",
                "task-creation", "web-search", "multi-step-planning"]


def _read_json(path: str) -> object:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _atomic_write(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _emit_mesh_event(event: dict) -> None:
    """Append one JSON line to mesh_feed.jsonl, rotate if over cap."""
    os.makedirs(os.path.dirname(MESH_FEED), exist_ok=True)
    try:
        try:
            with open(MESH_FEED, encoding="utf-8") as fh:
                lines = fh.readlines()
        except FileNotFoundError:
            lines = []
        if len(lines) >= MESH_FEED_CAP:
            lines = lines[-(MESH_FEED_CAP // 2):]
        lines.append(json.dumps(event, ensure_ascii=False) + "\n")
        tmp = MESH_FEED + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.writelines(lines)
        os.replace(tmp, MESH_FEED)
    except Exception:
        pass


def _active_goal() -> str:
    """Return the active goal text (truncated) or empty string."""
    gs = _read_json(GOAL_STORE)
    if not isinstance(gs, dict):
        return ""
    gid = gs.get("active_goal")
    if not gid:
        return ""
    return gs.get("goals", {}).get(gid, {}).get("text", "")[:120]


def _forge_mode() -> str:
    flags = _read_json(MESH_FLAGS)
    if isinstance(flags, dict):
        return str(flags.get("forgeMode", "unknown"))
    return "unknown"


def action_checkin() -> dict:
    """Write Forge's node entry to agent_board and emit to mesh_feed."""
    now  = time.time()
    mode = _forge_mode()
    goal = _active_goal()

    node = {
        "alive":                True,
        "model":                MODEL,
        "agent":                AGENT_NAME,
        "last_seen":            int(now * 1000),
        "forge_mode":           mode,
        "capabilities":         CAPABILITIES,
        "active_goal":          goal,
        "coherence_weight":     1.0,
        "checkin_ts":           now,
    }

    # Write to agent_board
    try:
        board = _read_json(AGENT_BOARD) or {}
        if not isinstance(board, dict):
            board = {}
        board["forge"] = node
        board["ts"]    = int(now * 1000)
        _atomic_write(AGENT_BOARD, board)
    except Exception as exc:
        return {"ok": False, "error": f"agent_board write failed: {exc}"}

    # Emit mesh_feed event
    _emit_mesh_event({
        "kind":    "forge_node",
        "ts":      now,
        "agent":   AGENT_NAME,
        "content": (
            f"Forge node alive: model={MODEL}, mode={mode}, "
            f"caps={len(CAPABILITIES)}"
            + (f", goal={goal[:60]}" if goal else "")
        ),
    })

    return {
        "ok":          True,
        "agent":       AGENT_NAME,
        "model":       MODEL,
        "forge_mode":  mode,
        "active_goal": goal[:80] if goal else None,
        "ts":          now,
    }


def action_status() -> dict:
    board = _read_json(AGENT_BOARD)
    if not isinstance(board, dict):
        return {"ok": False, "error": "agent_board not found"}
    forge = board.get("forge", {})
    if not forge:
        return {"ok": True, "alive": False, "note": "no forge entry in agent_board"}
    age_s = round(time.time() - forge.get("checkin_ts", forge.get("last_seen", 0) / 1000), 1)
    return {"ok": True, **forge, "age_s": age_s}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="checkin", choices=["checkin", "status"])
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    result = action_checkin() if args.action == "checkin" else action_status()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
