import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const INBOX_PATH = "C:\\Xova\\memory\\coherence_inbox.json";

interface InboxItem {
  ts: number;
  from: string;
  to: string;
  task_type: string;
  goal_id?: string;
  goal?: string;
  payload?: { avg_coherence?: number; task_msg?: string };
  status: string;
}

const TASK_CLS: Record<string, string> = {
  observation: "bg-blue-900/40 text-blue-300 border-blue-700",
  analysis:    "bg-violet-900/40 text-violet-300 border-violet-700",
  synthesis:   "bg-teal-900/40 text-teal-300 border-teal-700",
  evaluation:  "bg-amber-900/40 text-amber-300 border-amber-700",
};

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function cohColor(c?: number) {
  if (c === undefined) return "text-zinc-600";
  if (c >= 0.7) return "text-emerald-400";
  if (c >= 0.5) return "text-amber-400";
  return "text-red-400";
}

export function CoherenceInbox({ onClose }: { onClose: () => void }) {
  const [items,   setItems]   = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: INBOX_PATH });
      const d = JSON.parse(raw);
      setItems(Array.isArray(d) ? d : []);
    } catch { setItems([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [refresh]);

  const avgCoh = items.length
    ? (items.reduce((s, i) => s + (i.payload?.avg_coherence ?? 0), 0) / items.length).toFixed(3)
    : "—";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Coherence Inbox</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">dispatched</span>
          <span className="text-zinc-200">{items.length}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">avg coh</span>
          <span className="text-zinc-200">{avgCoh}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">target</span>
          <span className="text-zinc-200">{items[0]?.to ?? "—"}</span>
        </div>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && items.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">inbox empty</div>}

      <div className="flex-1 overflow-y-auto">
        {[...items].reverse().map((item, i) => {
          const coh = item.payload?.avg_coherence;
          return (
            <div key={i} className="px-3 py-2 border-b border-zinc-900/60 hover:bg-zinc-900/30">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`text-[7px] px-1 py-px rounded border ${TASK_CLS[item.task_type] ?? "bg-zinc-800 border-zinc-700 text-zinc-400"}`}>
                  {item.task_type}
                </span>
                <span className="text-zinc-600 text-[8px]">{item.from} → {item.to}</span>
                {coh !== undefined && (
                  <span className={`text-[9px] font-bold ml-auto ${cohColor(coh)}`}>{coh.toFixed(3)}</span>
                )}
                <span className="text-zinc-700 text-[8px]">{fmtAgo(item.ts)}</span>
              </div>
              {item.goal && (
                <div className="text-zinc-500 text-[8px] leading-snug truncate">{item.goal}</div>
              )}
              {coh !== undefined && (
                <div className="h-1 bg-zinc-800 rounded overflow-hidden mt-1">
                  <div className={`h-full rounded ${coh >= 0.7 ? "bg-emerald-500" : coh >= 0.5 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${Math.round(coh * 100)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
