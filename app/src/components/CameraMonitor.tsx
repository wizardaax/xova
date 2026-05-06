import { useEffect, useRef, useState } from "react";

interface CameraMonitorProps {
  onClose: () => void;
}

export function CameraMonitor({ onClose }: CameraMonitorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.play().catch(() => {});
        }

        // audio level meter
        try {
          const ctx = new AudioContext();
          ctxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          analyserRef.current = analyser;
          const buf = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteFrequencyData(buf);
            const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
            setAudioLevel(avg / 128);
            animRef.current = requestAnimationFrame(tick);
          };
          tick();
        } catch { /* audio meter optional */ }
      })
      .catch(e => { if (!cancelled) setErr(String(e)); });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      ctxRef.current?.close();
      ctxRef.current = null;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const toggleMute = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
  };

  const barWidth = `${Math.min(100, audioLevel * 100)}%`;
  const barColor = audioLevel > 0.6 ? "#f87171" : audioLevel > 0.3 ? "#fbbf24" : "#34d399";

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900 border-b border-zinc-800 shrink-0">
      <div className="relative w-24 h-14 rounded overflow-hidden bg-zinc-800 shrink-0">
        {err ? (
          <div className="w-full h-full flex items-center justify-center text-[8px] text-red-400 text-center px-1">{err}</div>
        ) : (
          <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
        )}
        <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" title="recording" />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-zinc-400 font-mono uppercase">mic</span>
          {muted && <span className="text-[8px] text-red-400 font-bold">MUTED</span>}
        </div>
        <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden w-full">
          <div className="h-full rounded-full transition-all duration-75"
            style={{ width: barWidth, backgroundColor: barColor }} />
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={toggleMute}
          title={muted ? "Unmute mic" : "Mute mic"}
          className={`w-7 h-7 rounded text-[11px] flex items-center justify-center border transition-colors ${
            muted
              ? "bg-red-900/40 border-red-600 text-red-300 hover:bg-red-800/40"
              : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-emerald-600 hover:text-emerald-300"
          }`}
        >
          {muted ? "🔇" : "🎙"}
        </button>
        <button
          onClick={onClose}
          title="Hide monitor"
          className="w-7 h-7 rounded text-[11px] flex items-center justify-center border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-red-600 hover:text-red-400 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
