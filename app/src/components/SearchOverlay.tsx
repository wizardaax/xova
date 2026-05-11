import { useState, useEffect, useRef } from "react";
import { type ChatMessage } from "./Sidebar";

interface Props {
  open: boolean;
  messages: ChatMessage[];
  onClose: () => void;
  onJump: (id: string) => void;
}

export function SearchOverlay({ open, messages, onClose, onJump }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQuery(""); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const results = q.length >= 2
    ? messages.filter(m => m.text.toLowerCase().includes(q)).slice(-30).reverse()
    : [];

  function highlight(text: string): string {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return text.slice(0, 100);
    const start = Math.max(0, idx - 40);
    const excerpt = text.slice(start, start + 160);
    return (start > 0 ? "…" : "") + excerpt + (start + 160 < text.length ? "…" : "");
  }

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-16 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[480px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <span className="text-zinc-500 text-[13px]">🔍</span>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search messages…"
            className="flex-1 bg-transparent text-zinc-100 text-[13px] font-mono focus:outline-none placeholder-zinc-600" />
          <span className="text-zinc-600 text-[11px]">{results.length > 0 ? `${results.length} result${results.length !== 1 ? "s" : ""}` : ""}</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-[12px]">✕</button>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {q.length >= 2 && results.length === 0 && (
            <div className="text-zinc-500 text-[12px] text-center py-8">no messages match "{query}"</div>
          )}
          {results.map(m => (
            <button key={m.id} onClick={() => { onJump(m.id); onClose(); }}
              className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 border-b border-zinc-800/50 transition-colors">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] uppercase font-mono ${m.role === "user" ? "text-emerald-400" : "text-zinc-400"}`}>{m.role}</span>
                <span className="text-zinc-600 text-[10px]">{new Date(m.ts).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className="text-zinc-300 text-[12px] font-mono leading-relaxed">
                {highlight(m.text)}
              </div>
            </button>
          ))}
          {q.length < 2 && (
            <div className="text-zinc-600 text-[12px] text-center py-8">type at least 2 characters</div>
          )}
        </div>
      </div>
    </div>
  );
}
