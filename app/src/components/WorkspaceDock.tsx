import { useState } from "react";
import { SecuritySentinel } from "./SecuritySentinel";
import { BrowserControl } from "./BrowserControl";
import { MemoryGraph } from "./MemoryGraph";
import { ContextBroker } from "./ContextBroker";
import { ActionTrace } from "./ActionTrace";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import { CameraTile } from "./CameraTile";
import { FeedTile } from "./FeedTile";
import { PhonePicker } from "./PhonePicker";
import { MemoryPanel } from "./MemoryPanel";
import { NavigatorTile } from "./NavigatorTile";
import { CorpusSearch } from "./CorpusSearch";
import { AgentGraph } from "./AgentGraph";
import { RepoHealth } from "./RepoHealth";
import { RffMetrics } from "./RffMetrics";
import { EventsLog } from "./EventsLog";
import { DaemonDashboard } from "./DaemonDashboard";
import { AgentDispatch } from "./AgentDispatch";
import { AblationMetrics } from "./AblationMetrics";
import { EvolutionTracker } from "./EvolutionTracker";
import { SessionBrowser } from "./SessionBrowser";
import { PluginEditor } from "./PluginEditor";
import { PythonRepl } from "./PythonRepl";
import { SelfEvalChart } from "./SelfEvalChart";
import { NotesBrowser } from "./NotesBrowser";
import { TernaryExplorer } from "./TernaryExplorer";
import { MeshFlagsEditor } from "./MeshFlagsEditor";
import { Sce88Audit } from "./Sce88Audit";
import { ShellHistory } from "./ShellHistory";
import { CorpusStats } from "./CorpusStats";
import { CoherenceTimeline } from "./CoherenceTimeline";
import { AgentHeatmap } from "./AgentHeatmap";
import { VoiceMemos } from "./VoiceMemos";
import { AbsorbLog } from "./AbsorbLog";
import { ExportsViewer } from "./ExportsViewer";
import { MeshControl } from "./MeshControl";
import { SwarmPanel } from "./SwarmPanel";
import { AeonThrust } from "./AeonThrust";
import { FieldVisualizer } from "./FieldVisualizer";
import { ChatLogBrowser } from "./ChatLogBrowser";
import { CalibrationChart } from "./CalibrationChart";
import { CyclesBrowser } from "./CyclesBrowser";
import { SmsArchive } from "./SmsArchive";
import { PhaseHistory } from "./PhaseHistory";
import { MemoryKeys } from "./MemoryKeys";
import { FederationPanel } from "./FederationPanel";
import { ForgeInbox } from "./ForgeInbox";
import { TestRunner } from "./TestRunner";
import { SentinelLog } from "./SentinelLog";
import { VoiceInbox } from "./VoiceInbox";
import { JarvisHealth } from "./JarvisHealth";
import { AgiAudit } from "./AgiAudit";
import { AgentBoard } from "./AgentBoard";
import { RiemannZeros } from "./RiemannZeros";
import { ConstraintGuard } from "./ConstraintGuard";
import { GitLog } from "./GitLog";
import { EvolutionStages } from "./EvolutionStages";
import { DriveMatrix } from "./DriveMatrix";
import { GoalState } from "./GoalState";
import { PersonaPanel } from "./PersonaPanel";
import { SharedFacts } from "./SharedFacts";
import { ForgeNotes } from "./ForgeNotes";
import { SelfMod } from "./SelfMod";
import { AeonRunLog } from "./AeonRunLog";
import { AgentRoster } from "./AgentRoster";
import { ViolationsLog } from "./ViolationsLog";
import { SwarmDispatch } from "./SwarmDispatch";
import { LongTermMemory } from "./LongTermMemory";
import { SelfEvalStore } from "./SelfEvalStore";
import { EvolutionRuns } from "./EvolutionRuns";
import { PhiUCBState } from "./PhiUCBState";
import { SystemInfo } from "./SystemInfo";
import { TrashStats } from "./TrashStats";
import { MeshFeed } from "./MeshFeed";
import { GoalProposals } from "./GoalProposals";
import { CoherenceInbox } from "./CoherenceInbox";
import { StandingFacts } from "./StandingFacts";
import { ForgeRateLog } from "./ForgeRateLog";
import { VoiceUserInbox } from "./VoiceUserInbox";
import { SessionViewer } from "./SessionViewer";
import { ForgeEventsLog } from "./ForgeEventsLog";
import { ForgeOutbox } from "./ForgeOutbox";
import { cn } from "@/lib/utils";

type Tab = "camera" | "feed" | "phones" | "memory" | "navigator" | "search" | "agents" | "repos" | "metrics" | "events" | "daemons" | "dispatch" | "ablation" | "evolution" | "sessions" | "editor" | "repl" | "selfeval" | "notes" | "ternary" | "flags" | "sce88" | "shell" | "corpus" | "coherence" | "heatmap" | "voicememos" | "absorb" | "exports" | "meshctl" | "swarm" | "aeon" | "field" | "chatlog" | "calibration" | "cycles" | "smsarchive" | "phasehistory" | "memkeys" | "federation" | "forgeinbox" | "testrunner" | "sentinellog" | "voiceinbox" | "jarvishealth" | "agiaudit" | "agentboard" | "riemann" | "constraintguard" | "gitlog" | "evostages" | "drivematrix" | "security" | "browser" | "memgraph" | "ctxbroker" | "acttrace" | "goalstate" | "persona" | "sharedfacts" | "forgenotes" | "selfmod" | "aeonlog" | "agentrostr" | "violations" | "swarmdispatch" | "ltmemory" | "selfevalstore" | "evoruns" | "phiucb" | "sysinfo" | "trashstats" | "meshfeed" | "goalproposals" | "coherenceinbox" | "standingfacts" | "forgerate" | "voiceuserinbox" | "sessionviewer" | "forgeevents" | "forgeoutbox";

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "camera",      label: "Camera",      emoji: "📷" },
  { id: "feed",        label: "Feed",        emoji: "📡" },
  { id: "phones",      label: "Phones",      emoji: "📱" },
  { id: "memory",      label: "Memory",      emoji: "🧠" },
  { id: "navigator",   label: "Navigator",   emoji: "🦢" },
  { id: "search",      label: "Search",      emoji: "🔍" },
  { id: "agents",      label: "Agents",      emoji: "🕸" },
  { id: "repos",       label: "Repos",       emoji: "📦" },
  { id: "metrics",     label: "Metrics",     emoji: "📊" },
  { id: "events",      label: "Events",      emoji: "⚡" },
  { id: "daemons",     label: "Daemons",     emoji: "⚙️" },
  { id: "dispatch",    label: "Dispatch",    emoji: "🎯" },
  { id: "ablation",    label: "Ablation",    emoji: "🔬" },
  { id: "evolution",   label: "Evolution",   emoji: "🧬" },
  { id: "sessions",    label: "Sessions",    emoji: "📚" },
  { id: "editor",      label: "Editor",      emoji: "✏️" },
  { id: "repl",        label: "REPL",        emoji: "🐍" },
  { id: "selfeval",    label: "Self-Eval",   emoji: "📈" },
  { id: "notes",       label: "Notes",       emoji: "📓" },
  { id: "ternary",     label: "Ternary",     emoji: "⚖️" },
  { id: "flags",       label: "Flags",       emoji: "🚩" },
  { id: "sce88",       label: "SCE-88",      emoji: "🧩" },
  { id: "shell",       label: "Shell",       emoji: "🖥️" },
  { id: "corpus",      label: "Corpus",      emoji: "📂" },
  { id: "coherence",   label: "Coherence",   emoji: "📉" },
  { id: "heatmap",     label: "Heatmap",     emoji: "🟩" },
  { id: "voicememos",  label: "Voice Memos", emoji: "🎙️" },
  { id: "absorb",      label: "Absorb",      emoji: "🧪" },
  { id: "exports",     label: "Exports",     emoji: "📤" },
  { id: "meshctl",     label: "Mesh Ctrl",   emoji: "🎮" },
  { id: "swarm",       label: "Swarm",       emoji: "🔀" },
  { id: "aeon",        label: "AEON",        emoji: "⚡" },
  { id: "field",       label: "Field",       emoji: "🌀" },
  { id: "chatlog",     label: "Chat Log",    emoji: "💬" },
  { id: "calibration", label: "Calibration", emoji: "🎛️" },
  { id: "cycles",      label: "Cycles",      emoji: "🔁" },
  { id: "smsarchive",  label: "SMS",         emoji: "💬" },
  { id: "phasehistory",label: "Phases",      emoji: "🌊" },
  { id: "memkeys",     label: "Mem Keys",    emoji: "🗝️" },
  { id: "federation",   label: "Federation",   emoji: "🌐" },
  { id: "forgeinbox",   label: "Forge Inbox",  emoji: "📥" },
  { id: "testrunner",   label: "Tests",        emoji: "🧪" },
  { id: "sentinellog",  label: "Sentinel",     emoji: "👁" },
  { id: "voiceinbox",   label: "Voice Inbox",  emoji: "🎤" },
  { id: "jarvishealth", label: "Jarvis Health",emoji: "💚" },
  { id: "agiaudit",     label: "AGI Audit",    emoji: "🔭" },
  { id: "agentboard",   label: "Agent Board",  emoji: "📋" },
  { id: "riemann",      label: "Riemann",      emoji: "∞" },
  { id: "constraintguard", label: "Constraints", emoji: "🛡" },
  { id: "gitlog",       label: "Git Log",      emoji: "⎇" },
  { id: "evostages",    label: "Evo Stages",   emoji: "🧬" },
  { id: "drivematrix",  label: "Drive Matrix", emoji: "🔢" },
  { id: "security",     label: "Security",     emoji: "🛡️" },
  { id: "browser",      label: "Browser AI",   emoji: "🌐" },
  { id: "memgraph",     label: "Mem Graph",    emoji: "🕸" },
  { id: "ctxbroker",   label: "Ctx Broker",   emoji: "🗃" },
  { id: "acttrace",   label: "Act Trace",    emoji: "📋" },
  { id: "goalstate",  label: "Goals",        emoji: "🎯" },
  { id: "persona",     label: "Persona",      emoji: "🗣" },
  { id: "sharedfacts", label: "Shared Facts", emoji: "🔗" },
  { id: "forgenotes",  label: "Forge Notes",  emoji: "📝" },
  { id: "selfmod",     label: "Self-Mod",     emoji: "🔧" },
  { id: "aeonlog",     label: "AEON Log",     emoji: "🚀" },
  { id: "agentrostr",  label: "Agent Roster", emoji: "🤖" },
  { id: "violations",  label: "Violations",   emoji: "⛔" },
  { id: "swarmdispatch", label: "Swarm Disp",  emoji: "🕸" },
  { id: "ltmemory",     label: "LT Memory",   emoji: "💾" },
  { id: "selfevalstore",label: "Self-Eval",   emoji: "🧮" },
  { id: "evoruns",      label: "Evo Runs",    emoji: "🔬" },
  { id: "phiucb",       label: "φ-UCB",       emoji: "φ" },
  { id: "sysinfo",        label: "System",       emoji: "🖥" },
  { id: "trashstats",    label: "Trash",        emoji: "🗑" },
  { id: "meshfeed",      label: "Mesh Feed",    emoji: "⬡" },
  { id: "goalproposals", label: "Goal Props",   emoji: "💡" },
  { id: "coherenceinbox", label: "Coh Inbox",   emoji: "📬" },
  { id: "standingfacts",  label: "Standing",    emoji: "📌" },
  { id: "forgerate",      label: "Forge Rate",  emoji: "📈" },
  { id: "voiceuserinbox", label: "Voice In",    emoji: "🎧" },
  { id: "sessionviewer",  label: "Session",     emoji: "💬" },
  { id: "forgeevents",    label: "Forge Evts",  emoji: "⚠" },
  { id: "forgeoutbox",    label: "Forge Out",   emoji: "📤" },
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
  const [cameraOn, setCameraOn] = useState(true);
  const [wideDock, setWideDock] = useState(false);

  const collapsed = activeTab === null;
  const dockWidth = collapsed ? "w-10" : activeTab === "security" && wideDock ? "w-[700px]" : "w-[420px]";

  return (
    <div className={cn(
      "shrink-0 border-l border-zinc-800 bg-zinc-950 flex transition-[width] duration-200",
      dockWidth
    )}>
      {/* Rail with tab buttons */}
      <div className="w-10 border-r border-zinc-900 flex flex-col items-center py-2 gap-1 shrink-0 overflow-y-auto">
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTab(isActive ? null : t.id)}
              title={t.label}
              className={cn(
                "w-8 h-8 rounded text-[13px] flex items-center justify-center border transition-colors shrink-0",
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
          className="w-8 h-8 mt-auto rounded border border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-emerald-400 hover:border-emerald-600 flex items-center justify-center shrink-0"
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
            {activeTab === "camera"      && <CameraTile active={cameraOn} onToggle={() => setCameraOn(v => !v)} />}
            {activeTab === "feed"        && <FeedTile onClose={() => onTab(null)} />}
            {activeTab === "phones"      && <PhonePicker onClose={() => onTab(null)} />}
            {activeTab === "memory"      && <MemoryPanel onClose={() => onTab(null)} />}
            {activeTab === "navigator"   && <NavigatorTile onClose={() => onTab(null)} />}
            {activeTab === "search"      && <CorpusSearch  onClose={() => onTab(null)} />}
            {activeTab === "agents"      && <AgentGraph    onClose={() => onTab(null)} />}
            {activeTab === "repos"       && <RepoHealth    onClose={() => onTab(null)} />}
            {activeTab === "metrics"     && <RffMetrics      onClose={() => onTab(null)} />}
            {activeTab === "events"      && <EventsLog      onClose={() => onTab(null)} />}
            {activeTab === "daemons"     && <DaemonDashboard onClose={() => onTab(null)} />}
            {activeTab === "dispatch"    && <AgentDispatch  onClose={() => onTab(null)} />}
            {activeTab === "ablation"    && <AblationMetrics    onClose={() => onTab(null)} />}
            {activeTab === "evolution"   && <EvolutionTracker  onClose={() => onTab(null)} />}
            {activeTab === "sessions"    && <SessionBrowser    onClose={() => onTab(null)} />}
            {activeTab === "editor"      && <PluginEditor      onClose={() => onTab(null)} />}
            {activeTab === "repl"        && <PythonRepl        onClose={() => onTab(null)} />}
            {activeTab === "selfeval"    && <SelfEvalChart     onClose={() => onTab(null)} />}
            {activeTab === "notes"       && <NotesBrowser     onClose={() => onTab(null)} />}
            {activeTab === "ternary"     && <TernaryExplorer  onClose={() => onTab(null)} />}
            {activeTab === "flags"       && <MeshFlagsEditor  onClose={() => onTab(null)} />}
            {activeTab === "sce88"       && <Sce88Audit       onClose={() => onTab(null)} />}
            {activeTab === "shell"       && <ShellHistory     onClose={() => onTab(null)} />}
            {activeTab === "corpus"      && <CorpusStats      onClose={() => onTab(null)} />}
            {activeTab === "coherence"   && <CoherenceTimeline onClose={() => onTab(null)} />}
            {activeTab === "heatmap"     && <AgentHeatmap     onClose={() => onTab(null)} />}
            {activeTab === "voicememos"  && <VoiceMemos       onClose={() => onTab(null)} />}
            {activeTab === "absorb"      && <AbsorbLog        onClose={() => onTab(null)} />}
            {activeTab === "exports"     && <ExportsViewer    onClose={() => onTab(null)} />}
            {activeTab === "meshctl"     && <MeshControl      onClose={() => onTab(null)} />}
            {activeTab === "swarm"       && <SwarmPanel       onClose={() => onTab(null)} />}
            {activeTab === "aeon"        && <AeonThrust       onClose={() => onTab(null)} />}
            {activeTab === "field"       && <FieldVisualizer  onClose={() => onTab(null)} />}
            {activeTab === "chatlog"     && <ChatLogBrowser   onClose={() => onTab(null)} />}
            {activeTab === "calibration" && <CalibrationChart onClose={() => onTab(null)} />}
            {activeTab === "cycles"      && <CyclesBrowser    onClose={() => onTab(null)} />}
            {activeTab === "smsarchive"  && <SmsArchive       onClose={() => onTab(null)} />}
            {activeTab === "phasehistory"&& <PhaseHistory     onClose={() => onTab(null)} />}
            {activeTab === "memkeys"     && <MemoryKeys       onClose={() => onTab(null)} />}
            {activeTab === "federation"  && <FederationPanel  onClose={() => onTab(null)} />}
            {activeTab === "forgeinbox"  && <ForgeInbox       onClose={() => onTab(null)} />}
            {activeTab === "testrunner"  && <TestRunner       onClose={() => onTab(null)} />}
            {activeTab === "sentinellog" && <SentinelLog      onClose={() => onTab(null)} />}
            {activeTab === "voiceinbox"  && <VoiceInbox       onClose={() => onTab(null)} />}
            {activeTab === "jarvishealth"&& <JarvisHealth     onClose={() => onTab(null)} />}
            {activeTab === "agiaudit"    && <AgiAudit         onClose={() => onTab(null)} />}
            {activeTab === "agentboard"  && <AgentBoard       onClose={() => onTab(null)} />}
            {activeTab === "riemann"     && <RiemannZeros     onClose={() => onTab(null)} />}
            {activeTab === "constraintguard" && <ConstraintGuard onClose={() => onTab(null)} />}
            {activeTab === "gitlog"      && <GitLog           onClose={() => onTab(null)} />}
            {activeTab === "evostages"   && <EvolutionStages  onClose={() => onTab(null)} />}
            {activeTab === "drivematrix" && <DriveMatrix      onClose={() => onTab(null)} />}
            {activeTab === "security"    && <SecuritySentinel onClose={() => onTab(null)} wideDock={wideDock} onToggleWide={() => setWideDock(v => !v)} />}
            {activeTab === "browser"     && <BrowserControl   onClose={() => onTab(null)} />}
            {activeTab === "memgraph"    && <MemoryGraph      onClose={() => onTab(null)} />}
            {activeTab === "ctxbroker"   && <ContextBroker   onClose={() => onTab(null)} />}
            {activeTab === "acttrace"    && <ActionTrace     onClose={() => onTab(null)} />}
            {activeTab === "goalstate"   && <GoalState       onClose={() => onTab(null)} />}
            {activeTab === "persona"     && <PersonaPanel    onClose={() => onTab(null)} />}
            {activeTab === "sharedfacts" && <SharedFacts     onClose={() => onTab(null)} />}
            {activeTab === "forgenotes"  && <ForgeNotes      onClose={() => onTab(null)} />}
            {activeTab === "selfmod"     && <SelfMod         onClose={() => onTab(null)} />}
            {activeTab === "aeonlog"     && <AeonRunLog      onClose={() => onTab(null)} />}
            {activeTab === "agentrostr"  && <AgentRoster     onClose={() => onTab(null)} />}
            {activeTab === "violations"   && <ViolationsLog   onClose={() => onTab(null)} />}
            {activeTab === "swarmdispatch"  && <SwarmDispatch   onClose={() => onTab(null)} />}
            {activeTab === "ltmemory"       && <LongTermMemory  onClose={() => onTab(null)} />}
            {activeTab === "selfevalstore"  && <SelfEvalStore   onClose={() => onTab(null)} />}
            {activeTab === "evoruns"        && <EvolutionRuns   onClose={() => onTab(null)} />}
            {activeTab === "phiucb"         && <PhiUCBState     onClose={() => onTab(null)} />}
            {activeTab === "sysinfo"         && <SystemInfo      onClose={() => onTab(null)} />}
            {activeTab === "trashstats"      && <TrashStats      onClose={() => onTab(null)} />}
            {activeTab === "meshfeed"        && <MeshFeed />}
            {activeTab === "goalproposals"   && <GoalProposals   onClose={() => onTab(null)} />}
            {activeTab === "coherenceinbox"  && <CoherenceInbox  onClose={() => onTab(null)} />}
            {activeTab === "standingfacts"   && <StandingFacts   onClose={() => onTab(null)} />}
            {activeTab === "forgerate"       && <ForgeRateLog    onClose={() => onTab(null)} />}
            {activeTab === "voiceuserinbox"  && <VoiceUserInbox  onClose={() => onTab(null)} />}
            {activeTab === "sessionviewer"   && <SessionViewer   onClose={() => onTab(null)} />}
            {activeTab === "forgeevents"     && <ForgeEventsLog  onClose={() => onTab(null)} />}
            {activeTab === "forgeoutbox"     && <ForgeOutbox     onClose={() => onTab(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}
