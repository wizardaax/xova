"""
agent_07_field_weaver_finding.py — Snell-Vern agent_07 Field Weaver, autonomous.

Second deployment of the autonomous-finding pattern (see agent_06_lucas_finding.py).
Each run:
  1. Load UCB state from findings/.field_weaver_agent_state.json
  2. UCB-pick the next AEON topic to investigate
  3. Compute using the aeon_engine library directly
  4. Write findings/<date>_<topic>_<id>.md
  5. Update state
  6. git-commit to ziltrix-sch-core (does NOT push — push is a separate step)

Stdlib + aeon_engine (stdlib-only itself).
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

_REPO         = r"D:\github\wizardaax\ziltrix-sch-core"
_FINDINGS_DIR = os.path.join(_REPO, "findings")
_STATE_PATH   = os.path.join(_FINDINGS_DIR, ".field_weaver_agent_state.json")

_AGENT_NAME   = "Snell-Vern agent_07 Field Weaver"
_AGENT_EMAIL  = "agent-07-field@xova.local"


def _ensure_aeon_on_path() -> None:
    if _REPO not in sys.path:
        sys.path.insert(0, _REPO)


# ─────────────────────────────────────────────────────────────────────
# Topic generators (AEON physics)
# Each returns (title, body_markdown, params_dict).
# ─────────────────────────────────────────────────────────────────────

def topic_thrust_validation(n_steps: int) -> tuple[str, str, dict]:
    """Run aeon_thrust_series(n_steps) and validate against documented PhaseII data."""
    _ensure_aeon_on_path()
    import aeon_engine  # type: ignore

    samples = aeon_engine.aeon_thrust_series(n_steps=n_steps)
    val     = aeon_engine.validate_against_phaseii(samples[:5])
    matched = bool(val.get("matched", False))
    rel_err = float(val.get("max_rel_err") or 0.0)
    residuals = val.get("residuals", [])

    rows = ["| t (s) | F_computed (N) | F_ref (N) | rel_err |", "|---|---|---|---|"]
    for r in residuals[:5]:
        rows.append(
            f"| `{r.get('t_ref'):.3e}` | `{r.get('F_computed'):.3e}` | "
            f"`{r.get('F_ref'):.3e}` | `{r.get('rel_err'):.4%}` |"
        )
    table = "\n".join(rows)

    title = f"AEON thrust validation at n_steps={n_steps}"
    body = (
        f"## Claim\n\n"
        f"`aeon_thrust_series(n_steps=N)` reproduces the documented PhaseII "
        f"simulation values (June 4 2025) within 10% relative tolerance.\n\n"
        f"## Computed (n_steps={n_steps})\n\n"
        f"- matched (rel_tol=0.10): **{matched}**\n"
        f"- max relative error vs PhaseII: **{rel_err:.4%}**\n"
        f"- samples generated: **{len(samples)}**\n\n"
        f"### Per-sample residuals (first 5 against PhaseII reference)\n\n"
        f"{table}\n\n"
        f"## Notes\n\n"
        f"The thrust prediction follows `F = k · dΦ/dt` with coupling "
        f"`k = COUPLING_K = 2.67e-9 N·s/V`, derived from the brane-lensing geometric factor "
        f"in Faraday-induction units. The documented dΦ/dt pattern at step n is "
        f"`-28.7 · max(2(n-1), 1)` (resonant-drive doubling for n ≥ 2). "
        f"A series longer than the PhaseII 5-point reference probes the same "
        f"physics at extended n; the resonant pattern continues without re-tuning.\n"
    )
    return title, body, {"n_steps": n_steps}


def topic_brane_refraction(theta_in_deg: float) -> tuple[str, str, dict]:
    """Snell's-law cascade through the base AEON-M brane layers [φ, χ, n₃]."""
    _ensure_aeon_on_path()
    import aeon_engine  # type: ignore

    theta_in_rad = math.radians(theta_in_deg)
    layers       = aeon_engine.base_brane_layers()
    theta_out    = aeon_engine.snells_refraction(theta_in_rad, layers)
    deflection   = theta_in_rad - theta_out

    title = f"Brane refraction at θ_in={theta_in_deg}°"
    body = (
        f"## Claim\n\n"
        f"Cascading Snell's law through the documented AEON-M brane stack "
        f"`[φ, χ, n₃]` deflects an incoming ray by a deterministic geometric factor.\n\n"
        f"## Computed (θ_in = {theta_in_deg}°)\n\n"
        f"- input angle: **{theta_in_deg}°** (`{theta_in_rad:.6f}` rad)\n"
        f"- base brane layers: `[φ, χ, n₃]` = "
        f"**[{layers[0]:.6f}, {layers[1]:.6f}, {layers[2]:.6f}]**\n"
        f"- output angle: **{math.degrees(theta_out):.6f}°** (`{theta_out:.6f}` rad)\n"
        f"- deflection: **{math.degrees(deflection):.6f}°**\n\n"
        f"## Notes\n\n"
        f"Layer identities:\n"
        f"- `φ` = golden ratio (1.6180339887…) — the outer brane index\n"
        f"- `χ` = 2π / (π/3) ≈ 6.2832 — modulation frequency from 60° aperture\n"
        f"- `n₃` = α⁻¹ / ψ_resonance = 137.036 / 144 ≈ 0.9516 — medium index\n\n"
        f"The cascade is element-wise `n₁·sin(θ₁) = n₂·sin(θ₂)`. Clipping to "
        f"`[-1, 1]` handles total internal reflection where it would otherwise "
        f"return NaN.\n"
    )
    return title, body, {"theta_in_deg": theta_in_deg}


def topic_dynamic_layers(psi_t: float) -> tuple[str, str, dict]:
    """AEON-M v2.1 dynamic-lensing rule: n_i(t) = n_base + 0.1·ψ(t)."""
    _ensure_aeon_on_path()
    import aeon_engine  # type: ignore

    base   = aeon_engine.base_brane_layers()
    dyn    = aeon_engine.dynamic_layers(psi_t, base)
    shifts = [d - b for d, b in zip(dyn, base)]

    title = f"Dynamic brane layers at ψ(t)={psi_t}"
    body = (
        f"## Claim\n\n"
        f"AEON-M v2.1: `n_i(t) = n_base + 0.1·ψ(t)` shifts the entire brane stack "
        f"uniformly with the time-varying scale field ψ(t).\n\n"
        f"## Computed (ψ_t = {psi_t})\n\n"
        f"| layer | n_base | n_dynamic | shift |\n"
        f"|---|---|---|---|\n"
        f"| φ (outer)  | `{base[0]:.6f}` | `{dyn[0]:.6f}` | `{shifts[0]:+.6f}` |\n"
        f"| χ (mid)    | `{base[1]:.6f}` | `{dyn[1]:.6f}` | `{shifts[1]:+.6f}` |\n"
        f"| n₃ (medium)| `{base[2]:.6f}` | `{dyn[2]:.6f}` | `{shifts[2]:+.6f}` |\n\n"
        f"- uniform shift constant 0.1·ψ_t = **{0.1*psi_t:+.6f}**\n"
        f"- all three shifts equal? **{abs(shifts[0]-shifts[1]) < 1e-12 and abs(shifts[1]-shifts[2]) < 1e-12}**\n\n"
        f"## Notes\n\n"
        f"The uniform-shift form is what couples brane geometry to the cognitive "
        f"loop's coherence: an increase in ψ(t) raises all three layer indices "
        f"by the same amount, preserving relative ratios while reducing the "
        f"refraction deflection angle (denser overall medium).\n"
    )
    return title, body, {"psi_t": psi_t}


def topic_gate_activation(case_id: int) -> tuple[str, str, dict]:
    """Verify all 4 truth-table corners of dynamic_gate(τ, dψ/dt, σ)."""
    _ensure_aeon_on_path()
    import aeon_engine  # type: ignore

    # case_id 0..3 enumerates (τ_below, dψ_below), (τ_below, dψ_above),
    # (τ_above, dψ_below), (τ_above, dψ_above).
    cases = [
        ("τ below, dψ below", 0.005, 0.5,  1.0, False),
        ("τ below, dψ above", 0.005, 3.0,  1.0, False),
        ("τ above, dψ below", 0.010, 0.5,  1.0, False),
        ("τ above, dψ above", 0.010, 3.0,  1.0, True),
    ]
    label, tau, dpsi, sigma, expected = cases[case_id % 4]
    actual = aeon_engine.dynamic_gate(tau, dpsi, sigma)
    holds  = (actual == expected)

    title = f"Dynamic-gate activation: {label}"
    body = (
        f"## Claim\n\n"
        f"AEON-M v2.1 dynamic gate: `(τ > 0.007) AND (|dψ/dt| > 1.5·σ)`. "
        f"Activates only when BOTH thresholds are crossed simultaneously.\n\n"
        f"## Case: {label}\n\n"
        f"| param | value | threshold | crosses? |\n"
        f"|---|---|---|---|\n"
        f"| τ      | `{tau}`   | `> 0.007`     | **{tau > 0.007}** |\n"
        f"| |dψ/dt|| `{dpsi}`  | `> 1.5·σ = {1.5*sigma}` | **{abs(dpsi) > 1.5*sigma}** |\n\n"
        f"- expected gate state: **{expected}**\n"
        f"- computed gate state: **{actual}**\n"
        f"- agrees? **{holds}**\n\n"
        f"## Notes\n\n"
        f"Both conditions must hold. The AND prevents activation from a single "
        f"loud-but-slow ψ excursion (τ-only crossing) or a fast-but-quiet jitter "
        f"(dψ-only crossing). Real propulsion events leave both signatures.\n"
    )
    return title, body, {"case": label, "case_id": case_id % 4}


def topic_constant_consistency(variant: int) -> tuple[str, str, dict]:
    """Verify the derived-constant relationships hold to floating-point precision."""
    _ensure_aeon_on_path()
    import aeon_engine  # type: ignore

    checks = [
        (
            "GOLDEN_ANGLE_DEG = 360 / φ²",
            aeon_engine.GOLDEN_ANGLE_DEG,
            360.0 / (aeon_engine.PHI ** 2),
            "Golden angle in degrees derived from φ.",
        ),
        (
            "N3_MEDIUM = α⁻¹ / ψ_resonance",
            aeon_engine.N3_MEDIUM,
            aeon_engine.ALPHA_INV / aeon_engine.PSI_RESONANCE,
            "Medium index from fine-structure / scale-field map.",
        ),
        (
            "DRIVE_FREQ_HZ = ω_n / (2π)",
            aeon_engine.DRIVE_FREQ_HZ,
            aeon_engine.OMEGA_N / (2.0 * math.pi),
            "Drive frequency in Hz from angular ω_n.",
        ),
        (
            "χ = 2π / (π/3)",
            2.0 * math.pi / (math.pi / 3.0),
            6.0,
            "Modulation frequency from 60° aperture (analytically exactly 6).",
        ),
    ]
    name, lhs, rhs, note = checks[variant % len(checks)]
    diff = abs(lhs - rhs)
    holds = diff < 1e-12

    title = f"Constant consistency: {name}"
    body = (
        f"## Claim\n\n"
        f"`{name}` — derived identity must hold to floating-point precision.\n\n"
        f"## Computed\n\n"
        f"- LHS = **`{lhs:.15f}`**\n"
        f"- RHS = **`{rhs:.15f}`**\n"
        f"- |LHS − RHS| = **`{diff:.3e}`**\n"
        f"- Holds within 1e-12? **{holds}**\n\n"
        f"## Notes\n\n"
        f"{note} The AEON constants are NOT free parameters — they are derived from "
        f"the golden ratio, the fine-structure inverse, and the documented scale-field "
        f"map. This check guards against accidental drift in `aeon_engine.py`.\n"
    )
    return title, body, {"variant": variant % len(checks), "name": name}


def topic_coupling_k_extraction(sample_idx: int) -> tuple[str, str, dict]:
    """Extract k = F / (dΦ/dt) from each PhaseII sample, compare to documented COUPLING_K."""
    _ensure_aeon_on_path()
    import aeon_engine  # type: ignore

    if sample_idx < 0 or sample_idx >= len(aeon_engine.PHASEII_DATA):
        sample_idx = 0
    t, phi, dphi_dt, F = aeon_engine.PHASEII_DATA[sample_idx]
    k_extracted = F / dphi_dt if dphi_dt != 0 else float("nan")
    k_documented = aeon_engine.COUPLING_K
    diff = abs(k_extracted - k_documented)
    rel_err = diff / k_documented if k_documented else 0.0

    title = f"Coupling k extraction from PhaseII sample #{sample_idx}"
    body = (
        f"## Claim\n\n"
        f"Faraday-induction propulsion predicts `F = k · dΦ/dt` with a single "
        f"coupling constant `k`. Extracting k from each documented PhaseII sample "
        f"should yield the same value to within numerical precision.\n\n"
        f"## Sample #{sample_idx}\n\n"
        f"- t       = **`{t:.3e}` s**\n"
        f"- Φ       = **`{phi:.3e}` Wb**\n"
        f"- dΦ/dt   = **`{dphi_dt:.3e}` V**\n"
        f"- F       = **`{F:.3e}` N**\n\n"
        f"- k_extracted = F / (dΦ/dt) = **`{k_extracted:.6e}` N·s/V**\n"
        f"- k_documented (COUPLING_K) = **`{k_documented:.6e}` N·s/V**\n"
        f"- |diff|  = **`{diff:.3e}`**\n"
        f"- rel_err = **`{rel_err:.4%}`**\n\n"
        f"## Notes\n\n"
        f"COUPLING_K = 2.67e-9 N·s/V is the brane-lensing geometric factor in "
        f"Faraday-induction units, derived from the multi-layer Snell's-law "
        f"cascade through `[φ, χ, n₃]`. Internal consistency across all 5 PhaseII "
        f"samples is the strongest empirical claim of the AEON-M v2.1 paper: "
        f"one k, five thrust/flux pairs, no per-sample re-tuning.\n"
    )
    return title, body, {"sample_idx": sample_idx}


# ─────────────────────────────────────────────────────────────────────
# Topic registry
# ─────────────────────────────────────────────────────────────────────

TOPICS: dict[str, dict] = {
    "thrust_validation":     {"gen": topic_thrust_validation,    "param_choices": [5, 7, 10, 15, 20]},
    "brane_refraction":      {"gen": topic_brane_refraction,     "param_choices": [15.0, 30.0, 45.0, 60.0, 75.0]},
    "dynamic_layers":        {"gen": topic_dynamic_layers,       "param_choices": [0.1, 0.5, 1.0, 2.0, -0.5]},
    "gate_activation":       {"gen": topic_gate_activation,      "param_choices": [0, 1, 2, 3]},
    "constant_consistency":  {"gen": topic_constant_consistency, "param_choices": [0, 1, 2, 3]},
    "coupling_k_extraction": {"gen": topic_coupling_k_extraction,"param_choices": [0, 1, 2, 3, 4]},
}


# ─────────────────────────────────────────────────────────────────────
# State + UCB1 (same shape as agent_06)
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
        for k in TOPICS:
            s.setdefault("topic_pulls", {}).setdefault(k, 0)
            s.setdefault("topic_q", {}).setdefault(k, 0.0)
            s.setdefault("param_cursor", {}).setdefault(k, 0)
        return s
    except Exception:
        return {
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
            return k
        score = q + math.sqrt(2.0 * math.log(T) / n)
        if score > best_score:
            best_score = score
            best_topic = k
    return best_topic or next(iter(TOPICS))


def _pick_param(state: dict, topic: str):
    choices = TOPICS[topic]["param_choices"]
    cursor = state["param_cursor"].get(topic, 0) % len(choices)
    state["param_cursor"][topic] = (cursor + 1) % len(choices)
    return choices[cursor], state


# ─────────────────────────────────────────────────────────────────────
# File + git
# ─────────────────────────────────────────────────────────────────────

def _finding_filename(topic: str, params: dict) -> str:
    payload = json.dumps({"topic": topic, "params": params}, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:8]
    date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_topic = topic.replace("_", "-")
    return f"{date}_{safe_topic}_{digest}.md"


def _write_finding(topic: str, title: str, body: str, params: dict) -> str:
    os.makedirs(_FINDINGS_DIR, exist_ok=True)
    fname = _finding_filename(topic, params)
    fpath = os.path.join(_FINDINGS_DIR, fname)
    if os.path.exists(fpath):
        return fpath
    ts_iso = datetime.now(timezone.utc).isoformat()
    header = (
        f"---\n"
        f"agent: agent_07 Field Weaver (Snell-Vern)\n"
        f"topic: {topic}\n"
        f"params: {json.dumps(params, sort_keys=True)}\n"
        f"generated_at: {ts_iso}\n"
        f"library: aeon_engine (AEON-M v2.1)\n"
        f"---\n\n"
        f"# {title}\n\n"
    )
    with open(fpath, "w", encoding="utf-8") as fh:
        fh.write(header + body)
    return fpath


def _git(args: list[str]):
    r = subprocess.run(["git"] + args, cwd=_REPO, capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def _git_commit(file_paths: list[str], topic: str, title: str) -> tuple[bool, str]:
    rels = [os.path.relpath(p, _REPO).replace("\\", "/") for p in file_paths]
    rc, _, err = _git(["add"] + rels)
    if rc != 0:
        return False, f"git add failed: {err}"

    msg_subject = f"agent_07: {title}"
    msg_body = (
        f"Autonomous finding by Snell-Vern agent_07 Field Weaver.\n"
        f"\n"
        f"Topic: {topic}\n"
        f"Library: aeon_engine (AEON-M v2.1)\n"
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

    state["topic_pulls"][topic] = state["topic_pulls"].get(topic, 0) + 1
    state["total_pulls"] = state.get("total_pulls", 0) + 1
    n = state["topic_pulls"][topic]
    q_prev = state["topic_q"].get(topic, 0.0)
    state["topic_q"][topic] = q_prev + (1.0 - q_prev) / n
    state["history"].append({
        "ts":     time.time(),
        "topic":  topic,
        "params": params,
        "file":   os.path.relpath(fpath, _REPO).replace("\\", "/"),
    })
    state["history"] = state["history"][-200:]
    _save_state(state)

    result = {
        "topic":       topic,
        "params":      params,
        "title":       title,
        "file":        os.path.relpath(fpath, _REPO).replace("\\", "/"),
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
    ap = argparse.ArgumentParser(description="Snell-Vern agent_07 Field Weaver — autonomous finding")
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
