import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const REPOS_DIR = "D:\\github\\wizardaax";

export function ScanPanel({ pushTerminal }: { pushTerminal: (l: string) => void }) {
  const [results, setResults] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  async function scan() {
    setRunning(true);
    setResults([]);
    const out: string[] = [];
    try {
      const repos = await invoke<string[]>("xova_list_repos");
      for (const repo of repos) {
        const path = REPOS_DIR + "\\" + repo;
        try {
          const status = await invoke<string>("run_command", { cmd: "git", args: ["status", "--short"], cwd: path });
          const changes = status.trim();
          const line = changes ? `⚠ ${repo}: ${changes.split("\n").length} uncommitted changes` : `✓ ${repo}: clean`;
          out.push(line);
          pushTerminal(line);
        } catch {
          out.push(`✗ ${repo}: scan failed`);
        }
      }
    } finally {
      setResults(out);
      setRunning(false);
    }
  }

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <div className="pb-3 mb-3 border-b border-zinc-800">
        <h1 className="text-sm font-bold text-zinc-100 font-mono uppercase tracking-wider">Scan</h1>
        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">Scan all repos for uncommitted changes</div>
      </div>
      <button onClick={scan} disabled={running}
        className="mb-4 h-10 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-mono font-semibold rounded transition-colors">
        {running ? "Scanning..." : "Scan All Repos"}
      </button>
      <div className="font-mono text-xs space-y-1">
        {results.length === 0 && !running && (
          <div className="text-zinc-600 italic">No scan run yet</div>
        )}
        {results.map((r, i) => (
          <div key={i} className={
            r.startsWith("✓") ? "text-emerald-400" :
            r.startsWith("⚠") ? "text-amber-400" :
            "text-red-400"
          }>{r}</div>
        ))}
      </div>
    </div>
  );
}
