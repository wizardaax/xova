import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const INBOX_PATH = "C:\\Xova\\memory\\voice_inbox.json";

// voice_inbox.json can be a single object or array; field names vary by source
interface InboxMessage { id: string; role: "user" | "assistant" | "forge" | "xova"; ts: number; content: string }

function normalise(raw: unknown): InboxMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id ?? r.correlation_id ?? r.ts ?? Math.random()),
    role: (r.role as InboxMessage["role"]) ?? "assistant",
    ts: Number(r.ts ?? 0),
    content: String(r.content ?? r.text ?? r.message ?? ""),
  };
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function rolePill(role: InboxMessage["role"]) {
  switch (role) {
    case "user":      return "border-blue-700 text-blue-400 bg-blue-900/30";
    case "assistant": return "border-emerald-700 text-emerald-400 bg-emerald-900/30";
    case "forge":     return "border-purple-700 text-purple-400 bg-purple-900/30";
    case "xova":      return "border-emerald-700 text-emerald-400 bg-emerald-900/30";
    default:          return "border-zinc-700 text-zinc-400 bg-zinc-900/30";
  }
}

function rowBorderColor(role: InboxMessage["role"]) {
  switch (role) {
    case "user":      return "#3b82f6";
    case "assistant": return "#10b981";
    case "forge":     return "#a855f7";
    case "xova":      return "#10b981";
    default:          return "#52525b";
  }
}

export function VoiceInbox({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: INBOX_PATH });
      const parsed = JSON.parse(raw ?? "[]");
      const items = Array.isArray(parsed) ? parsed : [parsed];
      setMessages(items.map(normalise).filter(Boolean) as InboxMessage[]);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setError(null);
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5_000); return () => clearInterval(id); }, [refresh]);

  const handleClear = useCallback(async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setClearing(true); setConfirmClear(false);
    try {
      await invoke("xova_write_file", { path: INBOX_PATH, content: "[]" });
      setMessages([]);
    } catch (e) { setError(String(e)); }
    setClearing(false);
  }, [confirmClear]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Voice Inbox ({messages.length}){updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {confirmClear ? (
            <>
              <span className="text-[9px] text-amber-400">clear all?</span>
              <button onClick={handleClear} disabled={clearing}
                className="px-2 py-0.5 rounded border border-red-700 text-red-400 text-[9px] hover:bg-red-900/30 disabled:opacity-40">yes</button>
              <button onClick={() => setConfirmClear(false)}
                className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 text-[9px] hover:bg-zinc-800">no</button>
            </>
          ) : (
            <button onClick={handleClear} disabled={clearing || messages.length === 0}
              className="px-2 py-0.5 rounded border border-zinc-700 text-zinc-500 text-[9px] hover:border-red-800 hover:text-red-400 disabled:opacity-30">
              clear
            </button>
          )}
          <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      {error && <div className="px-3 py-1 bg-red-900/30 border-b border-red-900 text-red-400 text-[10px] shrink-0 truncate">{error}</div>}

      <div className="flex-1 overflow-y-auto">
        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-600">loading…</div>
        )}
        {!loading && messages.length === 0 && !error && (
          <div className="flex items-center justify-center h-full text-zinc-700">inbox empty</div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className="flex gap-2 px-3 py-2 border-b border-zinc-900/60 hover:bg-zinc-900/30"
            style={{ borderLeftWidth: 2, borderLeftColor: rowBorderColor(msg.role) }}>
            <span className="text-zinc-600 text-[9px] shrink-0 w-16 pt-0.5 tabular-nums">{fmtTime(msg.ts)}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 self-start ${rolePill(msg.role)}`}>{msg.role}</span>
            <span className="text-zinc-300 break-words leading-relaxed flex-1">{msg.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
