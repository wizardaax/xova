import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TASK_TYPES, type TaskType } from "@/lib/mesh";

const MESH_FEED = "C:\\Xova\\memory\\mesh_feed.jsonl";

const AGENTS = [
  { id: 1,  name: "Orchestrator" },
  { id: 2,  name: "CI Sentinel" },
  { id: 3,  name: "Memory Keeper" },
  { id: 4,  name: "Constraint Guardian" },
  { id: 5,  name: "Phase Tracker" },
  { id: 6,  name: "Lucas Analyst" },
  { id: 7,  name: "Field Weaver" },
  { id: 8,  name: "Ternary Logic" },
  { id: 9,  name: "Self Model Observer" },
  { id: 10, name: "Repo Sync" },
  { id: 11, name: "Test Validator" },
  { id: 12, name: "Doc Keeper" },
  { id: 13, name: "Coherence Monitor" },
];

export function AgentDispatch({ onClose }: { onClose: () => void }) {
  const [taskType, setTaskType] = useState<TaskType>("coherence");
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [recentFeed, setRecentFeed] = useState<string[]>([]);

  const loadFeed = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: MESH_FEED });
      const lines = raw.split("\n").filter(Boolean).slice(-8).reverse();
      setRecentFeed(lines.map(l => {
        try { const o = JSON.parse(l) as { kind?: string; coherence?: number; ts?: number }; return `${o.kind ?? "?"} ${typeof o.coherence === "number" ? `coh=${o.coherence.toFixed(3)}` : ""}`; }
        catch { return l.slice(0, 60); }
      }));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadFeed(); const id = setInterval(loadFeed, 10000); return () => clearInterval(id); }, [loadFeed]);

  const dispatch = async () => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(argsText) as Record<string, unknown>; } catch { setResult("Error: args must be valid JSON"); return; }
    setLoading(true); setResult("");
    try {
      const raw = await invoke<string>("dispatch_mesh", { taskType, args: JSON.stringify(args) });
      setResult(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2));
    } catch (e) { setResult(`Error: ${e}`); }
    setLoading(false);
    loadFeed();
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Agent Dispatch · 13 agents</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Agent grid */}
        <div className="grid grid-cols-2 gap-1">
          {AGENTS.map(a => (
            <div key={a.id} className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded px-2 py-1">
              <span className="text-zinc-600 text-[9px] w-5 shrink-0">#{a.id}</span>
              <span className="text-zinc-400 text-[10px] truncate">{a.name}</span>
            </div>
          ))}
        </div>

        {/* Task type */}
        <div className="space-y-1">
          <label className="text-[9px] uppercase tracking-wider text-zinc-600">Task Type</label>
          <select
            value={taskType}
            onChange={e => setTaskType(e.target.value as TaskType)}
            className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-[11px] border border-zinc-700 focus:outline-none focus:border-emerald-600"
          >
            {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Args */}
        <div className="space-y-1">
          <label className="text-[9px] uppercase tracking-wider text-zinc-600">Args (JSON)</label>
          <textarea
            value={argsText}
            onChange={e => setArgsText(e.target.value)}
            rows={3}
            className="w-full bg-zinc-800 text-zinc-200 rounded px-2 py-1 text-[10px] border border-zinc-700 focus:outline-none focus:border-emerald-600 resize-none font-mono"
          />
        </div>

        <button
          onClick={dispatch} disabled={loading}
          className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-white text-[11px] uppercase tracking-wider transition-colors"
        >
          {loading ? "dispatching…" : "🎯 dispatch"}
        </button>

        {result && (
          <pre className="text-[9px] text-zinc-400 bg-zinc-900 border border-zinc-800 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
            {result}
          </pre>
        )}

        {/* Recent feed */}
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-zinc-600">Recent Mesh Activity</div>
          {recentFeed.map((l, i) => (
            <div key={i} className="text-[9px] text-zinc-600 truncate">{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
