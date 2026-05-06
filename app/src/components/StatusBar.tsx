import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Status {
  ts: number;
  xova: { alive: boolean };
  jarvis: { alive: boolean };
  ollama: { alive: boolean; loaded: { name: string; vram_gb: number; size_gb: number }[] };
  gpu: { used_mb: number; free_mb: number };
}

interface MeshState {
  cycles: number;
  coherence: number | null;
}

interface StatusBarProps {
  isBusy: boolean;
  jarvisSpoke: boolean;
  phase?: string;
  forgeMode?: "live" | "queue" | "off";
  currentModel?: string;
  onModelChange?: (model: string) => void;
  messageCount?: number;
}

/**
 * Top-of-window health/state strip. Pulls live state every 5s. Tells you at a
 * glance which side is up and what's loaded on the GPU.
 */
export function StatusBar({ isBusy, jarvisSpoke, phase, forgeMode, currentModel, onModelChange, messageCount }: StatusBarProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [mesh, setMesh] = useState<MeshState | null>(null);
  const [forgeBusy, setForgeBusy] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelOpen) return;
    const handler = (e: MouseEvent) => { if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setModelOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelOpen]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const raw = await invoke<string>("xova_status");
        if (!cancelled) setStatus(JSON.parse(raw) as Status);
      } catch { /* ignore — Tauri shutdown etc. */ }
      try {
        const inbox = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\forge_inbox.json" });
        if (!cancelled) {
          const trimmed = inbox.trim();
          if (trimmed.length > 0) {
            try { const msg = JSON.parse(trimmed); setForgeBusy(msg.intent === "ask"); }
            catch { setForgeBusy(false); }
          } else { setForgeBusy(false); }
        }
      } catch { if (!cancelled) setForgeBusy(false); }
    };
    tick();
    const handle = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tickMesh = async () => {
      try {
        const boardRaw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\agent_board.json" });
        const board = JSON.parse(boardRaw);
        const cycles: number = board?.absorb?.cycles ?? 0;
        let coherence: number | null = null;
        try {
          const feedRaw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\mesh_feed.jsonl" });
          const lines = feedRaw.split("\n").filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.kind === "cycle_end" && typeof entry.coherence === "number") { coherence = entry.coherence; break; }
            } catch { /* skip malformed */ }
          }
        } catch { /* mesh_feed may not exist yet */ }
        if (!cancelled) setMesh({ cycles, coherence });
      } catch { /* agent_board may not exist yet */ }
    };
    tickMesh();
    const handle = window.setInterval(tickMesh, 10000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, []);

  const dot = (alive: boolean) => alive ? "bg-emerald-400" : "bg-red-500";
  const loaded = status?.ollama.loaded ?? [];
  const gpuFree = status?.gpu.free_mb;
  const jarvisAlive = status?.jarvis.alive ?? false;
  const ollamaAlive = status?.ollama.alive ?? false;
  const meshPillClass =
    mesh?.coherence == null ? "text-zinc-500"
    : mesh.coherence >= 0.8 ? "text-emerald-400"
    : mesh.coherence >= 0.6 ? "text-amber-400"
    : "text-red-400";

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
        <JarvisSilhouette active={true} listening={jarvisSpoke} />
        <span className="uppercase tracking-wider font-semibold text-amber-400">JARVIS</span>
      </span>
      <span className="text-zinc-800">·</span>
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot(ollamaAlive)}`} />
        <span className="uppercase tracking-wider">ollama</span>
      </span>
      {currentModel && (
        <>
          <span className="text-zinc-800">·</span>
          <div className="relative" ref={modelMenuRef}>
            <button onClick={() => setModelOpen(v => !v)}
              className="text-[10px] text-zinc-400 hover:text-emerald-400 border border-zinc-800 hover:border-emerald-700 rounded px-1.5 py-0.5 transition-colors font-mono">
              {currentModel.split(":")[0]}
            </button>
            {modelOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl min-w-[160px] py-1">
                {(loaded.length > 0 ? loaded.map(m => m.name) : [currentModel]).map(name => (
                  <button key={name} onClick={() => { onModelChange?.(name); setModelOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-zinc-800 transition-colors ${name === currentModel ? "text-emerald-400" : "text-zinc-300"}`}>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
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
      {mesh && (
        <>
          <span className="text-zinc-800">·</span>
          <span
            title={mesh.coherence == null
              ? `Mesh cycle ${mesh.cycles} — coherence unknown`
              : `Mesh cycle ${mesh.cycles} · coherence ${mesh.coherence.toFixed(2)} — ${mesh.coherence >= 0.8 ? "stable" : mesh.coherence >= 0.6 ? "moderate" : "degraded"}`}
            className={`flex items-center gap-1 uppercase tracking-wider ${meshPillClass}`}
          >
            <span>⬡</span>
            <span>cycle {mesh.cycles}{mesh.coherence != null ? ` · coh ${mesh.coherence.toFixed(2)}` : ""}</span>
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
      {forgeMode && forgeMode !== "off" && (
        <>
          <span className="text-zinc-800">·</span>
          <span
            title={forgeMode === "live" ? "Forge: active" : "Forge: queued"}
            className={`flex items-center gap-1 uppercase tracking-wider text-[10px] ${
              forgeMode === "live" ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {forgeMode === "live" ? "🔗 live" : "⏳ queue"}
          </span>
        </>
      )}
      {forgeBusy && (
        <>
          <span className="text-zinc-800">·</span>
          <span
            title="Forge is calling claude --print (processing an ask)"
            className="flex items-center gap-1.5 uppercase tracking-wider text-[10px] text-fuchsia-400 animate-pulse"
            style={{ textShadow: "0 0 6px #e879f9" }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-ping" />
            forging
          </span>
        </>
      )}
      {messageCount != null && messageCount > 0 && (
        <span className="text-zinc-700 text-[9px]">{messageCount} msg{messageCount !== 1 ? "s" : ""}</span>
      )}
      <span className="ml-auto text-zinc-700">
        {status ? `updated ${new Date(status.ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"})}` : "…"}
      </span>
    </div>
  );
}
