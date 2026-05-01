import { useEffect, useState } from "react";
import {
  loadOllamaSettings,
  saveOllamaSettings,
  DEFAULT_SETTINGS,
  type OllamaSettings,
} from "@/lib/mesh";

const INSTALLED_MODELS = [
  { id: "llama3.2:3b", label: "llama3.2:3b — small, fits 4GB GPU, fastest" },
  { id: "qwen3:8b", label: "qwen3:8b — bigger, CPU-only on 4GB GPU" },
  { id: "llama3.1:8b", label: "llama3.1:8b — bigger, no thinking mode" },
  { id: "qwen3:14b", label: "qwen3:14b — large, slow on 4GB GPU" },
  { id: "qwen3.6:35b-a3b", label: "qwen3.6:35b-a3b — huge, CPU-only" },
  { id: "gpt-oss:20b", label: "gpt-oss:20b — large" },
  { id: "rff-ai:latest", label: "rff-ai:latest — custom" },
];

export function SettingsPanel() {
  const [settings, setSettings] = useState<OllamaSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    loadOllamaSettings().then((s) => {
      setSettings(s);
      setHydrated(true);
    });
  }, []);

  const onModel = async (model: string) => {
    const next = { ...settings, model };
    setSettings(next);
    await saveOllamaSettings(next);
    setSavedAt(Date.now());
  };

  const onCtx = async (raw: string) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const next = { ...settings, numCtx: n };
    setSettings(next);
    await saveOllamaSettings(next);
    setSavedAt(Date.now());
  };

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <div className="pb-3 mb-4 border-b border-zinc-800">
        <h1 className="text-sm font-bold text-zinc-100 font-mono uppercase tracking-wider">Settings</h1>
      </div>
      <div className="space-y-5 max-w-md">
        <div>
          <label className="block text-[11px] text-zinc-400 font-mono uppercase tracking-wider mb-1.5">Ollama Model</label>
          <select
            disabled={!hydrated}
            value={settings.model}
            onChange={(e) => onModel(e.target.value)}
            className="w-full h-10 px-3 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          >
            {INSTALLED_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
            {!INSTALLED_MODELS.find((m) => m.id === settings.model) && (
              <option value={settings.model}>{settings.model} (custom)</option>
            )}
          </select>
          <p className="text-[10px] text-zinc-600 font-mono mt-1">
            Active now: <span className="text-emerald-400">{settings.model}</span>. Applies to next chat turn.
          </p>
        </div>
        <div>
          <label className="block text-[11px] text-zinc-400 font-mono uppercase tracking-wider mb-1.5">Context Window (num_ctx)</label>
          <input
            disabled={!hydrated}
            type="number"
            min={512}
            max={131072}
            step={512}
            className="w-full h-10 px-3 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            value={settings.numCtx}
            onChange={(e) => onCtx(e.target.value)}
          />
          <p className="text-[10px] text-zinc-600 font-mono mt-1">
            Smaller = faster prefill, less history fits. 4096 is a good balance for the 3b on a 4GB GPU.
          </p>
        </div>
        {savedAt && (
          <p className="text-[10px] text-emerald-500 font-mono">saved · {new Date(savedAt).toLocaleTimeString()}</p>
        )}
      </div>
    </div>
  );
}
