import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const SENTINEL_PATH      = "C:\\Xova\\memory\\sentinel.log";
const FORGE_LISTENER_PATH = "C:\\Xova\\memory\\forge_listener.log";

type View = "sentinel" | "forge";

function lineColor(line: string): string {
  const u = line.toUpperCase();
  if (u.includes("LOW COHERENCE") || u.includes("ALERT")) return "text-red-400";
  if (u.includes("OK")) return "text-emerald-400";
  return "text-zinc-400";
}

function lineBg(line: string): string {
  const u = line.toUpperCase();
  if (u.includes("LOW COHERENCE") || u.includes("ALERT")) return "bg-red-950/30 border-red-900/40";
  if (u.includes("OK")) return "bg-emerald-950/20 border-emerald-900/30";
  return "border-zinc-900/50";
}

export function SentinelLog({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>("sentinel");
  const [sentinelLines, setSentinelLines] = useState<string[]>([]);
  const [forgeLines, setForgeLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const [rawS, rawF] = await Promise.all([
      invoke<string>("xova_read_file", { path: SENTINEL_PATH }).catch(() => ""),
      invoke<string>("xova_read_file", { path: FORGE_LISTENER_PATH }).catch(() => ""),
    ]);
    setSentinelLines(rawS.split("\n").map(l => l.trimEnd()).filter(Boolean).reverse());
    setForgeLines(rawF.split("\n").map(l => l.trimEnd()).filter(Boolean).reverse());
    setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const activeLines = view === "sentinel" ? sentinelLines : forgeLines;
  const filtered = filter.trim()
    ? activeLines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : activeLines;
  const alertCount = activeLines.filter(l => {
    const u = l.toUpperCase();
    return u.includes("LOW COHERENCE") || u.includes("ALERT");
  }).length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          {filtered.length} lines
          {alertCount > 0 && <span className="ml-1.5 text-red-400">{alertCount} alert{alertCount !== 1 ? "s" : ""}</span>}
          {updatedAt && <span className="ml-1.5 text-zinc-600">· {updatedAt}</span>}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setView("sentinel")}
            className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${view === "sentinel" ? "border-emerald-700 text-emerald-400 bg-emerald-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
            sentinel
          </button>
          <button onClick={() => setView("forge")}
            className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${view === "forge" ? "border-violet-700 text-violet-400 bg-violet-950/30" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}>
            forge listener
          </button>
        </div>
        <button onClick={refresh} disabled={loading} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="px-3 py-2 shrink-0 border-b border-zinc-900">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter lines…"
          className="w-full bg-zinc-900 text-zinc-200 placeholder-zinc-600 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-emerald-600 border border-zinc-700" />
      </div>

      {loading && activeLines.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
      )}
      {!loading && activeLines.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no log entries</div>
      )}
      {filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {filtered.map((line, i) => (
            <div key={i} className={`px-3 py-0.5 border-b ${lineBg(line)} hover:bg-zinc-900/30`}>
              <span className={`${lineColor(line)} break-all whitespace-pre-wrap`}>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
