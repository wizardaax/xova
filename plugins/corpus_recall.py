"""
corpus_recall.py — Sprint 10: memory recall corpus health + coherence monitor check.

Evaluates the Xova corpus index (13k+ entries) for coverage, freshness, and
recall health. Reads coherence from the swarm dispatch store (agent-13 proxy).

Health score = 0.35*coverage + 0.30*freshness + 0.35*coherence
  coverage  = entries_with_excerpt / total_count
  freshness = min(entries_fresh_7d / FRESH_TARGET, 1.0)
  coherence = avg_coherence from swarm dispatch (clamped [0, 1])

Publishes result to context_broker slot xova.corpus_recall.
"""
import json
import os
import sys
import time

_CORPUS_PATH    = r"C:\Xova\memory\corpus_index.json"
_BROKER_PATH    = r"C:\Xova\memory\context_broker.json"
_DISPATCH_STORE = r"C:\Xova\memory\swarm_dispatch.json"

FRESH_WINDOW  = 604_800    # 7 days in seconds
FRESH_TARGET  = 300        # entries fresh within 7d → score 1.0
MIN_ENTRIES   = 5_000      # below this corpus is considered thin


def _write_context_slot(key: str, value: object) -> None:
    try:
        data: dict = {}
        if os.path.exists(_BROKER_PATH):
            with open(_BROKER_PATH, encoding="utf-8") as f:
                data = json.load(f)
        if "slots" not in data:
            data["slots"] = {}
        data["slots"][key] = value
        tmp = _BROKER_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        os.replace(tmp, _BROKER_PATH)
    except Exception:
        pass


def _read_avg_coherence() -> float:
    try:
        with open(_DISPATCH_STORE, encoding="utf-8") as f:
            d = json.load(f)
        val = float(d.get("avg_coherence", 0.75))
        return max(0.0, min(1.0, val))
    except Exception:
        return 0.75


def action_run() -> dict:
    # ── corpus stats ────────────────────────────────────────────────────────
    total_count   = 0
    with_excerpt  = 0
    fresh_7d      = 0
    ext_counts: dict[str, int] = {}
    root_counts: dict[str, int] = {}

    try:
        with open(_CORPUS_PATH, encoding="utf-8") as f:
            entries = json.load(f)
        total_count = len(entries)
        cutoff_ms   = (time.time() - FRESH_WINDOW) * 1000
        for e in entries:
            if e.get("excerpt", "").strip():
                with_excerpt += 1
            if e.get("mtime", 0) > cutoff_ms:
                fresh_7d += 1
            ext = e.get("ext", "")
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
            root = e.get("root", "")
            root_counts[root] = root_counts.get(root, 0) + 1
    except Exception as exc:
        return {"ok": False, "error": str(exc), "ts": time.time()}

    # top 5 extensions and roots
    top_exts  = sorted(ext_counts.items(),  key=lambda x: x[1], reverse=True)[:5]
    top_roots = sorted(root_counts.items(), key=lambda x: x[1], reverse=True)[:5]

    # ── score components ────────────────────────────────────────────────────
    coverage  = round(with_excerpt / total_count, 4) if total_count else 0.0
    freshness = round(min(fresh_7d / FRESH_TARGET, 1.0), 4)
    coherence = _read_avg_coherence()

    score = round(0.35 * coverage + 0.30 * freshness + 0.35 * coherence, 4)

    corpus_ok = total_count >= MIN_ENTRIES

    payload = {
        "ok":           True,
        "total":        total_count,
        "with_excerpt": with_excerpt,
        "fresh_7d":     fresh_7d,
        "coverage":     coverage,
        "freshness":    freshness,
        "coherence":    coherence,
        "score":        score,
        "corpus_ok":    corpus_ok,
        "top_exts":     top_exts,
        "top_roots":    [[r, n] for r, n in top_roots],
        "ts":           time.time(),
    }
    _write_context_slot("xova.corpus_recall", payload)
    return payload


def action_status() -> dict:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        slot = data.get("slots", {}).get("xova.corpus_recall")
        if slot:
            return {"ok": True, "cached": True, **slot}
    except Exception:
        pass
    return {"ok": True, "cached": False, "score": None}


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="run", choices=["run", "status"])
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    result = action_run() if args.action == "run" else action_status()
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))



# ── Corpus agent evolution patch (auto-written) ──────────────────────────────
# Knowledge gap scoring: corpus size alone doesn't reveal gaps. This
# computes a per-domain gap score so curiosity_engine can target sparse areas.


def knowledge_gap_score(corpus_path: str, domain_keywords: list = None) -> dict:
    """Score knowledge gaps across domain keywords in the corpus index.

    Args:
        corpus_path:     path to corpus_index.json
        domain_keywords: list of domain terms to check (default: AEON domains)
    Returns:
        dict with gap_scores per domain, weakest_domain, overall_gap
    """
    import json as _json
    if domain_keywords is None:
        domain_keywords = ["aeon", "thrust", "coherence", "lucas", "fibonacci",
                           "phi", "ternary", "snell", "field", "riemann"]
    try:
        with open(corpus_path, encoding="utf-8") as fh:
            entries = _json.load(fh)
        if not isinstance(entries, list):
            entries = []
    except Exception:
        return {"gap_scores": {}, "weakest_domain": None, "overall_gap": 1.0}

    total = max(len(entries), 1)
    counts = {kw: 0 for kw in domain_keywords}
    for entry in entries:
        text = str(entry.get("excerpt", "") + " " + entry.get("path", "")).lower()
        for kw in domain_keywords:
            if kw in text:
                counts[kw] += 1

    gap_scores = {kw: round(1.0 - counts[kw] / total, 4) for kw in domain_keywords}
    weakest = max(gap_scores, key=gap_scores.get) if gap_scores else None
    overall = sum(gap_scores.values()) / len(gap_scores) if gap_scores else 1.0
    return {
        "gap_scores": gap_scores,
        "weakest_domain": weakest,
        "overall_gap": round(overall, 4),
        "entry_counts": counts,
    }
