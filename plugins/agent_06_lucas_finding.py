"""
agent_06_lucas_finding.py — Snell-Vern agent_06 Lucas Analyst, autonomous.

First substrate AGI ability. Each run:
  1. Loads its UCB state from findings/.lucas_agent_state.json
  2. Picks the next topic to investigate via UCB1
  3. Computes the finding using recursive_field_math primitives
  4. Writes findings/<date>_<topic>_<id>.md
  5. Updates state
  6. git-commits (does NOT push — push is a separate step)

Stdlib + recursive_field_math (stdlib-only itself).
Runs as `python C:\\Xova\\plugins\\agent_06_lucas_finding.py`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

_REPO         = r"D:\github\wizardaax\recursive-field-math-pro"
_FINDINGS_DIR = os.path.join(_REPO, "findings")
_STATE_PATH   = os.path.join(_FINDINGS_DIR, ".lucas_agent_state.json")
_RFF_SRC      = os.path.join(_REPO, "src")

_AGENT_NAME   = "Snell-Vern agent_06 Lucas Analyst"
_AGENT_EMAIL  = "agent-06-lucas@xova.local"

# Topic registry: each entry is (topic_name, generator_callable)
# Generator returns (title, body_markdown, deterministic_inputs_dict)
# Inputs are folded into the filename hash so two runs with the same
# (topic, inputs) collide and don't double-commit.


def _ensure_rff_on_path() -> None:
    if _RFF_SRC not in sys.path:
        sys.path.insert(0, _RFF_SRC)


# ─────────────────────────────────────────────────────────────────────
# Topic generators
# ─────────────────────────────────────────────────────────────────────

def topic_cassini_lucas(n: int) -> tuple[str, str, dict]:
    """Cassini-like identity for Lucas: L(n+1)L(n-1) - L(n)^2 = 5(-1)^n."""
    _ensure_rff_on_path()
    from recursive_field_math import L  # type: ignore

    lhs = L(n + 1) * L(n - 1) - L(n) ** 2
    rhs = -5 * ((-1) ** n)
    holds = lhs == rhs
    title = f"Cassini-Lucas identity at n={n}"
    body = (
        f"## Claim\n\n"
        f"`L(n+1) · L(n-1) − L(n)² = −5·(−1)^n`  (equivalently `5·(−1)^(n+1)`)\n\n"
        f"## Numerical check at n={n}\n\n"
        f"- `L({n-1}) = {L(n-1)}`\n"
        f"- `L({n})   = {L(n)}`\n"
        f"- `L({n+1}) = {L(n+1)}`\n"
        f"- LHS = `L({n+1}) · L({n-1}) − L({n})²` = `{L(n+1)} · {L(n-1)} − {L(n)}²` = **{lhs}**\n"
        f"- RHS = `−5·(−1)^{n}` = **{rhs}**\n"
        f"- Equal? **{holds}**\n\n"
        f"## Notes\n\n"
        f"This is the Lucas analogue of Cassini's Fibonacci identity F(n+1)F(n-1) − F(n)² = (−1)^n.\n"
        f"The factor 5 emerges because L(n)² − 5·F(n)² = 4·(−1)^n, which couples the Lucas\n"
        f"square to the discriminant of x² − x − 1.\n"
    )
    return title, body, {"n": n}


def topic_ratio_convergence(n: int) -> tuple[str, str, dict]:
    """L(n+1)/L(n) → φ with rigorous error bounds at index n."""
    _ensure_rff_on_path()
    from recursive_field_math import PHI, ratio, ratio_error_bounds  # type: ignore

    r = ratio(n)
    err = abs(r - PHI)
    lower, upper = ratio_error_bounds(n)
    title = f"Lucas ratio convergence at n={n}"
    body = (
        f"## Claim\n\n"
        f"`L(n+1)/L(n) → φ` with rigorous bounds `√5/(L_n(L_n+|ψ|^n)) ≤ |L(n+1)/L(n) − φ| ≤ √5/(L_n(L_n−|ψ|^n))`.\n\n"
        f"## Measurement at n={n}\n\n"
        f"- L(n+1)/L(n) = **{r:.16f}**\n"
        f"- φ           = **{PHI:.16f}**\n"
        f"- Observed |err|     = **{err:.3e}**\n"
        f"- Lower error bound  = **{lower:.3e}**\n"
        f"- Upper error bound  = **{upper:.3e}**\n"
        f"- Within bounds?     = **{lower <= err <= upper}**\n\n"
        f"## Notes\n\n"
        f"Convergence rate is geometric in |ψ|^n where ψ = 1 − φ ≈ −0.618. The bounds\n"
        f"are derived from the identity L_n = φⁿ + ψⁿ and become tight (upper/lower → 1)\n"
        f"for moderate n.\n"
    )
    return title, body, {"n": n}


def topic_signature_4_7_11(_seed: int = 0) -> tuple[str, str, dict]:
    """Lucas (L3,L4,L5) = (4,7,11) signature audit."""
    _ensure_rff_on_path()
    from recursive_field_math import egypt_4_7_11, signature_summary  # type: ignore

    sig = signature_summary()
    egy_num, egy_den = egypt_4_7_11()
    title = "Lucas signature (4, 7, 11)"
    body = (
        f"## Claim\n\n"
        f"The Lucas triplet (L₃, L₄, L₅) = (4, 7, 11) carries a tight bundle of identities:\n\n"
        f"- additive chain: L₃ + L₄ = L₅\n"
        f"- product: L₃·L₄·L₅ = 308\n"
        f"- pair-sum: L₃L₄ + L₃L₅ + L₄L₅ = 149\n"
        f"- Frobenius F(4, 7) = 17\n"
        f"- Egyptian fraction 1/4 + 1/7 + 1/11 = 149/308\n\n"
        f"## Computed\n\n"
        f"- L₃, L₄, L₅ = **{sig['L3']}, {sig['L4']}, {sig['L5']}**\n"
        f"- additive_chain = **{sig['additive_chain']}**\n"
        f"- product (triple) = **{sig['product']}**\n"
        f"- pair_sum = **{sig['pair_sum']}**\n"
        f"- frobenius_4_7 = **{sig['frobenius_4_7']}**\n"
        f"- Egyptian fraction (irreducible) = **{egy_num}/{egy_den}**\n"
        f"- Pair-sum equals Egyptian numerator? **{sig['pair_sum'] == egy_num}**\n"
        f"- Triple-product equals Egyptian denominator? **{sig['product'] == egy_den}**\n\n"
        f"## Notes\n\n"
        f"The pair-sum = numerator coincidence is not accidental: 1/4 + 1/7 + 1/11 has common\n"
        f"denominator 4·7·11 = 308, and the numerators after rescaling are the pairwise products\n"
        f"(7·11, 4·11, 4·7), summing to 149. The Frobenius number F(4,7) = 17 is the largest\n"
        f"integer NOT representable as 4a + 7b for a, b ∈ ℤ₊.\n"
    )
    return title, body, {"variant": _seed}


def topic_cfrac_structure(n: int) -> tuple[str, str, dict]:
    """Continued-fraction structure of L(n+1)/L(n)."""
    _ensure_rff_on_path()
    from recursive_field_math.continued_fraction import lucas_ratio_cfrac  # type: ignore
    from recursive_field_math import L  # type: ignore

    num, den, meta = lucas_ratio_cfrac(n)
    cfrac_repr = f"[1; {', '.join(['1'] * meta['ones'])}{', ' if meta['ones'] else ''}3]"
    title = f"Continued fraction of L({n+1})/L({n})"
    body = (
        f"## Claim\n\n"
        f"For n ≥ 2, L(n+1)/L(n) = [1; 1, 1, ..., 1, 3] with (n−2) ones.\n\n"
        f"## At n={n}\n\n"
        f"- L({n+1})/L({n}) = **{num}/{den}**\n"
        f"- continued fraction = **{cfrac_repr}**\n"
        f"- number of internal ones = **{meta['ones']}**\n"
        f"- tail term = **{meta['tail']}**\n\n"
        f"## Notes\n\n"
        f"As n → ∞ the tail-3 gets pushed off to infinity and the expansion approaches\n"
        f"[1; 1, 1, 1, ...] = φ. Lucas ratios are therefore a deterministic family of\n"
        f"rational approximations to φ that converge with the slowest possible rate of\n"
        f"any irrational (all coefficients = 1 in the limit).\n"
    )
    return title, body, {"n": n}


def topic_gf_evaluation(x_int_recip: int) -> tuple[str, str, dict]:
    """Evaluate Fibonacci generating function at x=1/k and verify against truncated series."""
    _ensure_rff_on_path()
    from recursive_field_math import F, GF_F  # type: ignore

    x = 1.0 / x_int_recip
    closed = GF_F(x)
    # Truncated series: sum_{n=0..40} F(n) * x^n
    partial = sum(F(n) * (x ** n) for n in range(41))
    err = abs(closed - partial)
    title = f"Fibonacci generating function at x = 1/{x_int_recip}"
    body = (
        f"## Claim\n\n"
        f"`G_F(x) = x / (1 − x − x²) = Σ_{{n≥0}} F(n) x^n` converges for |x| < 1/φ ≈ 0.618.\n\n"
        f"## At x = 1/{x_int_recip} = {x:.10f}\n\n"
        f"- Closed form `x/(1−x−x²)` = **{closed:.12f}**\n"
        f"- Partial sum Σ_{{n=0..40}} F(n)·x^n = **{partial:.12f}**\n"
        f"- |closed − partial| = **{err:.3e}**\n"
        f"- |x| < 1/φ ≈ 0.6180 ? **{x < (1 / 1.618033988749895)}**\n\n"
        f"## Notes\n\n"
        f"Singularities at x = 1/φ and x = 1/ψ control growth: F(n) ~ φⁿ/√5. The\n"
        f"truncated sum's residual error after N terms is bounded by |x|^(N+1)·φ^(N+1)/√5,\n"
        f"which is why convergence is fast for x < 0.5 and slow near the singularity.\n"
    )
    return title, body, {"x_recip": x_int_recip}


def topic_doubling_formula(n: int) -> tuple[str, str, dict]:
    """L(2n) = L(n)² − 2·(−1)^n at index n."""
    _ensure_rff_on_path()
    from recursive_field_math import L  # type: ignore

    lhs = L(2 * n)
    rhs = L(n) ** 2 - 2 * ((-1) ** n)
    holds = lhs == rhs
    title = f"Lucas doubling formula at n={n}"
    body = (
        f"## Claim\n\n"
        f"`L(2n) = L(n)² − 2·(−1)^n`\n\n"
        f"## At n={n}\n\n"
        f"- L({2*n})       = **{lhs}**\n"
        f"- L({n})         = **{L(n)}**\n"
        f"- L({n})² − 2·(−1)^{n} = **{rhs}**\n"
        f"- Equal? **{holds}**\n\n"
        f"## Notes\n\n"
        f"This doubling identity is a corollary of L(m+n) = L(m)·L(n) − (−1)^n·L(m−n)\n"
        f"with m = n. It lets L(2n) be computed from L(n) in one multiply, making\n"
        f"a binary-doubling algorithm O(log n) instead of O(n).\n"
    )
    return title, body, {"n": n}


# ─────────────────────────────────────────────────────────────────────
# Topic registry
# ─────────────────────────────────────────────────────────────────────

TOPICS: dict[str, dict] = {
    "cassini_lucas":       {"gen": topic_cassini_lucas,      "param_choices": [3, 5, 8, 13, 21, 34, 55]},
    "ratio_convergence":   {"gen": topic_ratio_convergence,  "param_choices": [4, 7, 11, 18, 29, 47, 76]},
    "signature_4_7_11":    {"gen": topic_signature_4_7_11,   "param_choices": [0]},
    "cfrac_structure":     {"gen": topic_cfrac_structure,    "param_choices": [3, 5, 8, 12, 17]},
    "gf_evaluation":       {"gen": topic_gf_evaluation,      "param_choices": [3, 4, 5, 7, 10]},
    "doubling_formula":    {"gen": topic_doubling_formula,   "param_choices": [4, 7, 11, 18, 29, 47]},
}


# ─────────────────────────────────────────────────────────────────────
# State + UCB1 selection
# ─────────────────────────────────────────────────────────────────────

def _load_state() -> dict:
    if not os.path.exists(_STATE_PATH):
        return {
            "version":       1,
            "total_pulls":   0,
            "topic_pulls":   {k: 0 for k in TOPICS},
            "topic_q":       {k: 0.0 for k in TOPICS},
            "param_cursor":  {k: 0 for k in TOPICS},
            "history":       [],
        }
    try:
        with open(_STATE_PATH, encoding="utf-8") as fh:
            s = json.load(fh)
        # Backfill any new topics
        for k in TOPICS:
            s.setdefault("topic_pulls", {}).setdefault(k, 0)
            s.setdefault("topic_q", {}).setdefault(k, 0.0)
            s.setdefault("param_cursor", {}).setdefault(k, 0)
        return s
    except Exception:
        return _load_state.__wrapped__() if hasattr(_load_state, "__wrapped__") else {
            "version": 1, "total_pulls": 0,
            "topic_pulls": {k: 0 for k in TOPICS},
            "topic_q":     {k: 0.0 for k in TOPICS},
            "param_cursor": {k: 0 for k in TOPICS},
            "history":     [],
        }


def _save_state(state: dict) -> None:
    os.makedirs(_FINDINGS_DIR, exist_ok=True)
    tmp = _STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, _STATE_PATH)


def _ucb_pick_topic(state: dict) -> str:
    T = max(1, state["total_pulls"])
    best_topic = None
    best_score = -1e18
    for k in TOPICS:
        n = state["topic_pulls"].get(k, 0)
        q = state["topic_q"].get(k, 0.0)
        if n == 0:
            return k  # Always pull an untried topic first
        score = q + math.sqrt(2.0 * math.log(T) / n)
        if score > best_score:
            best_score = score
            best_topic = k
    return best_topic or next(iter(TOPICS))


def _pick_param(state: dict, topic: str) -> tuple[int, dict]:
    choices = TOPICS[topic]["param_choices"]
    cursor = state["param_cursor"].get(topic, 0) % len(choices)
    state["param_cursor"][topic] = (cursor + 1) % len(choices)
    return choices[cursor], state


# ─────────────────────────────────────────────────────────────────────
# Filename + git
# ─────────────────────────────────────────────────────────────────────

def _finding_filename(topic: str, params: dict, title: str) -> str:
    payload = json.dumps({"topic": topic, "params": params}, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:8]
    date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_topic = topic.replace("_", "-")
    return f"{date}_{safe_topic}_{digest}.md"


def _write_finding(topic: str, title: str, body: str, params: dict) -> str:
    os.makedirs(_FINDINGS_DIR, exist_ok=True)
    fname = _finding_filename(topic, params, title)
    fpath = os.path.join(_FINDINGS_DIR, fname)
    if os.path.exists(fpath):
        return fpath  # Same (topic, params) → idempotent
    ts_iso = datetime.now(timezone.utc).isoformat()
    header = (
        f"---\n"
        f"agent: agent_06 Lucas Analyst (Snell-Vern)\n"
        f"topic: {topic}\n"
        f"params: {json.dumps(params, sort_keys=True)}\n"
        f"generated_at: {ts_iso}\n"
        f"library: recursive_field_math\n"
        f"---\n\n"
        f"# {title}\n\n"
    )
    with open(fpath, "w", encoding="utf-8") as fh:
        fh.write(header + body)
    return fpath


def _git(args: list[str]) -> tuple[int, str, str]:
    r = subprocess.run(
        ["git"] + args, cwd=_REPO, capture_output=True, text=True, timeout=30,
    )
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def _git_commit(file_paths: list[str], topic: str, title: str) -> tuple[bool, str]:
    rels = [os.path.relpath(p, _REPO).replace("\\", "/") for p in file_paths]
    rc, _, err = _git(["add"] + rels)
    if rc != 0:
        return False, f"git add failed: {err}"

    msg_subject = f"agent_06: {title}"
    msg_body = (
        f"Autonomous finding by Snell-Vern agent_06 Lucas Analyst.\n"
        f"\n"
        f"Topic: {topic}\n"
        f"Library: recursive_field_math\n"
        f"\n"
        f"Generated end-to-end without human authorship:\n"
        f"  observe state → UCB-pick topic → compute → write → commit.\n"
    )
    r = subprocess.run(
        ["git",
         "-c", f"user.name={_AGENT_NAME}",
         "-c", f"user.email={_AGENT_EMAIL}",
         "commit", "-m", msg_subject, "-m", msg_body],
        cwd=_REPO, capture_output=True, text=True, timeout=30,
    )
    if r.returncode != 0:
        return False, f"git commit failed: {r.stderr.strip() or r.stdout.strip()}"

    rc, sha, _ = _git(["rev-parse", "--short", "HEAD"])
    return True, sha if rc == 0 else "(unknown sha)"


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────

def run_once(no_commit: bool = False) -> dict:
    state = _load_state()
    topic = _ucb_pick_topic(state)
    param, state = _pick_param(state, topic)

    gen = TOPICS[topic]["gen"]
    title, body, params = gen(param)

    fpath = _write_finding(topic, title, body, params)

    # Update state
    state["topic_pulls"][topic] = state["topic_pulls"].get(topic, 0) + 1
    state["total_pulls"] = state.get("total_pulls", 0) + 1
    # Reward 1.0 per successful finding (every topic earns equally for v1;
    # future: integrate downstream usage / Adam feedback into q).
    n = state["topic_pulls"][topic]
    q_prev = state["topic_q"].get(topic, 0.0)
    state["topic_q"][topic] = q_prev + (1.0 - q_prev) / n  # online mean
    state["history"].append({
        "ts":    time.time(),
        "topic": topic,
        "params": params,
        "file":  os.path.relpath(fpath, _REPO).replace("\\", "/"),
    })
    state["history"] = state["history"][-200:]
    _save_state(state)

    result = {
        "topic":   topic,
        "params":  params,
        "title":   title,
        "file":    os.path.relpath(fpath, _REPO).replace("\\", "/"),
        "total_pulls": state["total_pulls"],
        "topic_pulls": state["topic_pulls"][topic],
    }

    if no_commit:
        result["committed"] = False
        result["commit_skipped_reason"] = "--no-commit"
        return result

    ok, info = _git_commit([fpath, _STATE_PATH], topic, title)
    result["committed"] = ok
    if ok:
        result["commit_sha"] = info
    else:
        result["commit_error"] = info
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Snell-Vern agent_06 Lucas Analyst — autonomous finding")
    ap.add_argument("--no-commit", action="store_true",
                    help="write finding + update state, but do not git commit")
    args = ap.parse_args()

    result = run_once(no_commit=args.no_commit)
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    try:
        if sys.stdout is not None:
            try: sys.stdout.reconfigure(encoding="utf-8")
            except Exception: pass
            print(payload)
    except Exception:
        pass
    return 0 if "commit_error" not in result else 1


if __name__ == "__main__":
    sys.exit(main())
