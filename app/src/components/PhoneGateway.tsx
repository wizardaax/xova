import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const GATEWAY_PATH = "C:\\Xova\\memory\\phone_gateway_state.json";
const PHONE_PATH   = "C:\\Xova\\memory\\active_phone.json";

interface GatewayState { url?: string; ip?: string; port?: number; pid?: number; started_at?: number; }
interface ActivePhone  { id?: string; name?: string; }

function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000 - (ts > 1e12 ? ts / 1000 : ts));
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function PhoneGateway({ onClose }: { onClose: () => void }) {
  const [gateway, setGateway] = useState<GatewayState | null>(null);
  const [phone,   setPhone]   = useState<ActivePhone | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await invoke<string>("xova_read_file", { path: GATEWAY_PATH });
      setGateway(JSON.parse(r) as GatewayState);
    } catch { setGateway(null); }
    try {
      const r = await invoke<string>("xova_read_file", { path: PHONE_PATH });
      setPhone(JSON.parse(r) as ActivePhone);
    } catch { setPhone(null); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 10_000); return () => clearInterval(id); }, [refresh]);

  const uptime = gateway?.started_at
    ? Math.floor(Date.now() / 1000 - gateway.started_at)
    : null;

  function fmtUptime(s: number) {
    if (s < 60)    return `${s}s`;
    if (s < 3600)  return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Phone Gateway</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${gateway ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
        <button onClick={refresh} className="ml-auto text-zinc-600 hover:text-zinc-300">↻</button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}

      {!loading && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">

          {/* Active phone */}
          <div>
            <div className="text-[8px] text-zinc-600 uppercase mb-2">active device</div>
            {phone ? (
              <div className="border border-zinc-800 rounded p-2 bg-zinc-900/30">
                <div className="text-zinc-200 text-[10px] font-bold">{phone.name ?? "unknown"}</div>
                {phone.id && <div className="text-zinc-600 text-[8px] mt-0.5">{phone.id}</div>}
              </div>
            ) : (
              <div className="text-zinc-600 text-[9px]">no active phone</div>
            )}
          </div>

          {/* Gateway state */}
          <div>
            <div className="text-[8px] text-zinc-600 uppercase mb-2">gateway</div>
            {gateway ? (
              <div className="space-y-1.5">
                {[
                  ["url",   gateway.url],
                  ["ip",    gateway.ip],
                  ["port",  gateway.port?.toString()],
                  ["pid",   gateway.pid?.toString()],
                  ["started", gateway.started_at ? fmtAgo(gateway.started_at) : undefined],
                  ["uptime",  uptime !== null ? fmtUptime(uptime) : undefined],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={String(k)} className="flex items-center gap-2">
                    <span className="text-zinc-600 text-[8px] w-14 shrink-0">{k}</span>
                    <span className="text-zinc-300 text-[9px]">{String(v)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-zinc-600 text-[9px]">gateway offline</div>
            )}
          </div>

          <div className="text-[8px] text-zinc-700 border-t border-zinc-800 pt-3">
            S26 phone bridge · phone-as-thin-client to PC models via LAN
          </div>
        </div>
      )}
    </div>
  );
}
