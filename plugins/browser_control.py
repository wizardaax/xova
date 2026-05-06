"""
browser_control.py — Playwright browser automation for AI site control.

Requires: pip install playwright  (already installed)
          playwright install chromium  (already installed)

Usage (called from xova_run):
  --action open       Open browser at site URL for manual login setup
  --action send       Send prompt, wait for response, return text
  --action screenshot Take screenshot, save to SCREENSHOT_PATH
  --action check      Check if logged in to a site

  --site   claude | grok | chatgpt  (or omit if --url given)
  --url    custom URL (overrides site)
  --prompt Text to send (for send action)
  --headless  Run without visible browser window

Session cookies are saved to C:\\Xova\\browser_data\\profile\\
so login persists between runs.
"""
import argparse, json, os, sys, time

PROFILE_DIR   = r"C:\Xova\browser_data\profile"
SCREENSHOT_PATH = r"C:\Xova\browser_data\screenshot.png"

SITES: dict[str, dict] = {
    "claude": {
        "url": "https://claude.ai/new",
        "login_url": "https://claude.ai/login",
        "prompt_selectors": [
            '[contenteditable="true"].ProseMirror',
            '[data-testid="chat-input"]',
            '[contenteditable="true"]',
            'div[role="textbox"]',
        ],
        "send_selectors": [
            'button[aria-label="Send Message"]',
            'button[aria-label*="Send"]',
            'button[data-testid="send-button"]',
        ],
        "response_selectors": [
            '.font-claude-message',
            '[data-testid*="message"] .prose',
            '.prose p',
        ],
        "login_check_selector": '[contenteditable="true"]',
    },
    "grok": {
        "url": "https://grok.com",
        "login_url": "https://grok.com",
        "prompt_selectors": [
            'textarea[placeholder]',
            'textarea',
            '[contenteditable="true"]',
        ],
        "send_selectors": [
            'button[type="submit"]',
            'button[aria-label*="Send"]',
            '[data-testid="send-button"]',
        ],
        "response_selectors": [
            '[data-testid="bot-message"] p',
            '.message-content p',
            '.prose p',
        ],
        "login_check_selector": 'textarea',
    },
    "chatgpt": {
        "url": "https://chat.openai.com",
        "login_url": "https://chat.openai.com/auth/login",
        "prompt_selectors": [
            '#prompt-textarea',
            '[data-id="root"] textarea',
            'textarea[placeholder*="Message"]',
        ],
        "send_selectors": [
            'button[data-testid="send-button"]',
            'button[aria-label="Send prompt"]',
            'button[aria-label*="Send"]',
        ],
        "response_selectors": [
            '[data-message-author-role="assistant"] .markdown',
            '[data-message-author-role="assistant"] p',
            '.group .markdown p',
        ],
        "login_check_selector": '#prompt-textarea',
    },
}


def _find(page, selectors: list[str], timeout: int = 4000):
    for sel in selectors:
        try:
            el = page.wait_for_selector(sel, timeout=timeout)
            if el:
                return el, sel
        except Exception:
            pass
    return None, None


def _wait_stable(page, selectors: list[str], timeout_s: int = 60, stable_s: float = 2.5) -> str:
    """Poll response selectors until text is stable for stable_s seconds."""
    deadline = time.time() + timeout_s
    last_text, stable_since = "", None
    while time.time() < deadline:
        try:
            els = []
            for sel in selectors:
                try:
                    els = page.query_selector_all(sel)
                    if els:
                        break
                except Exception:
                    pass
            text = "\n".join(e.inner_text() for e in els if e).strip()
            if text and text == last_text:
                if stable_since is None:
                    stable_since = time.time()
                elif time.time() - stable_since >= stable_s:
                    return text
            else:
                last_text, stable_since = text, None
        except Exception:
            pass
        time.sleep(0.35)
    return last_text


def action_open(playwright, site_cfg: dict, headless: bool, wait_login: bool):
    """Open browser to site URL. If wait_login, keep open until browser closes."""
    os.makedirs(PROFILE_DIR, exist_ok=True)
    ctx = playwright.chromium.launch_persistent_context(
        PROFILE_DIR, headless=headless,
        args=["--disable-blink-features=AutomationControlled"],
        no_viewport=True,
    )
    page = ctx.new_page() if not ctx.pages else ctx.pages[0]
    page.goto(site_cfg["url"], wait_until="domcontentloaded", timeout=20000)

    if wait_login:
        # Keep browser open until user closes the tab or we time out (5 min)
        try:
            page.wait_for_selector(
                site_cfg.get("login_check_selector", "body"),
                timeout=300_000,
                state="attached",
            )
        except Exception:
            pass
        result = {"ok": True, "action": "open", "url": page.url, "msg": "browser ready — log in then close the window"}
    else:
        result = {"ok": True, "action": "open", "url": page.url}

    ctx.close()
    return result


def action_check(playwright, site_cfg: dict) -> dict:
    """Check if already logged in by looking for the prompt input."""
    os.makedirs(PROFILE_DIR, exist_ok=True)
    ctx = playwright.chromium.launch_persistent_context(
        PROFILE_DIR, headless=True,
        args=["--disable-blink-features=AutomationControlled"],
        no_viewport=True,
    )
    try:
        page = ctx.new_page()
        page.goto(site_cfg["url"], wait_until="domcontentloaded", timeout=15000)
        time.sleep(2)
        el, sel = _find(page, site_cfg["prompt_selectors"], timeout=4000)
        logged_in = el is not None
        return {"ok": True, "logged_in": logged_in, "url": page.url, "selector_found": sel}
    finally:
        ctx.close()


def action_send(playwright, site_cfg: dict, prompt: str, headless: bool) -> dict:
    """Send a prompt to the AI site and return the response text."""
    os.makedirs(PROFILE_DIR, exist_ok=True)
    ctx = playwright.chromium.launch_persistent_context(
        PROFILE_DIR, headless=headless,
        args=["--disable-blink-features=AutomationControlled"],
        no_viewport=True,
    )
    try:
        page = ctx.new_page()
        page.goto(site_cfg["url"], wait_until="domcontentloaded", timeout=20000)
        time.sleep(1.5)

        # Find prompt input
        input_el, input_sel = _find(page, site_cfg["prompt_selectors"], timeout=8000)
        if not input_el:
            return {"ok": False, "error": "prompt_input_not_found", "needs_login": True,
                    "login_url": site_cfg["login_url"]}

        # Fill prompt (fill handles newlines + special chars; click first to ensure focus)
        input_el.click()
        time.sleep(0.3)
        input_el.fill(prompt)
        time.sleep(0.3)

        # Find and click send
        send_el, send_sel = _find(page, site_cfg["send_selectors"], timeout=4000)
        if send_el:
            send_el.click()
        else:
            page.keyboard.press("Enter")

        # Wait for response to appear and stabilise
        time.sleep(1.5)
        response_text = _wait_stable(page, site_cfg["response_selectors"], timeout_s=90, stable_s=2.5)

        if not response_text:
            response_text = "(no response captured — selectors may need updating)"

        return {
            "ok": True,
            "action": "send",
            "prompt": prompt[:120],
            "response": response_text,
            "url": page.url,
            "input_selector": input_sel,
            "send_selector": send_sel,
        }
    finally:
        ctx.close()


def action_screenshot(playwright, site_cfg: dict, headless: bool) -> dict:
    """Take a screenshot and save it to SCREENSHOT_PATH."""
    os.makedirs(PROFILE_DIR, exist_ok=True)
    ctx = playwright.chromium.launch_persistent_context(
        PROFILE_DIR, headless=headless,
        args=["--disable-blink-features=AutomationControlled"],
        no_viewport={"width": 1280, "height": 900},
    )
    try:
        page = ctx.new_page()
        page.goto(site_cfg["url"], wait_until="domcontentloaded", timeout=15000)
        time.sleep(2)
        os.makedirs(os.path.dirname(SCREENSHOT_PATH), exist_ok=True)
        page.screenshot(path=SCREENSHOT_PATH, full_page=False)
        size = os.path.getsize(SCREENSHOT_PATH)
        return {"ok": True, "action": "screenshot", "path": SCREENSHOT_PATH, "bytes": size, "url": page.url}
    finally:
        ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--action",   default="check",  choices=["open","send","screenshot","check"])
    ap.add_argument("--site",     default="claude",  choices=list(SITES.keys()))
    ap.add_argument("--url",      default="")
    ap.add_argument("--prompt",   default="")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()

    site_cfg = dict(SITES[args.site])
    if args.url:
        site_cfg["url"] = args.url

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        if args.action == "open":
            result = action_open(pw, site_cfg, args.headless, wait_login=True)
        elif args.action == "check":
            result = action_check(pw, site_cfg)
        elif args.action == "send":
            if not args.prompt:
                result = {"ok": False, "error": "no --prompt given"}
            else:
                result = action_send(pw, site_cfg, args.prompt, args.headless)
        elif args.action == "screenshot":
            result = action_screenshot(pw, site_cfg, args.headless)
        else:
            result = {"ok": False, "error": f"unknown action: {args.action}"}

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
