"""
agent_task_runner.py — Drain forge_hook_inbox.jsonl and route tasks to agents via Ollama.

Reads new entries from C:\Xova\memory\forge_hook_inbox.jsonl using a byte-cursor
(survives restarts), routes each task to the appropriate agent by calling Ollama
directly, writes results to per-agent outbox files, reports to Xova.

Usage:
    python agent_task_runner.py --run-once   # drain current queue, exit
    python agent_task_runner.py --daemon     # poll every 60s

Stdlib only. 100-year rule.
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import subprocess
import sys
import time
import urllib.parse

INBOX           = r"C:\Xova\memory\forge_hook_inbox.jsonl"
STATE_FILE      = r"C:\Xova\memory\task_runner_state.json"
OUTBOX_DIR      = r"C:\Xova\memory"
FORGE_REPORT    = r"C:\Xova\plugins\forge_report.py"
AGENT_REPOS     = r"D:\github\wizardaax"

OLLAMA_HOST     = "localhost"
OLLAMA_PORT     = 11434
OLLAMA_MODEL    = "llama3.2:3b"
OLLAMA_TIMEOUT  = 90

OUTBOX_CAP      = 50
POLL_SECONDS    = 60
NO_WIN          = 0x08000000

# agent-XX-name short name → agent key used for outbox file naming
_AGENT_MAP = {
    "agent-01-forge":      "forge",
    "agent-02-jarvis":     "jarvis",
    "agent-03-mesh":       "mesh",
    "agent-04-browser":    "browser",
    "agent-05-corpus":     "corpus",
    "agent-06-evolution":  "evolution",
    "agent-07-sentinel":   "sentinel",
    "agent-08-phase":      "phase",
    "agent-09-field":      "field",
    "agent-10-memory":     "memory",
    "agent-11-repo":       "repo",
    "agent-12-voice":      "voice",
    "agent-13-coherence":  "coherence",
}


def _read_state() -> dict:
    try:
        with open(STATE_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"cursor": 0, "last_ts": {}}


def _write_state(state: dict) -> None:
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(state, fh, ensure_ascii=False)
    except Exception:
        pass


def _read_new_entries(cursor: int) -> tuple[list[dict], int]:
    """Read forge_hook_inbox.jsonl from byte cursor. Returns (new_entries, new_cursor)."""
    entries: list[dict] = []
    new_cursor = cursor
    try:
        with open(INBOX, "rb") as fh:
            fh.seek(cursor)
            while True:
                line = fh.readline()
                if not line:
                    break
                new_cursor = fh.tell()
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except Exception:
                    pass
    except FileNotFoundError:
        pass
    return entries, new_cursor


def _ollama_generate(prompt: str, agent_name: str) -> str:
    """Call Ollama /api/generate with a system+user prompt. Returns response text."""
    system = (
        f"You are {agent_name}, a specialist agent in the Xova AGI fleet. "
        "Complete the task below concisely in 2-4 sentences. "
        "Output only the result — no preamble."
    )
    payload = json.dumps({
        "model":  OLLAMA_MODEL,
        "prompt": f"[SYSTEM] {system}\n\n[TASK] {prompt}",
        "stream": False,
    }).encode()
    try:
        conn = http.client.HTTPConnection(OLLAMA_HOST, OLLAMA_PORT, timeout=OLLAMA_TIMEOUT)
        conn.request("POST", "/api/generate",
                     body=payload, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode())
        return data.get("response", "").strip()
    except Exception as exc:
        return f"[ollama error: {exc}]"
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _write_outbox(agent_key: str, entry: dict) -> None:
    path = os.path.join(OUTBOX_DIR, f"{agent_key}_outbox.json")
    try:
        existing: list = []
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                existing = json.load(fh)
        if not isinstance(existing, list):
            existing = []
        existing.append(entry)
        if len(existing) > OUTBOX_CAP:
            existing = existing[-OUTBOX_CAP:]
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(existing, fh, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _report(text: str) -> None:
    try:
        subprocess.Popen(
            [sys.executable, FORGE_REPORT, "--text", text[:300], "--from", "task_runner"],
            creationflags=NO_WIN, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def process_entry(entry: dict) -> bool:
    """Route one inbox entry to its agent. Returns True if processed."""
    sender  = entry.get("from", "")
    content = entry.get("content", "")
    ts      = entry.get("ts", 0)

    agent_key = _AGENT_MAP.get(sender)
    if not agent_key:
        return False  # not an agent sender, skip

    print(f"[task_runner] routing to {agent_key}: {content[:80]}")

    response = _ollama_generate(content, agent_key)
    print(f"[task_runner] {agent_key} response: {response[:120]}")

    outbox_entry = {
        "ts":       time.time(),
        "task_ts":  ts,
        "agent":    agent_key,
        "task":     content,
        "response": response,
    }
    _write_outbox(agent_key, outbox_entry)
    _report(f"{agent_key} completed task: {response[:150]}")
    return True


def drain_inbox() -> int:
    """Read new inbox entries, process each, return count processed."""
    state   = _read_state()
    cursor  = state.get("cursor", 0)
    entries, new_cursor = _read_new_entries(cursor)

    processed = 0
    for entry in entries:
        try:
            if process_entry(entry):
                processed += 1
        except Exception as exc:
            print(f"[task_runner] error processing entry: {exc}", file=sys.stderr)

    state["cursor"] = new_cursor
    _write_state(state)
    return processed


def main() -> None:
    ap = argparse.ArgumentParser(description="Drain agent inbox and route tasks via Ollama")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--run-once", action="store_true")
    mode.add_argument("--daemon",   action="store_true")
    args = ap.parse_args()

    if args.run_once:
        n = drain_inbox()
        print(json.dumps({"ok": True, "processed": n}))
        sys.exit(0)

    print(f"[task_runner] daemon started, poll every {POLL_SECONDS}s")
    while True:
        try:
            n = drain_inbox()
            if n:
                print(f"[task_runner] processed {n} tasks")
        except Exception as exc:
            print(f"[task_runner] error: {exc}", file=sys.stderr)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
