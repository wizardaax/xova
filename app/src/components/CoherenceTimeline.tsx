import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const MESH_PATH = "C:\\Xova\\memory\\mesh_feed.jsonl";
const W = 380, H = 140, PAD = { t: 8, r: 8, b: 24, l: 32 };
const IW = W - PAD.l - PAD.r, IH = H - PAD.t - PAD.b;

interface CyclePoint { ts: number; coherence: number }

function fmtHHMM(ts: number) {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function trendArrow(pts: CyclePoint[]) {
  if (pts.length < 4) return "—";
  const half = Math.floor(pts.length / 2);
  const avgA = pts.slice(0, half).reduce((s, p) => s + p.coherence, 0) / half;
  const avgB = pts.slice(-half).reduce((s, p) => s + p.coherence, 0) / half;
  const d = avgB - avgA;
  return d > 0.01 ? "↑" : d < -0.01 ? "↓" : "→";
}

export function CoherenceTimeline({ onClose }: { onClose: () => void }) {
  const [pts, setPts] = useState<CyclePoint[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: MESH_PATH });
      const parsed: CyclePoint[] = raw.split("\n").filter(Boolean).flatMap(l => {
        try { const o = JSON.parse(l); return o.kind === "cycle_end" && typeof o.coherence === "number" ? [{ ts: o.ts as number, coherence: o.coherence as number }] : []; }
        catch { return []; }
      });
      setPts(parsed.slice(-100));
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [refresh]);

  const n = pts.length;
  const cur  = n ? pts[n - 1].coherence : 0;
  const avg  = n ? pts.reduce((s, p) => s + p.coherence, 0) / n : 0;
  const min  = n ? Math.min(...pts.map(p => p.coherence)) : 0;
  const max  = n ? Math.max(...pts.map(p => p.coherence)) : 0;
  const arrow = trendArrow(pts);
  const arrowColor = arrow === "↑" ? "#34d399" : arrow === "↓" ? "#f87171" : "#a1a1aa";

  const xOf = (i: number) => PAD.l + (i / Math.max(n - 1, 1)) * IW;
  const yOf = (v: number) => PAD.t + (1 - v) * IH;

  const polyPoints = pts.map((p, i) => `${xOf(i)},${yOf(p.coherence)}`).join(" ");
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.coherence).toFixed(1)}`).join(" ");
  const fillD = n > 0 ? `${lineD} L${xOf(n - 1).toFixed(1)},${(PAD.t + IH).toFixed(1)} L${PAD.l.toFixed(1)},${(PAD.t + IH).toFixed(1)} Z` : "";

  const y05 = yOf(0.5), y08 = yOf(0.8);
  const tickCount = Math.min(5, n);
  const tickIdxs = tickCount < 2 ? (n > 0 ? [0] : []) :
    Array.from({ length: tickCount }, (_, i) => Math.round(i * (n - 1) / (tickCount - 1)));

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Coherence Timeline{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>
      {n === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no cycle_end events yet</div>}
      {n > 0 && (
        <>
          <div className="px-3 pt-3 shrink-0">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
              <defs>
                <clipPath id="ct-red">  <rect x={PAD.l} y={y05}  width={IW} height={PAD.t + IH - y05} /></clipPath>
                <clipPath id="ct-amber"><rect x={PAD.l} y={y08}  width={IW} height={y05 - y08} /></clipPath>
                <clipPath id="ct-grn">  <rect x={PAD.l} y={PAD.t} width={IW} height={y08 - PAD.t} /></clipPath>
              </defs>
              <line x1={PAD.l} y1={y08} x2={PAD.l + IW} y2={y08} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1={PAD.l} y1={y05} x2={PAD.l + IW} y2={y05} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="3 3" />
              <text x={PAD.l - 3} y={y08} textAnchor="end" dominantBaseline="middle" fontSize="7" fill="#52525b">0.8</text>
              <text x={PAD.l - 3} y={y05} textAnchor="end" dominantBaseline="middle" fontSize="7" fill="#52525b">0.5</text>
              <text x={PAD.l - 3} y={PAD.t} textAnchor="end" dominantBaseline="middle" fontSize="7" fill="#52525b">1.0</text>
              <path d={fillD} fill="#f87171" fillOpacity="0.15" clipPath="url(#ct-red)" />
              <path d={fillD} fill="#fbbf24" fillOpacity="0.15" clipPath="url(#ct-amber)" />
              <path d={fillD} fill="#34d399" fillOpacity="0.15" clipPath="url(#ct-grn)" />
              <polyline points={polyPoints} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinejoin="round" />
              <circle cx={xOf(n - 1)} cy={yOf(cur)} r="3" fill={cur >= 0.8 ? "#34d399" : cur >= 0.5 ? "#fbbf24" : "#f87171"} />
              {tickIdxs.map(i => (
                <text key={i} x={xOf(i)} y={PAD.t + IH + 10} textAnchor="middle" fontSize="7" fill="#52525b">{fmtHHMM(pts[i].ts)}</text>
              ))}
              <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + IH} stroke="#3f3f46" strokeWidth="0.5" />
              <line x1={PAD.l} y1={PAD.t + IH} x2={PAD.l + IW} y2={PAD.t + IH} stroke="#3f3f46" strokeWidth="0.5" />
            </svg>
          </div>
          <div className="grid grid-cols-5 gap-1 px-3 pb-3 pt-1 shrink-0">
            {([["current", cur.toFixed(3), cur >= 0.8 ? "#34d399" : cur >= 0.5 ? "#fbbf24" : "#f87171"], ["avg", avg.toFixed(3), "#a1a1aa"], ["min", min.toFixed(3), "#f87171"], ["max", max.toFixed(3), "#34d399"], ["trend", arrow, arrowColor]] as [string, string, string][]).map(([label, val, color]) => (
              <div key={label} className="bg-zinc-900 rounded p-1.5 text-center">
                <div className="text-[8px] text-zinc-600 uppercase">{label}</div>
                <div className="text-sm font-bold mt-0.5" style={{ color }}>{val}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
