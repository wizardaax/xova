import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}

/**
 * Sci-fi command surface — Ctrl+K opens it. Search-as-you-type filters every
 * feature in the app. Pressing Enter fires the highlighted item; Esc closes.
 *
 * Designed to be the SECOND surface (after the chat) — most buttons in the
 * action row collapse into this so the main UI breathes. Nothing is removed,
 * just relocated.
 */
export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const lc = q.trim().toLowerCase();
  const filtered = lc
    ? items.filter((it) =>
        it.label.toLowerCase().includes(lc) ||
        (it.hint ?? "").toLowerCase().includes(lc) ||
        it.group.toLowerCase().includes(lc)
      )
    : items;
  const safeIdx = Math.min(idx, Math.max(0, filtered.length - 1));

  // Group items for visual rhythm
  const grouped: Record<string, PaletteItem[]> = {};
  for (const it of filtered) {
    (grouped[it.group] ??= []).push(it);
  }
  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-zinc-950 border border-emerald-900 rounded-lg shadow-[0_0_40px_rgba(16,185,129,0.15)] font-mono overflow-hidden"
      >
        <div className="border-b border-zinc-900 px-4 py-3 flex items-center gap-2">
          <span className="text-emerald-500 text-sm">⌘</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
              if (e.key === "ArrowUp")   { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); return; }
              if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[safeIdx];
                if (item) { onClose(); item.run(); }
              }
            }}
            placeholder="Type a command, or search…"
            className="flex-1 bg-transparent border-0 outline-none text-zinc-100 text-sm placeholder-zinc-600"
          />
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{filtered.length}</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-600 text-xs">No matching commands.</div>
          )}
          {Object.entries(grouped).map(([group, gitems]) => (
            <div key={group}>
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 border-t border-zinc-900 first:border-t-0">{group}</div>
              {gitems.map((it) => {
                const myIdx = runningIdx++;
                const active = myIdx === safeIdx;
                return (
                  <button
                    key={it.id}
                    onMouseEnter={() => setIdx(myIdx)}
                    onClick={() => { onClose(); it.run(); }}
                    className={cn(
                      "w-full text-left px-4 py-2 flex items-center justify-between gap-3 text-xs",
                      active ? "bg-emerald-900/30 text-emerald-300" : "text-zinc-300 hover:bg-zinc-900"
                    )}
                  >
                    <span>{it.label}</span>
                    {it.hint && <span className={cn("text-[10px] truncate max-w-[200px]", active ? "text-emerald-500" : "text-zinc-600")}>{it.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-zinc-900 px-4 py-1.5 flex items-center gap-3 text-[10px] text-zinc-600 uppercase tracking-wider">
          <span><kbd className="text-zinc-400">↑↓</kbd> navigate</span>
          <span><kbd className="text-zinc-400">↵</kbd> run</span>
          <span><kbd className="text-zinc-400">esc</kbd> close</span>
          <span className="ml-auto text-zinc-700">⌘ palette</span>
        </div>
      </div>
    </div>
  );
}
