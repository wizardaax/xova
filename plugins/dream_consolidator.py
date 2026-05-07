"""
dream_consolidator.py — overnight memory distillation for the Xova AGI system.

Reads the last 24h of raw federation output and distils it into compressed
long-term insights stored in long_term_memory.json.

Sources:
  mesh_feed.jsonl     — cycle_end events (coherence) + kind=error entries
  memory/evolution/   — JSON files with mtime in window (health_score, coherence)
  self_eval_store.json — history array (score, missed keywords)
  goal_store.json     — completed goals

Actions:
  consolidate   run the pass, write long_term_memory.json, print summary
  status        read long_term_memory.json and print current state
"""
import argparse, json, os, time
from collections import Counter

MEMORY_DIR      = r"C:\Xova\memory"
MESH_FEED_PATH  = r"C:\Xova\memory\mesh_feed.jsonl"
EVOLUTION_DIR   = r"C:\Xova\memory\evolution"
SELF_EVAL_PATH  = r"C:\Xova\memory\self_eval_store.json"
GOAL_STORE_PATH = r"C:\Xova\memory\goal_store.json"
OUTPUT_PATH     = r"C:\Xova\memory\long_term_memory.json"

PERIOD_HOURS = 24
TOP_MISSED_N = 5


def _window_start() -> float:
    return time.time() - PERIOD_HOURS * 3600


def _atomic_write(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _safe_load_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


# ── source readers ────────────────────────────────────────────────────────────

def _read_mesh_feed(since: float) -> tuple[list[float], int]:
    coherences: list[float] = []
    error_count = 0
    if not os.path.isfile(MESH_FEED_PATH):
        return coherences, error_count
    try:
        with open(MESH_FEED_PATH, encoding="utf-8") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    entry = json.loads(raw)
                except Exception:
                    continue
                if entry.get("ts", 0) < since:
                    continue
                kind = entry.get("kind", "")
                if kind == "cycle_end":
                    coh = entry.get("coherence")
                    if isinstance(coh, (int, float)):
                        coherences.append(float(coh))
                elif kind == "error":
                    error_count += 1
    except Exception:
        pass
    return coherences, error_count


def _read_evolution(since: float) -> list[float]:
    health_scores: list[float] = []
    if not os.path.isdir(EVOLUTION_DIR):
        return health_scores
    try:
        for fname in os.listdir(EVOLUTION_DIR):
            fpath = os.path.join(EVOLUTION_DIR, fname)
            if not fname.endswith(".json") or not os.path.isfile(fpath):
                continue
            try:
                if os.path.getmtime(fpath) < since:
                    continue
            except OSError:
                continue
            data = _safe_load_json(fpath)
            if not data:
                continue
            obs = data.get("pipeline", {}).get("observed", {})
            health = (obs.get("mean_health") or obs.get("health_score")
                      or data.get("health_score") or obs.get("coherence"))
            if isinstance(health, (int, float)):
                health_scores.append(float(health))
    except Exception:
        pass
    return health_scores


def _read_self_eval(since: float) -> tuple[list[float], list[str]]:
    scores: list[float] = []
    missed_flat: list[str] = []
    data = _safe_load_json(SELF_EVAL_PATH)
    for entry in data.get("history", []):
        if entry.get("ts", 0) < since:
            continue
        score = entry.get("score")
        if isinstance(score, (int, float)):
            scores.append(float(score))
        missed = entry.get("missed", [])
        if isinstance(missed, list):
            missed_flat.extend(str(w) for w in missed if w)
    return scores, missed_flat


def _read_goals() -> list[dict]:
    data = _safe_load_json(GOAL_STORE_PATH)
    goals = data.get("goals", {})
    if isinstance(goals, dict):
        goals = goals.values()
    return [{"id": g.get("id", ""), "text": g.get("text", "")}
            for g in goals if isinstance(g, dict) and g.get("status") == "completed"]


# ── insights ──────────────────────────────────────────────────────────────────

def _build_insights(avg_coh, avg_eval, top_missed, error_count, evo_health, cycle_count) -> list[str]:
    out: list[str] = []
    if avg_coh is not None:
        if avg_coh < 0.5:
            out.append(f"Fleet coherence averaged {avg_coh:.3f} — below threshold; constraint enforcement may need review")
        elif avg_coh >= 0.8:
            out.append(f"Fleet coherence is strong at {avg_coh:.3f} — system operating well")
        else:
            out.append(f"Fleet coherence averaged {avg_coh:.3f} — within acceptable range")
    if top_missed:
        out.append(f"Consistently missed keywords: {', '.join(top_missed)} — strategy should address these areas")
    if error_count > 5:
        out.append(f"Elevated error rate ({error_count} errors) — mesh cycle stability needs attention")
    elif error_count > 0:
        out.append(f"Low error rate ({error_count} errors) — mesh feed generally stable")
    if avg_eval is not None:
        if avg_eval < 0.5:
            out.append(f"Self-eval average is low at {avg_eval:.3f} — agents underperforming against goals")
        elif avg_eval >= 0.75:
            out.append(f"Self-eval average strong at {avg_eval:.3f} — agents well-aligned to goals")
    if evo_health is not None:
        if evo_health < 0.7:
            out.append(f"Evolution health averaged {evo_health:.3f} — fleet may benefit from more observe/propose cycles")
        else:
            out.append(f"Evolution health averaged {evo_health:.3f} — self-improvement pipeline healthy")
    if cycle_count == 0:
        out.append("No mesh cycles detected in the last 24h — federation may have been idle")
    elif cycle_count > 100:
        out.append(f"High cycle volume ({cycle_count} cycles) — fleet was highly active in this period")
    return out


# ── actions ───────────────────────────────────────────────────────────────────

def action_consolidate() -> dict:
    since = _window_start()
    now   = time.time()

    coherences, error_count = _read_mesh_feed(since)
    cycle_count   = len(coherences)
    avg_coh       = round(sum(coherences) / cycle_count, 6) if coherences else None

    health_scores = _read_evolution(since)
    evo_health    = round(sum(health_scores) / len(health_scores), 6) if health_scores else None

    scores, missed_flat = _read_self_eval(since)
    avg_eval      = round(sum(scores) / len(scores), 6) if scores else None
    top_missed    = [w for w, _ in Counter(missed_flat).most_common(TOP_MISSED_N)]

    completed_goals = _read_goals()
    insights        = _build_insights(avg_coh, avg_eval, top_missed, error_count, evo_health, cycle_count)

    record = {
        "last_consolidation":  now,
        "period_hours":        PERIOD_HOURS,
        "avg_coherence":       avg_coh,
        "avg_eval_score":      avg_eval,
        "top_missed_keywords": top_missed,
        "completed_goals":     completed_goals,
        "error_count":         error_count,
        "evolution_health":    evo_health,
        "cycle_count":         cycle_count,
        "insights":            insights,
    }
    _atomic_write(OUTPUT_PATH, record)

    return {
        "ok":                    True,
        "cycle_count":           cycle_count,
        "avg_coherence":         avg_coh,
        "avg_eval_score":        avg_eval,
        "error_count":           error_count,
        "evolution_health":      evo_health,
        "completed_goals_count": len(completed_goals),
        "top_missed_keywords":   top_missed,
        "insights":              insights,
        "written_to":            OUTPUT_PATH,
    }


def action_status() -> dict:
    if not os.path.isfile(OUTPUT_PATH):
        return {"ok": False, "error": "long_term_memory.json not found — run consolidate first"}
    record = _safe_load_json(OUTPUT_PATH)
    if not record:
        return {"ok": False, "error": "long_term_memory.json is empty or unreadable"}
    age_h = round((time.time() - record.get("last_consolidation", 0)) / 3600, 2)
    return {"ok": True, "age_hours": age_h, **record}


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="consolidate", choices=["consolidate", "status"])
    args = ap.parse_args()
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    result = action_consolidate() if args.action == "consolidate" else action_status()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import sys, json as _j
        sys.stdout.reconfigure(encoding="utf-8")
        print(_j.dumps({"ok": False, "error": str(exc)}))
