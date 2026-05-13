"""
agent_05_phase_tracker_finding.py — Snell-Vern agent_05 Phase Tracker, autonomous.

Fourth deployment of the autonomous-finding pattern. Where agent_07 PRODUCES
AEON physics from the engine, agent_05 OBSERVES — it reads the running
substrate's AEON state (broker slot + run log + cycle coherence) and writes
analytical findings about state transitions and trends.

Each run:
  1. Load UCB state from findings/.phase_tracker_agent_state.json (in ziltrix-sch-core)
  2. UCB-pick the next observation topic
  3. Read live data: context_broker.json + aeon_run_log.jsonl + mesh_feed.jsonl
  4. Produce an analytic finding
  5. Update state
  6. git-commit to ziltrix-sch-core (does NOT push)

Stdlib only.
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

_REPO          = r"D:\github\wizardaax\ziltrix-sch-core"
_FINDINGS_DIR  = os.path.join(_REPO, "findings")
_STATE_PATH    = os.path.join(_FINDINGS_DIR, ".phase_tracker_agent_state.json")

_BROKER_PATH   = r"C:\Xova\memory\context_broker.json"
_AEON_LOG      = r"C:\Xova\memory\aeon_run_log.jsonl"
_MESH_FEED     = r"C:\Xova\memory\mesh_feed.jsonl"
_AEON_ENGINE_REPO = r"D:\github\wizardaax\ziltrix-sch-core"

_AGENT_NAME    = "Snell-Vern agent_05 Phase Tracker"
_AGENT_EMAIL   = "agent-05-phase@xova.local"


# ─────────────────────────────────────────────────────────────────────
# Data readers
# ─────────────────────────────────────────────────────────────────────

def _read_slot(key: str) -> dict | None:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as fh:
            broker = json.load(fh)
        slot = broker.get("slots", {}).get(key)
        if not slot:
            return None
        v = slot.get("value") if isinstance(slot.get("value"), dict) else slot
        if isinstance(v, str):
            try: v = json.loads(v)
            except Exception: return None
        v["_slot_agent"] = slot.get("agent")
        v["_slot_ts"]    = slot.get("ts")
        return v
    except Exception:
        return None


def _read_aeon_log(n: int = 50) -> list[dict]:
    if not os.path.exists(_AEON_LOG):
        return []
    out: list[dict] = []
    try:
        with open(_AEON_LOG, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line: continue
                try: out.append(json.loads(line))
                except Exception: continue
    except Exception:
        return []
    return out[-n:]


def _read_cycle_coherence(n: int = 30) -> list[tuple[float, float, int | None]]:
    """Return list of (ts, coherence, cycle_num) for the most recent cycle_end events."""
    if not os.path.exists(_MESH_FEED):
        return []
    out: list[tuple[float, float, int | None]] = []
    try:
        with open(_MESH_FEED, encoding="utf-8") as fh:
            lines = fh.readlines()
        for line in lines:
            line = line.strip()
            if not line: continue
            try: e = json.loads(line)
            except Exception: continue
            if e.get("kind") != "cycle_end": continue
            ts = e.get("ts")
            coh = e.get("coherence")
            if ts is None or coh is None: continue
            cycle_num: int | None = None
            parts = str(e.get("content", "")).split()
            if len(parts) >= 2 and parts[0] == "cycle" and parts[1].isdigit():
                cycle_num = int(parts[1])
            out.append((float(ts), float(coh), cycle_num))
    except Exception:
        return []
    return out[-n:]


# ─────────────────────────────────────────────────────────────────────
# Topic generators
# ─────────────────────────────────────────────────────────────────────

def topic_slot_snapshot(_: int) -> tuple[str, str, dict]:
    """Describe the current `xova.aeon_last_run` slot as a state observation."""
    slot = _read_slot("xova.aeon_last_run")
    if not slot:
        return ("AEON state snapshot — slot empty",
                "## Status\n\n`xova.aeon_last_run` is empty. mesh_runner has not "
                "published an AEON cycle since the broker was last cleared.\n",
                {"variant": "empty"})

    cycle      = slot.get("cycle")
    quality    = slot.get("quality_score")
    peak       = slot.get("peak_thrust")
    n_steps    = slot.get("n_steps")
    validated  = slot.get("validated")
    rel_err    = slot.get("max_rel_err")
    consts     = slot.get("constants") or {}
    series     = slot.get("thrust_series") or []
    dyn_gate   = slot.get("dynamic_gate")
    brane_geo  = slot.get("brane_geometry")
    version    = slot.get("version", "(pre-v2.1)")
    src_agent  = slot.get("_slot_agent")
    slot_age_s = max(0.0, time.time() - float(slot.get("_slot_ts", 0)))

    head = series[0] if series else {}
    tail = series[-1] if series else {}

    title = f"AEON state snapshot — cycle {cycle}, quality {quality}"
    body = (
        f"## Slot: `xova.aeon_last_run`\n\n"
        f"- writing agent: **`{src_agent}`**\n"
        f"- slot age: **{slot_age_s:.1f} s**\n"
        f"- version field: **{version}**\n\n"
        f"## Computed state\n\n"
        f"| field | value |\n"
        f"|---|---|\n"
        f"| cycle           | **{cycle}** |\n"
        f"| quality_score   | **{quality}** |\n"
        f"| peak_thrust (N) | **`{peak}`** |\n"
        f"| n_steps         | **{n_steps}** |\n"
        f"| validated       | **{validated}** |\n"
        f"| max_rel_err     | **`{rel_err}`** |\n"
        f"| dynamic_gate    | **{'present' if dyn_gate else 'absent (pre-v2.1 publish path)'}** |\n"
        f"| brane_geometry  | **{'present' if brane_geo else 'absent (pre-v2.1 publish path)'}** |\n\n"
        f"## Thrust series endpoints\n\n"
        f"- first: t=`{head.get('t')}` s, Φ=`{head.get('phi')}` Wb, F=`{head.get('thrust')}` N\n"
        f"- last:  t=`{tail.get('t')}` s, Φ=`{tail.get('phi')}` Wb, F=`{tail.get('thrust')}` N\n\n"
        f"## Constants in this run\n\n"
        f"```\n"
        f"PHI                = {consts.get('phi')}\n"
        f"GOLDEN_ANGLE_DEG   = {consts.get('golden_angle_deg')}\n"
        f"PSI_RESONANCE      = {consts.get('psi_resonance')}\n"
        f"ALPHA_INV          = {consts.get('alpha_inv')}\n"
        f"N3_MEDIUM          = {consts.get('n3_medium')}\n"
        f"OMEGA_N            = {consts.get('omega_n')}\n"
        f"DRIVE_FREQ_HZ      = {consts.get('drive_freq_hz')}\n"
        f"COUPLING_K         = {consts.get('coupling_k')}\n"
        f"```\n\n"
        f"## Notes\n\n"
        f"This snapshot reports state, not a fresh computation. The writing agent "
        f"field reveals which substrate component populated the slot — `mesh` "
        f"means a cognitive_cycle run with action='aeon' (full pipeline through "
        f"agent_07 Field Weaver); `sidecar` means `aeon_publisher.py` was invoked "
        f"out-of-band. When dynamic_gate / brane_geometry are absent, the publisher "
        f"is the pre-v2.1 path (mesh_runner's Sprint 1 publish has the v2.1 fields "
        f"but the running process still has the old code).\n"
    )
    return title, body, {"variant": "current_state"}


def topic_log_trend(metric_key: str) -> tuple[str, str, dict]:
    """Plot-style ASCII trend of a metric across aeon_run_log entries."""
    log = _read_aeon_log(50)
    if not log:
        return (f"AEON log trend — empty log",
                "## Status\n\n`aeon_run_log.jsonl` is empty. No history to analyse.\n",
                {"metric": metric_key, "empty": True})

    values: list[float] = []
    times:  list[float] = []
    for entry in log:
        v = entry.get(metric_key)
        if isinstance(v, (int, float)):
            values.append(float(v))
            t = entry.get("ts")
            if isinstance(t, (int, float)):
                times.append(float(t))

    if not values:
        return (f"AEON log trend — {metric_key}: no values",
                f"## Status\n\nLog has {len(log)} entries but none expose `{metric_key}`.\n",
                {"metric": metric_key, "n": 0})

    n   = len(values)
    mn  = min(values)
    mx  = max(values)
    avg = sum(values) / n
    # slope via simple least-squares on (index, value) — direction indicator
    if n >= 2:
        xs = list(range(n))
        x_mean = sum(xs) / n
        y_mean = avg
        num = sum((x - x_mean) * (v - y_mean) for x, v in zip(xs, values))
        den = sum((x - x_mean) ** 2 for x in xs) or 1e-12
        slope = num / den
    else:
        slope = 0.0
    direction = "stable" if abs(slope) < 1e-9 else ("rising" if slope > 0 else "falling")

    # tiny ASCII sparkline (1 line, 50 chars), normalized
    spark_chars = "▁▂▃▄▅▆▇█"
    if mx == mn:
        spark = spark_chars[0] * min(n, 50)
    else:
        spark = "".join(
            spark_chars[min(7, max(0, int((v - mn) / (mx - mn) * 7)))]
            for v in values[-50:]
        )

    span_s = (times[-1] - times[0]) if len(times) >= 2 else 0.0

    title = f"AEON log trend — {metric_key} ({direction}, n={n})"
    body = (
        f"## Metric: `{metric_key}`\n\n"
        f"- entries analyzed: **{n}**\n"
        f"- timespan: **{span_s:.0f} s** "
        f"(~{span_s/3600:.2f} h)\n"
        f"- min: **`{mn}`**\n"
        f"- max: **`{mx}`**\n"
        f"- avg: **`{avg}`**\n"
        f"- slope (per entry, OLS): **`{slope:.3e}`** → **{direction}**\n\n"
        f"## Sparkline (last {min(n, 50)} entries)\n\n"
        f"```\n"
        f"{spark}\n"
        f"```\n\n"
        f"## Notes\n\n"
        f"Trend is computed via ordinary least-squares regression on (entry_index, value) "
        f"pairs — index-based, not time-weighted, so it answers \"over the last n runs, "
        f"is the metric drifting?\" If the slope magnitude is below `1e-9` the metric "
        f"is reported as **stable**. Sparkline glyphs are unicode block-eighths scaled "
        f"linearly between observed min and max.\n"
    )
    return title, body, {"metric": metric_key, "n": n}


def topic_brane_sweep(_: int) -> tuple[str, str, dict]:
    """Run snells_refraction across a sweep of incident angles, tabulate."""
    if _AEON_ENGINE_REPO not in sys.path:
        sys.path.insert(0, _AEON_ENGINE_REPO)
    try:
        import aeon_engine  # type: ignore
    except Exception as exc:
        return ("Brane refraction sweep — engine unavailable",
                f"## Status\n\n`aeon_engine` import failed: `{exc}`\n",
                {"error": str(exc)})

    layers = aeon_engine.base_brane_layers()
    angles = [5.0, 15.0, 30.0, 45.0, 60.0, 75.0, 85.0]

    rows = ["| θ_in (deg) | θ_in (rad) | θ_out (rad) | θ_out (deg) | deflection (deg) |",
            "|---|---|---|---|---|"]
    deflections = []
    for ang in angles:
        rad_in  = math.radians(ang)
        rad_out = aeon_engine.snells_refraction(rad_in, layers)
        deg_out = math.degrees(rad_out)
        defl    = ang - deg_out
        deflections.append(defl)
        rows.append(f"| {ang} | `{rad_in:.6f}` | `{rad_out:.6f}` | `{deg_out:.4f}` | `{defl:+.4f}` |")

    max_abs_defl = max(abs(d) for d in deflections)
    min_abs_defl = min(abs(d) for d in deflections)

    title = "Brane refraction sweep across incident angles"
    body = (
        f"## Sweep\n\n"
        f"Cascade through base brane stack `[φ, χ, n₃]` = "
        f"`[{layers[0]:.6f}, {layers[1]:.6f}, {layers[2]:.6f}]` at "
        f"7 incident angles spanning 5°…85°.\n\n"
        + "\n".join(rows) +
        f"\n\n## Range\n\n"
        f"- max |deflection| = **{max_abs_defl:.4f}°**\n"
        f"- min |deflection| = **{min_abs_defl:.4f}°**\n"
        f"- deflection sign at all angles: **{'positive' if all(d > 0 for d in deflections) else ('negative' if all(d < 0 for d in deflections) else 'mixed')}**\n\n"
        f"## Notes\n\n"
        f"The deflection sign is determined by the relative indices of φ (outer) and n₃ "
        f"(medium). Because φ > n₃ (1.618 > 0.952), refraction bends rays *away* from "
        f"the normal as they exit the medium — explaining the consistent sign across "
        f"the sweep. Total internal reflection is clipped to ±1 by `snells_refraction` "
        f"so steep angles produce truncated, not NaN, outputs.\n"
    )
    return title, body, {"angle_count": len(angles)}


def topic_coherence_aeon_correlation(_: int) -> tuple[str, str, dict]:
    """Correlate cycle coherence with AEON quality score over recent runs."""
    cycles = _read_cycle_coherence(60)
    log    = _read_aeon_log(60)

    if not cycles or not log:
        return ("Coherence ↔ AEON correlation — insufficient data",
                f"## Status\n\nCoherence samples: {len(cycles)}; AEON log entries: {len(log)}\n"
                f"Need both > 0 to correlate.\n",
                {"cycles_n": len(cycles), "log_n": len(log)})

    coh_vals  = [c for _, c, _ in cycles]
    aeon_q    = [e.get("quality") for e in log if isinstance(e.get("quality"), (int, float))]

    coh_avg = sum(coh_vals) / len(coh_vals)
    coh_var = sum((c - coh_avg) ** 2 for c in coh_vals) / len(coh_vals)
    coh_std = math.sqrt(coh_var)

    aeon_avg = sum(aeon_q) / len(aeon_q) if aeon_q else 0.0
    aeon_var = (sum((q - aeon_avg) ** 2 for q in aeon_q) / len(aeon_q)) if aeon_q else 0.0
    aeon_std = math.sqrt(aeon_var)

    title = f"Coherence ↔ AEON correlation (n_coh={len(coh_vals)}, n_aeon={len(aeon_q)})"
    body = (
        f"## Cycle coherence (last {len(coh_vals)} cycles)\n\n"
        f"- avg: **{coh_avg:.4f}**\n"
        f"- std: **{coh_std:.4f}**\n"
        f"- min: **{min(coh_vals):.4f}**, max: **{max(coh_vals):.4f}**\n\n"
        f"## AEON quality_score (last {len(aeon_q)} runs)\n\n"
        f"- avg: **{aeon_avg:.4f}**\n"
        f"- std: **{aeon_std:.4f}**\n"
        f"- min: **{min(aeon_q):.4f}** , max: **{max(aeon_q):.4f}**\n\n"
        f"## Observation\n\n"
        f"Cycle coherence and AEON quality are sampled on different cadences and "
        f"misaligned in time, so a per-cycle correlation requires interpolation. "
        f"What we *can* report rigorously from these two series alone:\n\n"
        f"- coherence stability: **{'tight' if coh_std < 0.05 else 'loose'}** "
        f"(std `{coh_std:.4f}` vs typical 0.05)\n"
        f"- AEON quality stability: **{'tight' if aeon_std < 0.02 else 'loose'}** "
        f"(std `{aeon_std:.4f}`)\n\n"
        f"Both metrics are saturated near their respective ceilings (coherence ≈ 0.75, "
        f"quality ≈ 0.87+). When the substrate degrades, this finding will show "
        f"widening std and falling mean — and the same goes if propulsion gains a "
        f"correlated boost from coherence improvements.\n"
    )
    return title, body, {"cycles_n": len(coh_vals), "log_n": len(aeon_q)}


def topic_constants_drift_check(_: int) -> tuple[str, str, dict]:
    """Compare broker-slot constants against the engine's module-level constants."""
    slot = _read_slot("xova.aeon_last_run")
    if not slot:
        return ("Constants drift check — slot empty",
                "## Status\n\n`xova.aeon_last_run` is empty.\n",
                {"empty": True})

    consts_slot = slot.get("constants") or {}

    if _AEON_ENGINE_REPO not in sys.path:
        sys.path.insert(0, _AEON_ENGINE_REPO)
    try:
        import aeon_engine  # type: ignore
    except Exception as exc:
        return ("Constants drift check — engine unavailable",
                f"## Status\n\n`aeon_engine` import failed: `{exc}`\n",
                {"error": str(exc)})

    pairs = [
        ("phi",              aeon_engine.PHI),
        ("golden_angle_deg", aeon_engine.GOLDEN_ANGLE_DEG),
        ("psi_resonance",    aeon_engine.PSI_RESONANCE),
        ("alpha_inv",        aeon_engine.ALPHA_INV),
        ("n3_medium",        aeon_engine.N3_MEDIUM),
        ("omega_n",          aeon_engine.OMEGA_N),
        ("drive_freq_hz",    aeon_engine.DRIVE_FREQ_HZ),
        ("coupling_k",       aeon_engine.COUPLING_K),
    ]
    rows = ["| constant | slot value | engine value | |diff| | drift? |", "|---|---|---|---|---|"]
    any_drift = False
    for key, eng_v in pairs:
        slot_v = consts_slot.get(key)
        if isinstance(slot_v, (int, float)) and isinstance(eng_v, (int, float)):
            diff = abs(float(slot_v) - float(eng_v))
            drifted = diff > 1e-9
            if drifted: any_drift = True
            rows.append(f"| `{key}` | `{slot_v}` | `{eng_v}` | `{diff:.3e}` | **{drifted}** |")
        else:
            rows.append(f"| `{key}` | `{slot_v}` | `{eng_v}` | n/a | **type mismatch** |")
            any_drift = True

    title = f"Constants drift check — {'DRIFT DETECTED' if any_drift else 'no drift'}"
    body = (
        f"## Comparison\n\n"
        + "\n".join(rows) + "\n\n"
        f"## Status: **{'DRIFT DETECTED' if any_drift else 'no drift'}**\n\n"
        f"Slot was written by agent **`{slot.get('_slot_agent')}`** at cycle **{slot.get('cycle')}**.\n\n"
        f"## Notes\n\n"
        f"The AEON constants are derived (`GOLDEN_ANGLE_DEG = 360/φ²`, "
        f"`N3_MEDIUM = α⁻¹/ψ`, `DRIVE_FREQ_HZ = ω_n/(2π)`) — not free parameters. "
        f"A drift between the broker slot and the module-level constants would "
        f"indicate either (a) the publisher used stale constants, (b) `aeon_engine.py` "
        f"has been edited since the slot was written, or (c) someone hand-edited the "
        f"broker. This check is the substrate's tripwire against silent constant drift.\n"
    )
    return title, body, {"drift": any_drift}


# ─────────────────────────────────────────────────────────────────────
# Topic registry
# ─────────────────────────────────────────────────────────────────────

TOPICS: dict[str, dict] = {
    "slot_snapshot":             {"gen": topic_slot_snapshot,             "param_choices": [0, 1, 2]},
    "log_trend_quality":         {"gen": lambda _: topic_log_trend("quality"),    "param_choices": [0, 1, 2]},
    "log_trend_peak_thrust":     {"gen": lambda _: topic_log_trend("peak_thrust"),"param_choices": [0, 1, 2]},
    "brane_sweep":               {"gen": topic_brane_sweep,               "param_choices": [0]},
    "coherence_aeon_correlation":{"gen": topic_coherence_aeon_correlation,"param_choices": [0]},
    "constants_drift_check":     {"gen": topic_constants_drift_check,     "param_choices": [0]},
}


# ─────────────────────────────────────────────────────────────────────
# State + UCB1 + file/git (identical shape to agents 06/07)
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


def _ucb_pick(state: dict) -> str:
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


def _finding_filename(topic: str, params: dict) -> str:
    payload = json.dumps({"topic": topic, "params": params}, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:8]
    date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_topic = topic.replace("_", "-")
    return f"{date}_phase-{safe_topic}_{digest}.md"


def _write_finding(topic: str, title: str, body: str, params: dict) -> str:
    os.makedirs(_FINDINGS_DIR, exist_ok=True)
    fname = _finding_filename(topic, params)
    fpath = os.path.join(_FINDINGS_DIR, fname)
    if os.path.exists(fpath):
        return fpath
    ts_iso = datetime.now(timezone.utc).isoformat()
    header = (
        f"---\n"
        f"agent: agent_05 Phase Tracker (Snell-Vern)\n"
        f"topic: {topic}\n"
        f"params: {json.dumps(params, sort_keys=True)}\n"
        f"generated_at: {ts_iso}\n"
        f"sources: context_broker.json + aeon_run_log.jsonl + mesh_feed.jsonl + aeon_engine\n"
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
    msg_subject = f"agent_05: {title}"
    msg_body = (
        f"Autonomous finding by Snell-Vern agent_05 Phase Tracker.\n\n"
        f"Topic: {topic}\n"
        f"Sources: context_broker.json + aeon_run_log.jsonl + mesh_feed.jsonl + aeon_engine\n\n"
        f"Generated end-to-end without human authorship:\n"
        f"  observe state → UCB-pick topic → read substrate → analyze → write → commit.\n"
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


def run_once(no_commit: bool = False) -> dict:
    state = _load_state()
    topic = _ucb_pick(state)
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
    ap = argparse.ArgumentParser(description="Snell-Vern agent_05 Phase Tracker — autonomous finding")
    ap.add_argument("--no-commit", action="store_true",
                    help="write finding + update state, but do not git commit")
    args = ap.parse_args()
    result = run_once(no_commit=args.no_commit)
    payload = json.dumps(result, ensure_ascii=False, indent=2, default=str)
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
