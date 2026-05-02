import { useState } from "react";
import { ArrowsCounterClockwise } from "@phosphor-icons/react";

interface NavigatorTileProps {
  onClose: () => void;
}

/**
 * In-app render of the Time-Travel Navigator — golden-ratio spiral of 97
 * framework events with black swan watermark behind. Embedded as an iframe;
 * Tauri CSP is null so the https URL loads inside the webview without
 * launching any external process or terminal.
 */
export function NavigatorTile({ onClose: _onClose }: NavigatorTileProps) {
  // Sovereign-first: prefer local file (works offline). HTTPS URL is fallback.
  const LOCAL = "file:///D:/github/wizardaax/wizardaax.github.io/findings/time_travel_navigator.html";
  const LIVE  = "https://wizardaax.github.io/findings/time_travel_navigator.html";
  const [reloadKey, setReloadKey] = useState(0);
  const [src, setSrc] = useState(LOCAL);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 pb-2 shrink-0">
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          title="reload"
          className="w-7 h-7 flex items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-emerald-400 hover:border-emerald-600"
        >
          <ArrowsCounterClockwise size={12} />
        </button>
        <button
          onClick={() => setSrc((s) => s === LOCAL ? LIVE : LOCAL)}
          title={src === LOCAL ? "switch to live URL" : "switch to local (sovereign, offline)"}
          className="px-2 h-7 flex items-center rounded border border-zinc-800 bg-zinc-900 text-[9px] font-mono uppercase tracking-wider text-zinc-400 hover:text-emerald-400 hover:border-emerald-600"
        >
          {src === LOCAL ? "🔒 local" : "🌐 live"}
        </button>
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">r=a√n, θ=nφ</span>
      </div>
      <div className="flex-1 min-h-0 border border-zinc-800 rounded overflow-hidden bg-black">
        <iframe
          key={`${src}-${reloadKey}`}
          src={src}
          title="Time-Travel Navigator"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}
