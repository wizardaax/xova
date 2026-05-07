import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const RATE_PATH = "C:\\Xova\\memory\\forge_rate_log.json";

interface RateData { timestamps?: number[]; }

function bucketByHour(tss: number[]): { hour: string; count: number }[] {
  const map: Record<string, number> = {};
  for (const ts of tss) {
    const d = new Date((ts > 1e12 ? ts : ts * 1000));
    const key = `${String(d.getHours()).padStart(2, "0")}:00`;
    map[key] = (map[key] ?? 0) + 1;
  }
  return Object.entries(map).sort(([a], [b]) => a < b ? -1 : 1).map(([hour, count]) => ({ hour, count }));
}

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtTime(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function ForgeRateLog({ onClose }: { onClose: () => void }) {
  const [tss,     setTss]     = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: RATE_PATH });
      const d = JSON.parse(raw) as RateData;
      setTss(d.timestamps ?? []);
    } catch { setTss([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  const buckets = bucketByHour(tss);
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const last = tss.length ? tss[tss.length - 1] : null;

  // Inter-call gaps for rate analysis
  const gaps = tss.slice(1).map((t, i) => {
    const gapS = (t > 1e12 ? t / 1000 : t) - (tss[i] > 1e12 ? tss[i] / 1000 : tss[i]);
    return gapS;
  });
  const avgGap = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Forge Rate Log</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="flex gap-4 px-3 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">invocations</span>
          <span className="text-zinc-200">{tss.length}</span>
        </div>
        {last !== null && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-zinc-600 uppercase">last</span>
            <span className="text-zinc-200">{fmtAgo(last)}</span>
          </div>
        )}
        {avgGap !== null && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-zinc-600 uppercase">avg gap</span>
            <span className="text-zinc-200">
              {avgGap < 60 ? `${avgGap.toFixed(0)}s` : `${(avgGap / 60).toFixed(1)}m`}
            </span>
          </div>
        )}
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {!loading && tss.length === 0 && <div className="flex-1 flex items-center justify-center text-zinc-600">no data</div>}

      {/* Hourly bar chart */}
      {buckets.length > 0 && (
        <div className="px-3 py-3 border-b border-zinc-800 shrink-0">
          <div className="text-[8px] text-zinc-600 uppercase mb-2">by hour</div>
          <div className="space-y-1">
            {buckets.map(({ hour, count }) => (
              <div key={hour} className="flex items-center gap-2">
                <span className="text-zinc-600 text-[8px] w-10 shrink-0">{hour}</span>
                <div className="flex-1 h-2 bg-zinc-800 rounded overflow-hidden">
                  <div className="h-full bg-amber-600/70 rounded"
                    style={{ width: `${Math.round((count / maxCount) * 100)}%` }} />
                </div>
                <span className="text-zinc-400 text-[8px] w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent timestamps */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="text-[8px] text-zinc-600 uppercase mb-2">recent</div>
        {[...tss].reverse().slice(0, 50).map((ts, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5 border-b border-zinc-900/40">
            <span className="text-zinc-500 text-[9px]">{fmtTime(ts)}</span>
            <span className="text-zinc-700 text-[8px] ml-auto">{fmtAgo(ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
