import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY           = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN       = "C:\\Xova\\plugins\\threat_watch_probe.py";
const BROWSER_PLUGIN = "C:\\Xova\\plugins\\browser_control.py";

const INTERVAL_NORMAL = 120;  // seconds between scans when clear
const INTERVAL_ALERT  = 30;   // seconds when watch/alert

interface CheckStats { ok: boolean; [k: string]: unknown }
interface Checks {
  network:   CheckStats & { unusual_listeners: number; external_conns: number; close_wait: number };
  processes: CheckStats & { checked: number; flagged: number };
  auth:      CheckStats & { failed_logins_10m: number };
  files:     CheckStats & { recently_modified_60s: number };
}

interface ProbeResult {
  ok: boolean;
  level: "clear" | "watch" | "alert";
  rule_version: string;
  threats: string[];
  watches: string[];
  checks: Checks;
  scan_ms: number;
  ts: number;
  error?: string;
}

const LEVEL_STYLE = {
  clear: { ring: "border-emerald-800 bg-emerald-950/20", text: "text-emerald-400", dot: "bg-emerald-500",    label: "ALL CLEAR" },
  watch: { ring: "border-amber-700  bg-amber-950/25",   text: "text-amber-300",   dot: "bg-amber-400",     label: "WATCHING"  },
  alert: { ring: "border-red-700    bg-red-950/30",     text: "text-red-300",     dot: "bg-red-500 animate-pulse", label: "ALERT" },
};

const CHECK_DETAIL: Record<string, (c: Checks) => string> = {
  network:   c => `${c.network.external_conns} ext · ${c.network.unusual_listeners} odd port(s)`,
  processes: c => `${c.processes.checked} running · ${c.processes.flagged} flagged`,
  auth:      c => `${c.auth.failed_logins_10m} failed login(s) / 10 min`,
  files:     c => `${c.files.recently_modified_60s} memory file(s) changed / 60s`,
};

export function SecuritySentinel({ onClose, wideDock, onToggleWide }: {
  onClose: () => void;
  wideDock?: boolean;
  onToggleWide?: () => void;
}) {
  const [result, setResult]   = useState<ProbeResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [countdown, setCountdown] = useState(INTERVAL_NORMAL);
  const [scanAt, setScanAt]   = useState("");
  const nextRef   = useRef(Date.now() + INTERVAL_NORMAL * 1000);
  const tickRef   = useRef<number | null>(null);

  const [browserSite, setBrowserSite] = useState<"claude" | "grok" | "chatgpt">("claude");
  const [browserBusy, setBrowserBusy] = useState<string | null>(null);
  const [browserMsg, setBrowserMsg]   = useState<string | null>(null);

  const browserAction = useCallback(async (action: string) => {
    setBrowserBusy(action);
    setBrowserMsg(null);
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PY}" "${BROWSER_PLUGIN}" --action ${action} --site ${browserSite}`,
        cwd: "C:\\Xova", elevated: false,
      });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /**/ }
      const r = JSON.parse(stdout.trim()) as { ok: boolean; logged_in?: boolean; url?: string; path?: string; error?: string; needs_login?: boolean; msg?: string };
      if (!r.ok) {
        setBrowserMsg(r.needs_login ? "Not logged in — click Open to log in first" : (r.error ?? "error"));
      } else if (action === "check") {
        setBrowserMsg(r.logged_in ? `✓ Logged in  (${r.url ?? ""})` : "✗ Not logged in");
      } else if (action === "open") {
        setBrowserMsg(r.msg ?? "Browser opened");
      } else if (action === "screenshot") {
        setBrowserMsg(`Screenshot saved → ${r.path ?? ""}`);
      }
    } catch (e) {
      setBrowserMsg(String(e));
    }
    setBrowserBusy(null);
  }, [browserSite]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PY}" "${PLUGIN}"`, cwd: "C:\\Xova", elevated: false,
      });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /**/ }
      const r = JSON.parse(stdout.trim()) as ProbeResult;
      setResult(r);
      setScanAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      const interval = (r.level !== "clear") ? INTERVAL_ALERT : INTERVAL_NORMAL;
      nextRef.current = Date.now() + interval * 1000;
      setCountdown(interval);
    } catch (e) {
      setResult({ ok: false, error: String(e), level: "clear", rule_version: "?", threats: [], watches: [], checks: {} as Checks, scan_ms: 0, ts: Date.now() / 1000 });
    }
    setScanning(false);
  }, []);

  // Countdown + auto-rescan
  useEffect(() => {
    tickRef.current = window.setInterval(() => {
      const secs = Math.max(0, Math.round((nextRef.current - Date.now()) / 1000));
      setCountdown(secs);
      if (secs === 0) scan();
    }, 1000);
    return () => { if (tickRef.current !== null) clearInterval(tickRef.current); };
  }, [scan]);

  // Initial scan
  useEffect(() => { scan(); }, [scan]);

  const lvl = result?.ok ? (result.level ?? "clear") : "clear";
  const sty = LEVEL_STYLE[lvl];
  const hasIssues = (result?.threats.length ?? 0) + (result?.watches.length ?? 0) > 0;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* ── Header ─────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${sty.dot}`} />
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Security Sentinel
          {scanAt && <span className="ml-1.5 text-zinc-700">· {scanAt}</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-zinc-700 text-[9px] tabular-nums">{countdown}s</span>
          <button onClick={scan} disabled={scanning} title="Scan now"
            className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
          {onToggleWide && (
            <button onClick={onToggleWide} title={wideDock ? "Shrink" : "Expand"}
              className="text-zinc-600 hover:text-zinc-300 text-[12px]">{wideDock ? "⊡" : "⛶"}</button>
          )}
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      {/* ── Loading ────────────────────────────────── */}
      {scanning && !result && (
        <div className="flex-1 flex items-center justify-center text-zinc-600 gap-2">
          <span className="text-[9px] uppercase tracking-wider">scanning system…</span>
        </div>
      )}

      {/* ── Probe error ────────────────────────────── */}
      {result && !result.ok && (
        <div className="p-3">
          <div className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-500 text-[10px]">
            Probe unavailable — {result.error?.slice(0, 160)}
          </div>
        </div>
      )}

      {/* ── Main content ───────────────────────────── */}
      {result?.ok && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">

          {/* Level banner */}
          <div className={`rounded border px-3 py-2.5 flex items-center gap-3 ${sty.ring}`}>
            <span className={`w-3 h-3 rounded-full shrink-0 ${sty.dot}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-[13px] font-bold tracking-widest ${sty.text}`}>{sty.label}</div>
              <div className="text-zinc-500 text-[9px] mt-0.5">
                {lvl === "clear" && "No threats or anomalies detected"}
                {lvl === "watch" && `${result.watches.length} watch item(s) · no confirmed threat`}
                {lvl === "alert" && `${result.threats.length} threat(s) require attention`}
                {` · rule v${result.rule_version} · ${result.scan_ms}ms`}
              </div>
            </div>
            {lvl !== "clear" && (
              <span className={`text-[9px] font-bold shrink-0 ${sty.text}`}>
                {(result.threats.length + result.watches.length)}
              </span>
            )}
          </div>

          {/* Threat alert box */}
          {result.threats.length > 0 && (
            <div className="rounded border border-red-700 bg-red-950/30 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-red-800 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-[9px] uppercase tracking-wider text-red-400 font-semibold">Threats Detected</span>
              </div>
              <div className="divide-y divide-red-900/50">
                {result.threats.map((t, i) => (
                  <div key={i} className="px-3 py-2 text-red-200 text-[10px] leading-relaxed">⚠ {t}</div>
                ))}
              </div>
            </div>
          )}

          {/* Watch box */}
          {result.watches.length > 0 && (
            <div className="rounded border border-amber-800 bg-amber-950/20 overflow-hidden">
              <div className="px-3 py-1.5 border-b border-amber-900 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-[9px] uppercase tracking-wider text-amber-400">Watching</span>
              </div>
              <div className="divide-y divide-amber-900/40">
                {result.watches.map((w, i) => (
                  <div key={i} className="px-3 py-2 text-amber-200 text-[10px] leading-relaxed">◎ {w}</div>
                ))}
              </div>
            </div>
          )}

          {/* Check breakdown */}
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5">System Checks</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["network","processes","auth","files"] as const).map(key => {
                const chk = result.checks[key];
                const ok  = chk?.ok;
                return (
                  <div key={key} className={`rounded border px-2.5 py-2 ${ok ? "border-zinc-800 bg-zinc-900/40" : "border-amber-800 bg-amber-950/15"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-400"}`} />
                      <span className="text-zinc-400 text-[9px] uppercase tracking-wide">{key}</span>
                    </div>
                    <div className="text-zinc-600 text-[9px] leading-relaxed">{CHECK_DETAIL[key]?.(result.checks)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer info */}
          <div className="text-zinc-700 text-[9px] border-t border-zinc-900 pt-2 flex justify-between">
            <span>next scan {countdown}s · {lvl !== "clear" ? `${INTERVAL_ALERT}s` : `${INTERVAL_NORMAL}s`} interval</span>
            <span>rule v{result.rule_version}</span>
          </div>
        </div>
      )}

      {/* ── Browser AI ─────────────────────────────── */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950">
        <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center">
          <span className="text-[9px] uppercase tracking-wider text-zinc-500">🌐 Browser AI</span>
        </div>
        <div className="p-2.5 space-y-2">
          <div className="flex gap-1">
            {(["claude","grok","chatgpt"] as const).map(s => (
              <button key={s} onClick={() => setBrowserSite(s)}
                className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${
                  browserSite === s
                    ? "bg-emerald-900/40 border-emerald-700 text-emerald-300"
                    : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-600"
                }`}>
                {s === "claude" ? "Claude" : s === "grok" ? "Grok" : "ChatGPT"}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => browserAction("open")} disabled={!!browserBusy}
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[9px] text-zinc-300 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-40 transition-colors">
              {browserBusy === "open" ? "opening…" : "🖥 Open"}
            </button>
            <button onClick={() => browserAction("check")} disabled={!!browserBusy}
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[9px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40 transition-colors">
              {browserBusy === "check" ? "checking…" : "✓ Check"}
            </button>
            <button onClick={() => browserAction("screenshot")} disabled={!!browserBusy}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[9px] text-zinc-400 hover:border-zinc-500 disabled:opacity-40 transition-colors"
              title="Screenshot">
              {browserBusy === "screenshot" ? "…" : "📷"}
            </button>
          </div>
          {browserMsg && (
            <div className={`text-[9px] leading-relaxed ${browserMsg?.startsWith("✓") ? "text-emerald-400" : browserMsg?.startsWith("✗") || browserMsg?.includes("Not") ? "text-amber-400" : "text-zinc-400"}`}>
              {browserMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
