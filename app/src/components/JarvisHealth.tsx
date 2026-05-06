import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const SCRIPT = "D:\\temp\\jarvis_health.py";

interface JarvisProc { Id?: number; ExePath?: string; MemMB?: number; name?: string; pid?: number; status?: string }
interface HealthPayload {
  procs: JarvisProc[];
  db_alive: boolean;
  voice_age_s: number | null;
  jarvis_inbox_age_s: number | null;
  verdict: "UP" | "DOWN" | "IDLE" | "STALE";
  debug: Record<string, unknown>;
}

function verdictStyle(v: string) {
  switch (v) {
    case "UP":    return { cls: "bg-emerald-900/60 border-emerald-700 text-emerald-300" };
    case "DOWN":  return { cls: "bg-red-900/60 border-red-700 text-red-300" };
    case "IDLE":  return { cls: "bg-amber-900/60 border-amber-700 text-amber-300" };
    case "STALE": return { cls: "bg-amber-900/50 border-amber-800 text-amber-400" };
    default:      return { cls: "bg-zinc-800 border-zinc-700 text-zinc-400" };
  }
}

function ageColor(s: number | null) {
  if (s == null) return "text-zinc-500";
  if (s > 300) return "text-red-400";
  if (s > 60)  return "text-amber-400";
  return "text-emerald-400";
}

function fmtAge(s: number | null) {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function JarvisHealth({ onClose }: { onClose: () => void }) {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PYTHON}" "${SCRIPT}"`,
        cwd: "C:\\Xova",
        elevated: false,
      });
      let stdout = raw, exit = 0;
      try { const w = JSON.parse(raw) as { stdout?: string; exit?: number; stderr?: string }; stdout = w.stdout ?? ""; exit = w.exit ?? 0; } catch { /* raw */ }
      if (exit !== 0) { setError(`exit ${exit}: ${stdout.slice(0, 200)}`); setLoading(false); return; }
      setHealth(JSON.parse(stdout) as HealthPayload);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 15_000); return () => clearInterval(id); }, [refresh]);

  const vs = health ? verdictStyle(health.verdict) : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Jarvis Health{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && !health && <div className="flex-1 flex items-center justify-center text-zinc-600">probing…</div>}
      {!loading && error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-red-400 text-[10px]">error</span>
          <span className="text-zinc-500 text-[9px] break-all">{error}</span>
        </div>
      )}

      {health && (
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 px-3 py-2.5 border-b border-zinc-800">
            <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${vs!.cls}`}>{health.verdict}</span>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full inline-block ${health.db_alive ? "bg-emerald-400" : "bg-red-500"}`} />
              <span className="text-zinc-500 text-[9px]">db</span>
            </div>
            {loading && <span className="text-zinc-600 text-[9px] ml-auto animate-pulse">refreshing…</span>}
          </div>

          <div className="flex border-b border-zinc-800">
            <div className="flex-1 flex flex-col gap-0.5 px-3 py-2 border-r border-zinc-800">
              <span className="text-[9px] text-zinc-600 uppercase">voice age</span>
              <span className={`text-[12px] font-semibold ${ageColor(health.voice_age_s)}`}>{fmtAge(health.voice_age_s)}</span>
            </div>
            <div className="flex-1 flex flex-col gap-0.5 px-3 py-2">
              <span className="text-[9px] text-zinc-600 uppercase">inbox age</span>
              <span className={`text-[12px] font-semibold ${ageColor(health.jarvis_inbox_age_s)}`}>{fmtAge(health.jarvis_inbox_age_s)}</span>
            </div>
          </div>

          <div className="px-3 pt-2 pb-1 shrink-0">
            <span className="text-[9px] text-zinc-600 uppercase">processes ({health.procs.length})</span>
          </div>
          {health.procs.length === 0 && (
            <div className="px-3 py-2 text-zinc-600 text-[10px]">no jarvis processes detected</div>
          )}
          {health.procs.map((p, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-900/60 hover:bg-zinc-900/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-zinc-300 truncate flex-1">{p.name ?? p.ExePath?.split(/[\\/]/).pop() ?? "process"}</span>
              <span className="text-zinc-600 text-[9px] shrink-0">PID {p.Id ?? p.pid}</span>
              {p.MemMB != null && p.MemMB > 0 && <span className="text-zinc-600 text-[9px] shrink-0">{p.MemMB}MB</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
