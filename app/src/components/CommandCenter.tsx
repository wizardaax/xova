import { useState } from "react";
import { Pulse, Cpu, GitBranch, Lightning, Rocket } from "@phosphor-icons/react";
import { TASK_TYPES, type TaskType } from "@/lib/mesh";
import type { MeshStatus } from "@/lib/mesh";
import { cn } from "@/lib/utils";

interface Props {
  status: MeshStatus | null;
  onDispatch: (taskType: TaskType, args?: Record<string, unknown>) => Promise<void>;
  busyTask: TaskType | null;
}

const TASK_LABELS: Record<TaskType, string> = {
  math: "Math",
  phase: "Phase",
  ci_health: "CI Health",
  coherence: "Coherence",
  constraint: "Constraint",
  coordination: "Coordination",
  documentation: "Documentation",
  field: "Field",
  memory: "Memory",
  observation: "Observation",
  sync: "Sync",
  ternary: "Ternary",
  testing: "Testing",
  evolve: "Evolve",
  swarm: "Swarm",
  select: "Select (φ-UCB)",
  score: "Score",
  bridge: "Bridge",
  detect: "Detect",
  self_model: "Self Model",
  validate: "Validate",
  build_tool: "Build Tool",
};

// Defaults that actually produce successful dispatches when a button is clicked
// or when "Deploy All" iterates them. Tasks that need specific shapes get a
// minimum-viable payload (sequence/node_stats/spec). Empty {} would hit a
// "payload required" error from the rfm-pro adapter.
const TASK_DEFAULTS: Record<TaskType, Record<string, unknown>> = {
  math: { n: 10 },
  phase: {},
  ci_health: {},
  coherence: {},
  constraint: {},
  coordination: {},
  documentation: {},
  field: { n: 10 },
  memory: {},
  observation: {},
  sync: {},
  ternary: {},
  testing: {},
  evolve: {},
  swarm: {},
  select: { node_stats: { q: 0.5, n: 1 } },
  score: { sequence: [1, 1, 2, 3, 5, 8] },
  bridge: { sequence: [1, 1, 2, 3, 5, 8] },
  detect: { sequence: [1, 1, 2, 3, 5, 8] },
  self_model: {},
  validate: { spec: { layers: { L1: { capacity: 10 } } } },
  build_tool: { target: "xova_plugin", name: "example_tool", spec: "stub demo", source: "def run(args):\n    return {\"ok\": True, \"echo\": args}\n" },
};

export function CommandCenter({ status, onDispatch, busyTask }: Props) {
  const [deploying, setDeploying] = useState(false);

  const repos = status?.repo_count ?? 0;
  const agents = status?.agent_count ?? 0;
  const coherence = status ? Math.round(status.global_coherence * 100) : 0;

  const deployAll = async () => {
    setDeploying(true);
    try {
      for (const t of TASK_TYPES) {
        await onDispatch(t, TASK_DEFAULTS[t]);
      }
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="flex-1 bg-white overflow-y-auto">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Global Command</h1>
        <button
          onClick={deployAll}
          disabled={deploying || busyTask !== null}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors"
        >
          <Rocket size={16} weight="fill" />
          {deploying ? "Deploying..." : "Deploy All"}
        </button>
      </div>

      <div className="px-6 py-4 grid grid-cols-4 gap-3">
        <StatTile icon={GitBranch} label="Repos" value={repos || 9} color="bg-blue-500" />
        <StatTile icon={Cpu} label="Agents" value={agents || 13} color="bg-emerald-500" />
        <StatTile icon={Pulse} label="Coherence" value={`${coherence}%`} color="bg-purple-500" />
        <StatTile icon={Lightning} label="Workflows" value={0} color="bg-amber-500" />
      </div>

      <div className="px-6 pb-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Network Topology</h2>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 h-64 relative overflow-hidden">
          <svg viewBox="0 0 600 240" className="w-full h-full">
            {Array.from({ length: 9 }).map((_, i) => {
              const angle = (i / 9) * Math.PI * 2 - Math.PI / 2;
              const cx = 300 + Math.cos(angle) * 90;
              const cy = 120 + Math.sin(angle) * 90;
              return (
                <g key={i}>
                  <line x1={300} y1={120} x2={cx} y2={cy} stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="3 3" />
                  <circle cx={cx} cy={cy} r="22" fill="#3b82f6" stroke="#1d4ed8" strokeWidth="2" />
                  <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fill="white" fontWeight="bold">{i + 1}</text>
                </g>
              );
            })}
            <circle cx={300} cy={120} r="32" fill="#0f172a" stroke="#1e293b" strokeWidth="3" />
            <text x={300} y={125} textAnchor="middle" fontSize="13" fill="#10b981" fontWeight="bold">XOVA</text>
          </svg>
        </div>
      </div>

      <div className="px-6 pb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Mesh Tasks</h2>
        <div className="grid grid-cols-4 gap-2">
          {TASK_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => onDispatch(t, TASK_DEFAULTS[t])}
              disabled={busyTask !== null}
              className={cn(
                "px-3 py-2.5 text-xs font-medium rounded-lg border transition-all text-left",
                busyTask === t
                  ? "bg-blue-100 border-blue-400 text-blue-900"
                  : busyTask !== null
                  ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-white border-slate-200 text-slate-700 hover:border-blue-400 hover:bg-blue-50"
              )}
            >
              <div className="font-semibold">{TASK_LABELS[t]}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">{t}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, color }: { icon: typeof Pulse; label: string; value: number | string; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 shadow-sm">
      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", color)}>
        <Icon size={20} weight="fill" className="text-white" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className="text-lg font-bold text-slate-900 leading-none">{value}</div>
      </div>
    </div>
  );
}
