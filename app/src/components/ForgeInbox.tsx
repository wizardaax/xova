import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const INBOX_PATH  = "C:\\Xova\\memory\\forge_inbox.json";
const OUTBOX_PATH = "C:\\Xova\\memory\\forge_outbox.json";
const QUEUE_PATH  = "C:\\Xova\\memory\\forge_queue.json";
const HOOK_INBOX  = "C:\\Xova\\memory\\forge_hook_inbox.jsonl";
const HOOK_CURSOR = "C:\\Xova\\memory\\forge_hook_cursor.json";
const EVENTS_PATH = "C:\\Xova\\memory\\forge_events.jsonl";

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
interface ForgeEvent {
  ts: number;
  kind: string;
  sce88_levels?: number[];
  note?: string;
  user_query?: string;
  risk?: number;
  answered?: boolean;
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
  const [events, setEvents]   = useState<ForgeEvent[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [tab, setTab]       = useState<"forge" | "hook" | "events">("hook");
  const [showOutbox, setShowOutbox] = useState(false);
  const [hookDraft, setHookDraft] = useState("");
  const [hookSending, setHookSending] = useState(false);

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

    // Load forge events (SCE-88 self-eval log)
    try {
      const rawEv = await invoke<string>("xova_read_file", { path: EVENTS_PATH });
      const evs: ForgeEvent[] = rawEv.trim().split("\n").filter(Boolean).map(l => {
        try { return JSON.parse(l) as ForgeEvent; } catch { return null; }
      }).filter(Boolean) as ForgeEvent[];
      setEvents(evs.slice().reverse().slice(0, 50));
    } catch { setEvents([]); }

    setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }, []);

  const postToHook = useCallback(async () => {
    const msg = hookDraft.trim();
    if (!msg || hookSending) return;
    setHookSending(true);
    try {
      let existing = "";
      try { existing = await invoke<string>("xova_read_file", { path: HOOK_INBOX }); } catch { /* new file */ }
      const entry = JSON.stringify({ ts: Date.now(), from: "adam", kind: "human", content: msg, priority: "normal" });
      const updated = existing ? existing.trimEnd() + "\n" + entry + "\n" : entry + "\n";
      await invoke("xova_write_file", { path: HOOK_INBOX, content: updated });
      setHookDraft("");
      await refresh();
    } catch { /* silent */ }
    setHookSending(false);
  }, [hookDraft, hookSending, refresh]);

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
          {(["hook", "events", "forge"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-1.5 py-0.5 rounded border text-[8px] transition-colors ${
                tab === t ? "border-purple-600 text-purple-300 bg-purple-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}>
              {t === "hook" ? `hook (${hookMsgs.length})` : t === "events" ? `events (${events.length})` : "forge"}
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

      {/* Hook send input — adam → forge channel */}
      {tab === "hook" && (
        <div className="border-t border-zinc-800 px-2 py-1.5 shrink-0 flex gap-1">
          <input
            value={hookDraft}
            onChange={e => setHookDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postToHook(); } }}
            placeholder="post to hook channel…"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[9px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-purple-600 min-w-0"
          />
          <button onClick={postToHook} disabled={hookSending || !hookDraft.trim()}
            className="px-2 py-1 rounded bg-purple-900/30 border border-purple-700 text-purple-300 text-[9px] hover:bg-purple-800/40 disabled:opacity-40 shrink-0">
            {hookSending ? "…" : "post"}
          </button>
        </div>
      )}

      {/* Forge events — forge_events.jsonl (SCE-88 self-eval log) */}
      {tab === "events" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="flex items-center gap-2 px-1 py-0.5 text-[7px] text-zinc-600">
            <span>forge_events.jsonl · SCE-88 self-eval pipeline</span>
          </div>
          {events.length === 0 && (
            <div className="text-zinc-600 text-[10px] text-center py-4">no events</div>
          )}
          {events.map((e, i) => {
            const kindColor = e.kind === "self-eval-flagged" ? "#f87171"
              : e.kind === "auto-correction" ? "#34d399"
              : "#71717a";
            const riskColor = (e.risk ?? 0) >= 4 ? "#f87171" : (e.risk ?? 0) >= 2 ? "#fbbf24" : "#52525b";
            return (
              <div key={i} className="border-b border-zinc-900 py-1.5 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[7px]">
                  <span className="text-zinc-700">{fmtTs(e.ts)}</span>
                  <span className="font-mono" style={{ color: kindColor }}>{e.kind}</span>
                  {e.risk !== undefined && (
                    <span className="font-bold" style={{ color: riskColor }}>r{e.risk}</span>
                  )}
                  {e.sce88_levels && e.sce88_levels.length > 0 && (
                    <span className="text-zinc-700">L{e.sce88_levels.join(",")}</span>
                  )}
                  {e.answered !== undefined && (
                    <span className={e.answered ? "text-emerald-700" : "text-red-800"}>
                      {e.answered ? "ans" : "blocked"}
                    </span>
                  )}
                </div>
                {e.user_query && (
                  <div className="text-[8px] text-zinc-500 truncate">q: {e.user_query}</div>
                )}
                {e.note && (
                  <div className="text-[9px] text-zinc-300 leading-snug break-words">{e.note}</div>
                )}
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
