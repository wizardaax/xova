"""
repo_ideas_seeder.py — seeds context_broker with mined ideas from all repos.
Run once (or any time repos are re-scanned) to populate shared agent knowledge.
Agents read via: context_broker.py --action get --key "ideas.<name>"
"""
import json, os, subprocess, sys, time

PY     = sys.executable
BROKER = r"C:\Xova\plugins\context_broker.py"
NO_WIN = 0x08000000

SLOTS = [
    # ── STUBS THAT NEED REAL IMPLEMENTATION ──────────────────────────────────
    {
        "key":   "ideas.phi_ucb_routing",
        "agent": "mesh",
        "tags":  ["stub", "math", "routing", "priority"],
        "value": {
            "title": "φ-UCB routing — wired nowhere",
            "file":  "D:/github/wizardaax/recursive-field-math-pro/phi_ucb.py",
            "what":  "φ-modulated Upper Confidence Bound: Q(i) + α × φ^β × √(ln t / N(i)). Designed for Fibonacci/Lucas tree agent routing.",
            "gap":   "Module exists, benchmark harness disabled, zero live consumers. No agent uses it for task routing.",
            "idea":  "Wire into mesh_runner.py as the task-dispatch scoring function. Replace round-robin with φ-UCB scores per agent.",
        }
    },
    {
        "key":   "ideas.rff_score_stub",
        "agent": "mesh",
        "tags":  ["stub", "coherence", "rff"],
        "value": {
            "title": "rff_score.py always returns score=0.0",
            "file":  "C:/Xova/plugins/rff_score.py",
            "what":  "Plugin for recursive field coherence over mesh_feed.jsonl.",
            "gap":   "Coherence calculation is placeholder — hardcoded 0.0. The φ-harmonic formula exists in rfm-pro but is not called.",
            "idea":  "Import _coherence() from rfm_core or reimplement the 15-line φ-harmonic windowed calculation inline. Then wire score into CoherenceTimeline tab.",
        }
    },
    {
        "key":   "ideas.evolution_simulation_stub",
        "agent": "forge",
        "tags":  ["stub", "evolution", "meta_engine"],
        "value": {
            "title": "EvolutionEngine simulation stage always returns ok=True",
            "file":  "D:/github/wizardaax/Snell-Vern-Hybrid-Drive-Matrix/meta_engine.py",
            "what":  "Four-stage self-improvement: observe → propose → simulate → apply. Gate flag always set.",
            "gap":   "Simulate stage is stubbed. Proposed patches never actually run in sandbox. Human gate hardcoded ON so auto-merge never fires.",
            "idea":  "Shadow agent pair: run patch + control in parallel, measure coherence delta, auto-merge if delta > 0.05. Use subprocess sandbox with timeout.",
        }
    },
    {
        "key":   "ideas.coherence_as_control_signal",
        "agent": "mesh",
        "tags":  ["architecture", "coherence", "feedback", "critical"],
        "value": {
            "title": "Coherence computed everywhere — fed back nowhere",
            "files": ["sce88_build.py", "structural_detector.py", "coherence_sentinel.py"],
            "what":  "Coherence scores [0,1] produced by SCE-88 validator, φ-harmonic anomaly detector, and global mesh monitor.",
            "gap":   "Zero feedback loops. Agents compute coherence but don't adjust priorities, resource allocation, or routing based on it.",
            "idea":  "Add coherence-aware scheduler in mesh_runner: if agent_coherence < 0.4, halve its task allocation. If global < 0.5, freeze non-critical tasks.",
        }
    },
    {
        "key":   "ideas.ternary_failure_model",
        "agent": "mesh",
        "tags":  ["ternary", "fault-tolerance", "architecture"],
        "value": {
            "title": "Ternary logic computed but never used as failure state",
            "file":  "D:/github/wizardaax/Snell-Vern-Hybrid-Drive-Matrix/agents/ternary_logic_agent.py",
            "what":  "TernaryLogicAgent computes (t0, t1, t2) balance. 3-state logic natural for running/degraded/failed.",
            "gap":   "Output is computed but decoupled from task execution. Never used as control signal.",
            "idea":  "Map ternary output to agent health state: t0>0.6=healthy, t1>0.4=degraded(retry with reduced load), t2>0.3=failed(reroute). Feed into scheduler.",
        }
    },
    {
        "key":   "ideas.self_model_predictions",
        "agent": "forge",
        "tags":  ["self-model", "planning", "architecture"],
        "value": {
            "title": "SelfModel stubbed to state snapshot — no predictions",
            "file":  "D:/github/wizardaax/Snell-Vern-Hybrid-Drive-Matrix/self_model.py",
            "what":  "SelfModel tracks internal agent state. ask() method exists.",
            "gap":   "ask() returns state snapshot only. No 'what should I do next?' recommendation output.",
            "idea":  "Add predict_next_task() using recent task history + coherence trend + Lucas convergence signal to recommend next high-value action.",
        }
    },

    # ── UNBUILT UI FEATURES ───────────────────────────────────────────────────
    {
        "key":   "ideas.depth_toggle_ui",
        "agent": "xova",
        "tags":  ["ui", "unbuilt", "education"],
        "value": {
            "title": "Depth-toggle: explain like 12 / 16 / dev / show code",
            "source": "MASTER_TODO.md",
            "what":  "Depth register that adjusts explanation verbosity and technical level per response.",
            "gap":   "No depth=N parameter in any agent payload, no depth-aware filtering in Xova app.",
            "idea":  "Add depth selector (1-4) to chat toolbar. Pass as system prompt prefix: 'Explain at depth {N}: 1=simple analogy, 2=concept, 3=technical, 4=code+internals'.",
        }
    },
    {
        "key":   "ideas.live_action_trace",
        "agent": "xova",
        "tags":  ["ui", "unbuilt", "observability"],
        "value": {
            "title": "Live action trace panel — plain English narration of Xova's work",
            "source": "MASTER_TODO.md",
            "what":  "Show what Xova is doing: 'running agent 5', 'calling Ollama', 'writing context slot'.",
            "gap":   "Not implemented. No action history indexing.",
            "idea":  "Each xova_run invocation writes one line to C:/Xova/memory/action_trace.jsonl (ts, action, plugin, args_summary). ActionTrace.tsx reads last 20 lines on 2s interval.",
        }
    },
    {
        "key":   "ideas.replay_button",
        "agent": "xova",
        "tags":  ["ui", "unbuilt", "ux"],
        "value": {
            "title": "Replay any prior action with current context",
            "source": "MASTER_TODO.md",
            "what":  "Re-run button on any result bubble. Parameterized action template system.",
            "gap":   "No action history indexing, no template system.",
            "idea":  "Store action_trace.jsonl with plugin+args. Add replay button to ActionTrace rows — calls same plugin with fresh ts. Needs action_trace first.",
        }
    },
    {
        "key":   "ideas.help_bubble_system",
        "agent": "xova",
        "tags":  ["ui", "unbuilt", "ux"],
        "value": {
            "title": "? bubbles next to controls — what/how/why panels",
            "source": "MASTER_TODO.md",
            "what":  "Contextual help for every dock tab and control.",
            "gap":   "No help registry, no UI bubbles anywhere.",
            "idea":  "HelpRegistry: Record<tabId, {what, how, why}>. Small ? button in each dock tab header. onClick shows modal. Write registry as JSON, load statically.",
        }
    },

    # ── ARCHITECTURAL CONVERGENCE OPPORTUNITIES ───────────────────────────────
    {
        "key":   "ideas.math_library_unification",
        "agent": "forge",
        "tags":  ["architecture", "refactor", "math", "lucas"],
        "value": {
            "title": "Lucas / Fibonacci / φ reimplemented in 4 repos — no shared cache",
            "repos": ["recursive-field-math-pro", "Snell-Vern-Hybrid-Drive-Matrix", "rfm-pro", "xova/evolve.py"],
            "what":  "Same Lucas sequence, Egyptian fraction decomposition, and φ angle calculations exist in 4+ places.",
            "gap":   "Each instance reimplements without shared cache or version contract. Results diverge.",
            "idea":  "Canonical recursive_field_math package at D:/github/wizardaax/recursive-field-math-pro. All others import from it via sys.path injection (stdlib, no pip).",
        }
    },
    {
        "key":   "ideas.agent_registry_federation",
        "agent": "mesh",
        "tags":  ["architecture", "federation", "registry"],
        "value": {
            "title": "No shared AgentBase — 13 agents + plugins have no common capability schema",
            "what":  "Snell-Vern agents, RFM EvolutionEngine federation agents, and Xova plugins all claim to be 'agents' with no shared interface.",
            "gap":   "No get_agents(), no agent_schema(id), no invoke_agent(id, task). Federation mapping is a fragile hardcoded dict.",
            "idea":  "AgentManifest: {id, role, capabilities[], endpoint, health_check}. JSON file per agent. Registry scans D:/github/wizardaax/*/agent_manifest.json at startup.",
        }
    },
    {
        "key":   "ideas.probe_watcher_base",
        "agent": "forge",
        "tags":  ["architecture", "refactor", "probes"],
        "value": {
            "title": "absorb_loop / coherence_sentinel / threat_watch all reimplement same poll pattern",
            "files": ["absorb_loop.py", "coherence_sentinel.py", "threat_watch_probe.py", "swarm_status.py"],
            "what":  "Each: poll source → filter → emit JSON. Each reimplements logging, singleton guard, error handling.",
            "gap":   "No shared harness. Bug in one doesn't get fixed in others.",
            "idea":  "ProbeBase(source_path, interval, emit_path). Subclass overrides filter() and transform(). Retry, singleton guard, cursor tracking handled once.",
        }
    },
    {
        "key":   "ideas.memory_store_unification",
        "agent": "forge",
        "tags":  ["architecture", "memory", "query"],
        "value": {
            "title": "6+ separate memory stores with no shared query layer",
            "stores": ["absorb_log.jsonl", "mesh_feed.jsonl", "forge_events.jsonl", "voice_inbox.json", "context_broker.json", "agent_board.json"],
            "what":  "Each store has a different format and every consumer rolls its own parser.",
            "gap":   "No unified query. Can't ask 'all events about agent X in last hour' across stores.",
            "idea":  "MemoryQuery.py: read(store, filter_fn, limit, since_ts) → []. Thin stdlib wrapper. No schema migration — just consistent access pattern.",
        }
    },
    {
        "key":   "ideas.mesh_event_bus",
        "agent": "mesh",
        "tags":  ["architecture", "events", "pub-sub"],
        "value": {
            "title": "All inter-process comms via file polling — no event bus",
            "what":  "xova_watchdog, forge_listener, absorb_loop all poll files on timers. Race conditions possible on concurrent writes.",
            "gap":   "No pub/sub. No guaranteed ordering. No backpressure.",
            "idea":  "File-based pub/sub: publisher writes to <topic>.jsonl atomically (tmp+replace). Subscribers track cursor in <topic>.cursor.json. ProbeBase handles this once.",
        }
    },

    # ── OPEN AUDIT ITEMS ──────────────────────────────────────────────────────
    {
        "key":   "audit.open_items",
        "agent": "forge",
        "tags":  ["audit", "bugs", "open"],
        "value": {
            "title": "Open audit findings (AUDIT-2-007 through AUDIT-2-024)",
            "items": [
                "AUDIT-2-007: No retry on claude subprocess failure in forge_bridge.py",
                "AUDIT-2-011: ask_forge tool visibility unverified in Jarvis loader",
                "AUDIT-2-012: 150s timeout may exceed Jarvis LLM call timeout",
                "AUDIT-2-013: End-to-end Jarvis→Forge voice test pending",
                "AUDIT-2-016: 'ask forge: X' colon variant doesn't match regex",
                "AUDIT-2-019: Multiple mesh_runner instances can accumulate",
                "AUDIT-2-021: Feed tab emoji (🔒) confusing — should be 📡",
                "AUDIT-2-022: /enroll slash command has no UI button",
                "AUDIT-2-023: Watchdog has no auto-reload of xova_watchdog.py edits",
                "AUDIT-2-024: forge_listener resets last_inbox_ts on startup — potential reprocessing",
            ],
            "source": "C:/Xova/AUDIT_2026-05-04_pass2.md",
        }
    },

    # ── OLLAMA LOCK CONTENTION ────────────────────────────────────────────────
    {
        "key":   "ideas.ollama_queue",
        "agent": "jarvis",
        "tags":  ["critical", "concurrency", "ollama"],
        "value": {
            "title": "Three clients compete for single Ollama via file semaphore — no queue",
            "clients": ["absorb_loop", "Jarvis voice", "Xova chat"],
            "what":  "File-based lock (ollama.lock) serializes all three. No priority ordering. No timeout recovery if lock holder crashes.",
            "gap":   "AUDIT-2-005 flagged, still open. Socket timeout resets per-byte — can stall indefinitely.",
            "idea":  "OllamaQueue: priority queue (chat > voice > background). Named pipe or local HTTP microbroker. Stdlib socket server, 10 lines.",
        }
    },
]


def set_slot(key: str, value: dict, agent: str, tags: list) -> bool:
    result = subprocess.run(
        [PY, BROKER,
         "--action", "set",
         "--key",   key,
         "--value", json.dumps(json.dumps(value)),
         "--agent", agent,
         "--tags",  ",".join(tags)],
        capture_output=True, text=True,
        creationflags=NO_WIN, timeout=10,
    )
    try:
        r = json.loads(result.stdout.strip())
        return r.get("ok", False)
    except Exception:
        return False


def main():
    t0 = time.time()
    written = 0
    errors = []
    for slot in SLOTS:
        ok = set_slot(slot["key"], slot["value"], slot["agent"], slot["tags"])
        if ok:
            written += 1
        else:
            errors.append(slot["key"])

    ms = int((time.time() - t0) * 1000)
    print(json.dumps({
        "ok":      len(errors) == 0,
        "written": written,
        "errors":  errors,
        "total":   len(SLOTS),
        "ms":      ms,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
