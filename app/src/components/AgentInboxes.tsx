import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const REPO_PATH   = "C:\\Xova\\memory\\repo_inbox.json";
const JARVIS_PATH = "C:\\Xova\\memory\\jarvis_inbox.json";

interface DispatchedTask {
  ts: number;
  from?: string;
  to?: string;
  task_type?: string;
  goal_id?: string;
  goal?: string;
  payload?: { avg_coherence?: number; task_msg?: string };
  status?: string;
  intent?: string;
  text?: string;
  correlation_id?: string;
}

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

const TASK_CLS: Record<string, string> = {
  ci_health:   "bg-blue-900/40 text-blue-300 border-blue-700",
  observation: "bg-teal-900/40 text-teal-300 border-teal-700",
  analysis:    "bg-violet-900/40 text-violet-300 border-violet-700",
  ask:         "bg-amber-900/40 text-amber-300 border-amber-700",
};

export function AgentInboxes({ onClose }: { onClose: () => void }) {
  const [repoMsgs,   setRepoMsgs]   = useState<DispatchedTask[]>([]);
  const [jarvisMsg,  setJarvisMsg]  = useState<DispatchedTask | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [activeInbox, setActiveInbox] = useState<"repo" | "jarvis">("repo");

  const refresh = useCallback(async () => {
    try {
      const r = await invoke<string>("xova_read_file", { path: REPO_PATH });
      const d = JSON.parse(r);
      setRepoMsgs(Array.isArray(d) ? d : []);
    } catch { setRepoMsgs([]); }
    try {
      const r = await invoke<string>("xova_read_file", { path: JARVIS_PATH });
      setJarvisMsg(JSON.parse(r) as DispatchedTask);
    } catch { setJarvisMsg(null); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [refresh]);

  const items: DispatchedTask[] = activeInbox === "repo" ? repoMsgs : (jarvisMsg ? [jarvisMsg] : []);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Agent Inboxes</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        {([
          { k: "repo",   label: "Repo",   n: repoMsgs.length },
          { k: "jarvis", label: "Jarvis", n: jarvisMsg ? 1 : 0 },
        ] as const).map(({ k, label, n }) => (
          <button key={k} onClick={() => setActiveInbox(k)}
            className={`text-[7px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
              activeInbox === k ? "bg-cyan-900/40 border-cyan-600 text-cyan-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
            }`}>
            {label} {n}
          </button>
        ))}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && items.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">inbox empty</div>}

      <div className="flex-1 overflow-y-auto">
        {[...items].reverse().map((item, i) => {
          const taskType = item.task_type ?? item.intent;
          const coh = item.payload?.avg_coherence;
          return (
            <div key={i} className="px-3 py-2 border-b border-zinc-900/50 hover:bg-zinc-900/20">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-zinc-600 text-[8px] shrink-0">{fmtTime(item.ts)}</span>
                {taskType && (
                  <span className={`text-[7px] px-1 py-px rounded border ${TASK_CLS[taskType] ?? "bg-zinc-800 border-zinc-700 text-zinc-400"}`}>
                    {taskType}
                  </span>
                )}
                {item.from && <span className="text-zinc-600 text-[8px]">{item.from}</span>}
                {coh !== undefined && (
                  <span className={`text-[8px] font-bold ml-auto ${coh >= 0.7 ? "text-emerald-400" : "text-amber-400"}`}>
                    {coh.toFixed(3)}
                  </span>
                )}
                <span className="text-zinc-700 text-[7px]">{fmtAgo(item.ts)}</span>
              </div>
              <div className="text-zinc-400 text-[8px] leading-snug truncate">
                {item.text ?? item.goal ?? item.payload?.task_msg ?? ""}
              </div>
              {item.status && (
                <div className="text-zinc-600 text-[7px] mt-0.5">{item.status}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
