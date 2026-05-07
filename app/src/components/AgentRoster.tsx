import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const GRAPH_PATH = "C:\\Xova\\memory\\federation_graph.json";

interface AgentDef {
  id: string;
  name: string;
  repo: string;
  specialty: string[];
  home_path: string;
  inbox: string;
  outbox: string;
  links_to: string[];
  sce88_role: string;
}

interface FedGraph {
  version: string;
  updated_at: number;
  agents: AgentDef[];
}

const ROLE_STYLE: Record<string, string> = {
  constraint_enforcer: "bg-red-900/40 text-red-300 border-red-700",
  gate_master:         "bg-red-900/60 text-red-200 border-red-600",
  publisher:           "bg-blue-900/40 text-blue-300 border-blue-700",
  ternary_validator:   "bg-violet-900/40 text-violet-300 border-violet-700",
  coherence_reporter:  "bg-cyan-900/40 text-cyan-300 border-cyan-700",
  advisory:            "bg-zinc-800 text-zinc-500 border-zinc-700",
};

function roleStyle(role: string): string {
  return ROLE_STYLE[role] ?? ROLE_STYLE.advisory;
}

function agentNumber(id: string): string {
  return id.match(/(\d+)/)?.[1] ?? "?";
}

export function AgentRoster({ onClose }: { onClose: () => void }) {
  const [graph,   setGraph]   = useState<FedGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await invoke<string>("xova_read_file", { path: GRAPH_PATH });
      setGraph(JSON.parse(raw) as FedGraph);
    } catch (e) {
      setError(String(e).slice(0, 120));
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const agents = graph?.agents ?? [];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Agent Roster · {agents.length} agents
        </span>
        <button onClick={refresh} disabled={loading} title="Refresh"
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} title="Close"
          className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && !graph && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
      )}
      {error && (
        <div className="flex-1 flex items-center justify-center px-4 text-red-400 text-[10px] text-center">{error}</div>
      )}

      {graph && (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
          {agents.map(agent => {
            const num         = agentNumber(agent.id);
            const visibleTags = agent.specialty.slice(0, 4);
            const hiddenCount = agent.specialty.length - visibleTags.length;
            const linksAll    = agent.links_to.includes("*");
            return (
              <div key={agent.id} className="bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] bg-zinc-800 border border-zinc-700 rounded px-1 text-zinc-500 shrink-0">{num}</span>
                  <span className="text-zinc-100 text-[11px] font-semibold">{agent.name}</span>
                  <span className={`ml-auto text-[7px] px-1 py-px rounded border shrink-0 ${roleStyle(agent.sce88_role)}`}>
                    {agent.sce88_role.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap mt-1">
                  {visibleTags.map(tag => (
                    <span key={tag} className="text-[7px] px-1 py-px bg-zinc-800 border border-zinc-700 rounded text-zinc-500">{tag}</span>
                  ))}
                  {hiddenCount > 0 && (
                    <span className="text-[7px] px-1 py-px bg-zinc-800 border border-zinc-700 rounded text-zinc-600">+{hiddenCount} more</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-zinc-600 text-[8px] truncate flex-1">{agent.repo}</span>
                  {linksAll
                    ? <span className="text-amber-400/70 text-[8px] shrink-0">→ all</span>
                    : <span className="text-zinc-600 text-[8px] shrink-0">→ {agent.links_to.length}</span>
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
