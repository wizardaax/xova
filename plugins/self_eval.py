"""
self_eval.py — self-evaluation loop for Xova agents.

After each output, an agent scores itself against the active goal, stores
the eval, and derives a strategy instruction for the next run. Agents read
their current strategy and prepend it to the goal text before acting.

Scoring (stdlib only):
  - keyword hit-rate: significant goal words found in output / total
  - substance bonus: min(len(output) / 500, 1.0)
  - diversity bonus: unique significant words in output / 40
  Final score = 0.55 * hit_rate + 0.25 * substance + 0.20 * diversity

Actions:
  eval     --output "..." --goal "..." --agent mesh [--goal-id ID]
  strategy --agent mesh
  history  [--agent mesh] [--limit 20]
  snapshot
"""
import argparse, json, os, re, time

STORE_PATH = r"C:\Xova\memory\self_eval_store.json"
HISTORY_CAP = 500

_STOPWORDS = {
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "is","are","was","were","be","been","being","have","has","had","do",
    "does","did","will","would","could","should","may","might","shall",
    "not","no","it","its","this","that","these","those","i","we","you",
    "he","she","they","their","our","my","your","his","her","from","by",
    "as","if","then","so","all","each","any","more","also","just","can",
}


def _tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-z]+", text.lower())
    return [w for w in words if len(w) > 3 and w not in _STOPWORDS]


def _score_output(output: str, goal: str) -> tuple[float, list[str], list[str]]:
    """
    Returns (score 0-1, hit_keywords, missed_keywords).
    """
    goal_tokens  = set(_tokenize(goal))
    out_tokens   = set(_tokenize(output))
    out_all      = _tokenize(output)

    if not goal_tokens:
        return 0.5, [], []

    hit     = goal_tokens & out_tokens
    missed  = sorted(goal_tokens - out_tokens)

    hit_rate  = len(hit) / len(goal_tokens)
    substance = min(len(output) / 500.0, 1.0)
    diversity = min(len(set(out_all)) / 40.0, 1.0)

    score = round(0.55 * hit_rate + 0.25 * substance + 0.20 * diversity, 4)
    return score, sorted(hit), missed


def _derive_strategy(score: float, missed: list[str], agent: str,
                     recent_scores: list[float]) -> str:
    trend = ""
    if len(recent_scores) >= 3:
        avg = sum(recent_scores[-3:]) / 3
        if avg < score - 0.1:
            trend = " (improving)"
        elif avg > score + 0.1:
            trend = " (declining)"

    if score >= 0.80:
        return f"maintain current approach — score {score:.3f}{trend}"
    elif score >= 0.60:
        top_missed = ", ".join(missed[:4])
        return f"score {score:.3f}{trend} — expand coverage: [{top_missed}]"
    else:
        top_missed = ", ".join(missed[:7])
        return f"LOW {score:.3f}{trend} — refocus on: [{top_missed}]"


def _load() -> dict:
    if not os.path.isfile(STORE_PATH):
        return {"version": 1, "strategies": {}, "history": []}
    try:
        with open(STORE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"version": 1, "strategies": {}, "history": []}


def _save(store: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    store["updated_at"] = time.time()
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, indent=2, sort_keys=False)
    os.replace(tmp, STORE_PATH)


def action_eval(output: str, goal: str, agent: str, goal_id: str) -> dict:
    store   = _load()
    score, hit, missed = _score_output(output, goal)

    # Gather recent scores for this agent to detect trend
    agent_history = [e for e in store["history"] if e["agent"] == agent]
    recent_scores = [e["score"] for e in agent_history[-5:]]

    strategy = _derive_strategy(score, missed, agent, recent_scores)

    entry = {
        "ts":       time.time(),
        "agent":    agent,
        "goal_id":  goal_id,
        "score":    score,
        "hit":      hit,
        "missed":   missed,
        "strategy": strategy,
        "output_snippet": output[:200],
    }
    store["history"].append(entry)
    if len(store["history"]) > HISTORY_CAP:
        store["history"] = store["history"][-HISTORY_CAP:]

    store["strategies"][agent] = {
        "strategy":  strategy,
        "score":     score,
        "ts":        time.time(),
        "goal_id":   goal_id,
    }
    _save(store)
    return {"ok": True, "score": score, "strategy": strategy,
            "hit_count": len(hit), "missed_count": len(missed)}


def action_strategy(agent: str) -> dict:
    store = _load()
    s = store["strategies"].get(agent)
    if not s:
        return {"ok": True, "agent": agent, "strategy": "", "score": None}
    return {"ok": True, "agent": agent, **s}


def action_history(agent: str | None, limit: int) -> dict:
    store = _load()
    entries = store["history"]
    if agent:
        entries = [e for e in entries if e["agent"] == agent]
    entries = entries[-limit:][::-1]
    return {"ok": True, "count": len(entries), "history": entries}


def action_snapshot() -> dict:
    store = _load()
    return {"ok": True,
            "strategies": store.get("strategies", {}),
            "total_evals": len(store.get("history", []))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action",  default="snapshot",
                    choices=["eval", "strategy", "history", "snapshot"])
    ap.add_argument("--output",  default="")
    ap.add_argument("--goal",    default="")
    ap.add_argument("--agent",   default="mesh")
    ap.add_argument("--goal-id", default="", dest="goal_id")
    ap.add_argument("--limit",   type=int, default=20)
    args = ap.parse_args()

    if args.action == "eval":
        result = action_eval(args.output, args.goal, args.agent, args.goal_id)
    elif args.action == "strategy":
        result = action_strategy(args.agent)
    elif args.action == "history":
        result = action_history(args.agent or None, args.limit)
    else:
        result = action_snapshot()

    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import sys, json
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
