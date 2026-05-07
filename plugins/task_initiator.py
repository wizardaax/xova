"""
task_initiator.py — autonomous task creation for the agent fleet.

Monitors outputs, coherence, violations, and stagnation. When a trigger
fires, creates a new sub-goal in goal_manager without human prompting.

Triggers (checked on every `scan`):
  LOW_EVAL   self_eval score < 0.4 three evals in a row for any agent
  VIOLATION  sentinel_violations.jsonl grew since last scan
  STAGNANT   active goal updated_at unchanged for > STAGNANT_SEC
  COHERENCE  swarm dispatch avg_coherence < COH_FLOOR
  ERROR      mesh_feed.jsonl contains a recent kind=error entry

Rate limits (prevents runaway task spam):
  - max 1 auto-task per trigger type per hour
  - max 8 auto-tasks per day total
  - deduplication: skip if active goal with >50% keyword overlap exists

Actions:
  scan    check all triggers, create tasks if warranted, return report
  status  show trigger state + counters
  list    list auto-created goals (reads goal_store active+paused)
"""
import argparse, json, os, re, subprocess, sys, time

GOAL_STORE       = r"C:\Xova\memory\goal_store.json"
GOAL_MANAGER     = r"C:\Xova\plugins\goal_manager.py"
PERSONA_GOVERNOR = r"C:\Xova\plugins\persona_governor.py"
SELF_EVAL_STORE  = r"C:\Xova\memory\self_eval_store.json"
VIOLATIONS_LOG   = r"C:\Xova\memory\sentinel_violations.jsonl"
DISPATCH_STORE   = r"C:\Xova\memory\swarm_dispatch.json"
MESH_FEED        = r"C:\Xova\memory\mesh_feed.jsonl"
STATE_PATH       = r"C:\Xova\memory\task_initiator_state.json"
NO_WIN           = 0x08000000

LOW_EVAL_THRESH  = 0.40
LOW_EVAL_STREAK  = 3
COH_FLOOR        = 0.45
STAGNANT_SEC     = 7200   # 2 hours
RATE_WINDOW      = 3600   # 1 hour per trigger type
MAX_PER_DAY      = 8
ERROR_LOOKBACK   = 600    # 10 min
STUCK_MIN        = 30     # goals with no progress entries older than this are "stuck"


# ── state ─────────────────────────────────────────────────────────────────────

def _load_state() -> dict:
    default = {
        "last_violation_count": 0,
        "last_trigger_ts":      {},   # trigger_name -> last fired ts
        "tasks_today":          [],   # list of ts when auto-task created
        "low_eval_streak":      {},   # agent -> consecutive low-score count
    }
    if not os.path.isfile(STATE_PATH):
        return default
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            s = json.load(fh)
        for k, v in default.items():
            s.setdefault(k, v)
        return s
    except Exception:
        return default


def _save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, DISPATCH_STORE[:-len("swarm_dispatch.json")] + "task_initiator_state.json")


def _save_state_direct(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_PATH)


# ── rate limiting + dedup ─────────────────────────────────────────────────────

def _can_fire(trigger: str, state: dict) -> bool:
    now = time.time()
    # Per-trigger rate: once per RATE_WINDOW
    last = state["last_trigger_ts"].get(trigger, 0)
    if now - last < RATE_WINDOW:
        return False
    # Daily cap
    cutoff = now - 86400
    today = [t for t in state["tasks_today"] if t > cutoff]
    state["tasks_today"] = today
    if len(today) >= MAX_PER_DAY:
        return False
    return True


def _tokenize(text: str) -> set[str]:
    stopwords = {"the","a","an","and","or","but","in","on","to","for","of",
                 "with","is","are","was","be","have","has","not","it","this",
                 "that","i","we","you","from","by","as","if","so","all","can"}
    words = re.findall(r"[a-z]+", text.lower())
    return {w for w in words if len(w) > 3 and w not in stopwords}


def _is_duplicate(text: str, goals: list[dict]) -> bool:
    """True if any active/paused goal has >50% keyword overlap with text."""
    t_tokens = _tokenize(text)
    if not t_tokens:
        return False
    for g in goals:
        if g["status"] not in ("active", "paused"):
            continue
        g_tokens = _tokenize(g["text"])
        if not g_tokens:
            continue
        overlap = len(t_tokens & g_tokens) / max(len(t_tokens), len(g_tokens))
        if overlap > 0.50:
            return True
    return False


# ── xova consult ──────────────────────────────────────────────────────────────

def _consult_xova(proposal: str) -> tuple[bool, str]:
    """Ask persona_governor whether to proceed. Returns (approved, reason).
    Fail-open: any error/timeout → approved=True."""
    try:
        r = subprocess.run(
            [sys.executable, PERSONA_GOVERNOR,
             "--action", "consult", "--proposal", proposal],
            capture_output=True, text=True, timeout=25,
            creationflags=NO_WIN, encoding="utf-8",
        )
        data = json.loads(r.stdout.strip()) if r.stdout.strip() else {}
        return bool(data.get("approved", True)), str(data.get("reason", ""))
    except Exception:
        return True, "consult unavailable — proceeding"


# ── create task ───────────────────────────────────────────────────────────────

def _create_task(text: str, trigger: str, priority: int,
                 parent_id: str | None, state: dict) -> dict | None:
    # Load goal store for dedup check
    try:
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        all_goals = list(store["goals"].values())
    except Exception:
        all_goals = []

    if _is_duplicate(text, all_goals):
        return None

    # Consult Xova before acting — she may veto if the action conflicts with
    # current fleet priorities or duplicates ongoing work she knows about
    approved, reason = _consult_xova(f"[{trigger}] {text[:200]}")
    if not approved:
        return {"skipped": "vetoed_by_xova", "reason": reason}

    cmd = [sys.executable, GOAL_MANAGER,
           "--action",   "set",
           "--text",     text,
           "--priority", str(priority),
           "--owner",    "task_initiator"]
    if parent_id:
        cmd += ["--parent", parent_id]
    last_exc: str = ""
    for attempt in range(2):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=8,
                               creationflags=NO_WIN, encoding="utf-8")
            result = json.loads(r.stdout.strip()) if r.stdout.strip() else {}
            if result.get("ok"):
                now = time.time()
                state["last_trigger_ts"][trigger] = now
                state["tasks_today"].append(now)
                return result
            last_exc = f"goal_manager returned not-ok: {result}"
        except Exception as exc:
            last_exc = str(exc)
        if attempt == 0:
            time.sleep(2)
    _log(f"_create_task failed after 2 attempts ({trigger}): {last_exc}")
    return None


# ── trigger checks ────────────────────────────────────────────────────────────

def _check_low_eval(state: dict, active_goal_id: str | None) -> dict | None:
    """Trigger if any agent has 3+ consecutive evals below LOW_EVAL_THRESH."""
    if not _can_fire("LOW_EVAL", state):
        return None
    try:
        with open(SELF_EVAL_STORE, encoding="utf-8") as fh:
            ev = json.load(fh)
    except Exception:
        return None

    history = ev.get("history", [])
    # Build per-agent recent scores (last 5)
    per_agent: dict[str, list[float]] = {}
    for entry in history[-40:]:
        ag = entry.get("agent", "")
        per_agent.setdefault(ag, []).append(entry["score"])

    fired_agent = None
    for agent, scores in per_agent.items():
        recent = scores[-LOW_EVAL_STREAK:]
        if len(recent) >= LOW_EVAL_STREAK and all(s < LOW_EVAL_THRESH for s in recent):
            fired_agent = agent
            break

    if not fired_agent:
        # Update streaks and reset
        state["low_eval_streak"] = {}
        return None

    recent_scores = per_agent[fired_agent][-LOW_EVAL_STREAK:]
    avg = sum(recent_scores) / LOW_EVAL_STREAK
    scores_str = ", ".join(f"{s:.3f}" for s in recent_scores)
    text = (
        f"[AUTO] low self-eval recovery for {fired_agent}: "
        f"scores [{scores_str}] avg={avg:.3f} (threshold {LOW_EVAL_THRESH}) "
        f"over {LOW_EVAL_STREAK} consecutive evals — "
        f"review goal alignment and refocus agent output strategy"
    )
    return _create_task(text, "LOW_EVAL", 6, active_goal_id, state)


def _check_violations(state: dict, active_goal_id: str | None) -> dict | None:
    """Trigger if sentinel violations log grew since last scan.

    Entries whose 'key' starts with 'test.' are ignored — they are deliberate
    test injections to exercise the SCE-88 gate, not production breaches.
    """
    if not _can_fire("VIOLATION", state):
        return None

    prod_entries: list[dict] = []
    try:
        with open(VIOLATIONS_LOG, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                if str(entry.get("key", "")).startswith("test."):
                    continue
                prod_entries.append(entry)
    except Exception:
        return None

    count = len(prod_entries)
    prev = state.get("last_violation_count", 0)
    state["last_violation_count"] = count
    new_violations = count - prev

    if new_violations <= 0:
        return None

    # Use last production violation for context
    context = ""
    try:
        last = prod_entries[-1]
        context = f"{last.get('source','?')}: {'; '.join(last.get('violations',[])[:2])}"
    except Exception:
        pass

    text = (
        f"[AUTO] SCE-88 constraint recovery: {new_violations} new violation(s) detected — "
        f"{context[:120]} — investigate constraint breach and restore coherence bounds"
    )
    return _create_task(text, "VIOLATION", 7, active_goal_id, state)


def _check_stagnant(state: dict, active_goal_id: str | None,
                    active_goal_text: str | None) -> dict | None:
    """Trigger if active goal hasn't been updated in STAGNANT_SEC."""
    if not _can_fire("STAGNANT", state):
        return None
    if not active_goal_id:
        return None
    try:
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        goal = store["goals"].get(active_goal_id, {})
        updated = goal.get("updated_at", 0)
        if (time.time() - updated) < STAGNANT_SEC:
            return None
    except Exception:
        return None

    text = (
        f"[AUTO] unblock stagnant goal: active goal has had no progress for "
        f"{int((time.time() - updated) / 3600)}h — "
        f"diagnose blockers and resume: {(active_goal_text or '')[:100]}"
    )
    return _create_task(text, "STAGNANT", 5, active_goal_id, state)


def _check_coherence(state: dict, active_goal_id: str | None) -> dict | None:
    """Trigger if last swarm dispatch avg_coherence < COH_FLOOR."""
    if not _can_fire("COHERENCE", state):
        return None
    try:
        with open(DISPATCH_STORE, encoding="utf-8") as fh:
            d = json.load(fh)
        coh = d.get("avg_coherence", 1.0)
        if coh >= COH_FLOOR:
            return None
        # Only fire if dispatch is recent (< 2h)
        if (time.time() - d.get("dispatched_at", 0)) > 7200:
            return None
    except Exception:
        return None

    text = (
        f"[AUTO] coherence recovery: swarm avg_coherence={coh:.3f} below floor {COH_FLOOR} — "
        f"run coherence sweep, check ternary balance and constraint guardian, "
        f"adjust agent parameters to restore stability"
    )
    return _create_task(text, "COHERENCE", 7, active_goal_id, state)


def _check_errors(state: dict, active_goal_id: str | None) -> dict | None:
    """Trigger if mesh_feed has a recent error entry."""
    if not _can_fire("ERROR", state):
        return None
    try:
        with open(MESH_FEED, encoding="utf-8") as fh:
            lines = fh.readlines()
    except Exception:
        return None

    cutoff = time.time() - ERROR_LOOKBACK
    recent_errors = []
    for line in lines[-50:]:
        try:
            e = json.loads(line)
            if e.get("kind") == "error" and e.get("ts", 0) > cutoff:
                recent_errors.append(e.get("content", "")[:80])
        except Exception:
            pass

    if not recent_errors:
        return None

    text = (
        f"[AUTO] mesh cycle error recovery: {len(recent_errors)} error(s) in last "
        f"{ERROR_LOOKBACK // 60}min — {recent_errors[0]} — "
        f"diagnose root cause and restore mesh cycle stability"
    )
    return _create_task(text, "ERROR", 8, active_goal_id, state)


# ── scan ──────────────────────────────────────────────────────────────────────

def action_scan() -> dict:
    state = _load_state()

    # Load active goal
    active_goal_id   = None
    active_goal_text = None
    try:
        with open(GOAL_STORE, encoding="utf-8") as fh:
            gs = json.load(fh)
        active_goal_id   = gs.get("active_goal")
        if active_goal_id:
            active_goal_text = gs["goals"].get(active_goal_id, {}).get("text")
    except Exception:
        pass

    created = []
    skipped = []
    checks  = [
        ("LOW_EVAL",   _check_low_eval(state, active_goal_id)),
        ("VIOLATION",  _check_violations(state, active_goal_id)),
        ("STAGNANT",   _check_stagnant(state, active_goal_id, active_goal_text)),
        ("COHERENCE",  _check_coherence(state, active_goal_id)),
        ("ERROR",      _check_errors(state, active_goal_id)),
    ]
    for trigger, result in checks:
        if result is None:
            continue
        if result.get("ok"):
            created.append({"trigger": trigger, "goal_id": result.get("id")})
        else:
            skipped.append({
                "trigger": trigger,
                "reason":  result.get("skipped", "unknown"),
                "detail":  result.get("reason", ""),
            })

    _save_state_direct(state)
    return {
        "ok":            True,
        "ts":            time.time(),
        "active_goal":   active_goal_id,
        "tasks_created": len(created),
        "created":       created,
        "skipped":       skipped,
        "tasks_today":   len(state["tasks_today"]),
    }


def action_status() -> dict:
    state = _load_state()
    now   = time.time()
    next_fire = {
        t: max(0, int(RATE_WINDOW - (now - ts)))
        for t, ts in state["last_trigger_ts"].items()
    }
    today = len([t for t in state["tasks_today"] if t > now - 86400])
    return {
        "ok":                True,
        "tasks_today":       today,
        "daily_cap":         MAX_PER_DAY,
        "last_violation_count": state.get("last_violation_count", 0),
        "next_fire_in_s":    next_fire,
    }


def action_list() -> dict:
    try:
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
    except Exception:
        return {"ok": True, "count": 0, "goals": []}
    auto = [g for g in store["goals"].values()
            if g.get("owner") == "task_initiator"]
    auto.sort(key=lambda g: -g["created_at"])
    return {"ok": True, "count": len(auto), "goals": auto}


def action_execute_stuck() -> dict:
    """Write a progress note on active goals with no progress older than STUCK_MIN minutes.

    This surfaces stuck goals in the mesh_feed so they appear in diagnostics.
    It does not autonomously resolve them — it records that the executor examined
    them and found no available resolution path, keeping goal_store accurate.
    """
    try:
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
    except Exception:
        return {"ok": True, "acted": 0, "reason": "goal_store unreadable"}

    now    = time.time()
    cutoff = now - (STUCK_MIN * 60)
    acted  = []
    skipped: list[dict] = []

    for gid, g in store.get("goals", {}).items():
        if g.get("status") != "active":
            continue
        if g.get("created_at", now) > cutoff:
            continue
        if g.get("progress"):
            continue

        gtext = (g.get("text") or "")[:80]
        owner = g.get("owner", "")
        age_m = int((now - g.get("created_at", now)) / 60)
        note  = (
            f"[execute_stuck] auto-executor examined · age={age_m}m · owner={owner} · "
            f"no blocking executor available — goal pending human review or sub-goal creation"
        )
        try:
            r = subprocess.run(
                [sys.executable, GOAL_MANAGER,
                 "--action", "progress",
                 "--id",     gid,
                 "--note",   note,
                 "--agent",  "task_initiator"],
                capture_output=True, text=True, timeout=8,
                creationflags=NO_WIN, encoding="utf-8",
            )
            data = json.loads(r.stdout.strip()) if r.stdout.strip() else {}
            acted.append({"id": gid[:12], "text": gtext, "owner": owner, "age_m": age_m, "ok": data.get("ok", False)})
        except Exception as exc:
            skipped.append({"id": gid[:12], "reason": str(exc)[:60]})

    return {
        "ok":         True,
        "stuck_found": len(acted) + len(skipped),
        "acted":      len(acted),
        "skipped":    len(skipped),
        "goals":      acted,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="scan",
                    choices=["scan", "status", "list", "execute_stuck"])
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.action == "scan":
        result = action_scan()
    elif args.action == "status":
        result = action_status()
    elif args.action == "execute_stuck":
        result = action_execute_stuck()
    else:
        result = action_list()

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
