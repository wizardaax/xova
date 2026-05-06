import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const EVO_DIR = "C:\\Xova\\memory\\evolution";
const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";

interface Proposal {
  id?: string;
  category: string;
  target: string;
  description: string;
  risk?: string;
  gap?: { agent?: string; type?: string; value?: number; threshold?: number };
}

interface AppliedItem {
  proposal_id?: string;
  category?: string | null;
  target?: string | null;
  description?: string;
  version?: string;
  coherence_delta?: number;
}

interface EvolveEvent {
  filename: string;
  timestamp: Date;
  proposalCount: number;
  appliedCount: number;
  simPassCount: number;
  simFailCount: number;
  coherence: number | null;
  gaps: number;
  proposals: Proposal[];
  appliedItems: AppliedItem[];
  version: string | null;
  autoMerge: boolean;
  error?: string;
}

function filenameToDate(name: string): Date {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return new Date(0);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(filename: string, raw: any): EvolveEvent {
  const isNew = typeof raw.ts === "number";
  let timestamp: Date;
  let proposalCount = 0, appliedCount = 0, simPassCount = 0, simFailCount = 0;
  let coherence: number | null = null, gaps = 0;
  let proposals: Proposal[] = [], appliedItems: AppliedItem[] = [];
  let version: string | null = null, autoMerge = false;

  if (isNew) {
    timestamp = new Date(raw.ts * 1000);
    proposals = raw.proposed ?? [];
    proposalCount = proposals.length;
    coherence = raw.observed?.summary?.coherence ?? raw.observed?.coherence ?? null;
    gaps = raw.observed?.gaps?.length ?? 0;
    simPassCount = raw.simulated?.pass_count ?? 0;
    simFailCount = raw.simulated?.fail_count ?? 0;
    appliedItems = raw.applied?.changes ?? [];
    appliedCount = appliedItems.length;
    version = raw.applied?.version ?? null;
    autoMerge = raw.applied?.auto_merge ?? false;
  } else {
    timestamp = raw.ts_utc ? new Date(raw.ts_utc) : filenameToDate(filename);
    const pl = raw.pipeline;
    proposals = pl?.proposals ?? [];
    proposalCount = pl?.proposed ?? proposals.length;
    coherence = pl?.observed?.coherence ?? null;
    gaps = typeof pl?.observed?.gaps === "number" ? pl.observed.gaps : 0;
    appliedItems = pl?.applied_items ?? [];
    appliedCount = pl?.applied ?? appliedItems.length;
    version = appliedItems[0]?.version ?? null;
  }

  return { filename, timestamp, proposalCount, appliedCount, simPassCount, simFailCount, coherence, gaps, proposals, appliedItems, version, autoMerge };
}

function statusBadge(applied: number, proposed: number, simPass: number) {
  if (applied > 0 && applied === proposed) return "applied";
  if (applied > 0) return "partial";
  if (simPass > 0 && proposed > 0) return "simulated";
  if (proposed > 0) return "proposed";
  return "pending";
}

const BADGE: Record<string, string> = {
  applied:   "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  partial:   "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  simulated: "bg-blue-900/50 text-blue-300 border-blue-700",
  proposed:  "bg-violet-900/50 text-violet-300 border-violet-700",
  pending:   "bg-zinc-800 text-zinc-400 border-zinc-700",
  error:     "bg-red-900/50 text-red-300 border-red-700",
};

export function EvolutionTracker({ onClose: _onClose }: { onClose?: () => void }) {
  const [events, setEvents] = useState<EvolveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const cmd = `"${PYTHON}" -c "import os,json; d=r'${EVO_DIR}'; f=sorted(x for x in os.listdir(d) if x.endswith('_evolve.json')) if os.path.isdir(d) else []; print(json.dumps(f))"`;
      const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw); if (typeof w.stdout === "string") stdout = w.stdout; } catch { /* use raw */ }
      const files: string[] = JSON.parse(stdout.trim());

      const toLoad = files.slice(-60).reverse();
      const loaded: EvolveEvent[] = [];
      for (const fname of toLoad) {
        const path = `${EVO_DIR}\\${fname}`;
        try {
          const content = await invoke<string>("xova_read_file", { path });
          loaded.push(normalise(fname, JSON.parse(content)));
        } catch (e) {
          loaded.push({ filename: fname, timestamp: filenameToDate(fname), proposalCount: 0, appliedCount: 0, simPassCount: 0, simFailCount: 0, coherence: null, gaps: 0, proposals: [], appliedItems: [], version: null, autoMerge: false, error: String(e) });
        }
      }
      setEvents(loaded);
      setLastRefresh(new Date());
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  const totalProposed = events.reduce((s, e) => s + e.proposalCount, 0);
  const totalApplied  = events.reduce((s, e) => s + e.appliedCount, 0);
  const totalSimPass  = events.reduce((s, e) => s + e.simPassCount, 0);

  return (
    <div className="flex flex-col h-full text-[12px] text-zinc-300 font-mono">
      <div className="shrink-0 flex items-center gap-2 mb-2 px-1">
        <span className="text-emerald-400 font-semibold text-[11px] uppercase tracking-wide">Evolution History</span>
        <button onClick={load} disabled={loading} title="Refresh"
          className="ml-auto w-6 h-6 flex items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-emerald-400 hover:border-emerald-600 disabled:opacity-40 text-[13px]">
          {loading ? "⟳" : "↻"}
        </button>
      </div>
      {error && <div className="shrink-0 text-red-400 text-[11px] bg-red-950/30 border border-red-800 rounded px-2 py-1 mb-2">{error}</div>}
      <div className="shrink-0 grid grid-cols-4 gap-1 mb-2">
        {[["cycles", events.length], ["proposed", totalProposed], ["applied", totalApplied], ["sim pass", totalSimPass]].map(([l, v]) => (
          <div key={l} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-center">
            <div className="text-emerald-400 font-bold text-[13px]">{v}</div>
            <div className="text-zinc-500 text-[9px] uppercase tracking-wider">{l}</div>
          </div>
        ))}
      </div>
      <div className="shrink-0 text-zinc-500 text-[10px] mb-2 px-1">
        {loading ? "loading…" : `${totalProposed} events · ${events.length} cycles${lastRefresh ? ` · ${lastRefresh.toLocaleTimeString()}` : ""}`}
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
        {events.map(ev => {
          const status = ev.error ? "error" : statusBadge(ev.appliedCount, ev.proposalCount, ev.simPassCount);
          const isOpen = expanded === ev.filename;
          const ts = ev.timestamp.getFullYear() < 2000 ? filenameToDate(ev.filename) : ev.timestamp;
          return (
            <div key={ev.filename} className="border border-zinc-800 rounded bg-zinc-900/60 overflow-hidden">
              <button onClick={() => setExpanded(isOpen ? null : ev.filename)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-800/50 transition-colors">
                <span className="text-zinc-500 text-[10px] w-[104px] shrink-0">
                  {ts.toLocaleDateString()} {ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 uppercase tracking-wide ${BADGE[status]}`}>{status}</span>
                <span className="text-zinc-400 text-[10px] truncate flex-1">
                  {ev.error ? "parse error" : `${ev.proposalCount} proposed · ${ev.appliedCount} applied${ev.coherence != null ? ` · coh ${ev.coherence.toFixed(3)}` : ""}${ev.gaps > 0 ? ` · ${ev.gaps} gaps` : ""}`}
                </span>
                <span className="text-zinc-600 text-[10px] shrink-0">{isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div className="border-t border-zinc-800 px-2 py-2 space-y-2 bg-zinc-950/60">
                  {ev.error && <div className="text-red-400 text-[10px]">Error: {ev.error}</div>}
                  {ev.version && (
                    <div className="text-zinc-500 text-[10px]">
                      Version: <span className="text-emerald-400">{ev.version}</span>
                      {ev.autoMerge && <span className="ml-2 text-blue-400">auto-merge</span>}
                    </div>
                  )}
                  {ev.proposals.length > 0 && (
                    <div>
                      <div className="text-zinc-500 text-[10px] uppercase tracking-wide mb-1">Proposals ({ev.proposals.length})</div>
                      {ev.proposals.map((p, i) => {
                        const wasApplied = ev.appliedItems.some(a => a.proposal_id === p.id || a.target === p.target);
                        return (
                          <div key={i} className="flex items-start gap-1.5 pl-1 mb-0.5">
                            <span className={`mt-0.5 text-[8px] shrink-0 ${wasApplied ? "text-emerald-400" : "text-zinc-500"}`}>{wasApplied ? "✓" : "·"}</span>
                            <div className="min-w-0">
                              <span className="text-zinc-300 text-[10px]">{p.description}</span>
                              <div className="flex gap-2 mt-0.5 flex-wrap">
                                {p.target && <span className="text-blue-400 text-[9px]">{p.target}</span>}
                                {p.category && <span className="text-zinc-500 text-[9px]">{p.category}</span>}
                                {p.risk && <span className={`text-[9px] ${p.risk === "low" ? "text-emerald-500" : p.risk === "high" ? "text-red-400" : "text-yellow-400"}`}>risk:{p.risk}</span>}
                                {p.gap?.type && <span className="text-orange-400 text-[9px]">gap:{p.gap.type} {p.gap.value?.toFixed(1)}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {ev.appliedItems.length > 0 && ev.appliedItems[0]?.description && (
                    <div>
                      <div className="text-zinc-500 text-[10px] uppercase tracking-wide mb-1">Applied ({ev.appliedItems.length})</div>
                      {ev.appliedItems.map((a, i) => (
                        <div key={i} className="text-emerald-300 text-[10px] pl-2">{a.target ? `${a.target}: ` : ""}{a.description}</div>
                      ))}
                    </div>
                  )}
                  <div className="text-zinc-600 text-[9px]">{ev.filename}</div>
                </div>
              )}
            </div>
          );
        })}
        {!loading && events.length === 0 && !error && (
          <div className="text-zinc-500 text-[11px] text-center mt-6">No evolution cycles found</div>
        )}
      </div>
    </div>
  );
}
