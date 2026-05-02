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
  /** GlyphPhaseEngine state — Xova's runtime coherence per Adam's substrate. */
  phase?: string;
}

/**
 * Top-of-window health/state strip. Pulls live state every 5s. Tells you at a
 * glance which side is up and what's loaded on the GPU.
 */
export function StatusBar({ isBusy, jarvisSpoke, phase }: StatusBarProps) {
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
  // When `busy`, the outer dashed ring rotates — a literal "thinking wheel" so it's
  // unmistakable that compute is in flight.
  const XovaSilhouette = ({ active, busy }: { active: boolean; busy: boolean }) => (
    <svg viewBox="0 0 32 32" className={`w-6 h-6 transition-colors ${active ? "text-emerald-400" : "text-zinc-700"}`}
         style={active ? { filter: "drop-shadow(0 0 4px currentColor)" } : undefined}>
      <g className={busy ? "xova-spin" : ""} style={{ transformOrigin: "16px 16px" }}>
        <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55"
                strokeDasharray={busy ? "4 3" : "0"} />
      </g>
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
      <circle cx="16" cy="16" r="7"  fill="none" stroke="currentColor" strokeWidth="1.4" />
      {/* triangular core (arc reactor) — pulses when busy */}
      <path d="M16 11.5 L21 19 L11 19 Z" fill="currentColor" opacity="0.6" className={busy ? "animate-pulse" : ""} />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      {/* HUD ticks */}
      <path d="M16 1.5 v3 M16 27.5 v3 M1.5 16 h3 M27.5 16 h3" stroke="currentColor" strokeWidth="1" opacity="0.6" />
    </svg>
  );
  // Jarvis = wireframe octahedron with a luminous core — abstract AGI vessel.
  // Six vertices, 12 edges, glowing center. No trademark anchor, harmonizes
  // with the cube app icon (geometric framework family). When `listening`, a
  // dashed gold ring orbits and the inner core pulses with extra glow.
  const JarvisSilhouette = ({ active, listening }: { active: boolean; listening: boolean }) => {
    // 6 octahedron vertices: top/bottom + 4 around the equator (square)
    const t = { x: 16, y: 2 }, b = { x: 16, y: 30 };
    const e = { l: { x: 4, y: 16 }, r: { x: 28, y: 16 }, f: { x: 16, y: 11 }, k: { x: 16, y: 21 } };
    const stroke = active ? "currentColor" : "currentColor";
    return (
      <svg viewBox="0 0 32 32" className={`w-6 h-6 transition-colors ${active ? "text-amber-400" : "text-zinc-700"}`}
           style={active ? { filter: "drop-shadow(0 0 4px currentColor)" } : undefined}>
        {listening && (
          <g className="jarvis-spin" style={{ transformOrigin: "16px 16px" }}>
            <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeWidth="0.8"
                    strokeDasharray="2 4" opacity="0.7" />
          </g>
        )}
        {/* inner translucent fill — gives the wireframe some volume */}
        <path d={`M ${t.x} ${t.y} L ${e.r.x} ${e.r.y} L ${b.x} ${b.y} L ${e.l.x} ${e.l.y} Z`} fill="currentColor" opacity="0.18" />
        {/* visible-front edges (bright) */}
        <g stroke={stroke} strokeWidth="1.2" fill="none" opacity="0.95" strokeLinejoin="round">
          {/* top vertex to equator (4 edges) */}
          <line x1={t.x} y1={t.y} x2={e.l.x} y2={e.l.y} />
          <line x1={t.x} y1={t.y} x2={e.r.x} y2={e.r.y} />
          <line x1={t.x} y1={t.y} x2={e.f.x} y2={e.f.y} />
          {/* bottom vertex to equator */}
          <line x1={b.x} y1={b.y} x2={e.l.x} y2={e.l.y} />
          <line x1={b.x} y1={b.y} x2={e.r.x} y2={e.r.y} />
          <line x1={b.x} y1={b.y} x2={e.f.x} y2={e.f.y} />
          {/* equator front edges */}
          <line x1={e.l.x} y1={e.l.y} x2={e.f.x} y2={e.f.y} />
          <line x1={e.f.x} y1={e.f.y} x2={e.r.x} y2={e.r.y} />
        </g>
        {/* hidden-back edges (dimmed, dashed) */}
        <g stroke={stroke} strokeWidth="0.8" fill="none" opacity="0.45" strokeDasharray="1.5 1.5">
          <line x1={t.x} y1={t.y} x2={e.k.x} y2={e.k.y} />
          <line x1={b.x} y1={b.y} x2={e.k.x} y2={e.k.y} />
          <line x1={e.l.x} y1={e.l.y} x2={e.k.x} y2={e.k.y} />
          <line x1={e.k.x} y1={e.k.y} x2={e.r.x} y2={e.r.y} />
        </g>
        {/* luminous core — pulses brighter when listening */}
        <circle cx="16" cy="16" r={listening ? 2.6 : 2} fill="currentColor"
                className={listening ? "animate-pulse" : ""} />
        <circle cx="16" cy="16" r="0.9" fill="#fef3c7" />
      </svg>
    );
  };

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
      {phase && phase !== "initial" && (
        <>
          <span className="text-zinc-800">·</span>
          <span
            title={
              phase === "stabilized" ? "Xova's last reply scored well on self-eval (substrate STABILIZED, glyph_phase_engine)"
              : phase === "delta_adjustment" ? "Recent replies in delta-adjustment range — moderate convergence"
              : phase === "error" ? "Recent self-eval flagged high hallucination risk — substrate at ERROR threshold"
              : phase === "processing" ? "Phase engine processing"
              : phase
            }
            className={`flex items-center gap-1.5 uppercase tracking-wider ${
              phase === "stabilized" ? "text-emerald-400"
              : phase === "delta_adjustment" ? "text-amber-400"
              : phase === "error" ? "text-rose-400"
              : "text-zinc-500"
            }`}
          >
            <span className="text-[8px]">●</span>
            <span>phase: {phase === "delta_adjustment" ? "delta" : phase}</span>
          </span>
        </>
      )}
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
