import { useState, useRef, useEffect } from "react";
import { PaperPlaneTilt, CircleNotch } from "@phosphor-icons/react";
import { MicButton } from "./MicButton";
import { useVoiceXova } from "@/hooks/useVoiceXova";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  role: "user" | "xova";
  text: string;
  ts: number;
  /** Optional inline image (absolute local file path; rendered via tauri convertFileSrc). */
  image?: string;
  /** User-flagged keepers — surfaced via /pinned. */
  pinned?: boolean;
  /** Self-evaluation rating fired automatically after each Xova reply.
   *  hallucinationRisk: 1 (sure) … 5 (likely fabrication).
   *  answered: did the reply actually address the question?
   *  notes: short critique from the eval pass. */
  selfEval?: { answered: boolean; hallucinationRisk: number; notes?: string };
}

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  terminal: string[];
  meshConnected: boolean;
  meshError: string | null;
}

export function Sidebar({ messages, onSend, terminal, meshConnected, meshError }: Props) {
  const [input, setInput] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const { isListening, isSpeaking, toggleListening } = useVoiceXova((cmd) => onSend(cmd));

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [terminal]);

  const submit = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Xova Assistant</h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={cn("w-1.5 h-1.5 rounded-full", meshConnected ? "bg-emerald-500" : "bg-red-500")} />
            <span className="text-[10px] text-slate-500">
              {meshConnected ? "Mesh online" : meshError ? "Mesh error" : "Connecting..."}
            </span>
          </div>
        </div>
        <MicButton isListening={isListening} isSpeaking={isSpeaking} onToggle={toggleListening} />
      </div>

      <div ref={chatRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-8 px-2 leading-relaxed">
            Bound by the Codex.<br/>Ask me anything. I will not lie, misdirect, circle, gaslight, or talk in mystic shit.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[90%] px-3 py-2 rounded-lg text-xs leading-relaxed",
              m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-900"
            )}>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-slate-200">
        <div className="flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Command Xova..."
            className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={submit}
            className="px-2.5 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            disabled={!input.trim()}
          >
            <PaperPlaneTilt size={14} weight="fill" />
          </button>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-slate-900 text-emerald-400 font-mono">
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-700 flex items-center gap-1.5">
          <CircleNotch size={10} />
          Live Terminal
        </div>
        <div ref={termRef} className="h-32 overflow-y-auto px-3 py-2 text-[10px] leading-tight space-y-0.5">
          {terminal.length === 0 ? (
            <div className="text-slate-600">$ awaiting dispatch...</div>
          ) : terminal.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
