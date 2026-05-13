"""web_scrape.py — fetch page text without JS execution.

Fulfils the evolve request from agent-04-browser (forge_hook_inbox.jsonl):

  "evolve: write web scrape helper for fetching page text without JS"

Stdlib only — `urllib.request` + `html.parser` — no `requests`, no `beautifulsoup4`,
no `playwright`. Matches the 100-year design contract: this module runs in 2125
with stock Python.

Plain HTTP GET → decode body → strip `<script>` / `<style>` / HTML tags → return
clean text. JavaScript is *never executed* — what you fetch is what the server
sent. Server-rendered HTML and RSS/JSON-LD payloads are visible; SPA shells that
need JS to render content will look empty (by design).

Public surface:
    fetch_page_text(url, timeout_s=10.0, max_bytes=1_000_000, user_agent=None) -> dict

Returned dict shape:
    {
        "ok":      bool,
        "status":  int | None,     # HTTP status code
        "url":     str,            # final URL after redirects
        "title":   str | None,
        "text":    str,            # plain text content (cap-truncated)
        "length":  int,            # len(text)
        "bytes":   int,            # bytes received from server
        "error":   str | None,
    }

Same shape pattern as `sce88_gate.violation_rate()` and
`context_broker.slot_health_score()` — typed signature, dict return, imports
inside the function, fail-safe with descriptive `error` field rather than raising.
"""
from __future__ import annotations


def fetch_page_text(
    url: str,
    timeout_s: float = 10.0,
    max_bytes: int = 1_000_000,
    user_agent: str | None = None,
) -> dict:
    """Fetch a URL via plain HTTP GET and return clean visible page text.

    No JavaScript execution. No external deps. Follows redirects (urllib default).
    Caps response at ``max_bytes`` to avoid runaway downloads. Decodes using the
    charset declared in Content-Type or HTML meta, falling back to utf-8.

    Args:
        url:        Absolute HTTP(S) URL.
        timeout_s:  Socket timeout in seconds (default 10).
        max_bytes:  Max bytes to read from server (default 1 MB).
        user_agent: Optional User-Agent override (default: a generic stdlib UA).

    Returns:
        dict — see module docstring for shape. Never raises for I/O errors;
        returns ``{"ok": False, "error": "<message>", ...}`` instead.
    """
    import urllib.request as _u
    import urllib.error as _ue
    import html.parser as _h
    import html as _hh
    import re as _re

    # ── inner: HTML → text stripper ──────────────────────────────────────────
    class _Stripper(_h.HTMLParser):
        # Tags whose content is non-visible / non-textual. ONLY tags with
        # explicit closing — void elements (meta, link, br, img, hr, input)
        # do not have </tag> so they would permanently inflate _depth_drop
        # if listed here. Their start-tag is harmless: they carry no content.
        # Note: 'head' is intentionally not in _DROP — title lives inside head
        # and we want to capture it; meta/link/style/script inside head are
        # handled individually (meta/link are void; style/script are dropped).
        _DROP = {"script", "style", "noscript", "iframe", "svg",
                 "object", "embed", "template"}
        # Tags that introduce a paragraph break when closed.
        _BREAK = {"p", "div", "li", "tr", "h1", "h2", "h3",
                  "h4", "h5", "h6", "section", "article", "header",
                  "footer", "blockquote", "pre"}

        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self._depth_drop = 0
            self._in_title = False
            self.title: str | None = None
            self._chunks: list[str] = []

        def handle_starttag(self, tag, attrs):
            t = tag.lower()
            if t in self._DROP:
                self._depth_drop += 1
            if t == "title":
                self._in_title = True
            if t == "br":
                self._chunks.append("\n")

        def handle_endtag(self, tag):
            t = tag.lower()
            if t in self._DROP and self._depth_drop > 0:
                self._depth_drop -= 1
            if t == "title":
                self._in_title = False
            if t in self._BREAK:
                self._chunks.append("\n")

        def handle_data(self, data):
            # Title capture takes priority — title is inside <head> but we
            # want it. Check before the drop-guard.
            if self._in_title:
                self.title = (self.title or "") + data
                return
            if self._depth_drop > 0:
                return
            self._chunks.append(data)

        def get_text(self) -> str:
            raw = "".join(self._chunks)
            # Collapse runs of whitespace; preserve paragraph breaks.
            lines = [_re.sub(r"[ \t\f\v]+", " ", ln).strip() for ln in raw.splitlines()]
            text = "\n".join(ln for ln in lines if ln)
            # Collapse 3+ blank lines to a single break.
            return _re.sub(r"\n{3,}", "\n\n", text)

    # ── build request ────────────────────────────────────────────────────────
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return {
            "ok": False, "status": None, "url": str(url), "title": None,
            "text": "", "length": 0, "bytes": 0,
            "error": "url must start with http:// or https://",
        }

    ua = user_agent or "xova-web_scrape/1.0 (+stdlib;no-js)"
    req = _u.Request(url, headers={
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "en",
    })

    # ── fetch ────────────────────────────────────────────────────────────────
    try:
        with _u.urlopen(req, timeout=timeout_s) as resp:
            status = getattr(resp, "status", None) or resp.getcode()
            final_url = resp.geturl()
            ctype = resp.headers.get("Content-Type", "")
            # Decide encoding: header charset > html meta > utf-8.
            charset = "utf-8"
            m = _re.search(r"charset=([\w\-]+)", ctype, _re.IGNORECASE)
            if m:
                charset = m.group(1)
            body = resp.read(max_bytes + 1)
    except _ue.HTTPError as exc:
        return {
            "ok": False, "status": getattr(exc, "code", None),
            "url": url, "title": None, "text": "", "length": 0, "bytes": 0,
            "error": f"HTTPError: {exc}",
        }
    except _ue.URLError as exc:
        return {
            "ok": False, "status": None, "url": url, "title": None,
            "text": "", "length": 0, "bytes": 0,
            "error": f"URLError: {exc.reason}",
        }
    except (TimeoutError, OSError) as exc:
        return {
            "ok": False, "status": None, "url": url, "title": None,
            "text": "", "length": 0, "bytes": 0,
            "error": f"{type(exc).__name__}: {exc}",
        }
    except Exception as exc:
        return {
            "ok": False, "status": None, "url": url, "title": None,
            "text": "", "length": 0, "bytes": 0,
            "error": f"unexpected: {type(exc).__name__}: {exc}",
        }

    truncated = len(body) > max_bytes
    if truncated:
        body = body[:max_bytes]

    # ── decode ───────────────────────────────────────────────────────────────
    try:
        html_text = body.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        html_text = body.decode("utf-8", errors="replace")

    # Refine charset from <meta charset="..."> if the header didn't carry one.
    if charset.lower() == "utf-8":
        m = _re.search(
            r'<meta[^>]+charset=["\']?([\w\-]+)["\']?',
            html_text[:4096],
            _re.IGNORECASE,
        )
        if m and m.group(1).lower() not in {"utf-8", "utf8"}:
            try:
                html_text = body.decode(m.group(1), errors="replace")
            except LookupError:
                pass

    # ── strip ────────────────────────────────────────────────────────────────
    parser = _Stripper()
    try:
        parser.feed(html_text)
        parser.close()
    except Exception:
        # Malformed HTML — give back what we have.
        pass

    text = parser.get_text()
    title = (parser.title or "").strip() or None
    if title:
        title = _hh.unescape(title)

    return {
        "ok": True,
        "status": int(status) if status is not None else None,
        "url": final_url,
        "title": title,
        "text": text,
        "length": len(text),
        "bytes": len(body) + (1 if truncated else 0),
        "error": None,
    }


# ── CLI smoke test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse, json, sys
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url", help="absolute HTTP(S) URL to fetch")
    ap.add_argument("--timeout", type=float, default=10.0)
    ap.add_argument("--max-bytes", type=int, default=1_000_000)
    ap.add_argument("--head", type=int, default=500,
                    help="print this many chars of text (default 500, 0=all)")
    args = ap.parse_args()
    r = fetch_page_text(args.url, args.timeout, args.max_bytes)
    out = {
        "ok": r["ok"], "status": r["status"], "url": r["url"],
        "title": r["title"], "length": r["length"], "bytes": r["bytes"],
        "error": r["error"],
        "text_head": r["text"][: args.head] if args.head else r["text"],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    sys.exit(0 if r["ok"] else 1)
