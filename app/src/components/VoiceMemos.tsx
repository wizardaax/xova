import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PY = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const DIR = "C:\\Xova\\memory\\voice_memos";
const PAGE = 50;

interface Memo { file: string; ts: string; duration: string; preview: string; full: string }

function parseMemo(file: string, raw: string): Memo {
  const lines = raw.split("\n");
  let ts = "", duration = "", bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("# Transcribed:")) ts = l.replace("# Transcribed:", "").trim();
    else if (l.startsWith("# Duration:")) duration = l.replace("# Duration:", "").trim();
    if (l.startsWith("#")) { bodyStart = i + 1; } else break;
  }
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart++;
  const body = lines.slice(bodyStart).join("\n").trim();
  return { file, ts, duration, preview: body.slice(0, 80), full: body };
}

function fmtTs(ts: string) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + "  " +
      d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

async function listFiles(offset: number): Promise<string[]> {
  const script = [
    "import os,json",
    `d=r'C:\\\\Xova\\\\memory\\\\voice_memos'`,
    "f=sorted(x for x in os.listdir(d) if x.endswith('.txt')) if os.path.isdir(d) else []",
    `end=max(0,len(f)-${offset})`,
    `start=max(0,end-${PAGE})`,
    "print(json.dumps(f[start:end]))",
  ].join(";");
  const res = await invoke<{ exit: number; stdout: string; stderr: string }>(
    "xova_run", { command: `"${PY}" -c "${script.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, cwd: DIR.replace(/\\/g, "\\\\"), elevated: false }
  );
  try { return JSON.parse(res.stdout.trim()).reverse(); } catch { return []; }
}

async function readMemo(file: string): Promise<Memo> {
  const path = DIR + "\\" + file;
  const raw = await invoke<string>("xova_read_file", { path });
  return parseMemo(file, raw ?? "");
}

export function VoiceMemos({ onClose }: { onClose: () => void }) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadBatch = useCallback(async (off: number, replace: boolean) => {
    setLoading(true);
    try {
      const files = await listFiles(off);
      if (files.length < PAGE) setHasMore(false);
      const loaded = await Promise.all(files.map(readMemo));
      setMemos(prev => replace ? loaded : [...prev, ...loaded]);
      setOffset(off + files.length);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadBatch(0, true); }, [loadBatch]);

  const filtered = query.trim()
    ? memos.filter(m => m.full.toLowerCase().includes(query.toLowerCase()) || m.ts.includes(query))
    : memos;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Voice Memos · {memos.length}</span>
        <button onClick={() => loadBatch(0, true)} className="ml-auto text-zinc-600 hover:text-zinc-300" title="refresh">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="search transcripts…"
          className="w-full bg-zinc-800 text-zinc-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-emerald-600 border border-zinc-700 placeholder-zinc-600"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && memos.length === 0 && (
          <div className="text-zinc-600 text-[10px] text-center pt-4">loading…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-zinc-600 text-[10px] text-center pt-4">{query ? "no matches" : "no memos"}</div>
        )}
        {filtered.map(m => {
          const open = expanded === m.file;
          return (
            <div key={m.file} className="border border-zinc-800 rounded bg-zinc-900 px-3 py-2 cursor-pointer hover:border-zinc-700 transition-colors"
              onClick={() => setExpanded(open ? null : m.file)}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[9px] text-emerald-500">{fmtTs(m.ts)}</span>
                {m.duration && <span className="text-[9px] text-zinc-500">{m.duration}</span>}
                <span className="ml-auto text-zinc-600 text-[9px]">{open ? "▲" : "▼"}</span>
              </div>
              {open ? (
                <div className="text-zinc-200 text-[11px] whitespace-pre-wrap break-words mt-1">{m.full || "—"}</div>
              ) : (
                <div className="text-zinc-400 text-[11px] truncate">{m.preview || "—"}</div>
              )}
            </div>
          );
        })}
        {!query && hasMore && (
          <button
            onClick={() => loadBatch(offset, false)}
            disabled={loading}
            className="w-full text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 disabled:opacity-40 border border-zinc-800 bg-zinc-900 rounded py-1.5 transition-colors mt-1"
          >
            {loading ? "loading…" : "load more"}
          </button>
        )}
      </div>
    </div>
  );
}
