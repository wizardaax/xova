import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FeedEntry {
  ts: number;
  kind: string;
  agent_id: string;
  label: string;
  content: string;
  coherence?: number;
  gated?: boolean;
  human_gate?: boolean;
  risk?: string;
  version?: string;
}

const FEED_PATH = "C:\\Xova\\memory\\mesh_feed.jsonl";
const MAX_ENTRIES = 300;

const AGENT_COLOR: Record<string, string> = {
  "00": "text-zinc-400",
  "01": "text-emerald-400",
  "02": "text-blue-400",
  "03": "text-violet-400",
  "04": "text-red-400",
  "05": "text-amber-400",
  "06": "text-yellow-300",
  "07": "text-teal-400",
  "08": "text-orange-400",
  "09": "text-cyan-400",
  "10": "text-lime-400",
  "11": "text-green-400",
  "12": "text-indigo-400",
  "13": "text-pink-400",
  "EV": "text-fuchsia-400",
};

function parseLines(raw: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as FeedEntry); } catch { /* skip */ }
  }
  return out;
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function CoherenceDot({ v }: { v?: number }) {
  if (v == null) return null;
  const color = v >= 0.8 ? "bg-emerald-400" : v >= 0.6 ? "bg-amber-400" : "bg-red-400";
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 self-center ${color}`}
      title={`coherence ${v.toFixed(2)}`}
    />
  );
}

export function MeshFeed() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [running, setRunning] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const knownLen   = useRef(0);

  const poll = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: FEED_PATH });
      if (raw.length !== knownLen.current) {
        knownLen.current = raw.length;
        const parsed = parseLines(raw);
        setEntries(parsed.slice(-MAX_ENTRIES));
        setRunning(parsed.length > 0 && Date.now() / 1000 - parsed[parsed.length - 1].ts < 120);
      }
    } catch {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const h = window.setInterval(poll, 2000);
    return () => window.clearInterval(h);
  }, [poll]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600 text-[11px] font-mono p-4">
        <div className="text-2xl">⬡</div>
        <div className="text-center">
          {running ? "mesh active — waiting for first cycle…" : "mesh runner offline"}
        </div>
        {!running && (
          <div className="text-[10px] text-zinc-700 text-center">
            start mesh_runner.py to bring the fleet online
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-900 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
          snell-vern mesh · {entries.length} events
        </span>
      </div>

      {/* feed */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 font-mono text-[11px]">
        {entries.map((e, i) => {
          if (e.kind === "cycle_start") {
            return (
              <div key={i} className="flex items-center gap-1.5 py-0.5 opacity-40">
                <span className="text-zinc-700 shrink-0">──</span>
                <span className="text-zinc-600">{fmt(e.ts)}</span>
                <span className="text-zinc-600 truncate">{e.content}</span>
              </div>
            );
          }
          if (e.kind === "cycle_end") {
            return (
              <div key={i} className="flex items-center gap-1.5 py-0.5 opacity-60">
                <span className="text-zinc-700 shrink-0 w-[52px]" />
                <CoherenceDot v={e.coherence} />
                <span className="text-zinc-500 truncate">{e.content}</span>
              </div>
            );
          }

          // evolution events — fuchsia theme
          if (e.kind === "evo_start") {
            return (
              <div key={i} className="flex items-center gap-1.5 py-1 mt-1 border-t border-fuchsia-900/40">
                <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
                <span className="text-fuchsia-400 shrink-0 font-bold">EV</span>
                <span className="text-fuchsia-300 truncate">{e.content}</span>
              </div>
            );
          }
          if (e.kind === "evo_observe") {
            return (
              <div key={i} className="flex items-start gap-1.5 py-0.5">
                <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
                <span className="text-fuchsia-400 shrink-0 font-bold">EV</span>
                <CoherenceDot v={e.coherence} />
                <span className="text-fuchsia-300/80 truncate">{e.content}</span>
              </div>
            );
          }
          if (e.kind === "evo_proposal") {
            return (
              <div key={i} className={`flex items-start gap-1.5 py-0.5 rounded px-1 ${e.human_gate ? "bg-amber-950/10" : ""}`}>
                <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
                <span className="text-fuchsia-400 shrink-0 font-bold">EV</span>
                <span className={`${e.human_gate ? "text-amber-400" : "text-fuchsia-300"} truncate`}>{e.content}</span>
              </div>
            );
          }
          if (e.kind === "evo_apply") {
            const applied = !e.human_gate;
            return (
              <div key={i} className={`flex items-start gap-1.5 py-0.5 rounded px-1 ${applied ? "bg-fuchsia-950/20" : "bg-amber-950/10"}`}>
                <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
                <span className="text-fuchsia-400 shrink-0 font-bold">EV</span>
                <span className={`${applied ? "text-fuchsia-200" : "text-amber-300"} truncate`}>{e.content}</span>
              </div>
            );
          }
          if (e.kind === "evo_end") {
            return (
              <div key={i} className="flex items-center gap-1.5 py-0.5 border-b border-fuchsia-900/30 mb-1">
                <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
                <span className="text-fuchsia-400 shrink-0 font-bold">EV</span>
                <span className="text-fuchsia-300 font-semibold truncate">{e.content}</span>
              </div>
            );
          }

          if (e.kind === "runner_start") {
            return (
              <div key={i} className="flex items-center gap-1.5 py-0.5 opacity-60">
                <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
                <span className="text-zinc-400 shrink-0 font-bold">00</span>
                <span className="text-zinc-400 truncate">{e.content}</span>
              </div>
            );
          }

          if (e.kind === "error") {
            return (
              <div key={i} className="flex items-start gap-1.5 py-0.5 bg-red-950/20 rounded px-1">
                <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
                <span className="text-red-400 shrink-0 font-bold">{e.agent_id}</span>
                <span className="text-red-300 break-all">{e.content}</span>
              </div>
            );
          }

          // normal agent result
          const color = AGENT_COLOR[e.agent_id] ?? "text-zinc-400";
          return (
            <div key={i} className="flex items-start gap-1.5 py-0.5 leading-snug">
              <span className="text-zinc-700 shrink-0 w-[52px] text-right">{fmt(e.ts)}</span>
              <span className={`shrink-0 w-[22px] text-center font-bold ${color}`}>{e.agent_id}</span>
              <CoherenceDot v={e.coherence} />
              <span className={`${color} shrink-0 min-w-[115px]`}>{e.label}</span>
              <span className="text-zinc-400 truncate">{e.content}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
