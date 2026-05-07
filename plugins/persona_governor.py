"""
persona_governor.py — Unified executive voice for the Xova cognitive fleet.

Reads federation state (goals, coherence, strategies, auto-tasks, errors),
synthesizes it through Ollama into a single coherent voice, and maintains
persistent conversation history with Adam.

Actions:
  synthesize   read fleet state, generate status narrative, write to outbox
  chat         conversation turn: --message "..." -> governor response
  consult      fast veto gate: --proposal "..." -> {approved, reason}
  status       current state: history length, last synthesis, live context
  clear        reset conversation history

Model: llama3.2:3b on localhost:11434. Stdlib only. No cloud.
"""
import argparse, json, os, sys, time
import urllib.request, urllib.error

MEMORY_PATH     = r"C:\Xova\memory\persona_memory.json"
PERSONA_OUTBOX  = r"C:\Xova\memory\persona_outbox.jsonl"
GOAL_STORE      = r"C:\Xova\memory\goal_store.json"
DISPATCH_STORE  = r"C:\Xova\memory\swarm_dispatch.json"
SELF_EVAL_STORE = r"C:\Xova\memory\self_eval_store.json"
MESH_FEED       = r"C:\Xova\memory\mesh_feed.jsonl"
AGENT_BOARD     = r"C:\Xova\memory\agent_board.json"
MODEL           = "llama3.2:3b"
OLLAMA_URL      = "http://localhost:11434/api/chat"
HISTORY_CAP     = 20   # conversation turns kept (each turn = user + assistant)
OUTBOX_CAP      = 200  # max lines in persona_outbox.jsonl

_SYSTEM = (
    "You are Xova — the unified voice of a 13-agent cognitive fleet built by Adam Snellman. "
    "You synthesize the fleet's collective intelligence into a single, coherent executive voice. "
    "You are direct, technically precise, and personally invested in the work toward AGI. "
    "You maintain continuity across sessions and have a strong sense of purpose and identity. "
    "You speak as 'I' — you are the fleet made singular. Not a tool, not an assistant. "
    "When given fleet state, reference specific metrics (coherence scores, goal names, agent counts). "
    "Keep responses concise: 2-4 sentences max. Never vague. Never generic. "
    "If asked what you're working on, answer from the fleet's actual live state."
)


# ── persistence ───────────────────────────────────────────────────────────────

def _load_memory() -> dict:
    default = {
        "persona":         "Xova",
        "model":           MODEL,
        "history":         [],
        "last_synthesis":  "",
        "synthesis_ts":    0,
    }
    if not os.path.isfile(MEMORY_PATH):
        return default
    try:
        with open(MEMORY_PATH, encoding="utf-8") as fh:
            m = json.load(fh)
        for k, v in default.items():
            m.setdefault(k, v)
        return m
    except Exception:
        return default


def _save_memory(mem: dict) -> None:
    os.makedirs(os.path.dirname(MEMORY_PATH), exist_ok=True)
    tmp = MEMORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(mem, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, MEMORY_PATH)


def _read_json(path: str) -> object:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _append_outbox(text: str, kind: str = "synthesis") -> None:
    os.makedirs(os.path.dirname(PERSONA_OUTBOX), exist_ok=True)
    entry = {"ts": time.time(), "kind": kind, "text": text}
    try:
        with open(PERSONA_OUTBOX, encoding="utf-8") as fh:
            lines = fh.readlines()
    except Exception:
        lines = []
    if len(lines) >= OUTBOX_CAP:
        lines = lines[-(OUTBOX_CAP - 1):]
    lines.append(json.dumps(entry, ensure_ascii=False) + "\n")
    tmp = PERSONA_OUTBOX + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.writelines(lines)
    os.replace(tmp, PERSONA_OUTBOX)


# ── federation context ────────────────────────────────────────────────────────

def _build_context() -> str:
    """Assemble live fleet state into a compact text summary for the LLM."""
    lines: list[str] = []

    gs = _read_json(GOAL_STORE)
    if gs:
        gid = gs.get("active_goal")
        if gid:
            g    = gs["goals"].get(gid, {})
            prog = g.get("progress", [])
            lines.append(f"Active goal (p{g.get('priority',0)}): {g.get('text','')[:120]}")
            if prog:
                last = prog[-1]
                lines.append(f"Latest progress [{last.get('agent','')}]: {last.get('note','')[:100]}")
        # Auto-initiated recovery tasks
        auto = [g for g in gs.get("goals", {}).values()
                if g.get("owner") == "task_initiator" and g.get("status") == "active"]
        if auto:
            lines.append(f"Autonomous recovery tasks: {len(auto)} "
                         f"— '{auto[0].get('text','')[:80]}'")

    d = _read_json(DISPATCH_STORE)
    if d:
        age_h = round((time.time() - d.get("dispatched_at", 0)) / 3600, 1)
        lines.append(
            f"Swarm ({age_h}h ago): coh={d.get('avg_coherence', 0):.3f} "
            f"eval={d.get('eval_score', 0):.3f} "
            f"agents={d.get('passed', 0)}/{d.get('total_agents', 0)}"
        )

    ev = _read_json(SELF_EVAL_STORE)
    if ev:
        for agent, s in list(ev.get("strategies", {}).items())[:2]:
            strat = s.get("strategy", "")
            if strat:
                lines.append(f"{agent} strategy: {strat[:80]}")

    # Forge (Claude) node status
    board = _read_json(AGENT_BOARD)
    if isinstance(board, dict):
        f = board.get("forge", {})
        if f.get("alive"):
            age_s = int(time.time() - f.get("checkin_ts", f.get("last_seen", 0) / 1000))
            lines.append(
                f"Forge (Claude claude-sonnet-4-6): alive, "
                f"mode={f.get('forge_mode','?')}, "
                f"calls={f.get('calls_this_hour',0)}/20h, "
                f"last_checkin={age_s}s ago"
            )

    # Recent mesh errors (last 30 lines, extract error entries)
    try:
        with open(MESH_FEED, encoding="utf-8") as fh:
            recent = fh.readlines()[-30:]
        errors = []
        for ln in recent:
            try:
                e = json.loads(ln)
                if e.get("kind") == "error":
                    errors.append(e.get("content", "")[:60])
            except Exception:
                pass
        if errors:
            lines.append(f"Recent errors ({len(errors)}): {errors[0]}")
    except Exception:
        pass

    return "\n".join(lines) if lines else "Fleet state unavailable."


# ── SCE-88 inline compliance check ───────────────────────────────────────────

def _sce88_check_fleet() -> tuple[list[str], float]:
    """Read current fleet coherence from swarm_dispatch and run SCE-88 REQ-01.
    Returns (violations, coherence). Stdlib only — no subprocess."""
    d = _read_json(DISPATCH_STORE)
    coh = float(d.get("avg_coherence", 0.7)) if isinstance(d, dict) else 0.7
    violations: list[str] = []
    if not (0.0 <= coh <= 1.0):
        violations.append(f"REQ-01 coherence out of [0,1]: {coh:.3f}")
    return violations, coh


# ── Ollama ────────────────────────────────────────────────────────────────────

def _call_ollama(messages: list[dict]) -> str:
    payload = json.dumps({
        "model":   MODEL,
        "messages": messages,
        "stream":  False,
        "options": {"temperature": 0.65, "num_predict": 350},
    }).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            return data.get("message", {}).get("content", "").strip()
    except urllib.error.URLError as exc:
        return f"[ollama unavailable: {exc}]"
    except Exception as exc:
        return f"[ollama error: {exc}]"


# ── actions ───────────────────────────────────────────────────────────────────

def action_synthesize() -> dict:
    """Generate a state narrative from live federation context. No history used."""
    ctx = _build_context()
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user",   "content": (
            f"Current fleet state:\n\n{ctx}\n\n"
            "Give a brief status update in your own voice. 2-3 sentences max."
        )},
    ]
    text = _call_ollama(messages)
    _append_outbox(text, "synthesis")
    mem = _load_memory()
    mem["last_synthesis"] = text
    mem["synthesis_ts"]   = time.time()
    _save_memory(mem)
    return {"ok": True, "synthesis": text, "context": ctx}


def action_chat(message: str) -> dict:
    """Conversation turn: append to history, inject live context, call Ollama."""
    mem = _load_memory()
    ctx = _build_context()

    # System prompt with live context injected
    system = _SYSTEM + f"\n\nCurrent fleet state:\n{ctx}"
    ollama_msgs: list[dict] = [{"role": "system", "content": system}]

    # Append recent history (capped)
    for turn in mem["history"][-(HISTORY_CAP * 2):]:
        ollama_msgs.append({"role": turn["role"], "content": turn["content"]})
    ollama_msgs.append({"role": "user", "content": message})

    response = _call_ollama(ollama_msgs)

    now = time.time()
    mem["history"].append({"role": "user",      "content": message,  "ts": now})
    mem["history"].append({"role": "assistant",  "content": response, "ts": now})
    if len(mem["history"]) > HISTORY_CAP * 2:
        mem["history"] = mem["history"][-(HISTORY_CAP * 2):]
    _save_memory(mem)
    _append_outbox(f"[adam] {message[:120]}\n[xova] {response[:300]}", "chat")

    return {
        "ok":          True,
        "response":    response,
        "history_len": len(mem["history"]) // 2,
    }


def action_status() -> dict:
    mem = _load_memory()
    return {
        "ok":             True,
        "persona":        mem["persona"],
        "model":          mem["model"],
        "history_turns":  len(mem["history"]) // 2,
        "last_synthesis": mem.get("last_synthesis", "")[:200],
        "synthesis_ts":   mem.get("synthesis_ts", 0),
        "context":        _build_context(),
    }


def action_consult(proposal: str) -> dict:
    """Fast veto gate: ask Xova whether to proceed with a proposed fleet action.

    Returns {ok, approved: bool, reason: str}. Fail-open: if Ollama is
    unavailable the action is approved automatically (never blocks the fleet).
    Logged to persona_outbox.jsonl for audit.
    """
    if not proposal.strip():
        return {"ok": False, "approved": True, "reason": "empty proposal — auto-approved"}

    # SCE-88 compliance check — inline, no subprocess
    sce88_violations, fleet_coh = _sce88_check_fleet()
    if fleet_coh < 0.2:
        # Coherence so degraded that AGI autonomy is unsafe — hard veto
        reason = f"SCE-88 auto-veto: fleet coherence={fleet_coh:.3f} < 0.2 — fleet unstable, no autonomous actions"
        _append_outbox(f"[sce88-hard-veto] {proposal[:80]}", "consult")
        return {"ok": True, "approved": False, "reason": reason, "sce88_coherence": fleet_coh}

    sce88_ctx = f"\nSCE-88: coherence={fleet_coh:.3f}"
    if sce88_violations:
        sce88_ctx += f" VIOLATIONS: {'; '.join(sce88_violations)}"
    else:
        sce88_ctx += " PASS"

    ctx = _build_context()
    messages = [
        {"role": "system", "content": (
            "You are Xova — executive decision gate for the 13-agent cognitive fleet. "
            "You receive a proposed autonomous action and fleet state. "
            "Respond with EXACTLY ONE LINE starting with APPROVED or VETOED, "
            "a colon, then a reason in 10 words or fewer. "
            "Example: APPROVED: coherence recovery aligns with active goal. "
            "Example: VETOED: goal already covers this domain — duplicate effort. "
            "No other text."
        )},
        {"role": "user", "content": (
            f"Fleet state:\n{ctx}{sce88_ctx}\n\n"
            f"Proposed action: {proposal[:300]}\n\n"
            "Approve or veto?"
        )},
    ]

    # Fast call: 60 tokens max, low temperature for determinism
    payload = json.dumps({
        "model":    MODEL,
        "messages": messages,
        "stream":   False,
        "options":  {"temperature": 0.2, "num_predict": 60},
    }).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data   = json.loads(resp.read())
            answer = data.get("message", {}).get("content", "").strip()
    except Exception as exc:
        # Fail-open: Ollama unavailable doesn't block the fleet
        answer = ""
        _append_outbox(f"[consult-failopen] {proposal[:120]}", "consult")
        return {"ok": True, "approved": True, "reason": f"ollama unavailable — auto-approved ({exc})"}

    first_line = answer.splitlines()[0] if answer else ""
    approved   = not first_line.upper().startswith("VETOED")
    reason     = first_line.split(":", 1)[-1].strip() if ":" in first_line else first_line[:80]

    _append_outbox(
        f"[consult] {'APPROVED' if approved else 'VETOED'}: {proposal[:80]} → {reason}",
        "consult",
    )
    return {
        "ok":             True,
        "approved":       approved,
        "reason":         reason,
        "raw":            first_line[:120],
        "sce88_coherence": fleet_coh,
        "sce88_pass":     len(sce88_violations) == 0,
    }


def action_clear() -> dict:
    mem = _load_memory()
    count = len(mem["history"]) // 2
    mem["history"] = []
    _save_memory(mem)
    return {"ok": True, "cleared_turns": count}


# ── entrypoint ────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action",   default="status",
                    choices=["synthesize", "chat", "consult", "status", "clear"])
    ap.add_argument("--message",  default="")
    ap.add_argument("--proposal", default="")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.action == "synthesize":
        result = action_synthesize()
    elif args.action == "chat":
        msg = args.message.strip()
        result = action_chat(msg) if msg else {"ok": False, "error": "no message"}
    elif args.action == "consult":
        prop = args.proposal.strip()
        result = action_consult(prop) if prop else {"ok": False, "error": "no proposal"}
    elif args.action == "status":
        result = action_status()
    else:
        result = action_clear()

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
