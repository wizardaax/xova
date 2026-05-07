import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const SHARED_FACTS_PATH  = "C:\\Xova\\memory\\shared_facts.json";
const XOVA_SYNC_PATH     = "C:\\Xova\\memory\\xova_sync_facts.json";

interface JarvisMemoryNode { name: string; description: string; updated_at: string; }
interface JarvisConversation { date: string; summary: string; topics: string; }
interface SyncFacts {
  synced_at?: string;
  user_facts?: string[];
  world_facts?: string[];
  directives?: string[];
  access_counts?: Record<string, number>;
  totals?: { user_facts?: number; world_facts?: number; directives?: number };
}
interface SharedFacts {
  generated_at?: string;
  jarvis?: { memory_nodes?: JarvisMemoryNode[]; recent_conversations?: JarvisConversation[]; };
  xova?: { standing_facts?: string[]; sync_facts?: SyncFacts; };
}

function fmtAge(iso: string): string {
  try {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  } catch { return "?"; }
}

export function SharedFacts({ onClose }: { onClose: () => void }) {
  const [data, setData]         = useState<SharedFacts | null>(null);
  const [xovaSync, setXovaSync] = useState<SyncFacts | null>(null);
  const [view, setView]         = useState<"jarvis" | "xova" | "directives">("jarvis");
  const [updatedAt, setUpdatedAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: SHARED_FACTS_PATH });
      setData(JSON.parse(raw) as SharedFacts);
    } catch { /* ok */ }
    try {
      const raw = await invoke<string>("xova_read_file", { path: XOVA_SYNC_PATH });
      setXovaSync(JSON.parse(raw) as SyncFacts);
    } catch { /* ok */ }
    setUpdatedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const nodes = data?.jarvis?.memory_nodes ?? [];
  const convs  = data?.jarvis?.recent_conversations ?? [];
  const standing = data?.xova?.standing_facts ?? [];
  // prefer the dedicated xova_sync_facts.json (more current) over the bundled sync_facts
  const sync  = xovaSync ?? data?.xova?.sync_facts;
  const directives = sync?.directives ?? [];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Shared Facts{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        {data?.generated_at && (
          <span className="text-zinc-700 text-[8px]">gen {fmtAge(data.generated_at)} ago</span>
        )}
        <div className="flex gap-1 ml-auto">
          {(["jarvis", "xova", "directives"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-1.5 py-0.5 rounded border text-[8px] transition-colors ${
                view === v
                  ? "border-teal-600 text-teal-300 bg-teal-950/30"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}>
              {v === "jarvis" ? `jarvis (${nodes.length})` : v === "xova" ? `xova (${standing.length})` : `directives (${directives.length})`}
            </button>
          ))}
        </div>
        <button onClick={refresh} className="text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Jarvis view — memory nodes + recent conversations */}
      {view === "jarvis" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          <div>
            <div className="text-[8px] uppercase tracking-wider text-zinc-600 mb-1 px-1">memory nodes</div>
            {nodes.length === 0 ? (
              <div className="text-zinc-600 text-[10px] text-center py-2">no nodes</div>
            ) : (
              <div className="space-y-1">
                {nodes.map((n, i) => (
                  <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1.5">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-teal-300 text-[9px] font-bold">{n.name}</span>
                      <span className="text-zinc-700 text-[7px] ml-auto">{fmtAge(n.updated_at)} ago</span>
                    </div>
                    <div className="text-zinc-400 text-[9px] leading-snug">{n.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-wider text-zinc-600 mb-1 px-1">recent conversations</div>
            {convs.length === 0 ? (
              <div className="text-zinc-600 text-[10px] text-center py-2">none</div>
            ) : (
              <div className="space-y-1">
                {convs.map((c, i) => (
                  <div key={i} className="border-b border-zinc-900 py-1.5">
                    <div className="flex items-center gap-1.5 text-[7px] mb-0.5">
                      <span className="text-zinc-500 font-bold">{c.date}</span>
                      <span className="text-zinc-700 truncate flex-1">{c.topics}</span>
                    </div>
                    <div className="text-[9px] text-zinc-300 leading-snug">{c.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Xova view — standing facts + sync stats */}
      {view === "xova" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {sync?.synced_at && (
            <div className="text-[8px] text-zinc-600 px-1">
              synced {fmtAge(sync.synced_at)} ago
              {sync.access_counts && (
                <span className="ml-2">
                  {Object.entries(sync.access_counts).map(([k, v]) => `${k}:${v}`).join(" · ")}
                </span>
              )}
            </div>
          )}
          {sync?.totals && (
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: "user facts", val: sync.totals.user_facts ?? 0 },
                { label: "world facts", val: sync.totals.world_facts ?? 0 },
                { label: "directives", val: sync.totals.directives ?? 0 },
              ].map(({ label, val }) => (
                <div key={label} className="bg-zinc-900 rounded p-1.5 text-center">
                  <div className="text-[7px] text-zinc-600 mb-0.5">{label}</div>
                  <div className="text-teal-300 font-bold text-[12px]">{val}</div>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="text-[8px] uppercase tracking-wider text-zinc-600 mb-1 px-1">standing facts</div>
            {standing.length === 0 ? (
              <div className="text-zinc-600 text-[10px] text-center py-2">none</div>
            ) : (
              <div className="space-y-0.5">
                {standing.map((f, i) => (
                  <div key={i} className="border-l-2 border-zinc-700 pl-2 py-0.5 text-zinc-300 text-[9px] leading-snug">{f}</div>
                ))}
              </div>
            )}
          </div>
          {sync?.user_facts && sync.user_facts.length > 0 && (
            <div>
              <div className="text-[8px] uppercase tracking-wider text-zinc-600 mb-1 px-1">user facts (synced)</div>
              {sync.user_facts.map((f, i) => (
                <div key={i} className="border-l-2 border-teal-800 pl-2 py-0.5 text-zinc-300 text-[9px] leading-snug">{f}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Directives view — Jarvis→Xova behavioral directives */}
      {view === "directives" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div className="text-[7px] text-zinc-600 px-1 pb-1">Jarvis → Xova behavioral directives (deduped)</div>
          {directives.length === 0 ? (
            <div className="text-zinc-600 text-[10px] text-center py-4">no directives</div>
          ) : (
            directives.map((d, i) => (
              <div key={i} className="border-b border-zinc-900 py-1 text-[9px] text-zinc-300 leading-snug">{d}</div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
