import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getSce88Stats, getSce88TotalEvents, SCE88_LEVELS, type Sce88Stat } from "@/lib/sce88";

const LOG_PATH = "C:\\Xova\\memory\\sce88_log.jsonl";
const POLL_MS = 15_000;

interface LogEntry { ts: number; kind: string; detail?: string; levels?: number[] }

function fmt(ts: number) { return new Date(ts).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

function parseLog(raw: string): LogEntry[] {
  return raw.split("\n").filter(Boolean).flatMap(line => {
    try { const e = JSON.parse(line); if (typeof e.ts === "number" && typeof e.kind === "string") return [e as LogEntry]; } catch { /* skip */ }
    return [];
  });
}

export function Sce88Audit({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<Sce88Stat[]>([]);
  const [total, setTotal] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logAvailable, setLogAvailable] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setStats(getSce88Stats());
    setTotal(getSce88TotalEvents());
    try {
      const raw = await invoke<string>("xova_read_file", { path: LOG_PATH });
      setLogEntries(parseLog(raw).slice(-100).reverse());
      setLogAvailable(true);
    } catch { setLogAvailable(false); }
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [refresh]);

  const intelligenceTotal = stats.filter(s => s.band === "intelligence").reduce((a, s) => a + s.count, 0);
  const computationalTotal = stats.filter(s => s.band !== "intelligence").reduce((a, s) => a + s.count, 0);
  const intelligencePct = total > 0 ? ((intelligenceTotal / total) * 100).toFixed(1) : "—";

  const levelsByGroup = SCE88_LEVELS.reduce<Record<string, typeof SCE88_LEVELS[number][]>>((acc, lvl) => {
    (acc[lvl.group] ??= []).push(lvl); return acc;
  }, {});

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">SCE-88 Audit Trail</span>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="text-zinc-600 hover:text-zinc-300">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        <div className="grid grid-cols-3 gap-1">
          {([["total events", total || "—"], ["intelligence", `${intelligencePct}%`], ["active levels", stats.length || "—"]] as [string, string|number][]).map(([label, value]) => (
            <div key={label} className="bg-zinc-900 rounded p-2 text-center border border-zinc-800">
              <div className="text-[9px] text-zinc-600 uppercase leading-tight mb-1">{label}</div>
              <div className="text-sm font-bold text-emerald-300">{value}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div className="bg-zinc-900 rounded p-2 border border-emerald-900">
            <div className="text-[9px] text-emerald-600 uppercase mb-0.5">Intelligence (L17–22)</div>
            <div className="text-sm font-bold text-emerald-300">{intelligenceTotal}</div>
          </div>
          <div className="bg-zinc-900 rounded p-2 border border-zinc-800">
            <div className="text-[9px] text-zinc-600 uppercase mb-0.5">Computational (L1–16)</div>
            <div className="text-sm font-bold text-zinc-300">{computationalTotal}</div>
          </div>
        </div>
        {stats.length > 0 && (
          <div>
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Active levels (session)</div>
            <div className="space-y-0.5">
              {stats.map(s => (
                <div key={s.level} className={`flex items-center gap-2 bg-zinc-900 rounded px-2 py-1 border-l-2 ${s.band === "intelligence" ? "border-emerald-700" : "border-zinc-700"}`}>
                  <span className="text-zinc-600 w-5 shrink-0">L{s.level}</span>
                  <span className={`flex-1 truncate text-[10px] ${s.band === "intelligence" ? "text-emerald-400" : "text-zinc-400"}`} title={s.name}>{s.name}</span>
                  <span className="text-zinc-500 w-6 text-right shrink-0">{s.count}</span>
                  <div className="w-16 bg-zinc-800 rounded-full h-1 shrink-0">
                    <div className={`h-1 rounded-full ${s.band === "intelligence" ? "bg-emerald-500" : "bg-zinc-500"}`} style={{ width: `${Math.min(s.pct, 100).toFixed(1)}%` }} />
                  </div>
                  <span className="text-zinc-700 w-8 text-right shrink-0 text-[9px]">{s.pct.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">All 22 levels</div>
          <div className="space-y-1">
            {Object.entries(levelsByGroup).map(([group, levels]) => (
              <div key={group}>
                <div className="text-[8px] text-zinc-700 uppercase tracking-wider px-1 mb-0.5">{group}</div>
                {levels.map(lvl => {
                  const hit = stats.find(s => s.level === lvl.index);
                  return (
                    <div key={lvl.index} className={`flex items-center gap-2 px-2 py-0.5 rounded ${hit ? "bg-zinc-900" : "bg-zinc-950"}`}>
                      <span className="text-zinc-700 w-5 shrink-0">L{lvl.index}</span>
                      <span className={`flex-1 truncate text-[10px] ${hit ? (lvl.band === "intelligence" ? "text-emerald-400" : "text-zinc-400") : "text-zinc-700"}`}>{lvl.name}</span>
                      <span className={hit ? "text-zinc-500 text-[9px]" : "text-zinc-800 text-[9px]"}>{hit ? hit.count : "—"}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {logAvailable === true && logEntries.length > 0 && (
          <div>
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Recent log events</div>
            <div className="border border-zinc-800 rounded overflow-hidden">
              <table className="w-full text-[9px]">
                <thead><tr className="bg-zinc-900 text-zinc-600"><th className="text-left px-2 py-1 font-normal">time</th><th className="text-left px-2 py-1 font-normal">kind</th><th className="text-left px-2 py-1 font-normal">levels</th><th className="text-left px-2 py-1 font-normal">detail</th></tr></thead>
                <tbody>
                  {logEntries.map((e, i) => (
                    <tr key={i} className={`border-t border-zinc-800 ${i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/50"}`}>
                      <td className="px-2 py-0.5 text-zinc-600 whitespace-nowrap">{fmt(e.ts)}</td>
                      <td className="px-2 py-0.5 text-emerald-400 whitespace-nowrap">{e.kind}</td>
                      <td className="px-2 py-0.5 text-zinc-500 whitespace-nowrap">{e.levels?.map(l => `L${l}`).join(" ") ?? "—"}</td>
                      <td className="px-2 py-0.5 text-zinc-500 truncate max-w-[120px]">{e.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {logAvailable === false && (
          <div className="text-[9px] text-zinc-700 border border-zinc-800 rounded px-2 py-1.5">
            no sce88_log.jsonl — counters are session-scoped in-memory only
          </div>
        )}
        <button onClick={refresh} className="w-full py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-500 text-[9px] uppercase tracking-wider">↻ refresh</button>
      </div>
    </div>
  );
}
