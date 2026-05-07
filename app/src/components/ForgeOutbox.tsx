import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const OUTBOX_PATH = "C:\\Xova\\memory\\forge_outbox.json";

interface OutboxMsg {
  intent?: string;
  from?: string;
  to?: string;
  text?: string;
  ts?: number;
  correlation_id?: string;
}

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

const TO_CLS: Record<string, string> = {
  xova:   "bg-blue-900/40 text-blue-300 border-blue-700",
  jarvis: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
};

export function ForgeOutbox({ onClose }: { onClose: () => void }) {
  const [msgs,    setMsgs]    = useState<OutboxMsg[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: OUTBOX_PATH });
      const d = JSON.parse(raw);
      setMsgs(Array.isArray(d) ? d : []);
    } catch { setMsgs([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 15_000); return () => clearInterval(id); }, [refresh]);

  const targets = [...new Set(msgs.map(m => m.to ?? "?"))];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Forge Outbox</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">messages</span>
          <span className="text-zinc-200">{msgs.length}</span>
        </div>
        {targets.map(t => (
          <div key={t} className="flex flex-col gap-0.5">
            <span className="text-[9px] text-zinc-600 uppercase">→{t}</span>
            <span className="text-zinc-200">{msgs.filter(m => m.to === t).length}</span>
          </div>
        ))}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && msgs.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">outbox empty</div>}

      <div className="flex-1 overflow-y-auto">
        {[...msgs].reverse().map((m, i) => (
          <div key={i} className="px-3 py-1.5 border-b border-zinc-900/50 hover:bg-zinc-900/20">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-zinc-600 text-[8px] shrink-0">{m.ts ? fmtTime(m.ts) : "—"}</span>
              {m.to && (
                <span className={`text-[7px] px-1 py-px rounded border ${TO_CLS[m.to] ?? "bg-zinc-800 border-zinc-700 text-zinc-400"}`}>
                  →{m.to}
                </span>
              )}
              {m.intent && <span className="text-zinc-600 text-[8px]">{m.intent}</span>}
              {m.correlation_id && (
                <span className="text-zinc-700 text-[7px] ml-auto truncate max-w-[100px]">{m.correlation_id}</span>
              )}
              {m.ts && <span className="text-zinc-700 text-[7px] shrink-0">{fmtAgo(m.ts)}</span>}
            </div>
            <div className="text-zinc-400 text-[9px] truncate">{m.text ?? ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
