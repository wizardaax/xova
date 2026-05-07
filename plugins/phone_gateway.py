"""
phone_gateway.py — LAN HTTP gateway for phone-to-Xova remote control.

Run this on the PC. Open http://<PC-LAN-IP>:7340 in your phone browser.
No cloud. No auth. LAN only. Stdlib only.

Endpoints:
  GET  /         serve the PWA (single-page mobile UI)
  POST /msg      send a message to Forge (writes forge_inbox.json)
  GET  /replies  read forge_outbox.json entries since ?since=<ms>
  GET  /status   LAN IP, port, active goal, forge mode
"""
import http.server, json, os, socket, sys, time

PORT         = 7340
FORGE_INBOX  = r"C:\Xova\memory\forge_inbox.json"
FORGE_OUTBOX = r"C:\Xova\memory\forge_outbox.json"
GOAL_STORE   = r"C:\Xova\memory\goal_store.json"
AGENT_BOARD  = r"C:\Xova\memory\agent_board.json"
MESH_FLAGS   = r"C:\Xova\memory\mesh_flags.json"
STATE_PATH   = r"C:\Xova\memory\phone_gateway_state.json"

_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

_PWA = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Xova</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",monospace;font-size:14px;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
#hdr{padding:max(12px,env(safe-area-inset-top)) 14px 10px;background:#18181b;border-bottom:1px solid #27272a;display:flex;align-items:center;gap:8px;flex-shrink:0}
#logo{font-weight:700;font-size:15px;color:#a78bfa}
#goal{font-size:10px;color:#71717a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#dot{width:7px;height:7px;border-radius:50%;background:#f87171;flex-shrink:0;transition:background .3s}
#dot.on{background:#22c55e}
#feed{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px;-webkit-overflow-scrolling:touch}
.b{padding:9px 13px;border-radius:16px;max-width:85%;line-height:1.5;white-space:pre-wrap;word-break:break-word;font-size:13px}
.b.adam{background:#4f46e5;align-self:flex-end;border-bottom-right-radius:4px}
.b.forge{background:#1c1c1e;align-self:flex-start;border-bottom-left-radius:4px;border-left:2px solid #6366f1}
.b.sys{background:transparent;align-self:center;color:#52525b;font-size:10px;text-align:center}
#bar{padding:8px 12px;padding-bottom:max(8px,env(safe-area-inset-bottom));background:#18181b;border-top:1px solid #27272a;display:flex;gap:8px;align-items:flex-end;flex-shrink:0}
#inp{flex:1;background:#27272a;border:1px solid #3f3f46;color:#e4e4e7;padding:10px 14px;border-radius:22px;font-size:14px;font-family:inherit;outline:none;resize:none;max-height:120px;min-height:40px;line-height:1.4}
#inp:focus{border-color:#6366f1}
#btn{background:#4f46e5;color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
#btn:active{background:#6366f1}
</style>
</head>
<body>
<div id="hdr"><div id="logo">Xova</div><div id="goal">connecting...</div><div id="dot"></div></div>
<div id="feed"><div class="b sys">Xova Remote &bull; LAN only</div></div>
<div id="bar">
<textarea id="inp" rows="1" placeholder="Message Xova..." autocomplete="off"></textarea>
<button id="btn">&#8593;</button>
</div>
<script>
let lastTs = Date.now();
async function send(){
  const inp=document.getElementById('inp');
  const t=inp.value.trim(); if(!t) return;
  inp.value=''; inp.style.height='';
  add('adam',t);
  try{
    const r=await fetch('/msg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:t})});
    if(!r.ok) add('sys','send failed: '+r.status);
  }catch(e){add('sys','offline: '+e.message);}
}
document.getElementById('btn').onclick=send;
document.getElementById('inp').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
document.getElementById('inp').addEventListener('input',function(){this.style.height='';this.style.height=Math.min(this.scrollHeight,120)+'px';});
function add(cls,text){
  const f=document.getElementById('feed');
  const d=document.createElement('div'); d.className='b '+cls; d.textContent=text;
  f.appendChild(d); f.scrollTop=f.scrollHeight;
}
async function poll(){
  try{
    const r=await fetch('/replies?since='+lastTs);
    const d=await r.json();
    for(const m of(d.replies||[])){
      if(m.ts<=lastTs) continue;
      lastTs=m.ts;
      add('forge',m.text||m.content||'');
    }
    const s=await fetch('/status');
    const sd=await s.json();
    document.getElementById('goal').textContent=sd.active_goal||'ready';
    document.getElementById('dot').className=sd.online?'on':'';
  }catch(e){document.getElementById('dot').className='';}
}
setInterval(poll,2500); poll();
</script>
</body>
</html>"""


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _read_json(path: str) -> object:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in _CORS.items(): self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        qs: dict[str, str] = {}
        if "?" in self.path:
            for p in self.path.split("?", 1)[1].split("&"):
                if "=" in p:
                    k, v = p.split("=", 1); qs[k] = v

        if path == "/":
            body = _PWA.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            for k, v in _CORS.items(): self.send_header(k, v)
            self.end_headers(); self.wfile.write(body); return

        if path == "/replies":
            since = int(qs.get("since", 0))
            replies = []
            try:
                data = _read_json(FORGE_OUTBOX)
                if isinstance(data, list):
                    replies = [e for e in data if e.get("ts", 0) > since and e.get("from") == "forge"]
            except Exception:
                pass
            self._json({"replies": replies[-30:]})
            return

        if path == "/status":
            goal = None
            try:
                gs = _read_json(GOAL_STORE)
                if gs:
                    gid = gs.get("active_goal")
                    if gid:
                        goal = gs["goals"].get(gid, {}).get("text", "")[:120]
            except Exception:
                pass
            flags = _read_json(MESH_FLAGS) or {}
            self._json({
                "online":      True,
                "ip":          _lan_ip(),
                "port":        PORT,
                "active_goal": goal,
                "forge_mode":  flags.get("forgeMode", "unknown"),
                "ts":          time.time(),
            })
            return

        self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path.split("?")[0] != "/msg":
            self.send_response(404); self.end_headers(); return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
            text = str(payload.get("content") or payload.get("text") or "").strip()
            if not text:
                self._json({"ok": False, "error": "empty message"}, 400); return
            msg = {
                "ts":             int(time.time()),
                "from":           "phone",
                "text":           text,
                "correlation_id": f"phone-{int(time.time() * 1000)}",
            }
            tmp = FORGE_INBOX + ".tmp"
            os.makedirs(os.path.dirname(FORGE_INBOX), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(msg, fh, ensure_ascii=False)
            os.replace(tmp, FORGE_INBOX)
            self._json({"ok": True, "ts": msg["ts"]})
        except Exception as exc:
            self._json({"ok": False, "error": str(exc)}, 500)

    def _json(self, data: dict, code: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in _CORS.items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)


def main() -> None:
    ip  = _lan_ip()
    url = f"http://{ip}:{PORT}"

    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as fh:
        json.dump({"url": url, "ip": ip, "port": PORT,
                   "pid": os.getpid(), "started_at": time.time()}, fh,
                  ensure_ascii=False)

    print(f"[phone_gateway] {url}", flush=True)

    server = http.server.HTTPServer(("0.0.0.0", PORT), _Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
