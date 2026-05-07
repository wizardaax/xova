import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

const CMD_SUMMARY  = `python "C:\\Xova\\plugins\\aeon_summary.py"`;
const CMD_SWEEP    = `python "C:\\Xova\\plugins\\aeon_sweep.py"`;
const CMD_CI       = `python "C:\\Xova\\plugins\\ci_health.py" --action run`;
const CMD_WEAVE    = `python "C:\\Xova\\plugins\\field_weave.py" --action run`;
const CMD_TERNARY  = `python "C:\\Xova\\plugins\\ternary_eval.py" --action run`;
const CMD_LUCAS    = `python "C:\\Xova\\plugins\\lucas_phase.py" --action run`;
const CMD_CORPUS   = `python "C:\\Xova\\plugins\\corpus_recall.py" --action run`;
const CMD_SCAN_ALL = `python "C:\\Xova\\plugins\\domain_scan.py"`;
const RUN_LOG_PATH = "C:\\Xova\\memory\\aeon_run_log.jsonl";
const BROKER_PATH  = "C:\\Xova\\memory\\context_broker.json";
const W = 360, H = 100, PAD = { t: 6, r: 6, b: 18, l: 6 };
const IW = W - PAD.l - PAD.r, IH = H - PAD.t - PAD.b;
const PHI_SPIRAL = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = 2 * Math.PI - 2 * Math.PI / PHI_SPIRAL;
const SPIRAL_N = 50;
const SPIRAL_SZ = 130;

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
interface CIRepo { name: string; ok: boolean; passed: number; failed: number; errors: number; duration_s: number; error?: string }
interface CIHealth { ok: boolean; repos: CIRepo[]; total_passed: number; total_failed: number; total_errors: number; score: number; duration_s: number; ts: number }
interface FieldWeaveSlot { ok: boolean; score: number; golden_deg?: number; coh_score?: number; radial_score?: number; angle_fid?: number; ts: number }
interface TernarySlot { ok: boolean; score: number; affirm: number; neutral: number; deny: number; ternary_balance: number; gate_rate: number; stability: number; ts: number }
interface LucasSlot { ok: boolean; score: number; n_terms: number; final_ratio: number; conv_err: number; last_stdev: number; aeon_phi?: number; binet_ok?: boolean; seq_sample?: number[]; ts: number }
interface CorpusSlot { ok: boolean; score: number; total: number; with_excerpt: number; coverage: number; freshness: number; coherence: number; fresh_7d: number; top_roots?: [string, number][]; top_exts?: [string, number][]; ts: number }

export function AeonThrust({ onClose }: { onClose: () => void }) {
  const [summary,    setSummary]    = useState<AeonSummary | null>(null);
  const [sweep,      setSweep]      = useState<SweepResult | null>(null);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [ciHealth,   setCiHealth]   = useState<CIHealth | null>(null);
  const [ciRunning,  setCiRunning]  = useState(false);
  const [fieldWeave,    setFieldWeave]    = useState<FieldWeaveSlot | null>(null);
  const [ternary,       setTernary]       = useState<TernarySlot | null>(null);
  const [weaveRunning,  setWeaveRunning]  = useState(false);
  const [ternaryRunning, setTernaryRunning] = useState(false);
  const [lucasSlot,   setLucasSlot]   = useState<LucasSlot | null>(null);
  const [lucasRunning, setLucasRunning] = useState(false);
  const [corpusSlot,  setCorpusSlot]  = useState<CorpusSlot | null>(null);
  const [corpusRunning, setCorpusRunning] = useState(false);
  const [scanRunning,   setScanRunning]   = useState(false);
  const [err,        setErr]        = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [sweeping,   setSweeping]   = useState(false);
  const [updatedAt,  setUpdatedAt]  = useState("");
  const [tab,        setTab]        = useState<"sim" | "sweep" | "history" | "ci" | "lucas">("sim");

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
    // Also try loading sweep + CI health from broker
    try {
      const bRaw = await invoke<string>("xova_read_file", { path: BROKER_PATH });
      const broker = JSON.parse(bRaw) as { slots?: Record<string, unknown> };
      const s = broker.slots?.["xova.aeon_sweep_result"] as SweepResult | undefined;
      if (s?.ok) setSweep(s);
      const ci = broker.slots?.["xova.ci_health"] as CIHealth | undefined;
      if (ci?.ok) setCiHealth(ci);
      const fw = broker.slots?.["xova.field_weave"] as FieldWeaveSlot | undefined;
      if (fw?.ok) setFieldWeave(fw);
      const te = broker.slots?.["xova.ternary_eval"] as TernarySlot | undefined;
      if (te?.ok) setTernary(te);
      const lc = broker.slots?.["xova.lucas_phase"] as LucasSlot | undefined;
      if (lc?.ok) setLucasSlot(lc);
      const cr = broker.slots?.["xova.corpus_recall"] as CorpusSlot | undefined;
      if (cr?.ok) setCorpusSlot(cr);
    } catch { /**/ }
  }, []);

  const runCI = useCallback(async () => {
    setCiRunning(true);
    try {
      const stdout = await xovaRun(CMD_CI);
      const parsed = JSON.parse(stdout) as CIHealth;
      if (parsed.ok) { setCiHealth(parsed); setTab("ci"); }
    } catch { /**/ }
    setCiRunning(false);
  }, []);

  const runWeave = useCallback(async () => {
    setWeaveRunning(true);
    try {
      const stdout = await xovaRun(CMD_WEAVE);
      const parsed = JSON.parse(stdout) as FieldWeaveSlot;
      if (parsed.ok) setFieldWeave(parsed);
    } catch { /**/ }
    setWeaveRunning(false);
  }, []);

  const runTernary = useCallback(async () => {
    setTernaryRunning(true);
    try {
      const stdout = await xovaRun(CMD_TERNARY);
      const parsed = JSON.parse(stdout) as TernarySlot;
      if (parsed.ok) setTernary(parsed);
    } catch { /**/ }
    setTernaryRunning(false);
  }, []);

  const runLucas = useCallback(async () => {
    setLucasRunning(true);
    try {
      const stdout = await xovaRun(CMD_LUCAS);
      const parsed = JSON.parse(stdout) as LucasSlot;
      if (parsed.ok) { setLucasSlot(parsed); setTab("lucas"); }
    } catch { /**/ }
    setLucasRunning(false);
  }, []);

  const runCorpus = useCallback(async () => {
    setCorpusRunning(true);
    try {
      const stdout = await xovaRun(CMD_CORPUS);
      const parsed = JSON.parse(stdout) as CorpusSlot;
      if (parsed.ok) setCorpusSlot(parsed);
    } catch { /**/ }
    setCorpusRunning(false);
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

  const runScanAll = useCallback(async () => {
    setScanRunning(true);
    try {
      await xovaRun(CMD_SCAN_ALL);
      setTimeout(() => { refresh(); setScanRunning(false); }, 35_000);
    } catch { setScanRunning(false); }
  }, [refresh]);

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

  const spiralPoints = useMemo(() => {
    const cx = SPIRAL_SZ / 2, cy = SPIRAL_SZ / 2;
    const rMax = Math.pow(PHI_SPIRAL, (SPIRAL_N - 1) / SPIRAL_N);
    const scale = (SPIRAL_SZ / 2 - 8) / rMax;
    return Array.from({ length: SPIRAL_N }, (_, i) => {
      const r = Math.pow(PHI_SPIRAL, i / SPIRAL_N) * scale;
      const theta = i * GOLDEN_ANGLE;
      return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta), i };
    });
  }, []);

  // Lucas sequence L(0)=2, L(1)=1; ratios converge to phi
  const lucasRatios = useMemo(() => {
    const N = lucasSlot?.n_terms ?? 30;
    const seq: number[] = [2, 1];
    for (let i = 2; i < N; i++) seq.push(seq[i - 1] + seq[i - 2]);
    return seq.slice(1).map((v, i) => v / seq[i]);  // L(n+1)/L(n)
  }, [lucasSlot?.n_terms]);

  const CONST_LABELS: [keyof AeonSummary["constants"], string][] = [
    ["PHI", "φ"], ["PSI_RESONANCE", "ψ"], ["GOLDEN_ANGLE_DEG", "∠°"], ["ALPHA_INV", "α⁻¹"],
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">AEON{updatedAt ? ` · ${updatedAt}` : ""}</span>
        <div className="flex gap-1 ml-auto">
          {(["sim", "sweep", "history", "ci", "lucas"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2 py-0.5 rounded border text-[8px] transition-colors ${tab === t ? "border-violet-600 text-violet-300 bg-violet-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
              {t === "ci" && ciHealth
                ? (ciHealth.total_failed || ciHealth.total_errors ? "⚠ci" : "✓ci")
                : t === "lucas" && lucasSlot ? `φ${(lucasSlot.score * 100).toFixed(0)}`
                : t}
            </button>
          ))}
        </div>
        <button onClick={runScanAll} disabled={scanRunning}
          title="Launch all 7 domain plugins — auto-refreshes in 35s"
          className="px-2 py-0.5 rounded border border-teal-700 text-teal-400 text-[8px] hover:bg-teal-900/30 disabled:opacity-40">
          {scanRunning ? "scanning…" : "scan"}
        </button>
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

          {/* φ-spiral — AEON phase trajectory visualized as Fibonacci golden-angle spiral */}
          <div className="bg-zinc-900 rounded p-2">
            <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-1.5 flex items-center gap-2">
              <span>φ-spiral phase trajectory</span>
              {fieldWeave && (
                <span className="font-mono" style={{ color: fieldWeave.score >= 0.8 ? "#34d399" : "#fbbf24" }}>
                  {(fieldWeave.score * 100).toFixed(0)}%
                </span>
              )}
              <button onClick={runWeave} disabled={weaveRunning}
                className="ml-auto px-1.5 py-0.5 rounded border border-violet-800 text-violet-400 text-[7px] hover:bg-violet-900/30 disabled:opacity-40">
                {weaveRunning ? "…" : "run weave"}
              </button>
            </div>
            <div className="flex items-start gap-3">
              <svg viewBox={`0 0 ${SPIRAL_SZ} ${SPIRAL_SZ}`} width={SPIRAL_SZ} height={SPIRAL_SZ} style={{ flexShrink: 0 }}>
                <rect width={SPIRAL_SZ} height={SPIRAL_SZ} fill="#09090b" rx="4" />
                {/* Spiral path */}
                <path
                  d={spiralPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
                  fill="none" stroke="#6d28d9" strokeWidth="0.6" opacity="0.4"
                />
                {/* Dots — fade from dark violet to bright green as i increases */}
                {spiralPoints.map(({ x, y, i }) => {
                  const t = i / (SPIRAL_N - 1);
                  const r = Math.round(109 + t * (52 - 109));
                  const g = Math.round(40 + t * (211 - 40));
                  const b = Math.round(217 + t * (153 - 217));
                  return <circle key={i} cx={x.toFixed(2)} cy={y.toFixed(2)} r={i === SPIRAL_N - 1 ? "2.5" : "1.2"} fill={`rgb(${r},${g},${b})`} opacity={0.4 + t * 0.6} />;
                })}
                {/* Golden angle label */}
                <text x="2" y={SPIRAL_SZ - 3} fontSize="5.5" fill="#52525b">∠{(fieldWeave?.golden_deg ?? 137.5078).toFixed(4)}°</text>
              </svg>
              <div className="flex flex-col gap-1 text-[8px]">
                <div className="text-zinc-600">n={SPIRAL_N} steps</div>
                <div className="text-zinc-600">φ={PHI_SPIRAL.toFixed(6)}</div>
                <div className="text-zinc-600">∠={GOLDEN_ANGLE.toFixed(6)} rad</div>
                {fieldWeave && (
                  <>
                    <div className="mt-1 text-zinc-600">coh <span className="text-emerald-400">{fieldWeave.coh_score?.toFixed(3) ?? "—"}</span></div>
                    <div className="text-zinc-600">radial <span className="text-emerald-400">{fieldWeave.radial_score?.toFixed(3) ?? "—"}</span></div>
                    <div className="text-zinc-600">∠fid <span className="text-emerald-400">{fieldWeave.angle_fid?.toFixed(3) ?? "—"}</span></div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Ternary gate mini-panel */}
          <div className="bg-zinc-900 rounded p-2">
            <div className="text-[8px] text-zinc-600 uppercase tracking-wider mb-1.5 flex items-center gap-2">
              <span>SCE-88 ternary gates</span>
              {ternary && (
                <span className="font-mono" style={{ color: ternary.score >= 0.8 ? "#34d399" : ternary.score >= 0.6 ? "#fbbf24" : "#f87171" }}>
                  {(ternary.score * 100).toFixed(0)}%
                </span>
              )}
              <button onClick={runTernary} disabled={ternaryRunning}
                className="ml-auto px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 text-[7px] hover:bg-zinc-800/40 disabled:opacity-40">
                {ternaryRunning ? "…" : "run ternary"}
              </button>
            </div>
            {ternary ? (
              <div className="flex items-center gap-3 text-[8px]">
                <div className="flex gap-0.5">
                  {[...Array(4)].map((_, i) => {
                    const gateVal = i < ternary.affirm ? 1 : i < (ternary.affirm + ternary.neutral) ? 0 : -1;
                    return (
                      <div key={i} className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold"
                        style={{ background: gateVal === 1 ? "#052e16" : gateVal === 0 ? "#451a03" : "#1c0618",
                          color: gateVal === 1 ? "#34d399" : gateVal === 0 ? "#fbbf24" : "#f87171", border: `1px solid ${gateVal === 1 ? "#166534" : gateVal === 0 ? "#92400e" : "#7c3aed"}` }}>
                        {gateVal === 1 ? "✓" : gateVal === 0 ? "?" : "✕"}
                      </div>
                    );
                  })}
                </div>
                <span className="text-zinc-600">bal <span className="text-zinc-300">{ternary.ternary_balance.toFixed(3)}</span></span>
                <span className="text-zinc-600">stab <span className="text-zinc-300">{ternary.stability.toFixed(3)}</span></span>
                <span className="text-zinc-600">rate <span className="text-zinc-300">{ternary.gate_rate.toFixed(3)}</span></span>
              </div>
            ) : (
              <div className="text-zinc-700 text-[8px]">no data — click run ternary</div>
            )}
          </div>
        </div>
      )}

      {/* Corpus recall panel — shown in sim tab below ternary gate */}
      {tab === "sim" && corpusSlot && (
        <div className="mx-3 mb-3 rounded border border-zinc-800 bg-zinc-900/60 p-2 space-y-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-zinc-500 uppercase tracking-wider">corpus recall</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[8px]" style={{ color: corpusSlot.score >= 0.8 ? "#34d399" : corpusSlot.score >= 0.6 ? "#fbbf24" : "#f87171" }}>
                {(corpusSlot.score * 100).toFixed(1)}%
              </span>
              <button onClick={runCorpus} disabled={corpusRunning}
                className="px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 text-[7px] hover:bg-zinc-800/40 disabled:opacity-40">
                {corpusRunning ? "…" : "run"}
              </button>
            </div>
          </div>
          <div className="flex gap-3 text-[8px] flex-wrap">
            <span className="text-zinc-500">total <span className="text-zinc-200">{corpusSlot.total.toLocaleString()}</span></span>
            <span className="text-zinc-500">cov <span className="text-emerald-300">{(corpusSlot.coverage * 100).toFixed(1)}%</span></span>
            <span className="text-zinc-500">fresh <span className="text-emerald-300">{(corpusSlot.freshness * 100).toFixed(0)}%</span></span>
            <span className="text-zinc-500">coh <span style={{ color: corpusSlot.coherence >= 0.7 ? "#34d399" : "#fbbf24" }}>{(corpusSlot.coherence * 100).toFixed(1)}%</span></span>
          </div>
          {(corpusSlot.top_roots?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-0.5">
              {corpusSlot.top_roots!.slice(0, 3).map(([root, cnt]) => {
                const short = root.replace(/^.*[\\/]/, "").slice(0, 24);
                const pct = corpusSlot.total > 0 ? cnt / corpusSlot.total : 0;
                return (
                  <div key={root} className="flex items-center gap-1.5">
                    <span className="text-zinc-600 text-[7px] w-[100px] shrink-0 truncate">{short}</span>
                    <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-600/60 rounded-full" style={{ width: `${pct * 100}%` }} />
                    </div>
                    <span className="text-zinc-600 text-[7px] w-[28px] text-right shrink-0">{cnt.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lucas tab — φ convergence chart */}
      {tab === "lucas" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-zinc-500 uppercase tracking-wider">Lucas φ convergence</span>
            <button onClick={runLucas} disabled={lucasRunning}
              className="px-1.5 py-0.5 rounded border border-violet-800 text-violet-400 text-[7px] hover:bg-violet-900/30 disabled:opacity-40">
              {lucasRunning ? "…" : "run lucas"}
            </button>
          </div>
          {/* Ratio convergence chart */}
          {(() => {
            const RW = 340, RH = 90, rPad = { t: 6, r: 6, b: 18, l: 32 };
            const rIW = RW - rPad.l - rPad.r, rIH = RH - rPad.t - rPad.b;
            const phi = PHI_SPIRAL;
            const nr = lucasRatios.length;
            const minR = Math.min(...lucasRatios, phi - 0.5);
            const maxR = Math.max(...lucasRatios, phi + 0.5);
            const rRange = maxR - minR || 1;
            const rx = (i: number) => rPad.l + (i / Math.max(nr - 1, 1)) * rIW;
            const ry = (v: number) => rPad.t + (1 - (v - minR) / rRange) * rIH;
            const phiY = ry(phi);
            const pathD = lucasRatios.map((r, i) => `${i === 0 ? "M" : "L"}${rx(i).toFixed(1)},${ry(r).toFixed(1)}`).join(" ");
            return (
              <svg viewBox={`0 0 ${RW} ${RH}`} width="100%" style={{ display: "block" }}>
                <rect x={rPad.l} y={rPad.t} width={rIW} height={rIH} fill="#18181b" rx="2" />
                {/* φ reference line */}
                <line x1={rPad.l} y1={phiY} x2={rPad.l + rIW} y2={phiY} stroke="#6d28d9" strokeWidth="0.8" strokeDasharray="3,2" opacity="0.6" />
                <text x={rPad.l - 2} y={phiY + 3} fontSize="6" fill="#a78bfa" textAnchor="end">φ</text>
                {/* Ratio series */}
                <path d={pathD} fill="none" stroke="#34d399" strokeWidth="1.2" strokeLinejoin="round" />
                {nr > 0 && <circle cx={rx(nr - 1)} cy={ry(lucasRatios[nr - 1])} r="2.5" fill="#34d399" />}
                <text x={rPad.l + 2} y={RH - 3} fontSize="6" fill="#52525b">n=0</text>
                <text x={rPad.l + rIW - 2} y={RH - 3} fontSize="6" fill="#52525b" textAnchor="end">n={nr}</text>
              </svg>
            );
          })()}
          {/* Stats grid */}
          {lucasSlot && (
            <div className="grid grid-cols-3 gap-1">
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[8px] text-zinc-500 mb-0.5">score</div>
                <div className="font-bold text-[11px]" style={{ color: lucasSlot.score >= 0.9 ? "#34d399" : "#fbbf24" }}>
                  {(lucasSlot.score * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[8px] text-zinc-500 mb-0.5">final ratio</div>
                <div className="text-violet-300 font-mono text-[10px] font-bold">{lucasSlot.final_ratio.toFixed(10)}</div>
              </div>
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[8px] text-zinc-500 mb-0.5">conv err</div>
                <div className="text-emerald-300 font-mono text-[10px]">{lucasSlot.conv_err.toExponential(2)}</div>
              </div>
            </div>
          )}
          {lucasSlot && (
            <div className="flex items-center gap-3 text-[8px] px-1">
              <span className="text-zinc-600">n_terms <span className="text-zinc-300">{lucasSlot.n_terms}</span></span>
              <span className="text-zinc-600">aeon_φ <span className="text-emerald-400">{lucasSlot.aeon_phi?.toFixed(8) ?? "—"}</span></span>
              <span className="text-zinc-600">binet <span className={lucasSlot.binet_ok ? "text-emerald-400" : "text-amber-400"}>{lucasSlot.binet_ok ? "✓" : "✕"}</span></span>
              <span className="text-zinc-600">stdev <span className="text-zinc-300">{lucasSlot.last_stdev.toExponential(2)}</span></span>
            </div>
          )}
          {!lucasSlot && (
            <div className="text-zinc-600 text-[9px] text-center py-4">no data — click run lucas</div>
          )}
          {lucasSlot?.seq_sample && (
            <div className="bg-zinc-900 rounded p-2">
              <div className="text-[7px] text-zinc-600 mb-1">sequence sample (first 10): L(n) = L(n-1) + L(n-2)</div>
              <div className="flex gap-1 flex-wrap">
                {lucasSlot.seq_sample.map((v, i) => (
                  <span key={i} className="text-emerald-400 font-mono text-[8px] px-1 bg-zinc-800 rounded">{v}</span>
                ))}
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
              {/* Quality vs k_factor line chart */}
              {(() => {
                const pts = sweep.sweep.filter(p => typeof p.quality === "number");
                if (pts.length < 2) return null;
                const CW = 320, CH = 56, cPad = { t: 6, r: 6, b: 14, l: 26 };
                const cIW = CW - cPad.l - cPad.r, cIH = CH - cPad.t - cPad.b;
                const ks = pts.map(p => p.k_factor);
                const minK = Math.min(...ks), maxK = Math.max(...ks);
                const qs = pts.map(p => p.quality!);
                const minQ = 0, maxQ = 1;
                const cx = (k: number) => cPad.l + ((k - minK) / (maxK - minK || 1)) * cIW;
                const cy = (q: number) => cPad.t + (1 - (q - minQ) / (maxQ - minQ)) * cIH;
                const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${cx(p.k_factor).toFixed(1)},${cy(p.quality!).toFixed(1)}`).join(" ");
                const optK = sweep.optimal?.k_factor;
                return (
                  <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" style={{ display: "block" }}>
                    <rect x={cPad.l} y={cPad.t} width={cIW} height={cIH} fill="#18181b" rx="2" />
                    {/* 0.8 quality threshold line */}
                    <line x1={cPad.l} y1={cy(0.8)} x2={cPad.l + cIW} y2={cy(0.8)}
                      stroke="#34d399" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4" />
                    <text x={cPad.l - 2} y={cy(0.8) + 3} fontSize="5" fill="#34d399" textAnchor="end" opacity="0.6">0.8</text>
                    <text x={cPad.l - 2} y={cy(0) + 3} fontSize="5" fill="#52525b" textAnchor="end">0</text>
                    <text x={cPad.l - 2} y={cPad.t + 4} fontSize="5" fill="#52525b" textAnchor="end">1</text>
                    <path d={pathD} fill="none" stroke="#a78bfa" strokeWidth="1.2" strokeLinejoin="round" />
                    {pts.map((p, i) => {
                      const col = (p.quality ?? 0) >= 0.8 ? "#34d399" : "#fbbf24";
                      return <circle key={i} cx={cx(p.k_factor).toFixed(1)} cy={cy(p.quality!).toFixed(1)} r={p.k_factor === optK ? "3" : "1.5"} fill={col} />;
                    })}
                    <text x={cPad.l + 2} y={CH - 2} fontSize="5" fill="#52525b">{minK}×</text>
                    <text x={cPad.l + cIW - 2} y={CH - 2} fontSize="5" fill="#52525b" textAnchor="end">{maxK}×</text>
                    <text x={cPad.l + cIW / 2} y={CH - 2} fontSize="5" fill="#52525b" textAnchor="middle">k-factor</text>
                  </svg>
                );
              })()}
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

      {/* CI Health tab */}
      {tab === "ci" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {!ciHealth ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
              <span className="text-zinc-500 text-[10px] text-center">Run pytest on 3 Snell-Vern repos<br/>~15s · publishes results to context broker</span>
              <button onClick={runCI} disabled={ciRunning}
                className="px-3 py-1.5 rounded border border-violet-700 text-violet-300 text-[10px] hover:bg-violet-900/30 disabled:opacity-40">
                {ciRunning ? "scanning…" : "run CI scan"}
              </button>
            </div>
          ) : (
            <>
              {/* Score bar */}
              <div className={`rounded p-2 text-center border ${ciHealth.score >= 0.95 ? "bg-emerald-900/30 border-emerald-700 text-emerald-300" : "bg-amber-900/30 border-amber-700 text-amber-300"}`}>
                <div className="text-[8px] text-zinc-500 mb-0.5">CI health score</div>
                <div className="font-bold text-[14px]">{(ciHealth.score * 100).toFixed(1)}%</div>
                <div className="text-[9px] opacity-70">{ciHealth.total_passed} passed · {ciHealth.total_failed} failed · {ciHealth.duration_s.toFixed(1)}s</div>
              </div>
              {/* Per-repo table */}
              <div className="space-y-0.5">
                {ciHealth.repos.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[9px] border-b border-zinc-900 py-1">
                    <span className={`shrink-0 ${r.ok && !r.failed && !r.errors ? "text-emerald-500" : "text-amber-400"}`}>
                      {r.ok && !r.failed && !r.errors ? "✓" : "⚠"}
                    </span>
                    <span className="text-zinc-400 flex-1 truncate">{r.name}</span>
                    <span className="text-zinc-300 font-mono">{r.passed}✓</span>
                    {(r.failed > 0) && <span className="text-red-400">{r.failed}✗</span>}
                    <span className="text-zinc-600">{r.duration_s.toFixed(1)}s</span>
                  </div>
                ))}
              </div>
              <div className="text-[8px] text-zinc-600 text-center">
                last scan {new Date(ciHealth.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
              <button onClick={runCI} disabled={ciRunning}
                className="w-full py-1 rounded border border-zinc-700 text-zinc-500 text-[9px] hover:border-violet-700 hover:text-violet-400">
                {ciRunning ? "scanning…" : "re-run scan ↻"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
