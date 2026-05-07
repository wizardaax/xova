import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const STORE_PATH = "C:\\Xova\\memory\\self_eval_store.json";

interface StrategyEntry {
  strategy: string;
  score: number;
  ts: number;
  goal_id: string;
}

interface HistoryEntry {
  ts: number;
  agent: string;
  goal_id: string;
  score: number;
  hit: string[];
  missed: string[];
  strategy: string;
  output_snippet?: string;
}

interface SelfEvalData {
  version: number;
  strategies: Record<string, StrategyEntry>;
  history: HistoryEntry[];
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function scoreColor(s: number) {
  if (s >= 0.8) return "text-emerald-300";
  if (s >= 0.5) return "text-amber-300";
  return "text-red-400";
}

export function SelfEvalStore({ onClose }: { onClose: () => void }) {
  const [data,    setData]    = useState<SelfEvalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");
  const [view,    setView]    = useState<"strategies" | "history">("strategies");
  const [expanded, setExpanded] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: STORE_PATH });
      setData(JSON.parse(raw) as SelfEvalData);
      setErr("");
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const strategies = Object.entries(data?.strategies ?? {});
  const history    = [...(data?.history ?? [])].reverse().slice(0, 60);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Self-Eval Store</span>
        <div className="flex gap-1 ml-auto">
          {(["strategies", "history"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${
                view === v ? "border-teal-600 text-teal-300 bg-teal-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}>
              {v === "strategies" ? `strategies (${strategies.length})` : `history (${data?.history?.length ?? 0})`}
            </button>
          ))}
        </div>
        <button onClick={refresh} className="text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && err && <div className="flex-1 flex items-center justify-center text-red-400 text-[9px]">{err}</div>}

      {/* Strategies view */}
      {!loading && !err && view === "strategies" && (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
          {strategies.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-zinc-600">no strategies</div>
          )}
          {strategies.map(([agent, s]) => (
            <div key={agent} className="bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-zinc-100 text-[10px] font-semibold">{agent}</span>
                <span className={`text-[11px] font-bold ml-auto ${scoreColor(s.score)}`}>{s.score.toFixed(3)}</span>
              </div>
              <div className="text-[9px] text-zinc-400 leading-snug">{s.strategy}</div>
              <div className="text-[7px] text-zinc-700 mt-1">{s.goal_id} · {fmtTime(s.ts)}</div>
            </div>
          ))}
        </div>
      )}

      {/* History view */}
      {!loading && !err && view === "history" && (
        <div className="flex-1 overflow-y-auto">
          {history.map((h, i) => {
            const isOpen = expanded === i;
            return (
              <div key={i}>
                <div onClick={() => setExpanded(isOpen ? null : i)}
                  className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-900/50 hover:bg-zinc-900/30 cursor-pointer">
                  <span className="text-zinc-600 text-[9px] shrink-0 w-10">{fmtTime(h.ts)}</span>
                  <span className="text-zinc-400 text-[9px] shrink-0">{h.agent}</span>
                  <span className={`text-[9px] font-bold shrink-0 ${scoreColor(h.score)}`}>{h.score.toFixed(3)}</span>
                  {h.missed.length > 0 && (
                    <span className="text-zinc-600 text-[8px] truncate flex-1">miss:{h.missed.slice(0,3).join(",")}{h.missed.length > 3 ? `+${h.missed.length-3}` : ""}</span>
                  )}
                  <span className="text-zinc-700 text-[9px]">{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && (
                  <div className="px-3 pb-2 pt-1 bg-zinc-900/20 space-y-1">
                    <div className="text-[8px] text-zinc-500 italic leading-snug">{h.strategy}</div>
                    {h.output_snippet && (
                      <div className="text-[8px] text-zinc-600 leading-snug truncate">{h.output_snippet}</div>
                    )}
                    <div className="flex gap-3 text-[7px]">
                      {h.hit.length > 0 && (
                        <span className="text-emerald-600">hit: {h.hit.join(", ")}</span>
                      )}
                      {h.missed.length > 0 && (
                        <span className="text-red-600">miss: {h.missed.join(", ")}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
