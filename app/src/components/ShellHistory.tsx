import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface HistoryEntry { ts: string; cmd: string; cwd_before: string; exit: number; stdout: string; stderr: string }
interface SessionFile { history: HistoryEntry[] }

export function ShellHistory({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\xova_shell\\session.json" });
      const session: SessionFile = JSON.parse(raw);
      setRows((session.history ?? []).slice().reverse());
    } catch { setRows([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = filter.trim()
    ? rows.filter(r => r.cmd.toLowerCase().includes(filter.toLowerCase()) || r.stdout.toLowerCase().includes(filter.toLowerCase()))
    : rows;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Shell History{!loading ? ` (${rows.length})` : ""}</span>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-zinc-600 hover:text-zinc-300">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>
      <div className="px-3 py-2 shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter commands…"
          className="w-full bg-zinc-900 text-zinc-200 placeholder-zinc-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-600 border border-zinc-700" />
      </div>
      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && visible.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no entries</div>}
      {!loading && visible.length > 0 && (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
          {visible.map((r, i) => (
            <div key={i} className="border border-zinc-800 rounded bg-zinc-900 px-3 py-2">
              <button onClick={() => setExpanded(expanded === i ? null : i)} className="w-full text-left">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-zinc-600 text-[9px] shrink-0">{r.ts.slice(0, 19).replace("T", " ")}</span>
                  <span className="text-zinc-500 text-[9px] truncate shrink-0 max-w-[100px]">{r.cwd_before.split("\\").pop()}</span>
                  <span className={`ml-auto text-[9px] shrink-0 ${r.exit === 0 ? "text-emerald-400" : "text-red-400"}`}>exit {r.exit}</span>
                </div>
                <div className="text-zinc-100 text-[11px] truncate">{r.cmd}</div>
                {(r.stdout || r.stderr) && expanded !== i && (
                  <div className="text-zinc-500 text-[9px] truncate mt-0.5">{(r.stdout || r.stderr).split("\n")[0].slice(0, 120)}</div>
                )}
              </button>
              {expanded === i && (r.stdout || r.stderr) && (
                <pre className="mt-1 text-[9px] text-zinc-400 bg-zinc-950 rounded p-1 overflow-x-auto whitespace-pre-wrap max-h-32">{r.stdout || r.stderr}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
