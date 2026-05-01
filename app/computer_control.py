import sys, json, subprocess, os, time, traceback
import pyautogui
import pyperclip
import pyttsx3
from PIL import ImageGrab

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

SCREEN_DIR = "C:\\Xova\\memory"
os.makedirs(SCREEN_DIR, exist_ok=True)


def screenshot(region=None):
    img = ImageGrab.grab(bbox=tuple(region) if region else None)
    path = os.path.join(SCREEN_DIR, "screen.png")
    img.save(path)
    return {"saved": path, "size": list(img.size)}


def speak(text):
    # Pronounce "Xova" as "Zova" — Adam's preferred pronunciation. SAPI/pyttsx3
    # would otherwise read it as "ex-oh-va".
    import re as _re
    spoken = _re.sub(r"\bX(ova)\b", r"Z\1", text)
    spoken = _re.sub(r"\bx(ova)\b", r"z\1", spoken)
    engine = pyttsx3.init()
    engine.say(spoken)
    engine.runAndWait()
    return {"spoke": text}


def listen(timeout=5, phrase_time_limit=10):
    import speech_recognition as sr
    r = sr.Recognizer()
    with sr.Microphone() as src:
        r.adjust_for_ambient_noise(src, duration=0.3)
        audio = r.listen(src, timeout=timeout, phrase_time_limit=phrase_time_limit)
    try:
        return {"heard": r.recognize_google(audio)}
    except sr.UnknownValueError:
        return {"heard": "", "error": "could not understand audio"}
    except sr.RequestError as e:
        return {"heard": "", "error": f"recognition service: {e}"}


def list_windows():
    import pygetwindow as gw
    return {"windows": [w.title for w in gw.getAllWindows() if w.title.strip()]}


def find_window(title):
    import pygetwindow as gw
    matches = [w for w in gw.getAllWindows() if title.lower() in w.title.lower() and w.title.strip()]
    return matches[0] if matches else None


def focus_window(title):
    w = find_window(title)
    if not w:
        return {"error": f"no window matching: {title}"}
    try:
        if w.isMinimized:
            w.restore()
        w.activate()
        return {"focused": w.title}
    except Exception as e:
        return {"error": str(e), "title": w.title}


def close_window(title):
    w = find_window(title)
    if not w:
        return {"error": f"no window matching: {title}"}
    w.close()
    return {"closed": w.title}


def minimize_window(title):
    w = find_window(title)
    if not w:
        return {"error": f"no window matching: {title}"}
    w.minimize()
    return {"minimized": w.title}


def maximize_window(title):
    w = find_window(title)
    if not w:
        return {"error": f"no window matching: {title}"}
    w.maximize()
    return {"maximized": w.title}


def browser_action(action):
    from playwright.sync_api import sync_playwright
    url = action.get("url")
    search = action.get("search")
    selector = action.get("selector")
    text = action.get("text")
    extract = action.get("extract", True)
    headless = action.get("headless", False)
    keep_open = action.get("keep_open", False)
    timeout_ms = int(action.get("timeout", 15)) * 1000

    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page()
        page.set_default_timeout(timeout_ms)
        if url:
            page.goto(url)
        if search:
            page.fill('textarea[name="q"]', search)
            page.keyboard.press("Enter")
            page.wait_for_load_state("networkidle")
        if selector and text is not None:
            page.fill(selector, text)
        if action.get("click_selector"):
            page.click(action["click_selector"])
            page.wait_for_load_state("networkidle")
        if extract:
            body = page.inner_text("body")
            out["text"] = body[:6000]
            out["url"] = page.url
            out["title"] = page.title()
        if not keep_open:
            browser.close()
    return out


def web_search(query):
    subprocess.Popen(['start', 'chrome', f'https://www.google.com/search?q={query}'], shell=True)
    return {"query": query, "opened": True}


def dispatch(action):
    cmd = action.get("cmd")

    if cmd == "screenshot":
        return screenshot(action.get("region"))

    if cmd == "screen_size":
        w, h = pyautogui.size()
        return {"width": w, "height": h}

    if cmd == "mouse_pos":
        x, y = pyautogui.position()
        return {"x": x, "y": y}

    if cmd == "move":
        pyautogui.moveTo(action["x"], action["y"], duration=action.get("duration", 0.2))
        return {"moved": [action["x"], action["y"]]}

    if cmd == "click":
        x, y = action.get("x"), action.get("y")
        button = action.get("button", "left")
        clicks = int(action.get("clicks", 1))
        if x is not None and y is not None:
            pyautogui.click(x, y, clicks=clicks, button=button)
        else:
            pyautogui.click(clicks=clicks, button=button)
        return {"clicked": [x, y], "button": button, "clicks": clicks}

    if cmd == "right_click":
        pyautogui.rightClick(action.get("x"), action.get("y"))
        return {"right_clicked": [action.get("x"), action.get("y")]}

    if cmd == "double_click":
        pyautogui.doubleClick(action.get("x"), action.get("y"))
        return {"double_clicked": [action.get("x"), action.get("y")]}

    if cmd == "drag":
        pyautogui.moveTo(action["x1"], action["y1"])
        pyautogui.dragTo(action["x2"], action["y2"], duration=action.get("duration", 0.4), button=action.get("button", "left"))
        return {"dragged": [[action["x1"], action["y1"]], [action["x2"], action["y2"]]]}

    if cmd == "scroll":
        amount = int(action.get("amount", -3))
        if "x" in action and "y" in action:
            pyautogui.scroll(amount, action["x"], action["y"])
        else:
            pyautogui.scroll(amount)
        return {"scrolled": amount}

    if cmd == "type":
        text = action.get("text", "")
        pyautogui.typewrite(text, interval=action.get("interval", 0.03))
        return {"typed": text}

    if cmd == "press":
        key = action.get("key")
        presses = int(action.get("presses", 1))
        pyautogui.press(key, presses=presses)
        return {"pressed": key, "presses": presses}

    if cmd == "hotkey":
        keys = action.get("keys", [])
        pyautogui.hotkey(*keys)
        return {"hotkey": keys}

    if cmd == "key_down":
        pyautogui.keyDown(action["key"])
        return {"key_down": action["key"]}

    if cmd == "key_up":
        pyautogui.keyUp(action["key"])
        return {"key_up": action["key"]}

    if cmd == "clipboard_get":
        return {"clipboard": pyperclip.paste()}

    if cmd == "clipboard_set":
        pyperclip.copy(action.get("text", ""))
        return {"clipboard_set": action.get("text", "")}

    if cmd == "open":
        path = action["path"]
        os.startfile(path) if os.path.exists(path) else subprocess.Popen(path, shell=True)
        return {"opened": path}

    if cmd == "run":
        proc = subprocess.run(
            action["command"],
            shell=True,
            capture_output=True,
            text=True,
            timeout=int(action.get("timeout", 30)),
        )
        return {
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-2000:],
            "exit": proc.returncode,
        }

    if cmd == "speak":
        return speak(action.get("text", ""))

    if cmd == "listen":
        return listen(
            timeout=int(action.get("timeout", 5)),
            phrase_time_limit=int(action.get("phrase_time_limit", 10)),
        )

    if cmd == "windows":
        return list_windows()

    if cmd == "focus_window":
        return focus_window(action["title"])

    if cmd == "close_window":
        return close_window(action["title"])

    if cmd == "minimize_window":
        return minimize_window(action["title"])

    if cmd == "maximize_window":
        return maximize_window(action["title"])

    if cmd == "wait":
        time.sleep(float(action.get("seconds", 1)))
        return {"waited": action.get("seconds", 1)}

    if cmd == "browser":
        return browser_action(action)

    if cmd == "search":
        return web_search(action["query"])

    return {"error": f"unknown cmd: {cmd}"}


def main():
    try:
        action = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        result = dispatch(action)
    except pyautogui.FailSafeException:
        result = {"error": "fail-safe triggered (mouse hit corner)"}
    except Exception as e:
        result = {"error": str(e), "trace": traceback.format_exc().splitlines()[-3:]}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
