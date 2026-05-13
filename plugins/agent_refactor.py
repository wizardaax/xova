"""
agent_refactor.py — autonomous code refinement agent.

Closes the gap documented in [[project_fleet_not_refining_app_2026_05_13]]:
the existing fleet writes math findings + test reports + 3 internal-logic
self-mod patches/day. Nothing actually REFACTORS the app code.

This agent fills that gap with the same governance pattern existing agents
use (Xova-gated, deposit-before-edit, rollback-on-fail, no autonomous push):

  state → UCB-pick a whitelisted file → read it → ask Ollama for ONE
  concrete refactor proposal (JSON) → validate (old_text exact match,
  new_text py_compiles) → gate via self_modifier.action_propose (calls
  persona_governor.consult under the hood) → if approved:
    deposit current file → replace → py_compile check →
      pass: git commit (agent identity, NO push)
      fail: rollback from deposit
  → log to mesh_feed → update state

Daily cap 2. Whitelist starts NARROW (5 small periodic plugins). No daemons.
No frontend. No Rust. Stdlib only.

Per CLAUDE.md:
  - RULE 1 (no rebuild): only Python plugin files; Vite/Tauri untouched
  - RULE 2 (never delete): file replace = deposit + os.replace, never rm
  - RULE 4 (deposit before edit): explicit before every modification
  - RULE 5 (verify): py_compile after apply, rollback on fail
  - RULE 7 (autonomous OK in /loop): no GitHub push — Adam reviews + pushes
  - 100-year contract: stdlib only, no SaaS, no pip deps
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import py_compile
import subprocess
import sys
import time
from datetime import datetime, timezone

# ─── config ──────────────────────────────────────────────────────────────────

_PLUGINS_DIR = r"C:\Xova\plugins"
_MEMORY_DIR  = r"C:\Xova\memory"
_STATE_PATH  = os.path.join(_MEMORY_DIR, "agent_refactor_state.json")
_MESH_FEED   = os.path.join(_MEMORY_DIR, "mesh_feed.jsonl")
_TRASH_KEEPER = r"D:\temp\trash_keeper.py"
_SELF_MOD     = r"C:\Xova\plugins\self_modifier.py"

_AGENT_NAME  = "agent_refactor"
_AGENT_EMAIL = "agent-refactor@xova.local"

# Whitelist — start narrow. Periodic helper plugins, not daemons.
_TARGETS = [
    os.path.join(_PLUGINS_DIR, "corpus_recall.py"),
    os.path.join(_PLUGINS_DIR, "ternary_eval.py"),
    os.path.join(_PLUGINS_DIR, "lucas_phase.py"),
    os.path.join(_PLUGINS_DIR, "ci_health.py"),
    os.path.join(_PLUGINS_DIR, "repo_sync.py"),
]

_DAILY_CAP        = 2
_MIN_BLOCK_LINES  = 3
_MAX_BLOCK_LINES  = 50
_MAX_FILE_BYTES   = 60_000   # don't try to refactor monsters
_OLLAMA_TIMEOUT_S = 120
_OLLAMA_MODEL     = "llama3.2:3b"


# ─── state ───────────────────────────────────────────────────────────────────

def _load_state() -> dict:
    if not os.path.exists(_STATE_PATH):
        return {"version": 1, "attempts": [], "ucb_plays": {}, "today": ""}
    try:
        with open(_STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"version": 1, "attempts": [], "ucb_plays": {}, "today": ""}


def _save_state(state: dict) -> None:
    tmp = _STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False, sort_keys=True)
    os.replace(tmp, _STATE_PATH)


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _todays_attempts(state: dict) -> int:
    today = _today_key()
    return sum(1 for a in state.get("attempts", []) if a.get("date") == today)


# ─── UCB pick ────────────────────────────────────────────────────────────────

def _pick_target(state: dict) -> str:
    """Pick the file with the fewest plays so far. Tie-break by index order."""
    plays = state.get("ucb_plays", {})
    scored = [(plays.get(p, 0), i, p) for i, p in enumerate(_TARGETS) if os.path.exists(p)]
    scored.sort()
    return scored[0][2]


# ─── Ollama ──────────────────────────────────────────────────────────────────

_SYS_PROMPT = (
    "You are a Python refactor agent. Given a file, propose ONE concrete improvement: "
    "performance, clarity, deduplication, or bug fix. Be conservative — small targeted "
    "changes only. PRESERVE behavior. Do not invent new features. Do not change function "
    "signatures unless you're fixing a bug. Output STRICT JSON only — no prose, no markdown.\n\n"
    "Schema: {\"old_text\": \"<EXACT substring from the file, 3-50 lines>\", "
    "\"new_text\": \"<replacement, must py_compile cleanly>\", "
    "\"why\": \"<one short sentence>\", "
    "\"type\": \"perf|clarity|dedup|bugfix\"}\n\n"
    "If no obvious improvement exists, return {}."
)


def _ollama_call(prompt: str) -> str:
    body = json.dumps({
        "model":      _OLLAMA_MODEL,
        "prompt":     prompt,
        "stream":     False,
        "keep_alive": "10m",
        "options":    {"temperature": 0.2, "num_predict": 1024},
    })
    conn = http.client.HTTPConnection("127.0.0.1", 11434, timeout=_OLLAMA_TIMEOUT_S)
    try:
        conn.request("POST", "/api/generate", body=body,
                     headers={"Content-Type": "application/json"})
        r = conn.getresponse()
        if r.status != 200:
            return ""
        data = json.loads(r.read().decode("utf-8", errors="replace"))
        return data.get("response", "")
    except Exception as exc:
        return f"__ollama_error__:{exc}"
    finally:
        conn.close()


def _propose(file_path: str, file_text: str) -> dict | None:
    """Ask Ollama for one refactor proposal. Returns dict or None."""
    user = (
        f"File: {file_path}\n\n"
        f"```python\n{file_text}\n```\n\n"
        "Propose ONE refactor as strict JSON, or return {} if none."
    )
    prompt = f"{_SYS_PROMPT}\n\n{user}\n\nJSON only:"
    raw = _ollama_call(prompt)
    if not raw or raw.startswith("__ollama_error__"):
        return None
    # Extract first JSON object (Ollama sometimes adds preamble despite instructions)
    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    end = -1
    for i in range(start, len(raw)):
        c = raw[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end < 0:
        return None
    try:
        return json.loads(raw[start:end])
    except Exception:
        return None


# ─── validation ──────────────────────────────────────────────────────────────

def _validate(prop: dict, file_text: str) -> tuple[bool, str]:
    if not isinstance(prop, dict) or not prop:
        return False, "empty or non-dict proposal"
    old = prop.get("old_text")
    new = prop.get("new_text")
    why = prop.get("why")
    typ = prop.get("type")
    if not isinstance(old, str) or not isinstance(new, str):
        return False, "old_text/new_text must be strings"
    if not isinstance(why, str) or not isinstance(typ, str):
        return False, "why/type must be strings"
    if typ not in {"perf", "clarity", "dedup", "bugfix"}:
        return False, f"type must be one of perf|clarity|dedup|bugfix (got {typ!r})"
    if old == new:
        return False, "old_text and new_text identical — no-op"
    if old not in file_text:
        return False, "old_text not found verbatim in file"
    if file_text.count(old) > 1:
        return False, "old_text appears multiple times — ambiguous"
    old_lines = old.count("\n") + 1
    if old_lines < _MIN_BLOCK_LINES:
        return False, f"old_text too small ({old_lines} lines, min {_MIN_BLOCK_LINES})"
    if old_lines > _MAX_BLOCK_LINES:
        return False, f"old_text too large ({old_lines} lines, max {_MAX_BLOCK_LINES})"
    return True, "ok"


# ─── Xova gate (via self_modifier.action_propose) ────────────────────────────

def _consult_xova(file_path: str, prop: dict) -> tuple[bool, str, str]:
    """Returns (approved, reason, prop_id). Calls self_modifier.propose which
    in turn invokes persona_governor.consult."""
    description = (
        f"[REFACTOR/{prop['type']}] {prop['why']}\n\n"
        f"---OLD---\n{prop['old_text']}\n"
        f"---NEW---\n{prop['new_text']}\n"
    )
    try:
        r = subprocess.run(
            [sys.executable, _SELF_MOD, "propose",
             "--file", file_path,
             "--description", description,
             "--proposer", _AGENT_NAME],
            capture_output=True, text=True, timeout=180, encoding="utf-8",
        )
        out = r.stdout.strip()
        result = json.loads(out) if out.startswith("{") else {}
        return (
            bool(result.get("approved", False)),
            str(result.get("reason", "no reason returned")),
            str(result.get("id", "")),
        )
    except Exception as exc:
        return False, f"consult failed: {exc}", ""


# ─── deposit + apply ─────────────────────────────────────────────────────────

def _deposit(path: str, reason: str) -> bool:
    try:
        r = subprocess.run(
            [sys.executable, _TRASH_KEEPER, "deposit", "forge", path, reason, "forge"],
            capture_output=True, text=True, timeout=30, encoding="utf-8",
        )
        return r.returncode == 0
    except Exception:
        return False


def _apply(path: str, old: str, new: str) -> bool:
    """Atomic file replacement: read → substring sub → write tmp → os.replace."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        if text.count(old) != 1:
            return False
        text2 = text.replace(old, new, 1)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text2)
        os.replace(tmp, path)
        return True
    except Exception:
        return False


def _restore_from_trash(path: str) -> bool:
    """Restore the most recent deposit of `path` from forge trash."""
    try:
        name = os.path.basename(path)
        index = r"D:\.claude\projects\C--Users-adz-7\trash\index.jsonl"
        if not os.path.exists(index):
            return False
        entries = []
        with open(index, "r", encoding="utf-8") as f:
            for ln in f:
                try:
                    e = json.loads(ln)
                    if e.get("name") == name and e.get("source") == path:
                        entries.append(e)
                except Exception:
                    pass
        if not entries:
            return False
        latest = entries[-1]
        stored = latest.get("stored_path")
        if not stored or not os.path.exists(stored):
            return False
        # Use Python copy rather than shell to keep this stdlib-only.
        import shutil
        shutil.copy2(stored, path)
        return True
    except Exception:
        return False


def _py_compile_ok(path: str) -> tuple[bool, str]:
    try:
        py_compile.compile(path, doraise=True)
        return True, "ok"
    except py_compile.PyCompileError as exc:
        return False, str(exc).strip()
    except Exception as exc:
        return False, f"compile-runner-error: {exc}"


# ─── git commit (NO push) ────────────────────────────────────────────────────

def _git_commit(file_path: str, message: str) -> tuple[bool, str]:
    """Commit a single file.

    Walks up from the file looking for the nearest .git directory; if none
    found, skips committing. Uses agent identity for author. Does NOT push.
    """
    # Walk up to find a .git
    cwd = os.path.dirname(file_path)
    repo = None
    for _ in range(8):
        if os.path.exists(os.path.join(cwd, ".git")):
            repo = cwd
            break
        parent = os.path.dirname(cwd)
        if parent == cwd:
            break
        cwd = parent
    if not repo:
        return False, "no .git ancestor found — skipping commit"
    try:
        rel = os.path.relpath(file_path, repo)
        r = subprocess.run(["git", "add", rel], cwd=repo, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return False, f"git add: {r.stderr.strip()}"
        r = subprocess.run(
            ["git",
             "-c", f"user.name={_AGENT_NAME}",
             "-c", f"user.email={_AGENT_EMAIL}",
             "commit", "-m", message],
            cwd=repo, capture_output=True, text=True, timeout=30,
        )
        if r.returncode != 0:
            err = r.stderr.strip() or r.stdout.strip()
            if "nothing to commit" in err:
                return False, "nothing to commit (probably already clean)"
            return False, f"git commit: {err}"
        return True, r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "committed"
    except Exception as exc:
        return False, f"git error: {exc}"


# ─── mesh_feed log ───────────────────────────────────────────────────────────

def _log(entry_kind: str, content: str) -> None:
    try:
        line = json.dumps({
            "ts": time.time(),
            "kind": entry_kind,
            "agent_id": "RF",
            "label": _AGENT_NAME,
            "content": content[:500],
        }, ensure_ascii=False)
        with open(_MESH_FEED, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ─── main ────────────────────────────────────────────────────────────────────

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="propose + validate + consult only; do not apply.")
    args = ap.parse_args(argv)

    state = _load_state()
    if _todays_attempts(state) >= _DAILY_CAP:
        msg = f"daily cap hit ({_DAILY_CAP}/{_DAILY_CAP}) — skipping"
        print(json.dumps({"ok": False, "reason": msg}))
        _log("agent_refactor_skip", msg)
        return 0

    target = _pick_target(state)
    if not os.path.exists(target):
        msg = f"target missing: {target}"
        print(json.dumps({"ok": False, "reason": msg}))
        return 1

    sz = os.path.getsize(target)
    if sz > _MAX_FILE_BYTES:
        msg = f"target too large ({sz} bytes > {_MAX_FILE_BYTES})"
        print(json.dumps({"ok": False, "reason": msg, "target": target}))
        _log("agent_refactor_skip", msg)
        return 0

    with open(target, "r", encoding="utf-8") as f:
        file_text = f.read()

    _log("agent_refactor_start", f"target={os.path.basename(target)} bytes={sz}")
    prop = _propose(target, file_text)
    if not prop:
        msg = "ollama returned no usable proposal"
        print(json.dumps({"ok": False, "reason": msg, "target": target}))
        _log("agent_refactor_skip", msg)
        return 0
    if prop == {}:
        msg = "no refactor needed (model returned empty {})"
        print(json.dumps({"ok": True, "skipped": True, "reason": msg, "target": target}))
        _log("agent_refactor_skip", msg)
        # Still count a play so UCB rotates targets
        state.setdefault("ucb_plays", {})[target] = state["ucb_plays"].get(target, 0) + 1
        _save_state(state)
        return 0

    ok, why = _validate(prop, file_text)
    if not ok:
        msg = f"validation failed: {why}"
        print(json.dumps({"ok": False, "reason": msg, "target": target}))
        _log("agent_refactor_validate_fail", msg)
        return 0

    approved, reason, prop_id = _consult_xova(target, prop)
    if not approved:
        msg = f"Xova vetoed: {reason}"
        print(json.dumps({"ok": True, "approved": False, "reason": reason, "id": prop_id}))
        _log("agent_refactor_vetoed", f"{prop['type']}: {reason}"[:200])
        state.setdefault("attempts", []).append({
            "date": _today_key(), "ts": time.time(), "target": target,
            "type": prop["type"], "approved": False, "reason": reason, "id": prop_id,
        })
        state.setdefault("ucb_plays", {})[target] = state["ucb_plays"].get(target, 0) + 1
        _save_state(state)
        return 0

    if args.dry_run:
        msg = "approved (dry-run, not applied)"
        print(json.dumps({"ok": True, "approved": True, "dry_run": True, "id": prop_id}))
        _log("agent_refactor_dryrun", f"{prop['type']}: would apply")
        return 0

    # Apply path: deposit → replace → py_compile → commit (or rollback)
    if not _deposit(target, f"agent_refactor pre-apply (prop {prop_id})"):
        msg = "deposit failed — aborting"
        print(json.dumps({"ok": False, "reason": msg}))
        _log("agent_refactor_deposit_fail", msg)
        return 1

    if not _apply(target, prop["old_text"], prop["new_text"]):
        msg = "apply failed — restoring"
        print(json.dumps({"ok": False, "reason": msg}))
        _restore_from_trash(target)
        _log("agent_refactor_apply_fail", msg)
        return 1

    compile_ok, compile_msg = _py_compile_ok(target)
    if not compile_ok:
        _restore_from_trash(target)
        msg = f"py_compile failed → rolled back: {compile_msg[:200]}"
        print(json.dumps({"ok": False, "reason": msg}))
        _log("agent_refactor_compile_fail", msg)
        state.setdefault("attempts", []).append({
            "date": _today_key(), "ts": time.time(), "target": target,
            "type": prop["type"], "approved": True, "applied": False,
            "rollback_reason": "py_compile", "id": prop_id,
        })
        state.setdefault("ucb_plays", {})[target] = state["ucb_plays"].get(target, 0) + 1
        _save_state(state)
        return 0

    commit_msg = f"agent_refactor [{prop['type']}] {os.path.basename(target)}: {prop['why']}"
    committed, commit_out = _git_commit(target, commit_msg)
    state.setdefault("attempts", []).append({
        "date": _today_key(), "ts": time.time(), "target": target,
        "type": prop["type"], "approved": True, "applied": True,
        "committed": committed, "commit_msg": commit_out, "id": prop_id,
    })
    state.setdefault("ucb_plays", {})[target] = state["ucb_plays"].get(target, 0) + 1
    _save_state(state)

    print(json.dumps({
        "ok": True, "approved": True, "applied": True,
        "committed": committed, "id": prop_id,
        "commit": commit_out, "target": target, "type": prop["type"],
    }))
    _log("agent_refactor_applied",
         f"{prop['type']} {os.path.basename(target)}: {prop['why'][:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
