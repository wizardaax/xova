"""coherence_sentinel.py — monitors mesh coherence, injects chat warnings when it drops."""
from __future__ import annotations
import json, os, subprocess, sys, time

# ── Singleton guard ──────────────────────────────────────────────────────────
def _already_running() -> bool:
    try:
        own_pid = os.getpid()
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe' OR name='python.exe'\" "
             "| Select-Object -ExpandProperty CommandLine"],
            capture_output=True, text=True, timeout=10, creationflags=0x08000000,
        )
        siblings = [l for l in result.stdout.splitlines() if "coherence_sentinel" in l]
        return len(siblings) > 1
    except Exception:
        return False

if _already_running():
    sys.exit(0)
# ─────────────────────────────────────────────────────────────────────────────

POLL_SEC         = 30
COOLDOWN_SEC     = 600   # 10 minutes between injections
ALERT_THRESHOLD  = 0.5
ALERT_WINDOW     = 3     # consecutive cycle_end events below threshold
MESH_FEED        = r"C:\Xova\memory\mesh_feed.jsonl"
VOICE_INBOX      = r"C:\Xova\memory\voice_inbox.json"
LOG_PATH         = r"C:\Xova\memory\sentinel.log"
LOG_CAP          = 200
NO_WIN           = 0x08000000

_last_alert: float = 0.0


def _log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} [sentinel] {msg}"
    print(line)
    try:
        try:
            with open(LOG_PATH, "r", encoding="utf-8") as fh:
                lines = fh.readlines()
        except FileNotFoundError:
            lines = []
        lines.append(line + "\n")
        if len(lines) > LOG_CAP:
            lines = lines[-(LOG_CAP - 1):]
        with open(LOG_PATH, "w", encoding="utf-8") as fh:
            fh.writelines(lines)
    except Exception:
        pass


def _read_last_cycles(n: int) -> list[float]:
    """Return coherence values from the last n cycle_end events in mesh_feed.jsonl."""
    try:
        with open(MESH_FEED, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
    except FileNotFoundError:
        return []
    coherences: list[float] = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if obj.get("kind") == "cycle_end" and isinstance(obj.get("coherence"), (int, float)):
                coherences.append(float(obj["coherence"]))
                if len(coherences) >= n:
                    break
        except Exception:
            pass
    return coherences


def _inject_warning(avg: float) -> None:
    bubble = {
        "id": f"sentinel-alert-{int(time.time() * 1000)}",
        "role": "absorb",
        "ts": int(time.time() * 1000),
        "content": f"⚠ Mesh coherence alert: last {ALERT_WINDOW} cycles averaged {avg:.2f} — network may need attention",
    }
    try:
        try:
            with open(VOICE_INBOX, "r", encoding="utf-8") as fh:
                inbox = json.load(fh)
            if not isinstance(inbox, list):
                inbox = []
        except FileNotFoundError:
            inbox = []
        except json.JSONDecodeError:
            _log("voice_inbox JSON corrupt — skipping inject")
            return
        inbox.append(bubble)
        tmp = VOICE_INBOX + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(inbox, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, VOICE_INBOX)
        _log(f"injected coherence alert (avg={avg:.2f})")
    except Exception as exc:
        _log(f"inject failed: {exc}")


def main() -> None:
    global _last_alert
    _log("sentinel started")
    while True:
        time.sleep(POLL_SEC)
        recent = _read_last_cycles(ALERT_WINDOW)
        if len(recent) < ALERT_WINDOW:
            continue
        avg = sum(recent) / len(recent)
        if avg < ALERT_THRESHOLD:
            now = time.time()
            if now - _last_alert >= COOLDOWN_SEC:
                _inject_warning(avg)
                _last_alert = now
            else:
                remaining = COOLDOWN_SEC - (now - _last_alert)
                _log(f"low coherence ({avg:.2f}) but cooldown active ({remaining:.0f}s remaining)")


if __name__ == "__main__":
    main()
