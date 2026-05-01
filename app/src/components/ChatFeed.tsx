import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type ChatMessage } from "./Sidebar";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtDay(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (dayKey(ts) === dayKey(today.getTime())) return "Today";
  if (dayKey(ts) === dayKey(yesterday.getTime())) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/**
 * Belt-and-braces sanitizer: if the assistant's content is a JSON tool-call
 * (Ollama shape `{function: {name}}` OR OpenAI shape `{name, parameters}`),
 * replace it with a tidy stub instead of dumping raw JSON in front of the user.
 */
function sanitizeAssistantText(s: string): string {
  const t = s.trim();
  if (!t.startsWith("[") && !t.startsWith("{")) return s;
  try {
    const parsed = JSON.parse(t);
    const arr = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" ? [parsed] : null);
    if (!arr || arr.length === 0) return s;
    const names: string[] = [];
    for (const c of arr) {
      if (!c || typeof c !== "object") return s;
      const ollamaName = c.function && typeof c.function.name === "string" ? c.function.name : null;
      const openaiName = typeof c.name === "string" && (c.parameters || c.arguments) ? c.name : null;
      const name = ollamaName || openaiName;
      if (!name) return s;
      names.push(name);
    }
    return `(tool calls dispatched: ${names.join(", ")})`;
  } catch {}
  return s;
}

interface ChatFeedProps {
  messages: ChatMessage[];
  activity: string[];
  onTogglePin?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (text: string) => void;
  onSuggest?: (prompt: string) => void;
}

const STARTER_PROMPTS = [
  "what can you do?",
  "what's running on this machine right now?",
  "summarize my notes",
  "take a screenshot and tell me what you see",
  "what's in C:\\Xova\\memory\\snippets.md?",
  "jarvis, what time is it?",
];

export function ChatFeed({ messages, activity, onTogglePin, onDelete, onEdit, onSuggest }: ChatFeedProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuckToBottom, setStuckToBottom] = useState(true);
  // Track whether the user has scrolled up. If so, don't yank them back to the
  // bottom on every new message — but show a jump-to-bottom button instead.
  useEffect(() => {
    if (stuckToBottom) ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages, stuckToBottom]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStuckToBottom(distFromBottom < 80);
  };

  const jumpDown = () => {
    if (!ref.current) return;
    ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
    setStuckToBottom(true);
  };

  const recent = activity.slice(-5);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {!stuckToBottom && messages.length > 0 && (
        <button
          onClick={jumpDown}
          title="Jump to latest"
          className="absolute right-6 bottom-24 z-10 h-9 w-9 rounded-full bg-emerald-700/80 hover:bg-emerald-600 text-white shadow-lg flex items-center justify-center text-lg"
        >
          ↓
        </button>
      )}
      <div ref={ref} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 py-4 min-h-0 font-mono text-sm">
        {messages.length === 0 && (
          <div className="text-center pt-16 max-w-xl mx-auto">
            <div className="text-zinc-600 mb-6">Bound by the Codex. Awaiting input.</div>
            {onSuggest && (
              <div className="flex flex-wrap gap-2 justify-center">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => onSuggest(p)}
                    className="px-3 py-1.5 text-xs font-mono rounded border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-emerald-600 hover:text-emerald-400 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3 max-w-4xl mx-auto">
          {messages.map((m, idx) => {
            const isUser = m.role === "user";
            const isVoiceUser = m.id.startsWith("voice-user-");
            const isVoice = m.id.startsWith("voice-") && !isVoiceUser;
            const speaker = isVoiceUser ? "🎙 you" : isUser ? "you" : isVoice ? "🎙 jarvis" : "xova";
            const showDay = idx === 0 || dayKey(messages[idx - 1].ts) !== dayKey(m.ts);
            return (
              <div key={m.id} className="flex flex-col">
                {showDay && (
                  <div className="self-center my-2 text-[10px] font-mono uppercase tracking-wider text-zinc-600 px-3 py-0.5 border border-zinc-800 rounded-full bg-zinc-950">
                    {fmtDay(m.ts)}
                  </div>
                )}
              <div className={cn("flex flex-col group", isUser ? "items-end" : "items-start")}>
                <div className="text-[10px] text-zinc-600 mb-0.5 px-1 uppercase tracking-wider flex items-center gap-2">
                  <span>{speaker} · {fmtTime(m.ts)}</span>
                  {m.pinned && <span title="pinned" className="text-amber-400">📌</span>}
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    {!isUser && onTogglePin && (
                      <button
                        onClick={() => onTogglePin(m.id)}
                        title={m.pinned ? "unpin" : "pin reply"}
                        className="hover:text-amber-400"
                      >📌</button>
                    )}
                    {isUser && onEdit && !m.id.startsWith("voice-user-") && (
                      <button
                        onClick={() => onEdit(m.text)}
                        title="edit & resend"
                        className="hover:text-emerald-400"
                      >✎</button>
                    )}
                    <button
                      onClick={() => navigator.clipboard.writeText(m.text).catch(() => {})}
                      title="copy text"
                      className="hover:text-emerald-400"
                    >⧉</button>
                    {onDelete && (
                      <button
                        onClick={() => onDelete(m.id)}
                        title="delete from chat"
                        className="hover:text-rose-400"
                      >×</button>
                    )}
                  </span>
                </div>
                <div className={cn(
                  "leading-relaxed px-1 max-w-[90%]",
                  isUser ? "text-zinc-300 text-right whitespace-pre-wrap" :
                  isVoice ? "text-emerald-300 whitespace-pre-wrap" :
                  "text-zinc-100 prose prose-invert prose-sm max-w-none prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-code:text-amber-300 prose-code:bg-zinc-900 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-a:text-emerald-400"
                )}>
                  {isUser ? m.text : isVoice ? m.text : (
                    <ReactMarkdown
                      rehypePlugins={[rehypeHighlight]}
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noreferrer" className="underline">{children}</a>
                        ),
                      }}
                    >{sanitizeAssistantText(m.text)}</ReactMarkdown>
                  )}
                </div>
                {m.image && (
                  <a
                    href={convertFileSrc(m.image)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block max-w-[90%] border border-zinc-800 rounded overflow-hidden hover:border-emerald-600 transition-colors"
                    title={m.image}
                  >
                    <img
                      src={convertFileSrc(m.image)}
                      alt={m.image}
                      className="block w-full h-auto"
                      loading="lazy"
                    />
                  </a>
                )}
              </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-zinc-800 bg-zinc-950 px-6 py-2 shrink-0 max-h-20 overflow-y-auto">
        <div className="max-w-4xl mx-auto font-mono text-[10px] text-zinc-600 space-y-0.5 text-left">
          {recent.length === 0 ? (
            <div className="italic">awaiting activity...</div>
          ) : recent.map((line, i) => (
            <div key={i} className="truncate" title={line}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
