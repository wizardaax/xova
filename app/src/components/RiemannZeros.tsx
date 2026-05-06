import { useState } from "react";

const PHI = (1 + Math.sqrt(5)) / 2;
const TAU = 2 * Math.PI;

const ZEROS = [
  14.134725, 21.022040, 25.010858, 30.424876, 32.935062,
  37.586178, 40.918719, 43.327073, 48.005151, 49.773832,
  52.970321, 56.446247, 59.347044, 60.831779, 65.112544,
  67.079811, 69.546402, 72.067158, 75.704691, 77.144840,
];

function polarToXY(r: number, theta: number, cx: number, cy: number) {
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
}

const CX = 140, CY = 140, RMAX = 120;

export function RiemannZeros({ onClose }: { onClose: () => void }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const points = ZEROS.map((t, i) => {
    const theta = (t * PHI) % TAU;
    const r = RMAX * (0.3 + 0.7 * (i / ZEROS.length));
    return { t, theta, ...polarToXY(r, theta, CX, CY), i };
  });

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Riemann Zeros · φ-mod-2π</span>
        <button onClick={onClose} className="ml-auto text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1">
          <svg width={280} height={280} viewBox="0 0 280 280">
            <rect width={280} height={280} fill="#09090b" rx="6" />
            {[0.25, 0.5, 0.75, 1.0].map(r => (
              <circle key={r} cx={CX} cy={CY} r={RMAX * r} fill="none" stroke="#27272a" strokeWidth={0.5} />
            ))}
            <line x1={CX - RMAX} y1={CY} x2={CX + RMAX} y2={CY} stroke="#27272a" strokeWidth={0.5} />
            <line x1={CX} y1={CY - RMAX} x2={CX} y2={CY + RMAX} stroke="#27272a" strokeWidth={0.5} />
            {points.map(p => {
              const isHov = hovered === p.i;
              const frac = p.i / ZEROS.length;
              const hue = Math.round(160 - frac * 80);
              return (
                <g key={p.i}>
                  <circle
                    cx={p.x} cy={p.y} r={isHov ? 6 : 4}
                    fill={`hsl(${hue},70%,55%)`}
                    opacity={isHov ? 1 : 0.75}
                    style={{ cursor: "pointer", transition: "r 0.1s" }}
                    onMouseEnter={() => setHovered(p.i)}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {isHov && (
                    <text x={p.x + 8} y={p.y + 4} fontSize={9} fill="#e4e4e7">
                      t={p.t.toFixed(3)}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={CX} y={12} textAnchor="middle" fontSize={8} fill="#52525b">t·φ mod 2π — first 20 zeros</text>
            <text x={CX} y={272} textAnchor="middle" fontSize={8} fill="#52525b">φ = {PHI.toFixed(6)}</text>
          </svg>
        </div>

        <div className="px-3 pb-4">
          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5">zero table</div>
          <div className="divide-y divide-zinc-900/50">
            {ZEROS.map((t, i) => {
              const theta = (t * PHI) % TAU;
              const isHov = hovered === i;
              return (
                <div key={i}
                  className={`flex items-center gap-2 py-0.5 px-1 rounded text-[10px] cursor-default ${isHov ? "bg-zinc-800/60" : "hover:bg-zinc-900/40"}`}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}>
                  <span className="text-zinc-600 w-4 text-right shrink-0">{i + 1}</span>
                  <span className="text-zinc-300 tabular-nums w-20">{t.toFixed(6)}</span>
                  <span className="text-zinc-500 text-[9px] tabular-nums">θ={theta.toFixed(4)}</span>
                  <span className="text-zinc-600 text-[9px] tabular-nums ml-auto">{(theta / TAU * 360).toFixed(1)}°</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
