import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VideoCamera, VideoCameraSlash, Camera } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { loadMemory } from "@/lib/mesh";

interface CameraTileProps {
  active: boolean;
  onToggle: () => void;
}

interface PairedPhone {
  id: string;
  name: string;
  linked: boolean;
  source: "phone-link" | "bluetooth-only";
}

const CAMERA_PREF_KEY = "xova_camera_device_id";
const ACTIVE_PHONE_KEY = "active_phone";

/**
 * Pick the best default camera when no preference is saved. Heuristic: prefer
 * "integrated"/"internal"/"laptop" names, fall back to first device. Tablet
 * cameras often default first on Windows; this nudges toward the laptop's
 * built-in cam unless the user picks otherwise.
 */
function preferredDeviceId(devices: MediaDeviceInfo[]): string | undefined {
  if (devices.length === 0) return undefined;
  const lc = (s: string) => s.toLowerCase();
  const integrated = devices.find((d) =>
    /\b(integrated|internal|laptop|builtin|built-in|hp|dell|lenovo|asus|acer)\b/.test(lc(d.label))
  );
  if (integrated) return integrated.deviceId;
  const notTablet = devices.find((d) =>
    !/\b(tablet|ipad|surface|wireless|virtual|obs)\b/.test(lc(d.label))
  );
  return (notTablet ?? devices[0]).deviceId;
}

/**
 * Live webcam preview with device picker. Toggleable, persists choice via
 * localStorage so the user doesn't reselect on every restart.
 */
export function CameraTile({ active, onToggle }: CameraTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [pairedPhones, setPairedPhones] = useState<PairedPhone[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(() => {
    try { return localStorage.getItem(CAMERA_PREF_KEY) || undefined; } catch { return undefined; }
  });

  // Pull paired phones (separate from webcam list) so we can show "phone X — enable webcam" hints.
  useEffect(() => {
    if (!active) return;
    invoke<string>("xova_list_phones").then((raw) => {
      try { setPairedPhones(JSON.parse(raw) as PairedPhone[]); } catch { setPairedPhones([]); }
    }).catch(() => setPairedPhones([]));
  }, [active]);

  const openMobileSettings = async () => {
    try { await invoke("xova_run", { command: "start ms-settings:mobile-devices", cwd: null, elevated: false }); } catch {}
  };

  // For each paired phone, determine if a matching webcam is already available.
  const phoneCamMatch = (phone: PairedPhone): MediaDeviceInfo | undefined => {
    const tokens = phone.name.toLowerCase().split(/\s+|'/).filter((t) => t.length >= 3);
    return devices.find((c) => tokens.some((t) => c.label.toLowerCase().includes(t)));
  };
  const phonesNeedingEnable = pairedPhones.filter((p) => !phoneCamMatch(p));

  // Re-enumerate every time the camera goes active so freshly-attached devices show up.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        // Need a stream first to unlock device labels in some browsers.
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const all = await navigator.mediaDevices.enumerateDevices();
        probe.getTracks().forEach((t) => t.stop());
        if (cancelled) return;
        const cams = all.filter((d) => d.kind === "videoinput");
        setDevices(cams);
        // If the saved deviceId is gone (device unplugged), fall back to a sensible default.
        // If there's no saved deviceId, prefer a camera matching the active phone's name
        // (set via the PhonePicker), then fall back to the laptop-cam heuristic.
        const activePhone = await loadMemory<{ id: string; name: string }>(ACTIVE_PHONE_KEY);
        const activeName = activePhone?.name ?? "";
        const matchPhoneCam = (): MediaDeviceInfo | undefined => {
          if (!activeName) return undefined;
          const lc = (s: string) => s.toLowerCase();
          // match on first word of the phone label e.g. "Adam's S23 Ultra" → "s23"
          const tokens = activeName.toLowerCase().split(/\s+|'/).filter(Boolean);
          return cams.find((c) => tokens.some((t) => t.length >= 3 && lc(c.label).includes(t)));
        };
        setDeviceId((prev) => {
          if (prev && cams.some((c) => c.deviceId === prev)) return prev;
          const phoneCam = matchPhoneCam();
          const next = phoneCam?.deviceId ?? preferredDeviceId(cams);
          if (next) {
            try { localStorage.setItem(CAMERA_PREF_KEY, next); } catch {}
          }
          return next;
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      setError(null);
      try {
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: 320, height: 240 }
            : { width: 320, height: 240 },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => { /* autoplay may be blocked, no-op */ });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    function stop() {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
    if (active) {
      start();
    } else {
      stop();
    }
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, deviceId]);

  const onPickDevice = (id: string) => {
    setDeviceId(id);
    try { localStorage.setItem(CAMERA_PREF_KEY, id); } catch {}
  };

  // Grab the current video frame, save to disk, run vision, then emit a
  // window event that App listens for so the snapshot + caption land in chat.
  const [snapping, setSnapping] = useState(false);
  const onSnapshot = async () => {
    if (snapping || !videoRef.current) return;
    setSnapping(true);
    try {
      const v = videoRef.current;
      const w = v.videoWidth || 320;
      const h = v.videoHeight || 240;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d unavailable");
      ctx.drawImage(v, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/png");
      const b64 = dataUrl.split(",")[1] ?? "";
      const filename = `cam-${Date.now()}.png`;
      const savedPath = await invoke<string>("xova_save_upload", { filename, base64Data: b64 });
      window.dispatchEvent(new CustomEvent("xova-snapshot", { detail: { path: savedPath, filename } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("xova-snapshot", { detail: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setSnapping(false);
    }
  };

  if (!active) {
    return (
      <button
        onClick={onToggle}
        title="Turn camera on"
        className="h-10 w-10 flex items-center justify-center rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 border border-zinc-800 transition-colors"
      >
        <VideoCameraSlash size={16} />
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="relative">
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className={cn(
            "rounded border border-emerald-700 bg-black block",
            error ? "hidden" : ""
          )}
          style={{ width: 240, height: 180 }}
        />
        {error && (
          <div className="text-[10px] text-red-300 font-mono p-2 border border-red-900 rounded bg-red-950/40 max-w-xs">
            camera failed: {error}
          </div>
        )}
        <button
          onClick={onSnapshot}
          disabled={snapping || !!error}
          title="Capture frame and run vision"
          className="absolute top-1 left-1 w-7 h-7 flex items-center justify-center rounded bg-black/70 hover:bg-black text-amber-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <Camera size={14} weight={snapping ? "regular" : "fill"} />
        </button>
        <button
          onClick={onToggle}
          title="Turn camera off"
          className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center rounded bg-black/70 hover:bg-black text-emerald-300 hover:text-white transition-colors"
        >
          <VideoCamera size={14} weight="fill" />
        </button>
      </div>
      {devices.length > 1 && (
        <select
          value={deviceId ?? ""}
          onChange={(e) => onPickDevice(e.target.value)}
          className="h-6 text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-300 rounded px-1 focus:outline-none focus:border-emerald-500 max-w-[240px]"
          title="Pick which camera"
        >
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      )}
      {phonesNeedingEnable.length > 0 && (
        <div className="text-[10px] font-mono text-zinc-500 max-w-[240px]">
          <div className="mb-0.5">also paired (webcam not enabled):</div>
          {phonesNeedingEnable.map((p) => (
            <button
              key={p.id}
              onClick={openMobileSettings}
              title="Open Settings → Mobile devices → toggle 'Use this phone as a connected camera'"
              className="block w-full text-left px-1 py-0.5 hover:bg-zinc-900 hover:text-emerald-400 rounded truncate"
            >
              📱 {p.name} — enable
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
