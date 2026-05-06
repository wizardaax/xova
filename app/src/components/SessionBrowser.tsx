import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type ChatMessage } from "./Sidebar";

interface SessionMeta {
  name: string;
  msgCount: number;
  firstUserMsg: string;
  ts: number;
}

interface SessionData {
  messages: ChatMessage[];
  log?: unknown[];
  coherenceHistory?: number[];
}

function parseSafe(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

function loadSession(raw: string): SessionData | null {
  let v = parseSafe(raw);
  if (typeof v === "string") v = parseSafe(v);
  if (!v || typeof v !== "object") return null;
  return v as SessionData;
}

function sessionDate(name: string): number {
  const m = name.match(/(\d{8})(\d{6})?/);
  if (!m) return 0;
  const [y, mo, d] = [m[1].slice(0,4), m[1].slice(4,6), m[1].slice(6,8)];
  const t = m[2] ? `${m[2].slice(0,2)}:${m[2].slice(2,4)}:${m[2].slice(4,6)}` : "00:00:00";
  return new Date(`${y}-${mo}-${d}T${t}`).getTime();
}

export function SessionBrowser({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChatMessage[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const loadIndex = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("load_memory", { key: "session_index" });
      let idx: string[] = [];
      const parsed = parseSafe(raw);
      if (Array.isArray(parsed)) idx = parsed as string[];
      else if (typeof parsed === "string") {
        const inner = parseSafe(parsed);
        if (Array.isArray(inner)) idx = inner as string[];
      }

      const metas: SessionMeta[] = [];
      for (const name of idx) {
        try {
          const sraw = await invoke<string>("load_memory", { key: name });
          const data = loadSession(sraw);
          const msgs = data?.messages ?? [];
          const firstUser = msgs.find(m => m.role === "user")?.text ?? "";
          metas.push({ name, msgCount: msgs.length, firstUserMsg: firstUser.slice(0, 80), ts: sessionDate(name) });
        } catch { metas.push({ name, msgCount: 0, firstUserMsg: "", ts: sessionDate(name) }); }
      }
      metas.sort((a, b) => b.ts - a.ts);
      setSessions(metas);
    } catch { /* no index yet */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadIndex(); }, [loadIndex]);

  const openPreview = async (name: string) => {
    if (selected === name) { setSelected(null); setPreview(null); return; }
    setSelected(name); setPreviewLoading(true); setPreview(null);
    try {
      const raw = await invoke<string>("load_memory", { key: name });
      const data = loadSession(raw);
      setPreview((data?.messages ?? []).slice(0, 5));
    } catch { setPreview([]); }
    setPreviewLoading(false);
  };

  const filtered = filter
    ? sessions.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || s.firstUserMsg.toLowerCase().includes(filter.toLowerCase()))
    : sessions;

  const fmtTs = (ts: number) => ts > 0 ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Session Browser · {sessions.length}</span>
        <div className="flex gap-2">
          <button onClick={loadIndex} className="text-zinc-600 hover:text-zinc-300">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>
      <div className="px-3 py-2 shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter sessions…"
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-600 placeholder-zinc-600" />
      </div>
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {loading && <div className="text-zinc-600 text-center mt-4">loading…</div>}
        {!loading && filtered.length === 0 && <div className="text-zinc-600 text-center mt-4">no sessions found</div>}
        {filtered.map(s => (
          <div key={s.name} className="border border-zinc-800 rounded bg-zinc-900 overflow-hidden">
            <button onClick={() => openPreview(s.name)}
              className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 text-[10px] truncate">{s.name}</span>
                  <span className="text-zinc-600 text-[9px] shrink-0">{s.msgCount} msgs</span>
                </div>
                <div className="text-zinc-500 text-[9px] truncate mt-0.5">{s.firstUserMsg || "(empty)"}</div>
                <div className="text-zinc-700 text-[9px] mt-0.5">{fmtTs(s.ts)}</div>
              </div>
              <span className="text-zinc-600 text-[10px] shrink-0">{selected === s.name ? "▲" : "▼"}</span>
            </button>
            {selected === s.name && (
              <div className="border-t border-zinc-800 px-3 py-2 bg-zinc-950 space-y-1">
                {previewLoading && <div className="text-zinc-600 text-[10px]">loading…</div>}
                {!previewLoading && preview?.map((m, i) => (
                  <div key={i} className={`rounded px-2 py-1 text-[10px] ${m.role === "user" ? "bg-zinc-800 text-zinc-200" : "bg-zinc-900 text-zinc-400"}`}>
                    <span className="text-zinc-600 text-[9px] mr-2">{m.role}</span>
                    {m.text.slice(0, 120)}{m.text.length > 120 ? "…" : ""}
                  </div>
                ))}
                {!previewLoading && preview?.length === 0 && <div className="text-zinc-600 text-[10px]">empty session</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
