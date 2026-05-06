import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const PLUGINS_DIR = "C:\\Xova\\plugins";
const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";

export function PluginEditor({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [dirty, setDirty] = useState(false);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);

  const refreshList = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PYTHON}" -c "import os,json; d=r'${PLUGINS_DIR}'; print(json.dumps(sorted(f for f in os.listdir(d) if f.endswith('.py')) if os.path.isdir(d) else []))"`,
        cwd: PLUGINS_DIR, elevated: false,
      });
      let stdout = raw;
      try { const w = JSON.parse(raw); if (typeof w.stdout === "string") stdout = w.stdout; } catch { /* use raw */ }
      setFiles(JSON.parse(stdout.trim()));
    } catch { /* silent */ }
    setLoadingFiles(false);
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  const openFile = async (name: string) => {
    if (dirty && !confirm(`Discard unsaved changes to ${active}?`)) return;
    setActive(name);
    setDirty(false);
    setOutput("");
    try {
      const content = await invoke<string>("xova_read_file", { path: `${PLUGINS_DIR}\\${name}` });
      setCode(content);
    } catch (e) { setCode(`# error loading ${name}: ${e}`); }
  };

  const save = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await invoke("xova_write_file", { path: `${PLUGINS_DIR}\\${active}`, content: code });
      setDirty(false);
    } catch (e) { setOutput(`save error: ${e}`); }
    setSaving(false);
  };

  const run = async () => {
    if (!active) return;
    setRunning(true); setOutput("");
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PYTHON}" "${PLUGINS_DIR}\\${active}"`,
        cwd: PLUGINS_DIR, elevated: false,
      });
      let stdout = raw, stderr = "";
      try { const w = JSON.parse(raw); stdout = w.stdout ?? ""; stderr = w.stderr ?? ""; } catch { /* use raw */ }
      setOutput((stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim() || "(no output)");
    } catch (e) { setOutput(`run error: ${e}`); }
    setRunning(false);
  };

  const newFile = async () => {
    const name = prompt("Plugin filename (e.g. my_plugin.py):");
    if (!name || !name.endsWith(".py")) return;
    const template = `# ${name}\nimport json, sys\n\ndef main():\n    print(json.dumps({"ok": True}))\n\nif __name__ == "__main__":\n    main()\n`;
    try {
      await invoke("xova_write_file", { path: `${PLUGINS_DIR}\\${name}`, content: template });
      await refreshList();
      await openFile(name);
    } catch (e) { alert(`Could not create file: ${e}`); }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Plugin Editor</span>
        <div className="flex gap-2 items-center">
          <button onClick={newFile} className="text-zinc-500 hover:text-emerald-400 text-[10px] border border-zinc-700 rounded px-2 py-0.5">+ new</button>
          <button onClick={refreshList} className="text-zinc-600 hover:text-zinc-300">↻</button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
        {/* File list */}
        <div className="w-32 border-r border-zinc-800 overflow-y-auto shrink-0 py-1">
          {loadingFiles && <div className="text-zinc-600 text-[10px] px-2 py-1">loading…</div>}
          {files.map(f => (
            <button key={f} onClick={() => openFile(f)}
              className={`w-full text-left px-2 py-1 text-[10px] truncate hover:bg-zinc-800 transition-colors ${active === f ? "bg-zinc-800 text-emerald-300" : "text-zinc-400"}`}>
              {f}
            </button>
          ))}
        </div>
        {/* Editor pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {active ? (
            <>
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800 shrink-0">
                <span className="text-zinc-400 text-[10px] truncate flex-1">{active}{dirty ? " *" : ""}</span>
                <button onClick={save} disabled={saving || !dirty}
                  className="text-[9px] uppercase px-2 py-0.5 border border-zinc-700 rounded text-zinc-400 hover:text-emerald-400 hover:border-emerald-600 disabled:opacity-40">
                  {saving ? "saving…" : "save"}
                </button>
                <button onClick={run} disabled={running}
                  className="text-[9px] uppercase px-2 py-0.5 border border-emerald-800 rounded text-emerald-400 hover:bg-emerald-900/30 disabled:opacity-40">
                  {running ? "running…" : "▶ run"}
                </button>
              </div>
              <textarea value={code} onChange={e => { setCode(e.target.value); setDirty(true); }}
                spellCheck={false}
                className="flex-1 bg-zinc-950 text-zinc-200 text-[11px] font-mono p-2 resize-none focus:outline-none border-b border-zinc-800" />
              {output && (
                <pre className="h-28 overflow-auto bg-black/40 text-[10px] text-zinc-300 p-2 leading-relaxed whitespace-pre-wrap">
                  {output}
                </pre>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-[11px]">
              select a plugin to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
