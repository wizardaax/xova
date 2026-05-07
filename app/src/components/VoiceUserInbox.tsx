import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const INBOX_PATH = "C:\\Xova\\memory\\voice_user_inbox.json";

interface VoiceMessage { role?: string; text?: string; ts?: number; }

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString([], {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function VoiceUserInbox({ onClose }: { onClose: () => void }) {
  const [msg,     setMsg]     = useState<VoiceMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: INBOX_PATH });
      setMsg(JSON.parse(raw) as VoiceMessage);
      setErr("");
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  const words = msg?.text?.trim().split(/\s+/).length ?? 0;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Voice Inbox</span>
        <span className="text-zinc-700 text-[8px]">last transcription</span>
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && err && <div className="flex-1 flex items-center justify-center text-red-400 text-[9px] px-4 text-center">{err}</div>}
      {!loading && !err && !msg && <div className="flex-1 flex items-center justify-center text-zinc-600">no message</div>}

      {msg && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <div className="flex items-center gap-2">
            {msg.role && (
              <span className="text-[8px] px-1.5 py-0.5 rounded border bg-violet-900/40 border-violet-700 text-violet-300">
                {msg.role}
              </span>
            )}
            {msg.ts && (
              <span className="text-zinc-500 text-[9px]">{fmtTime(msg.ts)}</span>
            )}
            {msg.ts && (
              <span className="text-zinc-700 text-[8px] ml-auto">{fmtAgo(msg.ts)}</span>
            )}
          </div>

          <div className="border border-zinc-800 rounded p-2.5 bg-zinc-900/30">
            <p className="text-zinc-200 text-[10px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
          </div>

          <div className="text-zinc-600 text-[8px]">{words} words</div>
        </div>
      )}
    </div>
  );
}
