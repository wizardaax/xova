import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY     = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN = "C:\\Xova\\plugins\\browser_control.py";

type Site = "claude" | "grok" | "chatgpt";
const SITES: { id: Site; label: string }[] = [
  { id: "claude",   label: "Claude.ai"  },
  { id: "grok",     label: "Grok"       },
  { id: "chatgpt",  label: "ChatGPT"    },
];

interface BrowserResult {
  ok: boolean;
  action?: string;
  url?: string;
  logged_in?: boolean;
  selector_found?: string;
  response?: string;
  prompt?: string;
  path?: string;
  bytes?: number;
  error?: string;
  needs_login?: boolean;
  login_url?: string;
  msg?: string;
}

async function runPlugin(args: string[]): Promise<BrowserResult> {
  const command = `"${PY}" "${PLUGIN}" ${args.join(" ")}`;
  const raw = await invoke<string>("xova_run", { command, cwd: "C:\\Xova", elevated: false });
  let stdout = raw;
  try {
    const w = JSON.parse(raw) as { stdout?: string };
    if (w.stdout !== undefined) stdout = w.stdout;
  } catch { /**/ }
  return JSON.parse(stdout.trim()) as BrowserResult;
}

export function BrowserControl({ onClose }: { onClose: () => void }) {
  const [site, setSite]       = useState<Site>("claude");
  const [prompt, setPrompt]   = useState("");
  const [busy, setBusy]       = useState<string | null>(null); // action name while running
  const [result, setResult]   = useState<BrowserResult | null>(null);
  const [loginStatus, setLoginStatus] = useState<Record<Site, boolean | null>>({
    claude: null, grok: null, chatgpt: null,
  });
  async function doAction(action: string, extra: string[] = []) {
    setBusy(action);
    setResult(null);
    try {
      const r = await runPlugin(["--action", action, "--site", site, ...extra]);
      setResult(r);
      if (action === "check") {
        setLoginStatus(prev => ({ ...prev, [site]: r.logged_in ?? false }));
      }
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    }
    setBusy(null);
  }

  const loginOk = loginStatus[site];
  const loginDot = loginOk === null ? "bg-zinc-600" : loginOk ? "bg-emerald-500" : "bg-red-500";
  const loginLabel = loginOk === null ? "unknown" : loginOk ? "logged in" : "not logged in";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Browser Control</span>
        <button onClick={onClose} className="ml-auto text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Site selector + login status */}
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider text-zinc-600">Site</div>
          <div className="flex gap-1.5">
            {SITES.map(s => (
              <button key={s.id} onClick={() => setSite(s.id)}
                className={`px-2.5 py-1 rounded border text-[10px] transition-colors ${
                  site === s.id
                    ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600"
                }`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${loginDot}`} />
            <span className="text-zinc-600 text-[9px]">{loginLabel}</span>
            <button onClick={() => doAction("check")} disabled={!!busy}
              className="ml-auto text-[9px] text-zinc-600 hover:text-zinc-300 disabled:opacity-40 border border-zinc-800 rounded px-1.5 py-0.5">
              {busy === "check" ? "checking…" : "✓ Check Login"}
            </button>
          </div>
        </div>

        {/* Open browser for login */}
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider text-zinc-600">Session Setup</div>
          <button onClick={() => doAction("open")} disabled={!!busy}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-[10px] text-zinc-300 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-40 transition-colors">
            {busy === "open" ? "opening browser…" : "🖥  Open Browser for Login"}
          </button>
          <div className="text-zinc-700 text-[9px]">Opens a visible browser window. Log in, then close it — session is saved.</div>
        </div>

        {/* Prompt + Send */}
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider text-zinc-600">Send Prompt</div>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Enter prompt to send…"
            rows={4}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-[10px] text-zinc-200 placeholder-zinc-700 resize-y focus:outline-none focus:border-emerald-700"
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && prompt.trim()) doAction("send", ["--prompt", JSON.stringify(prompt)]); }}
          />
          <div className="flex gap-1.5">
            <button onClick={() => { if (prompt.trim()) doAction("send", ["--prompt", JSON.stringify(prompt)]); }}
              disabled={!!busy || !prompt.trim()}
              className="flex-1 rounded border border-emerald-800 bg-emerald-950/30 px-3 py-1.5 text-[10px] text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40 transition-colors">
              {busy === "send" ? "sending…" : "▶ Send  (Ctrl+↵)"}
            </button>
            <button onClick={() => doAction("screenshot")} disabled={!!busy}
              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-40 transition-colors"
              title="Take screenshot">
              {busy === "screenshot" ? "…" : "📷"}
            </button>
          </div>
        </div>

        {/* Result */}
        {result && (
          <div className={`rounded border overflow-hidden ${result.ok ? "border-zinc-800" : "border-red-800 bg-red-950/20"}`}>
            <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${result.ok ? "bg-emerald-500" : "bg-red-500"}`} />
              <span className="text-[9px] uppercase tracking-wider text-zinc-500">
                {result.ok ? (result.action ?? "result") : "error"}
              </span>
              {result.url && (
                <span className="ml-auto text-[9px] text-zinc-700 truncate max-w-[180px]">{result.url}</span>
              )}
            </div>

            <div className="p-3 space-y-2">
              {/* Error */}
              {!result.ok && (
                <div className="text-red-300 text-[10px] leading-relaxed">
                  {result.needs_login
                    ? <>Not logged in — <span className="text-amber-300">open the browser above and log in first</span></>
                    : result.error}
                </div>
              )}

              {/* Check result */}
              {result.ok && result.action === undefined && result.logged_in !== undefined && (
                <div className={`text-[10px] ${result.logged_in ? "text-emerald-300" : "text-amber-300"}`}>
                  {result.logged_in ? "✓ Logged in" : "✗ Not logged in — use Open Browser to log in"}
                </div>
              )}
              {result.ok && result.logged_in !== undefined && result.selector_found && (
                <div className="text-zinc-600 text-[9px]">selector: {result.selector_found}</div>
              )}

              {/* Open result */}
              {result.ok && result.action === "open" && result.msg && (
                <div className="text-emerald-300 text-[10px]">{result.msg}</div>
              )}

              {/* Send result */}
              {result.ok && result.response && (
                <>
                  <div className="text-zinc-600 text-[9px] border-b border-zinc-800 pb-1">Response</div>
                  <div className="text-zinc-200 text-[10px] leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {result.response}
                  </div>
                </>
              )}

              {/* Screenshot result */}
              {result.ok && result.action === "screenshot" && result.path && (
                <div className="text-emerald-300 text-[10px]">
                  Saved → {result.path}
                  {result.bytes && <span className="text-zinc-600 ml-1.5">({(result.bytes / 1024).toFixed(1)} KB)</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading state */}
        {busy && (
          <div className="text-zinc-600 text-[9px] text-center animate-pulse">
            {busy === "open" && "Opening browser window…"}
            {busy === "send" && "Sending prompt and waiting for response…"}
            {busy === "screenshot" && "Taking screenshot…"}
            {busy === "check" && "Checking login status…"}
          </div>
        )}

      </div>
    </div>
  );
}
