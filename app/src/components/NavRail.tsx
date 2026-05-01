import { Network, GitBranch, MagnifyingGlass, Terminal, Gear, Atom } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type NavView = "mesh" | "cascade" | "scan" | "terminal" | "settings" | "plugins";

const ITEMS: Array<{ id: NavView; icon: typeof Network; label: string }> = [
  { id: "mesh", icon: Network, label: "MESH" },
  { id: "cascade", icon: GitBranch, label: "CASCADE" },
  { id: "scan", icon: MagnifyingGlass, label: "SCAN" },
  { id: "terminal", icon: Terminal, label: "TERMINAL" },
  { id: "plugins", icon: Atom, label: "PLUGINS" },
  { id: "settings", icon: Gear, label: "SETTINGS" },
];

export function NavRail({ active, onChange }: { active: NavView; onChange: (v: NavView) => void }) {
  return (
    <div className="w-16 bg-slate-50 border-l border-slate-200 flex flex-col items-center py-3 gap-1">
      {ITEMS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "w-12 h-14 flex flex-col items-center justify-center gap-1 rounded-lg transition-colors",
            active === id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-200"
          )}
          title={label}
        >
          <Icon size={20} weight={active === id ? "fill" : "regular"} />
          <span className="text-[9px] font-semibold tracking-wider">{label}</span>
        </button>
      ))}
    </div>
  );
}
