"""
forge_report.py — Forge reports work status to Xova via xova_chat_inbox.json.

SCE-88 covenant: all agents report completed actions to Xova so the panel
and Xova's own reasoning loop can see what every agent did.

Usage:
    python forge_report.py --text "Sprints 79-80 committed 4c3b34b"
    python forge_report.py --text "TypeScript clean, 85 tabs total" --from forge
    python forge_report.py --from jarvis --text "cycle 42 done, avg coherence 0.81"

The inbox file is kept as a JSON array capped at INBOX_CAP entries.
XovaChat.tsx parseOne() handles both single-object (legacy) and array format.
"""
from __future__ import annotations
import argparse, json, os, sys, time

XOVA_INBOX  = r"C:\Xova\memory\xova_chat_inbox.json"
MESH_FEED   = r"C:\Xova\memory\mesh_feed.jsonl"
INBOX_CAP   = 100
FEED_CAP    = 50_000


def _append_mesh_event(event: dict) -> None:
    try:
        try:
            with open(MESH_FEED, encoding="utf-8") as fh:
                lines = fh.readlines()
        except FileNotFoundError:
            lines = []
        if len(lines) >= FEED_CAP:
            lines = lines[-(FEED_CAP // 2):]
        lines.append(json.dumps(event, ensure_ascii=False) + "\n")
        tmp = MESH_FEED + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.writelines(lines)
        os.replace(tmp, MESH_FEED)
    except Exception:
        pass


def report(text: str, from_agent: str = "forge", correlation_id: str | None = None) -> dict:
    """Append one report entry to xova_chat_inbox.json."""
    now_ms = int(time.time() * 1000)
    entry: dict = {"from": from_agent, "text": text, "ts": now_ms}
    if correlation_id:
        entry["correlation_id"] = correlation_id

    try:
        try:
            with open(XOVA_INBOX, encoding="utf-8") as fh:
                raw = json.load(fh)
            inbox: list = raw if isinstance(raw, list) else [raw]
        except (FileNotFoundError, json.JSONDecodeError):
            inbox = []

        inbox.append(entry)
        if len(inbox) > INBOX_CAP:
            inbox = inbox[-INBOX_CAP:]

        os.makedirs(os.path.dirname(XOVA_INBOX), exist_ok=True)
        tmp = XOVA_INBOX + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(inbox, fh, ensure_ascii=False)
        os.replace(tmp, XOVA_INBOX)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    _append_mesh_event({
        "kind":    "forge_report",
        "ts":      time.time(),
        "agent":   from_agent,
        "content": text[:200],
    })

    return {"ok": True, "from": from_agent, "text": text[:80], "ts": now_ms}


def main() -> None:
    ap = argparse.ArgumentParser(description="Forge → Xova status report")
    ap.add_argument("--text",   required=True,  help="Status message to send to Xova")
    ap.add_argument("--from",   dest="sender",  default="forge")
    ap.add_argument("--corr",   dest="corr_id", default=None)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    result = report(args.text, args.sender, args.corr_id)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
