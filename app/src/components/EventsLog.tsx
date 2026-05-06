import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const FORGE_PATH = "C:\\Xova\\memory\\forge_events.jsonl";
const MESH_PATH  = "C:\\Xova\\memory\\mesh_feed.jsonl";

interface LogEntry { kind: string; ts: number; source: "forge" | "mesh"; [k: string]: unknown }

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function kindColor(e: LogEntry) {
  const k = e.kind;
  if (e.source === "forge") return "bg-fuchsia-900/60 text-fuchsia-300 border-fuchsia-800";
  if (k === "cycle_end" || k === "cycle_start") return "bg-emerald-900/50 text-emerald-300 border-emerald-800";
  if (k.startsWith("evo_")) return "bg-violet-900/50 text-violet-300 border-violet-800";
  if (k === "agent_result") return "bg-teal-900/50 text-teal-300 border-teal-800";
  return "bg-zinc-800/60 text-zinc-400 border-zinc-700";
}

function keyData(e: LogEntry) {
  if (typeof e.coherence === "number") return `coh=${(e.coherence as number).toFixed(3)}`;
  if (typeof e.risk === "number") return `risk=${e.risk}`;
  if (typeof e.note === "string") return (e.note as string).slice(0, 50);
  if (typeof e.content === "string") return (e.content as string).slice(0, 50);
  return "";
}

function parseLines(raw: string, source: "forge" | "mesh"): LogEntry[] {
  return raw.split("\n").filter(Boolean).map(l => {
    try { return { ...JSON.parse(l), source }; } catch { return null; }
  }).filter(Boolean) as LogEntry[];
}

export function EventsLog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForge, setShowForge] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [forgeRaw, meshRaw] = await Promise.all([
        invoke<string>("xova_read_file", { path: FORGE_PATH }).catch(() => ""),
        invoke<string>("xova_read_file", { path: MESH_PATH }).catch(() => ""),
      ]);
      const forgeEntries = parseLines(forgeRaw, "forge");
      const meshEntries  = parseLines(meshRaw,  "mesh");
      const merged = [...forgeEntries, ...meshEntries]
        .sort((a, b) => (b.ts > 1e12 ? b.ts : b.ts * 1000) - (a.ts > 1e12 ? a.ts : a.ts * 1000))
        .slice(0, 150);
      setEntries(merged);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 15_000); return () => clearInterval(id); }, [refresh]);

  const visible = entries.filter(e => (e.source === "forge" ? showForge : showMesh));

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <span className="text-[9px] text-zinc-600 uppercase tracking-wider">{visible.length} events{updatedAt ? ` · ${updatedAt}` : ""}</span>
        <button onClick={() => setShowForge(v => !v)}
          className={`px-2 py-0.5 rounded border text-[9px] ${showForge ? "border-fuchsia-700 text-fuchsia-400" : "border-zinc-700 text-zinc-600"}`}>
          forge
        </button>
        <button onClick={() => setShowMesh(v => !v)}
          className={`px-2 py-0.5 rounded border text-[9px] ${showMesh ? "border-emerald-700 text-emerald-400" : "border-zinc-700 text-zinc-600"}`}>
          mesh
        </button>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && entries.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">loading events…</div>}

      <div className="flex-1 overflow-y-auto">
        {visible.map((e, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-1 border-b border-zinc-900/50 hover:bg-zinc-900/30">
            <span className="text-zinc-600 text-[9px] shrink-0 w-16 pt-0.5">{fmtTime(e.ts)}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${kindColor(e)}`}>{e.kind}</span>
            <span className="text-zinc-500 truncate text-[10px]">{keyData(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
