import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Status {
  ts: number;
  xova: { alive: boolean };
  jarvis: { alive: boolean };
  ollama: { alive: boolean; loaded: { name: string; vram_gb: number; size_gb: number }[] };
  gpu: { used_mb: number; free_mb: number };
}

interface StatusBarProps {
  /** Are we in the middle of a chat turn (Xova thinking)? */
  isBusy: boolean;
  /** Did Jarvis just speak (within last 8s)? Drives the listening dot. */
  jarvisSpoke: boolean;
}

/**
 * Top-of-window health/state strip. Pulls live state every 5s. Tells you at a
 * glance which side is up and what's loaded on the GPU.
 */
export function StatusBar({ isBusy, jarvisSpoke }: StatusBarProps) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const raw = await invoke<string>("xova_status");
        if (!cancelled) setStatus(JSON.parse(raw) as Status);
      } catch { /* ignore — Tauri shutdown etc. */ }
    };
    tick();
    const handle = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const dot = (alive: boolean) => alive ? "bg-emerald-400" : "bg-red-500";
  const loaded = status?.ollama.loaded ?? [];
  const gpuFree = status?.gpu.free_mb;
  const jarvisAlive = status?.jarvis.alive ?? false;
  const ollamaAlive = status?.ollama.alive ?? false;

  // Inline silhouettes — Xova as a sleek AI orb with a stylized "Z" pulse,
  // Jarvis as a classic butler bust with bowtie. Color tracks alive state.
  // Xova = arc-reactor style: concentric rings with center triangle, cyan/emerald HUD glow.
  const XovaSilhouette = ({ active, busy }: { active: boolean; busy: boolean }) => (
    <svg viewBox="0 0 32 32" className={`w-6 h-6 transition-colors ${active ? "text-emerald-400" : "text-zinc-700"} ${busy ? "animate-pulse" : ""}`}
         style={active ? { filter: "drop-shadow(0 0 4px currentColor)" } : undefined}>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
      <circle cx="16" cy="16" r="7"  fill="none" stroke="currentColor" strokeWidth="1.4" />
      {/* triangular core (arc reactor) */}
      <path d="M16 11.5 L21 19 L11 19 Z" fill="currentColor" opacity="0.6" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      {/* HUD ticks */}
      <path d="M16 1.5 v3 M16 27.5 v3 M1.5 16 h3 M27.5 16 h3" stroke="currentColor" strokeWidth="1" opacity="0.6" />
    </svg>
  );
  // Jarvis = Iron Man helmet face: angular mask with glowing eye slits, gold tone.
  const JarvisSilhouette = ({ active, listening }: { active: boolean; listening: boolean }) => (
    <svg viewBox="0 0 32 32" className={`w-6 h-6 transition-colors ${active ? "text-amber-400" : "text-zinc-700"} ${listening ? "animate-pulse" : ""}`}
         style={active ? { filter: "drop-shadow(0 0 3px currentColor)" } : undefined}>
      {/* helmet outline (faceplate) */}
      <path
        d="M16 2
           C 22 2, 26 6, 26 12
           L 26 18
           C 26 22, 24 25, 21 27
           L 21 30
           L 11 30
           L 11 27
           C 8 25, 6 22, 6 18
           L 6 12
           C 6 6, 10 2, 16 2 Z"
        fill="currentColor" opacity="0.85"
      />
      {/* central faceplate seam */}
      <path d="M16 4 L16 26" stroke="#0a0a0a" strokeWidth="0.8" opacity="0.6" />
      {/* eye slits — glowing white-cyan when active */}
      <path d="M9 13 L13.5 12 L13.5 15 L9 14 Z" fill={active ? "#e0fdff" : "#0a0a0a"} />
      <path d="M23 13 L18.5 12 L18.5 15 L23 14 Z" fill={active ? "#e0fdff" : "#0a0a0a"} />
      {/* cheek vents */}
      <rect x="9.5" y="19" width="3" height="0.8" fill="#0a0a0a" opacity="0.7" />
      <rect x="9.5" y="20.5" width="3" height="0.8" fill="#0a0a0a" opacity="0.7" />
      <rect x="19.5" y="19" width="3" height="0.8" fill="#0a0a0a" opacity="0.7" />
      <rect x="19.5" y="20.5" width="3" height="0.8" fill="#0a0a0a" opacity="0.7" />
      {/* mouthpiece line */}
      <path d="M12 24 L20 24" stroke="#0a0a0a" strokeWidth="0.6" opacity="0.7" />
    </svg>
  );

  return (
    <div className="border-b border-zinc-900 bg-gradient-to-r from-zinc-950 via-zinc-950 to-zinc-900 px-6 py-1.5 shrink-0 flex items-center gap-4 text-[10px] font-mono text-zinc-500">
      <span className="flex items-center gap-1.5" title={isBusy ? "Xova is thinking…" : "Xova online"}>
        <XovaSilhouette active={true} busy={isBusy} />
        <span className="text-emerald-400 uppercase tracking-wider font-semibold">XOVA</span>
      </span>
      <span className="text-zinc-800">·</span>
      <span className="flex items-center gap-1.5" title={jarvisAlive ? (jarvisSpoke ? "Jarvis spoke recently" : "Jarvis online") : "Jarvis offline"}>
        <JarvisSilhouette active={jarvisAlive} listening={jarvisSpoke} />
        <span className={`uppercase tracking-wider font-semibold ${jarvisAlive ? "text-amber-400" : "text-zinc-700"}`}>JARVIS</span>
      </span>
      <span className="text-zinc-800">·</span>
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot(ollamaAlive)}`} />
        <span className="uppercase tracking-wider">ollama</span>
      </span>
      {loaded.length > 0 && (
        <span className="text-zinc-400 truncate max-w-[260px]" title={loaded.map(m => `${m.name} ${m.vram_gb.toFixed(2)}/${m.size_gb.toFixed(2)}GB`).join(" · ")}>
          {loaded.map(m => `${m.name.split(":")[0]} ${m.vram_gb.toFixed(1)}G`).join(" · ")}
        </span>
      )}
      {typeof gpuFree === "number" && gpuFree >= 0 && (
        <span className={gpuFree < 200 ? "text-red-400" : gpuFree < 600 ? "text-yellow-400" : "text-zinc-500"}>
          gpu free {gpuFree}MB
        </span>
      )}
      <span className="ml-auto text-zinc-700">
        {status ? `updated ${new Date(status.ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"})}` : "…"}
      </span>
    </div>
  );
}
