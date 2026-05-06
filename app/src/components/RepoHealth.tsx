import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface RepoInfo { name: string; branch: string; dirty: boolean; uncommitted: number; last_commit: string }
interface Props { onClose: () => void }

const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const SCRIPT = "C:\\Xova\\plugins\\repo_health.py";

export function RepoHealth({ onClose }: Props) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const raw = await invoke<string>("xova_run", { command: `"${PYTHON}" "${SCRIPT}"`, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      setRepos(JSON.parse(stdout) as RepoInfo[]);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  const dirty = repos.filter(r => r.dirty).length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-xs p-2">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          {repos.length} repos · {dirty} dirty{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto px-2 py-0.5 rounded text-[10px] border border-zinc-700 bg-zinc-900 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-40">
          {loading ? "…" : "↻"}
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {error && <div className="text-red-400 text-[10px] bg-red-950/30 border border-red-800 rounded p-2 mb-2">{error}</div>}
      {loading && repos.length === 0 && <div className="text-zinc-600 text-center mt-8">scanning repos…</div>}

      <div className="flex flex-col gap-1 overflow-y-auto">
        {repos.map(r => (
          <div key={r.name} className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={r.dirty ? "font-bold text-zinc-100" : "text-zinc-300"}>{r.name}</span>
              <span className="text-[10px] text-zinc-600">{r.branch}</span>
              <span className="ml-auto">{r.dirty ? "🔴" : "🟢"}</span>
              {r.dirty && <span className="text-[10px] text-amber-400">{r.uncommitted} unstaged</span>}
            </div>
            <div className="text-[10px] text-zinc-600 truncate mt-0.5">
              {r.last_commit.length > 70 ? r.last_commit.slice(0, 70) + "…" : r.last_commit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
