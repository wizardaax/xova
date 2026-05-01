import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { TASK_TYPES, type TaskType, type MeshStatus } from "@/lib/mesh";
import { type DispatchLogEntry } from "./Analytics";
import { Plugins } from "./Plugins";
import { CascadePanel } from "./CascadePanel";
import { ScanPanel } from "./ScanPanel";
import { SettingsPanel } from "./SettingsPanel";
import { cn, formatTimestamp } from "@/lib/utils";

type Tab = "activity" | "mesh" | "plugins" | "cascade" | "scan" | "terminal" | "settings";
const TABS: Tab[] = ["activity", "mesh", "plugins", "cascade", "scan", "terminal", "settings"];

const TASK_LABELS: Record<TaskType, string> = {
  math: "Math", phase: "Phase", ci_health: "CI Health", coherence: "Coherence",
  constraint: "Constraint", coordination: "Coordination", documentation: "Documentation",
  field: "Field", memory: "Memory", observation: "Observation", sync: "Sync",
  ternary: "Ternary", testing: "Testing",
  evolve: "Evolve", swarm: "Swarm", select: "Select (φ-UCB)", score: "Score",
  bridge: "Bridge", detect: "Detect", self_model: "Self Model", validate: "Validate",
  build_tool: "Build Tool",
};
const TASK_DEFAULTS: Record<TaskType, Record<string, unknown>> = {
  math: { n: 10 }, phase: {}, ci_health: {}, coherence: {}, constraint: {},
  coordination: {}, documentation: {}, field: { n: 10 }, memory: {},
  observation: {}, sync: {}, ternary: {}, testing: {},
  evolve: {}, swarm: {},
  select: { node_stats: { q: 0.5, n: 1 } },
  score: { sequence: [1, 1, 2, 3, 5, 8] },
  bridge: { sequence: [1, 1, 2, 3, 5, 8] },
  detect: { sequence: [1, 1, 2, 3, 5, 8] },
  self_model: {},
  validate: { spec: { layers: { L1: { capacity: 10 } } } },
  build_tool: { target: "xova_plugin", name: "example_tool", spec: "stub demo", source: "def run(args):\n    return {\"ok\": True, \"echo\": args}\n" },
};

interface Props {
  open: boolean;
  onClose: () => void;
  status: MeshStatus | null;
  onDispatch: (taskType: TaskType, args?: Record<string, unknown>) => Promise<void>;
  busyTask: TaskType | null;
  terminal: string[];
  pushTerminal: (line: string) => void;
  log: DispatchLogEntry[];
  coherenceHistory: number[];
  activity: string[];
  pushActivity: (line: string) => void;
}

export function ControlPanel({ open, onClose, onDispatch, busyTask, terminal, pushTerminal, log, coherenceHistory, activity }: Props) {
  const [tab, setTab] = useState<Tab>("activity");

  return (
    <>
      {open && <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40 transition-opacity" />}
      <div className={cn(
        "fixed top-0 right-0 bottom-0 w-3/4 bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="h-10 border-b border-zinc-800 flex items-center px-4 shrink-0">
          <div className="font-mono text-xs font-bold text-emerald-400 tracking-[0.2em]">CONTROL</div>
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-zinc-800 flex shrink-0 px-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 h-9 text-[11px] font-mono uppercase tracking-wider transition-colors",
                tab === t ? "text-emerald-400 border-b-2 border-emerald-400 -mb-px" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 bg-zinc-950">
          {tab === "activity" && <ActivityTab activity={activity} />}
          {tab === "mesh" && <MeshTab onDispatch={onDispatch} busyTask={busyTask} />}
          {tab === "plugins" && <div className="p-4"><Plugins pushTerminal={pushTerminal} /></div>}
          {tab === "cascade" && <div className="p-4"><CascadePanel pushTerminal={pushTerminal} /></div>}
          {tab === "scan" && <div className="p-4"><ScanPanel pushTerminal={pushTerminal} /></div>}
          {tab === "terminal" && <TerminalTab terminal={terminal} />}
          {tab === "settings" && <div className="p-4"><SettingsPanel /></div>}
        </div>

        <MiniAnalytics log={log} coherenceHistory={coherenceHistory} />
      </div>
    </>
  );
}

function MeshTab({ onDispatch, busyTask }: { onDispatch: Props["onDispatch"]; busyTask: TaskType | null }) {
  return (
    <div className="p-4 grid grid-cols-4 gap-2">
      {TASK_TYPES.map((t) => (
        <button
          key={t}
          onClick={() => onDispatch(t, TASK_DEFAULTS[t])}
          disabled={busyTask !== null}
          className={cn(
            "px-3 py-2.5 text-xs font-mono rounded border transition-colors text-left",
            busyTask === t
              ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
              : busyTask !== null
              ? "bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed"
              : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-emerald-600 hover:text-emerald-400"
          )}
        >
          <div className="font-semibold">{TASK_LABELS[t]}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{t}</div>
        </button>
      ))}
    </div>
  );
}

function ActivityTab({ activity }: { activity: string[] }) {
  return (
    <div className="p-4 font-mono text-[11px] text-emerald-400 space-y-0.5">
      {activity.length === 0 ? (
        <div className="text-zinc-600">awaiting activity...</div>
      ) : activity.slice().reverse().map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all text-zinc-300">{line}</div>
      ))}
    </div>
  );
}

function TerminalTab({ terminal }: { terminal: string[] }) {
  return (
    <div className="p-4 font-mono text-[11px] text-emerald-400 space-y-0.5">
      {terminal.length === 0 ? (
        <div className="text-zinc-600">$ awaiting dispatch...</div>
      ) : terminal.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
      ))}
    </div>
  );
}

function MiniAnalytics({ log, coherenceHistory }: { log: DispatchLogEntry[]; coherenceHistory: number[] }) {
  const maxC = Math.max(0.001, ...coherenceHistory);
  const w = 240, h = 40;
  return (
    <div className="border-t border-zinc-800 px-4 py-2 shrink-0 flex gap-4 items-start bg-zinc-950">
      <div className="flex-1 min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Recent Dispatches</div>
        <div className="font-mono text-[10px] space-y-0.5 max-h-16 overflow-y-auto">
          {log.length === 0 ? (
            <div className="text-zinc-600 italic">no dispatches</div>
          ) : log.slice(-5).reverse().map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-zinc-400">
              <span className={e.ok ? "text-emerald-500" : "text-red-500"}>{e.ok ? "✓" : "✗"}</span>
              <span className="text-zinc-600">{formatTimestamp(e.ts)}</span>
              <span className="text-emerald-500">[{e.taskType}]</span>
              <span className="truncate flex-1">{e.summary}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="w-48 shrink-0">
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Coherence</div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10">
          {coherenceHistory.length > 1 && (
            <polyline
              points={coherenceHistory.map((c, i) => `${(i / (coherenceHistory.length - 1)) * w},${h - (c / maxC) * h}`).join(" ")}
              fill="none" stroke="#10b981" strokeWidth="1.5"
            />
          )}
        </svg>
        <div className="text-[10px] text-zinc-500 font-mono">
          last: {(coherenceHistory[coherenceHistory.length - 1] ?? 0).toFixed(4)}
        </div>
      </div>
    </div>
  );
}
