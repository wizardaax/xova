"""
aeon_publisher.py — sidecar AEON state publisher.

Computes the AEON v2.1 thrust series + v2.1 dynamic gate + quality score
and writes `xova.aeon_last_run` to context_broker.json. Independent of
mesh_runner: works whether the running mesh_runner process has the
Sprint 1 publish path or not. One-shot. Exits when done.

Slot schema mirrors mesh_runner Sprint 1 publish, plus `source: "sidecar"`
so the in-loop publish (when it eventually runs) can be distinguished.

Stdlib only. No rebuild. Read-only against mesh_feed.jsonl for the
v2.1 live-gate history. Writes via the same context_broker.py subprocess
helper mesh_runner uses, so atomic-write semantics are preserved.

Invocation:
    python C:\\Xova\\plugins\\aeon_publisher.py
    python C:\\Xova\\plugins\\aeon_publisher.py --n-steps 10
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

_REPO_ROOT       = r"D:\github\wizardaax\ziltrix-sch-core"
_BROKER_HELPER   = r"C:\Xova\plugins\context_broker.py"
_BROKER_PATH     = r"C:\Xova\memory\context_broker.json"
_MESH_FEED       = r"C:\Xova\memory\mesh_feed.jsonl"
_AEON_LOG        = r"C:\Xova\memory\aeon_run_log.jsonl"

_CYCLE_INTERVAL_S  = 60.0   # mesh_runner cycle period
_COHERENCE_CAP     = 30     # match mesh_runner.COHERENCE_HISTORY_CAP


def _read_coherence_history(cap: int = _COHERENCE_CAP) -> list[float]:
    """Recent cycle_end coherence values, oldest first, capped at `cap`."""
    out: list[float] = []
    if not os.path.exists(_MESH_FEED):
        return out
    try:
        with open(_MESH_FEED, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                if e.get("kind") == "cycle_end":
                    c = e.get("coherence")
                    if isinstance(c, (int, float)):
                        out.append(float(c))
    except Exception:
        return []
    return out[-cap:]


def _read_active_cycle_num() -> int | None:
    """Pull the most recent cycle number from mesh_feed cycle_end content."""
    if not os.path.exists(_MESH_FEED):
        return None
    try:
        with open(_MESH_FEED, encoding="utf-8") as fh:
            tail = fh.readlines()[-200:]
        for line in reversed(tail):
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("kind") == "cycle_end":
                content = str(e.get("content", ""))
                # content begins with "cycle <N> complete ..."
                parts = content.split()
                if len(parts) >= 2 and parts[0] == "cycle" and parts[1].isdigit():
                    return int(parts[1])
    except Exception:
        return None
    return None


def _quality_score(validated: bool, rel_err: float, n_pts: int) -> float:
    """Same formula as mesh_runner Sprint 1+3 inline computation."""
    val_sc = 1.0 if validated else max(0.0, 1.0 - rel_err * 5)
    err_sc = max(0.0, 1.0 - rel_err / 0.1)
    dep_sc = min(1.0, n_pts / 10.0)
    return round(0.4 * val_sc + 0.3 * err_sc + 0.2 * dep_sc + 0.1, 4)


def _write_slot(key: str, value: object, agent: str = "sidecar") -> tuple[bool, str]:
    """Same subprocess pattern as mesh_runner._write_context_slot."""
    try:
        r = subprocess.run(
            [sys.executable, _BROKER_HELPER,
             "--action", "set", "--key", key,
             "--value", json.dumps(value, ensure_ascii=False),
             "--agent", agent],
            capture_output=True, timeout=8, text=True,
        )
        if r.returncode == 0:
            return True, r.stdout.strip()
        return False, (r.stderr or r.stdout or "nonzero rc").strip()
    except Exception as exc:
        return False, f"subprocess error: {exc}"


def _append_run_log(record: dict) -> None:
    """Append one record to aeon_run_log.jsonl, capped at 500 lines."""
    try:
        lines: list[str] = []
        if os.path.exists(_AEON_LOG):
            try:
                with open(_AEON_LOG, encoding="utf-8") as fh:
                    lines = fh.read().splitlines()
            except Exception:
                pass
        lines = lines[-499:]
        lines.append(json.dumps(record, ensure_ascii=False))
        with open(_AEON_LOG, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except Exception:
        pass


def compute_and_publish(n_steps: int = 10) -> dict:
    """Compute AEON v2.1 state, publish to broker, return result dict."""
    if _REPO_ROOT not in sys.path:
        sys.path.insert(0, _REPO_ROOT)

    try:
        import aeon_engine  # type: ignore
    except Exception as exc:
        return {"ok": False, "error": f"aeon_engine import failed: {exc}"}

    samples   = aeon_engine.aeon_thrust_series(n_steps=n_steps)
    series    = [{"t": s.t, "phi": s.phi, "thrust": s.thrust} for s in samples]
    val_raw   = aeon_engine.validate_against_phaseii(samples[:5])
    validated = bool(val_raw.get("matched", False))
    rel_err   = float(val_raw.get("max_rel_err") or 0.0)

    thrusts   = [abs(p["thrust"]) for p in series]
    peak      = max(thrusts) if thrusts else 0.0
    quality   = _quality_score(validated, rel_err, len(series))

    constants = {
        "phi":              aeon_engine.PHI,
        "golden_angle_deg": aeon_engine.GOLDEN_ANGLE_DEG,
        "psi_resonance":    aeon_engine.PSI_RESONANCE,
        "alpha_inv":        aeon_engine.ALPHA_INV,
        "n3_medium":        aeon_engine.N3_MEDIUM,
        "omega_n":          aeon_engine.OMEGA_N,
        "drive_freq_hz":    aeon_engine.DRIVE_FREQ_HZ,
        "coupling_k":       aeon_engine.COUPLING_K,
    }

    history = _read_coherence_history()
    try:
        gate_state = aeon_engine.aeon_gate_from_coherence_history(
            history, dt=_CYCLE_INTERVAL_S
        )
    except Exception:
        gate_state = None

    try:
        summary  = aeon_engine.aeon_summary()
        brane    = summary.get("brane_geometry")
        version  = summary.get("version", "v2.1")
    except Exception:
        brane    = None
        version  = "v2.1"

    cycle_num = _read_active_cycle_num()

    slot = {
        "cycle":                  cycle_num,
        "thrust_n":               series[0]["thrust"] if series else None,
        "thrust_series":          series,
        "validated":              validated,
        "max_rel_err":            rel_err,
        "constants":              constants,
        "quality_score":          quality,
        "peak_thrust":            peak,
        "n_steps":                len(series),
        "version":                version,
        "brane_geometry":         brane,
        "dynamic_gate":           gate_state,
        "dynamic_gate_documented": gate_state,
        "coherence_history_n":    len(history),
        "ts":                     time.time(),
        "source":                 "sidecar",
    }

    ok, msg = _write_slot("xova.aeon_last_run", slot)

    _append_run_log({
        "ts":          slot["ts"],
        "quality":     quality,
        "peak_thrust": peak,
        "n_steps":     len(series),
        "validated":   validated,
        "source":      "sidecar",
    })

    return {
        "ok":             ok,
        "publish_msg":    msg,
        "cycle":          cycle_num,
        "quality_score":  quality,
        "peak_thrust":    peak,
        "n_steps":        len(series),
        "validated":      validated,
        "max_rel_err":    rel_err,
        "history_n":      len(history),
        "version":        version,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="AEON sidecar publisher")
    ap.add_argument("--n-steps", type=int, default=10,
                    help="thrust series length (default 10)")
    args = ap.parse_args()

    result = compute_and_publish(n_steps=args.n_steps)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, default=str, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
