import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ArrowsClockwise, Check } from "@phosphor-icons/react";
import { saveMemory, loadMemory } from "@/lib/mesh";

interface Phone {
  id: string;
  name: string;
  linked: boolean;
  source: "phone-link" | "bluetooth-only";
}

interface PhonePickerProps {
  onClose: () => void;
}

const ACTIVE_PHONE_KEY = "active_phone";

/**
 * Shows the actual paired Samsung phones detected from Phone Link's metadata
 * + Bluetooth enumeration. Click a row to set it as the active device — the
 * choice persists in mesh memory so other components (Camera tile etc.) can
 * prefer that phone. Also opens Phone Link so the user can interact with it.
 */
export function PhonePicker({ onClose }: PhonePickerProps) {
  const [phones, setPhones] = useState<Phone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await invoke<string>("xova_list_phones");
      const parsed: Phone[] = JSON.parse(raw);
      setPhones(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    loadMemory<{ id: string; name: string }>(ACTIVE_PHONE_KEY).then((stored) => {
      if (stored && typeof stored.id === "string") setActiveId(stored.id);
    });
  }, []);

  const pickPhone = async (p: Phone) => {
    // Click selects + persists. Doesn't auto-launch Phone Link because Phone
    // Link has no URI to switch active device — it would just reopen whatever
    // was last selected there, regardless of what you picked here.
    setActiveId(p.id);
    try { await saveMemory(ACTIVE_PHONE_KEY, { id: p.id, name: p.name }); } catch {}
  };

  const launchPhoneLink = async () => {
    try {
      await invoke("xova_run", {
        command: "explorer.exe shell:AppsFolder\\Microsoft.YourPhone_8wekyb3d8bbwe!App",
        cwd: null,
        elevated: false,
      });
    } catch {}
  };

  const openPair = async () => {
    try {
      await invoke("xova_run", { command: "start ms-settings:mobile-devices", cwd: null, elevated: false });
    } catch {}
  };

  return (
    <div className="px-6 pb-2 shrink-0 flex flex-col items-center gap-1">
      <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 w-full max-w-[480px]">
        <span className="uppercase tracking-wider">paired phones</span>
        <button onClick={refresh} disabled={loading} title="Re-scan" className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-emerald-400 disabled:opacity-50">
          <ArrowsClockwise size={11} className={loading ? "animate-spin" : ""} />
        </button>
        <button onClick={launchPhoneLink} className="text-zinc-500 hover:text-emerald-400 underline-offset-2 hover:underline">open phone link</button>
        <button onClick={openPair} className="text-zinc-500 hover:text-emerald-400 underline-offset-2 hover:underline">pair another</button>
        <button onClick={onClose} title="close" className="ml-auto w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400">
          <X size={12} />
        </button>
      </div>
      {error && (
        <div className="text-[10px] text-red-300 font-mono p-1 border border-red-900 rounded bg-red-950/40 max-w-[480px]">
          {error}
        </div>
      )}
      {phones !== null && phones.length === 0 && !error && (
        <div className="text-[10px] text-zinc-500 font-mono italic">
          no paired phones — click "pair another" to add one
        </div>
      )}
      {phones && phones.length > 0 && (
        <div className="w-full max-w-[480px] flex flex-col gap-1">
          {phones.map((p) => {
            const isActive = activeId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => pickPhone(p)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left border ${
                  isActive
                    ? "bg-emerald-900/30 border-emerald-600"
                    : "bg-zinc-900 border-zinc-800 hover:border-emerald-600"
                }`}
                title={isActive ? "active device — Xova biases other tools toward this" : "Click to set as active device"}
              >
                {isActive ? (
                  <Check size={11} weight="bold" className="text-emerald-300" />
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full ${p.linked ? "bg-emerald-400" : "bg-zinc-600"}`} />
                )}
                <span className={`text-xs font-mono truncate flex-1 ${isActive ? "text-emerald-200" : "text-zinc-100"}`}>{p.name}</span>
                <span className="text-[9px] font-mono text-zinc-600 uppercase">{p.source === "phone-link" ? "linked" : "bt"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
