import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const REPOS: { label: string; path: string }[] = [
  { label: "recursive-field-math-pro",       path: "D:\\github\\wizardaax\\recursive-field-math-pro" },
  { label: "Snell-Vern-Hybrid-Drive-Matrix",  path: "D:\\github\\wizardaax\\Snell-Vern-Hybrid-Drive-Matrix" },
  { label: "ziltrix-sch-core",               path: "D:\\github\\wizardaax\\ziltrix-sch-core" },
  { label: "Xova",                           path: "C:\\Xova" },
];

interface Commit { hash: string; date: string; author: string; msg: string }

function parseGitLog(output: string): Commit[] {
  return output.split("\n").filter(Boolean).map(line => {
    const parts = line.split("\x1f");
    if (parts.length < 4) return null;
    return { hash: parts[0], date: parts[1], author: parts[2], msg: parts[3] };
  }).filter(Boolean) as Commit[];
}

export function GitLog({ onClose }: { onClose: () => void }) {
  const [repoIdx, setRepoIdx] = useState(0);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (idx: number) => {
    setRepoIdx(idx);
    setLoading(true); setError(null); setCommits([]);
    const repo = REPOS[idx];
    try {
      const fmt = "%H\x1f%ad\x1f%an\x1f%s";
      const raw = await invoke<string>("xova_run", {
        command: `git log --date=short --format="${fmt}" -40`,
        cwd: repo.path,
        elevated: false,
      });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string; stderr?: string; exit?: number }; stdout = w.stdout ?? ""; if (w.exit !== 0) { setError(`exit ${w.exit}: ${w.stderr?.slice(0, 200)}`); setLoading(false); return; } } catch { /* raw */ }
      setCommits(parseGitLog(stdout));
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  const repo = REPOS[repoIdx];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Git Log</span>
        <button onClick={onClose} className="ml-auto text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="px-3 py-2 border-b border-zinc-800 flex flex-wrap gap-1 shrink-0">
        {REPOS.map((r, i) => (
          <button key={r.label} onClick={() => load(i)}
            className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${i === repoIdx ? "border-emerald-700 text-emerald-400 bg-emerald-900/20" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
            {r.label.split("-").slice(0, 2).join("-")}
          </button>
        ))}
      </div>

      {!loading && commits.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-zinc-600">
          <span className="text-xl">⎇</span>
          <span className="text-[10px]">select a repo above</span>
        </div>
      )}
      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {error && (
        <div className="p-3">
          <div className="bg-red-950/30 border border-red-800 rounded p-2 text-red-400 text-[10px] break-all">{error}</div>
        </div>
      )}

      {commits.length > 0 && (
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-900/50">
          <div className="px-3 py-1 text-[9px] text-zinc-600 shrink-0 sticky top-0 bg-zinc-950 border-b border-zinc-900">
            {repo.label} · {commits.length} commits
          </div>
          {commits.map(c => (
            <div key={c.hash} className="px-3 py-1.5 hover:bg-zinc-900/30">
              <div className="flex items-center gap-2">
                <span className="text-zinc-600 text-[9px] font-mono shrink-0">{c.hash.slice(0, 7)}</span>
                <span className="text-zinc-500 text-[9px] shrink-0">{c.date}</span>
                <span className="text-zinc-600 text-[9px] truncate">{c.author}</span>
              </div>
              <div className="text-zinc-300 text-[10px] mt-0.5 leading-relaxed">{c.msg}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
