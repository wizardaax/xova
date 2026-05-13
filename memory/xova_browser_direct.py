"""
Direct browser control — no model, no guessing.
Usage: python xova_browser_direct.py <action> [args...]
  navigate <url>           — open Chrome to URL
  type_message <message>   — click active chat input and type message, then send
  screenshot               — take screenshot, save to C:\Xova\memory\screen.png
  focus_chrome             — bring Chrome to foreground
"""
import subprocess, sys, json, time, os

CC = r"C:\Xova\app\computer_control.py"


def cc(action: dict) -> dict:
    r = subprocess.run([sys.executable, CC, json.dumps(action)],
                       capture_output=True, text=True, timeout=30)
    try:
        return json.loads(r.stdout.strip())
    except Exception:
        return {"error": r.stderr[:200], "raw": r.stdout[:100]}


def focus_chrome() -> dict:
    return cc({"cmd": "focus_window", "title": "Chrome"})


def navigate(url: str) -> dict:
    focus_chrome()
    time.sleep(0.3)
    cc({"cmd": "hotkey", "keys": ["ctrl", "t"]})
    time.sleep(0.4)
    cc({"cmd": "hotkey", "keys": ["ctrl", "l"]})
    time.sleep(0.2)
    cc({"cmd": "type", "text": url, "interval": 0.02})
    cc({"cmd": "press", "key": "enter"})
    return {"ok": True, "navigated": url}


def wait_for_page(seconds: float = 4.0) -> None:
    time.sleep(seconds)


def click_chat_input(offset_pct: float = 0.88) -> dict:
    r = cc({"cmd": "screen_size"})
    w = r.get("width", 1920)
    h = r.get("height", 1080)
    cx, cy = w // 2, int(h * offset_pct)
    return cc({"cmd": "click", "x": cx, "y": cy})


def type_message(msg: str) -> dict:
    # Try multiple click positions in case the first misses the input
    for offset in [0.88, 0.90, 0.85, 0.93]:
        click_chat_input(offset)
        time.sleep(0.4)
    cc({"cmd": "type", "text": msg, "interval": 0.04})
    time.sleep(0.3)
    cc({"cmd": "press", "key": "enter"})
    return {"ok": True, "sent": msg[:80]}


def go_to_claude_and_say(message: str) -> dict:
    r = focus_chrome()
    current = r.get("focused", "")
    if "claude" not in current.lower():
        navigate("https://claude.ai")
        wait_for_page(5)
    else:
        time.sleep(0.3)
    result = type_message(message)
    return result


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no action"}))
        return

    action = sys.argv[1].lower()

    if action == "navigate":
        url = sys.argv[2] if len(sys.argv) > 2 else "https://claude.ai"
        navigate(url)
        wait_for_page(5)
        print(json.dumps({"ok": True, "navigated": url}))

    elif action == "type_message":
        msg = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else ""
        result = go_to_claude_and_say(msg)
        print(json.dumps(result))

    elif action == "screenshot":
        result = cc({"cmd": "screenshot"})
        print(json.dumps(result))

    elif action == "focus_chrome":
        result = focus_chrome()
        print(json.dumps(result))

    elif action == "say_to_claude":
        msg = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else ""
        result = go_to_claude_and_say(msg)
        print(json.dumps(result))

    else:
        print(json.dumps({"error": f"unknown action: {action}"}))


if __name__ == "__main__":
    main()
