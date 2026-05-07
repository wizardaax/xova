import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const DISPATCH_FILE = "C:\\Xova\\memory\\swarm_dispatch.json";

interface RoutedAgent {
  agent: string;
  task_type: string;
  delivered: boolean;
}

interface DispatchData {
  run_id: string;
  goal_id: string;
  goal_text: string;
  dispatched_at: number;
  task_types: string[];
  routed: RoutedAgent[];
  passed: number;
  total_agents: number;
  avg_coherence: number;
  gated: number;
  eval_score: number;
  elapsed_s: number;
}

function fmtAgo(ts: number): string {
  const s = Math.round(Date.now() / 1000 - (ts > 1e10 ? ts / 1000 : ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtTime(ts: number): string {
  const ms = ts > 1e10 ? ts : ts * 1000;
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SwarmDispatch({ onClose }: { onClose: () => void }) {
  const [data,      setData]      = useState<DispatchData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: DISPATCH_FILE });
      setData(JSON.parse(raw) as DispatchData);
      setErr("");
      setUpdatedAt(fmtTime(Date.now() / 1000));
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500 flex-1">
          Swarm Dispatch{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} className="text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && err && <div className="flex-1 flex items-center justify-center text-red-400 text-[9px]">{err}</div>}
      {!loading && !err && !data && <div className="flex-1 flex items-center justify-center text-zinc-600">no dispatch data</div>}

      {data && (
        <div className="flex flex-col flex-1 min-h-0">

          <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
            <div className="flex gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] text-zinc-600 uppercase">run</span>
                <span className="text-zinc-200">{data.run_id}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] text-zinc-600 uppercase">dispatched</span>
                <span className="text-zinc-200">{fmtAgo(data.dispatched_at)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] text-zinc-600 uppercase">elapsed</span>
                <span className="text-zinc-200">{data.elapsed_s?.toFixed(2)}s</span>
              </div>
            </div>
          </div>

          <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "passed",   val: `${data.passed}/${data.total_agents}` },
                { label: "avg coh",  val: data.avg_coherence?.toFixed(3) },
                { label: "eval",     val: data.eval_score?.toFixed(3) },
                { label: "gated",    val: String(data.gated) },
              ].map(({ label, val }) => (
                <div key={label} className="bg-zinc-900 rounded p-1.5 text-center">
                  <div className="text-[7px] text-zinc-600 mb-0.5">{label}</div>
                  <div className="text-teal-300 font-bold text-[12px]">{val}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
            <div className="text-[8px] text-zinc-600 uppercase mb-1">goal</div>
            <div className="text-[10px] text-zinc-300 leading-snug">{data.goal_text}</div>
            <div className="text-[8px] text-zinc-600 mt-0.5">{data.goal_id}</div>
          </div>

          <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
            <div className="text-[8px] text-zinc-600 uppercase mb-1">task types</div>
            <div className="flex flex-wrap gap-1">
              {data.task_types?.map(t => (
                <span key={t} className="text-[8px] px-1.5 py-0.5 rounded bg-violet-900/40 border border-violet-700 text-violet-300">{t}</span>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <div className="text-[8px] text-zinc-600 uppercase mb-1">routed ({data.routed?.length ?? 0})</div>
            {data.routed?.map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1 border-b border-zinc-900">
                <span className="text-zinc-300 text-[10px] flex-1">{r.agent}</span>
                <span className="text-zinc-600 text-[9px]">{r.task_type}</span>
                {r.delivered
                  ? <span className="text-emerald-400 text-[9px]">✓</span>
                  : <span className="text-red-400 text-[9px]">✗</span>
                }
              </div>
            ))}
          </div>

        </div>
      )}
    </div>
  );
}
