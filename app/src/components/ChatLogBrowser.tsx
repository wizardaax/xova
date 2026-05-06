import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const FILES = [
  { path: "C:\\Xova\\memory\\chat_log\\adam.jsonl",   label: "adam",   color: "#60a5fa" },
  { path: "C:\\Xova\\memory\\chat_log\\xova.jsonl",   label: "xova",   color: "#34d399" },
  { path: "C:\\Xova\\memory\\chat_log\\jarvis.jsonl", label: "jarvis", color: "#a78bfa" },
];

interface ChatLine { id: string; ts: number; from: string; to: string; text: string }

const ROLE_COLOR: Record<string, string> = {
  adam:   "#60a5fa",
  xova:   "#34d399",
  jarvis: "#a78bfa",
};

function fmtTs(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

export function ChatLogBrowser({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState<Record<string, boolean>>({ adam: true, xova: true, jarvis: true });
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const all: ChatLine[] = [];
    await Promise.all(FILES.map(async (f) => {
      try {
        const raw = await invoke<string>("xova_read_file", { path: f.path });
        raw.split("\n").filter(Boolean).forEach(l => {
          try {
            const o = JSON.parse(l) as ChatLine;
            if (o.ts && o.text) all.push(o);
          } catch { /* skip */ }
        });
      } catch { /* file missing */ }
    }));
    all.sort((a, b) => a.ts - b.ts);
    setLines(all.slice(-200));
    setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [refresh]);

  const visible = lines.filter(l => {
    const role = (l.from ?? "").toLowerCase();
    if (!shown[role] && !shown["other"]) return false;
    if (!shown[role] && !FILES.find(f => f.label === role)) return false;
    if (!shown[role]) return false;
    if (filter.trim() && !l.text.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Chat Log{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        {FILES.map(f => (
          <button key={f.label} onClick={() => setShown(prev => ({ ...prev, [f.label]: !prev[f.label] }))}
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${shown[f.label] ? "border-zinc-600 bg-zinc-800" : "border-zinc-800 bg-zinc-900 opacity-40"}`}
            style={{ color: f.color }}>
            {f.label}
          </button>
        ))}
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="search…"
          className="flex-1 bg-zinc-900 text-zinc-200 text-[10px] rounded px-2 py-0.5 border border-zinc-700 focus:outline-none placeholder-zinc-600" />
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && visible.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no messages</div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {visible.slice(-100).map((l, i) => (
          <div key={l.id ?? i} className="flex gap-2 py-0.5">
            <span className="text-zinc-600 text-[9px] shrink-0 w-9 text-right">{fmtTs(l.ts)}</span>
            <span className="text-[9px] shrink-0 w-10 font-bold" style={{ color: ROLE_COLOR[l.from?.toLowerCase()] ?? "#71717a" }}>
              {l.from}
            </span>
            <span className="text-zinc-300 break-words min-w-0">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
