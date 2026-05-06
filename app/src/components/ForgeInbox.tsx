import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const INBOX_PATH  = "C:\\Xova\\memory\\forge_inbox.json";
const OUTBOX_PATH = "C:\\Xova\\memory\\forge_outbox.json";
const QUEUE_PATH  = "C:\\Xova\\memory\\forge_queue.json";

interface ForgeMsg {
  intent: "ask" | "reply";
  from: string; to: string; text: string;
  correlation_id: string; ts: number;
}

function fmtTs(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function MsgCard({ msg, accent }: { msg: ForgeMsg; accent: string }) {
  return (
    <div className={`border rounded px-3 py-2 bg-zinc-900 border-zinc-700`} style={{ borderLeftColor: accent, borderLeftWidth: 2 }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[9px] font-bold" style={{ color: accent }}>{msg.from}</span>
        <span className="text-zinc-600 text-[9px]">→</span>
        <span className="text-zinc-400 text-[9px]">{msg.to}</span>
        <span className="text-zinc-600 text-[9px] ml-auto">{fmtTs(msg.ts)}</span>
      </div>
      <div className="text-zinc-200 text-[11px] break-words">{msg.text}</div>
      <div className="text-zinc-700 text-[8px] mt-0.5 font-mono truncate">{msg.correlation_id}</div>
    </div>
  );
}

export function ForgeInbox({ onClose }: { onClose: () => void }) {
  const [inbox, setInbox]   = useState<ForgeMsg | null>(null);
  const [outbox, setOutbox] = useState<ForgeMsg[]>([]);
  const [queueLen, setQueueLen] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [showOutbox, setShowOutbox] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rawIn = await invoke<string>("xova_read_file", { path: INBOX_PATH });
      try { setInbox(JSON.parse(rawIn) as ForgeMsg); } catch { setInbox(null); }
    } catch { setInbox(null); }

    try {
      const rawOut = await invoke<string>("xova_read_file", { path: OUTBOX_PATH });
      try {
        const arr = JSON.parse(rawOut);
        setOutbox(Array.isArray(arr) ? (arr as ForgeMsg[]).slice().reverse() : []);
      } catch { setOutbox([]); }
    } catch { setOutbox([]); }

    try {
      const rawQ = await invoke<string>("xova_read_file", { path: QUEUE_PATH });
      try {
        const arr = JSON.parse(rawQ);
        setQueueLen(Array.isArray(arr) ? arr.length : 0);
      } catch { setQueueLen(0); }
    } catch { setQueueLen(0); }

    setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Forge Inbox{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        {queueLen > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-700 text-purple-300">
            queue: {queueLen}
          </span>
        )}
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">inbox (current)</div>
          {inbox ? (
            <MsgCard msg={inbox} accent="#a78bfa" />
          ) : (
            <div className="text-zinc-600 text-[10px] px-2">empty</div>
          )}
        </div>

        <div>
          <button
            onClick={() => setShowOutbox(v => !v)}
            className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1 w-full text-left hover:text-zinc-400 flex items-center gap-1"
          >
            outbox ({outbox.length}) {showOutbox ? "▲" : "▼"}
          </button>
          {showOutbox && (
            <div className="space-y-1">
              {outbox.length === 0 && <div className="text-zinc-600 text-[10px] px-2">empty</div>}
              {outbox.slice(0, 20).map((m, i) => (
                <MsgCard key={m.correlation_id ?? i} msg={m} accent="#34d399" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
