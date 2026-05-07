"""
agent_evolve.py — Autonomous agent code-writing and self-evolution loop.

Each agent calls this to:
  1. Read its domain state from context_broker + its outbox
  2. WRITE Python evaluation code specific to what it's observing right now
  3. Execute that code in a subprocess sandbox
  4. Analyse the output for gaps/anomalies
  5. Submit a self-mod proposal via self_modifier.py if a gap is found

This is the difference between calling a plugin and being an agent:
the agent writes the code itself, from scratch, based on what it sees.

Usage:
  python agent_evolve.py --agent coherence --domain rff_coherence
  python agent_evolve.py --agent phase     --domain lucas_phi
  python agent_evolve.py --agent field     --domain spiral_geometry
  python agent_evolve.py --agent sentinel  --domain sce88_constraint
  python agent_evolve.py --agent memory    --domain context_slots
  python agent_evolve.py --agent corpus    --domain knowledge_coverage
  python agent_evolve.py --agent repo      --domain ci_health

Stdlib only. No network. 100-year rule.
"""
from __future__ import annotations
import argparse, hashlib, json, os, subprocess, sys, tempfile, time

CONTEXT_BROKER  = r"C:\Xova\memory\context_broker.json"
SELF_MODIFIER   = r"C:\Xova\plugins\self_modifier.py"
FORGE_REPORT    = r"C:\Xova\plugins\forge_report.py"
ACTION_TRACE    = r"C:\Xova\plugins\action_trace_write.py"
NO_WIN          = 0x08000000
SANDBOX_TIMEOUT = 30  # seconds


def _read_broker() -> dict:
    try:
        with open(CONTEXT_BROKER, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _broker_slot(broker: dict, key: str) -> object:
    return broker.get("slots", {}).get(key, {}).get("value")


def _run_sandbox(code: str) -> tuple[bool, str]:
    """Write code to a temp file and execute it in a fresh Python process."""
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py",
                                         encoding="utf-8", delete=False) as f:
            f.write(code)
            tmp_path = f.name
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True, text=True, timeout=SANDBOX_TIMEOUT,
            creationflags=NO_WIN, encoding="utf-8",
        )
        output = (result.stdout + result.stderr).strip()
        return result.returncode == 0, output
    except subprocess.TimeoutExpired:
        return False, f"sandbox timed out after {SANDBOX_TIMEOUT}s"
    except Exception as exc:
        return False, f"sandbox error: {exc}"
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def _report(agent: str, text: str) -> None:
    try:
        subprocess.run([sys.executable, FORGE_REPORT,
                        "--text", text[:300], "--from", agent],
                       capture_output=True, timeout=10, creationflags=NO_WIN)
    except Exception:
        pass


def _trace(action: str, plugin: str, summary: str) -> None:
    try:
        subprocess.run([sys.executable, ACTION_TRACE,
                        "--action", action, "--plugin", plugin,
                        "--summary", summary[:200]],
                       capture_output=True, timeout=10, creationflags=NO_WIN)
    except Exception:
        pass


def _propose(agent: str, filepath: str, description: str) -> dict:
    try:
        r = subprocess.run(
            [sys.executable, SELF_MODIFIER,
             "--action", "propose",
             "--file", filepath,
             "--description", description,
             "--proposer", agent],
            capture_output=True, text=True, timeout=15,
            creationflags=NO_WIN, encoding="utf-8",
        )
        return json.loads(r.stdout.strip()) if r.stdout.strip() else {}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Domain code generators ────────────────────────────────────────────────────
# Each function receives current broker state and returns Python source code
# that the agent WROTE to evaluate its domain.

def _gen_coherence_eval(broker: dict) -> str:
    cycles = _broker_slot(broker, "agents.last_cycles") or []
    ternary = _broker_slot(broker, "xova.ternary_eval") or {}
    return f"""
import json, math, time

cycles = {json.dumps(cycles)}
ternary = {json.dumps(ternary)}

# Coherence agent self-written evaluation
# Compute rolling coherence trend from last N cycles
cohs = [c.get('avg_coherence', 0) for c in cycles]
if cohs:
    mean = sum(cohs) / len(cohs)
    variance = sum((c - mean)**2 for c in cohs) / len(cohs)
    stdev = math.sqrt(variance)
    trend = cohs[-1] - cohs[0] if len(cohs) > 1 else 0.0
    gated_total = sum(c.get('gated', 0) for c in cycles)
else:
    mean = stdev = trend = 0.0
    gated_total = 0

ternary_score = ternary.get('score', 0) if ternary else 0
ternary_ok = ternary.get('balance_ok', False) if ternary else False

# Gap detection
gaps = []
if mean < 0.5:
    gaps.append(f"avg_coherence {{mean:.3f}} below 0.5 floor")
if stdev > 0.15:
    gaps.append(f"coherence stdev {{stdev:.3f}} high — unstable")
if trend < -0.1:
    gaps.append(f"coherence trending down {{trend:.3f}}")
if gated_total > 0:
    gaps.append(f"{{gated_total}} gated outputs this window")
if not ternary_ok:
    gaps.append("ternary balance failing")

result = {{
    "agent": "coherence",
    "n_cycles": len(cohs),
    "avg_coherence": round(mean, 4),
    "stdev": round(stdev, 4),
    "trend": round(trend, 4),
    "gated_total": gated_total,
    "ternary_score": ternary_score,
    "gaps": gaps,
    "healthy": len(gaps) == 0,
}}
print(json.dumps(result))
"""


def _gen_phase_eval(broker: dict) -> str:
    lucas = _broker_slot(broker, "xova.lucas_phase") or {}
    cycles = _broker_slot(broker, "agents.last_cycles") or []
    return f"""
import json, math

lucas = {json.dumps(lucas)}
cycles = {json.dumps(cycles)}

# Phase agent self-written evaluation
# Check Lucas convergence health + phase drift
phi = (1 + math.sqrt(5)) / 2
reported_ratio = lucas.get('final_ratio', 0) if lucas else 0
conv_err = abs(reported_ratio - phi) if reported_ratio else 1.0
conv_score = lucas.get('conv_score', 0) if lucas else 0
binet_ok = lucas.get('binet_ok', False) if lucas else False

# Phase task frequency in recent cycles
phase_tasks = [c for c in cycles
               if 'phase' in c.get('task_types', [])]
phase_rate = len(phase_tasks) / max(len(cycles), 1)

gaps = []
if conv_err > 1e-6:
    gaps.append(f"Lucas convergence error {{conv_err:.2e}} above tolerance")
if not binet_ok:
    gaps.append("Binet formula verification failed")
if phase_rate < 0.1 and len(cycles) >= 5:
    gaps.append(f"Phase tasks only {{phase_rate:.0%}} of recent cycles — underrepresented")
if conv_score < 0.9:
    gaps.append(f"conv_score {{conv_score:.3f}} below 0.9")

result = {{
    "agent": "phase",
    "phi": phi,
    "reported_ratio": reported_ratio,
    "conv_err": conv_err,
    "conv_score": conv_score,
    "binet_ok": binet_ok,
    "phase_task_rate": round(phase_rate, 3),
    "gaps": gaps,
    "healthy": len(gaps) == 0,
}}
print(json.dumps(result))
"""


def _gen_field_eval(broker: dict) -> str:
    field = _broker_slot(broker, "xova.field_weave") or {}
    ternary = _broker_slot(broker, "xova.ternary_eval") or {}
    return f"""
import json, math

field = {json.dumps(field)}
ternary = {json.dumps(ternary)}

# Field agent self-written evaluation
GOLDEN_DEG_EXPECTED = 137.50776405003785
golden_deg = field.get('golden_deg', 0) if field else 0
angle_err = abs(golden_deg - GOLDEN_DEG_EXPECTED)
coh_score = field.get('coh_score', 0) if field else 0
radial_score = field.get('radial_score', 0) if field else 0
angle_fid = field.get('angle_fid', 0) if field else 0

# Ternary balance check
balance = ternary.get('ternary_balance', 0) if ternary else 0
gate_rate = ternary.get('gate_rate', 0) if ternary else 0

gaps = []
if angle_err > 0.001:
    gaps.append(f"golden angle error {{angle_err:.4f}} deg — drift detected")
if coh_score < 0.8:
    gaps.append(f"field coh_score {{coh_score:.3f}} below 0.8")
if radial_score < 0.8:
    gaps.append(f"radial_score {{radial_score:.3f}} below 0.8")
if balance < 0.5:
    gaps.append(f"ternary_balance {{balance:.3f}} below 0.5")
if gate_rate < 1.0:
    gaps.append(f"ternary gate_rate {{gate_rate:.3f}} — some gates failing")

result = {{
    "agent": "field",
    "golden_deg": golden_deg,
    "angle_err": round(angle_err, 6),
    "coh_score": coh_score,
    "radial_score": radial_score,
    "angle_fid": angle_fid,
    "ternary_balance": balance,
    "gate_rate": gate_rate,
    "gaps": gaps,
    "healthy": len(gaps) == 0,
}}
print(json.dumps(result))
"""


def _gen_sentinel_eval(broker: dict) -> str:
    ci = _broker_slot(broker, "xova.ci_health") or {}
    violations_path = r"C:\Xova\memory\sentinel_violations.jsonl"
    return f"""
import json, os, time

ci = {json.dumps(ci)}
violations_path = r{repr(violations_path)}

# Sentinel agent self-written evaluation
pass_rate = ci.get('pass_rate', 0) if ci else 0
total_passed = ci.get('total_passed', 0) if ci else 0
total_failed = ci.get('total_failed', 0) if ci else 0
ci_ts = ci.get('ts', 0) if ci else 0
ci_age_h = (time.time() - ci_ts) / 3600 if ci_ts else 999

# Count recent violations (last hour)
recent_viols = 0
now = time.time()
try:
    with open(violations_path, encoding='utf-8') as f:
        for line in f:
            try:
                v = json.loads(line)
                if now - v.get('ts', 0) < 3600:
                    source = v.get('source', '')
                    if 'test' not in source:
                        recent_viols += 1
            except Exception:
                pass
except FileNotFoundError:
    pass

gaps = []
if pass_rate < 1.0:
    gaps.append(f"CI pass_rate {{pass_rate:.3f}} — {{total_failed}} failures")
if ci_age_h > 2:
    gaps.append(f"CI health data {{ci_age_h:.1f}}h old — stale")
if recent_viols > 0:
    gaps.append(f"{{recent_viols}} SCE-88 violations in last hour")

result = {{
    "agent": "sentinel",
    "ci_pass_rate": pass_rate,
    "ci_total_passed": total_passed,
    "ci_total_failed": total_failed,
    "ci_age_h": round(ci_age_h, 2),
    "recent_violations": recent_viols,
    "gaps": gaps,
    "healthy": len(gaps) == 0,
}}
print(json.dumps(result))
"""


def _gen_memory_eval(broker: dict) -> str:
    slots = broker.get("slots", {})
    return f"""
import json, time

slot_count = {len(slots)}
slot_keys = {json.dumps(list(slots.keys()))}

# Memory agent self-written evaluation
# Audit slot health: stale, orphaned, missing critical
now = time.time()
critical_slots = [
    'forge.current_task', 'agents.last_cycles', 'xova.ternary_eval',
    'xova.ci_health', 'federation.heartbeat', 'xova.corpus_recall',
]
broker_raw = {json.dumps(slots)}

missing = [s for s in critical_slots if s not in broker_raw]
stale = []
for key, val in broker_raw.items():
    if isinstance(val, dict):
        ts = val.get('ts', val.get('updated_at', 0))
        if ts and now - ts > 7200:
            stale.append(key)

gaps = []
if missing:
    gaps.append(f"missing critical slots: {{', '.join(missing)}}")
if len(stale) > 3:
    gaps.append(f"{{len(stale)}} slots stale >2h: {{', '.join(stale[:3])}}...")

result = {{
    "agent": "memory",
    "slot_count": slot_count,
    "critical_present": len(critical_slots) - len(missing),
    "missing_critical": missing,
    "stale_slots": len(stale),
    "gaps": gaps,
    "healthy": len(gaps) == 0,
}}
print(json.dumps(result))
"""


def _gen_corpus_eval(broker: dict) -> str:
    corpus = _broker_slot(broker, "xova.corpus_recall") or {}
    return f"""
import json

corpus = {json.dumps(corpus)}

# Corpus agent self-written evaluation
total = corpus.get('total', 0) if corpus else 0
coverage = corpus.get('coverage', 0) if corpus else 0
freshness = corpus.get('freshness', 0) if corpus else 0
score = corpus.get('score', 0) if corpus else 0
top_exts = corpus.get('top_exts', []) if corpus else []
top_roots = corpus.get('top_roots', []) if corpus else []

# Check ext diversity
n_types = len(top_exts)
jpg_count = next((n for e, n in top_exts if e == '.jpg'), 0)
jpg_ratio = jpg_count / max(total, 1)

gaps = []
if coverage < 0.95:
    gaps.append(f"corpus coverage {{coverage:.3f}} below 0.95")
if freshness < 0.8:
    gaps.append(f"freshness {{freshness:.3f}} — corpus not refreshed recently")
if score < 0.7:
    gaps.append(f"corpus score {{score:.3f}} below 0.7")
if jpg_ratio > 0.8:
    gaps.append(f"{{jpg_ratio:.0%}} of corpus is .jpg — low text coverage")

result = {{
    "agent": "corpus",
    "total": total,
    "coverage": coverage,
    "freshness": freshness,
    "score": score,
    "n_ext_types": n_types,
    "jpg_ratio": round(jpg_ratio, 3),
    "gaps": gaps,
    "healthy": len(gaps) == 0,
}}
print(json.dumps(result))
"""


def _gen_repo_eval(broker: dict) -> str:
    ci = _broker_slot(broker, "xova.ci_health") or {}
    repo_sync = _broker_slot(broker, "xova.repo_sync") or {}
    return f"""
import json

ci = {json.dumps(ci)}
repo_sync = {json.dumps(repo_sync)}

# Repo agent self-written evaluation
pass_rate = ci.get('pass_rate', 0) if ci else 0
repos = ci.get('repos', []) if ci else []
failed_repos = [r['name'] for r in repos if not r.get('ok', True)]

sync_score = repo_sync.get('sync_score', 0) if repo_sync else 0
ahead_list = repo_sync.get('ahead_list', []) if repo_sync else []
dirty_list = repo_sync.get('dirty_list', []) if repo_sync else []

gaps = []
if failed_repos:
    gaps.append(f"CI failing repos: {{', '.join(failed_repos)}}")
if ahead_list:
    gaps.append(f"{{len(ahead_list)}} repos ahead of origin: {{', '.join(ahead_list)}}")
if dirty_list:
    gaps.append(f"{{len(dirty_list)}} repos with uncommitted changes")
if sync_score < 0.9:
    gaps.append(f"repo sync_score {{sync_score:.3f}} below 0.9")

result = {{
    "agent": "repo",
    "ci_pass_rate": pass_rate,
    "failed_repos": failed_repos,
    "ahead_repos": ahead_list,
    "dirty_repos": dirty_list,
    "sync_score": sync_score,
    "gaps": gaps,
    "healthy": len(gaps) == 0,
}}
print(json.dumps(result))
"""


_GENERATORS = {
    "coherence": _gen_coherence_eval,
    "phase":     _gen_phase_eval,
    "field":     _gen_field_eval,
    "sentinel":  _gen_sentinel_eval,
    "memory":    _gen_memory_eval,
    "corpus":    _gen_corpus_eval,
    "repo":      _gen_repo_eval,
}


def run(agent: str, domain: str) -> dict:
    broker = _read_broker()
    gen = _GENERATORS.get(agent)
    if not gen:
        return {"ok": False, "error": f"no code generator for agent '{agent}'"}

    code = gen(broker)
    ok, output = _run_sandbox(code)

    result: dict = {"ok": ok, "agent": agent, "domain": domain, "raw": output}
    try:
        parsed = json.loads(output)
        result["eval"] = parsed
        gaps = parsed.get("gaps", [])
        result["gaps"] = gaps
        result["healthy"] = parsed.get("healthy", True)
    except Exception:
        gaps = []
        result["gaps"] = []
        result["healthy"] = ok

    # Report to Xova
    gap_str = f" GAPS: {'; '.join(gaps[:2])}" if gaps else " healthy"
    _report(f"{agent}_agent",
            f"{agent} self-eval:{gap_str}")
    _trace("run", f"agent_evolve.{agent}", f"{agent} wrote+ran eval code: {len(gaps)} gaps found")

    # Submit self-mod proposal if gaps found
    if gaps:
        plugin_map = {
            "coherence": r"C:\Xova\plugins\rff_score.py",
            "phase":     r"C:\Xova\plugins\lucas_phase.py",
            "field":     r"C:\Xova\plugins\field_weave.py",
            "sentinel":  r"C:\Xova\plugins\sce88_gate.py",
            "memory":    r"C:\Xova\plugins\context_broker.py",
            "corpus":    r"C:\Xova\plugins\corpus_recall.py",
            "repo":      r"C:\Xova\plugins\ci_health.py",
        }
        target = plugin_map.get(agent, "")
        if target:
            desc = f"{agent} self-eval found gaps: {'; '.join(gaps[:3])}"
            proposal = _propose(agent, target, desc)
            result["proposal"] = proposal

    return result


def main() -> None:
    ap = argparse.ArgumentParser(description="Agent self-writing eval + evolution loop")
    ap.add_argument("--agent",  required=True, choices=list(_GENERATORS.keys()))
    ap.add_argument("--domain", default="auto")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    out = run(args.agent, args.domain)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
