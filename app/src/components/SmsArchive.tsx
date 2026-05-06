import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PATHS = [
  "C:\\Xova\\memory\\sms_archive.jsonl",
  "C:\\Xova\\memory\\sms\\archive.jsonl",
  "C:\\Xova\\memory\\phone\\sms.jsonl",
];

interface SmsEntry { id?: string; ts: number; from?: string; to?: string; body: string; direction?: "in" | "out" }

function fmtTs(ms: number) {
  const d = new Date(ms > 1e12 ? ms : ms * 1000);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SmsArchive({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<SmsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [foundPath, setFoundPath] = useState("");
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    for (const path of PATHS) {
      try {
        const raw = await invoke<string>("xova_read_file", { path });
        const parsed: SmsEntry[] = raw.split("\n").filter(Boolean).flatMap(l => {
          try { return [JSON.parse(l) as SmsEntry]; } catch { return []; }
        });
        setMsgs(parsed.slice(-300).reverse());
        setFoundPath(path);
        setLoading(false);
        return;
      } catch { /* try next */ }
    }
    setMsgs([]);
    setFoundPath("");
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const visible = filter.trim()
    ? msgs.filter(m => m.body?.toLowerCase().includes(filter.toLowerCase()) || m.from?.includes(filter) || m.to?.includes(filter))
    : msgs;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          SMS Archive ({msgs.length})
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      {!loading && msgs.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-zinc-500">No SMS archive found</span>
          <span className="text-zinc-600 text-[9px]">Expected at: C:\Xova\memory\sms_archive.jsonl</span>
          <span className="text-zinc-600 text-[9px]">Schema: {"{ ts, from, to, body, direction }"}</span>
        </div>
      )}

      {!loading && msgs.length > 0 && (
        <>
          <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter messages…"
              className="w-full bg-zinc-900 text-zinc-200 text-[10px] rounded px-2 py-1 border border-zinc-700 focus:outline-none placeholder-zinc-600" />
          </div>
          <div className="text-zinc-700 text-[8px] px-3 py-0.5 shrink-0">{foundPath}</div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {visible.map((m, i) => (
              <div key={m.id ?? i} className={`border rounded px-3 py-2 ${m.direction === "out" ? "border-emerald-900/50 bg-emerald-950/20 ml-6" : "border-zinc-800 bg-zinc-900 mr-6"}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[9px] text-zinc-500">{fmtTs(m.ts)}</span>
                  {(m.from || m.to) && (
                    <span className="text-[9px] text-zinc-400">{m.direction === "out" ? `→ ${m.to}` : `← ${m.from}`}</span>
                  )}
                </div>
                <div className="text-zinc-200 break-words">{m.body}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
