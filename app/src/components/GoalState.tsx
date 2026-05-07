import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const GOAL_STORE      = "C:\\Xova\\memory\\goal_store.json";
const PROPOSAL_STORE  = "C:\\Xova\\memory\\goal_proposals.json";
const UCB_STORE       = "C:\\Xova\\memory\\phi_ucb_state.json";
const BROKER_PATH     = "C:\\Xova\\memory\\context_broker.json";
const LTM_PATH        = "C:\\Xova\\memory\\long_term_memory.json";
const GOAL_MGR        = `python "C:\\Xova\\plugins\\goal_manager.py"`;
const GOAL_PROPOSER   = `python "C:\\Xova\\plugins\\goal_proposer.py"`;
const DREAM_CMD       = `python "C:\\Xova\\plugins\\dream_consolidator.py" --action consolidate`;
const SCAN_CMD        = `python "C:\\Xova\\plugins\\domain_scan.py"`;
const SELF_EVAL_STORE = "C:\\Xova\\memory\\self_eval_store.json";
const SELF_MOD_STORE  = "C:\\Xova\\memory\\self_mod_proposals.json";

interface ProgressEntry {
  ts:        number;
  note:      string;
  coherence: number;
  agent:     string;
}
interface Goal {
  id:         string;
  text:       string;
  priority:   number;
  status:     "active" | "paused" | "completed" | "failed";
  owner:      string;
  parent:     string | null;
  created_at: number;
  updated_at: number;
  progress:   ProgressEntry[];
}
interface GoalStore {
  active_goal: string | null;
  goals: Record<string, Goal>;
}
interface Proposal {
  id:        string;
  text:      string;
  keyword:   string;
  domain:    string;
  parent_id: string;
  status:    "pending" | "accepted" | "rejected";
  ts:        number;
  goal_id?:  string;
}
interface UcbEntry { q: number; n: number; }
interface LtmData {
  last_consolidation?:   number;
  period_hours?:         number;
  avg_coherence?:        number;
  avg_eval_score?:       number;
  top_missed_keywords?:  string[];
  evolution_health?:     number;
  cycle_count?:          number;
  insights?:             string[];
}
interface DomainSlot { ok?: boolean; score?: number; ts?: number; sweep?: Array<{ quality?: number }>; optimal?: { quality?: number } }
interface UcbReward {
  cycle:         number;
  goal_idx:      number;
  goal:          string;
  coh_reward:    number;
  eval_score:    number;
  aeon_quality?: number | null;
  domain_score?: number | null;
  blended:       number;
  ts:            number;
}
interface SelfEvalEntry { ts: number; agent: string; score: number; hit?: string[]; missed?: string[]; }
interface SelfModProposal {
  id:              string;
  file_path:       string;
  description:     string;
  proposer:        string;
  created_at:      number;
  status:          "pending" | "applied" | "rejected";
  sce88_pass?:     boolean;
  sce88_coherence?: number;
  xova_approved?:  boolean;
  xova_reason?:    string;
  applied_at?:     number;
}

async function xovaRun(cmd: string): Promise<string> {
  const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
  try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) return w.stdout; } catch { /**/ }
  return raw;
}

function fmtTs(ts: number): string {
  const d = new Date(ts > 1e10 ? ts : ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(ts: number): string {
  const d = new Date(ts > 1e10 ? ts : ts * 1000);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function cohColor(c: number): string {
  return c >= 0.8 ? "#34d399" : c >= 0.5 ? "#fbbf24" : c > 0 ? "#f87171" : "#52525b";
}

const STATUS_STYLE: Record<string, string> = {
  active:    "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  paused:    "bg-amber-900/40 text-amber-300 border-amber-700",
  completed: "bg-blue-900/40 text-blue-300 border-blue-700",
  failed:    "bg-red-900/40 text-red-300 border-red-700",
};

export function GoalState({ onClose }: { onClose: () => void }) {
  const [store,       setStore]       = useState<GoalStore | null>(null);
  const [proposals,   setProposals]   = useState<Proposal[]>([]);
  const [ucbState,    setUcbState]    = useState<UcbEntry[]>([]);
  const [ucbReward,   setUcbReward]   = useState<UcbReward | null>(null);
  const [domainScores, setDomainScores] = useState<(number | null)[]>([]);
  const [ltmData,      setLtmData]      = useState<LtmData | null>(null);
  const [evalHistory,  setEvalHistory]  = useState<SelfEvalEntry[]>([]);
  const [selfMods,     setSelfMods]     = useState<SelfModProposal[]>([]);
  const [dreamRunning, setDreamRunning] = useState(false);
  const [scanRunning,  setScanRunning]  = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [proposing,   setProposing]   = useState(false);
  const [newGoal,     setNewGoal]     = useState("");
  const [saving,      setSaving]      = useState(false);
  const [updatedAt,   setUpdatedAt]   = useState("");
  const [view,        setView]        = useState<"active" | "all" | "proposals" | "dream" | "mods">("active");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: GOAL_STORE });
      setStore(JSON.parse(raw) as GoalStore);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch {
      setStore({ active_goal: null, goals: {} });
    }
    // Load proposals
    try {
      const pRaw = await invoke<string>("xova_read_file", { path: PROPOSAL_STORE });
      const pData = JSON.parse(pRaw) as { proposals: Proposal[] };
      const pending = (pData.proposals ?? []).filter(p => p.status === "pending");
      setProposals(pending);
    } catch { setProposals([]); }
    // Load UCB state
    try {
      const uRaw = await invoke<string>("xova_read_file", { path: UCB_STORE });
      setUcbState(JSON.parse(uRaw) as UcbEntry[]);
    } catch { setUcbState([]); }
    // Load UCB last reward + domain plugin scores from context_broker
    try {
      const bRaw = await invoke<string>("xova_read_file", { path: BROKER_PATH });
      const broker = JSON.parse(bRaw) as { slots: Record<string, unknown> };
      const slot = broker.slots?.["xova.ucb_last_reward"] as UcbReward | undefined;
      if (slot?.cycle) setUcbReward(slot);
      // Domain scores indexed by ROTATING_GOALS order
      const DOMAIN_SLOT_KEYS = [
        "xova.aeon_sweep_result", "xova.ci_health", "xova.repo_sync",
        "xova.lucas_phase", "xova.corpus_recall", "xova.ternary_eval", "xova.field_weave",
      ];
      const dScores = DOMAIN_SLOT_KEYS.map(key => {
        const s = broker.slots?.[key] as DomainSlot | undefined;
        if (!s || !s.ok) return null;
        if (key === "xova.aeon_sweep_result") {
          return typeof s.optimal?.quality === "number" ? s.optimal.quality : null;
        }
        return typeof s.score === "number" ? s.score : null;
      });
      setDomainScores(dScores);
    } catch { /* broker may not have slots yet */ }
    // Load long-term memory (dream consolidator output)
    try {
      const ltmRaw = await invoke<string>("xova_read_file", { path: LTM_PATH });
      setLtmData(JSON.parse(ltmRaw) as LtmData);
    } catch { /* ltm may not exist yet */ }
    // Load self-eval history for trend chart
    try {
      const seRaw = await invoke<string>("xova_read_file", { path: SELF_EVAL_STORE });
      const seData = JSON.parse(seRaw) as { history?: SelfEvalEntry[] };
      setEvalHistory(seData.history ?? []);
    } catch { /* ok */ }
    // Load self-modifier proposals for mods view
    try {
      const smRaw = await invoke<string>("xova_read_file", { path: SELF_MOD_STORE });
      const smData = JSON.parse(smRaw) as { proposals?: SelfModProposal[] };
      setSelfMods((smData.proposals ?? []).slice().reverse()); // newest first
    } catch { /* ok */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8_000);
    return () => clearInterval(id);
  }, [refresh]);

  const addGoal = useCallback(async () => {
    const text = newGoal.trim();
    if (!text) return;
    setSaving(true);
    try {
      await xovaRun(`${GOAL_MGR} --action set --text "${text.replace(/"/g, '\\"')}" --owner mesh`);
      setNewGoal("");
      await refresh();
    } catch { /**/ }
    setSaving(false);
  }, [newGoal, refresh]);

  const activate = useCallback(async (id: string) => {
    await xovaRun(`${GOAL_MGR} --action activate --id ${id}`);
    await refresh();
  }, [refresh]);

  const complete = useCallback(async (id: string) => {
    await xovaRun(`${GOAL_MGR} --action complete --id ${id}`);
    await refresh();
  }, [refresh]);

  const pause = useCallback(async (id: string) => {
    await xovaRun(`${GOAL_MGR} --action pause --id ${id}`);
    await refresh();
  }, [refresh]);

  const propose = useCallback(async () => {
    setProposing(true);
    try {
      await xovaRun(`${GOAL_PROPOSER} --action propose`);
      setView("proposals");
      await refresh();
    } catch { /**/ }
    setProposing(false);
  }, [refresh]);

  const acceptProposal = useCallback(async (propId: string) => {
    await xovaRun(`${GOAL_PROPOSER} --action accept --id ${propId}`);
    await refresh();
  }, [refresh]);

  const rejectProposal = useCallback(async (propId: string) => {
    await xovaRun(`${GOAL_PROPOSER} --action reject --id ${propId}`);
    await refresh();
  }, [refresh]);

  const runDream = useCallback(async () => {
    setDreamRunning(true);
    try {
      await xovaRun(DREAM_CMD);
      await refresh();
    } catch { /**/ }
    setDreamRunning(false);
  }, [refresh]);

  const runScan = useCallback(async () => {
    setScanRunning(true);
    try {
      await xovaRun(SCAN_CMD);          // returns immediately — plugins run in background
      setTimeout(() => { refresh(); setScanRunning(false); }, 35_000);
    } catch { setScanRunning(false); }
  }, [refresh]);

  if (!store) return (
    <div className="flex-1 flex items-center justify-center text-zinc-600 font-mono text-[11px]">
      {loading ? "loading…" : "no goal store"}
    </div>
  );

  const ROTATING_GOAL_NAMES = [
    "aeon thrust", "CI health", "repo sync", "Lucas phase",
    "corpus recall", "ternary logic", "field weave",
  ];

  const goals     = Object.values(store.goals);
  const active    = store.active_goal ? store.goals[store.active_goal] : null;
  const displayed = view === "active"
    ? goals.filter(g => g.status === "active")
    : view === "all"
    ? goals
    : [];
  displayed.sort((a, b) => b.priority - a.priority || b.updated_at - a.updated_at);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Goals{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <div className="flex gap-1 ml-auto">
          {(["active", "all", "proposals", "dream", "mods"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${
                view === v ? "border-emerald-600 text-emerald-300 bg-emerald-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}>
              {v}{v === "proposals" && proposals.length > 0 ? ` (${proposals.length})` : ""}{v === "mods" && selfMods.length > 0 ? ` (${selfMods.length})` : ""}
            </button>
          ))}
        </div>
        <button onClick={runScan} disabled={scanRunning}
          title="Launch all 7 domain plugins — auto-refreshes in 35s"
          className="px-2 py-0.5 rounded border border-teal-700 text-teal-400 text-[9px] hover:bg-teal-900/30 disabled:opacity-40">
          {scanRunning ? "scanning…" : "scan domains"}
        </button>
        <button onClick={propose} disabled={proposing}
          title="Generate sub-goal proposals from self-eval gaps"
          className="px-2 py-0.5 rounded border border-violet-700 text-violet-400 text-[9px] hover:bg-violet-900/30 disabled:opacity-40">
          {proposing ? "…" : "propose"}
        </button>
        <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Active goal hero */}
      {active && (
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0 bg-emerald-950/10">
          <div className="text-[9px] uppercase tracking-wider text-emerald-600 mb-1">active goal</div>
          <div className="text-zinc-100 text-[11px] leading-snug mb-1.5">{active.text}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[8px] text-zinc-500">{active.id}</span>
            <span className="text-[8px] text-zinc-500">owner: {active.owner}</span>
            <span className="text-[8px] text-zinc-500">p{active.priority}</span>
            <span className="text-[8px] text-zinc-500 ml-auto">
              {active.progress.length} notes · updated {fmtDate(active.updated_at)} {fmtTs(active.updated_at)}
            </span>
          </div>
          {/* Last 3 progress entries */}
          {active.progress.length > 0 && (
            <div className="mt-1.5 space-y-0.5 max-h-[90px] overflow-y-auto">
              {active.progress.slice(-5).reverse().map((p, i) => (
                <div key={i} className="flex gap-1.5 text-[9px]">
                  <span className="text-zinc-600 shrink-0">{fmtTs(p.ts)}</span>
                  <span className="text-[8px] font-bold" style={{ color: cohColor(p.coherence) }}>
                    {p.coherence > 0 ? p.coherence.toFixed(3) : ""}
                  </span>
                  <span className="text-zinc-500 truncate">{p.note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* UCB reward strip — shown when data is available */}
      {ucbReward && (
        <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0 bg-violet-950/10">
          <div className="flex items-center gap-3 text-[9px] flex-wrap">
            <span className="uppercase tracking-wider text-violet-500">ucb · cycle {ucbReward.cycle}</span>
            <span className="text-zinc-500">coh <span className="text-zinc-300">{ucbReward.coh_reward.toFixed(3)}</span></span>
            <span className="text-zinc-500">eval <span className="text-zinc-300">{ucbReward.eval_score.toFixed(3)}</span></span>
            {ucbReward.aeon_quality != null && (
              <span className="text-amber-500">aeon <span className="text-amber-300">{ucbReward.aeon_quality.toFixed(3)}</span></span>
            )}
            {ucbReward.domain_score != null && ucbReward.goal_idx !== 0 && (
              <span className="text-teal-500">{ROTATING_GOAL_NAMES[ucbReward.goal_idx] ?? "domain"} <span className="text-teal-300">{ucbReward.domain_score.toFixed(3)}</span></span>
            )}
            <span className="text-violet-400 font-mono">blend {ucbReward.blended.toFixed(3)}</span>
            <span className="text-zinc-600 truncate max-w-[160px]">{ucbReward.goal}</span>
          </div>
        </div>
      )}

      {/* UCB goal weights + domain scores — shown on active/all/dream views */}
      {ucbState.length > 0 && (view === "active" || view === "all" || view === "dream") && (
        <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0">
          <div className="text-[8px] uppercase tracking-wider text-zinc-600 mb-1">φ-ucb · domain scores</div>
          <div className="flex flex-col gap-0.5">
            {ucbState.map((u, i) => {
              const ds = domainScores[i] ?? null;
              const dsColor = ds === null ? "#52525b"
                : ds >= 0.8 ? "#34d399"
                : ds >= 0.6 ? "#fbbf24"
                : "#f87171";
              const barW = ds !== null ? Math.round(ds * 48) : 0;
              return (
                <div key={i} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800/60">
                  <span className="text-zinc-500 text-[8px] w-[76px] shrink-0 truncate">{ROTATING_GOAL_NAMES[i] ?? i}</span>
                  <span className="text-violet-400 text-[8px] font-mono w-[32px] shrink-0">{u.q.toFixed(3)}</span>
                  <span className="text-zinc-700 text-[7px] w-[20px] shrink-0">n={u.n}</span>
                  <div className="flex items-center gap-1 ml-auto">
                    {ds !== null && (
                      <>
                        <div className="relative h-1.5 w-12 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${barW}px`, backgroundColor: dsColor }} />
                        </div>
                        <span className="text-[8px] font-mono w-[28px] text-right shrink-0" style={{ color: dsColor }}>
                          {(ds * 100).toFixed(0)}%
                        </span>
                      </>
                    )}
                    {ds === null && <span className="text-zinc-700 text-[8px] w-[28px] text-right">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proposals view */}
      {view === "proposals" && (
        <div className="flex-1 overflow-y-auto">
          {proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600 py-8">
              <span className="text-[11px]">no pending proposals</span>
              <button onClick={propose} disabled={proposing}
                className="px-3 py-1 rounded border border-violet-700 text-violet-400 text-[10px] hover:bg-violet-900/30 disabled:opacity-40">
                {proposing ? "proposing…" : "generate proposals"}
              </button>
            </div>
          ) : (
            proposals.map(p => (
              <div key={p.id} className="border-b border-zinc-900 px-3 py-2 space-y-1 hover:bg-zinc-900/20">
                <div className="text-zinc-200 text-[10px] leading-snug">{p.text}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-violet-500 text-[8px] px-1 rounded border border-violet-800">{p.keyword}</span>
                  <span className="text-zinc-600 text-[8px]">domain: {p.domain}</span>
                  <span className="text-zinc-600 text-[8px]">{p.id}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => acceptProposal(p.id)}
                    className="text-[8px] px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-400 hover:bg-emerald-900/30">
                    accept
                  </button>
                  <button onClick={() => rejectProposal(p.id)}
                    className="text-[8px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 hover:bg-zinc-800/30">
                    reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Dream consolidator insights panel */}
      {view === "dream" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-zinc-600 uppercase tracking-wider">dream consolidator</span>
            <button onClick={runDream} disabled={dreamRunning}
              className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 text-[8px] hover:bg-zinc-800/40 disabled:opacity-40">
              {dreamRunning ? "running…" : "run consolidate"}
            </button>
          </div>
          {/* Self-eval trend chart — always visible once history exists */}
          {evalHistory.length > 0 && (() => {
                const CHART_H = 44; const CHART_W = 220; const PAD = 4;
                const entries = evalHistory.slice(-20);
                const bw = Math.floor((CHART_W - PAD * 2) / entries.length);
                const ABBR: Record<string, string> = { mesh: "M", mesh_test: "T", swarm: "S" };
                const latest = entries[entries.length - 1].score;
                return (
                  <div className="bg-zinc-900 rounded p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[8px] text-zinc-500 uppercase tracking-wider">self-eval trend</span>
                      <span className="text-[9px] font-mono" style={{ color: cohColor(latest) }}>{latest.toFixed(4)}</span>
                    </div>
                    <svg width={CHART_W} height={CHART_H + 12} style={{ overflow: "visible" }}>
                      <line x1={PAD} y1={CHART_H - 0.9711 * CHART_H} x2={PAD + bw * entries.length} y2={CHART_H - 0.9711 * CHART_H}
                        stroke="#7c3aed" strokeWidth="0.5" strokeDasharray="2 2" />
                      {entries.map((e, idx) => {
                        const bh = Math.max(1, Math.round(e.score * CHART_H));
                        const x = PAD + idx * bw;
                        const col = cohColor(e.score);
                        return (
                          <g key={idx}>
                            <rect x={x + 1} y={CHART_H - bh} width={bw - 2} height={bh} fill={col} opacity={0.85} rx={1} />
                            <text x={x + bw / 2} y={CHART_H + 10} textAnchor="middle" fontSize="6" fill="#52525b">
                              {ABBR[e.agent] ?? "?"}
                            </text>
                          </g>
                        );
                      })}
                      <text x={PAD + bw * entries.length + 2} y={CHART_H - 0.9711 * CHART_H + 2} fontSize="6" fill="#7c3aed">φ</text>
                    </svg>
                    <div className="text-zinc-700 text-[7px] mt-0.5">{evalHistory.length} evals · M=mesh T=mesh_test S=swarm · φ=0.9711</div>
                  </div>
                );
          })()}
          {/* Dream consolidator sections — only when ltmData available */}
          {!ltmData ? (
            <div className="text-zinc-600 text-[10px] text-center py-4">dream consolidator not yet run</div>
          ) : (
            <>
              {/* Cycle health grid */}
              <div className="grid grid-cols-3 gap-1">
                <div className="bg-zinc-900 rounded p-1.5 text-center">
                  <div className="text-[8px] text-zinc-500 mb-0.5">avg coherence</div>
                  <div className="font-bold text-[11px]" style={{ color: cohColor(ltmData.avg_coherence ?? 0) }}>
                    {ltmData.avg_coherence?.toFixed(3) ?? "—"}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded p-1.5 text-center">
                  <div className="text-[8px] text-zinc-500 mb-0.5">avg eval score</div>
                  <div className="font-bold text-[11px]" style={{ color: cohColor(ltmData.avg_eval_score ?? 0) }}>
                    {ltmData.avg_eval_score?.toFixed(3) ?? "—"}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded p-1.5 text-center">
                  <div className="text-[8px] text-zinc-500 mb-0.5">cycles</div>
                  <div className="text-zinc-200 font-bold text-[11px]">{ltmData.cycle_count ?? "—"}</div>
                </div>
              </div>
              {/* Evolution health */}
              {ltmData.evolution_health !== undefined && (
                <div className="bg-zinc-900 rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[8px] text-zinc-500 uppercase tracking-wider">evolution health</span>
                    <span className="text-[9px] font-mono" style={{ color: cohColor(ltmData.evolution_health) }}>
                      {(ltmData.evolution_health * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${ltmData.evolution_health * 100}%`, backgroundColor: cohColor(ltmData.evolution_health) }} />
                  </div>
                </div>
              )}
              {/* Top missed keywords */}
              {(ltmData.top_missed_keywords?.length ?? 0) > 0 && (
                <div className="bg-zinc-900 rounded p-2">
                  <div className="text-[8px] text-zinc-500 uppercase tracking-wider mb-1.5">top missed keywords</div>
                  <div className="flex flex-wrap gap-1">
                    {ltmData.top_missed_keywords!.map(kw => (
                      <span key={kw} className="px-1.5 py-0.5 rounded border border-amber-800 text-amber-400 text-[8px]">{kw}</span>
                    ))}
                  </div>
                  <div className="text-zinc-600 text-[7px] mt-1.5">goal text tokens missing from cycle_summary — cycle enrichment can close these gaps</div>
                </div>
              )}
              {/* Insights */}
              {(ltmData.insights?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-[8px] text-zinc-500 uppercase tracking-wider">dream insights</div>
                  {ltmData.insights!.map((ins, i) => (
                    <div key={i} className="bg-zinc-900/60 border border-zinc-800/60 rounded px-2 py-1.5 text-[9px] text-zinc-400">{ins}</div>
                  ))}
                </div>
              )}
              {ltmData.last_consolidation && (
                <div className="text-zinc-700 text-[7px]">last consolidation: {fmtDate(ltmData.last_consolidation)} {fmtTs(ltmData.last_consolidation)}</div>
              )}
            </>
          )}
        </div>
      )}

      {/* Goal list */}
      {/* Self-modifier applied history */}
      {view === "mods" && (
        <div className="flex-1 overflow-y-auto">
          {selfMods.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-600 text-[10px]">no self-mod proposals on record</div>
          ) : (
            selfMods.map(m => {
              const statusColor = m.status === "applied" ? "#34d399" : m.status === "rejected" ? "#f87171" : "#fbbf24";
              const shortFile = m.file_path.replace(/^.*[\\/]/, "");
              return (
                <div key={m.id} className="border-b border-zinc-900 px-3 py-2.5 space-y-1 hover:bg-zinc-900/20">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-[8px] px-1 py-0.5 rounded border font-mono uppercase tracking-wider"
                      style={{ color: statusColor, borderColor: statusColor + "55", backgroundColor: statusColor + "18" }}>
                      {m.status}
                    </span>
                    <span className="text-zinc-200 text-[10px] leading-snug flex-1">{m.description}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[8px]">
                    <span className="text-amber-500 font-mono">{shortFile}</span>
                    <span className="text-zinc-600">by {m.proposer}</span>
                    {m.sce88_pass !== undefined && (
                      <span className={m.sce88_pass ? "text-emerald-600" : "text-red-600"}>
                        SCE-88 {m.sce88_pass ? "✓" : "✗"} {m.sce88_coherence?.toFixed(2)}
                      </span>
                    )}
                    {m.xova_approved !== undefined && (
                      <span className={m.xova_approved ? "text-teal-600" : "text-zinc-600"}>
                        xova {m.xova_approved ? "approved" : "rejected"}
                      </span>
                    )}
                    <span className="text-zinc-700 ml-auto">{m.id}</span>
                  </div>
                  <div className="flex gap-3 text-[7px] text-zinc-600">
                    <span>proposed {fmtDate(m.created_at)} {fmtTs(m.created_at)}</span>
                    {m.applied_at && <span>applied {fmtDate(m.applied_at)} {fmtTs(m.applied_at)}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {view !== "proposals" && view !== "dream" && view !== "mods" && (
      <div className="flex-1 overflow-y-auto">
        {displayed.map(goal => {
          const isActive = goal.id === store.active_goal;
          return (
            <div key={goal.id}
              className={`border-b border-zinc-900 px-3 py-2 space-y-1 hover:bg-zinc-900/30 ${isActive ? "bg-emerald-950/10" : ""}`}>
              <div className="flex items-start gap-2">
                <span className={`shrink-0 mt-0.5 text-[8px] px-1 py-0.5 rounded border font-mono uppercase tracking-wider ${STATUS_STYLE[goal.status] ?? ""}`}>
                  {goal.status}
                </span>
                <span className="text-zinc-200 text-[10px] leading-snug flex-1">{goal.text}</span>
                <span className="text-zinc-600 text-[8px] shrink-0">p{goal.priority}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-zinc-600 text-[8px]">{goal.id}</span>
                <span className="text-zinc-600 text-[8px]">{goal.owner}</span>
                {goal.parent && <span className="text-zinc-600 text-[8px]">↳ {goal.parent.slice(0, 12)}</span>}
                <span className="text-zinc-600 text-[8px] ml-auto">{goal.progress.length} notes</span>
              </div>
              {/* Action buttons */}
              <div className="flex gap-1">
                {goal.status !== "active" && (
                  <button onClick={() => activate(goal.id)}
                    className="text-[8px] px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-400 hover:bg-emerald-900/30">
                    activate
                  </button>
                )}
                {goal.status === "active" && !isActive && (
                  <button onClick={() => activate(goal.id)}
                    className="text-[8px] px-1.5 py-0.5 rounded border border-emerald-700 text-emerald-400 hover:bg-emerald-900/30">
                    make active
                  </button>
                )}
                {goal.status === "active" && (
                  <button onClick={() => pause(goal.id)}
                    className="text-[8px] px-1.5 py-0.5 rounded border border-amber-700 text-amber-400 hover:bg-amber-900/30">
                    pause
                  </button>
                )}
                {(goal.status === "active" || goal.status === "paused") && (
                  <button onClick={() => complete(goal.id)}
                    className="text-[8px] px-1.5 py-0.5 rounded border border-blue-700 text-blue-400 hover:bg-blue-900/30">
                    complete
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {displayed.length === 0 && !loading && (
          <div className="flex-1 flex items-center justify-center text-zinc-600 py-8">no goals</div>
        )}
      </div>
      )}

      {/* New goal input */}
      <div className="border-t border-zinc-800 p-2 shrink-0 flex gap-1">
        <input
          value={newGoal}
          onChange={e => setNewGoal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addGoal(); } }}
          placeholder="new goal…"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-emerald-600 min-w-0"
        />
        <button onClick={addGoal} disabled={saving || !newGoal.trim()}
          className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300 text-[10px] hover:bg-emerald-800/40 disabled:opacity-40 shrink-0">
          {saving ? "…" : "+"}
        </button>
      </div>
    </div>
  );
}
