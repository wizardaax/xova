import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const NOTES_PATH = "C:\\Xova\\memory\\forge_notes.md";

export function ForgeNotes({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState("");
  const [filter, setFilter]   = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [sizeKb, setSizeKb]   = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: NOTES_PATH });
      setContent(raw);
      setSizeKb(Math.round(raw.length / 1024 * 10) / 10);
      setUpdatedAt(new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const lines = content.split("\n");
  const q = filter.toLowerCase().trim();

  const visible: { line: string; lineIdx: number; match: boolean }[] = [];
  if (!q) {
    lines.forEach((line, i) => visible.push({ line, lineIdx: i, match: false }));
  } else {
    lines.forEach((line, i) => {
      const lower = line.toLowerCase();
      if (lower.includes(q)) {
        const start = Math.max(0, i - 1);
        const end   = Math.min(lines.length - 1, i + 2);
        for (let j = start; j <= end; j++) {
          if (!visible.find(v => v.lineIdx === j)) {
            visible.push({ line: lines[j], lineIdx: j, match: j === i });
          }
        }
      }
    });
    visible.sort((a, b) => a.lineIdx - b.lineIdx);
  }

  function renderLine(line: string, match: boolean, idx: number) {
    const isH1 = line.startsWith("# ");
    const isH2 = line.startsWith("## ");
    const isH3 = line.startsWith("### ");
    const isBullet = line.match(/^[-*] /);
    const isCode = line.startsWith("    ") || line.startsWith("\t");

    let cls = "text-zinc-400 text-[9px] leading-relaxed ";
    if (isH1) cls = "text-zinc-100 text-[11px] font-bold mt-3 mb-0.5 border-b border-zinc-800 pb-0.5 ";
    else if (isH2) cls = "text-zinc-200 text-[10px] font-semibold mt-2 mb-0.5 ";
    else if (isH3) cls = "text-zinc-300 text-[9px] font-semibold mt-1 ";
    else if (isCode) cls = "text-cyan-300 text-[8px] font-mono bg-zinc-900/60 ";
    else if (isBullet) cls = "text-zinc-300 text-[9px] pl-2 ";
    if (match) cls += "bg-yellow-900/30 ";

    return (
      <div key={idx} className={cls.trim() + " whitespace-pre-wrap break-words"}>
        {line || " "}
      </div>
    );
  }

  const matchCount = visible.filter(v => v.match).length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Forge Notes{updatedAt ? ` · ${updatedAt}` : ""}
        </span>
        {sizeKb > 0 && (
          <span className="text-zinc-700 text-[8px]">{sizeKb} KB</span>
        )}
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0 flex items-center gap-2">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="search notes…"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[9px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-500"
        />
        {q && (
          <span className="text-zinc-600 text-[8px] shrink-0">{matchCount} match{matchCount !== 1 ? "es" : ""}</span>
        )}
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {content === "" && (
          <div className="text-zinc-600 text-[10px] text-center py-4">no notes yet</div>
        )}
        {visible.map(({ line, lineIdx, match }) => renderLine(line, match, lineIdx))}
      </div>
    </div>
  );
}
