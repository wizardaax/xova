import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const INFO_PATH = "C:\\Xova\\memory\\system_info.json";

interface RamInfo  { free_gb: number; total_gb: number; }
interface DiskInfo { free_gb: number; total_gb: number; pct_free: number; }
interface SubSystem { [key: string]: unknown; }
interface SystemData {
  generated_at?: string;
  host?: {
    hostname?: string; platform?: string; python?: string;
    ram?: RamInfo;
  };
  disks?: Record<string, DiskInfo>;
  network?: { lan_ip?: string };
  models_local?: { ollama?: string[]; ollama_count?: number };
  running?: { processes?: { pid: number; name: string; mem_mb: number }[] };
  paths?: Record<string, string>;
  subsystems?: Record<string, SubSystem>;
  rules?: Record<string, boolean>;
}

function diskBar(pct: number) {
  const used = 100 - pct;
  const cls = used > 80 ? "bg-red-500" : used > 60 ? "bg-amber-500" : "bg-teal-500";
  return { used, cls };
}

export function SystemInfo({ onClose }: { onClose: () => void }) {
  const [data,    setData]    = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<string>("xova_read_file", { path: INFO_PATH });
      setData(JSON.parse(raw) as SystemData);
    } catch { /* ok */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">System Info</span>
        {data?.generated_at && (
          <span className="text-zinc-700 text-[8px]">{data.generated_at.slice(0, 10)}</span>
        )}
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      {data && (
        <div className="flex-1 overflow-y-auto space-y-0">

          {/* Host */}
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="text-[8px] text-zinc-600 uppercase mb-1.5">host</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {[
                ["hostname", data.host?.hostname],
                ["python",   data.host?.python],
                ["lan ip",   data.network?.lan_ip],
                ["ram free", data.host?.ram ? `${data.host.ram.free_gb}/${data.host.ram.total_gb} GB` : undefined],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={String(k)} className="flex gap-2">
                  <span className="text-zinc-600 text-[8px] w-14 shrink-0">{k}</span>
                  <span className="text-zinc-300 text-[9px] truncate">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Disks */}
          {data.disks && (
            <div className="px-3 py-2 border-b border-zinc-800">
              <div className="text-[8px] text-zinc-600 uppercase mb-1.5">disks</div>
              <div className="space-y-1.5">
                {Object.entries(data.disks).map(([drive, disk]) => {
                  const { used, cls } = diskBar(disk.pct_free);
                  return (
                    <div key={drive}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-zinc-400 text-[9px] w-6">{drive}</span>
                        <span className="text-zinc-500 text-[8px] flex-1">{disk.free_gb.toFixed(0)} GB free of {disk.total_gb.toFixed(0)} GB</span>
                        <span className="text-zinc-600 text-[8px]">{used}% used</span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                        <div className={`h-full rounded ${cls}`} style={{ width: `${used}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ollama models */}
          {data.models_local?.ollama && (
            <div className="px-3 py-2 border-b border-zinc-800">
              <div className="text-[8px] text-zinc-600 uppercase mb-1.5">
                ollama models ({data.models_local.ollama_count ?? data.models_local.ollama.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {data.models_local.ollama.map(m => (
                  <span key={m} className="text-[8px] px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-zinc-300">{m}</span>
                ))}
              </div>
            </div>
          )}

          {/* Subsystems */}
          {data.subsystems && (
            <div className="px-3 py-2 border-b border-zinc-800">
              <div className="text-[8px] text-zinc-600 uppercase mb-1.5">subsystems</div>
              <div className="space-y-0.5">
                {Object.entries(data.subsystems).map(([name, sub]) => {
                  const tests = (sub as { tests_pass?: number }).tests_pass;
                  const agents = (sub as { count?: number; agents?: number }).count ?? (sub as { agents?: number }).agents;
                  return (
                    <div key={name} className="flex items-center gap-2 py-0.5 border-b border-zinc-900">
                      <span className="text-zinc-300 text-[9px] flex-1">{name.replace(/_/g, " ")}</span>
                      {agents !== undefined && <span className="text-cyan-400/70 text-[8px]">{agents} agents</span>}
                      {tests !== undefined && <span className="text-emerald-400/70 text-[8px]">✓{tests}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rules */}
          {data.rules && (
            <div className="px-3 py-2">
              <div className="text-[8px] text-zinc-600 uppercase mb-1.5">active rules</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(data.rules).filter(([, v]) => v).map(([k]) => (
                  <span key={k} className="text-[7px] px-1 py-px bg-emerald-900/20 border border-emerald-800/40 rounded text-emerald-400/70">
                    {k.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
