"""Patch by corpus_agent — Add knowledge_gap_score() to corpus_recall.py. Scores per-domain knowledge gaps in corpus index acro
"""
# Target: C:\Xova\plugins\corpus_recall.py
# Generated: 2026-05-07T12:20:33Z
# PatchID: 045c79074462



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
