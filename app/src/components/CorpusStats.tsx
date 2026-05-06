import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Entry { ext: string; root: string }
interface IndexFile { generated_at_iso?: string; count: number; entries: Entry[] }

function tally(entries: Entry[], key: keyof Entry, n: number): [string, number][] {
  const map: Record<string, number> = {};
  for (const e of entries) map[e[key]] = (map[e[key]] ?? 0) + 1;
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function Bar({ label, count, max, isTop }: { label: string; count: number; max: number; isTop: boolean }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-24 text-[9px] text-zinc-400 truncate shrink-0 text-right">{label || "—"}</span>
      <div className="flex-1 h-3 bg-zinc-800 rounded-sm overflow-hidden">
        <div className={`h-full rounded-sm ${isTop ? "bg-emerald-500" : "bg-zinc-600"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-[9px] text-zinc-500 text-right shrink-0">{count.toLocaleString()}</span>
    </div>
  );
}

export function CorpusStats({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<IndexFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\corpus_index.json" });
      setData(JSON.parse(raw) as IndexFile);
    } catch { setData(null); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rebuild = async () => {
    setRebuilding(true); setRebuildMsg("");
    try {
      const res = await invoke<string>("xova_run", { command: `"C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe" "D:\\temp\\build_corpus_index.py"`, cwd: "C:\\Xova", elevated: false });
      let exit = 0;
      try { exit = JSON.parse(res).exit ?? 0; } catch { /* use raw */ }
      setRebuildMsg(exit === 0 ? "rebuilt ok" : `exit ${exit}`);
      await load();
    } catch { setRebuildMsg("error"); }
    setRebuilding(false);
  };

  const extRows  = data ? tally(data.entries, "ext", 10) : [];
  const rootRows = data ? tally(data.entries, "root", 8) : [];
  const extMax   = extRows[0]?.[1]  ?? 1;
  const rootMax  = rootRows[0]?.[1] ?? 1;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Corpus Stats{data ? ` — ${data.count.toLocaleString()} entries` : ""}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={load} className="text-zinc-600 hover:text-zinc-300">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>
      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && !data && <div className="flex-1 flex items-center justify-center text-zinc-600">corpus_index.json not found</div>}
      {!loading && data && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          <div className="flex items-center justify-between text-[9px] text-zinc-600">
            <span>updated: {data.generated_at_iso ?? "unknown"}</span>
            <div className="flex items-center gap-2">
              {rebuildMsg && <span className={rebuildMsg.includes("ok") ? "text-emerald-400" : "text-red-400"}>{rebuildMsg}</span>}
              <button onClick={rebuild} disabled={rebuilding}
                className="border border-zinc-700 px-2 py-0.5 rounded text-[9px] uppercase text-zinc-500 hover:text-emerald-400 hover:border-emerald-700 disabled:opacity-40">
                {rebuilding ? "rebuilding…" : "rebuild"}
              </button>
            </div>
          </div>
          <section>
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">by extension</div>
            {extRows.map(([label, count], i) => <Bar key={label} label={label} count={count} max={extMax} isTop={i === 0} />)}
          </section>
          <section>
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">by root</div>
            {rootRows.map(([label, count], i) => <Bar key={label} label={label} count={count} max={rootMax} isTop={i === 0} />)}
          </section>
        </div>
      )}
    </div>
  );
}
