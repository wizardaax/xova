import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const EXPORTS_DIR = "C:\\Xova\\memory\\exports";

interface RunResult { exit: number; stdout: string; stderr: string }

export function ExportsViewer({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const cmd = `"${PYTHON}" -c "import os,json; d=r'${EXPORTS_DIR}'; f=sorted(x for x in os.listdir(d) if x.endswith('.md')) if os.path.isdir(d) else []; print(json.dumps(f))"`;
      const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
      let stdout = raw;
      try { const w: RunResult = JSON.parse(raw); stdout = w.stdout ?? ""; } catch { /* use raw */ }
      setFiles(JSON.parse(stdout.trim()));
    } catch { setFiles([]); }
    setLoading(false);
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const openFile = useCallback(async (name: string) => {
    setSelected(name);
    setContent("");
    setReading(true);
    try {
      const text = await invoke<string>("xova_read_file", { path: `${EXPORTS_DIR}\\${name}` });
      setContent(text);
    } catch (e) { setContent(`Error reading file: ${e}`); }
    setReading(false);
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Exports{!loading ? ` (${files.length})` : ""}
        </span>
        <button onClick={loadFiles} disabled={loading}
          className="ml-auto text-zinc-600 hover:text-zinc-300 disabled:opacity-40">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {!selected ? (
        <>
          {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
          {!loading && files.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-zinc-600">no exports found</div>
          )}
          {!loading && files.length > 0 && (
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {[...files].reverse().map(name => (
                <button key={name} onClick={() => openFile(name)}
                  className="w-full text-left px-3 py-2 rounded border border-zinc-800 bg-zinc-900 hover:border-emerald-700 hover:bg-zinc-800 transition-colors">
                  <div className="text-zinc-300 truncate">{name}</div>
                  <div className="text-zinc-600 text-[9px] mt-0.5">
                    {name.replace("xova-chat-", "").replace(".md", "")}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">
            <button onClick={() => { setSelected(null); setContent(""); }}
              className="text-zinc-500 hover:text-zinc-200 text-[9px]">← back</button>
            <span className="text-zinc-500 text-[9px] truncate flex-1">{selected}</span>
            <button onClick={copyToClipboard} disabled={!content || reading}
              className="text-[9px] px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-40 transition-colors">
              {copied ? "copied!" : "copy"}
            </button>
          </div>
          {reading && <div className="flex-1 flex items-center justify-center text-zinc-600">reading…</div>}
          {!reading && (
            <pre className="flex-1 overflow-y-auto px-3 py-2 text-zinc-400 text-[10px] whitespace-pre-wrap break-words leading-relaxed">
              {content}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
