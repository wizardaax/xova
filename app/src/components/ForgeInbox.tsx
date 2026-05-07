import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const INBOX_PATH  = "C:\\Xova\\memory\\forge_inbox.json";
const OUTBOX_PATH = "C:\\Xova\\memory\\forge_outbox.json";
const QUEUE_PATH  = "C:\\Xova\\memory\\forge_queue.json";
const HOOK_INBOX  = "C:\\Xova\\memory\\forge_hook_inbox.jsonl";
const HOOK_CURSOR = "C:\\Xova\\memory\\forge_hook_cursor.json";

interface ForgeMsg {
  intent: "ask" | "reply";
  from: string; to: string; text: string;
  correlation_id: string; ts: number;
}
interface HookMsg {
  ts: number;
  from?: string; content?: string; priority?: string;
  kind?: string; text?: string;
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
  const [hookMsgs, setHookMsgs] = useState<HookMsg[]>([]);
  const [hookCursor, setHookCursor] = useState<number>(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [tab, setTab]       = useState<"forge" | "hook">("hook");
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

    // Load hook inbox
    try {
      const raw = await invoke<string>("xova_read_file", { path: HOOK_INBOX });
      const msgs: HookMsg[] = raw.trim().split("\n").filter(Boolean).map(l => {
        try { return JSON.parse(l) as HookMsg; } catch { return null; }
      }).filter(Boolean) as HookMsg[];
      setHookMsgs(msgs.slice().reverse().slice(0, 30));
    } catch { setHookMsgs([]); }
    // Load hook cursor position
    try {
      const cursorRaw = await invoke<string>("xova_read_file", { path: HOOK_CURSOR });
      const c = JSON.parse(cursorRaw) as { pos?: number };
      setHookCursor(c.pos ?? 0);
    } catch { /* ok */ }

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
        <div className="flex gap-1 ml-auto">
          {(["hook", "forge"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-1.5 py-0.5 rounded border text-[8px] transition-colors ${
                tab === t ? "border-purple-600 text-purple-300 bg-purple-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}>
              {t === "hook" ? `hook (${hookMsgs.length})` : "forge"}
            </button>
          ))}
        </div>
        <button onClick={refresh} className="text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Hook inbox — forge_hook_inbox.jsonl */}
      {tab === "hook" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="flex items-center gap-2 px-1 py-0.5 text-[7px] text-zinc-600">
            <span>forge_hook_inbox.jsonl · agent → forge channel</span>
            <span className="ml-auto">cursor pos: {hookCursor}</span>
          </div>
          {hookMsgs.length === 0 && (
            <div className="text-zinc-600 text-[10px] text-center py-4">no hook messages</div>
          )}
          {hookMsgs.map((m, i) => {
            const sender = m.from ?? m.kind ?? "?";
            const body = m.content ?? m.text ?? "";
            const pri = m.priority ?? "";
            const priColor = pri === "critical" ? "#f87171" : pri === "high" ? "#fbbf24" : pri === "consult" || m.kind === "consult" ? "#a78bfa" : "#52525b";
            return (
              <div key={i} className="border-b border-zinc-900 py-1.5 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[7px]">
                  <span className="text-zinc-700">{fmtTs(m.ts)}</span>
                  <span className="font-mono" style={{ color: priColor }}>{sender}</span>
                  {pri && <span className="text-zinc-700">{pri}</span>}
                </div>
                <div className="text-[9px] text-zinc-300 leading-snug break-words">{body}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Forge structured inbox/outbox */}
      {tab === "forge" && (
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
      )}
    </div>
  );
}
