import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const FEED_PATH = "C:\\Xova\\memory\\mesh_feed.jsonl";

// mesh_feed.jsonl uses "kind" (not "type") and has "risk", "gated", "human_gate" fields
interface FeedEvent { ts?: number; kind?: string; agent_id?: string; label?: string; content?: string; coherence?: number; risk?: string; gated?: boolean; human_gate?: boolean; [k: string]: unknown }

const VIOLATION_KINDS = ["constraint_violation", "guard_alert", "coherence_fail", "sce88_breach", "sentinel_alert"];
const HIGH_RISK_KINDS = new Set(["agent_result"]);  // real feed events flagged by risk/gated

function severityBadge(sev?: string): string {
  if (!sev) return "border-zinc-700 text-zinc-500 bg-zinc-900";
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high") return "border-red-700 text-red-400 bg-red-900/20";
  if (s === "medium" || s === "warn") return "border-amber-700 text-amber-400 bg-amber-900/20";
  return "border-zinc-700 text-zinc-400 bg-zinc-900";
}

function fmtTs(ts?: number): string {
  if (!ts) return "—";
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

export function ConstraintGuard({ onClose }: { onClose: () => void }) {
  const [violations, setViolations] = useState<FeedEvent[]>([]);
  const [all, setAll] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: FEED_PATH }).catch(() => "");
      const events: FeedEvent[] = raw.split("\n").filter(Boolean).map(l => {
        try { return JSON.parse(l) as FeedEvent; } catch { return null; }
      }).filter(Boolean) as FeedEvent[];
      events.reverse();
      const viols = events.filter(e =>
        VIOLATION_KINDS.includes(e.kind ?? "") ||
        (HIGH_RISK_KINDS.has(e.kind ?? "") && (e.gated || e.human_gate || e.risk === "high" || e.risk === "critical"))
      );
      setViolations(viols);
      setAll(events);
      setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 10_000); return () => clearInterval(id); }, [refresh]);

  const displayed = showAll ? all.slice(0, 200) : violations.slice(0, 100);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Constraint Guard
          {violations.length > 0 && <span className="ml-1.5 text-red-400">{violations.length} violation{violations.length !== 1 ? "s" : ""}</span>}
          {updatedAt && <span className="ml-1.5 text-zinc-600">· {updatedAt}</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setShowAll(v => !v)}
            className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${showAll ? "border-zinc-500 text-zinc-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
            {showAll ? "violations only" : "all events"}
          </button>
          <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      {loading && displayed.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">scanning…</div>
      )}
      {!loading && displayed.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-zinc-600">
          <span className="text-emerald-500 text-lg">✓</span>
          <span className="text-[10px]">{showAll ? "no events" : "no violations detected"}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-zinc-900/50">
        {displayed.map((e, i) => {
          const isViol = VIOLATION_KINDS.includes(e.kind ?? "") || e.gated || e.human_gate;
          return (
            <div key={i} className={`px-3 py-1.5 hover:bg-zinc-900/30 ${isViol ? "bg-red-950/10" : ""}`}>
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-600 text-[9px] tabular-nums shrink-0">{fmtTs(e.ts)}</span>
                <span className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${severityBadge(e.risk)}`}>
                  {e.risk ?? e.kind ?? "event"}
                </span>
                {e.agent_id && <span className="text-zinc-500 text-[9px] shrink-0">{e.agent_id}</span>}
                {e.gated && <span className="text-[9px] px-1 py-0.5 rounded border border-amber-700 text-amber-400 shrink-0">gated</span>}
                {e.human_gate && <span className="text-[9px] px-1 py-0.5 rounded border border-red-700 text-red-400 shrink-0">human</span>}
                {e.coherence != null && <span className="text-zinc-600 text-[9px] ml-auto tabular-nums">{(e.coherence as number).toFixed(3)}</span>}
              </div>
              {(e.label || e.content) && (
                <div className="mt-0.5 text-zinc-400 text-[10px] break-words leading-relaxed">
                  {e.label && <span className="text-zinc-500 mr-1">[{e.label}]</span>}
                  {e.content && String(e.content).slice(0, 120)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
