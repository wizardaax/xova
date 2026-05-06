import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const CMD = `python "C:\\Xova\\plugins\\federation_status.py"`;

interface RepoStatus {
  repo_name: string; task_types: string[]; agent_count: number;
  healthy: boolean; load: number; coherence: number;
}
interface FedStatus {
  version?: string; repos: Record<string, RepoStatus>;
  repo_count: number; total_agents: number; global_coherence: number;
  constraint_violations: number; drift: number;
}
interface CoherenceSnap { global_coherence: number; repos: Record<string, unknown> }
interface ParsedResult { ok: boolean; status?: FedStatus; coherence?: CoherenceSnap; error?: string; note?: string }

export function FederationPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<ParsedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_run", { command: CMD, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      const parsed = JSON.parse(stdout) as ParsedResult;
      setData(parsed);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { setData({ ok: false, error: "plugin not ready" }); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  const fed = data?.status;
  const coh = data?.coherence;
  const gc = fed?.global_coherence ?? coh?.global_coherence ?? 0;
  const gcColor = gc >= 0.8 ? "#34d399" : gc >= 0.5 ? "#fbbf24" : "#f87171";

  const repos = Object.values(fed?.repos ?? {}) as RepoStatus[];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Federation{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && !data && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      {data?.note && !fed && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-amber-400 text-[10px]">{data.note}</span>
          <span className="text-zinc-600 text-[9px]">Run C:\Xova\plugins\federation_status.py to populate</span>
        </div>
      )}

      {(fed || coh) && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-900 rounded p-2 text-center">
              <div className="text-[9px] text-zinc-500 uppercase">coherence</div>
              <div className="font-bold mt-0.5" style={{ color: gcColor }}>{gc.toFixed(3)}</div>
            </div>
            <div className="bg-zinc-900 rounded p-2 text-center">
              <div className="text-[9px] text-zinc-500 uppercase">repos</div>
              <div className="font-bold mt-0.5 text-zinc-200">{fed?.repo_count ?? repos.length}</div>
            </div>
            <div className="bg-zinc-900 rounded p-2 text-center">
              <div className="text-[9px] text-zinc-500 uppercase">agents</div>
              <div className="font-bold mt-0.5 text-zinc-200">{fed?.total_agents ?? "—"}</div>
            </div>
          </div>

          {fed && (fed.constraint_violations > 0 || fed.drift > 0) && (
            <div className="flex gap-2">
              <div className={`flex-1 rounded p-1.5 text-center text-[10px] border ${fed.constraint_violations > 0 ? "bg-red-900/30 text-red-300 border-red-700" : "bg-zinc-900 text-zinc-600 border-zinc-800"}`}>
                {fed.constraint_violations} violations
              </div>
              <div className={`flex-1 rounded p-1.5 text-center text-[10px] border ${fed.drift > 0.1 ? "bg-amber-900/30 text-amber-300 border-amber-700" : "bg-zinc-900 text-zinc-600 border-zinc-800"}`}>
                drift {fed.drift.toFixed(3)}
              </div>
            </div>
          )}

          {repos.length > 0 && (
            <div>
              <div className="text-[9px] text-zinc-600 uppercase mb-1">Repos</div>
              {repos.map(r => (
                <div key={r.repo_name} className="flex items-center gap-2 py-0.5 border-b border-zinc-900/50">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${r.healthy ? "bg-emerald-400" : "bg-red-500"}`} />
                  <span className="text-zinc-300 flex-1 truncate">{r.repo_name}</span>
                  <span className="text-zinc-500 text-[9px]">{r.agent_count}a</span>
                  <span className="text-[9px]" style={{ color: r.coherence >= 0.8 ? "#34d399" : r.coherence >= 0.5 ? "#fbbf24" : "#f87171" }}>
                    {r.coherence?.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
