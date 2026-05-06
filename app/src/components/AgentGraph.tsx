import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AgentBoard {
  xova?: { alive?: boolean };
  jarvis?: { alive?: boolean };
  forge?: { alive?: boolean; forge_mode?: string; mode?: string };
  absorb?: { alive?: boolean; cycles?: number };
  [key: string]: unknown;
}

interface GraphState {
  board: AgentBoard;
  coherence: number | null;
  cycles: number;
  updatedAt: string;
}

type AliveStatus = "alive" | "dead" | "unknown";

const NODE_FILL: Record<AliveStatus, string> = { alive: "#059669", dead: "#dc2626", unknown: "#52525b" };
const NODE_STROKE: Record<AliveStatus, string> = { alive: "#34d399", dead: "#f87171", unknown: "#3f3f46" };

const NODES = [
  { id: "xova",     label: "Xova",      cx: 200, cy: 40  },
  { id: "jarvis",   label: "Jarvis",    cx: 80,  cy: 110 },
  { id: "forge",    label: "Forge",     cx: 320, cy: 110 },
  { id: "absorb",   label: "Absorb",    cx: 80,  cy: 200 },
  { id: "mesh",     label: "Mesh",      cx: 200, cy: 240 },
  { id: "watchdog", label: "Watchdog",  cx: 320, cy: 200 },
  { id: "claude",   label: "Claude",    cx: 370, cy: 50  },
  { id: "ollama",   label: "Ollama",    cx: 30,  cy: 50  },
];

const EDGES: [string, string][] = [
  ["xova", "jarvis"], ["xova", "forge"], ["forge", "claude"],
  ["jarvis", "ollama"], ["xova", "absorb"], ["absorb", "mesh"],
  ["mesh", "watchdog"],
];

function nodePos(id: string) { return NODES.find(n => n.id === id)!; }

function coherenceColor(v: number | null) {
  if (v === null) return "#71717a";
  return v >= 0.8 ? "#34d399" : v >= 0.6 ? "#fbbf24" : "#f87171";
}

function aliveStatus(board: AgentBoard, id: string): AliveStatus {
  switch (id) {
    case "xova": return board.xova?.alive === true ? "alive" : board.xova ? "dead" : "unknown";
    case "jarvis": return board.jarvis?.alive === true ? "alive" : board.jarvis ? "dead" : "unknown";
    case "forge":
      return (board.forge?.alive === true || board.forge?.forge_mode || board.forge?.mode) ? "alive" : board.forge ? "dead" : "unknown";
    case "absorb": return (board.absorb?.cycles ?? 0) > 0 ? "alive" : board.absorb ? "dead" : "unknown";
    default: return "unknown";
  }
}

export function AgentGraph({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<GraphState>({ board: {}, coherence: null, cycles: 0, updatedAt: "--:--:--" });

  const refresh = useCallback(async () => {
    try {
      const [boardRaw, feedRaw] = await Promise.all([
        invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\agent_board.json" }),
        invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\mesh_feed.jsonl" }).catch(() => ""),
      ]);
      const board: AgentBoard = JSON.parse(boardRaw);
      let coherence: number | null = null;
      for (const line of feedRaw.split("\n").filter(Boolean).reverse()) {
        try { const e = JSON.parse(line); if (e.kind === "cycle_end" && typeof e.coherence === "number") { coherence = e.coherence; break; } } catch { /* skip */ }
      }
      const now = new Date();
      const updatedAt = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
      setState({ board, coherence, cycles: board.absorb?.cycles ?? 0, updatedAt });
    } catch { /* silent */ }
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 8000); return () => clearInterval(id); }, [refresh]);

  const statuses: Record<string, AliveStatus> = {};
  for (const n of NODES) statuses[n.id] = aliveStatus(state.board, n.id);
  const anyAlive = Object.values(statuses).some(s => s === "alive");

  return (
    <div style={{ background: "#09090b", color: "#e4e4e7", fontFamily: "monospace", padding: "4px" }}>
      <svg width="400" height="300" viewBox="0 0 400 300" style={{ display: "block", margin: "0 auto" }}>
        {EDGES.map(([a, b]) => {
          const na = nodePos(a); const nb = nodePos(b);
          const both = statuses[a] === "alive" && statuses[b] === "alive";
          return <line key={`${a}-${b}`} x1={na.cx} y1={na.cy} x2={nb.cx} y2={nb.cy}
            stroke={both ? "#34d399" : "#3f3f46"} strokeWidth={both ? 2 : 1} strokeOpacity={both ? 0.7 : 0.4} />;
        })}

        {anyAlive && (
          <circle cx={200} cy={40} r={22} fill="none" stroke="#34d399" strokeWidth={1.5} strokeOpacity={0.35}>
            <animate attributeName="r" values="22;30;22" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="strokeOpacity" values="0.4;0;0.4" dur="2.4s" repeatCount="indefinite" />
          </circle>
        )}

        {NODES.map(n => {
          const s = statuses[n.id];
          return (
            <g key={n.id}>
              <circle cx={n.cx} cy={n.cy} r={18} fill={NODE_FILL[s]} stroke={NODE_STROKE[s]} strokeWidth={1.5} fillOpacity={0.85} />
              <text x={n.cx} y={n.cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill="#f4f4f5" fontWeight="600">
                {n.label.length > 7 ? n.label.slice(0, 6) + "…" : n.label}
              </text>
              {n.id === "absorb" && state.cycles > 0 && (
                <text x={n.cx} y={n.cy + 29} textAnchor="middle" fontSize={7} fill="#a1a1aa">{state.cycles} cyc</text>
              )}
            </g>
          );
        })}

        <text x={200} y={148} textAnchor="middle" fontSize={10} fill="#71717a">coherence</text>
        <text x={200} y={165} textAnchor="middle" fontSize={20} fontWeight="700" fill={coherenceColor(state.coherence)}>
          {state.coherence !== null ? state.coherence.toFixed(2) : "—"}
        </text>
        <text x={200} y={292} textAnchor="middle" fontSize={7} fill="#52525b">updated {state.updatedAt}</text>
      </svg>
    </div>
  );
}
