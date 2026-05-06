import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";

const SCRIPT =
  "import json,math;" +
  "phi=(1+math.sqrt(5))/2;" +
  "ga=2*math.pi*(1-1/phi);" +
  "pts=[[round(math.sqrt(n)*math.cos(n*ga),4),round(math.sqrt(n)*math.sin(n*ga),4)] for n in range(1,90)];" +
  "print(json.dumps({'ok':True,'points':pts}))";

type Point = [number, number];
type Tooltip = { x: number; y: number; idx: number; px: number; py: number } | null;

function dotColor(idx: number, total: number): string {
  const t = idx / (total - 1);
  if (t < 0.33) return "#52525b";
  if (t < 0.55) return "#34d399";
  if (t < 0.77) return "#fbbf24";
  return "#e879f9";
}

export function FieldVisualizer({ onClose }: { onClose: () => void }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState<Tooltip>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cmd = `${PY} -c "${SCRIPT.replace(/"/g, '\\"')}"`;
      const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      const parsed = JSON.parse(stdout.trim()) as { ok: boolean; points: Point[] };
      if (parsed.ok) setPoints(parsed.points);
      else setError("script returned not-ok");
    } catch (e: unknown) {
      setError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { run(); }, [run]);

  const PAD = 14, SIZE = 280;
  let minX = -1, maxX = 1, minY = -1, maxY = 1;
  if (points.length) {
    minX = Math.min(...points.map(p => p[0]));
    maxX = Math.max(...points.map(p => p[0]));
    minY = Math.min(...points.map(p => p[1]));
    maxY = Math.max(...points.map(p => p[1]));
  }
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const scale = (SIZE - PAD * 2) / Math.max(rangeX, rangeY);
  const toSvg = (px: number, py: number) => ({
    cx: PAD + (px - minX) * scale + (SIZE - PAD * 2 - rangeX * scale) / 2,
    cy: SIZE - PAD - (py - minY) * scale - (SIZE - PAD * 2 - rangeY * scale) / 2,
  });

  return (
    <div className="flex flex-col gap-2 font-mono text-[11px] text-zinc-300 p-2">
      <div className="flex items-center gap-2">
        <span className="text-emerald-400 uppercase tracking-wider text-[9px]">φ Field · Golden Angle Spiral</span>
        <button onClick={run} disabled={loading}
          className="ml-auto px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40 text-[10px]">
          {loading ? "running…" : "↻ Regen"}
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {error && <div className="text-red-400 text-[10px]">{error}</div>}

      <div className="relative">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="bg-zinc-900 rounded border border-zinc-800"
          onMouseLeave={() => setTooltip(null)}>
          {points.map((p, i) => {
            const { cx, cy } = toSvg(p[0], p[1]);
            return (
              <circle key={i} cx={cx} cy={cy} r={3}
                fill={dotColor(i, points.length || 1)} opacity={0.85}
                onMouseEnter={() => setTooltip({ idx: i, x: p[0], y: p[1], px: cx, py: cy })}
              />
            );
          })}
        </svg>
        {tooltip && (
          <div className="absolute pointer-events-none bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-[10px] text-zinc-200 whitespace-nowrap z-10"
            style={{ left: tooltip.px + 8, top: Math.max(0, tooltip.py - 24) }}>
            <span className="text-emerald-400">#{tooltip.idx + 1}</span>
            {" "}({tooltip.x.toFixed(3)}, {tooltip.y.toFixed(3)})
          </div>
        )}
      </div>

      <div className="text-zinc-600 text-[10px]">{points.length} points</div>
    </div>
  );
}
