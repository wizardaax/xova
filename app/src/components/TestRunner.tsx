import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";

const REPOS = [
  { label: "recursive-field-math-pro", path: "D:\\github\\wizardaax\\recursive-field-math-pro" },
  { label: "Snell-Vern-Hybrid-Drive-Matrix", path: "D:\\github\\wizardaax\\Snell-Vern-Hybrid-Drive-Matrix" },
  { label: "ziltrix-sch-core", path: "D:\\github\\wizardaax\\ziltrix-sch-core" },
];

interface RunResult { label: string; exit: number; output: string; passed: number; failed: number; errors: number }

function parseCount(output: string, word: string): number {
  const m = output.match(new RegExp(`(\\d+)\\s+${word}`));
  return m ? parseInt(m[1], 10) : 0;
}

export function TestRunner({ onClose }: { onClose: () => void }) {
  const [results, setResults] = useState<RunResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const runRepo = useCallback(async (label: string, path: string) => {
    setRunning(label);
    const startTime = Date.now();
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PY}" -m pytest "${path}" -x --tb=short -q --no-header`,
        cwd: path,
        elevated: false,
      });
      let stdout = raw, exit = 0;
      try {
        const w = JSON.parse(raw) as { stdout?: string; stderr?: string; exit?: number };
        stdout = (w.stdout ?? "") + (w.stderr ? `\n${w.stderr}` : "");
        exit = w.exit ?? 0;
      } catch { /* raw */ }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const passed = parseCount(stdout, "passed");
      const failed = parseCount(stdout, "failed");
      const errors = parseCount(stdout, "error");
      setResults(prev => {
        const filtered = prev.filter(r => r.label !== label);
        return [{ label, exit, output: `[${elapsed}s]\n${stdout}`, passed, failed, errors }, ...filtered];
      });
    } catch (e) {
      setResults(prev => {
        const filtered = prev.filter(r => r.label !== label);
        return [{ label, exit: 1, output: String(e), passed: 0, failed: 0, errors: 1 }, ...filtered];
      });
    }
    setRunning(null);
  }, []);

  const runAll = useCallback(async () => {
    for (const repo of REPOS) {
      await runRepo(repo.label, repo.path);
    }
  }, [runRepo]);

  const getResult = (label: string) => results.find(r => r.label === label);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Test Runner</span>
        <button
          onClick={runAll}
          disabled={running !== null}
          className="ml-auto px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40 text-[9px] uppercase"
        >
          {running ? "running…" : "Run All"}
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {REPOS.map(repo => {
          const res = getResult(repo.label);
          const isRunning = running === repo.label;
          const open = expanded === repo.label;
          const short = repo.label.split("-").slice(0, 2).join("-");

          return (
            <div key={repo.label} className="border border-zinc-800 rounded bg-zinc-900">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-zinc-300 truncate flex-1 text-[10px]" title={repo.label}>{short}</span>

                {res && !isRunning && (
                  <div className="flex items-center gap-1 shrink-0">
                    {res.passed > 0 && <span className="text-[9px] text-emerald-400">{res.passed}✓</span>}
                    {res.failed > 0 && <span className="text-[9px] text-red-400">{res.failed}✗</span>}
                    {res.errors > 0 && <span className="text-[9px] text-orange-400">{res.errors}!</span>}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${res.exit === 0 ? "text-emerald-300 border-emerald-700 bg-emerald-900/30" : "text-red-300 border-red-700 bg-red-900/30"}`}>
                      {res.exit === 0 ? "PASS" : "FAIL"}
                    </span>
                    <button onClick={() => setExpanded(open ? null : repo.label)}
                      className="text-zinc-600 hover:text-zinc-300 text-[9px]">{open ? "▲" : "▼"}</button>
                  </div>
                )}

                {isRunning && <span className="text-amber-400 text-[9px] animate-pulse">running…</span>}

                <button
                  onClick={() => runRepo(repo.label, repo.path)}
                  disabled={running !== null}
                  className="w-6 h-6 rounded border border-zinc-700 bg-zinc-800 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40 flex items-center justify-center text-[10px] shrink-0"
                  title="Run tests"
                >
                  ▶
                </button>
              </div>

              {open && res && (
                <pre className="px-3 pb-2 text-[9px] text-zinc-400 bg-zinc-950 rounded-b overflow-x-auto whitespace-pre-wrap break-words max-h-48 border-t border-zinc-800">
                  {res.output}
                </pre>
              )}
            </div>
          );
        })}

        {results.length === 0 && running === null && (
          <div className="text-zinc-600 text-[10px] text-center pt-4">Click ▶ to run tests for a repo</div>
        )}
      </div>
    </div>
  );
}
