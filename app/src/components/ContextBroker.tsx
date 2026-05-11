import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY          = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN      = "C:\\Xova\\plugins\\context_broker.py";
const CWD         = "C:\\Xova";
const BROKER_PATH = "C:\\Xova\\memory\\context_broker.json";

type AgentId = "forge" | "jarvis" | "mesh" | "xova" | string;

interface Slot {
  agent: AgentId;
  value: unknown;
  ts: number;
  ttl: number;
  tags: string[];
}
interface SnapResult { ok: boolean; slots?: Record<string, Slot>; count?: number; error?: string; }
interface IdeaValue { title?: string; what?: string; gap?: string; idea?: string; status?: string; note?: string; resolved_at?: number; file?: string; files?: string[]; source?: string; stores?: string[]; clients?: string[]; repos?: string[]; }
interface AuditValue { title?: string; items?: string[]; source?: string; }

const AGENTS: AgentId[] = ["forge", "jarvis", "mesh", "xova"];
const AGENT_COLOR: Record<string, string> = {
  forge:  "bg-amber-900/50 text-amber-300 border-amber-700",
  jarvis: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  mesh:   "bg-cyan-900/50 text-cyan-300 border-cyan-700",
  xova:   "bg-blue-900/50 text-blue-300 border-blue-700",
};
function agentCls(a: string) { return AGENT_COLOR[a] ?? "bg-zinc-800/50 text-zinc-400 border-zinc-600"; }
function fmtTs(ts: number) {
  if (!ts || isNaN(ts)) return "—";
  const d = new Date((ts > 1e12 ? ts : ts * 1000));
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}
function valueFull(v: unknown) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); }
}
function valuePreview(v: unknown) {
  const s = valueFull(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

async function runPlugin(args: string): Promise<SnapResult> {
  const raw = await invoke<string>("xova_run", {
    command: `${PY} ${PLUGIN} ${args}`, cwd: CWD, elevated: false,
  });
  let text = raw;
  try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout) text = w.stdout; } catch { /**/ }
  return JSON.parse(text) as SnapResult;
}

function parseIdea(v: unknown): IdeaValue {
  if (typeof v === "string") { try { return JSON.parse(v) as IdeaValue; } catch { return {}; } }
  return (v ?? {}) as IdeaValue;
}

function tagCls(t: string): string {
  if (t === "critical") return "bg-red-900/50 border-red-700 text-red-300";
  if (t === "unbuilt") return "bg-amber-900/40 border-amber-700 text-amber-300";
  if (t === "architecture") return "bg-cyan-900/40 border-cyan-700 text-cyan-300";
  if (t === "ui") return "bg-blue-900/40 border-blue-700 text-blue-300";
  return "bg-zinc-800 border-zinc-700 text-zinc-500";
}

function IdeasView({ directSlots }: { directSlots: Record<string, Slot> }) {
  const ideaKeys = Object.keys(directSlots).filter(k => k.startsWith("ideas.")).sort();
  const resolved = ideaKeys.filter(k => parseIdea(directSlots[k].value).status === "resolved");
  const open     = ideaKeys.filter(k => parseIdea(directSlots[k].value).status !== "resolved");
  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
      <div>
        <div className="text-[7px] uppercase tracking-wider text-zinc-600 px-1 mb-1">open ({open.length})</div>
        <div className="space-y-1.5">
          {open.map(k => {
            const idea = parseIdea(directSlots[k].value);
            const tags = directSlots[k].tags ?? [];
            return (
              <div key={k} className="bg-zinc-900/60 border border-zinc-800 rounded px-2.5 py-2">
                <div className="flex items-start gap-2 mb-1">
                  <span className="text-zinc-200 text-[10px] font-semibold leading-snug flex-1">{idea.title ?? k.replace("ideas.", "")}</span>
                </div>
                {tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap mb-1.5">
                    {tags.map(t => <span key={t} className={"text-[7px] px-1 py-px rounded border " + tagCls(t)}>{t}</span>)}
                  </div>
                )}
                {idea.what && <div className="text-[9px] text-zinc-500 leading-snug mb-1"><span className="text-zinc-600 uppercase text-[7px] mr-1">what</span>{idea.what}</div>}
                {idea.gap  && <div className="text-[9px] text-amber-400/80 leading-snug mb-1"><span className="text-zinc-600 uppercase text-[7px] mr-1">gap</span>{idea.gap}</div>}
                {idea.idea && <div className="text-[9px] text-emerald-400/80 leading-snug"><span className="text-zinc-600 uppercase text-[7px] mr-1">idea</span>{idea.idea}</div>}
              </div>
            );
          })}
        </div>
      </div>
      {resolved.length > 0 && (
        <div>
          <div className="text-[7px] uppercase tracking-wider text-zinc-600 px-1 mb-1">resolved ({resolved.length})</div>
          <div className="space-y-1">
            {resolved.map(k => {
              const idea = parseIdea(directSlots[k].value);
              return (
                <div key={k} className="bg-zinc-900/40 border border-zinc-800/60 rounded px-2.5 py-1.5 opacity-60">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-500 text-[9px]">✓</span>
                    <span className="text-zinc-400 text-[9px]">{k.replace("ideas.", "")}</span>
                  </div>
                  {idea.note && <div className="text-zinc-600 text-[8px] leading-snug mt-0.5 truncate">{idea.note}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditView({ directSlots }: { directSlots: Record<string, Slot> }) {
  const auditSlot = directSlots["audit.open_items"];
  let auditVal: AuditValue = {};
  if (auditSlot) {
    const v = auditSlot.value;
    if (typeof v === "string") { try { auditVal = JSON.parse(v) as AuditValue; } catch { /**/ } }
    else auditVal = (v ?? {}) as AuditValue;
  }
  const items = auditVal.items ?? [];
  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
      <div className="text-[8px] text-zinc-600 px-1 pb-1">
        Open audit findings · {items.length} items
        {auditVal.source && <span className="ml-2 text-zinc-700">{auditVal.source}</span>}
      </div>
      {items.length === 0 && <div className="text-zinc-600 text-[10px] text-center py-4">no items</div>}
      {items.map((item, i) => {
        const parts = item.split(": ");
        const isAudit = parts.length > 1 && parts[0].startsWith("AUDIT-");
        const id   = isAudit ? parts[0] : "";
        const desc = isAudit ? parts.slice(1).join(": ") : item;
        return (
          <div key={i} className="flex items-start gap-2 border-b border-zinc-900 py-1.5 px-1">
            {id && <span className="text-amber-400 text-[8px] shrink-0 font-mono">{id}</span>}
            <span className="text-zinc-300 text-[9px] leading-snug">{desc}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ContextBroker({ onClose }: { onClose: () => void }) {
  const [slots, setSlots]       = useState<Record<string, Slot>>({});
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [refreshedAt, setRefreshedAt] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [view, setView]           = useState<"slots" | "ideas" | "audit">("slots");
  const [directSlots, setDirectSlots] = useState<Record<string, Slot>>({});

  const [showWrite, setShowWrite] = useState(false);
  const [wKey,    setWKey]    = useState("");
  const [wValue,  setWValue]  = useState("");
  const [wAgent,  setWAgent]  = useState<AgentId>("xova");
  const [wTags,   setWTags]   = useState("");
  const [writing, setWriting] = useState(false);
  const [writeMsg, setWriteMsg] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await runPlugin("--action snapshot");
      if (r.ok) {
        setSlots(r.slots ?? {});
        setRefreshedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      } else setErr(r.error ?? "snapshot failed");
    } catch (e) { setErr(String(e)); }
    try {
      const raw = await invoke<string>("xova_read_file", { path: BROKER_PATH });
      const parsed = JSON.parse(raw) as { slots?: Record<string, Slot> };
      setDirectSlots(parsed.slots ?? {});
    } catch { /* ok */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const visibleKeys = Object.keys(slots)
    .filter(k => agentFilter === "all" || slots[k].agent === agentFilter)
    .sort();

  const handleWrite = async () => {
    if (!wKey.trim()) { setWriteMsg("key required"); return; }
    if (!wValue.trim()) { setWriteMsg("value required"); return; }
    setWriting(true); setWriteMsg("");
    try {
      const tagsArg = wTags.trim() ? ` --tags "${wTags.trim()}"` : "";
      const r = await runPlugin(`--action set --key ${wKey.trim()} --value ${JSON.stringify(wValue)} --agent ${wAgent}${tagsArg}`);
      if (r.ok) {
        setWriteMsg("written"); setWKey(""); setWValue(""); setWTags("");
        await refresh();
        setTimeout(() => setWriteMsg(""), 2000);
      } else setWriteMsg(r.error ?? "write failed");
    } catch (e) { setWriteMsg(String(e)); }
    setWriting(false);
  };

  const ideaCount = Object.keys(directSlots).filter(k => k.startsWith("ideas.")).length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Context Broker
          {refreshedAt && <span className="text-zinc-700 ml-1.5">· {refreshedAt}</span>}
        </span>
        {!loading && <span className="text-zinc-700 text-[9px]">· {visibleKeys.length} slot{visibleKeys.length !== 1 ? "s" : ""}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {(["slots", "ideas", "audit"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={"text-[8px] px-1.5 py-0.5 rounded border transition-colors " + (view === v ? "border-violet-600 text-violet-300 bg-violet-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300")}>
              {v === "ideas" ? "ideas (" + ideaCount + ")" : v === "audit" ? "audit" : "slots"}
            </button>
          ))}
          <button onClick={() => setShowWrite(v => !v)}
            className={"text-[9px] px-2 py-0.5 rounded border transition-colors " + (showWrite ? "border-blue-600 text-blue-400" : "border-zinc-700 text-zinc-500 hover:text-zinc-300")}>
            ＋ Write
          </button>
          <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40">⟳</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      {/* Agent filter */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-zinc-800 shrink-0 flex-wrap">
        {["all", ...AGENTS].map(a => (
          <button key={a} onClick={() => setAgentFilter(a)}
            className={"text-[9px] px-2 py-0.5 rounded border transition-colors " + (agentFilter === a ? (a === "all" ? "border-zinc-500 text-zinc-300 bg-zinc-800" : agentCls(a)) : "border-zinc-800 text-zinc-600 hover:text-zinc-400")}>
            {a}
          </button>
        ))}
      </div>

      {/* Write form */}
      {showWrite && (
        <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/40 shrink-0 space-y-1.5">
          <div className="flex gap-1.5">
            <input value={wKey} onChange={e => setWKey(e.target.value)} placeholder="key"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-600" />
            <select value={wAgent} onChange={e => setWAgent(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-300 focus:outline-none focus:border-blue-600">
              {AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <textarea value={wValue} onChange={e => setWValue(e.target.value)} rows={3}
            placeholder='value — string or JSON (e.g. {"x": 1})'
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-600 resize-none" />
          <div className="flex gap-1.5">
            <input value={wTags} onChange={e => setWTags(e.target.value)} placeholder="tags (comma separated)"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-600" />
            <button onClick={handleWrite} disabled={writing}
              className="px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded text-white text-[9px] uppercase tracking-wider shrink-0">
              {writing ? "…" : "submit"}
            </button>
          </div>
          {writeMsg && (
            <div className={"text-[9px] " + (writeMsg === "written" ? "text-emerald-400" : "text-amber-400")}>{writeMsg}</div>
          )}
        </div>
      )}

      {err && <div className="px-3 py-1.5 text-red-400 text-[9px] border-b border-red-900/40 bg-red-950/20 shrink-0">{err}</div>}
      {loading && !Object.keys(slots).length && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && !visibleKeys.length && !err && (
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-[9px]">
          {agentFilter === "all" ? "no slots — use ＋ Write to add one" : "no slots for " + agentFilter}
        </div>
      )}

      {view === "ideas" && <IdeasView directSlots={directSlots} />}
      {view === "audit" && <AuditView directSlots={directSlots} />}

      {/* Slot list */}
      {view === "slots" && (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {visibleKeys.map(key => {
            const slot = slots[key];
            const open = expanded === key;
            return (
              <div key={key} className="border border-zinc-800 rounded bg-zinc-900/60">
                <button onClick={() => setExpanded(open ? null : key)} className="w-full text-left px-2.5 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-200 text-[11px] truncate flex-1">{key}</span>
                    <span className={"text-[8px] px-1.5 py-0.5 rounded border shrink-0 " + agentCls(slot.agent)}>{slot.agent}</span>
                    <span className="text-zinc-700 text-[9px] shrink-0">{open ? "▲" : "▼"}</span>
                  </div>
                  {!open && (
                    <div className="flex items-center gap-2 mt-0.5 min-w-0">
                      <span className="text-zinc-500 text-[10px] truncate flex-1">{valuePreview(slot.value)}</span>
                      <span className="text-zinc-700 text-[9px] shrink-0">{fmtTs(slot.ts)}</span>
                    </div>
                  )}
                </button>
                {open && (
                  <div className="border-t border-zinc-800 px-2.5 pb-2 pt-1.5 space-y-1.5">
                    <pre className="text-zinc-300 text-[10px] whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-zinc-950/60 rounded p-1.5 border border-zinc-800">
                      {valueFull(slot.value)}
                    </pre>
                    <div className="flex items-center gap-3 text-[9px] text-zinc-600 flex-wrap">
                      <span>ts: {fmtTs(slot.ts)}</span>
                      {slot.ttl > 0 && <span>ttl: {slot.ttl}s</span>}
                      {slot.tags?.length > 0 && (
                        <span className="flex gap-1 flex-wrap">
                          {slot.tags.map(t => (
                            <span key={t} className="px-1 py-px bg-zinc-800 border border-zinc-700 rounded text-zinc-500">{t}</span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
