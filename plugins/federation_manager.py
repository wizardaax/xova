"""
federation_manager.py — Xova linked-agent federation manager.

Manages 13 private agent repos, routes @agent messages, maintains the
central federation graph (who knows what, task routing, shared context
slots), and can clone/sync all repos.

CLI:
    python federation_manager.py --action status
    python federation_manager.py --action sync          (clone/pull all 13 repos)
    python federation_manager.py --action message --to jarvis --text "status"
    python federation_manager.py --action route --text "@mesh: run sweep"
    python federation_manager.py --action graph         (print federation graph summary)
    python federation_manager.py --action heartbeat     (write federation.heartbeat slot)

Stdlib only. No network calls except via git subprocess.
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys, time

GRAPH_PATH   = r"C:\Xova\memory\federation_graph.json"
BROKER_PATH  = r"C:\Xova\memory\context_broker.json"
REPOS_DIR    = r"D:\github\wizardaax"
SCE88_GATE   = r"C:\Xova\plugins\sce88_gate.py"
CTX_BROKER   = r"C:\Xova\plugins\context_broker.py"
INBOX_WRITE  = r"C:\Xova\plugins\forge_inbox_write.py"
LOG_PATH     = r"C:\Xova\memory\federation_manager.log"
NO_WIN       = 0x08000000


# ── logging ──────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} [federation] {msg}"
    try:
        print(line)
    except Exception:
        pass
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        try:
            with open(LOG_PATH, "r", encoding="utf-8") as fh:
                prior = fh.readlines()
        except FileNotFoundError:
            prior = []
        kept = prior[-199:] if len(prior) >= 200 else prior
        kept.append(line + "\n")
        with open(LOG_PATH, "w", encoding="utf-8") as fh:
            fh.writelines(kept)
    except Exception:
        pass


# ── graph ─────────────────────────────────────────────────────────────────────

def _load_graph() -> dict:
    try:
        with open(GRAPH_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        _log(f"graph load error: {exc}")
        return {"agents": [], "shared_slots": [], "sce88_enforced": True}


def _agent_by_name(graph: dict, name: str) -> dict | None:
    name_lower = name.lower().strip()
    for a in graph.get("agents", []):
        if a["name"].lower() == name_lower:
            return a
        if a["id"].lower() == name_lower:
            return a
        # match "forge" in "agent-01-forge"
        if name_lower in a["id"].lower():
            return a
    return None


# ── context broker helper ─────────────────────────────────────────────────────

def _broker_set(key: str, value: object, agent: str = "federation") -> None:
    try:
        subprocess.run(
            [sys.executable, CTX_BROKER,
             "--action", "set",
             "--key", key,
             "--value", json.dumps(value, ensure_ascii=False),
             "--agent", agent],
            capture_output=True, timeout=5, creationflags=NO_WIN,
        )
    except Exception as exc:
        _log(f"broker_set error: {exc}")


def _broker_get(key: str) -> object:
    try:
        r = subprocess.run(
            [sys.executable, CTX_BROKER, "--action", "get", "--key", key],
            capture_output=True, text=True, timeout=5, creationflags=NO_WIN,
        )
        data = json.loads(r.stdout.strip())
        return data.get("value")
    except Exception:
        return None


# ── SCE-88 gate ───────────────────────────────────────────────────────────────

def _sce88_advisory(context: str, coherence: float = 0.7) -> dict:
    try:
        r = subprocess.run(
            [sys.executable, SCE88_GATE,
             "--coherence", str(coherence),
             "--context", context],
            capture_output=True, text=True, timeout=5, creationflags=NO_WIN,
        )
        return json.loads(r.stdout.strip()) if r.stdout.strip() else {"passed": True}
    except Exception:
        return {"passed": True}


# ── repo operations ───────────────────────────────────────────────────────────

def _repo_local_path(repo_name: str) -> str:
    return os.path.join(REPOS_DIR, repo_name.split("/")[-1])


def _clone_or_pull(repo: dict) -> dict:
    full_repo  = repo["repo"]   # e.g. "wizardaax/xova-agent-01-forge"
    short_name = full_repo.split("/")[-1]
    local_path = _repo_local_path(full_repo)
    result = {"id": repo["id"], "repo": full_repo, "local": local_path}

    if os.path.isdir(os.path.join(local_path, ".git")):
        # pull
        r = subprocess.run(
            ["git", "-C", local_path, "pull", "--ff-only"],
            capture_output=True, text=True, timeout=30,
        )
        result["action"] = "pull"
        result["ok"]     = r.returncode == 0
        result["output"] = (r.stdout + r.stderr).strip()[:200]
    else:
        # clone
        os.makedirs(REPOS_DIR, exist_ok=True)
        r = subprocess.run(
            ["git", "clone",
             f"https://github.com/{full_repo}.git",
             local_path],
            capture_output=True, text=True, timeout=60,
        )
        result["action"] = "clone"
        result["ok"]     = r.returncode == 0
        result["output"] = (r.stdout + r.stderr).strip()[:200]

    return result


def action_sync(graph: dict) -> dict:
    agents  = graph.get("agents", [])
    results = []
    _log(f"syncing {len(agents)} agent repos")
    for agent in agents:
        res = _clone_or_pull(agent)
        results.append(res)
        status = "ok" if res["ok"] else "FAIL"
        _log(f"  {res['id']} [{res['action']}] {status}")
    ok_count   = sum(1 for r in results if r["ok"])
    fail_count = len(results) - ok_count
    summary = {"ok": True, "synced": ok_count, "failed": fail_count, "results": results}
    _broker_set("federation.last_sync", {
        "ts": time.time(), "synced": ok_count, "failed": fail_count,
    })
    return summary


# ── messaging ─────────────────────────────────────────────────────────────────

def _deliver_to_agent(agent: dict, text: str, from_name: str = "federation") -> dict:
    """Write a message into an agent's native inbox."""
    agent_name = agent["name"].lower()
    ts = int(time.time() * 1000)

    if agent_name == "forge":
        # Use forge_inbox_write.py
        r = subprocess.run(
            [sys.executable, INBOX_WRITE,
             "--from", from_name,
             "--content", text,
             "--priority", "high"],
            capture_output=True, text=True, timeout=5, creationflags=NO_WIN,
        )
        return {"ok": r.returncode == 0, "via": "forge_inbox_write"}

    # Generic: write to agent's inbox path as JSON
    inbox = agent.get("inbox")
    if not inbox:
        return {"ok": False, "error": "no inbox defined"}

    payload = {
        "ts": ts,
        "from": from_name,
        "to": agent_name,
        "text": text,
        "federation_routed": True,
    }
    try:
        os.makedirs(os.path.dirname(inbox), exist_ok=True)
        tmp = inbox + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
        os.replace(tmp, inbox)
        return {"ok": True, "via": "inbox_json", "inbox": inbox}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def action_message(graph: dict, to: str, text: str, from_name: str = "federation") -> dict:
    agent = _agent_by_name(graph, to)
    if not agent:
        return {"ok": False, "error": f"unknown agent: {to}"}

    gate = _sce88_advisory(f"federation_message:{to}")
    if not gate.get("passed", True):
        violations = "; ".join(gate.get("violations", []))
        _log(f"SCE-88 advisory on message to {to}: {violations}")
        text = f"[SCE-88: {violations}] {text}"

    result = _deliver_to_agent(agent, text, from_name)
    _log(f"message to {agent['id']}: {result}")
    return {"ok": result.get("ok", False), "agent": agent["id"], "delivery": result}


def action_route(graph: dict, text: str) -> dict:
    """Parse @agent mentions and route each one. e.g. '@mesh: run sweep @jarvis: status'"""
    import re
    prefix = graph.get("message_prefix", "@")
    # Find all @name: content patterns
    pattern = rf"{re.escape(prefix)}(\w[\w\-]*)\s*:\s*(.*?)(?=\s*{re.escape(prefix)}\w|$)"
    matches  = re.findall(pattern, text, re.IGNORECASE | re.DOTALL)

    if not matches:
        return {"ok": False, "error": "no @agent mentions found", "text": text}

    results = []
    for name, content in matches:
        res = action_message(graph, name.strip(), content.strip())
        results.append(res)

    delivered = sum(1 for r in results if r.get("ok"))
    return {"ok": delivered > 0, "routes": len(matches), "delivered": delivered, "results": results}


# ── status ────────────────────────────────────────────────────────────────────

def action_status(graph: dict) -> dict:
    agents = graph.get("agents", [])
    rows   = []
    for a in agents:
        local = _repo_local_path(a["repo"])
        cloned = os.path.isdir(os.path.join(local, ".git"))
        inbox_exists = (
            os.path.isfile(a.get("inbox", "")) or
            os.path.isdir(a.get("inbox", ""))
        )
        rows.append({
            "id":           a["id"],
            "name":         a["name"],
            "repo":         a["repo"],
            "cloned":       cloned,
            "inbox_live":   inbox_exists,
            "specialty":    a.get("specialty", [])[:2],
            "sce88_role":   a.get("sce88_role", "advisory"),
        })
    return {
        "ok":           True,
        "agent_count":  len(agents),
        "shared_slots": graph.get("shared_slots", []),
        "sce88":        graph.get("sce88_enforced", False),
        "agents":       rows,
    }


def action_heartbeat(graph: dict) -> dict:
    ts = time.time()
    payload = {
        "ts":          ts,
        "agent_count": len(graph.get("agents", [])),
        "sce88":       graph.get("sce88_enforced", False),
    }
    _broker_set("federation.heartbeat", payload)
    _log(f"heartbeat written: {len(graph.get('agents', []))} agents")
    return {"ok": True, "ts": ts}


def action_graph(graph: dict) -> dict:
    agents = graph.get("agents", [])
    edges  = []
    for a in agents:
        links = a.get("links_to", [])
        if "*" in links:
            edges.append({"from": a["id"], "to": "ALL"})
        else:
            for target in links:
                edges.append({"from": a["id"], "to": target})
    return {
        "ok":      True,
        "version": graph.get("version", "?"),
        "agents":  len(agents),
        "edges":   len(edges),
        "nodes":   [{"id": a["id"], "name": a["name"], "role": a.get("sce88_role")} for a in agents],
        "links":   edges,
    }


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Federation manager")
    ap.add_argument("--action",  required=True,
                    choices=["status", "sync", "message", "route", "graph", "heartbeat"])
    ap.add_argument("--to",      default="")
    ap.add_argument("--text",    default="")
    ap.add_argument("--from",    dest="from_name", default="federation")
    args = ap.parse_args()

    graph = _load_graph()

    if args.action == "status":
        result = action_status(graph)
    elif args.action == "sync":
        result = action_sync(graph)
    elif args.action == "message":
        if not args.to or not args.text:
            result = {"ok": False, "error": "--to and --text required for message"}
        else:
            result = action_message(graph, args.to, args.text, args.from_name)
    elif args.action == "route":
        if not args.text:
            result = {"ok": False, "error": "--text required for route"}
        else:
            result = action_route(graph, args.text)
    elif args.action == "graph":
        result = action_graph(graph)
    elif args.action == "heartbeat":
        result = action_heartbeat(graph)
    else:
        result = {"ok": False, "error": f"unknown action: {args.action}"}

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
