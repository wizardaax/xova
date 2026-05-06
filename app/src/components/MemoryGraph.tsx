import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY     = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const PLUGIN = "C:\\Xova\\plugins\\memory_graph_builder.py";
const GRAPH_PATH = "C:\\Xova\\memory\\memory_graph.json";

interface MemNode {
  id: string;
  type: string;
  title: string;
  description: string;
  body: string;
  tags: string[];
  ts: number;
  source: string;
  links: string[];
}
interface MemGraph {
  built_at: number;
  node_count: number;
  nodes: MemNode[];
  by_type: Record<string, string[]>;
}

const TYPE_COLOR: Record<string, string> = {
  feedback:  "border-amber-700 text-amber-300",
  project:   "border-blue-700 text-blue-300",
  user:      "border-emerald-700 text-emerald-300",
  reference: "border-purple-700 text-purple-300",
  commit:    "border-zinc-700 text-zinc-400",
  mesh:      "border-cyan-800 text-cyan-400",
};
const TYPE_BG: Record<string, string> = {
  feedback:  "bg-amber-950/20",
  project:   "bg-blue-950/20",
  user:      "bg-emerald-950/20",
  reference: "bg-purple-950/20",
  commit:    "bg-zinc-900/30",
  mesh:      "bg-cyan-950/20",
};

export function MemoryGraph({ onClose }: { onClose: () => void }) {
  const [graph, setGraph]       = useState<MemGraph | null>(null);
  const [query, setQuery]       = useState("");
  const [typeFilter, setType]   = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [status, setStatus]     = useState("");

  async function loadGraph() {
    try {
      const raw = await invoke<string>("xova_read_file", { path: GRAPH_PATH });
      setGraph(JSON.parse(raw) as MemGraph);
    } catch {
      setStatus("No graph yet — click Rebuild to build.");
    }
  }

  async function rebuild() {
    setBuilding(true);
    setStatus("building…");
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PY}" "${PLUGIN}"`, cwd: "C:\\Xova", elevated: false,
      });
      let stdout = raw;
      try { const w = JSON.parse(raw) as { stdout?: string }; if (w.stdout) stdout = w.stdout; } catch { /**/ }
      const r = JSON.parse(stdout.trim()) as { ok: boolean; node_count?: number; build_ms?: number; error?: string };
      if (r.ok) {
        setStatus(`✓ ${r.node_count} nodes · ${r.build_ms}ms`);
        await loadGraph();
      } else {
        setStatus(`error: ${r.error ?? "unknown"}`);
      }
    } catch (e) {
      setStatus(String(e));
    }
    setBuilding(false);
  }

  useEffect(() => { loadGraph(); }, []);

  const allTypes = useMemo(() => {
    if (!graph) return [];
    return Object.keys(graph.by_type).sort((a, b) => (graph.by_type[b]?.length ?? 0) - (graph.by_type[a]?.length ?? 0));
  }, [graph]);

  const filtered = useMemo(() => {
    if (!graph) return [];
    const q = query.toLowerCase();
    return graph.nodes
      .filter(n => !typeFilter || n.type === typeFilter)
      .filter(n => !q || n.title.toLowerCase().includes(q) || n.description.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
      .sort((a, b) => b.ts - a.ts);
  }, [graph, query, typeFilter]);

  const selectedNode = useMemo(() => graph?.nodes.find(n => n.id === selected) ?? null, [graph, selected]);
  const linkedNodes  = useMemo(() => {
    if (!selectedNode || !graph) return [];
    return selectedNode.links.map(id => graph.nodes.find(n => n.id === id)).filter(Boolean) as MemNode[];
  }, [selectedNode, graph]);

  const builtAt = graph ? new Date(graph.built_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Memory Graph</span>
        {builtAt && <span className="text-zinc-700 text-[9px]">· built {builtAt}</span>}
        {graph && <span className="text-zinc-600 text-[9px]">· {graph.node_count} nodes</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={rebuild} disabled={building}
            className="text-[9px] border border-zinc-700 rounded px-2 py-0.5 text-zinc-400 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-40">
            {building ? "building…" : "⟳ Rebuild"}
          </button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>

      {/* Status */}
      {status && (
        <div className="px-3 py-1 text-[9px] text-zinc-600 border-b border-zinc-900 shrink-0">{status}</div>
      )}

      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-900 shrink-0">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="search nodes…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-[10px] text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-emerald-700" />
      </div>

      {/* Type filter pills */}
      {allTypes.length > 0 && (
        <div className="flex gap-1 px-3 py-1.5 border-b border-zinc-900 flex-wrap shrink-0">
          <button onClick={() => setType(null)}
            className={`px-2 py-0.5 rounded border text-[9px] ${!typeFilter ? "border-emerald-700 text-emerald-300 bg-emerald-950/30" : "border-zinc-800 text-zinc-500 hover:border-zinc-600"}`}>
            all {graph ? `(${graph.node_count})` : ""}
          </button>
          {allTypes.map(t => (
            <button key={t} onClick={() => setType(t === typeFilter ? null : t)}
              className={`px-2 py-0.5 rounded border text-[9px] transition-colors ${typeFilter === t ? (TYPE_COLOR[t] ?? "border-zinc-700 text-zinc-300") + " " + (TYPE_BG[t] ?? "") : "border-zinc-800 text-zinc-500 hover:border-zinc-600"}`}>
              {t} ({graph?.by_type[t]?.length ?? 0})
            </button>
          ))}
        </div>
      )}

      {/* Split: list + detail */}
      <div className="flex-1 overflow-hidden flex">

        {/* Node list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-4 text-zinc-700 text-[9px] text-center">
              {graph ? "no nodes match" : "no graph loaded"}
            </div>
          )}
          {filtered.map(n => {
            const col = TYPE_COLOR[n.type] ?? "border-zinc-700 text-zinc-400";
            const bg  = TYPE_BG[n.type] ?? "bg-zinc-900/20";
            const isSelected = selected === n.id;
            return (
              <div key={n.id} onClick={() => setSelected(isSelected ? null : n.id)}
                className={`px-3 py-2 border-b border-zinc-900 cursor-pointer transition-colors ${isSelected ? "bg-zinc-800/50" : "hover:bg-zinc-900/60"}`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[8px] rounded border px-1 py-px ${col} ${bg} shrink-0`}>{n.type}</span>
                  <span className="text-zinc-200 text-[10px] truncate">{n.title}</span>
                  {n.links.length > 0 && (
                    <span className="ml-auto text-zinc-700 text-[8px] shrink-0">⬡{n.links.length}</span>
                  )}
                </div>
                {n.description && (
                  <div className="text-zinc-600 text-[9px] truncate pl-0.5">{n.description}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <div className="w-52 shrink-0 border-l border-zinc-800 overflow-y-auto bg-zinc-950">
            <div className="p-3 space-y-2">
              <div className={`text-[8px] rounded border px-1 py-px inline-block ${TYPE_COLOR[selectedNode.type] ?? "border-zinc-700 text-zinc-400"} ${TYPE_BG[selectedNode.type] ?? ""}`}>
                {selectedNode.type}
              </div>
              <div className="text-zinc-200 text-[10px] font-semibold leading-snug">{selectedNode.title}</div>
              {selectedNode.description && (
                <div className="text-zinc-500 text-[9px] leading-relaxed">{selectedNode.description}</div>
              )}
              <div className="border-t border-zinc-900 pt-2 text-zinc-500 text-[9px] leading-relaxed whitespace-pre-wrap break-words">
                {selectedNode.body}
              </div>
              <div className="text-zinc-700 text-[8px]">
                {selectedNode.source} · {new Date(selectedNode.ts * 1000).toLocaleDateString()}
              </div>
              {linkedNodes.length > 0 && (
                <div className="border-t border-zinc-900 pt-2">
                  <div className="text-[8px] uppercase tracking-wider text-zinc-600 mb-1">Linked ({linkedNodes.length})</div>
                  {linkedNodes.map(ln => (
                    <div key={ln.id} onClick={() => setSelected(ln.id)}
                      className="py-1 cursor-pointer hover:text-zinc-200 transition-colors">
                      <span className={`text-[8px] mr-1 ${TYPE_COLOR[ln.type]?.split(" ")[1] ?? "text-zinc-500"}`}>{ln.type}</span>
                      <span className="text-zinc-400 text-[9px] truncate">{ln.title.slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
