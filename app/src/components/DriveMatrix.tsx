import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN = "C:\\Xova\\plugins\\drive_matrix_probe.py";
const REFRESH_MS = 30_000;

type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal };
interface ProbeResult { ok: boolean; data?: { [k: string]: JsonVal }; error?: string }

function Sparkline({ values }: { values: number[] }) {
  const W = 120, H = 24, PAD = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const barW = Math.max(1, (W - PAD * 2) / values.length - 1);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block align-middle ml-1 opacity-80">
      <rect x={0} y={0} width={W} height={H} fill="#18181b" rx="2" />
      {values.map((v, i) => {
        const bh = Math.max(1, ((v - min) / range) * (H - PAD * 2));
        return <rect key={i} x={PAD + i * (barW + 1)} y={H - PAD - bh} width={barW} height={bh} fill="#34d399" opacity={0.7} />;
      })}
    </svg>
  );
}

function isNumericArray(v: JsonVal): v is number[] {
  return Array.isArray(v) && v.length >= 3 && v.every(x => typeof x === "number" && isFinite(x as number));
}

function JsonNode({ keyName, value, depth, defaultOpen }: { keyName?: string; value: JsonVal; depth: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? depth < 2);
  const indent = depth * 12;
  const isObj = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArr = Array.isArray(value);
  const entries = isObj
    ? Object.entries(value as { [k: string]: JsonVal })
    : isArr ? (value as JsonVal[]).map((v, i) => [String(i), v] as [string, JsonVal]) : [];
  const keyColor = depth === 0 ? "text-emerald-400" : depth === 1 ? "text-emerald-300" : "text-zinc-400";
  const openBrace = isArr ? "[" : "{", closeBrace = isArr ? "]" : "}";

  function leafClass(v: JsonVal) {
    if (v === null) return "text-zinc-500";
    if (typeof v === "boolean") return v ? "text-emerald-400" : "text-red-400";
    if (typeof v === "number") return "text-amber-300";
    return "text-zinc-300";
  }
  function leafStr(v: JsonVal) {
    if (v === null) return "null";
    if (typeof v === "string") return `"${v}"`;
    return String(v);
  }

  if (isArr && isNumericArray(value as JsonVal)) {
    const nums = value as number[];
    return (
      <div style={{ paddingLeft: indent }} className="flex items-center gap-1 leading-5">
        {keyName !== undefined && <span className={`${keyColor} mr-0.5`}>{keyName}:</span>}
        <span className="text-zinc-500 text-[10px]">[{nums.length}]</span>
        <Sparkline values={nums} />
        <span className="text-zinc-600 text-[10px] ml-1">min={Math.min(...nums).toFixed(3)} max={Math.max(...nums).toFixed(3)}</span>
      </div>
    );
  }

  if (isObj || isArr) {
    return (
      <div style={{ paddingLeft: indent }}>
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 w-full text-left hover:bg-zinc-800/50 rounded px-0.5 leading-5">
          <span className="text-zinc-500 w-3 text-center select-none">{open ? "▾" : "▸"}</span>
          {keyName !== undefined && <span className={`${keyColor} mr-0.5`}>{keyName}:</span>}
          <span className="text-zinc-600">
            {openBrace}
            {!open && <span className="text-zinc-500">{entries.length} {isArr ? "items" : "keys"}</span>}
            {!open && closeBrace}
          </span>
        </button>
        {open && (
          <div>
            {entries.map(([k, v]) => <JsonNode key={k} keyName={k} value={v} depth={depth + 1} />)}
            <div className="text-zinc-600 leading-5">{closeBrace}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: indent }} className="flex items-center gap-1 leading-5">
      {keyName !== undefined && <span className={`${keyColor} mr-0.5`}>{keyName}:</span>}
      <span className={leafClass(value)}>{leafStr(value)}</span>
    </div>
  );
}

export function DriveMatrix({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed(e => { const n = e + 1; return n >= REFRESH_MS / 1000 ? 0 : n; }), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setElapsed(0);
    try {
      const raw = await invoke<string>("xova_run", { command: `"${PY}" "${PLUGIN}"`, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout !== undefined) stdout = w.stdout; } catch { /* raw */ }
      const parsed = JSON.parse(stdout.trim()) as ProbeResult;
      setResult(parsed);
      setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e) { setResult({ ok: false, error: String(e) }); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, REFRESH_MS); return () => clearInterval(id); }, [refresh]);

  const countdownSec = REFRESH_MS / 1000 - elapsed;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-emerald-600">Drive Matrix</span>
        {updatedAt && <span className="text-zinc-600 text-[9px]">· {updatedAt}</span>}
        <span className="text-zinc-700 text-[9px] ml-auto">↑ {countdownSec}s</span>
        <button onClick={refresh} disabled={loading}
          className="px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-40 text-[10px] transition-colors">
          {loading ? "…" : "↻"}
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 ml-1">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        {loading && !result && <div className="flex items-center justify-center h-full text-zinc-600">probing drive_matrix…</div>}
        {result && !result.ok && (
          <div className="flex flex-col gap-2 items-start">
            <div className="text-amber-400 font-semibold">drive_matrix not available</div>
            <div className="text-zinc-500 text-[10px] break-all">{result.error}</div>
            <div className="mt-2 text-zinc-600 text-[10px]">Expected: <span className="text-zinc-400">D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix\src\snell_vern_matrix\drive_matrix.py</span></div>
          </div>
        )}
        {result?.ok && result.data && (
          <div className="space-y-1">
            {Object.entries(result.data).map(([methodKey, val]) => (
              <div key={methodKey} className="mb-1">
                <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-0.5 border-b border-zinc-800 pb-0.5">{methodKey}()</div>
                <JsonNode value={val} depth={0} defaultOpen={true} />
              </div>
            ))}
          </div>
        )}
        {loading && result && <div className="h-0.5 bg-zinc-800 rounded overflow-hidden mt-2"><div className="h-full bg-emerald-700 animate-pulse w-1/3" /></div>}
      </div>

      <div className="shrink-0 px-3 py-1 border-t border-zinc-800 flex items-center gap-2 text-[9px] text-zinc-700">
        <span>Snell-Vern Drive Matrix</span>
        <span className="ml-auto">{result?.ok ? `${Object.keys(result.data ?? {}).length} methods` : result ? "unavailable" : "—"}</span>
      </div>
    </div>
  );
}
