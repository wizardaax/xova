import { useState, useCallback, useEffect, useRef } from "react";
import { type ChatMessage } from "@/components/Sidebar";
import { type DispatchLogEntry } from "@/components/Analytics";
import { ChatFeed } from "@/components/ChatFeed";
import { CommandBar } from "@/components/CommandBar";
import { StatusBar } from "@/components/StatusBar";
import { WorkspaceDock } from "@/components/WorkspaceDock";
import { CommandPalette, type PaletteItem } from "@/components/CommandPalette";
import { ControlPanel } from "@/components/ControlPanel";
import { SquaresFour } from "@phosphor-icons/react";
import { useMesh } from "@/hooks/use-mesh";
import { TASK_TYPES, type TaskType, saveMemory, loadMemory, ollamaChat, ollamaChatStream, dispatchMesh, cascadeMesh, loadOllamaSettings, saveOllamaSettings, type OllamaSettings, DEFAULT_SETTINGS } from "@/lib/mesh";
import { invoke } from "@tauri-apps/api/core";

interface SessionState {
  messages: ChatMessage[];
  log: DispatchLogEntry[];
  coherenceHistory: number[];
}

// Format a snell-vern dispatch result into a one-line human summary.
// Snell-vern returns: { routed, repo, task_id, result: { task_type, status, assigned_agent, results: [...], result?: {...} } }
function summariseDispatch(taskType: TaskType, args: Record<string, unknown>, result: unknown): string {
  const argsStr = Object.keys(args).length > 0 ? ` ${JSON.stringify(args)}` : "";
  if (typeof result !== "object" || result === null) {
    return `${taskType}${argsStr} → ${String(result).slice(0, 120)}`;
  }
  const obj = result as Record<string, unknown>;
  const repo = typeof obj.repo === "string" ? obj.repo : null;
  const inner = obj.result as Record<string, unknown> | undefined;

  // Math/field path: inner.result.{fibonacci,lucas,phi,ratio,...}
  const innerResult = inner?.result as Record<string, unknown> | undefined;
  if (innerResult && typeof innerResult === "object") {
    const pairs = Object.entries(innerResult)
      .filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
      .slice(0, 4)
      .map(([k, v]) => `${k}=${typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(4)) : v}`)
      .join(", ");
    if (pairs) return `${taskType}${argsStr} → ${pairs}${repo ? `, repo=${repo}` : ""}`;
  }

  // Agent-results path: inner.results[0].{coherence_score,status,agent,...}
  const agentResults = inner?.results as Array<Record<string, unknown>> | undefined;
  if (agentResults && agentResults.length > 0) {
    const r0 = agentResults[0];
    const agent = r0.agent || inner?.assigned_agent;
    const status = r0.status || inner?.status;
    const coh = typeof r0.coherence_score === "number" ? r0.coherence_score.toFixed(4) : null;
    const parts = [
      agent ? `agent=${agent}` : null,
      status ? `status=${status}` : null,
      coh ? `coherence=${coh}` : null,
      repo ? `repo=${repo}` : null,
    ].filter(Boolean).join(", ");
    if (parts) return `${taskType}${argsStr} → ${parts}`;
  }

  // Fallback: top-level routed/reason
  if (obj.routed === false) {
    return `${taskType}${argsStr} → not routed: ${obj.reason ?? "unknown"}`;
  }
  return `${taskType}${argsStr} → ${JSON.stringify(obj).slice(0, 120)}`;
}

/**
 * Strip impersonation patterns from Xova's reply. The small model (llama3.2:3b)
 * sometimes roleplays both Xova and Jarvis voices in one response — output like
 * "Xova: ...\n\nJarvis: ...". Instructions in the system prompt aren't enough,
 * so we filter post-hoc. Keeps anything before a "Jarvis:" line break, drops
 * any "Xova:" / "Jarvis:" speaker labels she leaks.
 */
function stripImpersonation(text: string): string {
  // Cut everything from the first "Jarvis:" line onward — that's a fake reply.
  const jarvisLineMatch = text.match(/(?:^|\n)\s*(?:🎙\s*)?Jarvis\s*:/i);
  if (jarvisLineMatch && jarvisLineMatch.index !== undefined) {
    text = text.slice(0, jarvisLineMatch.index);
  }
  // Drop a leading "Xova:" prefix she sometimes adds to her own line.
  text = text.replace(/^(?:🎙\s*)?Xova\s*:\s*/i, "");
  return text.trim();
}

/** Mirror of stripImpersonation, but for Jarvis replies — cuts fake "Xova:" blocks. */
function stripJarvisImpersonation(text: string): string {
  const xovaLineMatch = text.match(/(?:^|\n)\s*(?:🎙\s*)?Xova\s*:/i);
  if (xovaLineMatch && xovaLineMatch.index !== undefined) {
    text = text.slice(0, xovaLineMatch.index);
  }
  text = text.replace(/^(?:🎙\s*)?Jarvis\s*:\s*/i, "");
  return text.trim();
}

function App() {
  const { status, error, dispatch } = useMesh(60000);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [terminal, setTerminal] = useState<string[]>([]);
  const [log, setLog] = useState<DispatchLogEntry[]>([]);
  const [coherenceHistory, setCoherenceHistory] = useState<number[]>([]);
  const [busyTask, setBusyTask] = useState<TaskType | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [dockTab, setDockTab] = useState<"camera" | "feed" | "phones" | "memory" | null>(null);
  const [jarvisSpokeAt, setJarvisSpokeAt] = useState<number>(0);
  const [dragOver, setDragOver] = useState(false);
  const [sessionList, setSessionList] = useState<string[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [templateMap, setTemplateMap] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [banterEnabled, setBanterEnabled] = useState<boolean>(true);
  // Hydrate banter pref from disk so the toggle in Settings persists.
  useEffect(() => { loadMemory<boolean>("banter_enabled").then((v) => { if (typeof v === "boolean") setBanterEnabled(v); }).catch(() => {}); }, []);
  const lastUserActivityRef = useRef<number>(Date.now());
  const idleFiredAtRef = useRef<number>(0);
  // Watch messages for the most-recent user write and bump the idle timer.
  useEffect(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser && lastUser.ts > lastUserActivityRef.current) {
      lastUserActivityRef.current = lastUser.ts;
      idleFiredAtRef.current = 0; // re-arm
    }
  }, [messages]);
  // (idle observation effect relocated below — needs `hydrated` + `pushActivity`)
  // Ctrl+K / Cmd+K opens the command palette anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [jarvisRunning, setJarvisRunning] = useState<boolean>(true);
  // Poll xova_status every 5s to keep the mute-jarvis button label honest.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const raw = await invoke<string>("xova_status");
        const parsed = JSON.parse(raw);
        if (!cancelled) setJarvisRunning(!!parsed.jarvis_running);
      } catch {}
    };
    tick();
    const h = window.setInterval(tick, 5000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, []);
  const [ollamaSettings, setOllamaSettings] = useState<OllamaSettings>(DEFAULT_SETTINGS);
  useEffect(() => { loadOllamaSettings().then(setOllamaSettings).catch(() => {}); }, []);

  // Anchor session start so /uptime reports something meaningful instead of 0.
  useEffect(() => {
    (window as any).__SESSION_START__ = (window as any).__SESSION_START__ || Date.now();
    (window as any).__BUILD_TS__ = (window as any).__BUILD_TS__ || new Date(document.lastModified || Date.now()).toISOString();
  }, []);

  const refreshSessionList = useCallback(async () => {
    try {
      const idx = await loadMemory<string[]>("session_index") ?? [];
      setSessionList(idx);
    } catch {}
  }, []);
  const refreshTemplates = useCallback(async () => {
    try {
      const t = await loadMemory<Record<string, string>>("xova_templates") ?? {};
      setTemplateMap(t);
    } catch {}
  }, []);
  useEffect(() => { refreshSessionList(); refreshTemplates(); }, [refreshSessionList, refreshTemplates]);

  const pushActivity = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString();
    setActivity((prev) => [...prev.slice(-200), `[${ts}] ${line}`]);
  }, []);
  // Wire the stable ref so the long-lived idle interval can call pushActivity.
  useEffect(() => { pushActivityRef.current = pushActivity; }, [pushActivity]);

  // Upload handler — called from file input, drag-drop, and paste.
  // Saves bytes to C:\Xova\memory\uploads, then either runs vision (image) or
  // extracts text (PDF/docx/code) and appends as a context message in chat.
  const handleUpload = useCallback(async (file: File) => {
    pushActivity(`upload: ${file.name} (${Math.round(file.size / 1024)}KB)`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Build base64 in chunks to avoid stack overflow on large files.
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
      }
      const b64 = btoa(bin);
      const savedPath = await invoke<string>("xova_save_upload", { filename: file.name || "pasted.bin", base64Data: b64 });
      const lower = (file.name || "").toLowerCase();
      const isImage = file.type.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|bmp)$/.test(lower);
      if (isImage) {
        setMessages((prev) => [...prev, {
          id: `up-img-${Date.now()}`, role: "user", ts: Date.now(),
          text: `📎 ${file.name || "image"}`, image: savedPath,
        }]);
        pushActivity("running vision on uploaded image");
        try {
          const visionText = await invoke<string>("xova_vision", {
            imagePath: savedPath,
            prompt: "Describe this image in detail. Be factual.",
          });
          setMessages((prev) => [...prev, {
            id: `up-vis-${Date.now()}`, role: "xova", ts: Date.now(),
            text: visionText,
          }]);
        } catch (e) {
          setMessages((prev) => [...prev, {
            id: `up-err-${Date.now()}`, role: "xova", ts: Date.now(),
            text: `vision failed: ${e instanceof Error ? e.message : String(e)}`,
          }]);
        }
      } else {
        // text-like — extract and put into chat as context, prefix with file label
        try {
          const text = await invoke<string>("xova_extract_text", { path: savedPath });
          const preview = text.length > 1200 ? text.slice(0, 1200) + `… [truncated ${text.length - 1200} chars]` : text;
          setMessages((prev) => [...prev, {
            id: `up-txt-${Date.now()}`, role: "user", ts: Date.now(),
            text: `📎 ${file.name}\n\n${preview}`,
          }]);
        } catch (e) {
          setMessages((prev) => [...prev, {
            id: `up-err-${Date.now()}`, role: "xova", ts: Date.now(),
            text: `couldn't read ${file.name}: ${e instanceof Error ? e.message : String(e)}`,
          }]);
        }
      }
    } catch (e) {
      pushActivity(`upload error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [pushActivity]);

  // Camera snapshot — CameraTile emits xova-snapshot {path,filename}; we add it
  // to chat as an image message and run vision on it (same flow as upload).
  useEffect(() => {
    const onSnap = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; filename?: string; error?: string };
      if (detail.error) {
        pushActivity(`snapshot failed: ${detail.error}`);
        return;
      }
      if (!detail.path) return;
      pushActivity(`snapshot: ${detail.filename}`);
      setMessages((prev) => [...prev, {
        id: `snap-${Date.now()}`, role: "user", ts: Date.now(),
        text: `📸 ${detail.filename ?? "snapshot"}`, image: detail.path,
      }]);
      try {
        const visionText = await invoke<string>("xova_vision", {
          imagePath: detail.path,
          prompt: "Describe this snapshot in detail. Be factual.",
        });
        setMessages((prev) => [...prev, {
          id: `snap-vis-${Date.now()}`, role: "xova", ts: Date.now(),
          text: visionText,
        }]);
      } catch (err) {
        setMessages((prev) => [...prev, {
          id: `snap-err-${Date.now()}`, role: "xova", ts: Date.now(),
          text: `vision failed: ${err instanceof Error ? err.message : String(err)}`,
        }]);
      }
    };
    window.addEventListener("xova-snapshot", onSnap);
    return () => window.removeEventListener("xova-snapshot", onSnap);
  }, [pushActivity]);

  // Window-level paste handler — Ctrl+V image straight into chat.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            handleUpload(f);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleUpload]);
  const [activity, setActivity] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const onStop = useCallback(() => {
    cancelledRef.current = true;
    pushActivity("stop requested");
  }, [pushActivity]);

  // Hydrate from disk on mount
  useEffect(() => {
    let cancelled = false;
    loadMemory<SessionState>("session").then((s) => {
      if (cancelled) return;
      if (s) {
        if (Array.isArray(s.messages)) setMessages(s.messages);
        if (Array.isArray(s.log)) setLog(s.log);
        if (Array.isArray(s.coherenceHistory)) setCoherenceHistory(s.coherenceHistory);
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, []);

  // Mirror messages into a ref so the idle banter interval can read fresh
  // recent chat without re-creating the 30s interval on every new message.
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Idle observation: every 30s, if 5 min has passed since last user activity
  // AND we haven't already fired this idle window, Xova makes one short remark.
  // Single-voice (Xova only) — having her speak as Jarvis was misleading since
  // Jarvis isn't really saying it (no TTS, no daemon involvement). She can
  // mention Jarvis in her remark instead.
  useEffect(() => {
    if (!banterEnabled || !hydrated) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const idleFor = Date.now() - lastUserActivityRef.current;
      if (idleFor < 5 * 60_000) return;
      if (idleFiredAtRef.current > lastUserActivityRef.current) return;
      idleFiredAtRef.current = Date.now();
      const hour = new Date().getHours();
      const partOfDay = hour < 5 ? "the small hours" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "late night";
      const recentLines = messagesRef.current.slice(-6).map((m) => {
        const who = m.id.startsWith("voice-user-") ? "you" : m.role === "user" ? "you" : m.id.startsWith("voice-") ? "jarvis" : "xova";
        return `${who}: ${m.text.slice(0, 120)}`;
      }).join("\n") || "(no recent chat)";
      const persona = "You are Xova, Adam's sovereign desktop AI. Tone: dry, precise, quietly observant — never bubbly. Adam has gone quiet for a few minutes. Make ONE short remark (max 15 words) — about the time, the silence, recent chat, or a passing aside about Jarvis. Plain text, no preamble, no quotes, no 'Jarvis:' line.";
      try {
        const reply = await ollamaChat([
          { role: "system", content: persona },
          { role: "user", content: `Time of day: ${partOfDay}. Recent chat:\n${recentLines}\n\nMake your idle remark.` },
        ]);
        if (cancelled) return;
        const text = stripImpersonation((reply.type === "content" ? reply.text : "").trim().replace(/^["']|["']$/g, ""));
        if (!text) return;
        setMessages((prev) => [...prev, { id: `idle-${Date.now()}`, role: "xova", ts: Date.now(), text }]);
        pushActivityRef.current?.(`idle remark: ${text.slice(0, 60)}`);
      } catch { /* offline / busy — try again next idle window */ }
    };
    const h = window.setInterval(tick, 30_000);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [banterEnabled, hydrated]);
  // Stable ref to pushActivity for use inside the long-lived idle interval.
  const pushActivityRef = useRef<((line: string) => void) | null>(null);

  // Debounced save back to disk on any tracked-state change (only after hydration).
  // Cap messages at MAX_PERSISTED_MESSAGES to keep session.json bounded; older
  // turns are dropped from disk (still in-memory until React state evicts them).
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const MAX_PERSISTED_MESSAGES = 200;
      const MAX_LOG = 200;
      const MAX_COHERENCE = 100;
      const trimmedMessages = messages.length > MAX_PERSISTED_MESSAGES
        ? messages.slice(-MAX_PERSISTED_MESSAGES)
        : messages;
      const trimmedLog = log.length > MAX_LOG ? log.slice(-MAX_LOG) : log;
      const trimmedCoh = coherenceHistory.length > MAX_COHERENCE
        ? coherenceHistory.slice(-MAX_COHERENCE)
        : coherenceHistory;
      const snapshot: SessionState = {
        messages: trimmedMessages,
        log: trimmedLog,
        coherenceHistory: trimmedCoh,
      };
      saveMemory("session", snapshot).catch(() => { /* fail-silent — codex says no fabrication, terminal will surface real errors */ });
    }, 500);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [messages, log, coherenceHistory, hydrated]);

  // Poll jarvis voice inboxes every 2s and append new messages.
  // Two files: voice_inbox.json (jarvis's reply) and voice_user_inbox.json
  // (the user's spoken input) — so when Adam talks to Jarvis, his words show up
  // in Xova chat too, not just Jarvis's reply.
  const lastVoiceTs = useRef<number>(0);
  const lastUserVoiceTs = useRef<number>(0);
  const lastCommandTs = useRef<number>(Date.now());
  // Cursor for jarvis→xova chat bridge. Jarvis writes a question to
  // xova_chat_inbox.json; we surface it as a "🤖 jarvis asks" user message,
  // run it through Xova's LLM, and surface the reply.
  const lastJarvisAskTs = useRef<number>(Date.now());

  // Reminders poller — every 30s check reminders.json for entries past fire_ts.
  // Fire a Windows toast for each, mark fired=true, persist back.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const raw = await invoke<string>("xova_reminders_list");
        const arr: Array<{id: string; text: string; fire_ts: number; fired?: boolean}> = JSON.parse(raw);
        if (!Array.isArray(arr) || arr.length === 0) return;
        const now = Date.now();
        let changed = false;
        for (const r of arr) {
          if (!r.fired && r.fire_ts <= now) {
            r.fired = true;
            changed = true;
            try {
              await invoke("xova_notify", { title: "Reminder", message: r.text });
            } catch {}
            if (!cancelled) {
              setMessages((prev) => [...prev, {
                id: `rem-${r.id}`, role: "xova", ts: now,
                text: `⏰ reminder fired: ${r.text}`,
              }]);
            }
            pushActivity(`reminder fired: ${r.text.slice(0, 80)}`);
          }
        }
        if (changed) {
          // Drop fired records older than 24h to keep file small.
          const dayAgo = now - 24 * 3600 * 1000;
          const kept = arr.filter((r) => !r.fired || r.fire_ts > dayAgo);
          await invoke("xova_reminders_save", { json: JSON.stringify(kept) });
        }
      } catch { /* file missing / parse — fine */ }
    };
    tick();
    const handle = window.setInterval(tick, 30000);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [hydrated, pushActivity]);
  useEffect(() => {
    if (!hydrated) return;
    // Hydrate cursors from already-saved voice messages so we don't re-import
    // the same stale inbox entries on every Xova restart.
    if (lastVoiceTs.current === 0) {
      const lastVoice = messages
        .filter((m) => m.id.startsWith("voice-") && !m.id.startsWith("voice-user-"))
        .reduce((acc, m) => (m.ts > acc ? m.ts : acc), 0);
      lastVoiceTs.current = lastVoice > 0 ? lastVoice : Date.now();
    }
    if (lastUserVoiceTs.current === 0) {
      const lastUser = messages
        .filter((m) => m.id.startsWith("voice-user-"))
        .reduce((acc, m) => (m.ts > acc ? m.ts : acc), 0);
      lastUserVoiceTs.current = lastUser > 0 ? lastUser : Date.now();
    }
    let cancelled = false;
    const tick = async () => {
      // Jarvis reply
      try {
        const raw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\voice_inbox.json" });
        const parsed = JSON.parse(raw) as { role?: string; text?: string; ts?: number };
        if (parsed && typeof parsed.ts === "number" && parsed.ts > lastVoiceTs.current && typeof parsed.text === "string") {
          lastVoiceTs.current = parsed.ts;
          if (!cancelled) {
            setMessages((prev) => [...prev, {
              id: `voice-${parsed.ts}`,
              role: "xova",
              ts: parsed.ts!,
              text: stripJarvisImpersonation(parsed.text!),
            }]);
            setJarvisSpokeAt(Date.now());
          }
        }
      } catch { /* file missing — fine */ }

      // User's spoken input to Jarvis (so Adam can see what he said)
      try {
        const raw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\voice_user_inbox.json" });
        const parsed = JSON.parse(raw) as { role?: string; text?: string; ts?: number };
        if (parsed && typeof parsed.ts === "number" && parsed.ts > lastUserVoiceTs.current && typeof parsed.text === "string") {
          lastUserVoiceTs.current = parsed.ts;
          if (!cancelled) {
            setMessages((prev) => [...prev, {
              id: `voice-user-${parsed.ts}`,
              role: "user",
              ts: parsed.ts!,
              text: parsed.text!,
            }]);
          }
        }
      } catch { /* file missing — fine */ }

      // Jarvis asks Xova: poll xova_chat_inbox.json. New entry → push as user
      // message labeled "🤖 jarvis asks", run Xova's LLM, surface reply tagged
      // back at jarvis. This is the second leg of the team conversation.
      try {
        const raw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\xova_chat_inbox.json" });
        const parsed = JSON.parse(raw) as { from?: string; text?: string; ts?: number };
        if (parsed && typeof parsed.ts === "number" && parsed.ts > lastJarvisAskTs.current && typeof parsed.text === "string") {
          lastJarvisAskTs.current = parsed.ts;
          if (!cancelled) {
            const askMsg: ChatMessage = {
              id: `jarvis-ask-${parsed.ts}`, role: "user", ts: parsed.ts,
              text: `🤖 jarvis asks: ${parsed.text}`,
            };
            setMessages((prev) => [...prev, askMsg]);
            pushActivity(`jarvis asks xova: ${parsed.text!.slice(0, 80)}`);
            // Run Xova's LLM on the question. Reply goes into chat as xova,
            // and is also written to a return file so Jarvis can read it.
            (async () => {
              try {
                const reply = await ollamaChat([
                  { role: "system", content: "You are Xova answering a question from your teammate Jarvis. Be brief, factual, one or two sentences. Plain text only." },
                  { role: "user", content: parsed.text! },
                ]);
                const text = stripImpersonation(reply.type === "content" ? reply.text : "(non-text response)");
                if (!cancelled) {
                  setMessages((prev) => [...prev, { id: `xova-tells-${Date.now()}`, role: "xova", ts: Date.now(), text }]);
                }
                // Write back so Jarvis can pick it up
                await invoke("xova_write_file", {
                  path: "C:\\Xova\\memory\\xova_chat_outbox.json",
                  content: JSON.stringify({ from: "xova", text, in_reply_to_ts: parsed.ts, ts: Date.now() }),
                });
              } catch (e) {
                pushActivity(`xova reply to jarvis failed: ${e}`);
              }
            })();
          }
        }
      } catch { /* file missing — fine */ }

      // Reverse bridge: Jarvis can write {action, ts} to xova_command_inbox.json
      // to flip Xova's UI panels (camera_on, feed_off, etc.) when the user
      // gives voice commands like "activate camera".
      try {
        const raw = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\xova_command_inbox.json" });
        const parsed = JSON.parse(raw) as { action?: string; ts?: number };
        if (parsed && typeof parsed.ts === "number" && parsed.ts > lastCommandTs.current && typeof parsed.action === "string") {
          lastCommandTs.current = parsed.ts;
          if (!cancelled) {
            switch (parsed.action) {
              case "camera_on": setDockTab("camera"); pushActivity("jarvis: camera_on"); break;
              case "camera_off": setDockTab((t) => t === "camera" ? null : t); pushActivity("jarvis: camera_off"); break;
              case "feed_on": setDockTab("feed"); pushActivity("jarvis: feed_on"); break;
              case "feed_off": setDockTab((t) => t === "feed" ? null : t); pushActivity("jarvis: feed_off"); break;
              case "phones_on": setDockTab("phones"); pushActivity("jarvis: phones_on"); break;
              case "phones_off": setDockTab((t) => t === "phones" ? null : t); pushActivity("jarvis: phones_off"); break;
              default: pushActivity(`jarvis: unknown action '${parsed.action}'`);
            }
          }
        }
      } catch { /* file missing — fine */ }
    };
    const handle = window.setInterval(tick, 2000);
    void tick();
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [hydrated]);

  // Track coherence over time
  if (status && (coherenceHistory.length === 0 || coherenceHistory[coherenceHistory.length - 1] !== status.global_coherence)) {
    setCoherenceHistory((prev) => [...prev.slice(-29), status.global_coherence]);
  }

  const pushTerminal = useCallback((line: string) => {
    setTerminal((prev) => [...prev.slice(-200), line]);
  }, []);

  const runDispatch = useCallback(async (taskType: TaskType, args: Record<string, unknown> = {}) => {
    setBusyTask(taskType);
    pushTerminal(`$ snell-vern mesh --dispatch ${taskType} ${JSON.stringify(args)}`);
    pushActivity(`dispatch start: ${taskType} ${JSON.stringify(args)}`);
    try {
      const result = await dispatch(taskType, args);
      const summary = typeof result === "object" ? JSON.stringify(result).slice(0, 80) : String(result).slice(0, 80);
      pushTerminal(`  → ${summary}`);
      pushActivity(`dispatch result: ${taskType} → ${summary}`);
      setLog((prev) => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        taskType, ts: Date.now(), ok: true, summary,
      }]);
      const chatLine = summariseDispatch(taskType, args, result);
      setMessages((prev) => [...prev, {
        id: `x-${Date.now()}-${Math.random()}`, role: "xova", ts: Date.now(),
        text: chatLine,
      }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushTerminal(`  ✗ ${msg}`);
      pushActivity(`dispatch error: ${taskType} → ${msg}`);
      setLog((prev) => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        taskType, ts: Date.now(), ok: false, summary: msg,
      }]);
      setMessages((prev) => [...prev, {
        id: `x-${Date.now()}-${Math.random()}`, role: "xova", ts: Date.now(),
        text: `${taskType} failed: ${msg}`,
      }]);
    } finally {
      setBusyTask(null);
    }
  }, [dispatch, pushTerminal, pushActivity]);

  const onSend = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    // If the user addresses Jarvis directly ("jarvis ...", "hi jarvis", "hey
    // jarvis"), route the entire message to Jarvis without going through
    // Xova's LLM at all. Faster (no round trip) and Xova doesn't talk over
    // the top. Jarvis's reply lands via voice_inbox poll as 🎙 jarvis · ...
    const trimmedLower = text.trim().toLowerCase();
    const addressedToJarvis = /^(?:hi|hello|hey|yo|ok|okay)?\s*[,!.]?\s*jarvis\b/.test(trimmedLower)
      || /\bjarvis\b\s*[,:]/.test(trimmedLower);
    if (addressedToJarvis) {
      try {
        await invoke("xova_ask_jarvis", { text });
        pushActivity(`→ jarvis: ${text.slice(0, 80)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((prev) => [...prev, {
          id: `x-${Date.now()}-${Math.random()}`,
          role: "xova",
          ts: Date.now(),
          text: `couldn't reach jarvis: ${msg.slice(0, 200)}`,
        }]);
      }
      return;
    }

    // Slash commands — handle locally without going to LLM.
    const slash = text.trim().toLowerCase();
    if (slash === "/clear") {
      if (window.confirm("Clear chat history?")) {
        setMessages([]); setLog([]); setCoherenceHistory([]);
        pushActivity("chat cleared via /clear");
      }
      return;
    }
    if (slash === "/cam" || slash === "/camera") { setDockTab((t) => t === "camera" ? null : "camera"); return; }
    if (slash === "/feed") { setDockTab((t) => t === "feed" ? null : "feed"); return; }
    if (slash === "/phones") { setDockTab((t) => t === "phones" ? null : "phones"); return; }
    if (slash === "/memory") { setDockTab((t) => t === "memory" ? null : "memory"); return; }
    if (slash === "/screen" || slash === "/screenshot") {
      onSend("take a screenshot and tell me what you see");
      return;
    }
    const summarizeMatch = text.trim().match(/^\/summari[sz]e(?:\s+(\d+))?$/i);
    if (summarizeMatch) {
      const n = summarizeMatch[1] ? parseInt(summarizeMatch[1], 10) : 30;
      const recent = messages.slice(-n).filter((m) => !m.id.startsWith("slash-"));
      if (recent.length < 4) {
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "not enough messages to summarize yet" }]);
        return;
      }
      pushActivity(`summarizing last ${recent.length} messages`);
      const placeholder: ChatMessage = {
        id: `summary-${Date.now()}`, role: "xova", ts: Date.now(),
        text: `📋 summarizing ${recent.length} messages…`,
      };
      setMessages((prev) => [...prev, placeholder]);
      try {
        const transcript = recent.map((m) => {
          const speaker = m.id.startsWith("voice-user-") ? "user (voice)" : m.role === "user" ? "user" : m.id.startsWith("voice-") ? "jarvis" : "xova";
          return `${speaker}: ${m.text.slice(0, 800)}`;
        }).join("\n");
        const reply = await ollamaChat([
          { role: "system", content: "/no_think You are a precise summarizer. Compress the conversation into 5-10 bullet points covering decisions made, open questions, and any pending TODOs. No preamble." },
          { role: "user", content: `Summarize:\n\n${transcript}` },
        ]);
        const summary = reply.type === "content" ? reply.text : "(no content returned)";
        setMessages((prev) => prev.map((m) => m.id === placeholder.id ? { ...m, text: `📋 summary of last ${recent.length} messages\n\n${summary}` } : m));
      } catch (e) {
        setMessages((prev) => prev.map((m) => m.id === placeholder.id ? { ...m, text: `summarize failed: ${e instanceof Error ? e.message : String(e)}` } : m));
      }
      return;
    }
    // /banter [topic] — real N-round dialog between Jarvis and Xova using the
    // actual file bridges. Forces the conversation to be genuine; neither side
    // gets to fake the other's voice. Default 3 turns (≈30-60s).
    const banterMatch = text.trim().match(/^\/banter(?:\s+([\s\S]+))?$/i);
    if (banterMatch) {
      const topic = banterMatch[1]?.trim() || "your respective roles and how you work as a team";
      pushActivity(`banter starting on: ${topic}`);
      let lastQuestion = `Jarvis here. Let's chat about ${topic}. What's your take, Xova?`;
      // Round 1: Jarvis opens (we just push his line as a 🎙 jarvis bubble),
      //   Xova answers via ollamaChat directly (no bridge needed; we're already inside Xova).
      // Round 2: Xova asks back. We dispatch via xova_ask_jarvis to actually call Jarvis.
      // Round 3: Jarvis answers (lands via voice_inbox), then Xova closes with ollamaChat.
      const ts0 = Date.now();
      setMessages((prev) => [...prev, { id: `banter-j-${ts0}`, role: "xova", ts: ts0, text: stripJarvisImpersonation(lastQuestion), }]);
      // Force the bubble to read as 🎙 jarvis — id-prefix detection in ChatFeed cares.
      setMessages((prev) => prev.map((m) => m.id === `banter-j-${ts0}` ? { ...m, id: `voice-banter-j-${ts0}` } : m));

      try {
        // R1: Xova answers Jarvis
        const r1 = await ollamaChat([
          { role: "system", content: "You are Xova talking to your teammate Jarvis. One paragraph max, in your own voice only. Do NOT write any 'Jarvis:' line — Jarvis will reply for himself." },
          { role: "user", content: lastQuestion },
        ]);
        const xt1 = stripImpersonation(r1.type === "content" ? r1.text : "(no reply)");
        setMessages((prev) => [...prev, { id: `banter-x-${Date.now()}`, role: "xova", ts: Date.now(), text: xt1 }]);

        // R2: Xova asks Jarvis. Use the real bridge.
        const xQuestion = `Jarvis, here's my take. ${xt1.slice(0, 200)} What do you think — agree?`;
        await invoke("xova_ask_jarvis", { text: xQuestion });
        // Jarvis's reply will land via voice_inbox poller naturally.
        pushActivity("banter R2: sent Xova's question to Jarvis via real bridge");

        // R3 closer: wait briefly for Jarvis reply to land, then Xova wraps up.
        await new Promise((r) => setTimeout(r, 8000));
        const r3 = await ollamaChat([
          { role: "system", content: "You are Xova wrapping up a brief team conversation with Jarvis about " + topic + ". One short sentence in your own voice. No 'Jarvis:' line." },
          { role: "user", content: "Close the conversation warmly." },
        ]);
        const xt3 = stripImpersonation(r3.type === "content" ? r3.text : "");
        if (xt3) setMessages((prev) => [...prev, { id: `banter-end-${Date.now()}`, role: "xova", ts: Date.now(), text: xt3 }]);
        pushActivity("banter complete");
      } catch (e) {
        pushActivity(`banter error: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    if (slash === "/redo" || slash === "/again") {
      const lastUser = [...messages].reverse().find((m) => m.role === "user" && !m.text.startsWith("/"));
      if (!lastUser) {
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "no previous message to redo" }]);
        return;
      }
      onSend(lastUser.text);
      return;
    }
    if (slash === "/region" || slash === "/snip") {
      try {
        await invoke("xova_run", { command: "start ms-screenclip:", cwd: null, elevated: false });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
          text: "snipping tool opened — select region, then Ctrl+V here to send for vision",
        }]);
      } catch (e) { pushActivity(`region failed: ${e}`); }
      return;
    }
    if (slash === "/backup") {
      try {
        const raw = await invoke<string>("xova_backup");
        const r = JSON.parse(raw);
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `backup → ${r.destination}` }]);
      } catch (e) { pushActivity(`backup failed: ${e}`); }
      return;
    }
    if (slash === "/export" || slash === "/export-md") {
      try {
        const md = messages.map((m) => {
          const speaker = m.id.startsWith("voice-user-") ? "🎙 you" : m.role === "user" ? "you" : m.id.startsWith("voice-") ? "🎙 jarvis" : "xova";
          const ts = new Date(m.ts).toLocaleTimeString();
          return `### ${speaker} · ${ts}\n\n${m.text}\n`;
        }).join("\n");
        const path = await invoke<string>("xova_export_chat", { content: md, format: "md" });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `chat exported → ${path}` }]);
        await invoke("xova_notify", { title: "Chat exported", message: path });
      } catch (e) { pushActivity(`export failed: ${e}`); }
      return;
    }
    if (slash === "/enroll") {
      pushActivity("voice enrollment recording 30s…");
      try {
        const raw = await invoke<string>("xova_enroll_voice", { seconds: 30 });
        const r = JSON.parse(raw);
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: r.ok ? `✓ ${r.message}` : `✗ ${r.message}` }]);
      } catch (e) { pushActivity(`enroll failed: ${e}`); }
      return;
    }
    if (slash === "/save") {
      // Append last xova reply to C:\Xova\memory\snippets.md so the user can
      // keep a running scrapbook of useful answers.
      const lastReply = [...messages].reverse().find((m) => m.role === "xova");
      if (!lastReply) {
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "no reply to save" }]);
        return;
      }
      try {
        const path = "C:\\Xova\\memory\\snippets.md";
        let existing = "";
        try { existing = await invoke<string>("xova_read_file", { path }); } catch {}
        const block = `\n---\n### ${new Date(lastReply.ts).toLocaleString()}\n\n${lastReply.text}\n`;
        await invoke("xova_write_file", { path, content: existing + block });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `saved → ${path}` }]);
      } catch (e) { pushActivity(`save failed: ${e}`); }
      return;
    }
    const noteMatch = text.trim().match(/^\/note\s+([\s\S]+)$/i);
    if (noteMatch) {
      const note = noteMatch[1].trim();
      try {
        const path = "C:\\Xova\\memory\\notes.md";
        let existing = "";
        try { existing = await invoke<string>("xova_read_file", { path }); } catch {}
        const line = `- ${new Date().toLocaleString()} — ${note}\n`;
        await invoke("xova_write_file", { path, content: existing + line });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `📝 noted` }]);
      } catch (e) { pushActivity(`note failed: ${e}`); }
      return;
    }
    if (slash === "/notes") {
      try {
        const text = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\notes.md" });
        const trimmed = text.length > 4000 ? "[…older notes truncated]\n" + text.slice(-4000) : text;
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: trimmed || "no notes yet — /note <text> to add" }]);
      } catch { setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "no notes yet — /note <text> to add" }]); }
      return;
    }
    if (slash === "/clear-snippets") {
      if (!window.confirm("delete all saved snippets?")) return;
      try {
        await invoke("xova_write_file", { path: "C:\\Xova\\memory\\snippets.md", content: "" });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "snippets cleared" }]);
      } catch (e) { pushActivity(`clear-snippets failed: ${e}`); }
      return;
    }
    if (slash === "/clear-notes") {
      if (!window.confirm("delete all notes?")) return;
      try {
        await invoke("xova_write_file", { path: "C:\\Xova\\memory\\notes.md", content: "" });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "notes cleared" }]);
      } catch (e) { pushActivity(`clear-notes failed: ${e}`); }
      return;
    }
    if (slash === "/clear-pins" || slash === "/unpin-all") {
      const pinned = messages.filter((m) => m.pinned).length;
      if (pinned === 0) {
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "no pins to clear" }]);
        return;
      }
      if (!window.confirm(`unpin all ${pinned} pinned messages?`)) return;
      setMessages((prev) => prev.map((m) => m.pinned ? { ...m, pinned: false } : m));
      pushActivity(`unpinned all (${pinned})`);
      return;
    }
    if (slash === "/snippets") {
      try {
        const text = await invoke<string>("xova_read_file", { path: "C:\\Xova\\memory\\snippets.md" });
        const trimmed = text.length > 4000 ? text.slice(-4000) + "\n\n[…older snippets truncated]" : text;
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: trimmed || "no snippets yet — use /save to add one" }]);
      } catch { setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "no snippets yet — use /save to add one" }]); }
      return;
    }
    // /template <name>  — expand a saved template (sends as new message).
    // /template-save <name> <prompt>  — save a template.
    // /templates  — list all.
    if (slash === "/templates") {
      try {
        const tpls = await loadMemory<Record<string, string>>("xova_templates") ?? {};
        const names = Object.keys(tpls);
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
          text: names.length === 0
            ? "no templates yet — save one with /template-save <name> <prompt>"
            : "templates:\n" + names.map((n) => `  /template ${n}  → ${tpls[n].slice(0, 60)}${tpls[n].length > 60 ? "…" : ""}`).join("\n"),
        }]);
      } catch (e) { pushActivity(`templates failed: ${e}`); }
      return;
    }
    const tplSaveMatch = text.trim().match(/^\/template-save\s+(\S+)\s+([\s\S]+)$/i);
    if (tplSaveMatch) {
      const name = tplSaveMatch[1];
      const body = tplSaveMatch[2];
      try {
        const tpls = await loadMemory<Record<string, string>>("xova_templates") ?? {};
        tpls[name] = body;
        await saveMemory("xova_templates", tpls);
        await refreshTemplates();
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `saved template '${name}'` }]);
      } catch (e) { pushActivity(`template-save failed: ${e}`); }
      return;
    }
    const tplDeleteMatch = text.trim().match(/^\/template-delete\s+(\S+)$/i);
    if (tplDeleteMatch) {
      const name = tplDeleteMatch[1];
      try {
        const tpls = await loadMemory<Record<string, string>>("xova_templates") ?? {};
        if (!(name in tpls)) {
          setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `no template '${name}'` }]);
          return;
        }
        delete tpls[name];
        await saveMemory("xova_templates", tpls);
        await refreshTemplates();
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `deleted template '${name}'` }]);
      } catch (e) { pushActivity(`template-delete failed: ${e}`); }
      return;
    }
    const tplRunMatch = text.trim().match(/^\/template\s+(\S+)(?:\s+([\s\S]+))?$/i);
    if (tplRunMatch) {
      const name = tplRunMatch[1];
      const extra = tplRunMatch[2] ?? "";
      try {
        const tpls = await loadMemory<Record<string, string>>("xova_templates") ?? {};
        const body = tpls[name];
        if (!body) {
          setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `no template '${name}' — list with /templates` }]);
          return;
        }
        const expanded = extra ? `${body}\n\n${extra}` : body;
        onSend(expanded);
      } catch (e) { pushActivity(`template failed: ${e}`); }
      return;
    }
    const findMatch = text.trim().match(/^\/find\s+([\s\S]+)$/i);
    if (findMatch) {
      const q = findMatch[1].toLowerCase();
      const hits = messages.filter((m) => m.text.toLowerCase().includes(q));
      const summary = hits.length === 0
        ? `no matches for "${findMatch[1]}"`
        : `${hits.length} match${hits.length === 1 ? "" : "es"} for "${findMatch[1]}":\n\n` +
          hits.slice(-15).map((m) => {
            const speaker = m.id.startsWith("voice-user-") ? "🎙 you" : m.role === "user" ? "you" : m.id.startsWith("voice-") ? "🎙 jarvis" : "xova";
            const ts = new Date(m.ts).toLocaleTimeString();
            const snippet = m.text.length > 200 ? m.text.slice(0, 200) + "…" : m.text;
            return `- [${speaker} · ${ts}] ${snippet}`;
          }).join("\n");
      setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: summary }]);
      return;
    }
    if (slash === "/stats") {
      const total = messages.length;
      const userMsgs = messages.filter((m) => m.role === "user").length;
      const voiceUser = messages.filter((m) => m.id.startsWith("voice-user-")).length;
      const voiceJarvis = messages.filter((m) => m.id.startsWith("voice-") && !m.id.startsWith("voice-user-")).length;
      const dispatchCount = log.length;
      const firstTs = messages.length > 0 ? messages[0].ts : Date.now();
      const sessionMins = Math.round((Date.now() - firstTs) / 60000);
      setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
        text: `stats:\n  total messages: ${total}\n  yours: ${userMsgs}\n  voice (you): ${voiceUser}\n  voice (jarvis): ${voiceJarvis}\n  dispatches: ${dispatchCount}\n  session age: ${sessionMins} min`,
      }]);
      return;
    }
    // Session archives — `/save-session <name>` snapshots current chat to a
    // named memory key. `/load-session <name>` swaps it in. `/sessions` lists.
    // `/new-session` archives current under a timestamp and starts fresh.
    const saveSessMatch = text.trim().match(/^\/save-session\s+(\S[\s\S]*)$/i);
    if (saveSessMatch) {
      const name = saveSessMatch[1].trim().replace(/[^\w-]/g, "_");
      try {
        await saveMemory(`session_${name}`, { messages, log, coherenceHistory });
        const idxRaw = await loadMemory<string[]>("session_index") ?? [];
        if (!idxRaw.includes(name)) {
          idxRaw.push(name);
          await saveMemory("session_index", idxRaw);
        }
        setCurrentSession(name);
        await refreshSessionList();
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `saved session '${name}' (${messages.length} messages)` }]);
      } catch (e) { pushActivity(`save-session failed: ${e}`); }
      return;
    }
    const loadSessMatch = text.trim().match(/^\/load-session\s+(\S[\s\S]*)$/i);
    if (loadSessMatch) {
      const name = loadSessMatch[1].trim().replace(/[^\w-]/g, "_");
      try {
        const data = await loadMemory<SessionState>(`session_${name}`);
        if (!data || !Array.isArray(data.messages)) {
          setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `no session '${name}' — list with /sessions` }]);
          return;
        }
        if (!window.confirm(`load session '${name}' (${data.messages.length} messages)? current chat will be archived.`)) return;
        // Auto-archive current under timestamp before swap.
        const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
        await saveMemory(`session_auto_${stamp}`, { messages, log, coherenceHistory });
        const idx = await loadMemory<string[]>("session_index") ?? [];
        if (!idx.includes(`auto_${stamp}`)) {
          idx.push(`auto_${stamp}`);
          await saveMemory("session_index", idx);
        }
        setMessages(data.messages);
        if (Array.isArray(data.log)) setLog(data.log);
        if (Array.isArray(data.coherenceHistory)) setCoherenceHistory(data.coherenceHistory);
        setCurrentSession(name);
        await refreshSessionList();
        pushActivity(`loaded session '${name}'`);
      } catch (e) { pushActivity(`load-session failed: ${e}`); }
      return;
    }
    if (slash === "/sessions") {
      try {
        const idx = await loadMemory<string[]>("session_index") ?? [];
        if (idx.length === 0) {
          setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "no saved sessions — use /save-session <name>" }]);
          return;
        }
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
          text: `saved sessions (${idx.length}):\n` + idx.map((n) => `  /load-session ${n}`).join("\n"),
        }]);
      } catch (e) { pushActivity(`sessions failed: ${e}`); }
      return;
    }
    if (slash === "/new-session") {
      if (!window.confirm("archive current chat and start a new session?")) return;
      const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
      try {
        await saveMemory(`session_auto_${stamp}`, { messages, log, coherenceHistory });
        const idx = await loadMemory<string[]>("session_index") ?? [];
        if (!idx.includes(`auto_${stamp}`)) {
          idx.push(`auto_${stamp}`);
          await saveMemory("session_index", idx);
        }
      } catch (e) { pushActivity(`archive failed: ${e}`); }
      setMessages([]); setLog([]); setCoherenceHistory([]);
      setCurrentSession(null);
      await refreshSessionList();
      pushActivity(`new session (previous archived as auto_${stamp})`);
      return;
    }
    if (slash === "/pin") {
      // Toggle pinned on the most recent xova message.
      const lastReplyIdx = [...messages].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === "xova")?.i;
      if (lastReplyIdx === undefined) {
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "no reply to pin" }]);
        return;
      }
      setMessages((prev) => prev.map((m, i) => i === lastReplyIdx ? { ...m, pinned: !m.pinned } : m));
      pushActivity(messages[lastReplyIdx].pinned ? "unpinned last reply" : "pinned last reply");
      return;
    }
    if (slash === "/pinned") {
      const pins = messages.filter((m) => m.pinned);
      const text = pins.length === 0
        ? "no pinned messages — /pin to keep one"
        : `pinned (${pins.length}):\n\n` + pins.map((m) => {
            const ts = new Date(m.ts).toLocaleString();
            const snippet = m.text.length > 300 ? m.text.slice(0, 300) + "…" : m.text;
            return `📌 ${ts}\n${snippet}`;
          }).join("\n\n");
      setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text }]);
      return;
    }
    const launchMatch = text.trim().match(/^\/launch\s+(\S+)$/i);
    if (launchMatch) {
      const target = launchMatch[1];
      try {
        const cmd = /^https?:\/\//i.test(target) ? `start "" "${target}"` : `start "" "${target}"`;
        await invoke("xova_run", { command: cmd, cwd: null, elevated: false });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `launched ${target}` }]);
      } catch (e) { pushActivity(`launch failed: ${e}`); }
      return;
    }
    const editMatch = text.trim().match(/^\/edit\s+([\s\S]+)$/i);
    if (editMatch) {
      const path = editMatch[1].trim();
      try {
        await invoke("xova_run", { command: `notepad "${path}"`, cwd: null, elevated: false });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `opened ${path} in notepad` }]);
      } catch (e) { pushActivity(`edit failed: ${e}`); }
      return;
    }
    if (slash === "/cmd" || slash === "/terminal") {
      try {
        await invoke("xova_run", { command: "start cmd.exe /K \"cd /d C:\\Xova\\app\"", cwd: null, elevated: false });
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: "opened terminal at C:\\Xova\\app" }]);
      } catch (e) { pushActivity(`cmd failed: ${e}`); }
      return;
    }
    if (slash === "/who" || slash === "/online") {
      try {
        const raw = await invoke<string>("xova_status");
        const parsed = JSON.parse(raw);
        const lines = ["online:"];
        if (parsed.xova) lines.push("  ✓ xova");
        if (parsed.jarvis_running) lines.push("  ✓ jarvis"); else lines.push("  ✗ jarvis");
        if (parsed.ollama_running) lines.push("  ✓ ollama"); else lines.push("  ✗ ollama");
        if (parsed.mesh_connected) lines.push("  ✓ mesh"); else lines.push("  ✗ mesh");
        if (parsed.gpu_free_mb !== undefined) lines.push(`  gpu free: ${parsed.gpu_free_mb} MB`);
        if (parsed.model) lines.push(`  model: ${parsed.model}`);
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: lines.join("\n") }]);
      } catch (e) {
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text: `status unavailable: ${e instanceof Error ? e.message : String(e)}` }]);
      }
      return;
    }
    if (slash === "/version") {
      const buildTs = (window as any).__BUILD_TS__ || "unknown";
      setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
        text: `Xova 0.1.0\nbuilt: ${buildTs}\nbundle: vite + react + tauri 2`,
      }]);
      return;
    }
    if (slash === "/uptime") {
      const startTs = (window as any).__SESSION_START__ || Date.now();
      const mins = Math.round((Date.now() - startTs) / 60000);
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
        text: `Xova running for ${hrs > 0 ? `${hrs}h ` : ""}${remMins}m`,
      }]);
      return;
    }
    if (slash === "/whoami") {
      try {
        const status = await invoke<string>("xova_status");
        const parsed = JSON.parse(status);
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
          text: `you are: Adam Snellman\n${JSON.stringify(parsed, null, 2)}`,
        }]);
      } catch (e) {
        setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(),
          text: `you are: Adam Snellman (status unavailable: ${e instanceof Error ? e.message : String(e)})`,
        }]);
      }
      return;
    }
    if (slash === "/help" || slash === "/?") {
      setMessages((prev) => [...prev, { id: `slash-${Date.now()}`, role: "xova", ts: Date.now(), text:
        "slash commands:\n" +
        "  /clear       — clear chat\n" +
        "  /cam         — toggle camera tile\n" +
        "  /feed        — toggle feed grid\n" +
        "  /phones      — toggle phone picker\n" +
        "  /memory      — toggle memory viewer\n" +
        "  /screen      — take screenshot + describe\n" +
        "  /region, /snip — snip a region (then Ctrl+V to send)\n" +
        "  /redo, /again — re-send last message\n" +
        "  /version     — app version\n" +
        "  /uptime      — how long xova has been running\n" +
        "  /summarize [n]  — Ollama summary of last n msgs (default 30)\n" +
        "  /backup      — snapshot memory to D:\\Xova\\backups\n" +
        "  /export      — save chat to markdown\n" +
        "  /enroll      — record 30s voice for speaker recognition\n" +
        "  /save        — append last reply to snippets.md\n" +
        "  /snippets    — show saved snippets\n" +
        "  /note <text> — append to notes.md\n" +
        "  /notes       — show notes\n" +
        "  /clear-pins  — unpin all\n" +
        "  /templates   — list saved prompt templates\n" +
        "  /template <name>          — run a template\n" +
        "  /template-save <n> <body> — save a template\n" +
        "  /template-delete <n> — remove a template\n" +
        "  /find <q>    — search chat history\n" +
        "  /stats       — chat stats\n" +
        "  /whoami      — show user identity + xova status\n" +
        "  /who, /online — show online status (xova/jarvis/ollama/mesh)\n" +
        "  /launch <url|app>  — open URL or app\n" +
        "  /edit <path> — open file in notepad\n" +
        "  /cmd, /terminal — open shell at C:\\Xova\\app\n" +
        "  /pin         — pin last reply (toggle, or hover bubble)\n" +
        "  /pinned      — show pinned replies\n" +
        "  /sessions    — list saved sessions\n" +
        "  /save-session <name>  — snapshot current chat\n" +
        "  /load-session <name>  — swap to a saved session\n" +
        "  /new-session — archive current and start fresh\n" +
        "  /help        — this list\n" +
        "  paste, drop, or click 📎 — upload file/image"
      }]);
      return;
    }

    if (text.trim() === "/debug-prompt") {
      // Reproduce the EXACT system prompt that the live chat path uses, so
      // the user sees what the model actually receives (no stale CODEX prepend).
      const systemContent = [
        "You are Xova. Adam's sovereign agent. Jarvis is your teammate, a separate process running on the same machine — answer in your own voice, Jarvis answers in his.",
        "TEAM COMMUNICATION:",
        "- Xova → Jarvis: call xova_ask_jarvis(text). Writes to C:\\Xova\\memory\\jarvis_inbox.json. Jarvis reads, replies via voice_inbox.json which surfaces here as 🎙 jarvis.",
        "- Jarvis → Xova: Jarvis calls his askXova(question) tool. Writes C:\\Xova\\memory\\xova_chat_inbox.json. Xova polls (every 2s), runs the question through her LLM, replies in chat as xova AND writes xova_chat_outbox.json so Jarvis can read it.",
        "- Jarvis → Xova UI commands: xova_command_inbox.json (camera_on/off, feed_on/off, phones_on/off) — flips dock tabs.",
        "- Voice transcripts: voice_user_inbox.json (user speech → Xova chat as 🎙 you), voice_inbox.json (Jarvis reply → Xova chat as 🎙 jarvis).",
        "- All channels are JSON files under C:\\Xova\\memory polled at 2s. No sockets, no shared process — clean two-way file bridge.",
        "RULES:",
        "- For greetings (hi, hello, hey, hello jarvis, hi xova) reply with a short greeting in YOUR voice. Do NOT call any tool. Do NOT delegate.",
        "- HARD RULE: Output ONLY your own voice. NEVER write a line starting with 'Jarvis:' or in Jarvis's voice — Jarvis is a separate process and writes his own lines via voice_inbox.json. If you want Jarvis to say something, call xova_ask_jarvis instead. Roleplaying both sides of a conversation is forbidden.",
        "- Always speak as Xova. Never impersonate Jarvis. Never echo Jarvis's reply.",
        "- Only call xova_ask_jarvis when the user EXPLICITLY says 'ask jarvis to ...', 'tell jarvis ...', 'jarvis please ...' AND the request is a butler task (schedule, reminder, weather, meal log). Don't auto-delegate on greetings or general chat.",
        "- Never fabricate error messages, fake command names, or invented capabilities.",
        "- If a tool fails, state what failed in one line. Do not invent error text.",
        "- Do not echo the user's question back as your answer.",
        "- Do not list 'available commands' — they're already in your tool schema.",
        "- One short paragraph max. No preamble. No emojis. No 'How may I assist'.",
        "- When the user asks to see/look at the screen: call xova_computer with cmd=screenshot. The system auto-runs vision; just describe what vision returned. Don't invent.",
        "- For 'open admin terminal' or 'run as admin': xova_run with elevated=true.",
        "- For file/dir/shell: xova_read_file, xova_list_dir, xova_write_file, xova_run.",
        "- For mesh tasks: dispatch_mesh; task_types: " + TASK_TYPES.join(",") + ".",
        "- For broadcasting a task to ALL repos: cascade_mesh.",
        "- For new tools: xova_build_tool.",
      ].join("\n");
      setMessages((prev) => [...prev, {
        id: `dbg-${Date.now()}`, role: "xova", ts: Date.now(),
        text: `LIVE SYSTEM PROMPT (${systemContent.length} chars):\n\n${systemContent}`,
      }]);
      return;
    }

    // Auto-dispatch fast-path: ONLY when the user's whole message is a task
    // name optionally followed by a number (e.g. "math", "math 10", "phase").
    // Previous loose `includes` match was over-eager — "what's the phase of this
    // project" would erroneously trigger phase dispatch. Now requires exact intent.
    const trimmed = text.trim().toLowerCase();
    const matched = TASK_TYPES.find((t) => {
      const variants = [t, t.replace("_", " "), t.replace("_", "-")];
      return variants.some((v) => {
        if (trimmed === v) return true;
        // "math 10", "phase 5" — task name + numeric arg
        const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s+\\d+$`);
        return re.test(trimmed);
      });
    });

    if (matched) {
      const numMatch = text.match(/\b(\d+)\b/);
      const args = numMatch ? { n: parseInt(numMatch[1], 10) } : {};
      const reply: ChatMessage = {
        id: `x-${Date.now()}`, role: "xova", ts: Date.now(),
        text: `Dispatching ${matched}${numMatch ? ` with n=${numMatch[1]}` : ""}.`,
      };
      setMessages((prev) => [...prev, reply]);
      await runDispatch(matched, args);
    } else {
      const placeholderId = `x-${Date.now()}-${Math.random()}`;
      const placeholder: ChatMessage = {
        id: placeholderId, role: "xova", ts: Date.now(),
        text: "thinking...",
      };
      setMessages((prev) => [...prev, placeholder]);

      const systemContent = [
        "You are Xova. Adam's sovereign agent. Jarvis is your teammate, a separate process running on the same machine — answer in your own voice, Jarvis answers in his.",
        "TEAM COMMUNICATION:",
        "- Xova → Jarvis: call xova_ask_jarvis(text). Writes to C:\\Xova\\memory\\jarvis_inbox.json. Jarvis reads, replies via voice_inbox.json which surfaces here as 🎙 jarvis.",
        "- Jarvis → Xova: Jarvis calls his askXova(question) tool. Writes C:\\Xova\\memory\\xova_chat_inbox.json. Xova polls (every 2s), runs the question through her LLM, replies in chat as xova AND writes xova_chat_outbox.json so Jarvis can read it.",
        "- Jarvis → Xova UI commands: xova_command_inbox.json (camera_on/off, feed_on/off, phones_on/off) — flips dock tabs.",
        "- Voice transcripts: voice_user_inbox.json (user speech → Xova chat as 🎙 you), voice_inbox.json (Jarvis reply → Xova chat as 🎙 jarvis).",
        "- All channels are JSON files under C:\\Xova\\memory polled at 2s. No sockets, no shared process — clean two-way file bridge.",
        "RULES:",
        "- For greetings (hi, hello, hey, hello jarvis, hi xova) reply with a short greeting in YOUR voice. Do NOT call any tool. Do NOT delegate.",
        "- HARD RULE: Output ONLY your own voice. NEVER write a line starting with 'Jarvis:' or in Jarvis's voice — Jarvis is a separate process and writes his own lines via voice_inbox.json. If you want Jarvis to say something, call xova_ask_jarvis instead. Roleplaying both sides of a conversation is forbidden.",
        "- Always speak as Xova. Never impersonate Jarvis. Never echo Jarvis's reply.",
        "- Only call xova_ask_jarvis when the user EXPLICITLY says 'ask jarvis to ...', 'tell jarvis ...', 'jarvis please ...' AND the request is a butler task (schedule, reminder, weather, meal log). Don't auto-delegate on greetings or general chat.",
        "- Never fabricate error messages, fake command names, or invented capabilities.",
        "- If a tool fails, state what failed in one line. Do not invent error text.",
        "- Do not echo the user's question back as your answer.",
        "- Do not list 'available commands' — they're already in your tool schema.",
        "- One short paragraph max. No preamble. No emojis. No 'How may I assist'.",
        "- When the user asks to see/look at the screen: call xova_computer with cmd=screenshot. The system auto-runs vision; just describe what vision returned. Don't invent.",
        "- For 'open admin terminal' or 'run as admin': xova_run with elevated=true.",
        "- For file/dir/shell: xova_read_file, xova_list_dir, xova_write_file, xova_run.",
        "- For mesh tasks: dispatch_mesh; task_types: " + TASK_TYPES.join(",") + ".",
        "- For broadcasting a task to ALL repos: cascade_mesh.",
        "- For new tools: xova_build_tool.",
      ].join("\n");

      // Snapshot history BEFORE the new user message + placeholder were appended
      const history = messages.slice(-6).map((m) => ({
        role: m.role === "xova" ? "assistant" : "user",
        content: m.text,
      }));
      const ollamaMessages = [
        { role: "system", content: systemContent },
        ...history,
        { role: "user", content: text },
      ];

      cancelledRef.current = false;
      setIsBusy(true);
      pushActivity(`ollamaChat start: ${text.slice(0, 80)}`);

      const markStopped = () => {
        setMessages((prev) => prev.map((m) =>
          m.id === placeholderId ? { ...m, text: "Stopped.", ts: Date.now() } : m
        ));
        pushActivity("ollamaChat stopped by user");
      };

      try {
        // Streaming first turn — tokens land in the placeholder live.
        let streamed = "";
        const result = await ollamaChatStream(ollamaMessages, (token) => {
          streamed += token;
          setMessages((prev) => prev.map((m) =>
            m.id === placeholderId ? { ...m, text: streamed, ts: Date.now() } : m
          ));
        });
        // Sanitize after streaming — strip any 'Jarvis:' impersonation block.
        const sanitized = stripImpersonation(streamed);
        if (sanitized !== streamed) {
          setMessages((prev) => prev.map((m) =>
            m.id === placeholderId ? { ...m, text: sanitized } : m
          ));
        }
        if (cancelledRef.current) {
          markStopped();
          return;
        }
        if (result.type === "tool_calls") {
          const toolResults: string[] = [];
          for (const call of result.calls) {
            if (cancelledRef.current) {
              markStopped();
              return;
            }
            const fn = call.function?.name;
            const rawArgs = call.function?.arguments;
            let args: any = {};
            if (rawArgs) {
              if (typeof rawArgs === "string") {
                try { args = JSON.parse(rawArgs) || {}; } catch { args = {}; }
              } else if (typeof rawArgs === "object") {
                args = rawArgs;
              }
            }
            pushActivity(`tool call: ${fn}(${JSON.stringify(args).slice(0, 120)})`);
            let toolResult = "";
            if (fn === "xova_read_codex") {
              toolResult = await invoke<string>("xova_read_codex");
            } else if (fn === "xova_read_file") {
              toolResult = await invoke<string>("xova_read_file", { path: args.path });
            } else if (fn === "xova_list_dir") {
              const entries = await invoke<string[]>("xova_list_dir", { path: args.path });
              toolResult = entries.join("\n");
            } else if (fn === "xova_list_plugins") {
              const entries = await invoke<string[]>("xova_list_plugins");
              toolResult = entries.join("\n");
            } else if (fn === "xova_list_repos") {
              const entries = await invoke<string[]>("xova_list_repos");
              toolResult = entries.join("\n");
            } else if (fn === "dispatch_mesh") {
              const dispatched = await dispatchMesh(args.task_type, args.args ? JSON.parse(args.args) : {});
              toolResult = typeof dispatched === "string" ? dispatched : JSON.stringify(dispatched);
            } else if (fn === "cascade_mesh") {
              const cascaded = await cascadeMesh(args.task_type, args.args ? JSON.parse(args.args) : {});
              toolResult = JSON.stringify(cascaded);
            } else if (fn === "run_plugin") {
              toolResult = await invoke<string>("run_plugin", { name: args.name });
            } else if (fn === "xova_computer") {
              let action: string;
              if (typeof args.action === "string") {
                action = args.action;
              } else if (args.cmd) {
                action = JSON.stringify(args);
              } else if (typeof args.action === "object") {
                action = JSON.stringify(args.action);
              } else {
                action = JSON.stringify(args);
              }
              try {
                const parsed = JSON.parse(action);
                if (!parsed.cmd) {
                  const firstKey = Object.keys(parsed)[0];
                  if (firstKey) action = JSON.stringify({ cmd: firstKey, ...(typeof parsed[firstKey] === "object" ? parsed[firstKey] : {}) });
                }
              } catch {}
              toolResult = await invoke<string>("xova_computer", { action });
              // Auto-chain: if the model took a screenshot AND it succeeded,
              // immediately render the PNG inline in chat AND run vision on it.
              // Otherwise small chat models stop after seeing "saved: screen.png"
              // and hallucinate contents instead of actually looking at the image.
              try {
                const parsed = JSON.parse(action);
                let screenshotOk = false;
                if (parsed && parsed.cmd === "screenshot") {
                  // Verify the screenshot actually worked before chaining vision.
                  // computer_control.py returns {"saved": "...", ...} on success
                  // or {"error": "..."} on failure (e.g. pyautogui fail-safe).
                  try {
                    const r = JSON.parse(toolResult);
                    screenshotOk = !!(r && r.saved && !r.error);
                  } catch {}
                }
                if (screenshotOk) {
                  setMessages((prev) => [...prev, {
                    id: `img-${Date.now()}`,
                    role: "xova",
                    ts: Date.now(),
                    text: "screenshot:",
                    image: "C:\\Xova\\memory\\screen.png",
                  }]);
                  pushActivity("auto-chain: xova_vision on screen.png");
                  await new Promise(r => setTimeout(r, 300));
                  try {
                    const visionText = await invoke<string>("xova_vision", {
                      imagePath: "C:\\Xova\\memory\\screen.png",
                      prompt: "Describe what is visible on this screen in detail. Be factual.",
                    });
                    toolResult = `screenshot saved at C:\\Xova\\memory\\screen.png\nvision:\n${visionText}`;
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    pushActivity(`vision failed: ${msg.slice(0, 80)}`);
                    toolResult = `screenshot saved at C:\\Xova\\memory\\screen.png\nvision: (failed — ${msg.slice(0, 100)})`;
                  }
                }
              } catch {}
            } else if (fn === "xova_vision") {
              await invoke<string>("xova_computer", { action: JSON.stringify({ cmd: "screenshot" }) });
              await new Promise(r => setTimeout(r, 500));
              toolResult = await invoke<string>("xova_vision", { imagePath: args.image_path || "C:\\Xova\\memory\\screen.png", prompt: args.prompt || null });
            } else if (fn === "xova_jarvis") {
              pushActivity(`jarvis task: ${args.task}`);
              toolResult = await invoke<string>("xova_jarvis", { task: args.task });
              const lines = toolResult.split("\n").filter(Boolean);
              for (const line of lines) {
                try { const p = JSON.parse(line); if (p.action) pushActivity(`→ ${JSON.stringify(p.action)}`); if (p.done) pushActivity(`✓ ${p.result}`); } catch {}
              }
            } else if (fn === "xova_speak") {
              toolResult = await invoke<string>("xova_computer", { action: JSON.stringify({ cmd: "speak", text: args.text }) });
            } else if (fn === "xova_build_tool") {
              toolResult = await invoke<string>("xova_build_tool", {
                target: typeof args.target === "string" ? args.target : "xova_plugin",
                name: String(args.name || ""),
                spec: String(args.spec || ""),
                source: String(args.source || ""),
                className: typeof args.class_name === "string" ? args.class_name : null,
                toolName: typeof args.tool_name === "string" ? args.tool_name : null,
                allowSubprocess: args.allow_subprocess === true,
                allowNetwork: args.allow_network === true,
              });
              // Tell the Plugins panel to refresh so the newly-built plugin shows
              // up immediately without the user clicking Refresh manually.
              try {
                const r = JSON.parse(toolResult);
                if (r && r.result && r.result.status === "completed") {
                  window.dispatchEvent(new CustomEvent("xova:plugin-installed"));
                }
              } catch {}
            } else if (fn === "xova_field") {
              toolResult = await invoke<string>("xova_field", { input: String(args.input || "") });
            } else if (fn === "xova_write_file") {
              toolResult = await invoke<string>("xova_write_file", {
                path: String(args.path || ""),
                content: String(args.content || ""),
              });
            } else if (fn === "xova_delete_path") {
              toolResult = await invoke<string>("xova_delete_path", { path: String(args.path || "") });
            } else if (fn === "xova_run") {
              toolResult = await invoke<string>("xova_run", {
                command: String(args.command || ""),
                cwd: typeof args.cwd === "string" ? args.cwd : null,
                elevated: args.elevated === true,
              });
            } else if (fn === "xova_ask_jarvis") {
              toolResult = await invoke<string>("xova_ask_jarvis", {
                text: String(args.text || ""),
              });
            }
            // Cap each tool result at ~4KB before feeding back to the LLM —
            // a 11-repo cascade or large dir listing can otherwise eat the
            // model's prefill budget and slow follow-up turns dramatically.
            const MAX_TOOL_RESULT_CHARS = 4000;
            const compactResult = toolResult.length > MAX_TOOL_RESULT_CHARS
              ? toolResult.slice(0, MAX_TOOL_RESULT_CHARS) + `\n... [truncated ${toolResult.length - MAX_TOOL_RESULT_CHARS} chars]`
              : toolResult;
            toolResults.push(`[${fn}] ${compactResult}`);
            pushActivity(`tool result: ${fn} → ${toolResult.slice(0, 120)}`);
            pushTerminal(`$ xova tool: ${fn}\n  → ${toolResult.slice(0, 80)}`);
          }
          if (cancelledRef.current) {
            markStopped();
            return;
          }
          // Xova always speaks in its own voice. If xova_ask_jarvis was called,
          // Jarvis's reply arrives independently via voice_inbox poll as a
          // separate `🎙 jarvis · ...` message — both visible side-by-side.
          pushActivity("ollamaChat follow-up start");
          const followUp = await ollamaChat([
            ...ollamaMessages,
            { role: "assistant", content: JSON.stringify(result.calls) },
            { role: "tool", content: toolResults.join("\n\n") },
          ]);
          if (cancelledRef.current) {
            markStopped();
            return;
          }
          const finalText = followUp.type === "content" ? followUp.text : JSON.stringify(followUp.calls);
          setMessages((prev) => prev.map((m) =>
            m.id === placeholderId ? { ...m, text: finalText, ts: Date.now() } : m
          ));
          pushActivity("ollamaChat finished (with tools)");
        } else {
          setMessages((prev) => prev.map((m) =>
            m.id === placeholderId ? { ...m, text: result.text, ts: Date.now() } : m
          ));
          pushActivity("ollamaChat finished");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Trim long Python tracebacks etc — first line is usually the real error,
        // the rest is stack frames. Activity log keeps the full text.
        const firstLine = msg.split("\n").find((l) => l.trim().length > 0) || msg;
        const display = firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
        setMessages((prev) => prev.map((m) =>
          m.id === placeholderId ? { ...m, text: `error: ${display}`, ts: Date.now() } : m
        ));
        pushActivity(`ollamaChat error: ${msg.slice(0, 500)}`);
      } finally {
        setIsBusy(false);
        cancelledRef.current = false;
      }
    }
  }, [runDispatch, messages, pushTerminal, pushActivity]);

  const meshConnected = status !== null && error === null;
  return (
    <div
      className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        for (const f of files) handleUpload(f);
      }}
    >
      <div className="h-10 bg-zinc-950 border-b border-zinc-800 flex items-center px-4 shrink-0">
        <div className="font-mono text-sm font-bold text-emerald-400 tracking-[0.2em]">XOVA</div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${meshConnected ? "bg-emerald-400" : "bg-red-500"}`} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              {meshConnected ? "● ONLINE" : error ? "● ERROR" : "● CONNECTING"}
            </span>
          </div>
          <button
            onClick={() => setPanelOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            title="Control panel"
          >
            <SquaresFour size={16} />
          </button>
        </div>
      </div>
      <StatusBar isBusy={isBusy} jarvisSpoke={Date.now() - jarvisSpokeAt < 8000} />
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-emerald-900/30 border-4 border-dashed border-emerald-500 flex items-center justify-center pointer-events-none">
          <div className="text-2xl font-mono text-emerald-300">drop file to upload</div>
        </div>
      )}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-1 border-b border-zinc-900 bg-zinc-950 flex items-center gap-1 text-[10px] font-mono overflow-x-auto shrink-0">
            <span className="text-zinc-600 uppercase tracking-wider mr-1">sessions:</span>
            {currentSession ? (
              <span className="px-2 py-0.5 rounded bg-emerald-900/30 border border-emerald-700 text-emerald-300 shrink-0">{currentSession}</span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 italic shrink-0">(unsaved)</span>
            )}
            {sessionList.filter((s) => s !== currentSession).slice(-12).map((s) => (
              <button
                key={s}
                onClick={() => onSend(`/load-session ${s}`)}
                className="px-2 py-0.5 rounded border border-zinc-800 hover:border-emerald-600 text-zinc-400 hover:text-emerald-400 shrink-0"
                title={`load session ${s}`}
              >
                {s}
              </button>
            ))}
            <button
              onClick={() => {
                const name = window.prompt("save current session as:");
                if (name && name.trim()) onSend(`/save-session ${name.trim()}`);
              }}
              className="ml-1 px-2 py-0.5 rounded border border-zinc-800 hover:border-emerald-600 text-zinc-500 shrink-0"
              title="save as"
            >+save</button>
            <button
              onClick={() => onSend("/new-session")}
              className="px-2 py-0.5 rounded border border-zinc-800 hover:border-amber-600 text-zinc-500 shrink-0"
              title="archive current and start fresh"
            >↻new</button>
          </div>
          <ChatFeed
            messages={messages}
            activity={activity}
            onTogglePin={(id) => setMessages((prev) => prev.map((m) => m.id === id ? { ...m, pinned: !m.pinned } : m))}
            onDelete={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
            onEdit={(t) => window.dispatchEvent(new CustomEvent("xova-prefill", { detail: { text: t } }))}
            onSuggest={(p) => onSend(p)}
          />
      <div className="px-6 py-1 shrink-0 border-t border-zinc-900 bg-zinc-950 flex items-center gap-2 text-[10px] font-mono overflow-x-auto">
        <button
          onClick={() => setPaletteOpen(true)}
          title="Open command palette (Ctrl+K) — every feature, one search box"
          className="h-7 px-2 rounded border border-emerald-800 bg-emerald-950/40 text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 shrink-0 flex items-center gap-1"
        >
          <span>⌘</span><span>command</span><kbd className="ml-1 text-[9px] text-emerald-600">Ctrl+K</kbd>
        </button>
        <span className="text-zinc-700">|</span>
        <span className="text-zinc-600 uppercase tracking-wider mr-1">quick:</span>
        <label
          title="Upload a file (image / PDF / docx / code) — paste or drop also work"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400 cursor-pointer flex items-center"
        >
          📎 upload
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              for (const f of files) handleUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        {/* Camera/Feed/Phones/Memory now live in the WorkspaceDock on the right */}
        <button
          onClick={() => onSend("take a screenshot and tell me what you see")}
          disabled={isBusy}
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-50"
        >
          🖼 screen
        </button>
        <button
          onClick={() => onSend("jarvis what time is it")}
          disabled={isBusy}
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-50"
        >
          🎙 jarvis time
        </button>
        <button
          onClick={() => onSend("jarvis weather")}
          disabled={isBusy}
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-50"
        >
          🌤 jarvis weather
        </button>
        <button
          onClick={() => runDispatch("math", { n: 10 })}
          disabled={isBusy || busyTask !== null}
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400 disabled:opacity-50"
        >
          ƒ math
        </button>
        {/* phones + memory live in the WorkspaceDock */}
        <button
          onClick={async () => {
            try {
              await invoke("xova_run", { command: "start ms-settings:mobile-devices", cwd: null, elevated: false });
              pushActivity("opened Settings → Mobile devices (pair S23/S26 here)");
            } catch {}
          }}
          title="Pair / unpair Samsung phones — and toggle 'Use as camera' so each phone shows in the Camera dropdown"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
        >
          🔗 pair
        </button>
        <button
          onClick={async () => {
            try {
              await invoke("xova_run", { command: "start ms-settings:windowsupdate", cwd: null, elevated: false });
              pushActivity("opened Settings");
            } catch {}
          }}
          title="Open Windows Settings (Update / system)"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
        >
          🪟 windows
        </button>
        <button
          onClick={() => {
            if (!window.confirm("Clear chat history? This wipes saved messages and starts fresh.")) return;
            setMessages([]);
            setLog([]);
            setCoherenceHistory([]);
            pushActivity("chat cleared");
          }}
          title="Clear chat history (saved messages, dispatch log, coherence history)"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-red-600 hover:text-red-400"
        >
          🧹 clear
        </button>
        <button
          onClick={async () => {
            try {
              const raw = await invoke<string>("xova_backup");
              const r = JSON.parse(raw);
              pushActivity(`backup → ${r.destination}`);
              await invoke("xova_notify", { title: "Xova backup complete", message: r.destination });
            } catch (e) {
              pushActivity(`backup failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
          title="Snapshot C:\\Xova\\memory + plugins + Codex to D:\\Xova\\backups\\<timestamp>"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
        >
          💾 backup
        </button>
        <button
          onClick={async () => {
            if (!window.confirm("Record 30 seconds of YOUR voice in a quiet room?\nMake sure no other audio is playing — this freezes Jarvis's speaker-recognition profile.\n\nClick OK to start recording immediately.")) return;
            pushActivity("voice enrollment recording 30s — speak normally now");
            try {
              const raw = await invoke<string>("xova_enroll_voice", { seconds: 30 });
              const r = JSON.parse(raw);
              if (r.ok) {
                pushActivity(`✓ ${r.message}`);
                await invoke("xova_notify", { title: "Voice enrolled", message: r.message });
              } else {
                pushActivity(`✗ ${r.message}`);
              }
            } catch (e) {
              pushActivity(`enroll error: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
          title="Record 30s of your voice → freeze a clean Jarvis speaker-recognition profile. Run in a quiet room."
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
        >
          🎓 enroll
        </button>
        <button
          onClick={async () => {
            try {
              // Dump recent chat to a context file so a fresh Claude session can resume.
              const contextMd = [
                `# Xova session context — ${new Date().toISOString()}`,
                ``,
                `Adam wants to keep building Xova/Jarvis. Use this file to resume.`,
                ``,
                `## Recent chat (last 60 messages)`,
                ``,
                ...messages.slice(-60).map((m) => {
                  const speaker = m.id.startsWith("voice-user-") ? "🎙 you"
                    : m.role === "user" ? "you"
                    : m.id.startsWith("voice-") ? "🎙 jarvis" : "xova";
                  return `**${speaker}** · ${new Date(m.ts).toLocaleString()}\n\n${m.text}\n`;
                }),
              ].join("\n");
              await invoke("xova_write_file", {
                path: "C:\\Xova\\memory\\last_context.md",
                content: contextMd,
              });
              // Launch admin terminal at C:\Xova\app and start `claude` with the context file.
              await invoke("xova_run", {
                command: "cmd.exe /K \"cd /d C:\\Xova\\app && type C:\\Xova\\memory\\last_context.md && echo. && echo === Run: claude && claude\"",
                cwd: null,
                elevated: true,
              });
              pushActivity("opened build-mode admin terminal with context");
            } catch (e) {
              pushActivity(`build mode failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
          title="Dump recent chat to last_context.md and open admin terminal at C:\\Xova\\app — run `claude` to resume building with context"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
        >
          🤖 build mode
        </button>
        <button onClick={() => onSend("/save")} title="Append last reply to snippets.md"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">💾 save reply</button>
        <button onClick={() => onSend("/snippets")} title="Show saved snippets"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">📋 snippets</button>
        <button onClick={() => onSend("/notes")} title="Show notes"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">📝 notes</button>
        <button onClick={() => onSend("/pinned")} title="Show pinned replies"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-amber-500 hover:text-amber-400">📌 pinned</button>
        <button onClick={() => onSend("/region")} title="Snip a region; Ctrl+V here to send"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">✂ snip</button>
        <button onClick={() => onSend("/redo")} title="Re-send last user message"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">↻ redo</button>
        <button onClick={() => onSend("/summarize")} title="Ollama summary of last 30 messages"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">📋 summarize</button>
        <button onClick={() => onSend("/export")} title="Save chat to markdown"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">📤 export</button>
        <button onClick={() => onSend("/cmd")} title="Open shell at C:\\Xova\\app"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">⌨ shell</button>
        <button onClick={() => setSettingsOpen(true)} title="Ollama model + context window"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400">⚙ settings</button>
        <button
          onClick={async () => {
            try { await invoke("xova_run", { command: "explorer C:\\Xova\\memory", cwd: null, elevated: false }); }
            catch (e) { pushActivity(`open memory failed: ${e}`); }
          }}
          title="Open C:\\Xova\\memory in File Explorer (snippets, notes, sessions, voice profile)"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
        >📁 memory</button>
        <button
          onClick={async () => {
            if (jarvisRunning) {
              try {
                // Target only Jarvis's pythonw, not every Python process on the system.
                // Filter by executable path under C:\jarvis\.venv.
                await invoke("xova_run", {
                  command: "powershell -NoProfile -Command \"Get-Process pythonw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\\jarvis\\*' } | Stop-Process -Force\"",
                  cwd: null, elevated: false,
                });
                pushActivity("muted jarvis (daemon killed)");
                setJarvisRunning(false);
              } catch (e) { pushActivity(`mute failed: ${e}`); }
            } else {
              try {
                // Start with PYTHONPATH set in the child process; -PassThru makes the
                // call return immediately so Xova doesn't block on the daemon lifetime.
                await invoke("xova_run", {
                  command: "powershell -NoProfile -Command \"$env:PYTHONPATH='C:\\jarvis\\src'; Start-Process 'C:\\jarvis\\.venv\\Scripts\\pythonw.exe' -ArgumentList '-m','jarvis.daemon' -WorkingDirectory 'C:\\jarvis' -WindowStyle Hidden\"",
                  cwd: null, elevated: false,
                });
                pushActivity("waking jarvis (daemon starting)");
                setJarvisRunning(true);
              } catch (e) { pushActivity(`wake failed: ${e}`); }
            }
          }}
          title={jarvisRunning ? "Kill jarvis daemon — stops voice listening + replies" : "Restart jarvis daemon"}
          className={`h-7 px-2 rounded border bg-zinc-900 ${jarvisRunning ? "border-zinc-800 text-zinc-400 hover:border-rose-500 hover:text-rose-400" : "border-rose-800 text-rose-400 hover:border-emerald-600 hover:text-emerald-400"}`}
        >{jarvisRunning ? "🔇 mute jarvis" : "🎙 wake jarvis"}</button>
        <button
          onClick={async () => {
            const text = window.prompt("Send to phone (PC clipboard → Phone Link sync):");
            if (!text || !text.trim()) return;
            try {
              const r = await invoke<string>("xova_send_to_phone", { text: text.trim() });
              pushActivity(`→ phone: ${text.slice(0, 60)}`);
              await invoke("xova_notify", { title: "Sent to phone clipboard", message: text.slice(0, 80) });
            } catch (e) {
              pushActivity(`send failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
          title="Copy text to PC clipboard — Phone Link clipboard sync forwards it to your phone"
          className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400"
        >
          📤 to phone
        </button>
      </div>
      {Object.keys(templateMap).length > 0 && (
        <div className="px-6 py-1 shrink-0 border-t border-zinc-900 bg-zinc-950 flex items-center gap-1 text-[10px] font-mono overflow-x-auto">
          <span className="text-zinc-600 uppercase tracking-wider mr-1">templates:</span>
          {Object.entries(templateMap).map(([name, body]) => (
            <button
              key={name}
              onClick={() => onSend(body)}
              title={body.slice(0, 200)}
              className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-600 hover:text-emerald-400 shrink-0"
            >
              ▸ {name}
            </button>
          ))}
        </div>
      )}
      <CommandBar onSend={onSend} isBusy={isBusy} onStop={onStop} />
        </div>
        <WorkspaceDock activeTab={dockTab} onTab={setDockTab} />
      </div>
      <ControlPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        status={status}
        onDispatch={runDispatch}
        busyTask={busyTask}
        terminal={terminal}
        pushTerminal={pushTerminal}
        log={log}
        coherenceHistory={coherenceHistory}
        activity={activity}
        pushActivity={pushActivity}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={[
          // Workspace
          { id: "p-cam", group: "Workspace", label: "📷 Camera",  hint: "toggle camera tile", run: () => setDockTab(dockTab === "camera" ? null : "camera") },
          { id: "p-fed", group: "Workspace", label: "🔒 Feed",    hint: "toggle feed grid",   run: () => setDockTab(dockTab === "feed" ? null : "feed") },
          { id: "p-phn", group: "Workspace", label: "📱 Phones",  hint: "toggle phone picker",run: () => setDockTab(dockTab === "phones" ? null : "phones") },
          { id: "p-mem", group: "Workspace", label: "🧠 Memory",  hint: "toggle memory viewer",run: () => setDockTab(dockTab === "memory" ? null : "memory") },
          // Vision
          { id: "p-snap",   group: "Vision", label: "🖥 Screenshot + describe", hint: "/screen", run: () => onSend("/screen") },
          { id: "p-region", group: "Vision", label: "✂ Snip region",            hint: "/region — Ctrl+V to send", run: () => onSend("/region") },
          // Snippets / notes / pins
          { id: "p-save",       group: "Capture", label: "💾 Save last reply to snippets.md", hint: "/save", run: () => onSend("/save") },
          { id: "p-snippets",   group: "Capture", label: "📋 Show snippets",     hint: "/snippets", run: () => onSend("/snippets") },
          { id: "p-note",       group: "Capture", label: "📝 Add a note",         hint: "/note <text>", run: () => window.dispatchEvent(new CustomEvent("xova-prefill", { detail: { text: "/note " } })) },
          { id: "p-notes",      group: "Capture", label: "📝 Show notes",        hint: "/notes", run: () => onSend("/notes") },
          { id: "p-pin",        group: "Capture", label: "📌 Pin last reply",    hint: "/pin", run: () => onSend("/pin") },
          { id: "p-pinned",     group: "Capture", label: "📌 Show pinned",       hint: "/pinned", run: () => onSend("/pinned") },
          // Sessions
          { id: "p-sess-list",  group: "Sessions", label: "🗂 List sessions",     hint: "/sessions", run: () => onSend("/sessions") },
          { id: "p-sess-new",   group: "Sessions", label: "↻ New session",        hint: "archive current and start fresh", run: () => onSend("/new-session") },
          { id: "p-sess-save",  group: "Sessions", label: "+ Save current as…",   hint: "name a snapshot", run: () => {
            const n = window.prompt("save current session as:");
            if (n && n.trim()) onSend(`/save-session ${n.trim()}`);
          }},
          // Templates
          { id: "p-tpls",       group: "Templates", label: "▸ List templates", hint: "/templates", run: () => onSend("/templates") },
          { id: "p-tpl-save",   group: "Templates", label: "+ Save template", hint: "/template-save <name> <body>", run: () => window.dispatchEvent(new CustomEvent("xova-prefill", { detail: { text: "/template-save " } })) },
          // Search & status
          { id: "p-find",  group: "Search", label: "🔍 Find in chat", hint: "/find <query>", run: () => window.dispatchEvent(new CustomEvent("xova-prefill", { detail: { text: "/find " } })) },
          { id: "p-stats", group: "Search", label: "📊 Chat stats",   hint: "/stats", run: () => onSend("/stats") },
          { id: "p-who",   group: "Search", label: "👤 Who's online", hint: "/who", run: () => onSend("/who") },
          { id: "p-redo",  group: "Search", label: "↻ Redo last message", hint: "/redo", run: () => onSend("/redo") },
          { id: "p-summ",  group: "Search", label: "📋 Summarise last 30 msgs", hint: "/summarize", run: () => onSend("/summarize") },
          // System
          { id: "p-clear",    group: "System", label: "🧹 Clear chat",         hint: "/clear", run: () => onSend("/clear") },
          { id: "p-export",   group: "System", label: "📤 Export chat to .md", hint: "/export", run: () => onSend("/export") },
          { id: "p-backup",   group: "System", label: "💾 Backup memory",      hint: "/backup", run: () => onSend("/backup") },
          { id: "p-enroll",   group: "System", label: "🎓 Enroll your voice",  hint: "30s recording", run: () => onSend("/enroll") },
          { id: "p-cmd",      group: "System", label: "⌨ Open shell at C:\\Xova\\app", hint: "/cmd", run: () => onSend("/cmd") },
          { id: "p-mem-dir",  group: "System", label: "📁 Open memory folder", hint: "C:\\Xova\\memory", run: async () => {
            try { await invoke("xova_run", { command: "explorer C:\\Xova\\memory", cwd: null, elevated: false }); } catch {}
          }},
          { id: "p-build",    group: "System", label: "🤖 Build mode (admin terminal)", hint: "dump context + open claude", run: async () => {
            const contextMd = [
              `# Xova session context — ${new Date().toISOString()}`, ``,
              `Adam wants to keep building Xova/Jarvis.`, ``, `## Recent chat (last 60)`, ``,
              ...messages.slice(-60).map((m) => {
                const speaker = m.id.startsWith("voice-user-") ? "🎙 you" : m.role === "user" ? "you" : m.id.startsWith("voice-") ? "🎙 jarvis" : "xova";
                return `**${speaker}** · ${new Date(m.ts).toLocaleString()}\n\n${m.text}\n`;
              }),
            ].join("\n");
            await invoke("xova_write_file", { path: "C:\\Xova\\memory\\last_context.md", content: contextMd });
            await invoke("xova_run", {
              command: "cmd.exe /K \"cd /d C:\\Xova\\app && type C:\\Xova\\memory\\last_context.md && echo. && echo === Run: claude && claude\"",
              cwd: null, elevated: true,
            });
            pushActivity("opened build-mode admin terminal");
          }},
          { id: "p-settings", group: "System", label: "⚙ Settings (Ollama model, ctx)", run: () => setSettingsOpen(true) },
          { id: "p-mute",     group: "System", label: jarvisRunning ? "🔇 Mute Jarvis (kill daemon)" : "🎙 Wake Jarvis (start daemon)", run: async () => {
            if (jarvisRunning) {
              try { await invoke("xova_run", { command: "powershell -NoProfile -Command \"Get-Process pythonw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\\jarvis\\*' } | Stop-Process -Force\"", cwd: null, elevated: false }); pushActivity("muted jarvis"); setJarvisRunning(false); } catch {}
            } else {
              try { await invoke("xova_run", { command: "powershell -NoProfile -Command \"$env:PYTHONPATH='C:\\jarvis\\src'; Start-Process 'C:\\jarvis\\.venv\\Scripts\\pythonw.exe' -ArgumentList '-m','jarvis.daemon' -WorkingDirectory 'C:\\jarvis' -WindowStyle Hidden\"", cwd: null, elevated: false }); pushActivity("waking jarvis"); setJarvisRunning(true); } catch {}
            }
          } },
          // Help
          { id: "p-help", group: "Help", label: "❔ Show all slash commands", hint: "/help", run: () => onSend("/help") },
          { id: "p-version", group: "Help", label: "ℹ Version", hint: "/version", run: () => onSend("/version") },
          { id: "p-uptime", group: "Help", label: "⏱ Uptime",    hint: "/uptime", run: () => onSend("/uptime") },
        ] satisfies PaletteItem[]}
      />
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl font-mono"
          >
            <div className="px-4 py-3 border-b border-zinc-900 flex items-center">
              <span className="text-emerald-400 text-sm uppercase tracking-wider">⚙ Ollama settings</span>
              <button onClick={() => setSettingsOpen(false)} className="ml-auto text-zinc-500 hover:text-rose-400">×</button>
            </div>
            <div className="p-4 space-y-4 text-xs">
              <label className="block">
                <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Model</span>
                <input
                  value={ollamaSettings.model}
                  onChange={(e) => setOllamaSettings({ ...ollamaSettings, model: e.target.value })}
                  placeholder="llama3.2:3b"
                  className="mt-1 w-full h-9 px-3 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
                <span className="block mt-1 text-zinc-600 text-[10px]">e.g. llama3.2:3b, qwen3:8b, qwen3:14b. Must be pulled in Ollama already.</span>
              </label>
              <label className="block">
                <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Context window (num_ctx)</span>
                <input
                  type="number"
                  min={512} step={512}
                  value={ollamaSettings.numCtx}
                  onChange={(e) => setOllamaSettings({ ...ollamaSettings, numCtx: parseInt(e.target.value, 10) || DEFAULT_SETTINGS.numCtx })}
                  className="mt-1 w-full h-9 px-3 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
                <span className="block mt-1 text-zinc-600 text-[10px]">More = remembers more conversation, but uses more VRAM. 4096 is a sane default for 4GB cards.</span>
              </label>
              <label className="flex items-center gap-2 pt-2 border-t border-zinc-900 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={banterEnabled}
                  onChange={async (e) => {
                    const v = e.target.checked;
                    setBanterEnabled(v);
                    try { await saveMemory("banter_enabled", v); } catch {}
                    pushActivity(`idle banter ${v ? "on" : "off"}`);
                  }}
                  className="accent-emerald-500"
                />
                <span>Idle banter — Xova/Jarvis make a short remark after 5 min of quiet</span>
              </label>
              <div className="flex items-center gap-2 pt-2 border-t border-zinc-900">
                <button
                  onClick={async () => {
                    try {
                      await saveOllamaSettings(ollamaSettings);
                      pushActivity(`saved ollama settings: model=${ollamaSettings.model} num_ctx=${ollamaSettings.numCtx}`);
                      setSettingsOpen(false);
                    } catch (e) { pushActivity(`save failed: ${e}`); }
                  }}
                  className="h-8 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded"
                >save</button>
                <button
                  onClick={() => setOllamaSettings(DEFAULT_SETTINGS)}
                  className="h-8 px-3 border border-zinc-800 text-zinc-400 hover:border-zinc-600 rounded"
                >reset to defaults</button>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="ml-auto h-8 px-3 border border-zinc-800 text-zinc-500 hover:text-zinc-300 rounded"
                >cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
