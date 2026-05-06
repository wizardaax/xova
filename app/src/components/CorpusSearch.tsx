import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CorpusEntry {
  path: string;
  name: string;
  ext: string;
  excerpt: string;
  root: string;
}

interface Props { onClose: () => void }

function score(entry: CorpusEntry, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (!tokens.length) return 1;
  const hay = (entry.excerpt + " " + entry.name + " " + entry.path).toLowerCase();
  return tokens.filter(t => hay.includes(t)).length / tokens.length;
}

export function CorpusSearch({ onClose }: Props) {
  const [entries, setEntries] = useState<CorpusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CorpusEntry[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\corpus_index.json" })
      .then(raw => {
        const all: CorpusEntry[] = JSON.parse(raw);
        setEntries(all);
        setResults(all.slice(0, 20));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const search = useCallback((q: string, all: CorpusEntry[]) => {
    if (!q.trim()) { setResults(all.slice(0, 20)); return; }
    const ranked = all
      .map(e => ({ e, s: score(e, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map(x => x.e);
    setResults(ranked);
  }, []);

  const onInput = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q, entries), 200);
  };

  const copy = (entry: CorpusEntry, idx: number) => {
    const text = entry.excerpt || entry.path;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-xs">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-zinc-400 uppercase tracking-wider text-[10px]">
          Corpus Search{!loading && ` (${entries.length.toLocaleString()})`}
        </span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">✕</button>
      </div>

      <div className="px-3 py-2 shrink-0">
        <input
          autoFocus
          value={query}
          onChange={e => onInput(e.target.value)}
          placeholder="Search 13k+ entries…"
          className="w-full bg-zinc-900 text-zinc-200 placeholder-zinc-600 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-zinc-600"
        />
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading corpus…</div>
      )}

      {!loading && results.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-600">no matches</div>
      )}

      {!loading && results.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
          {results.map((entry, idx) => (
            <button
              key={idx}
              onClick={() => copy(entry, idx)}
              className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-zinc-800 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 text-[9px] uppercase">{entry.ext || "?"}</span>
                <span className="text-zinc-400 truncate flex-1">{entry.name}</span>
                {copiedIdx === idx && (
                  <span className="text-emerald-400 text-[9px] shrink-0">Copied!</span>
                )}
              </div>
              {entry.excerpt && (
                <div className="text-zinc-600 truncate text-[10px] mt-0.5 group-hover:text-zinc-500">
                  {entry.excerpt.slice(0, 100)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
