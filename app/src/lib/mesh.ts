import { invoke } from "@tauri-apps/api/core";

export type TaskType =
  | "math" | "phase" | "ci_health" | "coherence" | "constraint"
  | "coordination" | "documentation" | "field" | "memory"
  | "observation" | "sync" | "ternary" | "testing"
  | "evolve" | "swarm" | "select" | "score" | "bridge"
  | "detect" | "self_model" | "validate" | "build_tool";

export const TASK_TYPES: TaskType[] = [
  "math", "phase", "ci_health", "coherence", "constraint",
  "coordination", "documentation", "field", "memory",
  "observation", "sync", "ternary", "testing",
  "evolve", "swarm", "select", "score", "bridge",
  "detect", "self_model", "validate", "build_tool",
];

export interface MeshStatus {
  global_coherence: number;
  agent_count: number;
  repo_count: number;
  agents: Array<{ id: string; repo: string; role: string; coherence: number }>;
  raw: string;
}

export async function dispatchMesh(taskType: TaskType, args: Record<string, unknown> = {}): Promise<unknown> {
  const argsJson = JSON.stringify(args);
  const raw = await invoke<string>("dispatch_mesh", { taskType, args: argsJson });
  try { return JSON.parse(raw); } catch { return { raw }; }
}

export interface CascadeResult {
  task_type: string;
  fanout_count: number;
  results: Array<{
    repo: string;
    coherence: number;
    status: "ok" | "error" | "skipped";
    result?: unknown;
    error?: string;
    reason?: string;
  }>;
  aggregate: { ok: number; errors: number; skipped: number };
}

export async function cascadeMesh(taskType: TaskType, args: Record<string, unknown> = {}): Promise<CascadeResult> {
  const argsJson = JSON.stringify(args);
  const raw = await invoke<string>("cascade_mesh", { taskType, args: argsJson });
  return JSON.parse(raw) as CascadeResult;
}

export async function getMeshStatus(): Promise<MeshStatus> {
  const raw = await invoke<string>("mesh_status");
  try {
    const parsed = JSON.parse(raw);
    return {
      global_coherence: parsed.global_coherence ?? 0,
      agent_count: parsed.agents?.length ?? 0,
      repo_count: parsed.repos?.length ?? 0,
      agents: parsed.agents ?? [],
      raw,
    };
  } catch {
    return { global_coherence: 0, agent_count: 0, repo_count: 0, agents: [], raw };
  }
}

export async function saveMemory(key: string, value: unknown): Promise<void> {
  await invoke("save_memory", { key, value: JSON.stringify(value) });
}

export async function loadMemory<T = unknown>(key: string): Promise<T | null> {
  const raw = await invoke<string>("load_memory", { key });
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export type OllamaMessage = { role: string; content: string };
export type OllamaChatResult =
  | { type: "content"; text: string }
  | { type: "tool_calls"; calls: any[] };

export interface OllamaSettings {
  model: string;
  numCtx: number;
}

export const DEFAULT_SETTINGS: OllamaSettings = { model: "llama3.2:3b", numCtx: 4096 };

const SETTINGS_KEY = "ollama_settings";

export async function loadOllamaSettings(): Promise<OllamaSettings> {
  const stored = await loadMemory<OllamaSettings>(SETTINGS_KEY);
  if (stored && typeof stored.model === "string" && typeof stored.numCtx === "number") {
    return stored;
  }
  return DEFAULT_SETTINGS;
}

export async function saveOllamaSettings(s: OllamaSettings): Promise<void> {
  await saveMemory(SETTINGS_KEY, s);
}

/**
 * Wrap a Tauri invoke with a wall-clock timeout. The underlying Rust call
 * keeps running but the Promise rejects so the UI doesn't hang on "thinking…"
 * if Ollama gets stuck or the model spins forever on a confused prompt.
 */
async function invokeWithTimeout<T>(cmd: string, args: Record<string, unknown>, ms: number): Promise<T> {
  return await Promise.race([
    invoke<T>(cmd, args),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${Math.round(ms / 1000)}s — model is stuck or overloaded`)), ms)
    ),
  ]);
}

export async function ollamaChat(messages: OllamaMessage[], settings?: OllamaSettings): Promise<OllamaChatResult> {
  const s = settings ?? (await loadOllamaSettings());
  // 3 minutes — covers cold model load + slow CPU inference + tool prefill.
  // Beyond that the model is genuinely stuck and the user deserves an error.
  const raw = await invokeWithTimeout<string>("ollama_chat", {
    messages: JSON.stringify(messages),
    model: s.model,
    numCtx: s.numCtx,
  }, 180000);
  return JSON.parse(raw);
}

/**
 * Streaming variant. The backend emits `chat-token` events with tokens as they
 * arrive, and a final `chat-done` event with the full result. Caller passes
 * onToken callback to render incremental text into the placeholder.
 */
export async function ollamaChatStream(
  messages: OllamaMessage[],
  onToken: (token: string) => void,
  settings?: OllamaSettings,
): Promise<OllamaChatResult> {
  const { listen } = await import("@tauri-apps/api/event");
  const s = settings ?? (await loadOllamaSettings());
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const tokenUnlisten = await listen<{ request_id: string; token: string }>("chat-token", (event) => {
    if (event.payload.request_id === requestId) onToken(event.payload.token);
  });

  try {
    const raw = await invokeWithTimeout<string>("ollama_chat_stream", {
      requestId,
      messages: JSON.stringify(messages),
      model: s.model,
      numCtx: s.numCtx,
    }, 180000);
    return JSON.parse(raw);
  } finally {
    tokenUnlisten();
  }
}
