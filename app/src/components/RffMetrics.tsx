import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface RffResult { coherence: number; entropy: number; confidence: number; n: number; cycles: number; rff_ok: boolean }

const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const SCRIPT = "C:\\Xova\\plugins\\rff_score.py";

function Gauge({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = pct >= 0.7 ? "#34d399" : pct >= 0.4 ? "#fbbf24" : "#f87171";
  const bg = "#27272a";
  const r = 36, cx = 50, cy = 54, strokeW = 8;
  const circ = 2 * Math.PI * r;
  const arcPct = 0.75; // 270° arc
  const dash = circ * arcPct;
  const offset = dash - pct * dash;
  const rotation = 135;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 100 80" width="100" height="80">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={bg} strokeWidth={strokeW}
          strokeDasharray={`${dash} ${circ}`} strokeDashoffset={0}
          strokeLinecap="round" transform={`rotate(${rotation} ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeW}
          strokeDasharray={`${dash} ${circ}`} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(${rotation} ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
        <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
          fontSize={15} fontWeight="700" fill={color} fontFamily="monospace">
          {(pct * 100).toFixed(0)}
        </text>
      </svg>
      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</span>
    </div>
  );
}

export function RffMetrics({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<RffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_run", { command: `${PYTHON} ${SCRIPT}`, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const wrap = JSON.parse(raw) as { stdout?: string }; if (wrap.stdout !== undefined) stdout = wrap.stdout; } catch { /* raw */ }
      setData(JSON.parse(stdout) as RffResult);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-xs p-3">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          RFF Metrics{data?.rff_ok ? " ✓" : data ? " (fallback)" : ""}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 text-[10px] disabled:opacity-40">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      {loading && !data && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">computing…</div>
      )}

      {data && (
        <>
          <div className="flex justify-around mb-3">
            <Gauge value={data.coherence}  label="Coherence" />
            <Gauge value={data.entropy}    label="Entropy" />
            <Gauge value={data.confidence} label="Confidence" />
          </div>

          <div className="text-center text-[10px] text-zinc-600 space-y-0.5">
            <div>N={data.n} samples · {data.cycles} absorb cycles</div>
            {updatedAt && <div>updated {updatedAt}</div>}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {([["coherence", data.coherence], ["entropy", data.entropy], ["confidence", data.confidence]] as [string, number][]).map(([k, v]) => (
              <div key={k} className="bg-zinc-900 rounded p-2">
                <div className="text-zinc-500 text-[9px] uppercase">{k}</div>
                <div className="text-zinc-200 text-sm font-bold">{v.toFixed(3)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
