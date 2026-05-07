import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY      = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const SCRIPT  = "D:\\temp\\trash_keeper.py";
const CWD     = "C:\\Xova";

interface AgentStats { entries: number; bytes: number; }
type StatsResult = Record<string, AgentStats>;

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024)         return `${(b / 1_024).toFixed(0)} KB`;
  return `${b} B`;
}

const AGENT_COLOR: Record<string, string> = {
  forge:  "bg-amber-900/50 text-amber-300 border-amber-700",
  xova:   "bg-blue-900/50 text-blue-300 border-blue-700",
  jarvis: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  absorb: "bg-violet-900/50 text-violet-300 border-violet-700",
};
function agentCls(a: string) { return AGENT_COLOR[a] ?? "bg-zinc-800 text-zinc-400 border-zinc-700"; }

export function TrashStats({ onClose }: { onClose: () => void }) {
  const [stats,     setStats]     = useState<StatsResult | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PY}" "${SCRIPT}" stats`, cwd: CWD, elevated: false,
      });
      let text = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout) text = w.stdout; } catch { /**/ }
      setStats(JSON.parse(text) as StatsResult);
      setErr("");
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const agents = Object.entries(stats ?? {});
  const totalEntries = agents.reduce((s, [, v]) => s + v.entries, 0);
  const totalBytes   = agents.reduce((s, [, v]) => s + v.bytes, 0);
  const maxEntries   = Math.max(...agents.map(([, v]) => v.entries), 1);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Trash Stats{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">total entries</span>
          <span className="text-zinc-200">{totalEntries}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">total size</span>
          <span className="text-zinc-200">{fmtBytes(totalBytes)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">agents</span>
          <span className="text-zinc-200">{agents.length}</span>
        </div>
      </div>

      <div className="text-[8px] text-zinc-700 px-3 py-1 border-b border-zinc-800 shrink-0">
        append-only · never empty · deposit-before-delete
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && err && <div className="flex-1 flex items-center justify-center text-red-400 text-[9px] px-4 text-center">{err}</div>}

      {stats && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {agents.map(([agent, v]) => (
            <div key={agent}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[8px] px-1.5 py-0.5 rounded border ${agentCls(agent)}`}>{agent}</span>
                <span className="text-zinc-300 text-[10px] font-bold">{v.entries} entries</span>
                <span className="text-zinc-600 text-[9px] ml-auto">{fmtBytes(v.bytes)}</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded overflow-hidden">
                <div
                  className={`h-full rounded ${agentCls(agent).split(" ")[0].replace("border", "bg").replace("/50", "/60").replace("/40", "/60")}`}
                  style={{ width: `${Math.round((v.entries / maxEntries) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
