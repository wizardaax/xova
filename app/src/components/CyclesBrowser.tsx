import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const CYCLES_DIR = "C:\\Xova\\memory\\cycles";

interface AgentResult { agent: string; coherence_score: number }
interface Cycle {
  goal: string;
  results: AgentResult[];
  average_coherence: number;
  crest: string;
  timestamp: number;
  sha256: string;
}

function fmtTs(ts: number) {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit" });
}

function coherenceColor(v: number) {
  if (v >= 0.8) return "#34d399";
  if (v >= 0.5) return "#fbbf24";
  return "#f87171";
}

export function CyclesBrowser({ onClose }: { onClose: () => void }) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const script = `import os,json; d=r'${CYCLES_DIR}'; f=sorted([x for x in os.listdir(d) if x.endswith('.json')]) if os.path.isdir(d) else []; print(json.dumps(f[-80:]))`;
      const raw = await invoke<string>("xova_run", { command: `"${PY}" -c "${script.replace(/"/g, '\\"')}"`, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      const files: string[] = JSON.parse(stdout.trim());

      const loaded: Cycle[] = [];
      await Promise.all(files.map(async (f) => {
        try {
          const content = await invoke<string>("xova_read_file", { path: `${CYCLES_DIR}\\${f}` });
          const cycle = JSON.parse(content) as Cycle;
          loaded.push(cycle);
        } catch { /* skip */ }
      }));
      loaded.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      setCycles(loaded);
    } catch { setCycles([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const visible = filter.trim()
    ? cycles.filter(c => c.goal?.toLowerCase().includes(filter.toLowerCase()) || c.crest?.includes(filter))
    : cycles;

  const avgAll = cycles.length
    ? (cycles.reduce((s, c) => s + (c.average_coherence ?? 0), 0) / cycles.length).toFixed(3)
    : "—";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Cycles ({cycles.length}) · avg {avgAll}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter goal / crest…"
          className="w-full bg-zinc-900 text-zinc-200 text-[10px] rounded px-2 py-1 border border-zinc-700 focus:outline-none placeholder-zinc-600" />
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && visible.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no cycles</div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {visible.map((c, i) => {
          const open = expanded === i;
          const color = coherenceColor(c.average_coherence ?? 0);
          return (
            <div key={c.sha256 ?? i} className="border border-zinc-800 rounded bg-zinc-900">
              <button onClick={() => setExpanded(open ? null : i)} className="w-full text-left px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 text-[9px] shrink-0">{fmtTs(c.timestamp)}</span>
                  <span className="font-bold text-[11px]" style={{ color }}>{(c.average_coherence ?? 0).toFixed(3)}</span>
                  {c.crest && <span className="text-zinc-500 text-[9px] truncate">{c.crest.slice(0, 20)}</span>}
                  <span className="ml-auto text-zinc-600 text-[9px]">{open ? "▲" : "▼"}</span>
                </div>
                <div className="text-zinc-400 text-[10px] truncate mt-0.5">{c.goal || "—"}</div>
              </button>
              {open && (
                <div className="px-3 pb-2 border-t border-zinc-800">
                  <div className="text-[9px] text-zinc-600 mt-1 mb-1">Agent Results</div>
                  {(c.results ?? []).map((r, ri) => (
                    <div key={ri} className="flex items-center gap-2 leading-5">
                      <span className="text-zinc-500 text-[9px] w-32 truncate">{r.agent}</span>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, r.coherence_score)) * 100}%`, backgroundColor: coherenceColor(r.coherence_score) }} />
                      </div>
                      <span className="text-[9px] w-10 text-right" style={{ color: coherenceColor(r.coherence_score) }}>{r.coherence_score?.toFixed(3)}</span>
                    </div>
                  ))}
                  <div className="text-zinc-700 text-[8px] mt-1 font-mono truncate">{c.sha256}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
