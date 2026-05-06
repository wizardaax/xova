import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const NOTES_PATH = "C:\\Xova\\memory\\quick_notes.jsonl";

interface Note { id: string; ts: number; text: string }

function fmt(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + "  " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadNotes(): Promise<Note[]> {
  try {
    const raw = await invoke<string>("xova_read_file", { path: NOTES_PATH });
    return raw.split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as Note]; } catch { return []; } });
  } catch { return []; }
}

async function persistNotes(notes: Note[]) {
  await invoke("xova_write_file", { path: NOTES_PATH, content: notes.map(n => JSON.stringify(n)).join("\n") });
}

export function NotesBrowser({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => loadNotes().then(ns => setNotes([...ns].sort((a, b) => b.ts - a.ts))), []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh]);

  const save = useCallback(async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    const note: Note = { id: `note-${Date.now()}`, ts: Date.now(), text };
    try {
      const existing = await loadNotes();
      await persistNotes([...existing, note]);
      setNotes(prev => [note, ...prev]);
      setDraft("");
      inputRef.current?.focus();
    } catch { /* silent */ }
    setSaving(false);
  }, [draft, saving]);

  const removeNote = useCallback((id: string) => {
    setNotes(prev => {
      const next = prev.filter(n => n.id !== id);
      persistNotes([...next].sort((a, b) => a.ts - b.ts)).catch(() => {});
      return next;
    });
    setConfirmDel(null);
  }, []);

  const filtered = query.trim() ? notes.filter(n => n.text.toLowerCase().includes(query.toLowerCase())) : notes;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Notes · {notes.length}</span>
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>
      <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="search notes…"
          className="w-full bg-zinc-800 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-emerald-600 border border-zinc-700 placeholder-zinc-600" />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 && <div className="text-zinc-600 text-[10px] text-center pt-4">{query ? "no matches" : "no notes yet"}</div>}
        {filtered.map(n => (
          <div key={n.id} className="group border border-zinc-800 rounded bg-zinc-900 px-3 py-2 flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <div className="text-[9px] text-zinc-500 mb-0.5">{fmt(n.ts)}</div>
              <div className="text-zinc-200 text-[11px] whitespace-pre-wrap break-words">{n.text}</div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1">
              {confirmDel === n.id ? (
                <div className="flex gap-1">
                  <button onClick={() => removeNote(n.id)} className="text-[9px] text-red-400 hover:text-red-200 border border-red-800 px-1.5 py-0.5 rounded">del</button>
                  <button onClick={() => setConfirmDel(null)} className="text-[9px] text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-1.5 py-0.5 rounded">no</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDel(n.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 text-[10px]">✕</button>
              )}
              <button onClick={() => navigator.clipboard.writeText(n.text).catch(() => {})}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-zinc-600 hover:text-zinc-300" title="copy">⎘</button>
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-zinc-800 px-3 py-2 flex gap-2">
        <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } }}
          placeholder="new note… (Enter to save)"
          className="flex-1 bg-zinc-800 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none border border-zinc-700 focus:border-emerald-600 placeholder-zinc-600" />
        <button onClick={save} disabled={!draft.trim() || saving}
          className="text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 disabled:opacity-40 border border-zinc-700 px-2 py-1 rounded transition-colors">
          {saving ? "…" : "add"}
        </button>
      </div>
    </div>
  );
}
