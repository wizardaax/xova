import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const BOARD_PATH = "C:\\Xova\\memory\\agent_board.json";
const FLAGS_PATH = "C:\\Xova\\memory\\mesh_flags.json";

interface AgentEntry { alive: boolean; last_seen?: number; current_task?: string; cycles?: number; forge_mode?: string }
interface Board { xova?: AgentEntry; jarvis?: AgentEntry; forge?: AgentEntry; absorb?: AgentEntry; ts?: number; [k: string]: AgentEntry | number | undefined }
interface Flags { [k: string]: unknown }

const AGENT_ORDER = ["xova", "jarvis", "forge", "absorb"];
const AGENT_COLORS: Record<string, string> = {
  xova: "text-emerald-400",
  jarvis: "text-blue-400",
  forge: "text-purple-400",
  absorb: "text-amber-400",
};

function ageColor(last_seen?: number): string {
  if (last_seen == null) return "text-zinc-600";
  // last_seen is epoch ms (matches agent_board.json actual schema)
  const age = (Date.now() - last_seen) / 1000;
  if (age > 120) return "text-red-400";
  if (age > 30) return "text-amber-400";
  return "text-emerald-400";
}

function fmtAge(last_seen?: number): string {
  if (last_seen == null) return "—";
  const s = Math.round((Date.now() - last_seen) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

export function AgentBoard({ onClose }: { onClose: () => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rawB, rawF] = await Promise.all([
        invoke<string>("xova_read_file", { path: BOARD_PATH }).catch(() => "{}"),
        invoke<string>("xova_read_file", { path: FLAGS_PATH }).catch(() => "{}"),
      ]);
      setBoard(JSON.parse(rawB || "{}") as Board);
      setFlags(JSON.parse(rawF || "{}") as Flags);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5_000); return () => clearInterval(id); }, [refresh]);

  const extraAgents = board ? Object.keys(board).filter(k => k !== "ts" && !AGENT_ORDER.includes(k)) : [];
  const allAgents = [...AGENT_ORDER, ...extraAgents];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Agent Board{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {error && <div className="px-3 py-1 text-red-400 text-[10px] border-b border-red-900/40 bg-red-950/20 truncate">{error}</div>}

      {loading && !board && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      {board && (
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-zinc-900/60">
            {allAgents.map(name => {
              const entry = board[name] as AgentEntry | undefined;
              if (!entry) return null;
              const color = AGENT_COLORS[name] ?? "text-zinc-300";
              return (
                <div key={name} className="px-3 py-2 hover:bg-zinc-900/30">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${entry.alive ? "bg-emerald-400" : "bg-red-500"}`} />
                    <span className={`font-bold text-[11px] ${color}`}>{name}</span>
                    <span className={`text-[9px] ml-auto ${ageColor(entry.last_seen)}`}>{fmtAge(entry.last_seen)}</span>
                  </div>
                  {entry.current_task && (
                    <div className="ml-4 mt-0.5 text-zinc-500 text-[9px] truncate">task: {entry.current_task}</div>
                  )}
                  {entry.forge_mode && (
                    <div className="ml-4 mt-0.5 text-purple-400/80 text-[9px]">mode: {entry.forge_mode}</div>
                  )}
                  {entry.cycles != null && (
                    <div className="ml-4 mt-0.5 text-zinc-600 text-[9px]">cycles: {entry.cycles}</div>
                  )}
                </div>
              );
            })}
          </div>

          {flags && Object.keys(flags).length > 0 && (
            <div className="border-t border-zinc-800 px-3 py-2">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5">mesh flags</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(flags).map(([k, v]) => (
                  <span key={k} className={`text-[9px] px-1.5 py-0.5 rounded border ${v ? "border-emerald-700 text-emerald-400 bg-emerald-900/20" : "border-zinc-700 text-zinc-500 bg-zinc-900"}`}>
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(!board || allAgents.filter(n => board[n]).length === 0) && !loading && (
            <div className="flex items-center justify-center h-32 text-zinc-600">no agents in board</div>
          )}
        </div>
      )}
    </div>
  );
}
