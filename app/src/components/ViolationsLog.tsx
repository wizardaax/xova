import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const VIOLATIONS_PATH = "C:\\Xova\\memory\\sentinel_violations.jsonl";

interface ViolationEntry {
  ts: number;
  source: string;
  context: string;
  coherence?: number;
  violations: string[];
  key?: string;
  agent?: string;
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

export function ViolationsLog({ onClose }: { onClose: () => void }) {
  const [entries,    setEntries]    = useState<ViolationEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [updatedAt,  setUpdatedAt]  = useState("");
  const [expanded,   setExpanded]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: VIOLATIONS_PATH });
      const parsed: ViolationEntry[] = raw
        .split("\n")
        .filter(Boolean)
        .map(l => { try { return JSON.parse(l) as ViolationEntry; } catch { return null; } })
        .filter((x): x is ViolationEntry => x !== null);
      setEntries(parsed);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { setEntries([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const shown       = [...entries].reverse().slice(0, 100);
  const uniqueAgents = new Set(entries.map(e => e.agent ?? e.source)).size;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Violations · {entries.length}{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-4 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">total</span>
          <span className="text-zinc-200">{entries.length}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">unique agents</span>
          <span className="text-zinc-200">{uniqueAgents}</span>
        </div>
      </div>

      {loading && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
      )}
      {!loading && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no violations</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {shown.map((e, i) => {
          const rowKey = `${e.ts}_${i}`;
          const isOpen = expanded === rowKey;
          return (
            <div key={rowKey}>
              <div
                onClick={() => setExpanded(isOpen ? null : rowKey)}
                className="flex items-start gap-2 px-3 py-1.5 border-b border-zinc-900/50 hover:bg-zinc-900/30 cursor-pointer"
              >
                <span className="text-zinc-600 text-[9px] shrink-0 w-14 pt-0.5">{fmtTime(e.ts)}</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded border bg-amber-900/40 text-amber-300 border-amber-700 shrink-0">{e.source}</span>
                <span className="text-red-400 text-[9px] shrink-0">⚠ {e.violations.length}</span>
                <span className="text-zinc-500 text-[9px] truncate flex-1">{e.key ?? e.context}</span>
                <span className="text-zinc-600 text-[9px] shrink-0">{isOpen ? "▲" : "▼"}</span>
              </div>
              {isOpen && (
                <div className="px-3 pb-2 pt-1 space-y-0.5 bg-zinc-900/20">
                  {e.violations.map((v, vi) => (
                    <div key={vi} className="text-[8px] text-red-300/80 leading-snug border-l-2 border-red-900 pl-2 py-0.5">{v}</div>
                  ))}
                  {e.coherence !== undefined && (
                    <div className="text-[8px] text-zinc-500 pl-2">coh={e.coherence}</div>
                  )}
                  {e.agent && (
                    <div className="text-[8px] text-zinc-600 pl-2">agent: {e.agent}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
