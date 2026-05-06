import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const VIOLATIONS_PATH    = "C:\\Xova\\memory\\sentinel_violations.jsonl";
const SENTINEL_LOG_PATH  = "C:\\Xova\\memory\\sentinel.log";
const FORGE_LOG_PATH     = "C:\\Xova\\memory\\forge_listener.log";

type Source = "broker" | "forge" | string;
type View   = "violations" | "sentinel" | "forge";

interface Violation {
  ts:         number;
  source:     Source;
  context:    string;
  coherence:  number;
  violations: string[];
  key?:       string;
  agent?:     string;
}

const SOURCE_STYLE: Record<string, string> = {
  broker: "bg-orange-900/40 text-orange-300 border-orange-700",
  forge:  "bg-violet-900/40 text-violet-300 border-violet-700",
};

const REQ_COLOR: Record<string, string> = {
  "REQ-01": "text-red-400",
  "REQ-03": "text-amber-400",
  "REQ-04": "text-purple-400",
  "REQ-05": "text-purple-400",
};

function reqColor(msg: string): string {
  for (const [req, cls] of Object.entries(REQ_COLOR)) {
    if (msg.includes(req)) return cls;
  }
  return "text-zinc-400";
}

function fmtTs(ts: number): string {
  const d = new Date(ts > 1e10 ? ts : ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ts: number): string {
  const d = new Date(ts > 1e10 ? ts : ts * 1000);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function cohColor(c: number): string {
  return c >= 0.8 ? "#34d399" : c >= 0.5 ? "#fbbf24" : "#f87171";
}

export function SentinelLog({ onClose }: { onClose: () => void }) {
  const [view,       setView]       = useState<View>("violations");
  const [violations, setViolations] = useState<Violation[]>([]);
  const [rawSentinel, setRawSentinel] = useState<string[]>([]);
  const [rawForge,    setRawForge]    = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState("");
  const [srcFilter,  setSrcFilter]  = useState<Source | "all">("all");
  const [updatedAt,  setUpdatedAt]  = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const [vRaw, sRaw, fRaw] = await Promise.all([
      invoke<string>("xova_read_file", { path: VIOLATIONS_PATH }).catch(() => ""),
      invoke<string>("xova_read_file", { path: SENTINEL_LOG_PATH }).catch(() => ""),
      invoke<string>("xova_read_file", { path: FORGE_LOG_PATH }).catch(() => ""),
    ]);

    // parse violations JSONL newest-first
    const parsed: Violation[] = [];
    for (const line of vRaw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { parsed.push(JSON.parse(t) as Violation); } catch { /* skip */ }
    }
    setViolations(parsed.reverse());
    setRawSentinel(sRaw.split("\n").map(l => l.trimEnd()).filter(Boolean).reverse());
    setRawForge(fRaw.split("\n").map(l => l.trimEnd()).filter(Boolean).reverse().filter(l => l.includes("SCE-88")));
    setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // derive summary stats
  const last24h = violations.filter(v => (Date.now() / 1000 - v.ts) < 86400).length;
  const bySource: Record<string, number> = {};
  for (const v of violations) bySource[v.source] = (bySource[v.source] ?? 0) + 1;
  const reqCounts: Record<string, number> = {};
  for (const v of violations) {
    for (const msg of v.violations) {
      const m = msg.match(/REQ-\d+/)?.[0];
      if (m) reqCounts[m] = (reqCounts[m] ?? 0) + 1;
    }
  }

  const sources = Array.from(new Set(violations.map(v => v.source)));

  const filtered = violations.filter(v => {
    if (srcFilter !== "all" && v.source !== srcFilter) return false;
    if (!filter.trim()) return true;
    const hay = [v.context, v.source, ...(v.violations), v.key ?? "", v.agent ?? ""].join(" ").toLowerCase();
    return filter.toLowerCase().split(" ").every(w => hay.includes(w));
  });

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Sentinel{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {(["violations", "sentinel", "forge"] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${
                view === v
                  ? v === "violations" ? "border-red-700 text-red-300 bg-red-950/30"
                  : v === "forge"      ? "border-violet-700 text-violet-400 bg-violet-950/30"
                  :                      "border-zinc-600 text-zinc-300 bg-zinc-800"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}>
              {v === "violations" ? `violations${violations.length ? ` (${violations.length})` : ""}` : v}
            </button>
          ))}
        </div>
        <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Violations view */}
      {view === "violations" && (
        <>
          {/* Summary stats */}
          {violations.length > 0 && (
            <div className="px-3 py-2 border-b border-zinc-900 shrink-0 space-y-1.5">
              <div className="flex gap-3 flex-wrap">
                <span className="text-zinc-500">total <span className="text-red-400 font-bold">{violations.length}</span></span>
                <span className="text-zinc-500">24h <span className="text-amber-400 font-bold">{last24h}</span></span>
                {Object.entries(bySource).map(([src, n]) => (
                  <span key={src} className="text-zinc-500">{src} <span className="text-zinc-200 font-bold">{n}</span></span>
                ))}
              </div>
              {Object.keys(reqCounts).length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(reqCounts).sort().map(([req, n]) => (
                    <span key={req} className={`text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900 ${reqColor(req)}`}>
                      {req} ×{n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="px-3 py-1.5 border-b border-zinc-900 shrink-0 flex gap-1.5 items-center">
            <input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="filter…"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-emerald-600" />
            <select value={srcFilter} onChange={e => setSrcFilter(e.target.value as Source | "all")}
              className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-300 focus:outline-none">
              <option value="all">all sources</option>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {loading && violations.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
          )}
          {!loading && violations.length === 0 && (
            <div className="flex-1 flex items-center justify-center flex-col gap-2">
              <span className="text-emerald-400 text-[13px]">🛡</span>
              <span className="text-zinc-600">no violations recorded</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {filtered.map((v, i) => (
              <div key={i} className="border-b border-zinc-900 px-3 py-2 hover:bg-zinc-900/30 space-y-1">
                {/* top row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-zinc-600 text-[9px]">{fmtDate(v.ts)} {fmtTs(v.ts)}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-wider ${SOURCE_STYLE[v.source] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
                    {v.source}
                  </span>
                  {v.agent && <span className="text-zinc-600 text-[9px]">@{v.agent}</span>}
                  <span className="ml-auto text-[9px] font-bold tabular-nums" style={{ color: cohColor(v.coherence) }}>
                    coh {v.coherence.toFixed(3)}
                  </span>
                </div>
                {/* context */}
                <div className="text-zinc-500 text-[9px] truncate" title={v.context}>{v.context}</div>
                {/* violation list */}
                <div className="space-y-0.5">
                  {v.violations.map((msg, j) => (
                    <div key={j} className={`text-[10px] ${reqColor(msg)}`}>
                      · {msg}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Raw log views */}
      {(view === "sentinel" || view === "forge") && (
        <>
          <div className="px-3 py-1.5 border-b border-zinc-900 shrink-0">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter lines…"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-emerald-600" />
          </div>
          {(() => {
            const lines = (view === "sentinel" ? rawSentinel : rawForge)
              .filter(l => !filter.trim() || l.toLowerCase().includes(filter.toLowerCase()));
            if (loading && lines.length === 0)
              return <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>;
            if (!loading && lines.length === 0)
              return <div className="flex-1 flex items-center justify-center text-zinc-600">no lines</div>;
            return (
              <div className="flex-1 overflow-y-auto">
                {lines.map((line, i) => {
                  const u = line.toUpperCase();
                  const isAlert = u.includes("SCE-88") || u.includes("VIOLATION") || u.includes("ALERT");
                  return (
                    <div key={i} className={`px-3 py-0.5 border-b border-zinc-900/50 hover:bg-zinc-900/30 ${isAlert ? "bg-red-950/20" : ""}`}>
                      <span className={`break-all whitespace-pre-wrap ${isAlert ? "text-red-300" : "text-zinc-400"}`}>{line}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
