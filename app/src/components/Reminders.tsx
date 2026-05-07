import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PATH = "C:\\Xova\\memory\\reminders.json";

interface Reminder {
  id?: string;
  text: string;
  fire_ts?: number;
  created_ts?: number;
  fired?: boolean;
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString([], {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 0) {
    const future = -s;
    if (future < 3600) return `in ${Math.floor(future / 60)}m`;
    return `in ${Math.floor(future / 3600)}h`;
  }
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Reminders({ onClose }: { onClose: () => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState<"all" | "pending" | "fired">("all");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: PATH });
      setReminders(JSON.parse(raw) as Reminder[]);
    } catch { setReminders([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 15_000); return () => clearInterval(id); }, [refresh]);

  const pending = reminders.filter(r => !r.fired);
  const fired   = reminders.filter(r => r.fired);

  const visible =
    filter === "pending" ? pending :
    filter === "fired"   ? fired   : reminders;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Reminders</span>
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        {[
          { k: "all",     label: "all",     n: reminders.length },
          { k: "pending", label: "pending", n: pending.length },
          { k: "fired",   label: "fired",   n: fired.length },
        ].map(({ k, label, n }) => (
          <button key={k} onClick={() => setFilter(k as typeof filter)}
            className={`text-[7px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
              filter === k ? "bg-amber-900/40 border-amber-600 text-amber-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
            }`}>
            {label} {n}
          </button>
        ))}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && visible.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no reminders</div>}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {visible.map((r, i) => (
          <div key={r.id ?? i} className={`border rounded p-2 ${r.fired ? "border-zinc-800 opacity-60" : "border-amber-800/50 bg-amber-950/10"}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-[7px] px-1 py-px rounded border ${r.fired ? "bg-zinc-800 border-zinc-700 text-zinc-500" : "bg-amber-900/40 border-amber-700 text-amber-300"}`}>
                {r.fired ? "fired" : "pending"}
              </span>
              {r.fire_ts && <span className="text-zinc-500 text-[8px] ml-auto">{fmtAgo(r.fire_ts)}</span>}
            </div>
            <div className="text-zinc-200 text-[9px] leading-snug">{r.text}</div>
            {r.fire_ts && (
              <div className="text-zinc-600 text-[8px] mt-1">{fmtTime(r.fire_ts)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
