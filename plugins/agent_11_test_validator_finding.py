"""
agent_11_test_validator_finding.py — Snell-Vern agent_11 Test Validator, autonomous.

Third deployment of the autonomous-finding pattern. Unlike agent_06 and agent_07
(which commit findings to ONE repo each), this agent rotates across multiple
target repos. Each topic = one repo's test suite. UCB picks which repo to
validate next.

Each run:
  1. Load central UCB state at C:\\Xova\\memory\\agent_11_test_validator_state.json
  2. UCB-pick next repo
  3. Run pytest in that repo
  4. Parse output: passed / failed / errors / time / failed test names
  5. Write findings/<date>_<topic>_<id>.md to THAT repo
  6. Update state
  7. git-commit to that repo (does NOT push — push is a separate step)

Stdlib only (no pytest-json-report plugin) — parses pytest text output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

_STATE_PATH = r"C:\Xova\memory\agent_11_test_validator_state.json"

_AGENT_NAME  = "Snell-Vern agent_11 Test Validator"
_AGENT_EMAIL = "agent-11-test@xova.local"

# Topic registry — each topic targets one repo's test suite.
TARGETS: dict[str, dict] = {
    "rfm_test_suite": {
        "repo":     r"D:\github\wizardaax\recursive-field-math-pro",
        "pytest_args": ["--tb=short"],
        "label":    "recursive-field-math-pro",
        "library":  "recursive_field_math",
    },
    "snell_vern_test_suite": {
        "repo":     r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix",
        "pytest_args": ["--tb=short"],
        "label":    "Snell-Vern-Hybrid-Drive-Matrix",
        "library":  "snell_vern_matrix",
    },
    "ziltrix_test_suite": {
        "repo":     r"D:\github\wizardaax\ziltrix-sch-core",
        "pytest_args": ["--tb=short"],
        "label":    "ziltrix-sch-core",
        "library":  "aeon_engine",
    },
}


# ─────────────────────────────────────────────────────────────────────
# pytest invocation + output parsing
# ─────────────────────────────────────────────────────────────────────

_TIME_RE     = re.compile(r"\bin\s+([\d.]+)\s*s\b", re.IGNORECASE)
_PASSED_RE   = re.compile(r"\b(\d+)\s+passed\b", re.IGNORECASE)
_FAILED_RE2  = re.compile(r"\b(\d+)\s+failed\b", re.IGNORECASE)
_SKIPPED_RE  = re.compile(r"\b(\d+)\s+skipped\b", re.IGNORECASE)
_ERRORS_RE   = re.compile(r"\b(\d+)\s+errors?\b", re.IGNORECASE)
_WARN_RE     = re.compile(r"\b(\d+)\s+warnings?\b", re.IGNORECASE)

_FAILED_RE  = re.compile(r"^FAILED\s+(\S+)", re.MULTILINE)
_ERROR_RE   = re.compile(r"^ERROR\s+(\S+)", re.MULTILINE)
_COLLECT_RE = re.compile(r"^(\d+)\s+tests?\s+collected", re.MULTILINE)


def _parse_summary(text: str) -> dict:
    """Find the pytest summary line and extract counts + seconds.

    The summary line is the last line containing 'in X.YYs' AND at least one
    of passed/failed/skipped/errors. Walks lines bottom-up.
    """
    out = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0,
           "warnings": 0, "seconds": 0.0}
    for line in reversed(text.splitlines()):
        t = _TIME_RE.search(line)
        if not t:
            continue
        p_passed  = _PASSED_RE.search(line)
        p_failed  = _FAILED_RE2.search(line)
        p_skipped = _SKIPPED_RE.search(line)
        p_errors  = _ERRORS_RE.search(line)
        p_warn    = _WARN_RE.search(line)
        if not (p_passed or p_failed or p_skipped or p_errors):
            continue
        out["seconds"]  = float(t.group(1))
        out["passed"]   = int(p_passed.group(1))  if p_passed  else 0
        out["failed"]   = int(p_failed.group(1))  if p_failed  else 0
        out["skipped"]  = int(p_skipped.group(1)) if p_skipped else 0
        out["errors"]   = int(p_errors.group(1))  if p_errors  else 0
        out["warnings"] = int(p_warn.group(1))    if p_warn    else 0
        break
    return out


def _resolve_python_exe() -> str:
    """Return a console-bound python.exe.

    When invoked via pythonw (e.g. Task Scheduler), sys.executable is the
    windowless pythonw.exe. Tests that subprocess back to sys.executable
    inherit the windowless Python, and any test which captures stdout from
    that subprocess breaks (pythonw has no console-bound stdout). For pytest
    to behave the same under scheduler as under interactive shell, force the
    sibling python.exe.
    """
    exe = sys.executable
    if exe.lower().endswith("pythonw.exe"):
        candidate = exe[:-len("pythonw.exe")] + "python.exe"
        if os.path.exists(candidate):
            return candidate
    return exe


def _run_pytest(repo: str, pytest_args: list[str]) -> dict:
    """Run pytest in repo, return parsed-output dict."""
    started = time.time()
    py_exe = _resolve_python_exe()
    try:
        proc = subprocess.run(
            [py_exe, "-m", "pytest"] + pytest_args,
            cwd=repo, capture_output=True, text=True, timeout=300,
        )
        elapsed = time.time() - started
        combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "error": "pytest timed out after 300s",
            "elapsed": time.time() - started,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"pytest invocation failed: {exc}",
            "elapsed": time.time() - started,
        }

    out_tail = "\n".join(combined.splitlines()[-25:])
    summary = _parse_summary(combined)

    failed_tests  = _FAILED_RE.findall(combined)[:25]
    error_tests   = _ERROR_RE.findall(combined)[:25]
    cm = _COLLECT_RE.search(combined)
    collected = int(cm.group(1)) if cm else None

    return {
        "ok":            True,
        "returncode":    proc.returncode,
        "summary":       summary,
        "collected":     collected,
        "failed_tests":  failed_tests,
        "error_tests":   error_tests,
        "elapsed":       elapsed,
        "tail":          out_tail,
    }


# ─────────────────────────────────────────────────────────────────────
# Finding generator
# ─────────────────────────────────────────────────────────────────────

def topic_test_suite(target_key: str) -> tuple[str, str, dict, str]:
    """Run the test suite for one target repo, return (title, body, params, repo)."""
    target = TARGETS[target_key]
    repo   = target["repo"]
    label  = target["label"]
    lib    = target["library"]
    pyargs = target["pytest_args"]

    result = _run_pytest(repo, pyargs)
    if not result.get("ok"):
        title = f"Test suite — {label} — invocation failed"
        body = (
            f"## Status\n\n"
            f"pytest invocation could not complete.\n\n"
            f"- error: **{result.get('error', '?')}**\n"
            f"- elapsed: **{result.get('elapsed', 0):.2f} s**\n\n"
        )
        return title, body, {"target": target_key, "label": label}, repo

    s        = result["summary"]
    total    = s["passed"] + s["failed"] + s["errors"]
    rc       = result["returncode"]
    elapsed  = result["elapsed"]
    failed   = result["failed_tests"]
    errs     = result["error_tests"]
    collect  = result["collected"]

    health = "GREEN" if (rc == 0 and s["failed"] == 0 and s["errors"] == 0) else (
        "RED" if (s["failed"] or s["errors"]) else "AMBER"
    )

    title = f"Test suite — {label}: {health} ({s['passed']}p / {s['failed']}f / {s['errors']}e in {s['seconds']:.2f}s)"

    body = (
        f"## Status: **{health}**\n\n"
        f"- repo: **`{label}`**\n"
        f"- library: **`{lib}`**\n"
        f"- pytest args: `{' '.join(pyargs)}`\n"
        f"- pytest returncode: **{rc}**\n"
        f"- wall-clock elapsed: **{elapsed:.2f} s**\n\n"
        f"## Summary\n\n"
        f"| metric | value |\n"
        f"|---|---|\n"
        f"| tests collected | **{collect if collect is not None else '?'}** |\n"
        f"| passed   | **{s['passed']}** |\n"
        f"| failed   | **{s['failed']}** |\n"
        f"| skipped  | **{s['skipped']}** |\n"
        f"| errors   | **{s['errors']}** |\n"
        f"| warnings | **{s['warnings']}** |\n"
        f"| pytest reported seconds | **{s['seconds']:.2f} s** |\n\n"
    )

    if failed:
        body += "## Failed tests\n\n"
        for t in failed:
            body += f"- `{t}`\n"
        body += "\n"

    if errs:
        body += "## Errors\n\n"
        for t in errs:
            body += f"- `{t}`\n"
        body += "\n"

    body += (
        f"## Notes\n\n"
        f"Run by Snell-Vern agent_11 Test Validator. Output parsed from pytest "
        f"text (no pytest-json-report dep, stdlib only). The status colour is "
        f"GREEN when returncode=0 AND no failed/errors, RED when failed/errors "
        f"present, AMBER otherwise.\n"
    )

    params = {"target": target_key, "label": label}
    return title, body, params, repo


# ─────────────────────────────────────────────────────────────────────
# State + UCB1
# ─────────────────────────────────────────────────────────────────────

def _load_state() -> dict:
    if not os.path.exists(_STATE_PATH):
        return {
            "version":       1,
            "total_pulls":   0,
            "topic_pulls":   {k: 0 for k in TARGETS},
            "topic_q":       {k: 0.0 for k in TARGETS},
            "history":       [],
        }
    try:
        with open(_STATE_PATH, encoding="utf-8") as fh:
            s = json.load(fh)
        for k in TARGETS:
            s.setdefault("topic_pulls", {}).setdefault(k, 0)
            s.setdefault("topic_q", {}).setdefault(k, 0.0)
        return s
    except Exception:
        return {
            "version": 1, "total_pulls": 0,
            "topic_pulls": {k: 0 for k in TARGETS},
            "topic_q":     {k: 0.0 for k in TARGETS},
            "history":     [],
        }


def _save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(_STATE_PATH), exist_ok=True)
    tmp = _STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, _STATE_PATH)


def _ucb_pick(state: dict) -> str:
    T = max(1, state["total_pulls"])
    best_topic = None
    best_score = -1e18
    for k in TARGETS:
        n = state["topic_pulls"].get(k, 0)
        q = state["topic_q"].get(k, 0.0)
        if n == 0:
            return k
        score = q + math.sqrt(2.0 * math.log(T) / n)
        if score > best_score:
            best_score = score
            best_topic = k
    return best_topic or next(iter(TARGETS))


# ─────────────────────────────────────────────────────────────────────
# File + git
# ─────────────────────────────────────────────────────────────────────

def _finding_filename(topic: str, params: dict) -> str:
    payload = json.dumps({"topic": topic, "params": params}, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:8]
    date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_topic = topic.replace("_", "-")
    return f"{date}_{safe_topic}_{digest}.md"


def _write_finding(repo: str, topic: str, title: str, body: str, params: dict) -> str:
    findings_dir = os.path.join(repo, "findings")
    os.makedirs(findings_dir, exist_ok=True)
    fname = _finding_filename(topic, params)
    fpath = os.path.join(findings_dir, fname)
    if os.path.exists(fpath):
        return fpath
    ts_iso = datetime.now(timezone.utc).isoformat()
    header = (
        f"---\n"
        f"agent: agent_11 Test Validator (Snell-Vern)\n"
        f"topic: {topic}\n"
        f"params: {json.dumps(params, sort_keys=True)}\n"
        f"generated_at: {ts_iso}\n"
        f"tool: pytest 9.x\n"
        f"---\n\n"
        f"# {title}\n\n"
    )
    with open(fpath, "w", encoding="utf-8") as fh:
        fh.write(header + body)
    return fpath


def _git(repo: str, args: list[str]):
    r = subprocess.run(["git"] + args, cwd=repo, capture_output=True, text=True, timeout=30)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def _git_commit(repo: str, file_paths: list[str], topic: str, title: str) -> tuple[bool, str]:
    rels = [os.path.relpath(p, repo).replace("\\", "/") for p in file_paths]
    rc, _, err = _git(repo, ["add"] + rels)
    if rc != 0:
        return False, f"git add failed: {err}"

    msg_subject = f"agent_11: {title}"
    msg_body = (
        f"Autonomous finding by Snell-Vern agent_11 Test Validator.\n"
        f"\n"
        f"Topic: {topic}\n"
        f"Tool: pytest 9.x\n"
        f"\n"
        f"Generated end-to-end without human authorship:\n"
        f"  observe state → UCB-pick repo → run pytest → parse → write → commit.\n"
    )
    r = subprocess.run(
        ["git",
         "-c", f"user.name={_AGENT_NAME}",
         "-c", f"user.email={_AGENT_EMAIL}",
         "commit", "-m", msg_subject, "-m", msg_body],
        cwd=repo, capture_output=True, text=True, timeout=30,
    )
    if r.returncode != 0:
        return False, f"git commit failed: {r.stderr.strip() or r.stdout.strip()}"
    rc, sha, _ = _git(repo, ["rev-parse", "--short", "HEAD"])
    return True, sha if rc == 0 else "(unknown sha)"


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────

def run_once(no_commit: bool = False, target: str | None = None) -> dict:
    state = _load_state()
    topic = target if (target and target in TARGETS) else _ucb_pick(state)

    title, body, params, repo = topic_test_suite(topic)
    fpath = _write_finding(repo, topic, title, body, params)

    state["topic_pulls"][topic] = state["topic_pulls"].get(topic, 0) + 1
    state["total_pulls"] = state.get("total_pulls", 0) + 1
    n = state["topic_pulls"][topic]
    q_prev = state["topic_q"].get(topic, 0.0)
    # Reward 1.0 if GREEN (no failures), 0.5 if AMBER, 0.0 if RED.
    if "GREEN" in title:
        reward = 1.0
    elif "RED" in title:
        reward = 0.0
    else:
        reward = 0.5
    state["topic_q"][topic] = q_prev + (reward - q_prev) / n
    state["history"].append({
        "ts":     time.time(),
        "topic":  topic,
        "repo":   repo,
        "file":   os.path.relpath(fpath, repo).replace("\\", "/"),
        "title":  title,
    })
    state["history"] = state["history"][-200:]
    _save_state(state)

    result = {
        "topic":       topic,
        "repo":        repo,
        "title":       title,
        "file":        os.path.relpath(fpath, repo).replace("\\", "/"),
        "total_pulls": state["total_pulls"],
        "topic_pulls": state["topic_pulls"][topic],
        "reward":      reward,
    }

    if no_commit:
        result["committed"] = False
        result["commit_skipped_reason"] = "--no-commit"
        return result

    ok, info = _git_commit(repo, [fpath], topic, title)
    result["committed"] = ok
    if ok:
        result["commit_sha"] = info
    else:
        result["commit_error"] = info
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Snell-Vern agent_11 Test Validator — autonomous finding")
    ap.add_argument("--no-commit", action="store_true",
                    help="run tests + write finding, do not git commit")
    ap.add_argument("--target", choices=list(TARGETS.keys()),
                    help="force a specific target repo (default: UCB-pick)")
    args = ap.parse_args()
    result = run_once(no_commit=args.no_commit, target=args.target)
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
