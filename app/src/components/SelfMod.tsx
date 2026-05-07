import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Proposal {
  id: string;
  file_path: string;
  description: string;
  proposer: string;
  created_at: number;
  sce88_coherence: number;
  sce88_pass: boolean;
  xova_approved: boolean;
  xova_reason?: string;
  status: "applied" | "pending" | "rejected";
  applied_at?: number;
}

interface SelfModData {
  version: number;
  proposals: Proposal[];
}

function fmtAgo(ts: number): string {
  const s = Math.round(Date.now() / 1000 - (ts > 1e10 ? ts / 1000 : ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function statusClasses(status: Proposal["status"]): string {
  if (status === "applied")
    return "bg-emerald-900/50 text-emerald-300 border-emerald-700";
  if (status === "pending")
    return "bg-amber-900/50 text-amber-300 border-amber-700";
  return "bg-red-900/50 text-red-300 border-red-700";
}

export function SelfMod({ onClose }: { onClose: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await invoke<string>("xova_read_file", {
        path: "C:\\Xova\\memory\\self_mod_proposals.json",
      });
      const data: SelfModData = JSON.parse(raw);
      setProposals(data.proposals ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const appliedCount = proposals.filter((p) => p.status === "applied").length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Self-Mod Proposals
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40"
        >
          ↻
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">
          ✕
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col">
          <span className="text-[8px] uppercase tracking-wider text-zinc-600">
            total
          </span>
          <span className="text-[11px] text-zinc-300">{proposals.length}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[8px] uppercase tracking-wider text-zinc-600">
            applied
          </span>
          <span className="text-[11px] text-emerald-400">{appliedCount}</span>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-600">
          loading…
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-red-600 px-3 text-center">
          {error}
        </div>
      ) : proposals.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-zinc-600">
          no proposals
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
          {proposals.map((p) => {
            const filename =
              p.file_path.split("\\").pop() ??
              p.file_path.split("/").pop() ??
              p.file_path;
            return (
              <div
                key={p.id}
                className="bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-2"
              >
                {/* Top row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Status badge */}
                  <span
                    className={`text-[8px] px-1 rounded border ${statusClasses(p.status)}`}
                  >
                    {p.status}
                  </span>

                  {/* Proposer badge */}
                  <span className="bg-violet-900/40 text-violet-300 border-violet-700 text-[8px] px-1 rounded border">
                    {p.proposer}
                  </span>

                  {/* Coherence */}
                  <span className="text-zinc-600 text-[8px]">
                    coh={p.sce88_coherence.toFixed(2)}
                  </span>

                  {/* SCE-88 fail badge */}
                  {!p.sce88_pass && (
                    <span className="text-[8px] px-1 rounded border bg-red-900/50 text-red-300 border-red-700">
                      ⚠ sce88 fail
                    </span>
                  )}

                  {/* Age — right-aligned */}
                  <span className="ml-auto text-zinc-700 text-[8px]">
                    {fmtAgo(p.created_at)}
                  </span>
                </div>

                {/* Description */}
                <p className="text-[9px] text-zinc-300 leading-snug mt-1">
                  {p.description}
                </p>

                {/* File path */}
                <p className="text-[8px] text-zinc-600 truncate mt-0.5">
                  {filename}
                </p>

                {/* Approval reason */}
                {p.xova_approved && p.xova_reason && (
                  <p className="text-[8px] text-zinc-500 italic mt-0.5">
                    {p.xova_reason}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
