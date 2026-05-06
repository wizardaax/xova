import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const SNAP = "C:\\Xova\\memory\\mesh_snapshot.json";
const PLUGIN = "C:\\Xova\\plugins\\mesh_snapshot.py";

interface Board {
  xova?: { alive: boolean; last_seen?: number };
  jarvis?: { alive: boolean };
  forge?: { alive: boolean; mode?: string; forge_mode?: string };
  absorb?: { alive: boolean; cycles?: number };
  [key: string]: unknown;
}

interface Snap {
  ts: number;
  ts_iso: string;
  board: Board;
  recent_feed: Record<string, unknown>[];
  recent_forge: Record<string, unknown>[];
  feed_total_lines: number;
  evolution_count: number;
}

function Dot({ alive }: { alive: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full mr-1 ${alive ? "bg-emerald-400" : "bg-red-500"}`} />
  );
}

export function MeshControl({ onClose }: { onClose: () => void }) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");

  const runSnapshot = useCallback(async () => {
    setStatus("running snapshot…");
    setErr("");
    try {
      await invoke<string>("xova_run", { command: `"${PY}" "${PLUGIN}"`, cwd: "C:\\Xova", elevated: false });
    } catch (e) {
      setErr(String(e));
      setStatus("");
      return;
    }
    try {
      const raw = await invoke<string>("xova_read_file", { path: SNAP });
      setSnap(JSON.parse(raw));
      setStatus("ok");
    } catch (e) {
      setErr("read failed: " + String(e));
      setStatus("");
    }
  }, []);

  useEffect(() => {
    runSnapshot();
    const id = setInterval(runSnapshot, 15_000);
    return () => clearInterval(id);
  }, [runSnapshot]);

  const dispatch = useCallback(async (taskType: string) => {
    setStatus(`dispatching ${taskType}…`);
    setErr("");
    try {
      await invoke("dispatch_mesh", { taskType, args: "{}" });
      setStatus(`${taskType} dispatched`);
    } catch (e) {
      setErr(String(e));
      setStatus("");
    }
  }, []);

  const b = snap?.board ?? {};

  return (
    <div className="font-mono text-[11px] text-zinc-300 flex flex-col gap-2 p-1">
      <div className="border border-zinc-800 rounded p-2 bg-zinc-900">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Board</div>
        {(["xova", "jarvis", "forge", "absorb"] as const).map(k => {
          const agent = b[k] as { alive?: boolean; cycles?: number; forge_mode?: string } | undefined;
          const alive = agent?.alive ?? false;
          return (
            <div key={k} className="flex items-center gap-1 leading-5">
              <Dot alive={alive} />
              <span className="w-12 text-zinc-400">{k}</span>
              <span className={alive ? "text-emerald-400" : "text-red-400"}>{alive ? "alive" : "dead"}</span>
              {k === "absorb" && agent?.cycles != null && (
                <span className="text-zinc-500 ml-1">· {agent.cycles} cycles</span>
              )}
              {k === "forge" && agent?.forge_mode && (
                <span className="text-zinc-500 ml-1">· {agent.forge_mode}</span>
              )}
            </div>
          );
        })}
      </div>

      {snap && (
        <div className="border border-zinc-800 rounded p-2 bg-zinc-900 flex gap-4">
          <div><span className="text-zinc-500">feed lines </span><span className="text-emerald-300">{snap.feed_total_lines}</span></div>
          <div><span className="text-zinc-500">evolutions </span><span className="text-emerald-300">{snap.evolution_count}</span></div>
        </div>
      )}

      {snap && snap.recent_feed.length > 0 && (
        <div className="border border-zinc-800 rounded p-2 bg-zinc-900">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Recent Feed</div>
          {snap.recent_feed.map((e, i) => (
            <div key={i} className="truncate text-zinc-400 leading-4">
              <span className="text-zinc-600 mr-1">{String(e.kind ?? "")}</span>
              {String(e.content ?? e.label ?? "")}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => dispatch("coherence")}
          className="px-2 py-1 rounded border border-zinc-700 bg-zinc-800 hover:border-emerald-600 hover:text-emerald-300 transition-colors"
        >▶ Run Cycle</button>
        <button
          onClick={runSnapshot}
          className="px-2 py-1 rounded border border-zinc-700 bg-zinc-800 hover:border-emerald-600 hover:text-emerald-300 transition-colors"
        >🔄 Snapshot</button>
        <button
          onClick={() => dispatch("evolve")}
          className="px-2 py-1 rounded border border-zinc-700 bg-zinc-800 hover:border-emerald-600 hover:text-emerald-300 transition-colors"
        >📊 Evolution</button>
      </div>

      {status && <div className="text-emerald-400 text-[10px]">{status}</div>}
      {err    && <div className="text-red-400 text-[10px] break-all">{err}</div>}
      {snap   && <div className="text-zinc-600 text-[10px]">{snap.ts_iso}</div>}
    </div>
  );
}
