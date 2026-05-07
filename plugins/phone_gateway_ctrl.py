"""
phone_gateway_ctrl.py — start/status for the LAN phone gateway.

Actions:
  start   launch phone_gateway.py in background, return URL
  status  check if running, return current URL + pid
"""
import argparse, json, os, subprocess, sys, time

GATEWAY    = r"C:\Xova\plugins\phone_gateway.py"
STATE_PATH = r"C:\Xova\memory\phone_gateway_state.json"
NO_WIN     = 0x08000000


def _load_state() -> dict:
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _pid_alive(pid: int) -> bool:
    try:
        r = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command",
             f"Get-Process -Id {pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"],
            capture_output=True, text=True, timeout=5, creationflags=NO_WIN,
        )
        return str(pid) in r.stdout
    except Exception:
        return False


def action_start() -> dict:
    state = _load_state()
    pid = state.get("pid", 0)
    if pid and _pid_alive(int(pid)):
        return {"ok": True, "already_running": True,
                "url": state.get("url", ""), "pid": pid}

    proc = subprocess.Popen(
        [sys.executable, GATEWAY],
        creationflags=NO_WIN,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    # Wait briefly for gateway to write its state file
    for _ in range(20):
        time.sleep(0.15)
        s = _load_state()
        if s.get("pid") == proc.pid and s.get("url"):
            return {"ok": True, "already_running": False,
                    "url": s["url"], "pid": proc.pid}

    return {"ok": True, "already_running": False,
            "url": f"http://localhost:7340", "pid": proc.pid}


def action_status() -> dict:
    state = _load_state()
    if not state:
        return {"ok": True, "running": False, "url": None}
    pid = int(state.get("pid", 0))
    running = bool(pid and _pid_alive(pid))
    return {"ok": True, "running": running,
            "url": state.get("url"), "pid": pid,
            "started_at": state.get("started_at")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="start", choices=["start", "status"])
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if args.action == "start":
        result = action_start()
    else:
        result = action_status()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(e)}))
