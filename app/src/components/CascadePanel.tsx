import { useState } from "react";
import { TASK_TYPES, type TaskType, cascadeMesh, type CascadeResult } from "@/lib/mesh";
import { cn } from "@/lib/utils";

/**
 * Cascade — same shape as Mesh, but broadcasts.
 * Mesh dispatches a task to ONE repo (the one with highest coherence).
 * Cascade fans the same task out to EVERY repo that supports it, in
 * coherence-descending order. Returns a per-repo result table.
 */
export function CascadePanel({ pushTerminal }: { pushTerminal: (l: string) => void }) {
  const [taskType, setTaskType] = useState<TaskType>("math");
  const [argsJson, setArgsJson] = useState('{"n":5}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CascadeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    pushTerminal(`$ cascade ${taskType} ${argsJson}`);
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = argsJson.trim() ? JSON.parse(argsJson) : {};
    } catch (e) {
      setError(`bad JSON: ${(e as Error).message}`);
      setRunning(false);
      return;
    }
    try {
      const r = await cascadeMesh(taskType, parsedArgs);
      setResult(r);
      pushTerminal(`  → fanout=${r.fanout_count} ok=${r.aggregate.ok} err=${r.aggregate.errors} skip=${r.aggregate.skipped}`);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      pushTerminal(`  ✗ ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <div className="pb-3 mb-3 border-b border-zinc-800">
        <h1 className="text-sm font-bold text-zinc-100 font-mono uppercase tracking-wider">Cascade</h1>
        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">Broadcast a task to every repo that accepts it. Same shape as Mesh, but fan-out instead of single-route.</div>
      </div>

      <div className="grid grid-cols-[180px_1fr_auto] gap-2 mb-3">
        <select
          value={taskType}
          onChange={(e) => setTaskType(e.target.value as TaskType)}
          disabled={running}
          className="h-10 px-3 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-50"
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
          disabled={running}
          placeholder='{"n":5}'
          className="h-10 px-3 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button
          onClick={run}
          disabled={running}
          className="h-10 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-mono font-semibold rounded transition-colors"
        >
          {running ? "Cascading..." : "Cascade"}
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-950/40 border border-red-900 rounded text-xs text-red-300 font-mono whitespace-pre-wrap">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-zinc-500 flex gap-3">
            <span>fanout: <span className="text-zinc-300">{result.fanout_count}</span></span>
            <span>ok: <span className="text-emerald-400">{result.aggregate.ok}</span></span>
            <span>errors: <span className="text-red-400">{result.aggregate.errors}</span></span>
            <span>skipped: <span className="text-zinc-500">{result.aggregate.skipped}</span></span>
          </div>
          {result.results.map((r) => (
            <div
              key={r.repo}
              className={cn(
                "border rounded p-2 bg-zinc-900",
                r.status === "ok" ? "border-zinc-800" :
                r.status === "error" ? "border-red-900" :
                "border-zinc-800 opacity-60"
              )}
            >
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[9px] uppercase",
                  r.status === "ok" ? "bg-emerald-900/40 text-emerald-300" :
                  r.status === "error" ? "bg-red-900/40 text-red-300" :
                  "bg-zinc-800 text-zinc-400"
                )}>
                  {r.status}
                </span>
                <span className="text-zinc-100 font-semibold">{r.repo}</span>
                <span className="text-zinc-600">coh={r.coherence.toFixed(2)}</span>
              </div>
              {(r.result || r.error || r.reason) && (
                <pre className="mt-1.5 text-[10px] leading-snug font-mono text-zinc-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                  {r.error ?? r.reason ?? JSON.stringify(r.result, null, 0).slice(0, 800)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {!result && !error && !running && (
        <div className="text-xs text-zinc-600 italic py-8 text-center font-mono">
          pick a task type, edit the JSON args, hit Cascade
        </div>
      )}
    </div>
  );
}
