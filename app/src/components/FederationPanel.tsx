import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const GRAPH_PATH = "C:\\Xova\\memory\\federation_graph.json";
const STATUS_CMD = `python "C:\\Xova\\plugins\\federation_manager.py" --action status`;
const ROUTE_CMD  = (text: string) =>
  `python "C:\\Xova\\plugins\\federation_manager.py" --action route --text "${text.replace(/"/g, '\\"')}"`;

interface AgentDef {
  id: string; name: string; repo: string;
  specialty: string[]; sce88_role: string;
  links_to: string[]; inbox: string; outbox: string;
}
interface FedGraph {
  version: string; agents: AgentDef[];
  shared_slots: string[]; sce88_enforced: boolean;
}
interface AgentStatus {
  id: string; name: string; cloned: boolean;
  inbox_live: boolean; sce88_role: string;
}
interface FedStatus { ok: boolean; agent_count: number; agents: AgentStatus[] }

const ROLE_STYLE: Record<string, string> = {
  gate_master:          "bg-red-900/40 text-red-300 border-red-700",
  constraint_enforcer:  "bg-orange-900/40 text-orange-300 border-orange-700",
  publisher:            "bg-blue-900/40 text-blue-300 border-blue-700",
  ternary_validator:    "bg-purple-900/40 text-purple-300 border-purple-700",
  coherence_reporter:   "bg-cyan-900/40 text-cyan-300 border-cyan-700",
  advisory:             "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const AGENT_EMOJI: Record<string, string> = {
  Forge:"⚒", Jarvis:"🎩", Mesh:"🕸", Browser:"🌐", Corpus:"📚",
  Evolution:"🧬", Sentinel:"🛡", Phase:"🌊", Field:"🌀",
  Memory:"🗃", Repo:"📦", Voice:"🎤", Coherence:"📉",
};

function roleStyle(role: string) {
  return ROLE_STYLE[role] ?? ROLE_STYLE.advisory;
}

async function xovaRun(cmd: string): Promise<string> {
  const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
  try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) return w.stdout; } catch { /**/ }
  return raw;
}

async function xovaReadFile(path: string): Promise<string> {
  return await invoke<string>("xova_read_file", { path });
}

export function FederationPanel({ onClose }: { onClose: () => void }) {
  const [graph,   setGraph]   = useState<FedGraph | null>(null);
  const [status,  setStatus]  = useState<FedStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg,     setMsg]     = useState("");
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [graphRaw, statusRaw] = await Promise.all([
        xovaReadFile(GRAPH_PATH),
        xovaRun(STATUS_CMD),
      ]);
      setGraph(JSON.parse(graphRaw) as FedGraph);
      setStatus(JSON.parse(statusRaw) as FedStatus);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      console.error("federation refresh error", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const send = useCallback(async () => {
    const text = msg.trim();
    if (!text) return;
    if (!text.includes("@")) {
      setLastSend("No @agent mention — use e.g. @forge: hello");
      return;
    }
    setSending(true);
    try {
      const out = await xovaRun(ROUTE_CMD(text));
      const res = JSON.parse(out) as { ok: boolean; delivered?: number; routes?: number };
      setLastSend(res.ok ? `Delivered ${res.delivered}/${res.routes} route(s)` : `Failed: ${out.slice(0, 80)}`);
      setMsg("");
    } catch (e) {
      setLastSend(`Error: ${String(e).slice(0, 80)}`);
    }
    setSending(false);
  }, [msg]);

  // Build a status lookup by agent id
  const statusMap: Record<string, AgentStatus> = {};
  (status?.agents ?? []).forEach(a => { statusMap[a.id] = a; });

  const agents = graph?.agents ?? [];
  const clonedCount = Object.values(statusMap).filter(a => a.cloned).length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Federation {graph ? `v${graph.version}` : ""}{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40 text-[13px]">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && !graph && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
      )}

      {graph && (
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-3">

          {/* Top stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-900 rounded p-2 text-center">
              <div className="text-[9px] text-zinc-500 uppercase">agents</div>
              <div className="text-zinc-100 font-bold mt-0.5">{agents.length}</div>
            </div>
            <div className="bg-zinc-900 rounded p-2 text-center">
              <div className="text-[9px] text-zinc-500 uppercase">cloned</div>
              <div className="font-bold mt-0.5" style={{ color: clonedCount === agents.length ? "#34d399" : "#fbbf24" }}>
                {clonedCount}/{agents.length}
              </div>
            </div>
            <div className="bg-zinc-900 rounded p-2 text-center">
              <div className="text-[9px] text-zinc-500 uppercase">SCE-88</div>
              <div className="font-bold mt-0.5" style={{ color: graph.sce88_enforced ? "#34d399" : "#f87171" }}>
                {graph.sce88_enforced ? "ON" : "OFF"}
              </div>
            </div>
          </div>

          {/* Agent grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {agents.map(agent => {
              const st    = statusMap[agent.id];
              const emoji = AGENT_EMOJI[agent.name] ?? "🤖";
              const num   = agent.id.match(/\d+/)?.[0] ?? "?";
              const cloned    = st?.cloned ?? false;
              const inboxLive = st?.inbox_live ?? false;

              return (
                <div key={agent.id}
                  className="bg-zinc-900 rounded border border-zinc-800 p-2 flex flex-col gap-1 hover:border-zinc-700 transition-colors">
                  {/* Name row */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] leading-none">{emoji}</span>
                    <span className="text-zinc-100 font-semibold">{agent.name}</span>
                    <span className="text-zinc-600 text-[9px] ml-auto">#{num}</span>
                  </div>

                  {/* SCE-88 role badge */}
                  <span className={`self-start text-[8px] px-1 py-0.5 rounded border font-mono uppercase tracking-wider ${roleStyle(agent.sce88_role)}`}>
                    {agent.sce88_role.replace(/_/g, " ")}
                  </span>

                  {/* Specialty */}
                  <div className="flex flex-wrap gap-1">
                    {agent.specialty.slice(0, 3).map(s => (
                      <span key={s} className="text-[8px] text-zinc-500 bg-zinc-800 rounded px-1">{s.replace(/_/g, " ")}</span>
                    ))}
                  </div>

                  {/* Status dots */}
                  <div className="flex gap-2 mt-0.5">
                    <span className="flex items-center gap-0.5 text-[8px] text-zinc-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${cloned ? "bg-emerald-400" : "bg-zinc-700"}`} />
                      cloned
                    </span>
                    <span className="flex items-center gap-0.5 text-[8px] text-zinc-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${inboxLive ? "bg-blue-400" : "bg-zinc-700"}`} />
                      inbox
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Link topology */}
          <div>
            <button
              onClick={() => setShowLinks(v => !v)}
              className="text-[9px] uppercase tracking-wider text-zinc-600 hover:text-zinc-400 flex items-center gap-1"
            >
              <span>{showLinks ? "▾" : "▸"}</span> link topology
            </button>
            {showLinks && (
              <div className="mt-1 space-y-0.5">
                {agents.map(a => (
                  <div key={a.id} className="flex gap-1.5 text-[9px]">
                    <span className="text-zinc-400 w-16 shrink-0">{a.name}</span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-zinc-500">
                      {a.links_to.includes("*") ? "ALL" : a.links_to.map(l => {
                        const match = graph.agents.find(x => x.id === l);
                        return match?.name ?? l;
                      }).join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Shared slots */}
          <div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">shared slots</div>
            <div className="flex flex-wrap gap-1">
              {(graph.shared_slots ?? []).map(s => (
                <span key={s} className="text-[8px] text-emerald-400 bg-emerald-900/20 border border-emerald-900 rounded px-1">{s}</span>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Message composer */}
      <div className="border-t border-zinc-800 p-2 shrink-0 space-y-1">
        {lastSend && (
          <div className="text-[9px] text-zinc-500 truncate">{lastSend}</div>
        )}
        <div className="flex gap-1">
          <input
            value={msg}
            onChange={e => setMsg(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="@forge: what is coherence  @mesh: run sweep"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-emerald-600 min-w-0"
          />
          <button
            onClick={send} disabled={sending || !msg.trim()}
            className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300 text-[10px] hover:bg-emerald-800/40 disabled:opacity-40 shrink-0"
          >
            {sending ? "…" : "send"}
          </button>
        </div>
      </div>

    </div>
  );
}
