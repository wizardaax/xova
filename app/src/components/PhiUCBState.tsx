import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const UCB_PATH   = "C:\\Xova\\memory\\phi_ucb_state.json";
const GOALS_PATH = "C:\\Xova\\memory\\goal_store.json";

interface UCBSlot { q: number; n: number; }
interface GoalEntry { id?: string; text?: string; title?: string; }

const PLUGIN_LABELS = [
  "aeon_sweep", "ci_health", "lucas_phase",
  "field_weave", "ternary_eval", "corpus_recall", "repo_sync",
];

function barWidth(q: number) { return Math.round(q * 100); }
function qColor(q: number) {
  if (q >= 0.9) return "bg-emerald-500";
  if (q >= 0.7) return "bg-teal-500";
  if (q >= 0.5) return "bg-amber-500";
  return "bg-red-500";
}

export function PhiUCBState({ onClose }: { onClose: () => void }) {
  const [slots,     setSlots]     = useState<UCBSlot[]>([]);
  const [totalGoals,setTotalGoals]= useState<number | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: UCB_PATH });
      setSlots(JSON.parse(raw) as UCBSlot[]);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { setSlots([]); }
    try {
      const raw = await invoke<string>("xova_read_file", { path: GOALS_PATH });
      const g = JSON.parse(raw) as { goals?: GoalEntry[] } | GoalEntry[];
      setTotalGoals(Array.isArray(g) ? g.length : (g.goals?.length ?? null));
    } catch { /* ok */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const totalVisits = slots.reduce((s, sl) => s + sl.n, 0);
  const topSlot = slots.length ? Math.max(...slots.map(s => s.q)) : 0;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          φ-UCB State{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">plugins</span>
          <span className="text-zinc-200">{slots.length}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">total visits</span>
          <span className="text-zinc-200">{totalVisits}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">peak q</span>
          <span className="text-zinc-200">{topSlot.toFixed(3)}</span>
        </div>
        {totalGoals !== null && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-zinc-600 uppercase">goals</span>
            <span className="text-zinc-200">{totalGoals}</span>
          </div>
        )}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && slots.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no UCB state</div>}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {slots.map((sl, i) => {
          const label = PLUGIN_LABELS[i] ?? `slot ${i}`;
          const w = barWidth(sl.q);
          return (
            <div key={i}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-zinc-300 text-[10px] flex-1">{label}</span>
                <span className="text-zinc-500 text-[9px]">n={sl.n}</span>
                <span className="text-zinc-200 text-[10px] font-bold w-14 text-right">{sl.q.toFixed(3)}</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded overflow-hidden">
                <div className={`h-full rounded transition-all ${qColor(sl.q)}`} style={{ width: `${w}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
