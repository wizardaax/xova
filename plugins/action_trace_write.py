"""
action_trace_write.py — append one line to the action trace log.

Any plugin, hook, or agent calls this to record what Xova just did.
ActionTrace.tsx reads the log and displays it in the dock.

Usage:
  python action_trace_write.py --action snapshot --plugin context_broker --summary "17 slots read"
  python action_trace_write.py --action write --plugin forge_inbox_write --summary "queued: mesh done"
  python action_trace_write.py --action error --plugin rff_score --summary "coherence calc failed"
"""
import argparse, json, os, sys, time

TRACE = r"C:\Xova\memory\action_trace.jsonl"
MAX_LINES = 500  # rotate after this many


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action",  default="run",
                    choices=["read", "write", "sweep", "snapshot", "run", "error", "hook", "build"])
    ap.add_argument("--plugin",  default="xova")
    ap.add_argument("--summary", required=True)
    args = ap.parse_args()

    entry = {
        "ts":      time.time(),
        "action":  args.action,
        "plugin":  args.plugin,
        "summary": args.summary[:200],
    }

    os.makedirs(os.path.dirname(TRACE), exist_ok=True)

    # read existing lines for rotation check
    existing: list[str] = []
    if os.path.isfile(TRACE):
        try:
            with open(TRACE, encoding="utf-8", errors="replace") as fh:
                existing = [l for l in fh.read().splitlines() if l.strip()]
        except OSError:
            pass

    lines = existing[-(MAX_LINES - 1):] + [json.dumps(entry, ensure_ascii=False)]

    tmp = TRACE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    os.replace(tmp, TRACE)

    print(json.dumps({"ok": True, "action": args.action, "plugin": args.plugin}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
