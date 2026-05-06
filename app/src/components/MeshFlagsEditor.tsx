import { useState, useEffect } from "react";
import { loadMeshFlags, saveMeshFlags, type MeshFlags, DEFAULT_MESH_FLAGS } from "@/lib/mesh";

const FORGE_OPTIONS: Array<{ value: MeshFlags["forge_mode"]; label: string; desc: string; color: string }> = [
  { value: "off",   label: "Off",   desc: "Forge disabled",          color: "border-zinc-700 text-zinc-500" },
  { value: "queue", label: "Queue", desc: "Buffer tasks, run later", color: "border-amber-700 text-amber-400" },
  { value: "live",  label: "Live",  desc: "Process tasks immediately",color: "border-emerald-700 text-emerald-400" },
];

export function MeshFlagsEditor({ onClose }: { onClose: () => void }) {
  const [flags, setFlags] = useState<MeshFlags>(DEFAULT_MESH_FLAGS);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadMeshFlags().then(f => { setFlags(f); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const toggle = (key: keyof MeshFlags) => {
    if (typeof flags[key] !== "boolean") return;
    setFlags(prev => ({ ...prev, [key]: !prev[key] }));
    setSaved(false);
  };

  const setForge = (v: MeshFlags["forge_mode"]) => { setFlags(prev => ({ ...prev, forge_mode: v })); setSaved(false); };

  const save = async () => {
    await saveMeshFlags(flags);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const BOOL_FLAGS: Array<{ key: keyof MeshFlags; label: string; desc: string }> = [
    { key: "evolutionEnabled",  label: "Evolution Engine",  desc: "Run EvolutionEngine self-improvement cycles" },
    { key: "cognitiveEnabled",  label: "Cognitive Loop",    desc: "Enable 13-agent cognitive mesh cycles" },
    { key: "meshRunnerEnabled", label: "Mesh Runner",       desc: "Allow mesh_runner to execute agent tasks" },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Mesh Flags</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Boolean toggles */}
          <div className="space-y-2">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wide mb-2">Agent Systems</div>
            {BOOL_FLAGS.map(({ key, label, desc }) => {
              const on = flags[key] as boolean;
              return (
                <div key={key} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-2">
                  <button onClick={() => toggle(key)}
                    className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${on ? "bg-emerald-600" : "bg-zinc-700"}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[11px] ${on ? "text-zinc-100" : "text-zinc-500"}`}>{label}</div>
                    <div className="text-[9px] text-zinc-600">{desc}</div>
                  </div>
                  <span className={`text-[9px] uppercase ${on ? "text-emerald-400" : "text-zinc-600"}`}>{on ? "on" : "off"}</span>
                </div>
              );
            })}
          </div>

          {/* Forge mode */}
          <div className="space-y-2">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wide mb-2">Forge Mode</div>
            <div className="grid grid-cols-3 gap-1">
              {FORGE_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setForge(opt.value)}
                  className={`p-2 rounded border transition-colors text-left ${flags.forge_mode === opt.value ? opt.color + " bg-zinc-800" : "border-zinc-800 text-zinc-600 hover:border-zinc-600"}`}>
                  <div className="text-[11px] font-semibold">{opt.label}</div>
                  <div className="text-[9px] mt-0.5 opacity-70">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Current state preview */}
          <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wide mb-1">Current</div>
            <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap">{JSON.stringify(flags, null, 2)}</pre>
          </div>

          <button onClick={save}
            className={`w-full py-2 rounded text-[11px] uppercase tracking-wider transition-colors ${saved ? "bg-emerald-800 text-emerald-300" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"}`}>
            {saved ? "✓ saved" : "save flags"}
          </button>
        </div>
      )}
    </div>
  );
}
