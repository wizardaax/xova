"""
forge_task_publisher.py — publish the `forge.current_task` broker slot.

Closes the gap surfaced by self-mod proposal prop-c972a730 (memory agent
self-eval found `forge.current_task` missing from the context broker).

The slot value is a dict combining three signals:
  * rotating_goal  — the goal mesh_runner is dispatching THIS cycle
                     (parsed from latest cycle_start event in mesh_feed.jsonl)
  * inbox_latest   — most recent message in forge_inbox.json (Adam → Forge)
  * outbox_latest  — most recent response in forge_outbox.json
  * ts             — wall-clock timestamp

Stdlib only. Idempotent. Designed to be invoked by Windows Task Scheduler
every 1-2 minutes, or manually via `python forge_task_publisher.py`.

RULE 1 compliant: ADD-only, no existing file modified.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

_MESH_FEED       = r"C:\Xova\memory\mesh_feed.jsonl"
_FORGE_INBOX     = r"C:\Xova\memory\forge_inbox.json"
_FORGE_OUTBOX    = r"C:\Xova\memory\forge_outbox.json"
_BROKER_HELPER   = r"C:\Xova\plugins\context_broker.py"
_SLOT_KEY        = "forge.current_task"
_AGENT           = "forge_task_publisher"


def _latest_cycle_goal() -> str | None:
    """Read the most recent cycle_start event's goal text from mesh_feed."""
    if not os.path.exists(_MESH_FEED):
        return None
    try:
        with open(_MESH_FEED, encoding="utf-8") as fh:
            lines = fh.readlines()[-300:]  # search recent tail only
    except Exception:
        return None
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("kind") == "cycle_start":
            content = str(e.get("content", ""))
            # cycle_start content begins "→ <goal>"
            return content.replace("→ ", "", 1).strip()[:200] or None
    return None


def _read_json_safe(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _latest_inbox_message() -> dict | None:
    """Most recent entry in forge_inbox.json. Supports array OR single-object."""
    data = _read_json_safe(_FORGE_INBOX)
    if data is None:
        return None
    if isinstance(data, list):
        if not data:
            return None
        entry = data[-1]
    elif isinstance(data, dict):
        entry = data
    else:
        return None
    return {
        "text": str(entry.get("text", entry.get("message", "")))[:200],
        "from": str(entry.get("from", "?")),
        "ts":   entry.get("ts"),
    }


def _latest_outbox_response() -> dict | None:
    """Most recent entry in forge_outbox.json. Supports array OR single-object."""
    data = _read_json_safe(_FORGE_OUTBOX)
    if data is None:
        return None
    if isinstance(data, list):
        if not data:
            return None
        entry = data[-1]
    elif isinstance(data, dict):
        entry = data
    else:
        return None
    return {
        "text": str(entry.get("text", entry.get("response", "")))[:200],
        "ts":   entry.get("ts"),
    }


def _write_slot(value: dict) -> tuple[bool, str]:
    """Subprocess context_broker.py to set the slot atomically + SCE-88-checked."""
    try:
        r = subprocess.run(
            [sys.executable, _BROKER_HELPER,
             "--action", "set", "--key", _SLOT_KEY,
             "--value", json.dumps(value, ensure_ascii=False),
             "--agent", _AGENT],
            capture_output=True, timeout=10, text=True,
        )
        if r.returncode == 0:
            return True, r.stdout.strip()
        return False, (r.stderr or r.stdout or "nonzero rc").strip()
    except Exception as exc:
        return False, f"subprocess error: {exc}"


def publish_once() -> dict:
    payload = {
        "rotating_goal":  _latest_cycle_goal(),
        "inbox_latest":   _latest_inbox_message(),
        "outbox_latest":  _latest_outbox_response(),
        "ts":             time.time(),
    }
    ok, msg = _write_slot(payload)
    return {
        "ok":            ok,
        "publish_msg":   msg,
        "payload":       payload,
    }


def main() -> int:
    result = publish_once()
    out = json.dumps(result, ensure_ascii=False, indent=2, default=str)
    try:
        if sys.stdout is not None:
            try: sys.stdout.reconfigure(encoding="utf-8")
            except Exception: pass
            print(out)
    except Exception:
        pass
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
