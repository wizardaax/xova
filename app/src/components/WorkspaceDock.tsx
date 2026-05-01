import { useState } from "react";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import { CameraTile } from "./CameraTile";
import { FeedTile } from "./FeedTile";
import { PhonePicker } from "./PhonePicker";
import { MemoryPanel } from "./MemoryPanel";
import { cn } from "@/lib/utils";

type Tab = "camera" | "feed" | "phones" | "memory";

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "camera", label: "Camera", emoji: "📷" },
  { id: "feed",   label: "Feed",   emoji: "🔒" },
  { id: "phones", label: "Phones", emoji: "📱" },
  { id: "memory", label: "Memory", emoji: "🧠" },
];

interface WorkspaceDockProps {
  activeTab: Tab | null;
  onTab: (t: Tab | null) => void;
}

/**
 * Right-side dock. Pick a tab to show one workspace at a time. Click the
 * active tab again (or the X) to collapse the dock back to just the rail.
 */
export function WorkspaceDock({ activeTab, onTab }: WorkspaceDockProps) {
  const [cameraOn, setCameraOn] = useState(true); // owned by tab visibility now

  const collapsed = activeTab === null;

  return (
    <div className={cn(
      "shrink-0 border-l border-zinc-800 bg-zinc-950 flex transition-[width] duration-150",
      collapsed ? "w-10" : "w-[420px]"
    )}>
      {/* Rail with tab buttons */}
      <div className="w-10 border-r border-zinc-900 flex flex-col items-center py-2 gap-1 shrink-0">
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTab(isActive ? null : t.id)}
              title={t.label}
              className={cn(
                "w-8 h-8 rounded text-[13px] flex items-center justify-center border transition-colors",
                isActive
                  ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
              )}
            >
              {t.emoji}
            </button>
          );
        })}
        <button
          onClick={() => onTab(collapsed ? "camera" : null)}
          title={collapsed ? "Expand" : "Collapse"}
          className="w-8 h-8 mt-auto rounded border border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-emerald-400 hover:border-emerald-600 flex items-center justify-center"
        >
          {collapsed ? <CaretLeft size={12} /> : <CaretRight size={12} />}
        </button>
      </div>

      {/* Active workspace pane */}
      {!collapsed && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-9 border-b border-zinc-900 flex items-center px-3 shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">
              {TABS.find(t => t.id === activeTab)?.label ?? ""}
            </span>
            <button onClick={() => onTab(null)} className="ml-auto w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400" title="close">
              <X size={11} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {activeTab === "camera" && <CameraTile active={cameraOn} onToggle={() => setCameraOn(v => !v)} />}
            {activeTab === "feed"   && <FeedTile onClose={() => onTab(null)} />}
            {activeTab === "phones" && <PhonePicker onClose={() => onTab(null)} />}
            {activeTab === "memory" && <MemoryPanel onClose={() => onTab(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}
