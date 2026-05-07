"""
repo_sync.py — Sprint 11: repo sync audit across Snell-Vern fleet.

Scans all tracked git repos for:
  - dirty working tree (uncommitted changes)
  - unpushed commits (ahead of remote)
  - documentation presence (README.md / README.rst / PAPERS.md)

Health score = 0.60*sync_score + 0.40*docs_score
  sync_score = repos with clean git state / total_repos
  docs_score = repos with docs present / total_repos

Publishes result to context_broker slot xova.repo_sync.
"""
import json
import os
import subprocess
import sys
import time

_BROKER_PATH  = r"C:\Xova\memory\context_broker.json"
_REPO_BASE    = r"D:\github\wizardaax"
_NO_WIN       = 0x08000000

TRACKED_REPOS = [
    "Snell-Vern-Hybrid-Drive-Matrix",
    "recursive-field-math-pro",
    "ziltrix-sch-core",
    "SCE-88",
    "aeon-standards",
    "Codex-AEON-Resonator",
    "xova-agent-01-forge",
    "xova-agent-02-jarvis",
    "xova-agent-03-mesh",
    "xova-agent-04-browser",
    "xova-agent-05-corpus",
    "xova-agent-06-evolution",
    "xova-agent-07-sentinel",
    "xova-agent-08-phase",
    "xova-agent-09-field",
    "xova-agent-10-memory",
    "xova-agent-11-repo",
    "xova-agent-12-voice",
    "xova-agent-13-coherence",
]

_DOC_FILES = ["README.md", "README.rst", "README.txt", "PAPERS.md", "docs/index.md"]


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


def _git_run(args: list, cwd: str) -> str:
    try:
        r = subprocess.run(
            ["git"] + args, cwd=cwd,
            capture_output=True, text=True, timeout=15,
            creationflags=_NO_WIN,
        )
        return r.stdout.strip()
    except Exception:
        return ""


def _check_repo(name: str) -> dict:
    path = os.path.join(_REPO_BASE, name)
    if not os.path.isdir(path):
        return {"name": name, "exists": False, "clean": False, "ahead": 0, "has_docs": False}

    dirty_lines = _git_run(["status", "--short"], path)
    dirty_count = len([l for l in dirty_lines.splitlines() if l.strip()])

    ahead_str = _git_run(["rev-list", "--count", "HEAD...@{u}"], path)
    try:
        ahead = int(ahead_str)
    except (ValueError, TypeError):
        ahead = 0

    last_commit = _git_run(["log", "-1", "--format=%h %s"], path)[:72]
    branch      = _git_run(["branch", "--show-current"], path)

    has_docs = any(
        os.path.isfile(os.path.join(path, df)) for df in _DOC_FILES
    )

    return {
        "name":        name,
        "exists":      True,
        "clean":       dirty_count == 0,
        "dirty":       dirty_count,
        "ahead":       ahead,
        "branch":      branch,
        "last_commit": last_commit,
        "has_docs":    has_docs,
    }


def action_run() -> dict:
    results = [_check_repo(name) for name in TRACKED_REPOS]

    total      = len(results)
    exists     = sum(1 for r in results if r["exists"])
    clean      = sum(1 for r in results if r.get("clean"))
    with_docs  = sum(1 for r in results if r.get("has_docs"))
    dirty_list = [r["name"] for r in results if r["exists"] and not r.get("clean")]
    ahead_list = [r["name"] for r in results if r.get("ahead", 0) > 0]

    sync_score = round(clean / total, 4) if total else 0.0
    docs_score = round(with_docs / total, 4) if total else 0.0
    score      = round(0.60 * sync_score + 0.40 * docs_score, 4)

    payload = {
        "ok":         True,
        "total":      total,
        "exists":     exists,
        "clean":      clean,
        "with_docs":  with_docs,
        "dirty_list": dirty_list,
        "ahead_list": ahead_list,
        "sync_score": sync_score,
        "docs_score": docs_score,
        "score":      score,
        "repos":      results,
        "ts":         time.time(),
    }
    _write_context_slot("xova.repo_sync", payload)
    return payload


def action_status() -> dict:
    try:
        with open(_BROKER_PATH, encoding="utf-8") as f:
            data = json.load(f)
        slot = data.get("slots", {}).get("xova.repo_sync")
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
    # Omit full repos list for concise status output
    if args.action == "status" and result.get("repos"):
        result = {k: v for k, v in result.items() if k != "repos"}
    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
