"""Return the last N entries from mesh_feed.jsonl as JSON."""
import json, sys, os

FEED_PATH = "C:/Xova/memory/mesh_feed.jsonl"
LIMIT = 80

def main():
    limit = LIMIT
    for a in sys.argv[1:]:
        if a.startswith("--limit="):
            try: limit = int(a.split("=", 1)[1])
            except ValueError: pass

    if not os.path.exists(FEED_PATH):
        print(json.dumps({"ok": False, "error": "feed file not found"}))
        return

    lines = []
    with open(FEED_PATH, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                lines.append(line)

    tail = lines[-limit:]
    entries = []
    for raw in tail:
        try:
            entries.append(json.loads(raw))
        except Exception:
            pass

    kinds = {}
    for e in entries:
        k = e.get("kind", "unknown")
        kinds[k] = kinds.get(k, 0) + 1

    print(json.dumps({"ok": True, "entries": entries, "total_lines": len(lines), "kinds": kinds}))

if __name__ == "__main__":
    main()
