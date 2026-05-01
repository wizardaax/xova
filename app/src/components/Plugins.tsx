import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, ArrowClockwise, FileCode } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

interface PluginRow {
  entry: DirEntry;
  running: boolean;
  output: string | null;
  ok: boolean | null;
}

const PLUGINS_DIR = "C:\\Xova\\plugins";

export function Plugins({ pushTerminal }: { pushTerminal: (line: string) => void }) {
  const [rows, setRows] = useState<PluginRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await invoke<DirEntry[]>("list_dir", { path: PLUGINS_DIR });
      const py = entries
        .filter((e) => !e.isDir && e.name.toLowerCase().endsWith(".py"))
        .sort((a, b) => a.name.localeCompare(b.name));
      setRows((prev) => py.map((entry) => {
        const existing = prev.find((p) => p.entry.path === entry.path);
        return existing ?? { entry, running: false, output: null, ok: null };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Listen for "xova:plugin-installed" events so the panel auto-refreshes when
  // BuilderAdapter installs a new plugin via build_tool — no manual Refresh click.
  useEffect(() => {
    const onInstalled = () => { refresh(); };
    window.addEventListener("xova:plugin-installed", onInstalled);
    return () => window.removeEventListener("xova:plugin-installed", onInstalled);
  }, [refresh]);

  const runPlugin = useCallback(async (idx: number) => {
    const row = rows[idx];
    if (!row || row.running) return;
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, running: true, output: null, ok: null } : r));
    pushTerminal(`$ python ${row.entry.path}`);

    // 60s UI watchdog — if the plugin opens a matplotlib window or audio loop,
    // the process keeps running forever. Free the UI button + show a hint instead
    // of leaving the user staring at "Running..." indefinitely. Backend process
    // is unaffected (still alive, e.g. matplotlib window stays open).
    let watchdog: number | null = window.setTimeout(() => {
      setRows((prev) => prev.map((r, i) =>
        i === idx
          ? { ...r, running: false, output: "still running in background (likely interactive — window/audio plugin). UI freed.", ok: null }
          : r
      ));
      pushTerminal(`  ⏱ ${row.entry.name} still running after 60s — UI freed`);
      watchdog = null;
    }, 60_000);

    try {
      const output = await invoke<string>("run_command", {
        cmd: "python",
        args: [row.entry.path],
        cwd: PLUGINS_DIR,
      });
      if (watchdog !== null) {
        window.clearTimeout(watchdog);
        pushTerminal(`  → ${output.slice(0, 200).replace(/\n/g, " ")}`);
        setRows((prev) => prev.map((r, i) => i === idx ? { ...r, running: false, output, ok: true } : r));
      } else {
        // Watchdog already freed UI — append final result to terminal only.
        pushTerminal(`  → ${row.entry.name} (late) ${output.slice(0, 200).replace(/\n/g, " ")}`);
      }
    } catch (e) {
      if (watchdog !== null) window.clearTimeout(watchdog);
      const msg = e instanceof Error ? e.message : String(e);
      pushTerminal(`  ✗ ${msg}`);
      setRows((prev) => prev.map((r, i) => i === idx ? { ...r, running: false, output: msg, ok: false } : r));
    }
  }, [rows, pushTerminal]);

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <div className="pb-3 mb-3 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold text-zinc-100 font-mono uppercase tracking-wider">Plugins</h1>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{PLUGINS_DIR}</div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-zinc-300 text-xs font-mono rounded border border-zinc-800 hover:border-emerald-600 hover:text-emerald-400 flex items-center gap-1.5 transition-colors"
        >
          <ArrowClockwise size={14} weight="bold" className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div>
        {error && (
          <div className="mb-3 p-3 bg-red-950/40 border border-red-900 rounded text-xs text-red-300 font-mono">
            {error}
          </div>
        )}
        {!error && rows.length === 0 && !loading && (
          <div className="text-xs text-zinc-600 italic py-8 text-center font-mono">No .py files found in {PLUGINS_DIR}</div>
        )}
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={row.entry.path} className="border border-zinc-800 rounded p-3 bg-zinc-900">
              <div className="flex items-center gap-3">
                <FileCode size={20} weight="regular" className="text-zinc-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-100 truncate font-mono">{row.entry.name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">{(row.entry.size / 1024).toFixed(1)} KB</div>
                </div>
                <button
                  onClick={() => runPlugin(idx)}
                  disabled={row.running}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold font-mono rounded flex items-center gap-1.5 transition-colors",
                    row.running
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-emerald-600 text-white hover:bg-emerald-500"
                  )}
                >
                  <Play size={12} weight="fill" />
                  {row.running ? "Running..." : "Run"}
                </button>
              </div>
              {row.output !== null && (
                <pre className={cn(
                  "mt-2 p-2 text-[10px] leading-snug rounded font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto",
                  row.ok ? "bg-zinc-950 text-zinc-300 border border-zinc-800" : "bg-red-950/40 text-red-300 border border-red-900"
                )}>
                  {row.output.length > 0 ? row.output.slice(0, 4000) : "(no output)"}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
