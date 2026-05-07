import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const SESSION_PATH = "C:\\Xova\\memory\\session.json";

interface Message { id?: string; role: string; ts?: number; text: string; }
interface SessionData { messages?: Message[]; }

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export function SessionViewer({ onClose }: { onClose: () => void }) {
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<"all" | "user" | "xova">("all");
  const [search,     setSearch]     = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: SESSION_PATH });
      const d = JSON.parse(raw) as SessionData;
      setMessages(d.messages ?? []);
    } catch { /* ok */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 10_000); return () => clearInterval(id); }, [refresh]);

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  const roleCount = messages.reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1;
    return acc;
  }, {});

  const q = search.toLowerCase();
  const visible = messages
    .filter(m => filter === "all" || m.role === filter)
    .filter(m => !q || m.text.toLowerCase().includes(q));

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Session</span>
        <span className="text-zinc-700 text-[8px]">{messages.length} msgs</span>
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        {(["all", "user", "xova"] as const).map(r => (
          <button key={r} onClick={() => setFilter(r)}
            className={`text-[7px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
              filter === r
                ? r === "user" ? "bg-violet-900/40 border-violet-600 text-violet-300"
                  : r === "xova" ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
                  : "bg-zinc-700 border-zinc-500 text-zinc-200"
                : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
            }`}>
            {r} {r === "all" ? messages.length : (roleCount[r] ?? 0)}
          </button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="search…"
          className="ml-2 flex-1 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-[9px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-500"
        />
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {visible.map((m, i) => {
          const isUser = m.role === "user";
          return (
            <div key={m.id ?? i} className={`flex gap-2 ${isUser ? "" : "flex-row-reverse"}`}>
              <div className={`text-[7px] px-1 py-px rounded border shrink-0 self-start mt-0.5 ${
                isUser ? "bg-violet-900/30 border-violet-800 text-violet-400"
                       : "bg-emerald-900/30 border-emerald-800 text-emerald-400"
              }`}>
                {isUser ? "you" : "xova"}
              </div>
              <div className={`flex-1 max-w-[85%] ${isUser ? "" : "text-right"}`}>
                <div className={`inline-block text-left rounded px-2 py-1.5 text-[9px] leading-relaxed ${
                  isUser ? "bg-zinc-900 text-zinc-200" : "bg-zinc-800/60 text-zinc-300"
                }`}>
                  {m.text}
                </div>
                {m.ts && <div className="text-zinc-700 text-[7px] mt-0.5">{fmtTime(m.ts)}</div>}
              </div>
            </div>
          );
        })}
        {!loading && visible.length === 0 && (
          <div className="text-zinc-600 text-[9px] text-center pt-4">no messages</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
