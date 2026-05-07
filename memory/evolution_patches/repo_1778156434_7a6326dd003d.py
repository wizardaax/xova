"""Patch by repo_agent — Add repo_divergence_score() to ci_health.py. Computes urgency score from CI failures, ahead commits,
"""
# Target: C:\Xova\plugins\ci_health.py
# Generated: 2026-05-07T12:20:34Z
# PatchID: 7a6326dd003d



# ── Repo agent evolution patch (auto-written) ────────────────────────────────
# Repo divergence: ahead/dirty counts don't capture urgency. A divergence
# score lets mesh_runner prioritise sync tasks by severity.


def repo_divergence_score(repos: list) -> dict:
    """Compute a divergence urgency score from repo status list.

    Args:
        repos: list of repo dicts (name, ahead, dirty, clean, ok)
    Returns:
        dict with score [0=clean, 1=critical], worst_repo, breakdown
    """
    if not repos:
        return {"score": 0.0, "worst_repo": None, "breakdown": []}

    breakdown = []
    for r in repos:
        ahead = int(r.get("ahead", 0))
        dirty = int(r.get("dirty", 0))
        ci_fail = not r.get("ok", True)
        # Weight: CI failure > divergence > dirty
        penalty = (2.0 if ci_fail else 0.0) + min(ahead * 0.2, 1.0) + min(dirty * 0.1, 0.5)
        breakdown.append({"name": r.get("name", "?"), "penalty": round(penalty, 3)})

    penalties = [b["penalty"] for b in breakdown]
    worst_idx = penalties.index(max(penalties))
    score = min(sum(penalties) / len(penalties), 1.0)
    return {
        "score": round(score, 4),
        "worst_repo": breakdown[worst_idx]["name"],
        "breakdown": breakdown,
        "is_critical": score > 0.5,
    }
