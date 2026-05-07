import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const OUTBOX_PATH = "C:\\Xova\\memory\\persona_outbox.jsonl";

interface OutboxEntry { ts: number; kind: string; text: string; }

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

const KIND_CLS: Record<string, string> = {
  synthesis: "bg-violet-900/40 text-violet-300 border-violet-700",
  chat:      "bg-blue-900/40 text-blue-300 border-blue-700",
  consult:   "bg-amber-900/40 text-amber-300 border-amber-700",
};

function parseJsonl(raw: string): OutboxEntry[] {
  return raw.split("\n").filter(l => l.trim()).map(l => {
    try { return JSON.parse(l) as OutboxEntry; } catch { return null; }
  }).filter(Boolean) as OutboxEntry[];
}

export function PersonaOutbox({ onClose }: { onClose: () => void }) {
  const [entries,   setEntries]   = useState<OutboxEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: OUTBOX_PATH });
      setEntries(parseJsonl(raw ?? "").reverse());
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { /**/ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  const kindCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1; return acc;
  }, {});

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Persona Outbox{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0 flex-wrap">
        <span className="text-zinc-600 text-[8px]">{entries.length} entries</span>
        {Object.entries(kindCounts).map(([kind, n]) => (
          <span key={kind} className={`text-[7px] px-1 py-px rounded border ${KIND_CLS[kind] ?? "bg-zinc-800 border-zinc-700 text-zinc-400"}`}>
            {kind} {n}
          </span>
        ))}
      </div>

      {loading && entries.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && entries.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-700">outbox empty</div>}

      <div className="flex-1 overflow-y-auto">
        {entries.map((e, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-1.5 border-b border-zinc-900/50 hover:bg-zinc-900/20">
            <span className="text-zinc-600 text-[8px] shrink-0 w-10">{fmtTime(e.ts)}</span>
            <span className={`text-[7px] px-1 py-px rounded border shrink-0 capitalize ${KIND_CLS[e.kind] ?? "bg-zinc-800 border-zinc-700 text-zinc-400"}`}>
              {e.kind}
            </span>
            <span className="text-zinc-300 text-[9px] leading-snug flex-1 truncate" title={e.text}>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
