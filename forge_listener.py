"""
forge_listener.py — Xova/Jarvis ↔ Forge message router.

Polls every 1s. Reads forge_mode from mesh_flags.json on each cycle so mode
changes take effect without a restart.

Modes:
  off   — no-op; daemon stays alive to detect mode changes.
  live  — routes forge_inbox.json → claude --print → forge_outbox.json.
           Also routes voice_inbox.json (to=forge) back to forge_inbox for
           multi-turn Jarvis↔Forge chains.
  queue — queues messages to forge_queue.json without invoking claude.
           forge_outbox routing still active.

Rate limit: max 20 claude --print calls per hour. When limit is hit,
the message is queued and the caller receives "rate limit reached, queued instead."
The counter resets on a rolling 1-hour window.

Singleton: exits immediately if another forge_listener.py is already running.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# ── Singleton guard ──────────────────────────────────────────────────────────
def _already_running() -> bool:
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe'\" "
             "| Select-Object -ExpandProperty CommandLine"],
            capture_output=True, text=True, timeout=10,
            creationflags=0x08000000,
        )
        lines = result.stdout.splitlines()
        siblings = [l for l in lines if "forge_listener" in l]
        return len(siblings) > 1
    except Exception:
        return False

if _already_running():
    sys.exit(0)
# ────────────────────────────────────────────────────────────────────────────

FORGE_INBOX        = r"C:\Xova\memory\forge_inbox.json"
FORGE_INBOX_CURSOR = r"C:\Xova\memory\forge_inbox_cursor.json"
FORGE_OUTBOX       = r"C:\Xova\memory\forge_outbox.json"
FORGE_QUEUE        = r"C:\Xova\memory\forge_queue.json"
JARVIS_INBOX = r"C:\Xova\memory\jarvis_inbox.json"
VOICE_INBOX  = r"C:\Xova\memory\voice_inbox.json"
MESH_FLAGS   = r"C:\Xova\memory\mesh_flags.json"
AGENT_BOARD  = r"C:\Xova\memory\agent_board.json"
LOG_PATH     = r"C:\Xova\memory\forge_listener.log"

RATE_LIMIT   = 20    # max claude --print calls per rolling hour
QUEUE_CAP    = 100   # max entries in forge_queue.json
POLL_SEC     = 1
NO_WIN       = 0x08000000
# Full path to claude.exe — pythonw inherits a minimal PATH that omits npm dirs.
CLAUDE_EXE   = r"C:\Users\adz_7\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
RATE_LOG     = r"C:\Xova\memory\forge_rate_log.json"  # persisted rate limit timestamps
SCE88_GATE        = r"C:\Xova\plugins\sce88_gate.py"
CONTEXT_BROKER_STORE = r"C:\Xova\memory\context_broker.json"
VIOLATIONS_LOG    = r"C:\Xova\memory\sentinel_violations.jsonl"
VIOLATIONS_CAP    = 1000
GOAL_MANAGER      = r"C:\Xova\plugins\goal_manager.py"
GOAL_STORE        = r"C:\Xova\memory\goal_store.json"
SELF_EVAL         = r"C:\Xova\plugins\self_eval.py"
SELF_EVAL_STORE   = r"C:\Xova\memory\self_eval_store.json"
TASK_INITIATOR    = r"C:\Xova\plugins\task_initiator.py"
SCAN_EVERY_N      = 5  # run task_initiator scan every N forge replies

_call_timestamps:    list[float] = []  # wall-time of recent claude --print calls
_forge_reply_count: int = 0            # counts replies for task_initiator scan cadence
_last_inbox_ts:      int = 0
_last_voice_ts:      int = 0
_last_forge_voice_ts: int = 0        # AUDIT-2-006: separate cursor for forge-bound relay dedup
_last_board_at:      float = 0.0


LOG_CAP = 500

def _log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} [forge_listener] {msg}"
    try:
        print(line)
    except Exception:
        pass
    try:
        try:
            with open(LOG_PATH, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
        except FileNotFoundError:
            lines = []
        lines.append(line + "\n")
        if len(lines) > LOG_CAP:
            lines = lines[-(LOG_CAP - 1):]
        with open(LOG_PATH, "w", encoding="utf-8") as fh:
            fh.writelines(lines)
    except Exception:
        pass


def _load_inbox_cursor() -> int:
    """AUDIT-2-024: load last-processed inbox ts from persistent cursor file."""
    try:
        with open(FORGE_INBOX_CURSOR, encoding="utf-8") as fh:
            return int(json.load(fh).get("last_ts", 0))
    except FileNotFoundError:
        return 0
    except Exception as exc:
        _log(f"cursor load failed: {exc}")
        return 0


def _save_inbox_cursor(ts: int) -> None:
    """AUDIT-2-024: persist last-processed ts so restarts don't replay messages."""
    try:
        os.makedirs(os.path.dirname(FORGE_INBOX_CURSOR), exist_ok=True)
        tmp = FORGE_INBOX_CURSOR + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"last_ts": ts, "updated_at": time.time()}, fh)
        os.replace(tmp, FORGE_INBOX_CURSOR)
    except Exception as exc:
        _log(f"cursor save failed: {exc}")


def _load_rate_log() -> None:
    """AUDIT-2-005: on startup, restore call timestamps from disk and prune old ones."""
    global _call_timestamps
    try:
        with open(RATE_LOG, "r", encoding="utf-8") as f:
            data = json.load(f)
        raw = data.get("timestamps", [])
        now = time.time()
        _call_timestamps = [t for t in raw if isinstance(t, (int, float)) and now - t < 3600]
        if _call_timestamps:
            _log(f"rate log loaded: {len(_call_timestamps)} calls in last hour (cap {RATE_LIMIT})")
    except FileNotFoundError:
        pass
    except Exception as exc:
        _log(f"rate log load failed: {exc}")


def _save_rate_log() -> None:
    """Persist current call timestamps to disk so restarts don't reset the counter."""
    try:
        with open(RATE_LOG, "w", encoding="utf-8") as f:
            json.dump({"timestamps": _call_timestamps}, f)
    except Exception as exc:
        _log(f"rate log save failed: {exc}")


def _mode() -> str:
    try:
        with open(MESH_FLAGS, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Unwrap double-JSON encoding if saveMemory wrapped value as a string
        if isinstance(data, str):
            data = json.loads(data)
        return str(data.get("forge_mode", "off"))
    except Exception:
        return "off"


def _read_json(path: str) -> dict | None:
    try:
        # utf-8-sig strips BOM if present (PS5.1 Set-Content -Encoding utf8 adds one)
        with open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return None


def _write_json(path: str, obj: dict) -> bool:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)
        return True
    except Exception as exc:
        _log(f"write {os.path.basename(path)} failed: {exc}")
        return False


def _append_outbox(path: str, obj: dict) -> bool:
    """AUDIT-2-004: append obj to the outbox JSON array (atomic read-modify-write).
    Initialises to [] if the file is missing or contains a legacy single-object."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                existing = json.load(f)
            if not isinstance(existing, list):
                # Migrate legacy single-object format to array
                existing = [existing]
        except (FileNotFoundError, json.JSONDecodeError):
            existing = []
        existing.append(obj)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False)
        return True
    except Exception as exc:
        _log(f"append_outbox {os.path.basename(path)} failed: {exc}")
        return False


def _rate_ok() -> bool:
    global _call_timestamps
    now = time.time()
    _call_timestamps = [t for t in _call_timestamps if now - t < 3600]
    return len(_call_timestamps) < RATE_LIMIT


def _record_call() -> None:
    _call_timestamps.append(time.time())
    _save_rate_log()  # AUDIT-2-005: persist so restarts don't reset the counter


def _rate_used() -> int:
    now = time.time()
    return len([t for t in _call_timestamps if now - t < 3600])


def _enqueue(msg: dict) -> None:
    try:
        try:
            with open(FORGE_QUEUE, "r", encoding="utf-8") as f:
                q = json.load(f)
            if not isinstance(q, list):
                q = []
        except Exception:
            q = []
        q.append(msg)
        if len(q) > QUEUE_CAP:
            dropped = len(q) - QUEUE_CAP
            q = q[dropped:]
            _log(f"queue capped — dropped {dropped} oldest entries")
        with open(FORGE_QUEUE, "w", encoding="utf-8") as f:
            json.dump(q, f, ensure_ascii=False)
    except Exception as exc:
        _log(f"enqueue failed: {exc}")


def _strip_role_prefix(text: str) -> str:
    """AUDIT-2-025: strip leading 'Forge: ' / 'Jarvis: ' speaker labels from LLM
    responses. The 3B model sometimes prefixes its own reply with a speaker name.
    Case-insensitive; strips the label and any trailing whitespace before the body."""
    import re
    return re.sub(r'(?i)^\s*(?:forge|jarvis)\s*:\s*', '', text).strip()


def _call_claude(text: str) -> str:
    """Invoke claude --print via stdin. Returns response text.
    Uses absolute path to claude.exe so pythonw's minimal PATH is not a problem.
    Retries once with 3s backoff on subprocess failure (AUDIT-2-007)."""
    if not os.path.exists(CLAUDE_EXE):
        return f"(claude CLI not found at {CLAUDE_EXE})"
    last_err: str = ""
    for attempt in range(3):
        try:
            proc = subprocess.run(
                [CLAUDE_EXE, "--print"],
                input=text,
                capture_output=True,
                text=True,
                timeout=120,
                creationflags=NO_WIN,
            )
            if proc.returncode == 0:
                return proc.stdout.strip() or "(no output)"
            last_err = f"exit {proc.returncode}: {(proc.stderr or '').strip()[:80]}"
        except subprocess.TimeoutExpired:
            return "(claude --print timed out after 120s)"
        except FileNotFoundError:
            return f"(claude CLI not found at {CLAUDE_EXE})"
        except Exception as exc:
            last_err = str(exc)
        if attempt < 2:
            _log(f"claude --print failed (attempt {attempt + 1}): {last_err} — retrying in 2s")
            time.sleep(2)
    return f"(claude call failed after 3 attempts: {last_err})"


def _deliver_reply(text: str, from_agent: str, correlation_id: str | None, original_ts: int) -> None:
    """Append reply to forge_outbox.json array and route reply to Xova or Jarvis.
    AUDIT-2-004: outbox is now an append-log (JSON array) so concurrent replies
    do not overwrite each other. Consumers drain by reading all entries and
    writing back an empty array (or searching by correlation_id)."""
    now = int(time.time() * 1000)
    payload: dict = {
        "intent": "reply",
        "from": "forge",
        "to": from_agent,
        "text": text,
        "ts": now,
    }
    if correlation_id:
        payload["correlation_id"] = correlation_id

    _append_outbox(FORGE_OUTBOX, payload)

    if from_agent == "jarvis":
        # Reply already in forge_outbox; ask_forge.py drains it by correlation_id.
        # Do NOT write to JARVIS_INBOX — XovaInboxListener would loop it back.
        _log(f"routed forge->jarvis via outbox: '{text[:60]}'")
    else:
        # Route to Xova via voice_inbox with role="forge"
        voice_payload = {**payload, "role": "forge"}
        _write_json(VOICE_INBOX, voice_payload)
        _log(f"routed forge->xova: '{text[:60]}'")


def _load_goal_state() -> tuple[str | None, str | None]:
    """Return (active_goal_id, active_goal_text) from goal store."""
    try:
        if not os.path.isfile(GOAL_STORE):
            return None, None
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        gid = store.get("active_goal")
        if not gid:
            return None, None
        return gid, store["goals"].get(gid, {}).get("text")
    except Exception:
        return None, None


def _read_forge_strategy() -> str:
    """Return current self-eval strategy instruction for forge."""
    try:
        if not os.path.isfile(SELF_EVAL_STORE):
            return ""
        with open(SELF_EVAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        return store.get("strategies", {}).get("forge", {}).get("strategy", "")
    except Exception:
        return ""


def _write_goal_progress(note: str) -> None:
    """Write a progress note to the active goal (non-blocking, best-effort)."""
    try:
        if not os.path.isfile(GOAL_STORE):
            return
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        gid = store.get("active_goal")
        if not gid:
            return
        subprocess.Popen(
            [sys.executable, GOAL_MANAGER,
             "--action", "progress",
             "--id",    gid,
             "--note",  note[:400],
             "--coherence", "0.0",
             "--agent", "forge"],
            creationflags=NO_WIN,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def _run_task_scan() -> None:
    """Fire task_initiator scan in background after every SCAN_EVERY_N forge replies."""
    try:
        subprocess.Popen(
            [sys.executable, TASK_INITIATOR, "--action", "scan"],
            creationflags=NO_WIN,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        _log(f"task scan error: {exc}")


def _run_forge_self_eval(reply: str) -> None:
    """Score forge reply against active goal; store eval + updated strategy."""
    try:
        gid, goal_text = _load_goal_state()
        if not gid or not goal_text:
            return
        subprocess.Popen(
            [sys.executable, SELF_EVAL,
             "--action",  "eval",
             "--agent",   "forge",
             "--goal",    goal_text[:500],
             "--goal-id", gid,
             "--output",  reply[:600]],
            creationflags=NO_WIN,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def _append_violation(source: str, context: str, coherence: float,
                      violations: list, **extra) -> None:
    entry = {"ts": time.time(), "source": source, "context": context,
             "coherence": coherence, "violations": violations, **extra}
    try:
        os.makedirs(os.path.dirname(VIOLATIONS_LOG), exist_ok=True)
        with open(VIOLATIONS_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        with open(VIOLATIONS_LOG, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
        if len(lines) > VIOLATIONS_CAP:
            with open(VIOLATIONS_LOG, "w", encoding="utf-8") as fh:
                fh.writelines(lines[-VIOLATIONS_CAP:])
    except Exception:
        pass


def _sce88_check(text: str, from_agent: str) -> str:
    """Run the SCE-88 constraint gate. Returns text (possibly prepended with alert)."""
    try:
        # Read current coherence from context_broker xova.sce88_status slot
        coherence = 0.7
        try:
            with open(CONTEXT_BROKER_STORE, "r", encoding="utf-8") as fh:
                store = json.load(fh)
            slot = store.get("xova.sce88_status") or store.get("mesh.sce88_status")
            if isinstance(slot, dict) and "value" in slot:
                v = slot["value"]
                if isinstance(v, dict):
                    coherence = float(v.get("coherence", 0.7))
                elif isinstance(v, (int, float)):
                    coherence = float(v)
        except Exception:
            pass

        result = subprocess.run(
            [sys.executable, SCE88_GATE,
             "--coherence", str(coherence),
             "--context", f"forge_inbox:{from_agent}"],
            capture_output=True, text=True, timeout=5, creationflags=NO_WIN,
        )
        gate = json.loads(result.stdout.strip()) if result.stdout.strip() else {}
        if not gate.get("passed", True) and gate.get("violations"):
            violations = gate["violations"]
            summary = "; ".join(violations)
            _log(f"SCE-88 advisory: {summary}")
            _append_violation("forge", f"forge_inbox:{from_agent}", coherence, violations)
            return f"[SCE-88: {summary}] {text}"
    except Exception as exc:
        _log(f"SCE-88 gate error (non-blocking): {exc}")
    return text


def _route_inbox(mode: str) -> None:
    """Process new forge_inbox.json messages; invoke claude or queue."""
    global _last_inbox_ts
    data = _read_json(FORGE_INBOX)
    if data is None:
        return
    ts = int(data.get("ts", 0))
    if ts <= _last_inbox_ts:
        return
    _last_inbox_ts = ts
    _save_inbox_cursor(ts)  # AUDIT-2-024

    text = data.get("text", "").strip()
    from_agent = str(data.get("from", "xova")).lower()
    correlation_id: str | None = data.get("correlation_id") or None
    if not text:
        return

    _log(f"inbox: from={from_agent} mode={mode} text='{text[:60]}' corr={correlation_id}")

    if mode == "queue":
        _enqueue(data)
        _deliver_reply(
            "Queued for next Forge session (forge_mode=queue).",
            from_agent, correlation_id, ts,
        )
        return

    # mode == "live" — check rate limit
    if not _rate_ok():
        used = _rate_used()
        _log(f"rate limit hit ({used}/{RATE_LIMIT} calls in last hour) — queuing instead")
        _enqueue(data)
        _deliver_reply(
            f"Rate limit reached ({RATE_LIMIT}/hour). Message queued instead.",
            from_agent, correlation_id, ts,
        )
        return

    # Prepend self-eval strategy so forge adjusts approach based on past scores
    strategy = _read_forge_strategy()
    if strategy:
        text = f"[self-eval strategy: {strategy}]\n\n{text}"

    _log(f"calling claude --print (calls this hour: {_rate_used() + 1}/{RATE_LIMIT})")
    text = _sce88_check(text, from_agent)  # SCE-88 advisory gate
    reply_text = _strip_role_prefix(_call_claude(text))  # AUDIT-2-025
    _record_call()
    _log(f"claude replied: '{reply_text[:80]}'")
    _deliver_reply(reply_text, from_agent, correlation_id, ts)
    _write_goal_progress(f"forge reply to {from_agent}: {reply_text[:120]}")
    _run_forge_self_eval(reply_text)  # score reply against active goal
    global _forge_reply_count
    _forge_reply_count += 1
    if _forge_reply_count % SCAN_EVERY_N == 0:
        _run_task_scan()


def _route_voice_to_forge(mode: str) -> None:
    """Relay voice_inbox.json entries with to='forge' back into forge_inbox.
    Enables multi-turn Jarvis↔Forge chains without App.tsx involvement.
    AUDIT-2-006: uses _last_forge_voice_ts as a separate cursor for forge-bound
    entries so a non-forge entry at a higher ts cannot block a forge entry at a
    lower ts from being relayed."""
    global _last_voice_ts, _last_forge_voice_ts
    data = _read_json(VOICE_INBOX)
    if data is None:
        return
    ts = int(data.get("ts", 0))
    to_field = str(data.get("to", "")).lower()

    if to_field != "forge":
        # Non-forge entry: advance shared cursor if newer, then ignore.
        if ts > _last_voice_ts:
            _last_voice_ts = ts
        return

    # Forge-bound entry: gate on the forge-specific cursor.
    if ts <= _last_forge_voice_ts:
        return
    # Advance both cursors so neither cursor replays this entry.
    _last_forge_voice_ts = ts
    if ts > _last_voice_ts:
        _last_voice_ts = ts

    _log(f"voice->forge relay: '{str(data.get('text', ''))[:60]}'")
    relay = {
        "intent": "reply",
        "from": str(data.get("role", data.get("from", "jarvis"))),
        "to": "forge",
        "text": data.get("text", ""),
        "ts": int(time.time() * 1000),
    }
    if data.get("correlation_id"):
        relay["correlation_id"] = data["correlation_id"]

    if mode == "live":
        _write_json(FORGE_INBOX, relay)
    elif mode == "queue":
        _enqueue(relay)


def _update_board() -> None:
    """Heartbeat write to agent_board.json forge section (~60s interval).
    Last-write-wins — acceptable for heartbeat data."""
    global _last_board_at
    now = time.time()
    if now - _last_board_at < 60:
        return
    _last_board_at = now
    try:
        try:
            with open(AGENT_BOARD, "r", encoding="utf-8") as f:
                board = json.load(f)
        except FileNotFoundError:
            board = {}
        except Exception:
            _log("board read failed during _update_board — skipping cycle")
            return
        board.setdefault("xova",   {"alive": False, "last_seen": 0, "current_task": None})
        board.setdefault("jarvis", {"alive": False, "last_seen": 0, "current_task": None})
        board.setdefault("shared", {"active_correlation_id": None, "context": {}})
        board["forge"] = {
            "alive": True,
            "last_seen": int(now * 1000),
            "forge_mode": _mode(),
            "calls_this_hour": _rate_used(),
        }
        board["ts"] = int(now * 1000)
        tmp = AGENT_BOARD + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(board, f, ensure_ascii=False, indent=2)
        os.replace(tmp, AGENT_BOARD)
    except Exception as exc:
        _log(f"board update failed: {exc}")


def _drain_startup_queue() -> None:
    """AUDIT-2-003: on startup in live mode, process any items left in forge_queue.json.
    Processes front-to-back, stops on rate limit, writes remaining items back."""
    try:
        with open(FORGE_QUEUE, "r", encoding="utf-8") as f:
            q = json.load(f)
        if not isinstance(q, list) or not q:
            return
    except FileNotFoundError:
        return
    except Exception as exc:
        _log(f"startup drain read failed: {exc}")
        return

    _log(f"startup drain: {len(q)} queued item(s) found")
    processed = 0
    for item in q:
        if not _rate_ok():
            _log("startup drain: rate limit reached — leaving remaining items in queue")
            break
        text = item.get("text", "").strip()
        if not text:
            processed += 1
            continue
        from_agent = str(item.get("from", "xova")).lower()
        correlation_id: str | None = item.get("correlation_id") or None
        original_ts = int(item.get("ts", 0))
        _log(f"startup drain: calling claude for from={from_agent} text='{text[:60]}'")
        reply = _strip_role_prefix(_call_claude(text))  # AUDIT-2-025
        _record_call()
        _log(f"startup drain: reply='{reply[:80]}'")
        _deliver_reply(reply, from_agent, correlation_id, original_ts)
        processed += 1

    remaining = q[processed:]
    try:
        with open(FORGE_QUEUE, "w", encoding="utf-8") as f:
            json.dump(remaining, f, ensure_ascii=False)
        _log(f"startup drain: processed {processed}, remaining {len(remaining)}")
    except Exception as exc:
        _log(f"startup drain queue write failed: {exc}")


def main() -> None:
    global _last_inbox_ts
    # AUDIT-2-024: use persistent cursor file; fall back to inbox ts on first run.
    _last_inbox_ts = _load_inbox_cursor()
    if _last_inbox_ts == 0:
        existing = _read_json(FORGE_INBOX)
        if existing and isinstance(existing.get("ts"), int):
            _last_inbox_ts = existing["ts"]
            _save_inbox_cursor(_last_inbox_ts)
    _log(f"startup cursor: last_inbox_ts={_last_inbox_ts}")
    _load_rate_log()  # AUDIT-2-005: restore rate counter from disk
    if _mode() == "live":
        _drain_startup_queue()  # AUDIT-2-003: process items queued before last restart
    _log("forge_listener started")
    while True:
        try:
            mode = _mode()
            if mode != "off":
                _route_inbox(mode)
                _route_voice_to_forge(mode)
            _update_board()
        except Exception as exc:
            _log(f"tick error: {exc}")
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
