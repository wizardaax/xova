import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const EVENTS_PATH = "C:\\Xova\\memory\\forge_events.jsonl";

interface ForgeEvent {
  ts: number;
  kind: string;
  sce88_levels?: number[];
  note?: string;
  user_query?: string;
  risk?: number;
  answered?: boolean;
}

const KIND_CLS: Record<string, string> = {
  "self-eval":          "text-teal-400",
  "self-eval-flagged":  "text-red-400",
  "auto-correction":    "text-amber-400",
  "gate-block":         "text-red-500",
  "gate-pass":          "text-emerald-400",
};

function riskColor(r?: number) {
  if (r === undefined) return "text-zinc-600";
  if (r >= 4) return "text-red-400";
  if (r >= 3) return "text-amber-400";
  if (r >= 2) return "text-yellow-400";
  return "text-emerald-400";
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

export function ForgeEventsLog({ onClose }: { onClose: () => void }) {
  const [events,  setEvents]  = useState<ForgeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: EVENTS_PATH });
      const parsed: ForgeEvent[] = [];
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try { parsed.push(JSON.parse(t) as ForgeEvent); } catch { /**/ }
      }
      setEvents(parsed);
    } catch { setEvents([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [refresh]);

  const allKinds = [...new Set(events.map(e => e.kind))];
  const visible = filter === "all" ? events : events.filter(e => e.kind === filter);
  const flagged = events.filter(e => e.kind === "self-eval-flagged").length;
  const avgRisk = events.filter(e => e.risk !== undefined).length
    ? (events.filter(e => e.risk !== undefined).reduce((s, e) => s + (e.risk ?? 0), 0) /
       events.filter(e => e.risk !== undefined).length).toFixed(1)
    : "—";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Forge Events</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">events</span>
          <span className="text-zinc-200">{events.length}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">flagged</span>
          <span className={flagged > 0 ? "text-red-400" : "text-zinc-200"}>{flagged}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">avg risk</span>
          <span className="text-zinc-200">{avgRisk}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 px-3 py-1 border-b border-zinc-800 shrink-0">
        <button onClick={() => setFilter("all")}
          className={`text-[7px] px-1 py-px rounded border ${filter === "all" ? "bg-zinc-700 border-zinc-500 text-zinc-200" : "border-zinc-800 text-zinc-600 hover:text-zinc-400"}`}>
          all {events.length}
        </button>
        {allKinds.map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-[7px] px-1 py-px rounded border ${filter === k ? "bg-zinc-700 border-zinc-500 text-zinc-200" : "border-zinc-800 text-zinc-600 hover:text-zinc-400"}`}>
            {k.replace(/-/g, " ")} {events.filter(e => e.kind === k).length}
          </button>
        ))}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      <div className="flex-1 overflow-y-auto">
        {[...visible].reverse().map((e, i) => {
          const isOpen = expanded === i;
          return (
            <div key={i} className="border-b border-zinc-900/50">
              <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-zinc-900/30"
                onClick={() => setExpanded(isOpen ? null : i)}>
                <span className="text-zinc-700 text-[8px] shrink-0 w-16">{fmtTime(e.ts)}</span>
                <span className={`text-[8px] shrink-0 ${KIND_CLS[e.kind] ?? "text-zinc-500"}`}>
                  {e.kind.replace(/-/g, " ")}
                </span>
                {e.risk !== undefined && (
                  <span className={`text-[8px] font-bold shrink-0 ${riskColor(e.risk)}`}>r{e.risk}</span>
                )}
                {e.sce88_levels && e.sce88_levels.length > 0 && (
                  <span className="text-[7px] text-zinc-600 shrink-0">
                    SCE-{e.sce88_levels.join(",")}
                  </span>
                )}
                <span className="text-zinc-600 text-[8px] flex-1 truncate">{e.user_query ?? ""}</span>
                <span className="text-zinc-700 text-[8px]">{isOpen ? "▲" : "▼"}</span>
              </div>
              {isOpen && e.note && (
                <div className="px-3 pb-2 pt-0">
                  <div className="border-l-2 border-zinc-700 pl-2 text-zinc-400 text-[8px] leading-snug">
                    {e.note}
                  </div>
                  {e.answered !== undefined && (
                    <div className={`mt-1 text-[8px] ${e.answered ? "text-emerald-400/70" : "text-red-400/70"}`}>
                      {e.answered ? "✓ answered" : "✗ not answered"}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
