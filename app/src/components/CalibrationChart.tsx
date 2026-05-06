import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PATH = "C:\\Xova\\memory\\calibration.jsonl";
const W = 370, H = 80, PAD = { t: 6, r: 6, b: 18, l: 32 };
const IW = W - PAD.l - PAD.r, IH = H - PAD.t - PAD.b;

interface CalibEntry {
  ts_utc: string;
  flagged: boolean;
  risk_distribution: Record<string, number>;
  calibration: { current_threshold: number; flag_rate: number; reasoning: string };
}

function fmtTs(ts: string) {
  try { const d = new Date(ts); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
  catch { return ""; }
}

export function CalibrationChart({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CalibEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: PATH });
      const parsed = raw.split("\n").filter(Boolean).slice(-100).flatMap(l => {
        try { return [JSON.parse(l) as CalibEntry]; } catch { return []; }
      });
      setEntries(parsed);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { setEntries([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  const n = entries.length;
  const last = n > 0 ? entries[n - 1] : null;

  // flag_rate chart
  const rates = entries.map(e => e.calibration?.flag_rate ?? 0);
  const maxR = Math.max(...rates, 0.01);
  const xOf = (i: number) => PAD.l + (i / Math.max(n - 1, 1)) * IW;
  const yOf = (v: number) => PAD.t + (1 - v / maxR) * IH;
  const lineD = rates.map((r, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(r).toFixed(1)}`).join(" ");

  // risk distribution bars
  const riskKeys = ["1", "2", "3", "4", "5"];
  const riskDist = last?.risk_distribution ?? {};
  const riskMax = Math.max(...riskKeys.map(k => riskDist[k] ?? 0), 1);
  const RISK_COLORS = ["#34d399", "#86efac", "#fbbf24", "#fb923c", "#f87171"];

  const flaggedCount = entries.filter(e => e.flagged).length;
  const avgRate = n ? (rates.reduce((s, r) => s + r, 0) / n).toFixed(3) : "—";
  const curThreshold = last?.calibration?.current_threshold?.toFixed(3) ?? "—";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Calibration{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && n === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no calibration data</div>}

      {!loading && n > 0 && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {([["threshold", curThreshold, "#34d399"], ["avg rate", avgRate, "#a1a1aa"], ["flagged", String(flaggedCount), flaggedCount > 0 ? "#f87171" : "#a1a1aa"]] as [string,string,string][]).map(([l,v,c]) => (
              <div key={l} className="bg-zinc-900 rounded p-2 text-center">
                <div className="text-[9px] text-zinc-500 uppercase">{l}</div>
                <div className="font-bold mt-0.5" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {n > 1 && (
            <div>
              <div className="text-[9px] text-zinc-600 uppercase mb-1">flag rate over time</div>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
                <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + IH} stroke="#3f3f46" strokeWidth="0.5" />
                <line x1={PAD.l} y1={PAD.t + IH} x2={PAD.l + IW} y2={PAD.t + IH} stroke="#3f3f46" strokeWidth="0.5" />
                <text x={PAD.l - 3} y={PAD.t} textAnchor="end" dominantBaseline="middle" fontSize="7" fill="#52525b">{maxR.toFixed(2)}</text>
                <path d={lineD} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinejoin="round" />
                <circle cx={xOf(n - 1)} cy={yOf(rates[n - 1])} r="3" fill="#34d399" />
                {[0, Math.floor(n / 2), n - 1].map(i => (
                  <text key={i} x={xOf(i)} y={PAD.t + IH + 10} textAnchor="middle" fontSize="7" fill="#52525b">{fmtTs(entries[i].ts_utc)}</text>
                ))}
              </svg>
            </div>
          )}

          {last && (
            <div>
              <div className="text-[9px] text-zinc-600 uppercase mb-1">risk distribution (last entry)</div>
              {riskKeys.map((k, i) => {
                const val = riskDist[k] ?? 0;
                const pct = riskMax > 0 ? (val / riskMax) * 100 : 0;
                return (
                  <div key={k} className="flex items-center gap-2 mb-0.5">
                    <span className="w-4 text-right text-[9px] text-zinc-500">R{k}</span>
                    <div className="flex-1 h-3 bg-zinc-800 rounded-sm overflow-hidden">
                      <div className="h-full rounded-sm transition-all" style={{ width: `${pct}%`, backgroundColor: RISK_COLORS[i] }} />
                    </div>
                    <span className="w-8 text-right text-[9px] text-zinc-500">{val}</span>
                  </div>
                );
              })}
            </div>
          )}

          {last?.calibration?.reasoning && (
            <div className="bg-zinc-900 rounded p-2 text-[10px] text-zinc-400">{last.calibration.reasoning}</div>
          )}
        </div>
      )}
    </div>
  );
}
