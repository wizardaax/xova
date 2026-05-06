import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN = "C:\\Xova\\plugins\\evolution_stages_probe.py";

const STAGES = ["observe", "propose", "simulate", "apply"] as const;
type Stage = typeof STAGES[number];

const STAGE_COLORS: Record<Stage, string> = {
  observe:  "bg-blue-900/40 border-blue-700 text-blue-300",
  propose:  "bg-amber-900/40 border-amber-700 text-amber-300",
  simulate: "bg-purple-900/40 border-purple-700 text-purple-300",
  apply:    "bg-emerald-900/40 border-emerald-700 text-emerald-300",
};

interface AgentStage { agent: string; stage: Stage; score?: number; status?: string; last_run?: number; error?: string }
interface ProbeResult { ok: boolean; agents?: AgentStage[]; engine_state?: Record<string, unknown>; error?: string }

function fmtAge(ts?: number): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() / 1000) - ts);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

export function EvolutionStages({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_run", { command: `"${PY}" "${PLUGIN}"`, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      setResult(JSON.parse(stdout.trim()) as ProbeResult);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e) { setResult({ ok: false, error: String(e) }); }
    setLoading(false);
  }, []);

  const byStage = (stage: Stage) => (result?.agents ?? []).filter(a => a.stage === stage);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Evolution Stages{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={run} disabled={loading}
          className="ml-auto px-3 py-0.5 bg-purple-900 hover:bg-purple-800 disabled:opacity-40 rounded text-purple-200 text-[9px] uppercase transition-colors">
          {loading ? "probing…" : "▶ Probe"}
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {!result && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600">
          <span className="text-2xl">🧬</span>
          <span className="text-[10px]">13 agents × 4 evolution stages</span>
          <button onClick={run} className="px-4 py-1.5 bg-purple-900 hover:bg-purple-800 rounded text-purple-200 text-[10px] uppercase transition-colors">▶ Probe Engine</button>
        </div>
      )}

      {result && !result.ok && (
        <div className="p-3">
          <div className="bg-amber-950/30 border border-amber-800 rounded p-2">
            <div className="text-amber-400 text-[9px] uppercase mb-1">engine unavailable</div>
            <pre className="text-amber-300 text-[10px] whitespace-pre-wrap break-all">{result.error}</pre>
          </div>
        </div>
      )}

      {result?.ok && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-4 divide-x divide-zinc-800 border-b border-zinc-800">
            {STAGES.map(stage => (
              <div key={stage} className="px-2 py-1.5 text-center">
                <div className={`text-[9px] uppercase px-1 py-0.5 rounded border inline-block ${STAGE_COLORS[stage]}`}>{stage}</div>
                <div className="text-zinc-600 text-[9px] mt-0.5">{byStage(stage).length}</div>
              </div>
            ))}
          </div>

          {(result.agents ?? []).length === 0 && (
            <div className="flex items-center justify-center h-20 text-zinc-600 text-[10px]">no agent stage data</div>
          )}

          <div className="divide-y divide-zinc-900/50">
            {(result.agents ?? []).map((a, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-900/30">
                <span className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${STAGE_COLORS[a.stage]}`}>{a.stage[0].toUpperCase()}</span>
                <span className="text-zinc-200 text-[10px] truncate flex-1">{a.agent}</span>
                {a.score != null && (
                  <div className="shrink-0 flex items-center gap-1">
                    <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, a.score * 100)}%` }} />
                    </div>
                    <span className="text-zinc-500 text-[9px] tabular-nums">{Math.min(100, a.score * 100).toFixed(0)}%</span>
                  </div>
                )}
                {a.last_run != null && <span className="text-zinc-600 text-[9px] shrink-0">{fmtAge(a.last_run)}</span>}
                {a.error && <span className="text-red-400 text-[9px] shrink-0">!</span>}
              </div>
            ))}
          </div>

          {result.engine_state && (
            <div className="border-t border-zinc-800 px-3 py-2">
              <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">engine state</div>
              <pre className="text-zinc-500 text-[9px] whitespace-pre-wrap">{JSON.stringify(result.engine_state, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
