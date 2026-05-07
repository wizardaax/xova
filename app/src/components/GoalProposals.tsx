import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PROPOSALS_PATH = "C:\\Xova\\memory\\goal_proposals.json";

interface Proposal {
  id: string;
  text: string;
  keyword: string;
  domain: string;
  parent_id?: string;
  status: string;
  ts: number;
  goal_id?: string;
}
interface ProposalsData { version?: number; proposals?: Proposal[]; updated_at?: number; }

const STATUS_CLS: Record<string, string> = {
  accepted: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  pending:  "bg-amber-900/40 text-amber-300 border-amber-700",
  rejected: "bg-red-900/40 text-red-300 border-red-700",
};
const KW_CLS: Record<string, string> = {
  build:     "bg-blue-900/40 text-blue-300 border-blue-700",
  cognitive: "bg-violet-900/40 text-violet-300 border-violet-700",
  evaluate:  "bg-teal-900/40 text-teal-300 border-teal-700",
};

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function GoalProposals({ onClose }: { onClose: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState<string>("all");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: PROPOSALS_PATH });
      const d = JSON.parse(raw) as ProposalsData;
      setProposals(d.proposals ?? []);
      setUpdatedAt(d.updated_at ?? 0);
    } catch { setProposals([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  const all = proposals;
  const accepted = all.filter(p => p.status === "accepted").length;
  const pending  = all.filter(p => p.status === "pending").length;
  const rejected = all.filter(p => p.status === "rejected").length;

  const visible = filter === "all" ? all : all.filter(p => p.status === filter);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Goal Proposals{updatedAt ? ` · ${fmtAgo(updatedAt)} ago` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-3 px-3 py-2 border-b border-zinc-800 shrink-0">
        {[
          { k: "all",      label: "all",      n: all.length },
          { k: "accepted", label: "accepted", n: accepted },
          { k: "pending",  label: "pending",  n: pending },
          { k: "rejected", label: "rejected", n: rejected },
        ].map(({ k, label, n }) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-[8px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
              filter === k ? "bg-violet-900/40 border-violet-600 text-violet-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
            }`}>
            {label} {n}
          </button>
        ))}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && visible.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no proposals</div>}

      <div className="flex-1 overflow-y-auto">
        {visible.map(p => (
          <div key={p.id} className="px-3 py-2 border-b border-zinc-900/60 hover:bg-zinc-900/30">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-[7px] px-1 py-px rounded border ${STATUS_CLS[p.status] ?? "bg-zinc-800 border-zinc-700 text-zinc-400"}`}>
                {p.status}
              </span>
              <span className={`text-[7px] px-1 py-px rounded border ${KW_CLS[p.keyword] ?? "bg-zinc-800 border-zinc-700 text-zinc-400"}`}>
                {p.keyword}
              </span>
              <span className="text-zinc-600 text-[8px] ml-auto">{fmtAgo(p.ts)}</span>
            </div>
            <div className="text-zinc-300 text-[9px] leading-snug mb-0.5">{p.text}</div>
            <div className="flex gap-2 text-[8px] text-zinc-600">
              <span>{p.domain}</span>
              {p.goal_id && <span className="text-zinc-700">{p.goal_id.slice(0, 14)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
