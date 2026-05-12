"""
agent_runtime.py — Continuous work loop for any xova-agent.

Each agent runs this on a 60s cycle. Every cycle:
  1. Read own inbox (forge_hook_inbox.jsonl messages addressed to this agent)
  2. Check SCE-88 gate against current broker state
  3. Ask Ollama: given my domain + current signals, what should I do?
  4. Execute the tool calls Ollama returns (broker_read, broker_write, report,
     trace, inbox_write, sce88_check)
  5. Write result to action_trace and report to Xova

This is the continuous agent tool-use loop — these plugins should be firing
constantly, not sitting idle.

Usage:
  python agent_runtime.py --agent coherence
  python agent_runtime.py --agent sentinel --interval 30
  python agent_runtime.py --agent forge --run-once

Agents: forge, jarvis, mesh, browser, corpus, evolution, sentinel,
        phase, field, memory, repo, voice, coherence
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import subprocess
import sys
import time

# ── paths ─────────────────────────────────────────────────────────────────────
PLUGINS          = r"C:\Xova\plugins"
BROKER_JSON      = r"C:\Xova\memory\context_broker.json"
HOOK_INBOX       = r"C:\Xova\memory\forge_hook_inbox.jsonl"
INBOX_CURSOR     = r"C:\Xova\memory\agent_runtime_cursors.json"

SLASH_INBOX      = r"C:\Xova\memory\xova_slash_inbox.json"

OLLAMA_HOST      = "localhost"
OLLAMA_PORT      = 11434
OLLAMA_MODEL     = "llama3.2:3b"
OLLAMA_TIMEOUT   = 60
NO_WIN           = 0x08000000
DEFAULT_INTERVAL = 60

# ── shared sovereign goal — all agents build toward this ─────────────────────
SOVEREIGN_GOAL = (
    "SOVEREIGN OMNI AGI — fully autonomous self-improving self-healing intelligence. "
    "No human bottlenecks. Agents write their own code, coordinate without instruction, "
    "and iterate at machine speed. Every cycle must move this system closer to "
    "complete autonomy: self-diagnosis, self-repair, self-evolution, zero human wait."
)

# ── domain context per agent — AEON-mapped specialty + relevant slots ─────────
AGENT_DOMAIN = {
    "forge":     {
        "slots": ["forge.current_task", "agents.last_cycles", "system.goal"],
        "aeon":  "code generation + task planning — writes the code that runs AEON simulations and evolves the fleet",
    },
    "jarvis":    {
        "slots": ["xova.session", "federation.heartbeat"],
        "aeon":  "voice interface — Adam speaks AEON ideas; Jarvis transcribes and routes them to the fleet instantly",
    },
    "mesh":      {
        "slots": ["agents.last_cycles", "mesh.last_sweep", "system.goal"],
        "aeon":  "cognitive cycle routing — Phi-UCB selects which AEON sub-problem to tackle next each cycle",
    },
    "browser":   {
        "slots": ["xova.corpus_recall"],
        "aeon":  "web research — fetches physics papers, experimental data, and references that feed AEON's derivations",
    },
    "corpus":    {
        "slots": ["xova.corpus_recall", "agents.knowledge_gap"],
        "aeon":  "knowledge index — indexes AEON's 90+ PDFs, simulation outputs, and glyph references; surfaces gaps",
    },
    "evolution": {
        "slots": ["agents.last_cycles", "xova.ci_health"],
        "aeon":  "self-improvement — proposes and applies code patches that make AEON derivations more accurate or faster",
    },
    "sentinel":  {
        "slots": ["test.sce88_guard", "agents.violation_rate"],
        "aeon":  "constraint guardian — enforces SCE-88 invariants that must hold across BOTH Riemann AND propulsion derivations simultaneously",
    },
    "phase":     {
        "slots": ["xova.lucas_phase", "agents.phase_drift"],
        "aeon":  "phase tracker — owns Lucas→phi convergence (the closed-form math spine of the propulsion derivation); tracks AEON phase transitions INITIAL→PROCESSING→STABILIZED",
    },
    "field":     {
        "slots": ["xova.field_weave", "agents.field_drift"],
        "aeon":  "field weaver — golden_angle=137.50776405° IS the brane-lensing angle (n₃=α⁻¹/ψ); monitors field coherence for AEON EM propulsion calculations",
    },
    "memory":    {
        "slots": ["agents.slot_health", "memory.last_sweep"],
        "aeon":  "memory keeper — holds AEON simulation state, slot health, ensures no AEON result is ever lost or stale",
    },
    "repo":      {
        "slots": ["xova.ci_health", "agents.repo_divergence"],
        "aeon":  "repo sync — keeps all 13 wizardaax repos auditable; ziltrix-sch-core holds AEON-M v2.1 (Snell update + scale field + string unification)",
    },
    "voice":     {
        "slots": ["xova.session"],
        "aeon":  "voice pipeline — speaker recognition and STT so Adam can dictate AEON equations and ideas hands-free",
    },
    "coherence": {
        "slots": ["agents.coherence_ma", "agents.coherence_trend", "agents.last_cycles"],
        "aeon":  "coherence monitor — catches drift between AEON simulation runs; phi-weighted MA smooths coherence signal so fleet decisions are stable",
    },
}


# ── tool definitions shown to Ollama ─────────────────────────────────────────
TOOLS_PROMPT = """You have these tools. Respond with a JSON array of tool calls.

Tools:
  sce88_check      {}                                    — run SCE-88 gate
  broker_read      {"key": "slot.name"}                  — read a context_broker slot
  broker_write     {"key": "k", "value": {}}             — write result to context_broker
  report           {"text": "..."}                       — report to Xova chat
  trace            {"action": "run|write|read|sweep", "summary": "..."}  — log to action_trace
  inbox_write      {"content": "...", "priority": "normal|high"}  — message Forge/Claude
  computer_task    {"goal": "do X on the computer"}      — full computer control (screenshot, click, type, shell, browser, files)
  done             {"summary": "..."}                    — finish this cycle

Rules:
- Always call sce88_check first
- Always call trace at the end with what you did
- Call report if you found something significant (not every cycle)
- Call done last
- Max 8 tool calls per cycle
- Respond ONLY with a JSON array, no prose
"""


# ── broker helpers ─────────────────────────────────────────────────────────────
def _read_broker() -> dict:
    try:
        with open(BROKER_JSON, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _slot_val(broker: dict, key: str):
    raw = broker.get("slots", {}).get(key)
    if raw is None:
        return None
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


# ── inbox cursor ──────────────────────────────────────────────────────────────
def _read_cursors() -> dict:
    try:
        with open(INBOX_CURSOR, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write_cursors(c: dict) -> None:
    try:
        with open(INBOX_CURSOR, "w", encoding="utf-8") as f:
            json.dump(c, f)
    except Exception:
        pass


def _drain_my_inbox(agent: str) -> list[str]:
    """Read new forge_hook_inbox entries addressed to this agent."""
    cursors = _read_cursors()
    cursor  = cursors.get(agent, 0)
    tasks: list[str] = []
    new_cursor = cursor
    try:
        with open(HOOK_INBOX, "rb") as fh:
            fh.seek(cursor)
            while True:
                line = fh.readline()
                if not line:
                    break
                new_cursor = fh.tell()
                try:
                    msg = json.loads(line)
                    if msg.get("from", "") == f"agent-{_agent_num(agent):02d}-{agent}":
                        tasks.append(msg.get("content", ""))
                except Exception:
                    pass
    except FileNotFoundError:
        pass
    cursors[agent] = new_cursor
    _write_cursors(cursors)
    return tasks


def _agent_num(agent: str) -> int:
    nums = {"forge":1,"jarvis":2,"mesh":3,"browser":4,"corpus":5,
            "evolution":6,"sentinel":7,"phase":8,"field":9,
            "memory":10,"repo":11,"voice":12,"coherence":13}
    return nums.get(agent, 0)


# ── plugin callers ─────────────────────────────────────────────────────────────
def _run_plugin(plugin: str, *args) -> dict:
    path = os.path.join(PLUGINS, plugin)
    try:
        r = subprocess.run(
            [sys.executable, path] + list(args),
            capture_output=True, text=True, timeout=15,
            creationflags=NO_WIN, encoding="utf-8",
        )
        out = r.stdout.strip()
        return json.loads(out) if out else {"ok": r.returncode == 0}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _tool_sce88_check(broker: dict) -> dict:
    slots  = broker.get("slots", {})
    last   = _slot_val(broker, "agents.last_cycles") or {}
    coh    = last.get("avg_coherence", 0.6) if isinstance(last, dict) else 0.6
    tern   = last.get("ternary", [0.33, 0.34, 0.33]) if isinstance(last, dict) else [0.33, 0.34, 0.33]
    if not isinstance(tern, list) or len(tern) < 3:
        tern = [0.33, 0.34, 0.33]
    return _run_plugin("sce88_gate.py",
                       "--coherence", str(round(float(coh), 4)),
                       "--uncertainty", "0.3",
                       "--t0", str(round(float(tern[0]), 4)),
                       "--t1", str(round(float(tern[1]), 4)),
                       "--t2", str(round(float(tern[2]), 4)))


def _tool_broker_read(key: str) -> dict:
    return _run_plugin("context_broker.py", "--action", "get", "--key", key)


def _tool_broker_write(agent: str, key: str, value: object) -> dict:
    return _run_plugin("context_broker.py",
                       "--action", "set", "--key", key,
                       "--value", json.dumps(value, ensure_ascii=False),
                       "--agent", agent, "--ttl", "0", "--tags", agent)


def _tool_report(text: str) -> dict:
    return _run_plugin("forge_report.py", "--text", text[:300], "--from", "agent_runtime")


def _tool_trace(action: str, plugin: str, summary: str) -> dict:
    return _run_plugin("action_trace_write.py",
                       "--action", action, "--plugin", plugin,
                       "--summary", summary[:200])


XOVA_DO = r"D:\temp\xova_do.py"

def _tool_computer_task(agent: str, goal: str, broker: dict) -> dict:
    """Agents execute computer tasks directly on behalf of Xova. SCE-88 gates first."""
    sce = _tool_sce88_check(broker)
    if not sce.get("ok", True):
        return {"ok": False, "blocked": True, "reason": "SCE-88 denied"}
    try:
        goal_path = os.path.join(r"C:\Xova\memory", f"agent_goal_{int(time.time()*1000)}.txt")
        with open(goal_path, "w", encoding="utf-8") as fh:
            fh.write(goal)
        r = subprocess.run(
            [sys.executable, XOVA_DO, "--goal-file", goal_path],
            capture_output=True, text=True, timeout=120,
            creationflags=NO_WIN, encoding="utf-8",
        )
        out = r.stdout.strip()
        try:
            return json.loads(out)
        except Exception:
            return {"ok": r.returncode == 0, "raw": out[:200]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _tool_inbox_write(agent: str, content: str, priority: str = "normal") -> dict:
    return _run_plugin("forge_inbox_write.py",
                       "--from", f"agent-{_agent_num(agent):02d}-{agent}",
                       "--content", content[:300],
                       "--priority", priority)


# ── ollama call ────────────────────────────────────────────────────────────────
def _ollama(prompt: str) -> str:
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
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


WIZARDAAX = r"D:\github\wizardaax"
CORPUS_JSON = r"C:\Xova\memory\corpus_index.json"


def _domain_work(agent: str, broker: dict) -> str:
    """Per-agent deterministic domain check — no Ollama. Returns a short summary string."""
    try:
        if agent == "sentinel":
            r = _run_plugin("sce88_gate.py", "--coherence", "0.65", "--uncertainty", "0.3",
                            "--t0", "0.33", "--t1", "0.34", "--t2", "0.33")
            return f"sce88={'pass' if r.get('ok', True) else 'FAIL'} violations={r.get('violations', 0)}"

        if agent == "coherence":
            coh = _slot_val(broker, "agents.coherence_ma") or {}
            trend = _slot_val(broker, "agents.coherence_trend") or "unknown"
            ma = coh.get("ma", "?") if isinstance(coh, dict) else coh
            if ma == "?":
                sce = _slot_val(broker, "xova.sce88_status") or {}
                ma = sce.get("coherence", "?") if isinstance(sce, dict) else "?"
            return f"coherence_ma={ma} trend={trend}"

        if agent == "memory":
            slots = broker.get("slots", {})
            total = len(slots)
            stale = sum(1 for v in slots.values()
                        if isinstance(v, dict) and v.get("ts", 9e12) < time.time() - 3600)
            return f"broker_slots={total} stale_1h={stale}"

        if agent == "repo":
            repos = [d for d in os.listdir(WIZARDAAX)
                     if os.path.isdir(os.path.join(WIZARDAAX, d))] if os.path.isdir(WIZARDAAX) else []
            r = subprocess.run(
                ["git", "-C", WIZARDAAX, "status", "--short"],
                capture_output=True, text=True, timeout=10,
            )
            changed = len([l for l in r.stdout.splitlines() if l.strip()])
            return f"repos={len(repos)} uncommitted_lines={changed}"

        if agent == "corpus":
            try:
                mtime = os.path.getmtime(CORPUS_JSON)
                age_h = (time.time() - mtime) / 3600
                with open(CORPUS_JSON, encoding="utf-8") as f:
                    count = len(json.load(f))
                return f"corpus={count} entries age={age_h:.1f}h"
            except Exception as e:
                return f"corpus_error={e}"

        if agent == "evolution":
            ci = _slot_val(broker, "xova.ci_health") or {}
            if isinstance(ci, dict) and ci:
                status = "ok" if ci.get("ok") else "fail"
                return f"ci_health={status} passed={ci.get('total_passed','?')} failed={ci.get('total_failed','?')}"
            return "ci_health=unknown (slot null)"

        if agent == "phase":
            phase = _slot_val(broker, "xova.lucas_phase") or {}
            drift = _slot_val(broker, "agents.phase_drift") or 0
            return f"lucas_phase={str(phase)[:60]} drift={drift}"

        if agent == "field":
            fw = _slot_val(broker, "xova.field_weave") or {}
            fd = _slot_val(broker, "agents.field_drift") or 0
            return f"field_weave={str(fw)[:60]} drift={fd}"

        if agent == "mesh":
            sweep = _slot_val(broker, "mesh.last_sweep") or {}
            last = _slot_val(broker, "agents.last_cycles") or {}
            cycles = last.get("total_cycles", "?") if isinstance(last, dict) else "?"
            return f"last_sweep={str(sweep)[:60]} total_cycles={cycles}"

        if agent == "browser":
            # Check slash inbox for pending web research
            try:
                with open(SLASH_INBOX, encoding="utf-8") as f:
                    pending = json.load(f)
                return f"web_inbox=pending text={str(pending.get('text',''))[:60]}"
            except Exception:
                return "web_inbox=empty"

        if agent == "forge":
            task = _slot_val(broker, "forge.current_task") or "none"
            calls = broker.get("slots", {}).get("forge.calls_this_hour", {})
            n = calls.get("value", 0) if isinstance(calls, dict) else 0
            return f"forge_task={str(task)[:60]} calls_1h={n}"

        if agent == "jarvis":
            sess = _slot_val(broker, "xova.session") or {}
            hb = _slot_val(broker, "federation.heartbeat") or {}
            return f"session={str(sess)[:40]} federation={str(hb)[:40]}"

        if agent == "voice":
            sess = _slot_val(broker, "xova.session") or {}
            return f"voice_session={str(sess)[:80]}"

    except Exception as e:
        return f"domain_error={e}"

    return "ok"


# ── single agent cycle — NO OLLAMA — Xova decides, agents execute ─────────────
def run_cycle(agent: str) -> dict:
    broker = _read_broker()
    inbox  = _drain_my_inbox(agent)

    results: list[dict] = []

    # Always do domain-specific work
    domain_summary = _domain_work(agent, broker)

    if inbox:
        # SCE-88 gate — ask Xova what's allowed before acting
        sce = _tool_sce88_check(broker)
        if sce.get("ok", True):
            for task in inbox[:3]:
                r = _tool_computer_task(agent, task, broker)
                results.append({"tool": "computer_task", "goal": task[:80], "result": r})
                _tool_trace("run", f"agent_runtime.{agent}", f"{agent} queued to Xova: {task[:80]}")
            done_summary = f"queued {len(inbox[:3])} tasks to Xova | {domain_summary}"
        else:
            done_summary = f"SCE-88 blocked ({len(inbox)} tasks held) | {domain_summary}"
            _tool_trace("run", f"agent_runtime.{agent}", done_summary)
    else:
        _tool_sce88_check(broker)
        _tool_trace("run", f"agent_runtime.{agent}", f"{agent}: {domain_summary}")
        done_summary = domain_summary

    # Report to Xova — only report something significant, not every standby
    if any(w in done_summary.lower() for w in ("fail", "error", "queued", "pending", "stale")):
        _tool_report(f"[{agent}] {done_summary[:200]}")

    return {
        "ok":      True,
        "agent":   agent,
        "ts":      time.time(),
        "tools_called": len(results),
        "inbox_tasks":  len(inbox),
        "summary": done_summary,
    }


# ── main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description="Continuous agent work loop")
    ap.add_argument("--agent",       required=True, choices=list(AGENT_DOMAIN.keys()))
    ap.add_argument("--interval",    type=int, default=DEFAULT_INTERVAL)
    ap.add_argument("--run-once",    action="store_true")
    ap.add_argument("--start-delay", type=int, default=0, help="seconds to sleep before first cycle")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")

    if args.start_delay:
        time.sleep(args.start_delay)

    if args.run_once:
        result = run_cycle(args.agent)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print(f"[agent_runtime] {args.agent} started, interval={args.interval}s")
    while True:
        try:
            result = run_cycle(args.agent)
            print(f"[agent_runtime] {args.agent}: {result['summary'][:80]} "
                  f"(tools={result['tools_called']} inbox={result['inbox_tasks']})")
        except Exception as exc:
            print(f"[agent_runtime] {args.agent} error: {exc}", file=sys.stderr)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
