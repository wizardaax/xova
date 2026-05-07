import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const ABSORB_PATH    = "C:\\Xova\\memory\\absorb_log.jsonl";
const WORKING_PATH   = "C:\\Xova\\memory\\absorb_working.json";
const STATE_PATH     = "C:\\Xova\\memory\\absorb_state.json";

interface AbsorbEntry {
  ts: number;
  cycle: number;
  source: string;
  new_lines: number;
  significance: number;
  surfaced: boolean;
  last_sig?: number;
  two_strike?: boolean;
  recent?: boolean;
}
interface AbsorbWorking {
  source?: string;
  significance?: number;
  lines?: string[];
  ts?: number;
  cycle?: number;
}
interface AbsorbState { [source: string]: { last_sig?: number; last_cycle?: number } }

function fmtTime(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sourcePill(source: string) {
  if (source === "forge_events") return "bg-purple-900/60 text-purple-300 border-purple-800";
  if (source === "mesh_feed")    return "bg-blue-900/60 text-blue-300 border-blue-800";
  return "bg-zinc-800 text-zinc-400 border-zinc-700";
}

function sigBadge(sig: number) {
  if (sig >= 5) return "bg-red-900/70 text-red-300 border-red-700";
  if (sig === 4) return "bg-orange-900/60 text-orange-300 border-orange-700";
  if (sig === 3) return "bg-amber-900/60 text-amber-300 border-amber-700";
  return "bg-zinc-800 text-zinc-500 border-zinc-700";
}

function Sparkline({ values }: { values: number[] }) {
  const W = 200, H = 28, pad = 2;
  const pts = values.slice(-20);
  if (pts.length < 2) return <span className="text-zinc-600 text-[9px]">—</span>;
  const xs = pts.map((_, i) => pad + (i / (pts.length - 1)) * (W - pad * 2));
  const ys = pts.map(v => H - pad - ((v - 1) / 4) * (H - pad * 2));
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={xs.map((x, i) => `${x},${ys[i]}`).join(" ")}
        fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map((v, i) => (
        <circle key={i} cx={xs[i]} cy={ys[i]} r="2"
          fill={v >= 5 ? "#f87171" : v === 4 ? "#fb923c" : v === 3 ? "#fbbf24" : "#52525b"} />
      ))}
    </svg>
  );
}

export function AbsorbLog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries]   = useState<AbsorbEntry[]>([]);
  const [working, setWorking]   = useState<AbsorbWorking | null>(null);
  const [absState, setAbsState] = useState<AbsorbState>({});
  const [loading, setLoading]   = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: ABSORB_PATH });
      const parsed: AbsorbEntry[] = raw
        .split("\n")
        .filter(Boolean)
        .slice(-120)
        .map(l => { try { return JSON.parse(l) as AbsorbEntry; } catch { return null; } })
        .filter((x): x is AbsorbEntry => x !== null);
      setEntries(parsed);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { setEntries([]); }
    try {
      const raw = await invoke<string>("xova_read_file", { path: WORKING_PATH });
      setWorking(JSON.parse(raw) as AbsorbWorking);
    } catch { setWorking(null); }
    try {
      const raw = await invoke<string>("xova_read_file", { path: STATE_PATH });
      setAbsState(JSON.parse(raw) as AbsorbState);
    } catch { setAbsState({}); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const shown = [...entries].reverse().slice(0, 50);
  const totalCycles = entries.length;
  const avgSig = entries.length
    ? (entries.reduce((s, e) => s + e.significance, 0) / entries.length).toFixed(2)
    : "—";
  const surfacedCount = entries.filter(e => e.surfaced).length;
  const sparkVals = entries.map(e => e.significance);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Absorb Log{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex items-center gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">cycles</span>
          <span className="text-zinc-200">{totalCycles}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">avg sig</span>
          <span className="text-zinc-200">{avgSig}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">surfaced</span>
          <span className="text-zinc-200">{surfacedCount}</span>
        </div>
        <div className="ml-auto">
          <Sparkline values={sparkVals} />
        </div>
      </div>

      {/* Absorb state per source */}
      {Object.keys(absState).length > 0 && (
        <div className="flex gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">
          {Object.entries(absState).map(([src, st]) => (
            <div key={src} className="flex flex-col text-center">
              <span className={`text-[8px] px-1.5 py-0.5 rounded border ${sourcePill(src)}`}>{src}</span>
              <span className="text-zinc-600 text-[7px]">sig:{st.last_sig ?? "?"} cy:{st.last_cycle ?? "?"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Current working item */}
      {working && (
        <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[7px] uppercase tracking-wider text-zinc-600">in-flight</span>
            <span className={`text-[8px] px-1 rounded border ${sourcePill(working.source ?? "")}`}>{working.source}</span>
            {working.significance !== undefined && (
              <span className={`text-[8px] px-1 rounded border font-bold ${sigBadge(working.significance)}`}>{working.significance}</span>
            )}
            <span className="text-zinc-700 text-[8px] ml-auto">cy:{working.cycle} +{working.lines?.length ?? 0} lines</span>
          </div>
          {working.lines && working.lines.length > 0 && (
            <div className="text-[8px] text-zinc-500 truncate">{working.lines[0]?.slice(0, 120)}</div>
          )}
        </div>
      )}

      {loading && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
      )}
      {!loading && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no absorb entries</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {shown.map((e, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1 border-b border-zinc-900/50 hover:bg-zinc-900/30">
            <span className="text-zinc-600 text-[9px] shrink-0 w-5 text-right">{e.cycle}</span>
            <span className="text-zinc-600 text-[9px] shrink-0 w-10">{fmtTime(e.ts)}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 truncate max-w-[90px] ${sourcePill(e.source)}`}>
              {e.source}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 font-bold ${sigBadge(e.significance)}`}>
              {e.significance}
            </span>
            <span className="text-zinc-500 text-[9px] shrink-0">+{e.new_lines}</span>
            {e.surfaced && (
              <span className="text-emerald-400 text-[9px] shrink-0" title="surfaced">✓</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
