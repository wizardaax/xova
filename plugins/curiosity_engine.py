"""
curiosity_engine.py — proactive curiosity engine for the Xova AGI system.

Scans the knowledge substrate for gaps and generates proactive exploration
goals via goal_manager.py. Reactive autonomy responds to failures; this is
proactive — the system notices what it doesn't know and decides to explore it.

Gap detection sources:
  MISSED_KEYWORDS  self_eval history — words consistently missed = knowledge gaps
  CORPUS_COVERAGE  corpus_index.json — domains < 5% of total = underexplored
  GOAL_THEMES      completed goals — themes absent from active goals = neglected

Rate limits: max 3 goals per run, max 5 per day.

Actions:
  scan    detect gaps, create goals if warranted, return report
  status  show today's counters + last scan ts
"""
import argparse, json, os, re, subprocess, sys, time

SELF_EVAL_STORE  = r"C:\Xova\memory\self_eval_store.json"
CORPUS_INDEX     = r"C:\Xova\memory\corpus_index.json"
GOAL_STORE       = r"C:\Xova\memory\goal_store.json"
GOAL_MANAGER     = r"C:\Xova\plugins\goal_manager.py"
PERSONA_GOVERNOR = r"C:\Xova\plugins\persona_governor.py"
STATE_PATH       = r"C:\Xova\memory\curiosity_state.json"
NO_WIN           = 0x08000000

EVAL_LOOKBACK   = 50
CORPUS_GAP_PCT  = 0.05
MAX_PER_RUN     = 3
MAX_PER_DAY     = 5
OVERLAP_THRESH  = 0.40


# ── state ─────────────────────────────────────────────────────────────────────

def _load_state() -> dict:
    default: dict = {"goals_today": [], "last_scan_ts": 0.0}
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
    os.replace(tmp, STATE_PATH)


# ── dedup ─────────────────────────────────────────────────────────────────────

_STOP = {"the","a","an","and","or","but","in","on","to","for","of","with",
         "is","are","was","be","have","has","not","it","this","that","i",
         "we","you","from","by","as","if","so","all","can","auto","curiosity"}

def _tokenize(text: str) -> set[str]:
    words = re.findall(r"[a-z]+", text.lower())
    return {w for w in words if len(w) > 3 and w not in _STOP}


def _is_duplicate(text: str, goals: list[dict]) -> bool:
    t_tokens = _tokenize(text)
    if not t_tokens:
        return False
    for g in goals:
        if g.get("status") not in ("active", "paused"):
            continue
        g_tokens = _tokenize(g.get("text", ""))
        if not g_tokens:
            continue
        if len(t_tokens & g_tokens) / max(len(t_tokens), len(g_tokens)) > OVERLAP_THRESH:
            return True
    return False


# ── xova consult ──────────────────────────────────────────────────────────────

def _consult_xova(proposal: str) -> tuple[bool, str]:
    """Ask persona_governor whether to proceed. Fail-open on any error."""
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


# ── goal creation ─────────────────────────────────────────────────────────────

def _create_goal(text: str, all_goals: list[dict], state: dict) -> dict:
    if _is_duplicate(text, all_goals):
        return {"skipped": "duplicate"}
    approved, reason = _consult_xova(text[:200])
    if not approved:
        return {"skipped": "vetoed_by_xova", "reason": reason}
    try:
        r = subprocess.run(
            [sys.executable, GOAL_MANAGER,
             "--action", "set", "--text", text,
             "--priority", "4", "--owner", "curiosity_engine"],
            capture_output=True, text=True, timeout=8,
            creationflags=NO_WIN, encoding="utf-8",
        )
        result = json.loads(r.stdout.strip()) if r.stdout.strip() else {}
        if result.get("ok"):
            state["goals_today"].append(time.time())
            return result
    except Exception as exc:
        return {"skipped": "error", "detail": str(exc)}
    return {"skipped": "goal_manager_failed"}


def _load_all_goals() -> list[dict]:
    try:
        with open(GOAL_STORE, encoding="utf-8") as fh:
            store = json.load(fh)
        return list(store.get("goals", {}).values())
    except Exception:
        return []


# ── gap detectors ─────────────────────────────────────────────────────────────

def _gaps_missed_keywords() -> list[str]:
    try:
        with open(SELF_EVAL_STORE, encoding="utf-8") as fh:
            ev = json.load(fh)
    except Exception:
        return []
    recent = ev.get("history", [])[-EVAL_LOOKBACK:]
    freq: dict[str, int] = {}
    for entry in recent:
        for word in entry.get("missed", []):
            if len(word) > 3:
                freq[word] = freq.get(word, 0) + 1
    recurrent = {w: c for w, c in freq.items() if c > 1}
    if not recurrent:
        return []
    top = sorted(recurrent, key=lambda w: -recurrent[w])[:5]
    return [
        f"[CURIOSITY] knowledge gap — keyword '{w}' missed {recurrent[w]}x "
        f"in last {len(recent)} self-evals: explore and deepen understanding "
        f"of '{w}' to improve goal alignment scores"
        for w in top
    ]


def _gaps_corpus_coverage() -> list[str]:
    try:
        with open(CORPUS_INDEX, encoding="utf-8") as fh:
            ci = json.load(fh)
    except Exception:
        return []
    entries = ci.get("entries", [])
    total = len(entries)
    if not total:
        return []
    counts: dict[str, int] = {}
    for e in entries:
        root = e.get("root", "unknown")
        counts[root] = counts.get(root, 0) + 1
    threshold = total * CORPUS_GAP_PCT
    under = sorted([(r, c) for r, c in counts.items() if c < threshold], key=lambda x: x[1])
    return [
        f"[CURIOSITY] corpus gap — domain '{r}' has only {c} entries "
        f"({c/total*100:.1f}% of {total}): expand knowledge base by "
        f"indexing more content from '{r}'"
        for r, c in under[:3]
    ]


def _gaps_goal_themes(all_goals: list[dict]) -> list[str]:
    completed = [g.get("text", "") for g in all_goals if g.get("status") == "completed"]
    active    = [g.get("text", "") for g in all_goals if g.get("status") in ("active", "paused")]
    if not completed:
        return []
    freq: dict[str, int] = {}
    for text in completed:
        for w in _tokenize(text):
            freq[w] = freq.get(w, 0) + 1
    themes = {w for w, c in freq.items() if c >= 2}
    active_words: set[str] = set()
    for text in active:
        active_words |= _tokenize(text)
    neglected = themes - active_words
    if not neglected:
        return []
    top = sorted(neglected, key=lambda w: -freq[w])[:2]
    return [
        f"[CURIOSITY] neglected theme — '{w}' featured in {freq[w]} completed "
        f"goals but has no active goal: revisit and advance work related to '{w}'"
        for w in top
    ]


# ── actions ───────────────────────────────────────────────────────────────────

def action_scan() -> dict:
    state = _load_state()
    cutoff = time.time() - 86400
    state["goals_today"] = [t for t in state["goals_today"] if t > cutoff]
    remaining = max(0, MAX_PER_DAY - len(state["goals_today"]))

    if remaining == 0:
        _save_state(state)
        return {"ok": True, "ts": time.time(), "goals_created": 0,
                "created": [], "note": "daily cap reached"}

    all_goals  = _load_all_goals()
    candidates = (_gaps_missed_keywords() + _gaps_corpus_coverage()
                  + _gaps_goal_themes(all_goals))

    created: list[dict] = []
    skipped: list[dict] = []
    budget = min(MAX_PER_RUN, remaining)

    for text in candidates:
        if len(created) >= budget:
            break
        result = _create_goal(text, all_goals, state)
        if result.get("ok"):
            created.append({"goal_id": result.get("id"), "text": text[:120]})
            all_goals = _load_all_goals()
        else:
            skipped.append({"reason": result.get("skipped", "?"), "text": text[:80]})

    state["last_scan_ts"] = time.time()
    _save_state(state)
    return {
        "ok":            True,
        "ts":            time.time(),
        "goals_created": len(created),
        "created":       created,
        "skipped":       skipped,
        "candidates":    len(candidates),
        "goals_today":   len(state["goals_today"]),
        "daily_cap":     MAX_PER_DAY,
    }


def action_status() -> dict:
    state = _load_state()
    now   = time.time()
    today = [t for t in state["goals_today"] if t > now - 86400]
    return {
        "ok":              True,
        "goals_today":     len(today),
        "daily_cap":       MAX_PER_DAY,
        "daily_remaining": max(0, MAX_PER_DAY - len(today)),
        "last_scan_ts":    state.get("last_scan_ts", 0),
        "last_scan_ago_s": int(now - state.get("last_scan_ts", 0)),
    }


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="scan", choices=["scan", "status"])
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    result = action_scan() if args.action == "scan" else action_status()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
