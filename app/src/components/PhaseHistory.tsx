import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const MESH_PATH = "C:\\Xova\\memory\\mesh_feed.jsonl";

interface PhaseEvent { ts: number; kind: string; from?: string; to?: string; label?: string; coherence?: number }

const PHASE_COLORS: Record<string, string> = {
  explore: "#60a5fa", build: "#34d399", review: "#fbbf24",
  deploy: "#a78bfa", idle: "#52525b", evolve: "#fb923c",
};

function phaseColor(phase: string) {
  const lc = phase.toLowerCase();
  for (const [k, c] of Object.entries(PHASE_COLORS)) {
    if (lc.includes(k)) return c;
  }
  return "#71717a";
}

function fmtTs(ts: number) {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export function PhaseHistory({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<PhaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: MESH_PATH });
      const parsed: PhaseEvent[] = raw.split("\n").filter(Boolean).flatMap(l => {
        try {
          const o = JSON.parse(l);
          if (o.kind === "phase_changed" || o.kind === "phase_start" || o.kind === "phase_end" ||
              (o.kind && String(o.kind).toLowerCase().includes("phase"))) {
            return [{ ts: o.ts, kind: o.kind, from: o.from, to: o.to, label: o.label, coherence: o.coherence }];
          }
          return [];
        } catch { return []; }
      });
      setEvents(parsed.slice(-100).reverse());
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { setEvents([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Phase History ({events.length}){updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && events.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no phase events in mesh_feed.jsonl</div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {events.map((e, i) => {
          const phase = e.to ?? e.label ?? e.kind;
          const color = phaseColor(phase ?? "");
          return (
            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-900/50">
              <span className="text-zinc-600 text-[9px] shrink-0 w-10">{fmtTs(e.ts)}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ color, backgroundColor: `${color}18` }}>
                {phase ?? e.kind}
              </span>
              {e.from && e.to && (
                <span className="text-zinc-600 text-[9px]">{e.from} → {e.to}</span>
              )}
              {e.coherence != null && (
                <span className="ml-auto text-[9px]" style={{ color: e.coherence >= 0.8 ? "#34d399" : e.coherence >= 0.5 ? "#fbbf24" : "#f87171" }}>
                  {e.coherence.toFixed(3)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
