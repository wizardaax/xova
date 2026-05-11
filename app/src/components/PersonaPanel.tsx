import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PERSONA_CMD   = `python "C:\\Xova\\plugins\\persona_governor.py"`;
const MEMORY_PATH   = "C:\\Xova\\memory\\persona_memory.json";
const OUTBOX_PATH   = "C:\\Xova\\memory\\persona_outbox.jsonl";

interface HistoryTurn { role: "user" | "assistant"; content: string; ts?: number; }
interface PersonaMemory {
  persona: string; model: string;
  history: HistoryTurn[];
  last_synthesis: string; synthesis_ts: number;
}
interface OutboxEntry { ts: number; kind: string; text: string; }

async function xovaRun(cmd: string): Promise<string> {
  const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
  try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) return w.stdout; } catch { /**/ }
  return raw;
}

function fmtTs(ts: number): string {
  const d = new Date(ts > 1e10 ? ts : ts * 1000);
  return d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtAgo(ts: number): string {
  const s = Math.round(Date.now() / 1000 - (ts > 1e10 ? ts / 1000 : ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function PersonaPanel({ onClose }: { onClose: () => void }) {
  const [memory,     setMemory]     = useState<PersonaMemory | null>(null);
  const [outbox,     setOutbox]     = useState<OutboxEntry[]>([]);
  const [synthesizing, setSynthesizing] = useState(false);
  const [chatMsg,    setChatMsg]    = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [lastResponse, setLastResponse] = useState("");
  const [updatedAt,  setUpdatedAt]  = useState("");
  const [view,       setView]       = useState<"status" | "history" | "outbox">("status");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: MEMORY_PATH });
      setMemory(JSON.parse(raw) as PersonaMemory);
      setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* ok */ }
    try {
      const raw = await invoke<string>("xova_read_file", { path: OUTBOX_PATH });
      const entries: OutboxEntry[] = raw.trim().split("\n").filter(Boolean).map(l => {
        try { return JSON.parse(l) as OutboxEntry; } catch { return null; }
      }).filter(Boolean) as OutboxEntry[];
      setOutbox(entries.slice().reverse().slice(0, 20));
    } catch { setOutbox([]); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8_000);
    return () => clearInterval(id);
  }, [refresh]);

  const synthesize = useCallback(async () => {
    setSynthesizing(true);
    try {
      const stdout = await xovaRun(`${PERSONA_CMD} --action synthesize`);
      const parsed = JSON.parse(stdout) as { ok: boolean; synthesis?: string };
      if (parsed.ok && parsed.synthesis) setLastResponse(parsed.synthesis);
      await refresh();
    } catch { /**/ }
    setSynthesizing(false);
  }, [refresh]);

  const sendChat = useCallback(async () => {
    const msg = chatMsg.trim();
    if (!msg) return;
    setChatSending(true);
    try {
      const stdout = await xovaRun(
        `${PERSONA_CMD} --action chat --message "${msg.replace(/"/g, '\\"')}"`
      );
      const parsed = JSON.parse(stdout) as { ok: boolean; response?: string };
      if (parsed.ok && parsed.response) setLastResponse(parsed.response);
      setChatMsg("");
      await refresh();
    } catch { /**/ }
    setChatSending(false);
  }, [chatMsg, refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Persona{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        {memory && (
          <span className="text-violet-400 text-[9px] font-mono">{memory.persona}</span>
        )}
        <div className="flex gap-1 ml-auto">
          {(["status", "history", "outbox"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-1.5 py-0.5 rounded border text-[8px] transition-colors ${
                view === v ? "border-violet-600 text-violet-300 bg-violet-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}>
              {v}
            </button>
          ))}
        </div>
        <button onClick={refresh} className="text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Status view */}
      {view === "status" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Meta */}
          {memory && (
            <div className="grid grid-cols-3 gap-1">
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[7px] text-zinc-500 mb-0.5">model</div>
                <div className="text-zinc-300 text-[8px] font-mono truncate">{memory.model}</div>
              </div>
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[7px] text-zinc-500 mb-0.5">turns</div>
                <div className="text-violet-300 font-bold text-[11px]">{Math.floor(memory.history.length / 2)}</div>
              </div>
              <div className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[7px] text-zinc-500 mb-0.5">last synth</div>
                <div className="text-zinc-400 text-[8px]">{memory.synthesis_ts ? fmtAgo(memory.synthesis_ts) : "—"}</div>
              </div>
            </div>
          )}

          {/* Synthesize */}
          <div className="bg-zinc-900 rounded p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-zinc-500 uppercase tracking-wider">last synthesis</span>
              <button onClick={synthesize} disabled={synthesizing}
                className="px-2 py-0.5 rounded border border-violet-700 text-violet-400 text-[8px] hover:bg-violet-900/30 disabled:opacity-40">
                {synthesizing ? "calling llama…" : "synthesize"}
              </button>
            </div>
            <div className="text-[9px] text-zinc-300 leading-snug min-h-[2em]">
              {lastResponse || memory?.last_synthesis || (
                <span className="text-zinc-600">no synthesis yet</span>
              )}
            </div>
            {memory?.synthesis_ts ? (
              <div className="text-zinc-700 text-[7px]">{fmtTs(memory.synthesis_ts)}</div>
            ) : null}
          </div>

          {/* Fleet context */}
          {memory && (
            <div className="bg-zinc-900 rounded p-2">
              <div className="text-[8px] text-zinc-500 uppercase tracking-wider mb-1">live fleet context</div>
              <div className="text-[8px] text-zinc-400 leading-relaxed whitespace-pre-wrap break-words">
                {/* We show what the governor would use — derived from the same files */}
                <span className="text-zinc-600">[synthesis uses goal_store, swarm_dispatch, self_eval strategies, agent_board, mesh_feed]</span>
              </div>
            </div>
          )}

          <div className="text-zinc-700 text-[7px] text-center">
            Ollama shared lock — synthesize/chat may take 30-90s if Jarvis is active
          </div>
        </div>
      )}

      {/* History view */}
      {view === "history" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {!memory || memory.history.length === 0 ? (
            <div className="text-zinc-600 text-[10px] text-center py-4">no conversation history</div>
          ) : (
            memory.history.slice().reverse().map((turn, i) => (
              <div key={i} className={`rounded p-2 text-[9px] leading-snug ${
                turn.role === "user" ? "bg-zinc-900/60 border border-zinc-800" : "bg-violet-950/20 border border-violet-800/40"
              }`}>
                <div className={`text-[7px] mb-0.5 ${turn.role === "user" ? "text-zinc-500" : "text-violet-500"}`}>
                  {turn.role === "user" ? "adam" : "xova"}
                  {turn.ts ? ` · ${fmtTs(turn.ts)}` : ""}
                </div>
                <div className={turn.role === "user" ? "text-zinc-300" : "text-violet-200"}>{turn.content}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Outbox view */}
      {view === "outbox" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {outbox.length === 0 ? (
            <div className="text-zinc-600 text-[10px] text-center py-4">no outbox entries</div>
          ) : (
            outbox.map((e, i) => (
              <div key={i} className="border-b border-zinc-900 py-1.5 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[7px]">
                  <span className="text-zinc-700">{fmtTs(e.ts)}</span>
                  <span className={`px-1 rounded ${e.kind === "synthesis" ? "text-violet-400 bg-violet-900/20" : "text-teal-400 bg-teal-900/20"}`}>{e.kind}</span>
                </div>
                <div className="text-[9px] text-zinc-300 leading-snug whitespace-pre-wrap break-words">{e.text}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Chat input */}
      <div className="border-t border-zinc-800 p-2 shrink-0 space-y-1">
        {lastResponse && view === "status" && (
          <div className="text-[8px] text-violet-300 truncate">✓ {lastResponse.slice(0, 80)}…</div>
        )}
        <div className="flex gap-1">
          <input
            value={chatMsg}
            onChange={e => setChatMsg(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            placeholder="ask xova about the fleet…"
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-violet-600 min-w-0"
          />
          <button onClick={sendChat} disabled={chatSending || !chatMsg.trim()}
            className="px-2 py-1 rounded bg-violet-900/40 border border-violet-700 text-violet-300 text-[10px] hover:bg-violet-800/40 disabled:opacity-40 shrink-0">
            {chatSending ? "…" : "ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
