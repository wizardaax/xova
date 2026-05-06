"""
absorb_loop.py — Autonomous absorb-refine-discard loop.

Background process managed by xova_watchdog.py. On each cycle:
  1. Absorb  — read new lines from source files since last cursor position
  2. Refine  — ask Ollama to rate significance and extract a one-sentence finding
  3. Surface — if significance >= THRESHOLD, write finding to voice_inbox.json
               (role="absorb") so Xova displays it in chat
  4. Discard — deposit processed batch to absorb trash via trash_keeper.py
               (never deletes; full audit trail)

Minimum viable version: sources = forge_events.jsonl + mesh_feed.jsonl.
Full version (corpus, sessions, multi-agent, heavier model) waits for server.

NOTE — App.tsx: voice_inbox role="absorb" currently renders as a green
🎙 jarvis bubble. Add an isAbsorbBubble check (role === "absorb") in the
voice_inbox polling block to give it its own label/colour. Deferred.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import re
import urllib.request

# ── Singleton guard ──────────────────────────────────────────────────────────
def _already_running() -> bool:
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe' OR name='python.exe'\" "
             "| Select-Object -ExpandProperty CommandLine"],
            capture_output=True, text=True, timeout=10,
            creationflags=0x08000000,
        )
        siblings = [l for l in result.stdout.splitlines() if "absorb_loop" in l]
        return len(siblings) > 1
    except Exception:
        return False

if _already_running():
    sys.exit(0)
# ────────────────────────────────────────────────────────────────────────────

POLL_SEC             = 120          # cycle interval — don't chew CPU alongside Ollama + Xova
SIGNIFICANCE_THRESHOLD = 5          # conservative start — only max-significance surfaces
OLLAMA_URL           = "http://localhost:11434/api/generate"
OLLAMA_MODEL         = "llama3.2:3b"
OLLAMA_TIMEOUT       = 90           # seconds
OLLAMA_LOCK_FILE     = r"C:\Xova\memory\ollama.lock"
OLLAMA_LOCK_TIMEOUT  = 30           # seconds — give up and skip if Ollama is busy this long
OLLAMA_LOCK_POLL     = 0.25         # seconds between lock-acquire polls

FORGE_EVENTS         = r"C:\Xova\memory\forge_events.jsonl"
MESH_FEED            = r"C:\Xova\memory\mesh_feed.jsonl"
VOICE_INBOX          = r"C:\Xova\memory\voice_inbox.json"
AGENT_BOARD          = r"C:\Xova\memory\agent_board.json"
CURSORS_FILE         = r"C:\Xova\memory\absorb_cursors.json"
ABSORB_LOG           = r"C:\Xova\memory\absorb_log.jsonl"
WORKING_FILE         = r"C:\Xova\memory\absorb_working.json"
LOG_PATH             = r"C:\Xova\memory\absorb_loop.log"
TRASH_KEEPER         = r"D:\temp\trash_keeper.py"
TRASH_AGENT          = "absorb"
LOG_CAP              = 200
ABSORB_LOG_CAP       = 500
STATE_FILE           = r"C:\Xova\memory\absorb_state.json"
TWO_STRIKE_WINDOW    = 3    # prior strike expires after this many cycles of quiet
MAX_LINES_PER_EVAL   = 20           # cap digest sent to Ollama to keep prompt small
NO_WIN               = 0x08000000

_last_board_at: float = 0.0
_cycle_count:   int   = 0


# ── Ollama file-based semaphore ───────────────────────────────────────────────
# Shared lock file: C:\Xova\memory\ollama.lock
# All Python callers (absorb_loop, Jarvis voice path) serialise through this
# file so they never hammer Ollama simultaneously.
#
# Protocol (pure stdlib, Windows-safe):
#   _ollama_lock_acquire()  → True on success, False on timeout
#   _ollama_lock_release()  → always safe to call
#
# Lock file contains: {"pid": <int>, "owner": "<str>", "ts": <float>}
# A stale lock (owner process no longer alive) is stolen after OLLAMA_LOCK_TIMEOUT.
#
# Implementation note: os.O_CREAT | os.O_EXCL is atomic on NTFS — the kernel
# guarantees exactly one creator even under concurrent writers. No msvcrt /
# fcntl needed. Pure stdlib.

def _pid_alive(pid: int) -> bool:
    """Return True if a process with this PID is currently running."""
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             f"Get-Process -Id {pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"],
            capture_output=True, text=True, timeout=5,
            creationflags=NO_WIN,
        )
        return str(pid) in result.stdout
    except Exception:
        return True   # assume alive on error — don't steal lock speculatively


def _ollama_lock_acquire(owner: str = "absorb_loop") -> bool:
    """
    Try to acquire the Ollama file lock. Polls every OLLAMA_LOCK_POLL seconds
    up to OLLAMA_LOCK_TIMEOUT seconds. Returns True on success, False on timeout.
    Steals stale locks from dead processes.
    """
    deadline = time.monotonic() + OLLAMA_LOCK_TIMEOUT
    lock_dir = os.path.dirname(OLLAMA_LOCK_FILE)
    try:
        os.makedirs(lock_dir, exist_ok=True)
    except Exception:
        pass

    my_pid = os.getpid()

    while time.monotonic() < deadline:
        # Attempt atomic create — succeeds only if file does not exist yet.
        try:
            fd = os.open(OLLAMA_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            payload = json.dumps(
                {"pid": my_pid, "owner": owner, "ts": time.time()},
                ensure_ascii=False,
            ).encode("utf-8")
            os.write(fd, payload)
            os.close(fd)
            return True   # we created it — lock acquired
        except FileExistsError:
            pass          # someone else holds it — inspect below
        except Exception as exc:
            _log(f"lock acquire unexpected error: {exc}")
            return False  # can't acquire — skip this cycle

        # Lock file exists. Read it and check for a stale lock.
        try:
            with open(OLLAMA_LOCK_FILE, "r", encoding="utf-8") as fh:
                info = json.load(fh)
            holder_pid = int(info.get("pid", -1))
            if holder_pid != my_pid and not _pid_alive(holder_pid):
                # Holder process is dead — steal the lock.
                # Unlink then re-create atomically.
                try:
                    os.unlink(OLLAMA_LOCK_FILE)
                    _log(f"stole stale lock from dead PID {holder_pid}")
                    continue   # retry the O_CREAT loop immediately
                except Exception:
                    pass       # race: another process grabbed it — keep polling
        except Exception:
            pass   # lock file being written — keep polling

        time.sleep(OLLAMA_LOCK_POLL)

    _log(f"ollama lock timeout ({OLLAMA_LOCK_TIMEOUT}s) — skipping Ollama call this cycle")
    return False


def _ollama_lock_release() -> None:
    """Release the Ollama file lock. Safe to call even if not held."""
    try:
        os.unlink(OLLAMA_LOCK_FILE)
    except FileNotFoundError:
        pass   # already released — that's fine
    except Exception as exc:
        _log(f"lock release error (non-fatal): {exc}")


# ── Logging ──────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    ts   = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} [absorb_loop] {msg}"
    try:
        print(line)
    except Exception:
        pass
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        try:
            with open(LOG_PATH, "r", encoding="utf-8") as fh:
                prior = fh.readlines()
        except FileNotFoundError:
            prior = []
        kept = prior[-(LOG_CAP - 1):] if len(prior) >= LOG_CAP else prior
        kept.append(line + "\n")
        with open(LOG_PATH, "w", encoding="utf-8") as fh:
            fh.writelines(kept)
    except Exception:
        pass


# ── Cursor management ────────────────────────────────────────────────────────

def _read_cursors() -> dict:
    try:
        with open(CURSORS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, str):
            data = json.loads(data)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_cursors(cursors: dict) -> None:
    try:
        os.makedirs(os.path.dirname(CURSORS_FILE), exist_ok=True)
        with open(CURSORS_FILE, "w", encoding="utf-8") as f:
            json.dump(cursors, f, ensure_ascii=False)
    except Exception as exc:
        _log(f"cursor write failed: {exc}")


# ── Source reading ───────────────────────────────────────────────────────────

def _read_new_lines(path: str, cursor_key: str, cursors: dict) -> tuple[list[str], int]:
    """Return (new_stripped_lines, new_cursor). Cursor is total line count of file."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
    except FileNotFoundError:
        return [], cursors.get(cursor_key, 0)
    except Exception as exc:
        _log(f"read {os.path.basename(path)} failed: {exc}")
        return [], cursors.get(cursor_key, 0)

    prior      = cursors.get(cursor_key, 0)
    new_lines  = all_lines[prior:]
    stripped   = [l.rstrip() for l in new_lines if l.strip()]
    return stripped, len(all_lines)


# ── Ollama ───────────────────────────────────────────────────────────────────

def _ollama_generate(prompt: str) -> str:
    # Acquire the shared file-based semaphore before calling Ollama.
    # This serialises absorb_loop against any other Python caller that also
    # honours C:\Xova\memory\ollama.lock (Jarvis voice path, future callers).
    # If the lock isn't acquired within OLLAMA_LOCK_TIMEOUT, skip this call.
    if not _ollama_lock_acquire(owner="absorb_loop"):
        return "(ollama skipped: lock timeout — Ollama busy with another caller)"

    try:
        # socket timeout alone (OLLAMA_TIMEOUT) only resets per received byte —
        # a slow-streaming Ollama never trips it. Run in a daemon thread and join
        # with a wall-clock deadline so a stuck model can't block the loop forever.
        payload = json.dumps({
            "model":  OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
        }).encode("utf-8")
        bucket: list[str] = []

        def _call() -> None:
            try:
                req = urllib.request.Request(
                    OLLAMA_URL,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                bucket.append(result.get("response", "").strip())
            except Exception as exc:
                bucket.append(f"(ollama error: {exc})")

        t = threading.Thread(target=_call, daemon=True)
        t.start()
        t.join(timeout=OLLAMA_TIMEOUT)
        if t.is_alive():
            return f"(ollama wall-clock timeout: {OLLAMA_TIMEOUT}s exceeded — model stuck)"
        return bucket[0] if bucket else "(ollama error: no result)"
    finally:
        _ollama_lock_release()


# ── Grounding check (rule-based) ─────────────────────────────────────────────

# Fields that carry meaningful numeric signal in forge_events + mesh_feed.
# Deliberately narrow — avoids false-positives on ts, sce88_levels, agent_id.
# LIMITATION: checks numeric fields only. Signal values embedded in string
# fields (e.g. forge_events note: "risk 5/5") are invisible to this check.
# Acceptable: sig downgrade is bounded at -1 and the threshold gate provides
# a second safety margin. Fix when sources change to store values numerically.
_SIGNAL_FIELDS     = frozenset(["risk", "hallucination_risk", "coherence",
                                 "significance", "score"])
_CONSECUTIVE_WORDS = frozenset(["consecutive", "in a row", "back-to-back"])
_MULTIPLE_WORDS    = frozenset(["multiple", "several", "many", "all", "every"])


def _parse_objs(lines: list[str]) -> list[dict]:
    out = []
    for line in lines:
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                out.append(obj)
        except Exception:
            pass
    return out


def _signal_values(obj: dict) -> list[float]:
    """Extract numeric values from known signal fields only."""
    return [float(obj[k]) for k in _SIGNAL_FIELDS
            if k in obj and isinstance(obj[k], (int, float))]


def _nums_in(text: str) -> list[float]:
    """Extract all numbers from a string."""
    return [float(m) for m in re.findall(r'\b\d+(?:\.\d+)?\b', text)]


def _ground_check_rule(finding: str, lines: list[str]) -> tuple[bool, str]:
    """
    Deterministic grounding check. Returns (grounded, note).
    Checks quantitative claims in the finding against actual parsed values.
    Never calls Ollama. Survives any model swap.
    """
    lower = finding.lower()
    objs  = _parse_objs(lines)
    nums  = _nums_in(finding)

    if not objs or not nums:
        return True, "no parseable objects or no numeric claims — pass"

    # ── "consecutive / in a row / back-to-back" ───────────────────────────
    if any(w in lower for w in _CONSECUTIVE_WORDS):
        found_run = False
        for target in nums:
            for i in range(len(objs) - 1):
                sv_i = _signal_values(objs[i])
                sv_j = _signal_values(objs[i + 1])
                if (any(abs(v - target) < 0.01 for v in sv_i) and
                        any(abs(v - target) < 0.01 for v in sv_j)):
                    found_run = True
                    break
            if found_run:
                break
        if not found_run:
            return False, (f"'consecutive' claim: no 2 adjacent lines share "
                           f"a signal value matching {nums} "
                           f"in {len(objs)} parsed lines")

    # ── "multiple / several / many / all / every" ─────────────────────────
    if any(w in lower for w in _MULTIPLE_WORDS):
        for target in nums:
            count = sum(
                1 for obj in objs
                if any(abs(v - target) < 0.01 for v in _signal_values(obj))
            )
            if count < 2:
                return False, (f"'multiple' claim: signal value {target} "
                               f"found only {count} time(s) "
                               f"in {len(objs)} parsed lines")

    return True, "ok"


# ── Vocabulary filter ─────────────────────────────────────────────────────────

# Fields kept when building the Ollama digest. Strips ts, note, sce88_levels,
# user_query, content, label — vocabulary sources that trigger schema-pattern
# matching in small models. kind + signal fields give the model enough context
# to rate significance without exposing field-name vocabulary.
FILTER_DIGEST       = True

# FUTURE WORK — vocabulary filter upgrade path
# These are not shipped now because each is real work and the substrate is
# about to change (server build with larger model). Defensive habits
# (grounding check, two-strikes, threshold gates) survive any model swap;
# preprocessing-heavy upgrades are better calibrated against the model they
# will actually run on.
#
# Apply when: (a) loop has run in real operation for 1+ week and actual
# failure modes are on record, OR (b) the larger model lands on new hardware.
#
# 1. Positional/tabular digest format. Less prose-shaped, less vocabulary
#    leakage. E.g. "[self-eval | risk=1 | agent=09]" or true tabular columns.
#    Removes JSON syntax cues that small models treat as prose structure.
#
# 2. Pre-annotated anomaly hints. Pre-compute which values are unusual
#    (risk=5 [HIGH], coherence=0.18 [LOW]) before sending to the model.
#    Moves anomaly detection from model judgment into deterministic
#    preprocessing — model only has to synthesise, not detect.
#
# 3. Batching by agent_id. Group lines per-agent before sending. Gives model
#    coherent per-agent context instead of a mixed smear of 13 agents.
#
# 4. Diff against baseline. Pre-compute rolling averages per source (mean
#    coherence over last 100 cycles) and send current-vs-baseline deltas.
#    Makes the significance question sharper and less dependent on the model
#    having an implicit baseline.
#
# 5. Per-agent rolling state. Track recent significance history per agent_id,
#    not just per source. "agent_13 flagged 3 times in the last hour" is
#    much stronger signal than a single-shot eval.
#
# 6. Schema-aware extraction. Different sources (forge_events, mesh_feed,
#    future sources) have different field shapes. Per-source filter configs
#    instead of one global _DIGEST_KEEP_FIELDS.
_DIGEST_KEEP_FIELDS = frozenset(["kind", "risk", "hallucination_risk", "coherence",
                                  "significance", "score", "answered", "gated",
                                  "agent_id"])


def _filter_line(line: str) -> str:
    """Project a JSONL line to _DIGEST_KEEP_FIELDS before sending to Ollama."""
    if not FILTER_DIGEST:
        return line
    try:
        obj = json.loads(line)
        if not isinstance(obj, dict):
            return line
        kept = {k: v for k, v in obj.items() if k in _DIGEST_KEEP_FIELDS}
        return json.dumps(kept, ensure_ascii=False) if kept else line
    except Exception:
        return line


def _evaluate_batch(lines: list[str], source: str) -> dict:
    """Ask Ollama to rate significance (1-5) and extract a finding. Returns eval dict."""
    digest = "\n".join(_filter_line(l) for l in lines[:MAX_LINES_PER_EVAL])
    prompt = (
        "You are a signal-detection pass for Xova, an AI agent built by Adam Snellman. "
        "You are reading MACHINE-GENERATED STRUCTURED LOG DATA — not user input, not prose. "
        "The field names (e.g. 'hallucination_risk', 'auto-correction', 'kind', 'agent_id') "
        "are schema labels. Do NOT treat field names as vocabulary signals. "
        "Look ONLY at the VALUES: are risk scores unusually high? Is coherence trending down? "
        "Are there repeated failures, unexpected agent IDs, or zero-count results where non-zero is normal?\n\n"
        f"Source: '{source}' — new log lines since last cycle:\n\n"
        f"{digest}\n\n"
        "Rate the collective significance of this batch from 1 to 5:\n"
        "  1 = normal cycle output — risk scores low, coherence stable, no repeated failures\n"
        "  2 = slightly off-nominal but within expected variance\n"
        "  3 = worth logging, low priority\n"
        "  4 = anomaly in values Adam should probably know about soon\n"
        "  5 = clear value-level anomaly requiring Adam's immediate attention\n\n"
        "If significance >= 4, write ONE short factual sentence about the VALUE anomaly "
        "(e.g. 'hallucination_risk hit 5/5 on 3 consecutive replies' or "
        "'agent coherence dropped below 0.3 for 8 consecutive cycles'). "
        "If significance < 4, set finding to null.\n\n"
        "Output ONLY a JSON object, no preamble, no markdown fences:\n"
        "{\"significance\": N, \"finding\": \"...\" or null}"
    )
    raw = _ollama_generate(prompt)
    try:
        start = raw.find("{")
        end   = raw.rfind("}") + 1
        if start >= 0 and end > start:
            parsed  = json.loads(raw[start:end])
            sig     = min(5, max(1, int(parsed.get("significance", 1))))
            finding = parsed.get("finding") or None
            if isinstance(finding, str) and finding.strip().lower() in ("null", "none", ""):
                finding = None
            if finding:
                grounded, gnote = _ground_check_rule(finding, lines)
                if not grounded:
                    sig = max(1, sig - 1)
                    _log(f"{source}: grounding mismatch — {gnote} — sig downgraded to {sig}")
            return {"significance": sig, "finding": finding, "raw": raw}
    except Exception:
        pass
    return {"significance": 1, "finding": None, "raw": raw}


# ── Surfacing ────────────────────────────────────────────────────────────────

def _surface_finding(text: str, source: str, significance: int) -> None:
    """Write finding to voice_inbox.json with role='absorb' so Xova picks it up."""
    now     = int(time.time() * 1000)
    payload = {
        "role":  "absorb",
        "from":  "absorb_loop",
        "to":    "xova",
        "text":  f"[absorb · {source} · sig={significance}] {text}",
        "ts":    now,
    }
    try:
        os.makedirs(os.path.dirname(VOICE_INBOX), exist_ok=True)
        with open(VOICE_INBOX, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        _log(f"surfaced ({source} sig={significance}): {text[:80]}")
    except Exception as exc:
        _log(f"surface failed: {exc}")


# ── Trash deposit ─────────────────────────────────────────────────────────────

def _deposit_batch(lines: list[str], source: str, significance: int) -> None:
    """Deposit processed batch to absorb trash. Never deletes — full audit trail."""
    if not lines:
        return
    try:
        batch = {
            "source":       source,
            "significance": significance,
            "lines":        lines,
            "ts":           int(time.time() * 1000),
            "cycle":        _cycle_count,
        }
        os.makedirs(os.path.dirname(WORKING_FILE), exist_ok=True)
        with open(WORKING_FILE, "w", encoding="utf-8") as f:
            json.dump(batch, f, ensure_ascii=False, indent=2)
        reason = f"absorb cycle {_cycle_count} · {source} · sig={significance} · {len(lines)} lines"
        result = subprocess.run(
            [sys.executable, TRASH_KEEPER, "deposit",
             TRASH_AGENT, WORKING_FILE, reason, TRASH_AGENT],
            capture_output=True, timeout=15,
            creationflags=NO_WIN,
        )
        if result.returncode != 0:
            _log(f"trash deposit non-zero exit ({source}): {result.stderr.decode(errors='replace')[:120]}")
    except Exception as exc:
        _log(f"trash deposit failed ({source}): {exc}")


# ── Absorb log ───────────────────────────────────────────────────────────────

def _append_absorb_log(entry: dict) -> None:
    try:
        os.makedirs(os.path.dirname(ABSORB_LOG), exist_ok=True)
        try:
            with open(ABSORB_LOG, "r", encoding="utf-8") as f:
                existing = f.readlines()
        except FileNotFoundError:
            existing = []
        kept = existing[-(ABSORB_LOG_CAP - 1):] if len(existing) >= ABSORB_LOG_CAP else existing
        kept.append(json.dumps(entry, ensure_ascii=False) + "\n")
        with open(ABSORB_LOG, "w", encoding="utf-8") as f:
            f.writelines(kept)
    except Exception as exc:
        _log(f"absorb_log append failed: {exc}")


# ── Two-strikes state ────────────────────────────────────────────────────────

def _read_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, str):
            data = json.loads(data)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_state(state: dict) -> None:
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
    except Exception as exc:
        _log(f"state write failed: {exc}")


# ── Agent board heartbeat ─────────────────────────────────────────────────────

def _update_board() -> None:
    global _last_board_at
    now = time.time()
    if now - _last_board_at < 60:
        return
    _last_board_at = now
    try:
        try:
            with open(AGENT_BOARD, "r", encoding="utf-8") as f:
                board = json.load(f)
        except Exception:
            board = {}
        board.setdefault("xova",   {"alive": False, "last_seen": 0, "current_task": None})
        board.setdefault("jarvis", {"alive": False, "last_seen": 0, "current_task": None})
        board.setdefault("forge",  {"alive": False, "last_seen": 0, "forge_mode": "off"})
        board.setdefault("shared", {"active_correlation_id": None, "context": {}})
        board["absorb"] = {
            "alive":     True,
            "last_seen": int(now * 1000),
            "cycles":    _cycle_count,
            "poll_sec":  POLL_SEC,
            "threshold": SIGNIFICANCE_THRESHOLD,
        }
        board["ts"] = int(now * 1000)
        with open(AGENT_BOARD, "w", encoding="utf-8") as f:
            json.dump(board, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        _log(f"board update failed: {exc}")


# ── Main cycle ───────────────────────────────────────────────────────────────

SOURCES = [
    ("forge_events", FORGE_EVENTS),
    ("mesh_feed",    MESH_FEED),
]


def _run_cycle() -> None:
    global _cycle_count
    _cycle_count += 1
    _log(f"cycle {_cycle_count} start")

    cursors = _read_cursors()
    state   = _read_state()

    for key, path in SOURCES:
        new_lines, new_cursor = _read_new_lines(path, key, cursors)
        cursors[key] = new_cursor

        if not new_lines:
            _log(f"{key}: 0 new lines — skip")
            continue

        _log(f"{key}: {len(new_lines)} new lines — evaluating")
        ev         = _evaluate_batch(new_lines, key)
        sig        = ev["significance"]
        finding    = ev["finding"]

        last_sig   = state.get(key, {}).get("last_sig",   0)
        last_cycle = state.get(key, {}).get("last_cycle", 0)
        recent     = (_cycle_count - last_cycle) <= TWO_STRIKE_WINDOW
        two_strike = (sig >= SIGNIFICANCE_THRESHOLD
                      and last_sig >= SIGNIFICANCE_THRESHOLD
                      and recent)
        surfaced   = bool(finding and two_strike)

        if sig >= SIGNIFICANCE_THRESHOLD and not two_strike:
            if last_sig >= SIGNIFICANCE_THRESHOLD and not recent:
                _log(f"{key}: sig={sig} >= threshold but prior strike (cycle {last_cycle}) "
                     f"is stale (gap={_cycle_count - last_cycle} > window={TWO_STRIKE_WINDOW}) "
                     f"— resetting, fresh first strike")
            else:
                _log(f"{key}: sig={sig} >= threshold — first strike, waiting for corroboration")

        _log(f"{key}: sig={sig} two_strike={two_strike} surfaced={surfaced}"
             + (f" finding='{finding[:80]}'" if finding else ""))

        if surfaced:
            _surface_finding(finding, key, sig)  # type: ignore[arg-type]

        _deposit_batch(new_lines, key, sig)

        _append_absorb_log({
            "ts":           int(time.time() * 1000),
            "cycle":        _cycle_count,
            "source":       key,
            "new_lines":    len(new_lines),
            "significance": sig,
            "last_sig":     last_sig,
            "two_strike":   two_strike,
            "recent":       recent,
            "surfaced":     surfaced,
        })

        state[key] = {"last_sig": sig, "last_cycle": _cycle_count}

    _write_cursors(cursors)
    _write_state(state)
    _log(f"cycle {_cycle_count} complete")


def main() -> None:
    _log("absorb_loop started")
    while True:
        try:
            _run_cycle()
            _update_board()
        except Exception as exc:
            _log(f"cycle error: {exc}")
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
