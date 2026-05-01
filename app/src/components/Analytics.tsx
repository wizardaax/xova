import { formatTimestamp } from "@/lib/utils";

export interface DispatchLogEntry {
  id: string;
  taskType: string;
  ts: number;
  ok: boolean;
  summary: string;
}

interface Props {
  log: DispatchLogEntry[];
  coherenceHistory: number[];
}

export function Analytics({ log, coherenceHistory }: Props) {
  const maxC = Math.max(0.001, ...coherenceHistory);
  const w = 240, h = 60;

  return (
    <div className="h-48 bg-slate-50 border-t border-slate-200 flex">
      <div className="flex-1 flex flex-col px-6 py-3 min-w-0">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Recent Dispatches</h2>
        <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px]">
          {log.length === 0 ? (
            <div className="text-slate-400 italic">No dispatches yet</div>
          ) : log.slice(-30).reverse().map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-slate-700">
              <span className={e.ok ? "text-emerald-600" : "text-red-600"}>{e.ok ? "✓" : "✗"}</span>
              <span className="text-slate-400 w-16">{formatTimestamp(e.ts)}</span>
              <span className="text-blue-600 w-24">[{e.taskType}]</span>
              <span className="truncate flex-1 text-slate-600">{e.summary}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="w-72 px-6 py-3 border-l border-slate-200">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Coherence</h2>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16">
          {coherenceHistory.length > 1 && (
            <polyline
              points={coherenceHistory.map((c, i) => `${(i / (coherenceHistory.length - 1)) * w},${h - (c / maxC) * h}`).join(" ")}
              fill="none" stroke="#3b82f6" strokeWidth="2"
            />
          )}
          {coherenceHistory.map((c, i) => (
            <circle
              key={i}
              cx={(i / Math.max(1, coherenceHistory.length - 1)) * w}
              cy={h - (c / maxC) * h}
              r="2" fill="#3b82f6"
            />
          ))}
        </svg>
        <div className="text-[10px] text-slate-500 font-mono mt-1">
          last: {(coherenceHistory[coherenceHistory.length - 1] ?? 0).toFixed(4)}
        </div>
      </div>
    </div>
  );
}
