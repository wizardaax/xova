import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const TRACE_PATH = "C:\\Xova\\memory\\action_trace.jsonl";
const MAX_SHOW   = 200;

interface TraceEntry {
  ts:      number;
  action:  string;
  plugin:  string;
  summary: string;
}

const ACTION_COLOR: Record<string, string> = {
  read:     "bg-zinc-800/60 text-zinc-400 border-zinc-700",
  write:    "bg-blue-900/40 text-blue-300 border-blue-700",
  sweep:    "bg-cyan-900/40 text-cyan-300 border-cyan-700",
  snapshot: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  run:      "bg-zinc-800/60 text-zinc-400 border-zinc-700",
  error:    "bg-red-900/40 text-red-300 border-red-700",
  hook:     "bg-purple-900/40 text-purple-300 border-purple-700",
  build:    "bg-amber-900/40 text-amber-300 border-amber-700",
};
function actionCls(a: string) {
  return ACTION_COLOR[a] ?? "bg-zinc-800/60 text-zinc-400 border-zinc-700";
}
function fmtTs(ts: number) {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

export function ActionTrace({ onClose }: { onClose: () => void }) {
  const [entries, setEntries]     = useState<TraceEntry[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [err, setErr]             = useState("");
  const [textFilter, setTextFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: TRACE_PATH });
      const rows: TraceEntry[] = [];
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try { rows.push(JSON.parse(t) as TraceEntry); } catch { /* skip bad line */ }
      }
      rows.reverse();
      setEntries(rows.slice(0, MAX_SHOW));
      setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setErr("");
    } catch {
      setErr("no trace yet");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Action Trace
          {updatedAt && <span className="text-zinc-700 ml-1.5">· {updatedAt}</span>}
        </span>
        {entries.length > 0 && (
          <span className="text-zinc-700 text-[9px]">· {entries.length} entries</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="text-zinc-600 hover:text-zinc-300 text-[11px]">⟳</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0 flex-wrap">
        {Object.entries(ACTION_COLOR).map(([action, cls]) => (
          <span key={action} className={`text-[8px] px-1.5 py-px rounded border ${cls}`}>{action}</span>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-1.5 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        <input
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
          placeholder="filter…"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[9px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-500 min-w-0"
        />
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[9px] text-zinc-300 focus:outline-none"
        >
          <option value="all">all</option>
          {Object.keys(ACTION_COLOR).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {err && (
          <div className="p-4 text-zinc-600 text-[9px] text-center">{err}</div>
        )}
        {!err && entries.length === 0 && (
          <div className="p-4 text-zinc-700 text-[9px] text-center">no entries yet</div>
        )}
        {entries
          .filter(e =>
            (actionFilter === "all" || e.action === actionFilter) &&
            (!textFilter.trim() || e.plugin.toLowerCase().includes(textFilter.toLowerCase()) || e.summary.toLowerCase().includes(textFilter.toLowerCase()))
          )
          .map((e, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-1.5 border-b border-zinc-900 hover:bg-zinc-900/40">
              <span className="text-zinc-600 text-[9px] shrink-0 pt-px">{fmtTs(e.ts)}</span>
              <span className={`text-[8px] px-1.5 py-px rounded border shrink-0 ${actionCls(e.action)}`}>{e.action}</span>
              <span className="text-zinc-500 text-[9px] shrink-0">{e.plugin}</span>
              <span className="text-zinc-300 text-[10px] flex-1 min-w-0 truncate">{e.summary}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}
