import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const CMD_SUMMARY  = `python "C:\\Xova\\plugins\\aeon_summary.py"`;
const CMD_SWEEP    = `python "C:\\Xova\\plugins\\aeon_sweep.py"`;
const RUN_LOG_PATH = "C:\\Xova\\memory\\aeon_run_log.jsonl";
const BROKER_PATH  = "C:\\Xova\\memory\\context_broker.json";
const W = 360, H = 100, PAD = { t: 6, r: 6, b: 18, l: 6 };
const IW = W - PAD.l - PAD.r, IH = H - PAD.t - PAD.b;

interface ThrustPoint { t: number; phi: number; thrust: number }
interface AeonQuality { score: number; validated: boolean; max_rel_err: number; n_steps: number; peak_thrust: number }
interface AeonSummary {
  thrust_series: ThrustPoint[];
  validation: { matched: boolean; max_rel_err: number };
  constants: { PHI?: number; PSI_RESONANCE?: number; GOLDEN_ANGLE_DEG?: number; ALPHA_INV?: number; [k: string]: number | undefined };
  quality?: AeonQuality;
  source?: string;
  cycle?: number;
}
interface SweepPoint {
  k_factor: number; k_value: number; peak_thrust?: number; quality?: number; validated?: boolean; error?: string;
}
interface SweepResult {
  ok: boolean; k_base: number; n_points: number; sweep: SweepPoint[]; optimal?: SweepPoint;
}
interface RunRecord { ts: number; quality?: number; peak_thrust?: number; n_steps?: number; validated?: boolean }

export function AeonThrust({ onClose }: { onClose: () => void }) {
  const [summary,    setSummary]    = useState<AeonSummary | null>(null);
  const [sweep,      setSweep]      = useState<SweepResult | null>(null);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [err,        setErr]        = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [sweeping,   setSweeping]   = useState(false);
  const [updatedAt,  setUpdatedAt]  = useState("");
  const [tab,        setTab]        = useState<"sim" | "sweep" | "history">("sim");

  async function xovaRun(cmd: string): Promise<string> {
    const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
    try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) return w.stdout; } catch { /**/ }
    return raw;
  }

  const loadHistory = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: RUN_LOG_PATH });
      const lines = raw.trim().split("\n").filter(Boolean).slice(-30);
      const records: RunRecord[] = lines.map(l => { try { return JSON.parse(l) as RunRecord; } catch { return null; } }).filter(Boolean) as RunRecord[];
      setRunHistory(records);
    } catch { setRunHistory([]); }
    // Also try loading sweep from broker
    try {
      const bRaw = await invoke<string>("xova_read_file", { path: BROKER_PATH });
      const broker = JSON.parse(bRaw) as { slots?: Record<string, unknown> };
      const s = broker.slots?.["xova.aeon_sweep_result"] as SweepResult | undefined;
      if (s?.ok) setSweep(s);
    } catch { /**/ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const stdout = await xovaRun(CMD_SUMMARY);
      const parsed = JSON.parse(stdout) as { ok: boolean; summary?: AeonSummary; error?: string };
      if (!parsed.ok || !parsed.summary) { setErr(parsed.error ?? "aeon_summary.py not ready"); setSummary(null); }
      else { setSummary(parsed.summary); setErr(null); setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })); }
    } catch { setErr("aeon_summary.py not ready"); setSummary(null); }
    await loadHistory();
    setLoading(false);
  }, [loadHistory]);

  const runSweep = useCallback(async () => {
    setSweeping(true);
    try {
      const stdout = await xovaRun(CMD_SWEEP);
      const parsed = JSON.parse(stdout) as SweepResult;
      if (parsed.ok) { setSweep(parsed); setTab("sweep"); }
    } catch { /**/ }
    setSweeping(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const series = summary?.thrust_series ?? [];
  const n = series.length;
  const minT = n ? Math.min(...series.map(p => p.thrust)) : 0;
  const maxT = n ? Math.max(...series.map(p => p.thrust)) : 1;
  const range = maxT - minT || 1;
  const xOf = (i: number) => PAD.l + (i / Math.max(n - 1, 1)) * IW;
  const yOf = (v: number) => PAD.t + (1 - (v - minT) / range) * IH;
  const lineD = series.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.thrust).toFixed(1)}`).join(" ");

  const CONST_LABELS: [keyof AeonSummary["constants"], string][] = [
    ["PHI", "φ"], ["PSI_RESONANCE", "ψ"], ["GOLDEN_ANGLE_DEG", "∠°"], ["ALPHA_INV", "α⁻¹"],
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">AEON{updatedAt ? ` · ${updatedAt}` : ""}</span>
        <div className="flex gap-1 ml-auto">
          {(["sim", "sweep", "history"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2 py-0.5 rounded border text-[8px] transition-colors ${tab === t ? "border-violet-600 text-violet-300 bg-violet-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
              {t}
            </button>
          ))}
        </div>
        <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40 text-[10px]">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && !summary && tab === "sim" && <div className="flex-1 flex items-center justify-center text-zinc-600">running…</div>}

      {err && !summary && tab === "sim" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-amber-400">{err}</span>
        </div>
      )}

      {/* Sim tab */}
      {tab === "sim" && summary && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="grid grid-cols-4 gap-1">
            {CONST_LABELS.map(([key, sym]) => {
              const v = summary.constants[key];
              return (
                <div key={key} className="bg-zinc-900 rounded p-1.5 text-center">
                  <div className="text-[9px] text-zinc-500">{sym}</div>
                  <div className="text-zinc-200 font-bold text-[11px]">{v !== undefined ? v.toFixed(4) : "—"}</div>
                </div>
              );
            })}
          </div>

          {n > 0 && (
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
              <rect x={PAD.l} y={PAD.t} width={IW} height={IH} fill="#18181b" rx="2" />
              <path d={lineD} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx={xOf(n - 1)} cy={yOf(series[n - 1].thrust)} r="3" fill="#a78bfa" />
              <text x={PAD.l + 2} y={PAD.t + IH - 3} fontSize="7" fill="#52525b">t={series[0].t.toExponential(2)}</text>
              <text x={PAD.l + IW - 2} y={PAD.t + IH - 3} fontSize="7" fill="#52525b" textAnchor="end">t={series[n - 1].t.toExponential(2)}</text>
            </svg>
          )}

          <div className={`rounded p-1.5 text-center text-[10px] font-bold border ${summary.validation.matched ? "bg-emerald-900/30 text-emerald-300 border-emerald-700" : "bg-amber-900/30 text-amber-300 border-amber-700"}`}>
            {summary.validation.matched ? "✓ PhaseII validated" : "⚠ validation mismatch"}{" "}
            <span className="opacity-60 font-normal">err={summary.validation.max_rel_err.toFixed(4)}</span>
          </div>

          {summary.quality && (
            <div className="grid grid-cols-3 gap-1">
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[8px] text-zinc-500 mb-0.5">quality</div>
                <div className="font-bold text-[12px]" style={{
                  color: summary.quality.score >= 0.8 ? "#34d399" : summary.quality.score >= 0.5 ? "#fbbf24" : "#f87171"
                }}>{(summary.quality.score * 100).toFixed(1)}%</div>
              </div>
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[8px] text-zinc-500 mb-0.5">peak thrust</div>
                <div className="text-violet-300 font-mono text-[10px] font-bold">{summary.quality.peak_thrust.toExponential(3)} N</div>
              </div>
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[8px] text-zinc-500 mb-0.5">n steps</div>
                <div className="text-zinc-200 font-bold text-[12px]">{summary.quality.n_steps}</div>
                {summary.source && <div className="text-[7px] text-zinc-600">{summary.source}{summary.cycle ? ` c${summary.cycle}` : ""}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sweep tab */}
      {tab === "sweep" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {!sweep ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <span className="text-zinc-500 text-[10px] text-center">Sweep coupling_k from 0.5× to 2.0× baseline<br/>10 points — shows thrust vs calibration trade-off</span>
              <button onClick={runSweep} disabled={sweeping}
                className="px-3 py-1.5 rounded border border-violet-700 text-violet-300 text-[10px] hover:bg-violet-900/30 disabled:opacity-40">
                {sweeping ? "sweeping…" : "run sweep"}
              </button>
            </div>
          ) : (
            <>
              {sweep.optimal && (
                <div className="bg-zinc-900 rounded p-2 text-center">
                  <div className="text-[8px] text-zinc-500 mb-1">optimal (validated)</div>
                  <div className="text-emerald-300 font-bold">k={sweep.optimal.k_factor}× baseline</div>
                  <div className="text-violet-300 font-mono text-[10px]">{sweep.optimal.peak_thrust?.toExponential(3)} N</div>
                </div>
              )}
              {/* Bar chart: k_factor vs peak_thrust */}
              <div className="space-y-0.5">
                {sweep.sweep.map((pt, i) => {
                  const maxP = Math.max(...sweep.sweep.filter(p => p.peak_thrust).map(p => p.peak_thrust ?? 0));
                  const barW = pt.peak_thrust ? (pt.peak_thrust / maxP) * 100 : 0;
                  const isBaseline = pt.k_factor === 1.0;
                  const barColor = pt.validated ? "#34d399" : isBaseline ? "#a78bfa" : "#52525b";
                  return (
                    <div key={i} className="flex items-center gap-2 text-[9px]">
                      <span className="text-zinc-500 w-[36px] text-right shrink-0">{pt.k_factor}×</span>
                      <div className="flex-1 bg-zinc-900 rounded-sm h-3 overflow-hidden">
                        <div className="h-full rounded-sm transition-all" style={{ width: `${barW}%`, backgroundColor: barColor }} />
                      </div>
                      <span className="text-zinc-400 w-[80px] shrink-0 font-mono">{pt.peak_thrust?.toExponential(2) ?? "err"}</span>
                      {pt.validated && <span className="text-emerald-500 text-[7px]">✓</span>}
                    </div>
                  );
                })}
              </div>
              <div className="text-[8px] text-zinc-600 text-center">Only baseline k validates against PhaseII · higher k → more thrust but breaks calibration</div>
              <button onClick={runSweep} disabled={sweeping}
                className="w-full py-1 rounded border border-zinc-700 text-zinc-500 text-[9px] hover:border-violet-700 hover:text-violet-400">
                {sweeping ? "sweeping…" : "re-run sweep ↻"}
              </button>
            </>
          )}
        </div>
      )}

      {/* History tab */}
      {tab === "history" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {runHistory.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-600 text-[10px]">no run history yet</div>
          ) : (
            <>
              {/* Mini sparkline of quality over last runs */}
              <div className="text-[8px] text-zinc-500 uppercase tracking-wider">quality score over last {runHistory.length} runs</div>
              <svg viewBox={`0 0 ${W} 40`} width="100%" style={{ display: "block" }}>
                <rect width={W} height={40} fill="#18181b" rx="2" />
                {runHistory.map((r, i) => {
                  const x = 4 + (i / Math.max(runHistory.length - 1, 1)) * (W - 8);
                  const q = r.quality ?? 0;
                  const y = 4 + (1 - q) * 32;
                  const col = q >= 0.8 ? "#34d399" : q >= 0.5 ? "#fbbf24" : "#f87171";
                  return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.5" fill={col} opacity="0.8" />;
                })}
                {runHistory.length > 1 && (
                  <polyline
                    points={runHistory.map((r, i) => {
                      const x = 4 + (i / (runHistory.length - 1)) * (W - 8);
                      const y = 4 + (1 - (r.quality ?? 0)) * 32;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    }).join(" ")}
                    fill="none" stroke="#52525b" strokeWidth="1" />
                )}
              </svg>
              {/* Table */}
              <div className="space-y-0.5">
                {[...runHistory].reverse().slice(0, 15).map((r, i) => (
                  <div key={i} className="flex gap-2 text-[9px] border-b border-zinc-900 py-0.5">
                    <span className="text-zinc-600 shrink-0">{new Date(r.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="font-bold" style={{ color: (r.quality ?? 0) >= 0.8 ? "#34d399" : "#fbbf24" }}>{((r.quality ?? 0) * 100).toFixed(1)}%</span>
                    <span className="text-violet-300 font-mono">{r.peak_thrust?.toExponential(2) ?? "—"} N</span>
                    <span className="text-zinc-600">n={r.n_steps ?? "?"}</span>
                    {r.validated && <span className="text-emerald-600 text-[7px]">✓</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
