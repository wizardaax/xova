import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN = "C:\\Xova\\plugins\\swarm_status.py";
const CMD = `"${PY}" "${PLUGIN}"`;

interface SwarmStatus {
  num_shards: number; healthy_shards: number; total_workers: number;
  tasks_completed: number; tasks_failed: number; avg_coherence: number;
  throttle_active: boolean; halt_triggered: boolean;
}

function CoherenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = pct >= 0.7 ? "#34d399" : pct >= 0.4 ? "#fbbf24" : "#f87171";
  return (
    <div className="mt-1">
      <div className="flex justify-between text-[9px] text-zinc-500 mb-0.5">
        <span>coherence</span><span style={{ color }}>{pct.toFixed(3)}</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function SwarmPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SwarmStatus | null>(null);
  const [err, setErr]       = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<string>("xova_run", { command: CMD, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      const parsed = JSON.parse(stdout) as { ok: boolean; status?: SwarmStatus; error?: string };
      if (!parsed.ok || !parsed.status) { setErr(parsed.error ?? "swarm_status.py not ready"); setStatus(null); }
      else { setStatus(parsed.status); setErr(null); setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })); }
    } catch { setErr("swarm_status.py not ready"); setStatus(null); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Swarm{updatedAt ? ` · ${updatedAt}` : ""}</span>
        <button onClick={refresh} disabled={loading} className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && !status && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      {err && !status && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-amber-400">{err}</span>
          <span className="text-zinc-600 text-[10px]">Create C:\Xova\plugins\swarm_status.py to enable</span>
        </div>
      )}

      {status && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {([
              ["shards", `${status.healthy_shards} / ${status.num_shards}`, status.healthy_shards === status.num_shards ? "#34d399" : "#fbbf24"],
              ["workers", String(status.total_workers), "#a1a1aa"],
              ["completed", String(status.tasks_completed), "#34d399"],
              ["failed", String(status.tasks_failed), status.tasks_failed > 0 ? "#f87171" : "#a1a1aa"],
            ] as [string, string, string][]).map(([label, val, color]) => (
              <div key={label} className="bg-zinc-900 rounded p-2">
                <div className="text-[9px] text-zinc-500 uppercase">{label}</div>
                <div className="text-sm font-bold mt-0.5" style={{ color }}>{val}</div>
              </div>
            ))}
          </div>

          <CoherenceBar value={status.avg_coherence} />

          <div className="flex gap-2">
            <div className={`flex-1 rounded p-1.5 text-center text-[10px] font-bold ${status.throttle_active ? "bg-amber-900/40 text-amber-300 border border-amber-700" : "bg-zinc-900 text-zinc-600 border border-zinc-800"}`}>
              {status.throttle_active ? "⚠ THROTTLE" : "throttle off"}
            </div>
            <div className={`flex-1 rounded p-1.5 text-center text-[10px] font-bold ${status.halt_triggered ? "bg-red-900/40 text-red-300 border border-red-700" : "bg-zinc-900 text-zinc-600 border border-zinc-800"}`}>
              {status.halt_triggered ? "🛑 HALTED" : "running"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
