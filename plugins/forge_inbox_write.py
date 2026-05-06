"""
forge_inbox_write.py — write a message into Forge's hook inbox.

Any agent, plugin, or script calls this to send Forge a message.
Forge reads it automatically after its next response via the Stop hook.

Usage:
  python forge_inbox_write.py --from xova --content "mesh sweep done: 140 nodes"
  python forge_inbox_write.py --from jarvis --content "voice task complete" --priority high
"""
import argparse, json, os, sys, time

INBOX = r"C:\Xova\memory\forge_hook_inbox.jsonl"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from",     dest="sender",   default="xova")
    ap.add_argument("--content",  required=True)
    ap.add_argument("--priority", default="normal", choices=["low", "normal", "high", "critical"])
    args = ap.parse_args()

    msg = {
        "ts":       time.time(),
        "from":     args.sender,
        "content":  args.content,
        "priority": args.priority,
    }

    os.makedirs(os.path.dirname(INBOX), exist_ok=True)
    with open(INBOX, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(msg, ensure_ascii=False) + "\n")

    print(json.dumps({"ok": True, "queued": args.content[:80]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
