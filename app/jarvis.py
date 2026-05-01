import sys, json, os, base64, requests, time, subprocess

OLLAMA_URL = "http://localhost:11434/api/chat"
SCREEN_PATH = "C:\\Xova\\memory\\screen.png"
SPEAK_SCRIPT = "C:\\Xova\\app\\speak.py"
COMPUTER_SCRIPT = "C:\\Xova\\app\\computer_control.py"
MAX_STEPS = 10

def speak(text):
    subprocess.Popen(["python", SPEAK_SCRIPT, text[:300]])

def screenshot():
    result = run_computer({"cmd": "screenshot"})
    return result.get("saved", SCREEN_PATH)

def run_computer(action):
    r = subprocess.run(["python", COMPUTER_SCRIPT, json.dumps(action)], capture_output=True, text=True, timeout=30)
    try:
        return json.loads(r.stdout)
    except:
        return {"error": r.stderr or r.stdout}

def vision(image_path, prompt="Describe what you see on screen in detail."):
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    # Try moondream first (1.7GB, fits 4GB GPU). Fall back to gemma4 if not installed.
    for model in ("moondream", "gemma4"):
        body = {"model": model, "messages": [{"role": "user", "content": prompt, "images": [b64]}],
                "stream": False, "options": {"num_ctx": 2048, "temperature": 0.1}, "keep_alive": "1h"}
        try:
            resp = requests.post("http://localhost:11434/api/chat", json=body, timeout=240)
            j = resp.json()
        except Exception:
            continue
        err = j.get("error", "")
        if err and ("not found" in err or "does not exist" in err):
            continue
        content = j.get("message", {}).get("content", "")
        if content:
            return content
    return ""

def run_agent(task):
    speak(f"On it. {task}")
    screen = screenshot()
    screen_desc = vision(screen, f"I need to: {task}. What do I see on screen right now?")
    messages = [{"role": "system", "content": "You are Xova, JARVIS-level AI agent. Tools as JSON: screenshot, click, type, hotkey, browser, search, speak, windows, run. Output ACTION: {json} to act. Output DONE: summary when complete. Screen: " + screen_desc}, {"role": "user", "content": f"Task: {task}"}]
    for step in range(MAX_STEPS):
        resp = requests.post(OLLAMA_URL, json={"model": "qwen3:8b", "messages": messages, "stream": False, "options": {"num_ctx": 4096, "temperature": 0.3}, "keep_alive": "1h"}, timeout=240)
        reply = resp.json().get("message", {}).get("content", "")
        messages.append({"role": "assistant", "content": reply})
        print(json.dumps({"step": step, "thinking": reply[:200]}), flush=True)
        if "DONE:" in reply:
            done_msg = reply.split("DONE:")[-1].strip()
            speak(done_msg)
            print(json.dumps({"done": True, "result": done_msg}), flush=True)
            return
        if "ACTION:" in reply:
            for line in reply.split("\n"):
                line = line.strip()
                if line.startswith("ACTION:"):
                    try:
                        action = json.loads(line[7:].strip())
                        result = run_computer(action)
                        if action.get("cmd") == "screenshot":
                            time.sleep(0.5)
                            result["vision"] = vision(SCREEN_PATH, "What changed on screen?")
                        messages.append({"role": "user", "content": f"Action result: {json.dumps(result)}"})
                    except Exception as e:
                        messages.append({"role": "user", "content": f"Action error: {e}"})
        else:
            messages.append({"role": "user", "content": "Take an action using ACTION: or say DONE: if complete."})
    print(json.dumps({"done": True, "result": "Step limit reached"}), flush=True)

if __name__ == "__main__":
    task = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "say hello"
    run_agent(task)
