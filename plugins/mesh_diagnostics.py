"""
mesh_diagnostics.py — Live health report for the Xova cognitive mesh.

Actions:
  report   (default) — full JSON health snapshot
  watch    — continuous refresh every 30s

Reads:
  mesh_feed.jsonl    → cycles/h, errors/h, agents active, avg coherence
  agent_board.json   → node alive status + age
  goal_store.json    → goals by status
  swarm_dispatch.json → last swarm dispatch stats
"""
import argparse, json, os, sys, time

MESH_FEED       = r"C:\Xova\memory\mesh_feed.jsonl"
AGENT_BOARD     = r"C:\Xova\memory\agent_board.json"
GOAL_STORE      = r"C:\Xova\memory\goal_store.json"
DISPATCH_STORE  = r"C:\Xova\memory\swarm_dispatch.json"
DEBUG_LOG       = r"C:\Xova\memory\debug_log.jsonl"


def _read_json(path: str) -> object:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _mesh_feed_stats() -> dict:
    cutoff_1h = time.time() - 3600
    cutoff_10m = time.time() - 600
    cycles_1h = cycles_10m = errors_1h = 0
    agents_seen: set[str] = set()
    coherence_vals: list[float] = []

    try:
        with open(MESH_FEED, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()[-2000:]
    except FileNotFoundError:
        return {"cycles_1h": 0, "cycles_10m": 0, "errors_1h": 0, "agents_active_1h": [], "avg_coherence_1h": None}

    for ln in lines:
        try:
            e = json.loads(ln)
        except Exception:
            continue
        ts = e.get("ts", 0)
        kind = e.get("kind", "")

        if ts > cutoff_1h:
            if kind == "cycle_end":
                cycles_1h += 1
                coh = e.get("coherence")
                if coh is not None:
                    coherence_vals.append(float(coh))
            if kind == "cycle_end" and ts > cutoff_10m:
                cycles_10m += 1
            if kind == "error":
                errors_1h += 1
            if kind == "agent_result":
                aid = e.get("label") or e.get("agent_id", "")
                if aid:
                    agents_seen.add(aid)

    avg_coh = round(sum(coherence_vals) / len(coherence_vals), 4) if coherence_vals else None
    return {
        "cycles_1h":         cycles_1h,
        "cycles_10m":        cycles_10m,
        "errors_1h":         errors_1h,
        "agents_active_1h":  sorted(agents_seen),
        "avg_coherence_1h":  avg_coh,
    }


def _board_stats() -> list[dict]:
    board = _read_json(AGENT_BOARD)
    if not isinstance(board, dict):
        return []
    now = time.time()
    nodes = []
    for name, info in sorted(board.items()):
        if name == "ts" or not isinstance(info, dict):
            continue
        last = info.get("checkin_ts") or (info.get("last_seen", 0) / 1000 if info.get("last_seen") else 0)
        age_s = round(now - last) if last else -1
        nodes.append({
            "name":    name,
            "alive":   info.get("alive", False),
            "age_s":   age_s,
            "model":   info.get("model", ""),
            "mode":    info.get("forge_mode", ""),
            "coh_w":   info.get("coherence_weight", None),
        })
    return nodes


def _goal_stats() -> dict:
    gs = _read_json(GOAL_STORE)
    if not isinstance(gs, dict):
        return {}
    counts: dict[str, int] = {}
    stuck: list[dict] = []
    now = time.time()
    for gid, g in gs.get("goals", {}).items():
        status = g.get("status", "unknown")
        counts[status] = counts.get(status, 0) + 1
        if status == "active" and not g.get("progress"):
            age_m = round((now - g.get("created_at", now)) / 60)
            stuck.append({"id": gid[:12], "text": g.get("text", "")[:60], "age_m": age_m, "owner": g.get("owner", "")})
    return {"by_status": counts, "active_stuck": stuck}


def _dispatch_stats() -> dict:
    d = _read_json(DISPATCH_STORE)
    if not isinstance(d, dict):
        return {}
    age_m = round((time.time() - d.get("dispatched_at", 0)) / 60)
    return {
        "dispatched_min_ago": age_m,
        "avg_coherence":      d.get("avg_coherence"),
        "eval_score":         d.get("eval_score"),
        "passed":             d.get("passed"),
        "total_agents":       d.get("total_agents"),
    }


_INTERESTING_KINDS = {"cycle_end", "evo_apply", "evo_end", "error", "sentinel_violation"}


def _last_events(n: int = 12) -> list[dict]:
    events: list[dict] = []
    try:
        with open(MESH_FEED, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()[-500:]
    except FileNotFoundError:
        return events
    for ln in reversed(lines):
        try:
            e = json.loads(ln)
            if e.get("kind") in _INTERESTING_KINDS:
                events.append({
                    "ts":        e.get("ts", 0),
                    "kind":      e.get("kind", ""),
                    "agent":     (e.get("label") or e.get("agent_id") or "")[:20],
                    "content":   str(e.get("content", ""))[:80],
                    "coherence": e.get("coherence"),
                })
                if len(events) >= n:
                    break
        except Exception:
            continue
    return events


def action_report() -> dict:
    return {
        "ok":        True,
        "ts":        time.time(),
        "feed":      _mesh_feed_stats(),
        "nodes":     _board_stats(),
        "goals":     _goal_stats(),
        "swarm":     _dispatch_stats(),
        "events":    _last_events(),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="report", choices=["report", "watch"])
    ap.add_argument("--interval", type=int, default=30)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.action == "watch":
        while True:
            r = action_report()
            print(json.dumps(r, indent=2, ensure_ascii=False))
            print("---")
            sys.stdout.flush()
            time.sleep(args.interval)
    else:
        print(json.dumps(action_report(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
