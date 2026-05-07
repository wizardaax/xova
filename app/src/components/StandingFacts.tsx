import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const STANDING_PATH  = "C:\\Xova\\memory\\xova_standing_facts.json";
const SYNC_PATH      = "C:\\Xova\\memory\\xova_sync_facts.json";

interface SyncFacts {
  version?: number;
  synced_at?: string;
  source?: { jarvis_db?: string; jarvis_db_size?: number };
  user_facts?: string[];
  world_facts?: string[];
  directives?: string[];
}

function fmtSize(b?: number) {
  if (!b) return "";
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1_024).toFixed(0)} KB`;
}

export function StandingFacts({ onClose }: { onClose: () => void }) {
  const [standing,  setStanding]  = useState<string[]>([]);
  const [sync,      setSync]      = useState<SyncFacts | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [view,      setView]      = useState<"standing" | "user" | "world" | "directives">("standing");

  const refresh = useCallback(async () => {
    try {
      const r1 = await invoke<string>("xova_read_file", { path: STANDING_PATH });
      setStanding(JSON.parse(r1) as string[]);
    } catch { setStanding([]); }
    try {
      const r2 = await invoke<string>("xova_read_file", { path: SYNC_PATH });
      setSync(JSON.parse(r2) as SyncFacts);
    } catch { setSync(null); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const views: { k: typeof view; label: string; n: number }[] = [
    { k: "standing",   label: "standing",   n: standing.length },
    { k: "user",       label: "user",       n: sync?.user_facts?.length ?? 0 },
    { k: "world",      label: "world",      n: sync?.world_facts?.length ?? 0 },
    { k: "directives", label: "directives", n: sync?.directives?.length ?? 0 },
  ];

  const items: string[] =
    view === "standing"   ? standing :
    view === "user"       ? (sync?.user_facts ?? []) :
    view === "world"      ? (sync?.world_facts ?? []) :
    (sync?.directives ?? []);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Standing Facts</span>
        {sync?.synced_at && (
          <span className="text-zinc-700 text-[8px]">{sync.synced_at.slice(0, 10)}</span>
        )}
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {sync?.source?.jarvis_db_size !== undefined && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-zinc-800 shrink-0 text-[8px]">
          <span className="text-zinc-600">jarvis.db</span>
          <span className="text-zinc-400">{fmtSize(sync.source.jarvis_db_size)}</span>
        </div>
      )}

      <div className="flex gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        {views.map(({ k, label, n }) => (
          <button key={k} onClick={() => setView(k)}
            className={`text-[7px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
              view === k ? "bg-teal-900/40 border-teal-600 text-teal-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
            }`}>
            {label} {n}
          </button>
        ))}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {items.map((fact, i) => (
          <div key={i} className="border-l-2 border-zinc-700 pl-2 py-0.5">
            <span className="text-zinc-300 text-[9px] leading-snug">{fact}</span>
          </div>
        ))}
        {!loading && items.length === 0 && (
          <div className="text-zinc-600 text-[9px]">no {view} facts</div>
        )}
      </div>
    </div>
  );
}
