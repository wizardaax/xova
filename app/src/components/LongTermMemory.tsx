import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const LTM_PATH = "C:\\Xova\\memory\\long_term_memory.json";

interface CompletedGoal { id: string; text: string; }
interface LTMData {
  last_consolidation: number;
  period_hours: number;
  avg_coherence: number;
  avg_eval_score: number;
  top_missed_keywords: string[];
  completed_goals: CompletedGoal[];
  error_count: number;
  evolution_health: number;
  cycle_count: number;
  insights: string[];
}

function fmtAgo(ts: number): string {
  const s = Math.round(Date.now() / 1000 - (ts > 1e10 ? ts / 1000 : ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function LongTermMemory({ onClose }: { onClose: () => void }) {
  const [data,    setData]    = useState<LTMData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: LTM_PATH });
      setData(JSON.parse(raw) as LTMData);
      setErr("");
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Long-Term Memory</span>
        {data?.last_consolidation && (
          <span className="text-zinc-700 text-[8px]">consolidated {fmtAgo(data.last_consolidation)}</span>
        )}
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && err && <div className="flex-1 flex items-center justify-center text-red-400 text-[9px] px-4 text-center">{err}</div>}

      {data && (
        <div className="flex-1 overflow-y-auto">

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b border-zinc-800">
            {[
              { label: "cycles",      val: data.cycle_count },
              { label: "avg coh",     val: data.avg_coherence?.toFixed(3) },
              { label: "avg eval",    val: data.avg_eval_score?.toFixed(3) },
              { label: "evo health",  val: data.evolution_health?.toFixed(3) },
              { label: "period (h)",  val: data.period_hours },
              { label: "errors",      val: data.error_count },
            ].map(({ label, val }) => (
              <div key={label} className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[7px] text-zinc-600 mb-0.5">{label}</div>
                <div className="text-teal-300 font-bold text-[11px]">{val}</div>
              </div>
            ))}
          </div>

          {/* Insights */}
          {data.insights?.length > 0 && (
            <div className="px-3 py-2 border-b border-zinc-800">
              <div className="text-[8px] text-zinc-600 uppercase mb-1.5">insights</div>
              <div className="space-y-1">
                {data.insights.map((ins, i) => (
                  <div key={i} className="border-l-2 border-teal-800 pl-2 text-[9px] text-zinc-300 leading-snug">{ins}</div>
                ))}
              </div>
            </div>
          )}

          {/* Missed keywords */}
          {data.top_missed_keywords?.length > 0 && (
            <div className="px-3 py-2 border-b border-zinc-800">
              <div className="text-[8px] text-zinc-600 uppercase mb-1.5">top missed keywords</div>
              <div className="flex flex-wrap gap-1">
                {data.top_missed_keywords.map(kw => (
                  <span key={kw} className="text-[8px] px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-800 text-amber-300">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {/* Completed goals */}
          {data.completed_goals?.length > 0 && (
            <div className="px-3 py-2">
              <div className="text-[8px] text-zinc-600 uppercase mb-1.5">completed goals ({data.completed_goals.length})</div>
              <div className="space-y-1">
                {data.completed_goals.map(g => (
                  <div key={g.id} className="flex items-start gap-2 py-1 border-b border-zinc-900">
                    <span className="text-emerald-500 text-[9px] shrink-0 mt-0.5">✓</span>
                    <div>
                      <div className="text-[9px] text-zinc-300 leading-snug">{g.text}</div>
                      <div className="text-[7px] text-zinc-700 mt-0.5">{g.id}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
