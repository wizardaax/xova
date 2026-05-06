"""
context_broker.py — shared context store for the Xova agent network.

Agents (forge, jarvis, mesh, xova) read and write named slots.
Slots persist to disk; optional TTL for expiry.

Actions:
  set  --key K --value JSON --agent A [--ttl 0] [--tags "t1,t2"]
  get  --key K
  list [--agent A] [--tag T]
  expire
  snapshot
"""
import argparse, json, os, sys, time

STORE_PATH = r"C:\Xova\memory\context_broker.json"


def _load() -> dict:
    if not os.path.isfile(STORE_PATH):
        return {"version": 1, "updated_at": time.time(), "slots": {}}
    try:
        with open(STORE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"version": 1, "updated_at": time.time(), "slots": {}}


def _save(store: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    store["updated_at"] = time.time()
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, indent=2, sort_keys=False)
    os.replace(tmp, STORE_PATH)


def _active(slot: dict) -> bool:
    ttl = slot.get("ttl", 0)
    if ttl and ttl > 0:
        return (time.time() - slot["ts"]) < ttl
    return True


def action_set(key: str, value_raw: str, agent: str, ttl: float, tags: list[str]) -> dict:
    try:
        value = json.loads(value_raw)
    except json.JSONDecodeError:
        value = value_raw  # treat as plain string
    store = _load()
    store["slots"][key] = {
        "agent": agent,
        "value": value,
        "ts":    time.time(),
        "ttl":   ttl,
        "tags":  tags,
    }
    _save(store)
    return {"ok": True, "key": key, "written": True}


def action_get(key: str) -> dict:
    store = _load()
    slot = store["slots"].get(key)
    if slot is None:
        return {"ok": False, "error": f"key not found: {key}"}
    if not _active(slot):
        return {"ok": False, "error": f"key expired: {key}"}
    return {"ok": True, "key": key, **slot}


def action_list(agent_filter: str | None, tag_filter: str | None) -> dict:
    store = _load()
    result = []
    for key, slot in store["slots"].items():
        if not _active(slot):
            continue
        if agent_filter and slot.get("agent") != agent_filter:
            continue
        if tag_filter and tag_filter not in slot.get("tags", []):
            continue
        result.append({"key": key, **slot})
    result.sort(key=lambda s: s["ts"], reverse=True)
    return {"ok": True, "count": len(result), "slots": result}


def action_expire() -> dict:
    store = _load()
    before = len(store["slots"])
    store["slots"] = {k: v for k, v in store["slots"].items() if _active(v)}
    purged = before - len(store["slots"])
    if purged:
        _save(store)
    return {"ok": True, "purged": purged, "remaining": len(store["slots"])}


def action_snapshot() -> dict:
    store = _load()
    active = {k: v for k, v in store["slots"].items() if _active(v)}
    return {"ok": True, "updated_at": store.get("updated_at", 0),
            "count": len(active), "slots": active}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="snapshot",
                    choices=["set", "get", "list", "expire", "snapshot"])
    ap.add_argument("--key",   default="")
    ap.add_argument("--value", default="null")
    ap.add_argument("--agent", default="forge")
    ap.add_argument("--ttl",   type=float, default=0.0)
    ap.add_argument("--tags",  default="")
    ap.add_argument("--tag",   default="")
    args = ap.parse_args()

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]

    if args.action == "set":
        result = action_set(args.key, args.value, args.agent, args.ttl, tags)
    elif args.action == "get":
        result = action_get(args.key)
    elif args.action == "list":
        result = action_list(args.agent or None, args.tag or None)
    elif args.action == "expire":
        result = action_expire()
    else:
        result = action_snapshot()

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
