import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const CMD = `python "C:\\Xova\\plugins\\aeon_summary.py"`;
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

export function AeonThrust({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<AeonSummary | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_run", { command: CMD, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      const parsed = JSON.parse(stdout) as { ok: boolean; summary?: AeonSummary; error?: string };
      if (!parsed.ok || !parsed.summary) { setErr(parsed.error ?? "aeon_summary.py not ready"); setSummary(null); }
      else { setSummary(parsed.summary); setErr(null); setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })); }
    } catch { setErr("aeon_summary.py not ready"); setSummary(null); }
    setLoading(false);
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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">AEON{updatedAt ? ` · ${updatedAt}` : ""}</span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40 text-[10px]">Run sim ↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && !summary && <div className="flex-1 flex items-center justify-center text-zinc-600">running…</div>}

      {err && !summary && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-amber-400">{err}</span>
          <span className="text-zinc-600 text-[10px]">Create C:\Xova\plugins\aeon_summary.py to enable</span>
        </div>
      )}

      {summary && (
        <div className="p-3 space-y-3">
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
              <text x={PAD.l + 2} y={PAD.t + IH - 3} fontSize="7" fill="#52525b">t={series[0].t}</text>
              <text x={PAD.l + IW - 2} y={PAD.t + IH - 3} fontSize="7" fill="#52525b" textAnchor="end">t={series[n - 1].t}</text>
            </svg>
          )}

          <div className={`rounded p-1.5 text-center text-[10px] font-bold border ${summary.validation.matched ? "bg-emerald-900/30 text-emerald-300 border-emerald-700" : "bg-amber-900/30 text-amber-300 border-amber-700"}`}>
            {summary.validation.matched ? "✓ PhaseII validated" : "⚠ validation mismatch"}{" "}
            <span className="opacity-60 font-normal">err={summary.validation.max_rel_err.toFixed(4)}</span>
          </div>

          {/* Sprint 3: quality score + peak thrust */}
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
    </div>
  );
}
