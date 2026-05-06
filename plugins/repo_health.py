"""repo_health.py — git health snapshot for all wizardaax repos, returns JSON to stdout."""
import json, os, subprocess, sys

REPOS_ROOT = r"D:\github\wizardaax"


def _git(args: list[str], cwd: str) -> str:
    try:
        r = subprocess.run(
            ["git", "-C", cwd] + args,
            capture_output=True, text=True, timeout=8,
            creationflags=0x08000000,
        )
        return r.stdout.strip()
    except Exception:
        return ""


def repo_info(path: str, name: str) -> dict:
    status = _git(["status", "--short"], path)
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], path)
    log    = _git(["log", "--oneline", "-1"], path)
    dirty_lines = [l for l in status.splitlines() if l.strip()]
    return {
        "name":        name,
        "branch":      branch or "unknown",
        "dirty":       len(dirty_lines) > 0,
        "uncommitted": len(dirty_lines),
        "last_commit": log or "(no commits)",
    }


def main() -> None:
    if not os.path.isdir(REPOS_ROOT):
        print(json.dumps({"error": f"Not found: {REPOS_ROOT}"}))
        sys.exit(1)
    results = []
    for entry in sorted(os.listdir(REPOS_ROOT)):
        full = os.path.join(REPOS_ROOT, entry)
        if os.path.isdir(full) and os.path.exists(os.path.join(full, ".git")):
            results.append(repo_info(full, entry))
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
