import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MemoryEntry { id: string; key: string; value: string; ts?: number }

export function MemoryKeys({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_memory_list", { limit: 500 });
      let parsed: MemoryEntry[] = [];
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) parsed = arr as MemoryEntry[];
      } catch { /* silent */ }
      setEntries(parsed);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch { setEntries([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const visible = filter.trim()
    ? entries.filter(e => e.key?.toLowerCase().includes(filter.toLowerCase()) || e.value?.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  function preview(val: string) {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === "object") return JSON.stringify(parsed).slice(0, 80);
    } catch { /* raw */ }
    return val.slice(0, 80);
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Memory Keys ({entries.length}){updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter keys…"
          className="w-full bg-zinc-900 text-zinc-200 text-[10px] rounded px-2 py-1 border border-zinc-700 focus:outline-none placeholder-zinc-600" />
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && visible.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no memory entries</div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {visible.map(e => {
          const open = expanded === e.id;
          return (
            <div key={e.id} className="border border-zinc-800 rounded bg-zinc-900">
              <button onClick={() => setExpanded(open ? null : e.id)} className="w-full text-left px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 text-[10px] font-bold truncate flex-1">{e.key}</span>
                  <span className="text-zinc-600 text-[9px]">{open ? "▲" : "▼"}</span>
                </div>
                {!open && <div className="text-zinc-500 text-[9px] truncate mt-0.5">{preview(e.value ?? "")}</div>}
              </button>
              {open && (
                <pre className="px-3 pb-2 text-zinc-300 text-[9px] whitespace-pre-wrap break-words border-t border-zinc-800 pt-1 max-h-40 overflow-y-auto">
                  {(() => { try { return JSON.stringify(JSON.parse(e.value), null, 2); } catch { return e.value; } })()}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
