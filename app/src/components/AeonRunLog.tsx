import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const RUN_LOG_PATH = "C:\\Xova\\memory\\aeon_run_log.jsonl";

interface RunEntry {
  ts: number;
  quality: number;
  peak_thrust: number;
  n_steps: number;
  validated: boolean;
  source: string;
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function Sparkline({ values }: { values: number[] }) {
  const W = 160, H = 24, pad = 2;
  const pts = values.slice(-20);
  if (pts.length < 2) return <span className="text-zinc-600 text-[9px]">—</span>;
  const xs = pts.map((_, i) => pad + (i / (pts.length - 1)) * (W - pad * 2));
  const ys = pts.map(v => H - pad - (v * (H - pad * 2)));
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={xs.map((x, i) => `${x},${ys[i]}`).join(" ")}
        fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map((v, i) => (
        <circle key={i} cx={xs[i]} cy={ys[i]} r="1.5"
          fill={v >= 0.9 ? "#34d399" : v >= 0.5 ? "#fbbf24" : "#f87171"} />
      ))}
    </svg>
  );
}

export function AeonRunLog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries]     = useState<RunEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: RUN_LOG_PATH });
      const parsed: RunEntry[] = raw
        .split("\n")
        .filter(Boolean)
        .map(l => { try { return JSON.parse(l) as RunEntry; } catch { return null; } })
        .filter((x): x is RunEntry => x !== null);
      setEntries(parsed);
      setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const validatedCount = entries.filter(e => e.validated).length;
  const avgQuality = entries.length
    ? (entries.reduce((s, e) => s + e.quality, 0) / entries.length).toFixed(4)
    : "—";
  const sparkVals = entries.map(e => e.quality);
  const shown = [...entries].reverse().slice(0, 80);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          AEON Run Log{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40"
        >
          ↻
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">runs</span>
          <span className="text-zinc-200">{entries.length}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">validated</span>
          <span className="text-zinc-200">{validatedCount}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">avg quality</span>
          <span className="text-zinc-200">{avgQuality}</span>
        </div>
        <div className="ml-auto">
          <Sparkline values={sparkVals} />
        </div>
      </div>

      {/* Loading / empty states */}
      {loading && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
      )}
      {!loading && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no run entries</div>
      )}

      {/* Entry list */}
      {entries.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {shown.map((entry, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1 border-b border-zinc-900/50 hover:bg-zinc-900/30">
              <span className="text-zinc-600 text-[9px] shrink-0 w-14">{fmtTime(entry.ts)}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 font-mono ${entry.validated ? "bg-emerald-900/40 text-emerald-300 border-emerald-700" : "bg-zinc-800 text-zinc-500 border-zinc-700"}`}>
                {entry.quality.toFixed(4)}
              </span>
              <span className="text-zinc-500 text-[9px] shrink-0">thrust={entry.peak_thrust.toExponential(3)}</span>
              <span className="text-zinc-700 text-[9px] shrink-0">{entry.n_steps}steps</span>
              {entry.validated && <span className="text-emerald-500 text-[9px]">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
