import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";

interface ReplEntry { input: string; output: string; error: boolean; ts: number }

const SNIPPETS = [
  { label: "mesh feed", code: `import json\nwith open(r"C:\\Xova\\memory\\mesh_feed.jsonl") as f:\n    lines = [json.loads(l) for l in f if l.strip()]\nprint(json.dumps(lines[-3:], indent=2))` },
  { label: "board", code: `import json\nwith open(r"C:\\Xova\\memory\\agent_board.json") as f:\n    print(json.dumps(json.load(f), indent=2))` },
  { label: "forge events", code: `import json\nwith open(r"C:\\Xova\\memory\\forge_events.jsonl") as f:\n    lines = [json.loads(l) for l in f if l.strip()]\nprint(json.dumps(lines[-5:], indent=2))` },
  { label: "rff score", code: `import sys; sys.path.insert(0, r"D:\\github\\wizardaax\\recursive-field-math-pro\\src")\nfrom recursive_field_math.eval_api import score\nimport json\nwith open(r"C:\\Xova\\memory\\mesh_feed.jsonl") as f:\n    lines = [json.loads(l) for l in f if l.strip()]\nvals = [l["coherence"] for l in lines if l.get("kind")=="cycle_end" and isinstance(l.get("coherence"),float)][-50:]\nprint(json.dumps(score(vals), indent=2))` },
  { label: "evo list", code: `import os,json\nd = r"C:\\Xova\\memory\\evolution"\nfiles = sorted(f for f in os.listdir(d) if f.endswith("_evolve.json"))\nprint(f"{len(files)} evolution files, latest: {files[-1] if files else 'none'}")` },
];

export function PythonRepl({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [history, setHistory] = useState<ReplEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [histIdx, setHistIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const run = useCallback(async () => {
    if (!code.trim() || running) return;
    setRunning(true);
    const input = code;
    try {
      const escaped = input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      const cmd = `${PYTHON} -c "${escaped}"`;
      const raw = await invoke<string>("xova_run", { command: cmd, cwd: "C:\\Xova", elevated: false });
      let stdout = raw, stderr = "";
      try { const w = JSON.parse(raw); stdout = w.stdout ?? ""; stderr = w.stderr ?? ""; } catch { /* use raw */ }
      const out = stdout.trim() || (stderr.trim() ? "" : "(no output)");
      const err = stderr.trim();
      setHistory(h => [...h, { input, output: err ? err : out, error: !!err, ts: Date.now() }]);
    } catch (e) { setHistory(h => [...h, { input, output: String(e), error: true, ts: Date.now() }]); }
    setRunning(false);
    setCode("");
    setHistIdx(-1);
  }, [code, running]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); return; }
    if (e.key === "ArrowUp" && e.ctrlKey) {
      const inputs = history.map(h => h.input).reverse();
      const next = histIdx + 1;
      if (next < inputs.length) { setHistIdx(next); setCode(inputs[next]); }
      e.preventDefault();
    }
    if (e.key === "ArrowDown" && e.ctrlKey) {
      if (histIdx <= 0) { setHistIdx(-1); setCode(""); }
      else { const next = histIdx - 1; setHistIdx(next); setCode(history[history.length - 1 - next].input); }
      e.preventDefault();
    }
  };

  const insertSnippet = (c: string) => { setCode(c); textareaRef.current?.focus(); };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Python REPL · Ctrl+↑/↓ history</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>
      {/* Quick snippets */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-zinc-800 flex-wrap shrink-0">
        {SNIPPETS.map(s => (
          <button key={s.label} onClick={() => insertSnippet(s.code)}
            className="text-[9px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 hover:text-emerald-400 transition-colors">
            {s.label}
          </button>
        ))}
        <button onClick={() => setHistory([])}
          className="text-[9px] px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-600 hover:text-red-400 ml-auto">
          clear
        </button>
      </div>
      {/* Output log */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-2">
        {history.map((entry, i) => (
          <div key={i} className="space-y-0.5">
            <div className="flex items-start gap-1">
              <span className="text-emerald-600 shrink-0">▶</span>
              <pre className="text-zinc-300 text-[10px] whitespace-pre-wrap break-all">{entry.input}</pre>
            </div>
            {entry.output && (
              <pre className={`text-[10px] pl-4 whitespace-pre-wrap break-all ${entry.error ? "text-red-400" : "text-zinc-400"}`}>{entry.output}</pre>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {/* Input */}
      <div className="border-t border-zinc-800 p-2 shrink-0">
        <div className="flex items-start gap-2">
          <span className="text-emerald-500 mt-1 shrink-0">»</span>
          <textarea ref={textareaRef} value={code} onChange={e => setCode(e.target.value)} onKeyDown={handleKey}
            rows={Math.min(8, Math.max(2, code.split("\n").length + 1))}
            placeholder="python code… (Ctrl+Enter to run)"
            spellCheck={false}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-emerald-600 resize-none font-mono" />
        </div>
        <div className="flex justify-end mt-1">
          <button onClick={run} disabled={running || !code.trim()}
            className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-white text-[10px] uppercase tracking-wider transition-colors">
            {running ? "running…" : "▶ run (Ctrl+↵)"}
          </button>
        </div>
      </div>
    </div>
  );
}
