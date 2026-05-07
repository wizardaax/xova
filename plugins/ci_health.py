"""
ci_health.py — CI/test-suite health scanner for the Snell-Vern fleet.

Runs pytest on key repos (non-interactively), parses results, publishes
to context_broker as xova.ci_health. Called by mesh_runner every
CI_EVERY_N cycles and available as a standalone CLI.

Health score (0-1):
  pass_rate = passed / total  (total = passed + failed + errors)
  score     = pass_rate * (1.0 if no errors else 0.7)

Output: { ok, repos, total_passed, total_failed, total_errors,
          score, duration_s, ts }
"""
import json, os, re, subprocess, sys, time

_BROKER_PATH = r"C:\Xova\memory\context_broker.json"
_NO_WIN      = 0x08000000

REPOS = [
    {
        "name":  "Snell-Vern-Matrix",
        "path":  r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix",
        "flags": ["--tb=no", "-q"],
    },
    {
        "name":  "ziltrix-sch-core",
        "path":  r"D:\github\wizardaax\ziltrix-sch-core",
        "flags": ["--tb=no", "tests/"],
    },
    {
        "name":  "recursive-field-math-pro",
        "path":  r"D:\github\wizardaax\recursive-field-math-pro",
        "flags": ["--tb=no", "-q"],
    },
]

_RESULT_RE = re.compile(
    r"(\d+)\s+passed"
    r"(?:,\s+(\d+)\s+failed)?"
    r"(?:,\s+(\d+)\s+error)?"
    r".*?in\s+([\d.]+)s"
)
_FAILED_RE = re.compile(r"(\d+)\s+failed")
_ERROR_RE  = re.compile(r"(\d+)\s+error")
_PASSED_RE = re.compile(r"(\d+)\s+passed")


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


def _run_pytest(repo: dict) -> dict:
    if not os.path.isdir(repo["path"]):
        return {"name": repo["name"], "ok": False, "error": "path not found",
                "passed": 0, "failed": 0, "errors": 0, "duration_s": 0.0}
    t0 = time.time()
    try:
        r = subprocess.run(
            [sys.executable, "-m", "pytest"] + repo["flags"],
            capture_output=True, text=True,
            cwd=repo["path"], timeout=120,
            creationflags=_NO_WIN, encoding="utf-8", errors="replace",
        )
        out = r.stdout + r.stderr
        dur = round(time.time() - t0, 2)

        m   = _RESULT_RE.search(out)
        if m:
            passed   = int(m.group(1))
            failed   = int(m.group(2) or 0)
            errors   = int(m.group(3) or 0)
            dur      = float(m.group(4))
        else:
            passed   = int((_PASSED_RE.search(out) or type("_", (), {"group": lambda s, n: "0"})()).group(1))
            failed   = int((_FAILED_RE.search(out) or type("_", (), {"group": lambda s, n: "0"})()).group(1))
            errors   = int((_ERROR_RE.search(out)  or type("_", (), {"group": lambda s, n: "0"})()).group(1))

        return {
            "name":       repo["name"],
            "ok":         True,
            "passed":     passed,
            "failed":     failed,
            "errors":     errors,
            "duration_s": dur,
            "exit_code":  r.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"name": repo["name"], "ok": False, "error": "timeout",
                "passed": 0, "failed": 0, "errors": 0, "duration_s": round(time.time() - t0, 2)}
    except Exception as exc:
        return {"name": repo["name"], "ok": False, "error": str(exc)[:80],
                "passed": 0, "failed": 0, "errors": 0, "duration_s": round(time.time() - t0, 2)}


def action_run() -> dict:
    results = [_run_pytest(repo) for repo in REPOS]
    total_p = sum(r.get("passed", 0) for r in results)
    total_f = sum(r.get("failed", 0) for r in results)
    total_e = sum(r.get("errors", 0) for r in results)
    total   = total_p + total_f + total_e
    dur     = sum(r.get("duration_s", 0.0) for r in results)

    pass_rate = total_p / total if total else 1.0
    has_err   = any(r.get("errors", 0) > 0 or r.get("failed", 0) > 0 for r in results)
    score     = round(pass_rate * (0.7 if has_err else 1.0), 4)

    payload = {
        "ok":            True,
        "repos":         results,
        "total_passed":  total_p,
        "total_failed":  total_f,
        "total_errors":  total_e,
        "score":         score,
        "pass_rate":     round(pass_rate, 4),
        "duration_s":    round(dur, 2),
        "ts":            time.time(),
    }
    _write_context_slot("xova.ci_health", payload)
    return payload


def action_status() -> dict:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        slot = data.get("slots", {}).get("xova.ci_health")
        if slot:
            return {"ok": True, "cached": True, **slot}
    except Exception:
        pass
    return {"ok": True, "cached": False, "score": None, "total_passed": 0,
            "total_failed": 0, "total_errors": 0}


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
