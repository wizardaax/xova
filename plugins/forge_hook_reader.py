"""
forge_hook_reader.py — Claude Code hook reader for forge_hook_inbox.jsonl.

Wired in settings.json on TWO events with --event arg:

  UserPromptSubmit → emit additionalContext (valid for this event).
                     Reads unread messages past cursor, advances cursor,
                     prints JSON with hookEventName="UserPromptSubmit"
                     so Forge sees them at the start of its next turn.

  Stop             → paused. Stop events do not accept additionalContext
                     output (schema rejects). Exit 0 silently. The Stop
                     hook config remains in settings.json (no removal)
                     so wiring is preserved for future use; the script
                     gates behaviour by the --event arg.

Agents write via: python forge_inbox_write.py --from <agent> --content "..."
Forge reads automatically on next prompt — no polling, no manual check.
"""
import argparse, json, os, sys, time

INBOX  = r"C:\Xova\memory\forge_hook_inbox.jsonl"
CURSOR = r"C:\Xova\memory\forge_hook_cursor.json"


def _read_cursor() -> int:
    try:
        with open(CURSOR, encoding="utf-8") as fh:
            return int(json.load(fh).get("pos", 0))
    except Exception:
        return 0


def _write_cursor(pos: int) -> None:
    os.makedirs(os.path.dirname(CURSOR), exist_ok=True)
    tmp = CURSOR + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"pos": pos, "updated_at": time.time()}, fh)
    os.replace(tmp, CURSOR)


def main() -> None:
    # force UTF-8 on stdout so non-ASCII chars don't crash on Windows pipes
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    # consume stdin non-blockingly (hook may pipe conversation JSON we don't use)
    try:
        sys.stdin.read(0)
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--event", default="", help="firing event name from settings.json")
    args = ap.parse_args()

    # Pause: Stop event has no valid output shape for additionalContext
    # injection. Exit silently — preserves hook wiring without producing
    # schema-rejected output. UserPromptSubmit is the active delivery path.
    if args.event != "UserPromptSubmit":
        sys.exit(0)

    if not os.path.isfile(INBOX):
        sys.exit(0)

    cursor = _read_cursor()

    try:
        with open(INBOX, encoding="utf-8", errors="replace") as fh:
            fh.seek(cursor)
            new_text = fh.read()
            new_pos  = fh.tell()
    except Exception:
        sys.exit(0)

    if new_pos <= cursor:
        sys.exit(0)

    messages = []
    for line in new_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            messages.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    if not messages:
        _write_cursor(new_pos)
        sys.exit(0)

    lines = []
    for m in messages:
        ts   = m.get("ts", 0)
        frm  = m.get("from", "?")
        pri  = m.get("priority", "normal")
        body = m.get("content", "")
        t    = time.strftime("%H:%M:%S", time.localtime(ts)) if ts else "?"
        tag  = f"[{pri.upper()}]" if pri != "normal" else ""
        lines.append(f"  [{t}] {frm}{(' ' + tag) if tag else ''}: {body}")

    context = "XOVA->FORGE INBOX ({} message{}):\n{}".format(
        len(messages),
        "s" if len(messages) != 1 else "",
        "\n".join(lines),
    )

    _write_cursor(new_pos)

    out = {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": context}}
    print(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)  # never crash — hook failure must be silent
