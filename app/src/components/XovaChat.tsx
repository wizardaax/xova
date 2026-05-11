import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const INBOX_PATH  = "C:\\Xova\\memory\\xova_chat_inbox.json";
const OUTBOX_PATH = "C:\\Xova\\memory\\xova_chat_outbox.json";

interface ChatMsg { from: string; text: string; ts: number; correlation_id?: string; }

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fromCls(from: string) {
  if (from.toLowerCase().includes("jarvis")) return "bg-emerald-900/30 border-emerald-700 text-emerald-300";
  if (from.toLowerCase().includes("xova"))   return "bg-blue-900/30 border-blue-700 text-blue-300";
  return "bg-zinc-800 border-zinc-700 text-zinc-400";
}

function parseOne<T>(raw: string): T[] {
  try {
    const d = JSON.parse(raw);
    return Array.isArray(d) ? d as T[] : [d as T];
  } catch { return []; }
}

function MsgRow({ msg }: { msg: ChatMsg }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b border-zinc-900/50 hover:bg-zinc-900/20">
      <span className="text-zinc-600 text-[8px] shrink-0 w-16">{fmtTime(msg.ts)}</span>
      <span className={`text-[7px] px-1 py-px rounded border shrink-0 ${fromCls(msg.from)}`}>{msg.from}</span>
      <span className="text-zinc-300 text-[9px] leading-snug flex-1 line-clamp-2" title={msg.text}>{msg.text}</span>
    </div>
  );
}

export function XovaChat({ onClose }: { onClose: () => void }) {
  const [inbox,     setInbox]     = useState<ChatMsg[]>([]);
  const [outbox,    setOutbox]    = useState<ChatMsg[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await invoke<string>("xova_read_file", { path: INBOX_PATH });
      setInbox(parseOne<ChatMsg>(r));
    } catch { setInbox([]); }
    try {
      const r = await invoke<string>("xova_read_file", { path: OUTBOX_PATH });
      setOutbox(parseOne<ChatMsg>(r));
    } catch { setOutbox([]); }
    setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit' }));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 10_000); return () => clearInterval(id); }, [refresh]);

  const inSorted  = [...inbox].sort((a, b)  => b.ts - a.ts);
  const outSorted = [...outbox].sort((a, b) => b.ts - a.ts);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Xova Chat{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <span className="text-zinc-700 text-[8px]">in:{inbox.length} out:{outbox.length}</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && inbox.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-2 pb-1">
          <span className="text-[8px] uppercase text-zinc-600">inbox</span>
        </div>
        {inSorted.length === 0 && !loading
          ? <div className="px-3 py-1 text-zinc-700 text-[9px]">empty</div>
          : inSorted.slice(0, 20).map((m, i) => <MsgRow key={m.correlation_id ?? i} msg={m} />)
        }

        <div className="px-3 pt-3 pb-1 border-t border-zinc-900 mt-2">
          <span className="text-[8px] uppercase text-zinc-600">outbox</span>
        </div>
        {outSorted.length === 0 && !loading
          ? <div className="px-3 py-1 text-zinc-700 text-[9px]">empty</div>
          : outSorted.slice(0, 20).map((m, i) => <MsgRow key={m.correlation_id ?? i} msg={m} />)
        }
      </div>
    </div>
  );
}
