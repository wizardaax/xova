import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const MESH_PATH = "C:\\Xova\\memory\\mesh_feed.jsonl";
const BUCKET_MIN = 10, BUCKETS = 12;

const AGENTS = [
  "Orchestrator", "CI Sentinel", "Memory Keeper", "Constraint Guardian",
  "Phase Tracker", "Lucas Analyst", "Field Weaver", "Ternary Logic",
  "Self Model Observer", "Repo Sync", "Test Validator", "Doc Keeper", "Coherence Monitor",
];

const ALIASES: Record<string, string> = {
  "self-model": "Self Model Observer", "selfmodel": "Self Model Observer",
};

function canonicalise(label: string) {
  const lc = label.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (ALIASES[lc]) return ALIASES[lc];
  return AGENTS.find(a => a.toLowerCase().includes(lc.split(" ")[0])) ?? label;
}

function cellColor(count: number) {
  if (count === 0) return "bg-zinc-800";
  if (count <= 2)  return "bg-emerald-900/40";
  return "bg-emerald-700/60";
}

export function AgentHeatmap({ onClose }: { onClose: () => void }) {
  const [grid, setGrid] = useState<number[][]>(() => AGENTS.map(() => Array(BUCKETS).fill(0)));
  const [bucketLabels, setBucketLabels] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: MESH_PATH });
      const now = Date.now() / 1000;
      const windowStart = now - BUCKETS * BUCKET_MIN * 60;
      const newGrid: number[][] = AGENTS.map(() => Array(BUCKETS).fill(0));

      raw.split("\n").filter(Boolean).forEach(line => {
        try {
          const o = JSON.parse(line);
          if (o.kind !== "agent_result") return;
          const ts: number = o.ts > 1e12 ? o.ts / 1000 : o.ts;
          if (ts < windowStart) return;
          const elapsed = now - ts;
          const bucketIdx = BUCKETS - 1 - Math.min(BUCKETS - 1, Math.floor(elapsed / (BUCKET_MIN * 60)));
          const agent = canonicalise(String(o.label ?? o.agent ?? ""));
          const agentIdx = AGENTS.indexOf(agent);
          if (agentIdx >= 0) newGrid[agentIdx][bucketIdx]++;
        } catch { /* skip */ }
      });

      const labels = Array.from({ length: BUCKETS }, (_, i) => {
        const t = new Date((now - (BUCKETS - 1 - i) * BUCKET_MIN * 60) * 1000);
        return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      });
      setGrid(newGrid);
      setBucketLabels(labels);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[10px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Agent Activity · last 2h{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>
      <div className="flex-1 overflow-auto px-2 py-2">
        <div className="flex mb-1 pl-28">
          {bucketLabels.map((lbl, i) => (
            <div key={i} className="w-6 shrink-0 text-[7px] text-zinc-600 text-center">{i % 3 === 0 ? lbl : ""}</div>
          ))}
        </div>
        {AGENTS.map((agent, ai) => (
          <div key={agent} className="flex items-center mb-0.5 gap-1">
            <div className="w-28 shrink-0 text-[8px] text-zinc-500 truncate text-right pr-1" title={agent}>{agent}</div>
            {grid[ai].map((count, bi) => (
              <div key={bi} title={`${agent} · ${bucketLabels[bi] ?? ""} · ${count} events`}
                className={`w-6 h-4 shrink-0 rounded-sm ${cellColor(count)} border border-zinc-900/40 transition-colors`} />
            ))}
          </div>
        ))}
        <div className="flex items-center gap-3 mt-3 pl-28">
          <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-zinc-800 border border-zinc-900/40" /><span className="text-zinc-600">0</span></div>
          <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-emerald-900/40 border border-zinc-900/40" /><span className="text-zinc-600">1-2</span></div>
          <div className="flex items-center gap-1"><div className="w-4 h-3 rounded-sm bg-emerald-700/60 border border-zinc-900/40" /><span className="text-zinc-600">3+</span></div>
        </div>
      </div>
    </div>
  );
}
