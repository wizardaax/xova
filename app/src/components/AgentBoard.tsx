import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const BOARD_PATH    = "C:\\Xova\\memory\\agent_board.json";
const FLAGS_PATH    = "C:\\Xova\\memory\\mesh_flags.json";
const DISPATCH_PATH = "C:\\Xova\\memory\\swarm_dispatch.json";

interface AgentEntry {
  alive: boolean;
  last_seen?: number;    // epoch ms (absorb/xova/jarvis)
  checkin_ts?: number;   // epoch s  (forge)
  current_task?: string;
  cycles?: number;
  forge_mode?: string;
  model?: string;
  capabilities?: string[];
  calls_this_hour?: number;
}
interface Board  { [k: string]: AgentEntry | number | undefined }
interface Flags  { [k: string]: unknown }
interface Dispatch {
  avg_coherence?: number;
  eval_score?: number;
  passed?: number;
  total_agents?: number;
  dispatched_at?: number;
}

const AGENT_ORDER = ["forge", "xova", "jarvis", "absorb"];
const AGENT_COLORS: Record<string, string> = {
  forge: "text-purple-400",
  xova:  "text-emerald-400",
  jarvis:"text-blue-400",
  absorb:"text-amber-400",
};

// Normalise last-seen to ms — agent_board has mixed formats
function lastSeenMs(entry: AgentEntry): number | undefined {
  if (entry.checkin_ts != null) return entry.checkin_ts * 1000;
  if (entry.last_seen  != null) return entry.last_seen;
  return undefined;
}

function ageColor(ms: number | undefined): string {
  if (ms == null) return "text-zinc-600";
  const age = (Date.now() - ms) / 1000;
  if (age > 120) return "text-red-400";
  if (age > 30)  return "text-amber-400";
  return "text-emerald-400";
}

function fmtAge(ms: number | undefined): string {
  if (ms == null) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 0)   return "future?";
  if (s < 60)  return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

function CoherenceBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  const color = value > 0.7 ? "bg-emerald-500" : value > 0.4 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-zinc-400 w-8 text-right">{(value).toFixed(3)}</span>
    </div>
  );
}

export function AgentBoard({ onClose }: { onClose: () => void }) {
  const [board,    setBoard]    = useState<Board | null>(null);
  const [flags,    setFlags]    = useState<Flags | null>(null);
  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [updatedAt,setUpdatedAt]= useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rawB, rawF, rawD] = await Promise.all([
        invoke<string>("xova_read_file", { path: BOARD_PATH    }).catch(() => "{}"),
        invoke<string>("xova_read_file", { path: FLAGS_PATH    }).catch(() => "{}"),
        invoke<string>("xova_read_file", { path: DISPATCH_PATH }).catch(() => "{}"),
      ]);
      setBoard(JSON.parse(rawB || "{}") as Board);
      setFlags(JSON.parse(rawF || "{}") as Flags);
      setDispatch(JSON.parse(rawD || "{}") as Dispatch);
      setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5_000); return () => clearInterval(id); }, [refresh]);

  const extraAgents = board
    ? Object.keys(board).filter(k => k !== "ts" && typeof board[k] === "object" && !AGENT_ORDER.includes(k))
    : [];
  const allAgents = [...AGENT_ORDER, ...extraAgents];

  const dispatchAge = dispatch?.dispatched_at
    ? Math.round((Date.now() / 1000 - dispatch.dispatched_at) / 60)
    : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Node Network{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {error && <div className="px-3 py-1 text-red-400 text-[10px] border-b border-red-900/40 bg-red-950/20 truncate">{error}</div>}
      {loading && !board && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      <div className="flex-1 overflow-y-auto">
        {/* Swarm stats */}
        {dispatch && (dispatch.avg_coherence != null || dispatch.eval_score != null) && (
          <div className="px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/20">
            <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1.5">
              swarm · {dispatch.passed}/{dispatch.total_agents} agents{dispatchAge != null ? ` · ${dispatchAge}m ago` : ""}
            </div>
            <div className="space-y-1">
              {dispatch.avg_coherence != null && <CoherenceBar value={dispatch.avg_coherence} label="coherence" />}
              {dispatch.eval_score    != null && <CoherenceBar value={dispatch.eval_score}    label="eval" />}
            </div>
          </div>
        )}

        {/* Agent nodes */}
        {board && (
          <div className="divide-y divide-zinc-900/60">
            {allAgents.map(name => {
              const entry = board[name] as AgentEntry | undefined;
              if (!entry || typeof entry !== "object") return null;
              const color = AGENT_COLORS[name] ?? "text-zinc-300";
              const ms    = lastSeenMs(entry);
              return (
                <div key={name} className="px-3 py-2 hover:bg-zinc-900/30">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${entry.alive ? "bg-emerald-400" : "bg-zinc-600"}`} />
                    <span className={`font-bold text-[11px] ${color}`}>{name}</span>
                    {entry.model && <span className="text-[9px] text-zinc-600 truncate max-w-[110px]">{entry.model}</span>}
                    <span className={`text-[9px] ml-auto ${ageColor(ms)}`}>{fmtAge(ms)}</span>
                  </div>
                  {entry.forge_mode && (
                    <div className="ml-4 mt-0.5 text-purple-400/80 text-[9px]">mode: {entry.forge_mode}</div>
                  )}
                  {entry.calls_this_hour != null && (
                    <div className="ml-4 mt-0.5 text-zinc-600 text-[9px]">calls: {entry.calls_this_hour}/20h</div>
                  )}
                  {entry.current_task && (
                    <div className="ml-4 mt-0.5 text-zinc-500 text-[9px] truncate">task: {entry.current_task}</div>
                  )}
                  {entry.cycles != null && (
                    <div className="ml-4 mt-0.5 text-zinc-600 text-[9px]">cycles: {entry.cycles}</div>
                  )}
                  {entry.capabilities && entry.capabilities.length > 0 && (
                    <div className="ml-4 mt-0.5 flex flex-wrap gap-0.5">
                      {entry.capabilities.slice(0, 5).map(c => (
                        <span key={c} className="text-[8px] px-1 py-0 rounded bg-zinc-800 text-zinc-500">{c}</span>
                      ))}
                      {entry.capabilities.length > 5 && (
                        <span className="text-[8px] text-zinc-600">+{entry.capabilities.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Mesh flags */}
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

        {board && allAgents.filter(n => board[n] && typeof board[n] === "object").length === 0 && !loading && (
          <div className="flex items-center justify-center h-32 text-zinc-600">no agents in board</div>
        )}
      </div>
    </div>
  );
}
