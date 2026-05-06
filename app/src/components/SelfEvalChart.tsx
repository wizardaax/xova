import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const FORGE_PATH = "C:\\Xova\\memory\\forge_events.jsonl";
const POLL_MS = 15_000;
const CHART_W = 360; const CHART_H = 56;
const BUCKETS = 12; const BUCKET_MS = 10 * 60_000;

interface SelfEvalEvent { ts: number; risk: number; note: string; user_query: string; answered: boolean; flagged: boolean }

function parseEvents(raw: string): SelfEvalEvent[] {
  const lines = raw.split("\n").filter(Boolean);
  const flaggedTs = new Set<number>();
  for (const l of lines) { try { const e = JSON.parse(l); if (e.kind === "self-eval-flagged" || e.kind === "self_eval_flagged") flaggedTs.add(e.ts); } catch { /* skip */ } }
  return lines.flatMap(l => {
    try {
      const e = JSON.parse(l);
      if ((e.kind === "self-eval" || e.kind === "self_eval") && typeof e.risk === "number")
        return [{ ts: e.ts, risk: e.risk, note: e.note ?? "", user_query: e.user_query ?? "", answered: e.answered ?? true, flagged: flaggedTs.has(e.ts) }];
    } catch { /* skip */ }
    return [];
  });
}

function fmt(ts: number) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

function RiskLine({ events }: { events: SelfEvalEvent[] }) {
  if (!events.length) return <svg width={CHART_W} height={CHART_H}><text x={CHART_W/2} y={CHART_H/2} textAnchor="middle" fill="#52525b" fontSize="10">no data</text></svg>;
  const pts: [number,number][] = events.map((e,i) => [events.length===1?CHART_W/2:(i/(events.length-1))*CHART_W, (1-e.risk/5)*(CHART_H-4)+2]);
  const poly = pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={CHART_W} height={CHART_H} className="block">
      <polygon points={`0,${CHART_H} ${poly} ${CHART_W},${CHART_H}`} fill="#f87171" fillOpacity="0.12" />
      <polyline points={poly} fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinejoin="round" />
      {pts.map(([x,y],i) => events[i].flagged && <circle key={i} cx={x} cy={y} r={3} fill="#fbbf24" />)}
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r={3} fill="#f87171" />
    </svg>
  );
}

function FreqBars({ events }: { events: SelfEvalEvent[] }) {
  const now = Date.now();
  const buckets = Array.from({length:BUCKETS},(_,i) => ({ count:0, start:now-(BUCKETS-i)*BUCKET_MS, end:now-(BUCKETS-1-i)*BUCKET_MS }));
  for (const e of events) { const b = buckets.find(b => e.ts>=b.start && e.ts<b.end); if (b) b.count++; }
  const max = Math.max(1, ...buckets.map(b=>b.count));
  const bw = (CHART_W-2*(BUCKETS-1))/BUCKETS;
  return (
    <svg width={CHART_W} height={CHART_H} className="block pb-3">
      {buckets.map((b,i) => { const h=(b.count/max)*(CHART_H-6); const c=b.count===0?"#27272a":b.count>=3?"#f87171":"#34d399"; return (
        <rect key={i} x={i*(bw+2)} y={CHART_H-h-3} width={bw} height={h||1} fill={c} fillOpacity={b.count?0.75:0.3} rx={1} />
      );})}
    </svg>
  );
}

export function SelfEvalChart({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<SelfEvalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try { const raw = await invoke<string>("xova_read_file", { path: FORGE_PATH }); setEvents(parseEvents(raw)); } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { load(); timerRef.current = setInterval(load, POLL_MS); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const avg = events.length ? (events.reduce((s,e)=>s+e.risk,0)/events.length).toFixed(2) : "—";
  const max = events.length ? Math.max(...events.map(e=>e.risk)) : 0;
  const flagged = events.filter(e=>e.flagged).length;
  const recent = [...events].reverse().slice(0,10);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px] overflow-y-auto p-3 space-y-3">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Self-Eval Monitor</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>
      {loading && <div className="text-zinc-600 text-center">loading…</div>}
      <div><div className="text-[9px] text-zinc-600 mb-1">Risk over time (1–5 · 🟡=flagged)</div><div className="bg-zinc-900 rounded p-2"><RiskLine events={events} /></div></div>
      <div><div className="text-[9px] text-zinc-600 mb-1">Frequency (10-min buckets, last 2h)</div><div className="bg-zinc-900 rounded p-2"><FreqBars events={events} /></div></div>
      <div className="grid grid-cols-4 gap-1">
        {([["avg", avg], ["max", max||"—"], ["total", events.length], ["flagged", flagged]] as [string, string|number][]).map(([l,v]) => (
          <div key={l} className="bg-zinc-900 rounded p-2 text-center"><div className="text-[9px] text-zinc-600 uppercase">{l}</div><div className="text-sm font-bold text-emerald-300">{v}</div></div>
        ))}
      </div>
      <div className="space-y-1">
        <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Recent 10</div>
        {recent.map((e,i) => (
          <div key={i} className={`bg-zinc-900 rounded p-1.5 border-l-2 ${e.flagged?"border-yellow-500":"border-zinc-700"}`}>
            <div className="flex gap-2">
              <span className={e.risk>=4?"text-red-400":e.risk>=3?"text-amber-400":"text-emerald-400"}>r{e.risk}</span>
              {e.flagged&&<span className="text-yellow-400 text-[9px]">FLAGGED</span>}
              <span className="ml-auto text-zinc-600 text-[9px]">{fmt(e.ts)}</span>
            </div>
            <div className="text-zinc-500 truncate text-[9px]">{e.user_query}</div>
          </div>
        ))}
      </div>
      <button onClick={load} className="py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-500 text-[9px] uppercase tracking-wider">↻ refresh</button>
    </div>
  );
}
