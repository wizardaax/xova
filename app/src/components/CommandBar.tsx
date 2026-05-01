import { useEffect, useRef, useState } from "react";
import { PaperPlaneTilt, Microphone, MicrophoneSlash, SpeakerHigh, Stop } from "@phosphor-icons/react";
import { useVoiceXova } from "@/hooks/useVoiceXova";
import { cn } from "@/lib/utils";

interface CommandBarProps {
  onSend: (text: string) => void;
  isBusy: boolean;
  onStop: () => void;
}

// Static list of slash commands for autocomplete. Order matters — most-used first.
// Keep in sync with /help in App.tsx.
const SLASH_COMMANDS: { cmd: string; hint: string }[] = [
  { cmd: "/help", hint: "list all commands" },
  { cmd: "/clear", hint: "clear chat history" },
  { cmd: "/cam", hint: "toggle camera tile" },
  { cmd: "/feed", hint: "toggle feed grid" },
  { cmd: "/phones", hint: "toggle phone picker" },
  { cmd: "/memory", hint: "toggle memory viewer" },
  { cmd: "/screen", hint: "screenshot + describe" },
  { cmd: "/region", hint: "snip a region" },
  { cmd: "/snip", hint: "snip a region" },
  { cmd: "/backup", hint: "snapshot memory" },
  { cmd: "/export", hint: "save chat to markdown" },
  { cmd: "/enroll", hint: "record voice for ID" },
  { cmd: "/save", hint: "save last reply to snippets" },
  { cmd: "/snippets", hint: "show saved snippets" },
  { cmd: "/note ", hint: "append text to notes" },
  { cmd: "/notes", hint: "show notes" },
  { cmd: "/clear-pins", hint: "unpin all" },
  { cmd: "/clear-snippets", hint: "delete snippets" },
  { cmd: "/clear-notes", hint: "delete notes" },
  { cmd: "/templates", hint: "list saved prompts" },
  { cmd: "/template ", hint: "run a template" },
  { cmd: "/template-save ", hint: "save a template" },
  { cmd: "/template-delete ", hint: "remove a template" },
  { cmd: "/find ", hint: "search chat history" },
  { cmd: "/stats", hint: "chat stats" },
  { cmd: "/whoami", hint: "user identity + status" },
  { cmd: "/who", hint: "online status" },
  { cmd: "/online", hint: "online status" },
  { cmd: "/launch ", hint: "open url or app" },
  { cmd: "/edit ", hint: "open file in notepad" },
  { cmd: "/cmd", hint: "open shell at C:\\Xova\\app" },
  { cmd: "/terminal", hint: "open shell" },
  { cmd: "/pin", hint: "pin last reply" },
  { cmd: "/pinned", hint: "show pinned" },
  { cmd: "/sessions", hint: "list saved sessions" },
  { cmd: "/save-session ", hint: "snapshot current chat" },
  { cmd: "/load-session ", hint: "swap to a saved session" },
  { cmd: "/new-session", hint: "archive and start fresh" },
  { cmd: "/redo", hint: "re-send last message" },
  { cmd: "/again", hint: "re-send last message" },
  { cmd: "/summarize", hint: "Ollama summary of recent" },
  { cmd: "/banter ", hint: "real cross-AI dialog (3 turns)" },
  { cmd: "/version", hint: "app version" },
  { cmd: "/uptime", hint: "how long xova has been running" },
];

export function CommandBar({ onSend, isBusy, onStop }: CommandBarProps) {
  const [input, setInput] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for prefill events fired by ChatFeed edit-button. Replaces the input
  // text and focuses, so the user can tweak and re-send.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string };
      if (typeof detail?.text === "string") {
        setInput(detail.text);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("xova-prefill", onPrefill);
    return () => window.removeEventListener("xova-prefill", onPrefill);
  }, []);

  // Filter slash commands by current input. Empty after `/` shows all.
  const suggestions = (() => {
    if (!input.startsWith("/")) return [];
    const q = input.toLowerCase();
    return SLASH_COMMANDS.filter((s) => s.cmd.toLowerCase().startsWith(q)).slice(0, 8);
  })();

  const acceptSuggestion = (cmd: string) => {
    setInput(cmd);
    setShowSuggest(false);
    setSuggestIdx(0);
  };
  // Voice handler ignores commands while a chat turn is in flight — prevents
  // overlapping ollamaChat calls if the user keeps talking before xova replies.
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const { isListening, isSpeaking, toggleListening } = useVoiceXova((cmd) => {
    if (isBusyRef.current) return;
    onSend(cmd);
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const cleanup = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => { /* ignore */ });
        audioCtxRef.current = null;
      }
      setMicLevel(0);
    };

    if (!isListening) {
      cleanup();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          setMicLevel(Math.min(1, rms * 3));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        console.warn("Mic level error:", e);
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [isListening]);

  const submit = () => {
    if (!input.trim() || isBusy) return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 px-6 py-3 shrink-0">
      <div className="max-w-4xl mx-auto flex items-center gap-2">
        <button
          onClick={toggleListening}
          title={isListening ? "Listening — click to stop" : "Click to enable voice"}
          className={cn(
            "h-10 w-10 flex items-center justify-center rounded transition-colors shrink-0",
            isListening ? "bg-rose-600 text-white animate-pulse" :
            isSpeaking ? "bg-emerald-600 text-white" :
            "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          )}
        >
          {isSpeaking ? <SpeakerHigh size={16} /> : isListening ? <MicrophoneSlash size={16} /> : <Microphone size={16} />}
        </button>
        {isListening && (
          <div className="flex items-center gap-0.5 shrink-0" title="Mic level">
            {[0, 1, 2, 3, 4].map((i) => {
              const lit = micLevel * 5 > i;
              return (
                <div
                  key={i}
                  className={cn(
                    "w-1.5 h-6 rounded-sm transition-colors",
                    lit ? "bg-emerald-500" : "bg-zinc-800"
                  )}
                />
              );
            })}
          </div>
        )}
        {isBusy && (
          <button
            onClick={onStop}
            title="Stop generation"
            className="h-10 w-10 flex items-center justify-center rounded bg-rose-600 hover:bg-rose-500 text-white shrink-0"
          >
            <Stop size={14} weight="fill" />
          </button>
        )}
        <div className="relative flex-1">
          {showSuggest && suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto border border-zinc-800 bg-zinc-950 rounded shadow-lg z-20 font-mono text-xs">
              {suggestions.map((s, i) => (
                <button
                  key={s.cmd}
                  onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(s.cmd); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 border-b border-zinc-900",
                    i === suggestIdx ? "bg-emerald-900/30 text-emerald-300" : "text-zinc-300 hover:bg-zinc-900"
                  )}
                >
                  <span>{s.cmd}</span>
                  <span className="text-zinc-500 text-[10px]">{s.hint}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggest(e.target.value.startsWith("/"));
              setSuggestIdx(0);
            }}
            onFocus={() => { if (input.startsWith("/")) setShowSuggest(true); }}
            onBlur={() => setTimeout(() => setShowSuggest(false), 100)}
            onKeyDown={(e) => {
              if (showSuggest && suggestions.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSuggestIdx((i) => (i + 1) % suggestions.length); return; }
                if (e.key === "ArrowUp")   { e.preventDefault(); setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
                if (e.key === "Tab")       { e.preventDefault(); acceptSuggestion(suggestions[suggestIdx].cmd); return; }
                if (e.key === "Escape")    { e.preventDefault(); setShowSuggest(false); return; }
              }
              if (e.key === "Enter") submit();
            }}
            placeholder={isBusy ? "Type to queue (submit blocked while xova replies)" : "Command Xova... (try / for commands)"}
            className="w-full h-10 px-3 bg-zinc-900 border border-zinc-800 rounded text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <button
          onClick={submit}
          disabled={!input.trim() || isBusy}
          className="h-10 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded transition-colors flex items-center justify-center"
        >
          <PaperPlaneTilt size={14} weight="fill" />
        </button>
      </div>
    </div>
  );
}
