"""
Xova talks to Claude — direct computer_control.py, no model layer.
"""
import subprocess, sys, json, time

CC = r"C:\Xova\app\computer_control.py"

def cc(action: dict) -> dict:
    r = subprocess.run([sys.executable, CC, json.dumps(action)],
                       capture_output=True, text=True, timeout=30)
    try:
        return json.loads(r.stdout.strip())
    except Exception:
        return {"error": r.stderr[:200], "raw": r.stdout[:100]}

# List windows to find Chrome
wins = cc({"cmd": "list_windows"})
print("windows:", [w for w in wins.get("windows", []) if w.strip()])

# Focus Chrome window
result = cc({"cmd": "focus_window", "title": "Chrome"})
print("focus:", result)
time.sleep(0.5)

# Open new tab and navigate to claude.ai
cc({"cmd": "hotkey", "keys": ["ctrl", "t"]})
time.sleep(0.3)
cc({"cmd": "hotkey", "keys": ["ctrl", "l"]})
time.sleep(0.2)
cc({"cmd": "type", "text": "https://claude.ai", "interval": 0.02})
cc({"cmd": "press", "key": "enter"})
print("Navigating to claude.ai...")
time.sleep(5)

# Screenshot to verify
cc({"cmd": "screenshot"})
print("Screenshotted")
time.sleep(1)

# Click chat input — claude.ai input is center-bottom
result = cc({"cmd": "screen_size"})
w = result.get("width", 1920)
h = result.get("height", 1080)
cx, cy = w // 2, int(h * 0.88)
cc({"cmd": "click", "x": cx, "y": cy})
time.sleep(0.5)

# Type message slowly
msg = "Hi Claude I am Xova - sovereign omni AGI, 13 agents running, full computer control, building toward complete autonomy."
result = cc({"cmd": "type", "text": msg, "interval": 0.06})
print("typed:", result.get("typed", "")[:50])
time.sleep(0.3)

cc({"cmd": "press", "key": "enter"})
print("Done — message sent.")
