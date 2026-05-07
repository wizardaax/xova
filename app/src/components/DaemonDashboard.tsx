import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const BOARD = "C:\\Xova\\memory\\agent_board.json";

interface DaemonDef { id: string; name: string; log: string; boardKey: string | null }
const DAEMONS: DaemonDef[] = [
  { id: "watchdog",   name: "Watchdog",    log: "C:\\Xova\\memory\\watchdog.log",           boardKey: null },
  { id: "forge",      name: "Forge",       log: "C:\\Xova\\memory\\forge_listener.log",      boardKey: "forge" },
  { id: "absorb",     name: "Absorb Loop", log: "C:\\Xova\\memory\\absorb_loop.log",         boardKey: "absorb" },
  { id: "federation", name: "Federation",  log: "C:\\Xova\\memory\\federation_manager.log",  boardKey: null },
  { id: "sentinel",   name: "Sentinel",    log: "C:\\Xova\\memory\\sentinel.log",            boardKey: null },
  { id: "vite",       name: "Vite Dev",    log: "C:\\Xova\\memory\\vite.log",                boardKey: null },
];

function alive(board: Record<string, unknown>, d: DaemonDef): "alive" | "dead" | "unknown" {
  if (d.boardKey) {
    const entry = board[d.boardKey] as { alive?: boolean } | undefined;
    return entry?.alive === true ? "alive" : entry ? "dead" : "unknown";
  }
  if (d.id === "watchdog") return Object.keys(board).length > 0 ? "alive" : "unknown";
  if (d.id === "vite" || d.id === "federation") return "unknown";
  return "unknown";
}

export function DaemonDashboard({ onClose }: { onClose: () => void }) {
  const [board, setBoard] = useState<Record<string, unknown>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [loadingLog, setLoadingLog] = useState<string | null>(null);

  const refreshBoard = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: BOARD });
      setBoard(JSON.parse(raw));
    } catch { /* silent */ }
  }, []);

  const loadLog = useCallback(async (d: DaemonDef) => {
    setLoadingLog(d.id);
    try {
      const raw = await invoke<string>("xova_read_file", { path: d.log });
      const last20 = raw.split("\n").filter(Boolean).slice(-20).join("\n");
      setLogs(prev => ({ ...prev, [d.id]: last20 }));
    } catch {
      setLogs(prev => ({ ...prev, [d.id]: "(log not found)" }));
    }
    setLoadingLog(null);
  }, []);

  const toggleExpand = (d: DaemonDef) => {
    if (expanded === d.id) { setExpanded(null); return; }
    setExpanded(d.id);
    if (!logs[d.id]) loadLog(d);
  };

  useEffect(() => {
    refreshBoard();
    const id = setInterval(refreshBoard, 8000);
    return () => clearInterval(id);
  }, [refreshBoard]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Daemon Dashboard</span>
        <div className="flex items-center gap-2">
          <button onClick={refreshBoard} className="text-zinc-600 hover:text-zinc-300">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {DAEMONS.map(d => {
          const status = alive(board, d);
          const isOpen = expanded === d.id;
          return (
            <div key={d.id} className="border border-zinc-800 rounded-lg bg-zinc-900 overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="text-[13px]">{status === "alive" ? "🟢" : status === "dead" ? "🔴" : "⚪"}</span>
                <span className={`font-bold ${status === "alive" ? "text-zinc-100" : "text-zinc-500"}`}>{d.name}</span>
                <button
                  onClick={() => toggleExpand(d)}
                  className="ml-auto text-[9px] uppercase tracking-wider text-zinc-600 hover:text-emerald-400 border border-zinc-700 px-2 py-0.5 rounded"
                >
                  {isOpen ? "hide log" : "log ↓"}
                </button>
                {isOpen && (
                  <button onClick={() => loadLog(d)} disabled={loadingLog === d.id}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40 text-[10px]">
                    ↻
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="border-t border-zinc-800 bg-zinc-950 p-2">
                  {loadingLog === d.id && !logs[d.id] ? (
                    <div className="text-zinc-600 text-[10px]">loading…</div>
                  ) : (
                    <pre className="text-[9px] text-zinc-400 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                      {logs[d.id] || "(no log yet)"}
                    </pre>
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
