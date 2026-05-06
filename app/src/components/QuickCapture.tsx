import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const NOTES_PATH = "C:\\Xova\\memory\\quick_notes.jsonl";

interface Note { id: string; ts: number; text: string }
interface Props { open: boolean; onClose: () => void }

export function QuickCapture({ open, onClose }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    invoke<string>("xova_read_file", { path: NOTES_PATH })
      .then(raw => {
        const parsed = raw.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l) as Note; } catch { return null; } }).filter(Boolean) as Note[];
        setNotes(parsed.reverse());
      })
      .catch(() => {});
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [open]);

  const save = useCallback(async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    const note: Note = { id: `note-${Date.now()}`, ts: Date.now(), text };
    try {
      const existing = await invoke<string>("xova_read_file", { path: NOTES_PATH }).catch(() => "");
      const appended = (existing.trimEnd() ? existing.trimEnd() + "\n" : "") + JSON.stringify(note);
      await invoke("xova_write_file", { path: NOTES_PATH, content: appended });
      setNotes(prev => [note, ...prev]);
      setDraft("");
    } catch { /* silently fail */ }
    setSaving(false);
  }, [draft, saving]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(); }
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-16 right-4 w-80 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[460px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
          Quick Notes{notes.length > 0 && ` (${notes.length})`}
        </span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-xs">✕</button>
      </div>

      {notes.length > 0 && (
        <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1 max-h-64">
          {notes.slice(0, 20).map((n) => (
            <div key={n.id} className="text-xs border-b border-zinc-800/50 pb-1">
              <button
                onClick={() => navigator.clipboard.writeText(n.text).catch(() => {})}
                className="text-zinc-600 hover:text-zinc-400 transition-colors text-[9px] font-mono block mb-0.5"
                title="Click to copy"
              >
                {new Date(n.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </button>
              <span className="text-zinc-300">{n.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 px-3 pb-3 pt-2 border-t border-zinc-800">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Capture a thought… (Ctrl+Enter to save)"
          className="w-full bg-zinc-800 text-zinc-200 text-xs rounded-lg p-2 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-zinc-600 placeholder-zinc-600"
        />
        <button
          onClick={save}
          disabled={!draft.trim() || saving}
          className="mt-1 w-full text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors"
        >
          {saving ? "saving…" : "save  ·  ctrl+enter"}
        </button>
      </div>
    </div>
  );
}
