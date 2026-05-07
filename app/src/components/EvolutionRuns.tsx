import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY     = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN = "C:\\Xova\\plugins\\evo_runs.py";
const CWD    = "C:\\Xova";

interface EvoRun {
  filename: string;
  ts: number;
  gaps_found: number;
  proposed: number;
  applied: number;
  coherence?: number;
  mean_health?: number;
  auto_merge: boolean;
}

interface RunsResult { ok: boolean; runs?: EvoRun[]; total_files?: number; error?: string; }

function fmtTime(ts: number) {
  if (!ts) return "—";
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function cohColor(c?: number) {
  if (c === undefined) return "text-zinc-600";
  if (c >= 0.7) return "text-emerald-400";
  if (c >= 0.5) return "text-amber-400";
  return "text-red-400";
}

function Sparkline({ values }: { values: number[] }) {
  const W = 140, H = 20, pad = 2;
  if (values.length < 2) return <span className="text-zinc-600 text-[8px]">—</span>;
  const xs = values.map((_, i) => pad + (i / (values.length - 1)) * (W - pad * 2));
  const ys = values.map(v => H - pad - (v * (H - pad * 2)));
  return (
    <svg width={W} height={H} className="shrink-0">
      <polyline points={xs.map((x, i) => `${x},${ys[i]}`).join(" ")}
        fill="none" stroke="#22d3ee" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function EvolutionRuns({ onClose }: { onClose: () => void }) {
  const [runs,      setRuns]      = useState<EvoRun[]>([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PY}" "${PLUGIN}" --limit=40`, cwd: CWD, elevated: false,
      });
      let text = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout) text = w.stdout; } catch { /**/ }
      const r = JSON.parse(text) as RunsResult;
      if (r.ok) {
        setRuns(r.runs ?? []);
        setTotal(r.total_files ?? 0);
        setErr("");
        setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      } else setErr(r.error ?? "plugin failed");
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const cohVals = runs.filter(r => r.coherence !== undefined).map(r => r.coherence as number).reverse();
  const totalApplied = runs.reduce((s, r) => s + r.applied, 0);
  const totalGaps    = runs.reduce((s, r) => s + r.gaps_found, 0);
  const avgCoh = cohVals.length
    ? (cohVals.reduce((a, b) => a + b, 0) / cohVals.length).toFixed(3)
    : "—";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Evo Runs{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <span className="text-zinc-700 text-[8px]">{total} total files</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Stats + sparkline */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        {[
          { label: "showing",  val: runs.length },
          { label: "gaps",     val: totalGaps },
          { label: "applied",  val: totalApplied },
          { label: "avg coh",  val: avgCoh },
        ].map(({ label, val }) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-[9px] text-zinc-600 uppercase">{label}</span>
            <span className="text-zinc-200">{val}</span>
          </div>
        ))}
        <div className="ml-auto"><Sparkline values={cohVals} /></div>
      </div>

      {loading && runs.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && err && <div className="flex-1 flex items-center justify-center text-red-400 text-[9px] px-4 text-center">{err}</div>}
      {!loading && !err && runs.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no runs found</div>}

      <div className="flex-1 overflow-y-auto">
        {runs.map((r, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1 border-b border-zinc-900/50 hover:bg-zinc-900/30">
            <span className="text-zinc-600 text-[9px] shrink-0 w-10">{fmtTime(r.ts)}</span>
            <span className={`text-[9px] font-mono font-bold shrink-0 w-10 ${cohColor(r.coherence)}`}>
              {r.coherence !== undefined ? r.coherence.toFixed(3) : "—"}
            </span>
            <span className="text-zinc-600 text-[9px] shrink-0">⚠{r.gaps_found}</span>
            <span className="text-zinc-500 text-[9px] shrink-0">→{r.proposed}</span>
            <span className="text-emerald-500/70 text-[9px] shrink-0">✓{r.applied}</span>
            {r.auto_merge && <span className="text-cyan-500/60 text-[8px] shrink-0">auto</span>}
            <span className="text-zinc-700 text-[8px] truncate flex-1">
              {r.mean_health !== undefined ? `h=${r.mean_health.toFixed(3)}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
