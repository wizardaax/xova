import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ArrowsClockwise, Trash } from "@phosphor-icons/react";

interface MemoryNode {
  id: string;
  name: string;
  description: string;
  data: string;
  parent_id: string | null;
  access_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
  data_token_count: number;
}

interface MemoryPanelProps {
  onClose: () => void;
}

/**
 * Browse Jarvis's knowledge graph (memory_nodes table). Top entries by
 * access_count first — those are the facts Jarvis actually leans on. Click
 * 🗑 to permanently delete a node.
 */
export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await invoke<string>("xova_memory_list", { limit: 80 });
      const parsed = JSON.parse(raw) as MemoryNode[];
      setNodes(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete memory node "${name}"?\nThis is permanent — Jarvis will no longer recall it.`)) return;
    try {
      await invoke("xova_memory_delete", { id });
      setNodes((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="px-6 pb-2 shrink-0 flex flex-col items-center gap-1">
      <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 w-full max-w-[680px]">
        <span className="uppercase tracking-wider">jarvis memory ({nodes.length})</span>
        <button onClick={refresh} disabled={loading} title="Re-scan" className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-emerald-400">
          <ArrowsClockwise size={11} className={loading ? "animate-spin" : ""} />
        </button>
        <button onClick={onClose} title="close" className="ml-auto w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400">
          <X size={12} />
        </button>
      </div>
      {error && (
        <div className="text-[10px] text-red-300 font-mono p-1 border border-red-900 rounded bg-red-950/40 max-w-[680px]">
          {error}
        </div>
      )}
      {!error && nodes.length === 0 && !loading && (
        <div className="text-[10px] text-zinc-500 font-mono italic">no memory yet — Jarvis builds this from your chats</div>
      )}
      {nodes.length > 0 && (
        <div className="w-full max-w-[680px] flex flex-col gap-1 max-h-[320px] overflow-y-auto">
          {nodes.map((n) => (
            <div key={n.id} className="border border-zinc-800 rounded p-2 bg-zinc-900 text-[10px] font-mono">
              <div className="flex items-center gap-2">
                <span className="text-emerald-300 font-semibold truncate flex-1">{n.name}</span>
                <span className="text-zinc-600">×{n.access_count}</span>
                <button
                  onClick={() => remove(n.id, n.name)}
                  title="Delete this memory node"
                  className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400"
                >
                  <Trash size={11} />
                </button>
              </div>
              {n.description && (
                <div className="text-zinc-400 mt-0.5 truncate">{n.description}</div>
              )}
              {n.data && (
                <div className="text-zinc-500 mt-0.5 line-clamp-3 whitespace-pre-wrap break-words">{n.data}</div>
              )}
              <div className="text-zinc-700 mt-1 text-[9px]">
                last: {n.last_accessed?.slice(0, 19)} · tokens: {n.data_token_count}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
