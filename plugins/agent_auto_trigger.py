"""
agent_auto_trigger.py — Automatic agent evolution trigger based on context_broker thresholds.

Polls agents.* slots from C:\Xova\memory\context_broker.json and fires
agent_write_code.py for any agent whose metrics breach their thresholds.

Rate limit: 1 trigger per agent per 24h via C:\Xova\memory\auto_trigger_log.jsonl

Usage:
    python agent_auto_trigger.py --run-once    # check all, trigger breaches, exit
    python agent_auto_trigger.py --daemon      # poll every 300s forever

Stdlib only. NO_WIN subprocess flag. 100-year rule.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from typing import Any

CONTEXT_BROKER   = r"C:\Xova\memory\context_broker.json"
TRIGGER_LOG      = r"C:\Xova\memory\auto_trigger_log.jsonl"
AGENT_WRITE_CODE = r"C:\Xova\plugins\agent_write_code.py"
FORGE_REPORT     = r"C:\Xova\plugins\forge_report.py"

NO_WIN           = 0x08000000
POLL_SECONDS     = 300
RATE_LIMIT_S     = 86400  # 24h

# (slot_key, agent_name, check_fn)
THRESHOLDS: list[tuple[str, str, Any]] = [
    ("agents.coherence_trend",  "coherence",   lambda v: isinstance(v, (int, float)) and v < -0.05),
    ("agents.violation_rate",   "sentinel",    lambda v: isinstance(v, dict) and float(v.get("rate_per_hour", 0)) > 5.0),
    ("agents.slot_health",      "memory",      lambda v: isinstance(v, dict) and float(v.get("score", 1.0)) < 0.7),
    ("agents.knowledge_gap",    "corpus",      lambda v: isinstance(v, dict) and float(v.get("overall", 0)) > 0.6),
    ("agents.repo_divergence",  "repo",        lambda v: isinstance(v, dict) and float(v.get("score", 0)) > 0.5),
    ("agents.phase_drift",      "phase",       lambda v: isinstance(v, dict) and v.get("is_drifting") is True),
    ("agents.field_drift",      "field",       lambda v: isinstance(v, dict) and v.get("is_alert") is True),
]


def _read_broker() -> dict:
    try:
        with open(CONTEXT_BROKER, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _slot_val(broker: dict, key: str) -> Any:
    raw = broker.get("slots", {}).get(key)
    if raw is None:
        return None
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


def _load_log() -> list[dict]:
    entries: list[dict] = []
    if not os.path.exists(TRIGGER_LOG):
        return entries
    try:
        with open(TRIGGER_LOG, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except Exception:
                        pass
    except Exception:
        pass
    return entries


def _recently_triggered(agent: str) -> bool:
    cutoff = time.time() - RATE_LIMIT_S
    for e in _load_log():
        if e.get("agent") == agent and float(e.get("ts", 0)) >= cutoff:
            return True
    return False


def _log_trigger(agent: str, slot_key: str, value: Any) -> None:
    record = {"ts": time.time(), "agent": agent, "slot_key": slot_key, "value": value}
    try:
        with open(TRIGGER_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def trigger_agent(agent: str, slot_key: str, value: Any) -> None:
    print(f"[auto_trigger] FIRING {agent} (slot={slot_key} value={value!r})")
    try:
        proc = subprocess.Popen(
            [sys.executable, AGENT_WRITE_CODE, "--agent", agent],
            creationflags=NO_WIN, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        stdout, stderr = proc.communicate(timeout=120)
        if proc.returncode != 0:
            print(f"[auto_trigger] {agent} exited {proc.returncode}", file=sys.stderr)
    except subprocess.TimeoutExpired:
        print(f"[auto_trigger] {agent} timed out", file=sys.stderr)
        proc.kill()
    except Exception as exc:
        print(f"[auto_trigger] launch failed {agent}: {exc}", file=sys.stderr)

    _log_trigger(agent, slot_key, value)

    try:
        subprocess.Popen(
            [sys.executable, FORGE_REPORT,
             "--text", f"auto_trigger: fired {agent} evolution (slot={slot_key})",
             "--from", "auto_trigger"],
            creationflags=NO_WIN, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def check_all() -> int:
    broker = _read_broker()
    if not broker:
        print("[auto_trigger] context_broker unreadable — skip")
        return 0
    fired = 0
    for slot_key, agent, check_fn in THRESHOLDS:
        value = _slot_val(broker, slot_key)
        if value is None:
            continue
        try:
            breached = check_fn(value)
        except Exception:
            continue
        if not breached:
            continue
        if _recently_triggered(agent):
            print(f"[auto_trigger] {agent} breached but rate-limited — skip")
            continue
        trigger_agent(agent, slot_key, value)
        fired += 1
    return fired


def main() -> None:
    ap = argparse.ArgumentParser(description="Auto-trigger agent evolution on threshold breach")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--run-once", action="store_true")
    mode.add_argument("--daemon",   action="store_true")
    args = ap.parse_args()

    if args.run_once:
        fired = check_all()
        print(f"[auto_trigger] done — {fired} trigger(s) fired")
        sys.exit(0)

    print(f"[auto_trigger] daemon started, poll every {POLL_SECONDS}s")
    while True:
        try:
            fired = check_all()
            print(f"[auto_trigger] cycle — {fired} trigger(s)")
        except Exception as exc:
            print(f"[auto_trigger] error: {exc}", file=sys.stderr)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
