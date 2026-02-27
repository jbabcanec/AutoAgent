import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IPC_CHANNELS,
  type FollowUpAction,
  type RunLifecycleState,
  type RunStatusEvent,
  type StartRunInput
} from "../shared/ipc.js";
import { RunLifecycleMachine } from "./runLifecycle.js";
import { deleteApiKey, getApiKey, hasApiKey, storeApiKey } from "./keychain.js";
import { ANTHROPIC_TOOLS, OPENAI_TOOLS, executeToolAsync } from "./agentTools.js";
import { buildLiveContext } from "./liveContextEngine.js";
import { evaluateToolPolicy } from "./executionPolicy.js";
import { inspectCommand } from "./commandValidator.js";
import { evaluateEgressPolicy } from "./egressPolicy.js";
import { clearExecutionState, loadExecutionState, saveExecutionState, type PersistedExecutionState } from "./executionState.js";
import {
  classifyRetryError,
  guardCircuit,
  recordCircuitFailure,
  recordCircuitSuccess,
  retryPolicyFor,
  withRetry,
  type CircuitState
} from "./executionOrchestrator.js";
import { scoreExecution } from "./evalFeedback.js";
import { validateToolOutcome } from "./executionValidator.js";
import { collectMcpToolDefinitions, executeMcpTool, registerMcpAdapter, clearMcpAdapters, type RegisteredMcpAdapter } from "./mcpRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const CONTROL_PLANE_BASE = process.env.AUTOAGENT_API_URL ?? "http://localhost:8080";

let mainWindow: BrowserWindow | null = null;
const lifecycle = new RunLifecycleMachine();
const activeRunControllers = new Map<string, AbortController>();
const runInputs = new Map<string, StartRunInput>();
const providerCircuits = new Map<string, CircuitState>();
const baselineByRoutingMode = new Map<string, number>();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const loadTarget = isDev
    ? mainWindow.loadURL("http://localhost:5173")
    : mainWindow.loadFile(path.join(__dirname, "..", "..", "dist-renderer", "index.html"));

  void loadTarget.finally(() => {
    mainWindow?.show();
  });
}

async function requestJson(pathname: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${CONTROL_PLANE_BASE}${pathname}`, { signal: controller.signal, ...init });
    if (!response.ok) {
      throw new Error(`Request failed ${pathname}: ${response.status}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function emitRunStatus(
  runId: string,
  state: RunLifecycleState,
  message: string,
  opts?: Partial<
    Pick<
      RunStatusEvent,
      | "detail"
      | "type"
      | "turn"
      | "model"
      | "tokenUsage"
      | "duration"
      | "toolName"
      | "toolInput"
      | "planSteps"
      | "reflectionNotes"
      | "promptId"
      | "followUpActions"
    >
  >
): void {
  const event: RunStatusEvent = {
    runId,
    state,
    message,
    timestamp: new Date().toISOString()
  };
  if (opts) {
    if (opts.detail !== undefined) event.detail = opts.detail;
    if (opts.type !== undefined) event.type = opts.type;
    if (opts.turn !== undefined) event.turn = opts.turn;
    if (opts.model !== undefined) event.model = opts.model;
    if (opts.tokenUsage !== undefined) event.tokenUsage = opts.tokenUsage;
    if (opts.duration !== undefined) event.duration = opts.duration;
    if (opts.toolName !== undefined) event.toolName = opts.toolName;
    if (opts.toolInput !== undefined) event.toolInput = opts.toolInput;
    if (opts.planSteps !== undefined) event.planSteps = opts.planSteps;
    if (opts.reflectionNotes !== undefined) event.reflectionNotes = opts.reflectionNotes;
    if (opts.promptId !== undefined) event.promptId = opts.promptId;
    if (opts.followUpActions !== undefined) event.followUpActions = opts.followUpActions;
  }
  mainWindow?.webContents.send(IPC_CHANNELS.runStatus, event);
}

async function requestExecutionApproval(directory: string): Promise<boolean> {
  if (!mainWindow) return false;
  const response = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Guarded Execution Approval",
    message: "Approve high-risk execution?",
    detail: `Directory: ${directory}\nAction: analyze repository and prepare changes`,
    buttons: ["Approve", "Reject"],
    defaultId: 0,
    cancelId: 1
  });
  return response.response === 0;
}

async function requestToolApproval(
  runId: string,
  toolName: string,
  reason: string,
  input: Record<string, unknown>,
  contextHash: string,
  expiresAt: string
): Promise<boolean> {
  const approval = (await requestJson("/api/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId,
      reason,
      scope: "tool",
      toolName,
      toolInput: input,
      contextHash,
      expiresAt
    })
  })) as { id: string };
  if (!mainWindow) return false;
  const response = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Tool Approval Required",
    message: `Approve tool execution: ${toolName}?`,
    detail: `${reason}\n\nInput: ${JSON.stringify(input).slice(0, 500)}`,
    buttons: ["Approve", "Reject"],
    defaultId: 0,
    cancelId: 1
  });
  const approved = response.response === 0;
  await requestJson(`/api/approvals/${encodeURIComponent(approval.id)}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approved, expectedContextHash: contextHash })
  });
  return approved;
}

function getCircuit(providerId: string): CircuitState {
  const existing = providerCircuits.get(providerId);
  if (existing) return existing;
  const created: CircuitState = { failures: 0, openUntilMs: 0 };
  providerCircuits.set(providerId, created);
  return created;
}

ipcMain.handle(IPC_CHANNELS.fetchDashboard, async () => requestJson("/api/dashboard/stats"));
ipcMain.handle(IPC_CHANNELS.fetchRuns, async () => requestJson("/api/runs"));
ipcMain.handle(IPC_CHANNELS.fetchApprovals, async () => requestJson("/api/approvals"));
ipcMain.handle(IPC_CHANNELS.fetchProviders, async () => requestJson("/api/providers"));
ipcMain.handle(IPC_CHANNELS.fetchProvider, async (_event, providerId: string) =>
  requestJson(`/api/providers/${encodeURIComponent(providerId)}`)
);
ipcMain.handle(IPC_CHANNELS.createProvider, async (_event, input: unknown) =>
  requestJson("/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  })
);
ipcMain.handle(IPC_CHANNELS.updateProvider, async (_event, input: { id: string; updates: Record<string, unknown> }) =>
  requestJson(`/api/providers/${encodeURIComponent(input.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.updates)
  })
);
ipcMain.handle(IPC_CHANNELS.fetchSettings, async () => requestJson("/api/settings"));
ipcMain.handle(IPC_CHANNELS.updateSettings, async (_event, input: unknown) =>
  requestJson("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  })
);
ipcMain.handle(IPC_CHANNELS.fetchTraces, async (_event, runId: string) =>
  requestJson(`/api/traces/${encodeURIComponent(runId)}`)
);
ipcMain.handle(IPC_CHANNELS.fetchRunMetrics, async (_event, runId: string) =>
  requestJson(`/api/traces/${encodeURIComponent(runId)}/metrics`)
);
ipcMain.handle(IPC_CHANNELS.deleteRun, async (_event, runId: string) =>
  requestJson(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" })
);
ipcMain.handle(IPC_CHANNELS.approvalResolve, async (_event, input: { approvalId: string; approved: boolean }) =>
  requestJson(`/api/approvals/${encodeURIComponent(input.approvalId)}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approved: input.approved })
  })
);
ipcMain.handle(IPC_CHANNELS.keychainStoreApiKey, async (_event, input: { providerId: string; apiKey: string }) =>
  storeApiKey(input.providerId, input.apiKey)
);
ipcMain.handle(IPC_CHANNELS.keychainDeleteApiKey, async (_event, input: { providerId: string }) =>
  deleteApiKey(input.providerId)
);
ipcMain.handle(IPC_CHANNELS.keychainGetApiKeyStatus, async (_event, input: { providerId: string }) => ({
  stored: hasApiKey(input.providerId)
}));

ipcMain.handle(IPC_CHANNELS.dialogSelectDirectory, async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Project Folder"
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle(IPC_CHANNELS.fsReadDirectory, async (_event, dirPath: string) => {
  const resolved = path.resolve(dirPath);
  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
        isDirectory: e.isDirectory()
      }));
  } catch {
    return [];
  }
});

ipcMain.handle(IPC_CHANNELS.fsReadFile, async (_event, filePath: string) => {
  const resolved = path.resolve(filePath);
  const MAX_SIZE = 256 * 1024;
  try {
    const stat = statSync(resolved);
    const truncated = stat.size > MAX_SIZE;
    const content = readFileSync(resolved, "utf8").slice(0, MAX_SIZE);
    return { content, truncated };
  } catch {
    return { content: "Unable to read file.", truncated: false };
  }
});

// --- Agentic Types ---

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // Anthropic tool_result fields
  tool_use_id?: string;
  content?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

interface OpenAiToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | AnthropicContentBlock[] }
  | { role: "assistant"; content: string | AnthropicContentBlock[] | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

const MAX_AGENT_TURNS = 25;
const PROMPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// --- Normalized Provider Layer ---

interface NormalizedTurn {
  textContent: string | null;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  rawAssistantMessage: AgentMessage;
  inputTokens: number;
  outputTokens: number;
}

// --- Smart Tool Result Truncation ---

function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = Math.floor(maxChars * 0.2);
  const truncatedLines = text.slice(headSize, text.length - tailSize).split("\n").length;
  return `${text.slice(0, headSize)}\n\n... [${truncatedLines} lines truncated] ...\n\n${text.slice(text.length - tailSize)}`;
}

// --- Token-Aware Context Compression ---

function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block !== null) {
          chars += JSON.stringify(block).length;
        }
      }
    }
    if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
      chars += JSON.stringify(msg.tool_calls).length;
    }
  }
  return Math.ceil(chars / 4);
}

// --- Repository Map ---

function extractSymbols(content: string): string[] {
  const symbols: string[] = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|interface|type|enum)\s+(\w+)/g,
    /^(?:function|class)\s+(\w+)/gm,
    /^def\s+(\w+)/gm,
    /^(?:pub\s+)?(?:fn|struct|enum|trait|impl)\s+(\w+)/gm,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) symbols.push(match[1]);
    }
  }
  return [...new Set(symbols)].slice(0, 10);
}

function buildRepoMap(projectDir: string, maxChars: number = 3000): string {
  const IGNORE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
    "__pycache__", ".cache", ".vscode", ".idea", "dist-main", "dist-renderer",
    ".pnpm", "target", "vendor", ".autoagent"
  ]);
  const SKIP_EXT = new Set([".lock", ".map", ".min.js", ".min.css", ".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".ttf", ".eot"]);

  const entries: Array<{ path: string; size: number; summary: string }> = [];

  function scan(dir: string): void {
    let dirEntries: string[];
    try { dirEntries = readdirSync(dir, { encoding: "utf8" }); } catch { return; }
    for (const name of dirEntries) {
      if (name.startsWith(".") && name !== ".env.example") continue;
      const full = path.join(dir, name);
      let st: ReturnType<typeof statSync>;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name)) continue;
        scan(full);
      } else {
        const ext = path.extname(name).toLowerCase();
        if (SKIP_EXT.has(ext)) continue;
        if (st.size > 500_000) continue; // Skip files > 500KB
        let summary = "";
        try {
          const head = readFileSync(full, "utf8").slice(0, 2000);
          const syms = extractSymbols(head);
          if (syms.length > 0) summary = syms.join(", ");
        } catch { /* skip binary/unreadable */ }
        entries.push({ path: path.relative(projectDir, full).replaceAll("\\", "/"), size: st.size, summary });
      }
    }
  }

  scan(projectDir);
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const lines: string[] = [];
  let chars = 0;
  for (const e of entries) {
    const sizeStr = e.size < 1024 ? `${e.size}B` : `${Math.round(e.size / 1024)}KB`;
    const line = e.summary ? `${e.path} (${sizeStr}) — ${e.summary}` : `${e.path} (${sizeStr})`;
    if (chars + line.length + 1 > maxChars) {
      lines.push(`... and ${entries.length - lines.length} more files`);
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  return lines.join("\n");
}

// --- Agentic LLM Callers ---

async function callAnthropicAgent(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: AgentMessage[],
  maxTokens: number,
  signal?: AbortSignal,
  cacheTraceRunId?: string
): Promise<AnthropicResponse> {
  const cacheKey = createPromptCacheKey("anthropic-compatible", model, system, messages, maxTokens);
  const cached = await readPromptCache(cacheKey);
  if (cached) {
    if (cacheTraceRunId) appendTrace(cacheTraceRunId, "execution.cache_hit", { key: cacheKey, provider: "anthropic" });
    return cached as AnthropicResponse;
  }
  if (cacheTraceRunId) appendTrace(cacheTraceRunId, "execution.cache_miss", { key: cacheKey, provider: "anthropic" });
  // Convert messages to Anthropic format (no system role in messages array)
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: anthropicMessages,
    tools: ANTHROPIC_TOOLS
  };
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${text}`);
  }
  const parsed = (await response.json()) as AnthropicResponse;
  await writePromptCache(cacheKey, parsed);
  return parsed;
}

async function callAnthropicAgentStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: AgentMessage[],
  maxTokens: number,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  tools?: unknown[]
): Promise<AnthropicResponse> {
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system,
    messages: anthropicMessages,
    tools: tools ?? ANTHROPIC_TOOLS,
    stream: true
  };
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${text}`);
  }

  const contentBlocks: AnthropicContentBlock[] = [];
  let stopReason = "";
  let inputTokens = 0;
  let outputTokens = 0;

  // Track content blocks being built
  const blockIndex = new Map<number, AnthropicContentBlock>();

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body for streaming");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("event: ")) {
        currentEventType = trimmed.slice(7).trim();
        continue;
      }
      if (!trimmed.startsWith("data: ")) continue;
      const jsonStr = trimmed.slice(6);
      if (jsonStr === "[DONE]") continue;

      let data: Record<string, unknown>;
      try { data = JSON.parse(jsonStr) as Record<string, unknown>; } catch { continue; }

      if (currentEventType === "message_start") {
        const msg = data.message as Record<string, unknown> | undefined;
        const usage = msg?.usage as { input_tokens?: number } | undefined;
        if (usage?.input_tokens) inputTokens = usage.input_tokens;
      } else if (currentEventType === "content_block_start") {
        const idx = data.index as number;
        const block = data.content_block as Record<string, unknown> | undefined;
        if (block) {
          const newBlock: AnthropicContentBlock = {
            type: String(block.type ?? "text"),
            ...(block.text !== undefined ? { text: String(block.text) } : {}),
            ...(block.id !== undefined ? { id: String(block.id) } : {}),
            ...(block.name !== undefined ? { name: String(block.name) } : {}),
            ...(block.input !== undefined ? { input: block.input as Record<string, unknown> } : {})
          };
          blockIndex.set(idx, newBlock);
        }
      } else if (currentEventType === "content_block_delta") {
        const idx = data.index as number;
        const delta = data.delta as Record<string, unknown> | undefined;
        const block = blockIndex.get(idx);
        if (delta && block) {
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            block.text = (block.text ?? "") + delta.text;
            onDelta(delta.text);
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            // Tool input arrives as incremental JSON fragments
            if (!block.input) block.input = {} as Record<string, unknown>;
            (block as { _partialJson?: string })._partialJson =
              ((block as { _partialJson?: string })._partialJson ?? "") + delta.partial_json;
          }
        }
      } else if (currentEventType === "content_block_stop") {
        const idx = data.index as number;
        const block = blockIndex.get(idx);
        if (block) {
          // Parse accumulated partial JSON for tool_use blocks
          if (block.type === "tool_use") {
            const partialJson = (block as { _partialJson?: string })._partialJson;
            if (partialJson) {
              try { block.input = JSON.parse(partialJson) as Record<string, unknown>; } catch { /* keep empty */ }
              delete (block as { _partialJson?: string })._partialJson;
            }
          }
          contentBlocks.push(block);
        }
      } else if (currentEventType === "message_delta") {
        const delta = data.delta as Record<string, unknown> | undefined;
        if (delta?.stop_reason) stopReason = String(delta.stop_reason);
        const usage = data.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens) outputTokens = usage.output_tokens;
      }
    }
  }

  return {
    content: contentBlocks,
    stop_reason: stopReason || "end_turn",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  };
}

async function callOpenAiAgent(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  maxTokens: number,
  signal?: AbortSignal,
  cacheTraceRunId?: string
): Promise<OpenAiResponse> {
  const cacheKey = createPromptCacheKey("openai-compatible", model, "", messages, maxTokens);
  const cached = await readPromptCache(cacheKey);
  if (cached) {
    if (cacheTraceRunId) appendTrace(cacheTraceRunId, "execution.cache_hit", { key: cacheKey, provider: "openai" });
    return cached as OpenAiResponse;
  }
  if (cacheTraceRunId) appendTrace(cacheTraceRunId, "execution.cache_miss", { key: cacheKey, provider: "openai" });
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
    tools: OPENAI_TOOLS
  };
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }
  const parsed = (await response.json()) as OpenAiResponse;
  await writePromptCache(cacheKey, parsed);
  return parsed;
}

async function callOpenAiAgentStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  maxTokens: number,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  tools?: unknown[]
): Promise<OpenAiResponse> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
    tools: tools ?? OPENAI_TOOLS,
    stream: true,
    stream_options: { include_usage: true }
  };
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: signal ?? null,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  let contentText = "";
  let finishReason = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  const toolCalls = new Map<number, OpenAiToolCall>();

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body for streaming");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const jsonStr = trimmed.slice(6);
      if (jsonStr === "[DONE]") continue;

      let data: Record<string, unknown>;
      try { data = JSON.parse(jsonStr) as Record<string, unknown>; } catch { continue; }

      // Extract usage from final chunk
      const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      if (usage) {
        if (usage.prompt_tokens) promptTokens = usage.prompt_tokens;
        if (usage.completion_tokens) completionTokens = usage.completion_tokens;
        if (usage.total_tokens) totalTokens = usage.total_tokens;
      }

      const choices = data.choices as Array<{
        delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
        finish_reason?: string;
      }> | undefined;
      const choice = choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (!delta) continue;

      // Text content
      if (delta.content) {
        contentText += delta.content;
        onDelta(delta.content);
      }

      // Tool calls — accumulated across chunks
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (!existing) {
            toolCalls.set(tc.index, {
              id: tc.id ?? "",
              type: "function",
              function: {
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? ""
              }
            });
          } else {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name = tc.function.name;
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
          }
        }
      }
    }
  }

  const assembledToolCalls = [...toolCalls.values()];
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: contentText || null,
          ...(assembledToolCalls.length > 0 ? { tool_calls: assembledToolCalls } : {})
        },
        finish_reason: finishReason || "stop"
      }
    ],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens }
  };
}

// --- Provider Normalization ---

async function callProviderStreaming(params: {
  providerKind: "anthropic-compatible" | "openai-compatible" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AgentMessage[];
  maxTokens: number;
  tools: { anthropic: unknown[]; openai: unknown[] };
  onDelta: (text: string) => void;
  signal: AbortSignal;
}): Promise<NormalizedTurn> {
  if (params.providerKind === "anthropic-compatible") {
    const resp = await callAnthropicAgentStreaming(
      params.baseUrl, params.apiKey, params.model,
      params.systemPrompt, params.messages, params.maxTokens,
      params.onDelta, params.signal, params.tools.anthropic as Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
    );
    const textParts: string[] = [];
    const toolCalls: NormalizedTurn["toolCalls"] = [];
    for (const block of resp.content ?? []) {
      if (block.type === "text" && block.text) textParts.push(block.text);
      if (block.type === "tool_use" && block.name && block.id) {
        toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    return {
      textContent: textParts.length > 0 ? textParts.join("") : null,
      toolCalls,
      rawAssistantMessage: { role: "assistant", content: resp.content ?? [] },
      inputTokens: resp.usage?.input_tokens ?? 0,
      outputTokens: resp.usage?.output_tokens ?? 0
    };
  }

  // OpenAI-compatible path
  const resp = await callOpenAiAgentStreaming(
    params.baseUrl, params.apiKey, params.model,
    params.messages, params.maxTokens,
    params.onDelta, params.signal, params.tools.openai
  );
  const choice = resp.choices?.[0];
  const msg = choice?.message;
  const toolCalls: NormalizedTurn["toolCalls"] = [];
  for (const tc of msg?.tool_calls ?? []) {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>; } catch { /* malformed */ }
    toolCalls.push({ id: tc.id, name: tc.function.name, input: parsed });
  }
  return {
    textContent: msg?.content ?? null,
    toolCalls,
    rawAssistantMessage: {
      role: "assistant",
      content: msg?.content ?? null,
      ...(toolCalls.length > 0 ? { tool_calls: msg?.tool_calls } : {})
    } as AgentMessage,
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0
  };
}

function normalizeCachedResponse(providerKind: string, cached: unknown): NormalizedTurn {
  if (providerKind === "anthropic-compatible") {
    const resp = cached as AnthropicResponse;
    const textParts: string[] = [];
    const toolCalls: NormalizedTurn["toolCalls"] = [];
    for (const block of resp.content ?? []) {
      if (block.type === "text" && block.text) textParts.push(block.text);
      if (block.type === "tool_use" && block.name && block.id) {
        toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    return {
      textContent: textParts.length > 0 ? textParts.join("") : null,
      toolCalls,
      rawAssistantMessage: { role: "assistant", content: resp.content ?? [] },
      inputTokens: resp.usage?.input_tokens ?? 0,
      outputTokens: resp.usage?.output_tokens ?? 0
    };
  }
  const resp = cached as OpenAiResponse;
  const choice = resp.choices?.[0];
  const msg = choice?.message;
  const toolCalls: NormalizedTurn["toolCalls"] = [];
  for (const tc of msg?.tool_calls ?? []) {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>; } catch { /* malformed */ }
    toolCalls.push({ id: tc.id, name: tc.function.name, input: parsed });
  }
  return {
    textContent: msg?.content ?? null,
    toolCalls,
    rawAssistantMessage: {
      role: "assistant",
      content: msg?.content ?? null,
      ...(toolCalls.length > 0 ? { tool_calls: msg?.tool_calls } : {})
    } as AgentMessage,
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0
  };
}

function buildToolResultMessages(
  providerKind: string,
  results: Array<{ id: string; content: string; isError: boolean }>
): AgentMessage[] {
  if (providerKind === "anthropic-compatible") {
    return [{
      role: "user",
      content: results.map(r => ({
        type: "tool_result" as const,
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {})
      }))
    }];
  }
  return results.map(r => ({
    role: "tool" as const,
    tool_call_id: r.id,
    content: r.content
  }));
}

// --- Parallel Tool Execution ---

const READ_ONLY_TOOLS = new Set(["read_file", "search_code", "glob_files", "list_directory"]);

interface ToolExecContext {
  projectDir: string;
  runId: string;
  turn: number;
  signal: AbortSignal;
  settingsData: Record<string, unknown>;
  projectConfig: ProjectAgentConfig | undefined;
  mcpToolMap: Map<string, { adapterId: string; toolName: string }>;
}

async function executeToolWithSafety(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<{ result: string; durationMs: number }> {
  const start = Date.now();

  // 1. Tool allowlist check
  if (Array.isArray(ctx.projectConfig?.toolAllowlist) && !ctx.projectConfig!.toolAllowlist!.includes(toolName)) {
    return { result: `Error: Tool "${toolName}" not in project allowlist`, durationMs: Date.now() - start };
  }

  // 2. Command inspection + egress (run_command only)
  if (toolName === "run_command") {
    const inspection = inspectCommand(String(toolInput.command ?? ""));
    appendTrace(ctx.runId, "execution.command_inspection", {
      turn: ctx.turn, command: inspection.normalizedCommand.slice(0, 300),
      risk: inspection.risk, warnings: inspection.warnings,
      violations: inspection.violations, externalHosts: inspection.externalHosts
    });
    if (inspection.violations.length > 0 || inspection.risk === "critical") {
      return { result: `Error: Blocked: ${inspection.violations.join("; ") || "critical risk"}`, durationMs: Date.now() - start };
    }
    const egress = evaluateEgressPolicy({
      hosts: inspection.externalHosts,
      mode: (ctx.settingsData.egressPolicyMode as "off" | "audit" | "enforce") ?? "audit",
      allowHosts: (ctx.settingsData.egressAllowHosts as string[]) ?? [],
      exceptionHosts: Array.isArray(toolInput.egressExceptionHosts)
        ? toolInput.egressExceptionHosts.filter((e): e is string => typeof e === "string")
        : []
    });
    appendTrace(ctx.runId, "execution.egress_decision", {
      turn: ctx.turn, tool: toolName, decision: egress.decision,
      blockedHosts: egress.blockedHosts, reason: egress.reason
    });
    if (egress.decision === "deny") {
      return { result: `Error: Blocked by egress policy: ${egress.reason}`, durationMs: Date.now() - start };
    }
    if (egress.decision === "needs_approval") {
      const contextHash = hashApprovalContext(ctx.runId, ctx.turn, toolName, toolInput);
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const approved = await requestToolApproval(ctx.runId, toolName, egress.reason, toolInput, contextHash, expiresAt);
      if (!approved) {
        return { result: `Error: Egress not approved for ${toolName}`, durationMs: Date.now() - start };
      }
    }
  }

  // 3. Generic tool policy
  const policy = evaluateToolPolicy({ toolName, input: toolInput });
  if (policy.decision === "deny") {
    return { result: `Error: Denied by policy: ${policy.reason}`, durationMs: Date.now() - start };
  }
  if (policy.decision === "needs_approval") {
    const contextHash = hashApprovalContext(ctx.runId, ctx.turn, toolName, toolInput);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const approved = await requestToolApproval(ctx.runId, toolName, policy.reason, toolInput, contextHash, expiresAt);
    if (!approved) {
      return { result: `Error: Tool rejected by operator: ${toolName}`, durationMs: Date.now() - start };
    }
  }

  // 4. Execute (MCP or built-in) with retry
  const mcpMapping = ctx.mcpToolMap.get(toolName);
  let result: string;
  try {
    result = await withRetry(
      () => mcpMapping
        ? executeMcpTool(mcpMapping.adapterId, mcpMapping.toolName, toolInput)
        : executeToolAsync(toolName, toolInput, ctx.projectDir, ctx.signal),
      retryPolicyFor("tool", "tool"),
      async (attempt, error) => {
        appendTrace(ctx.runId, "execution.retry", {
          attempt, stage: "tool", tool: toolName, error, errorClass: classifyRetryError(error)
        });
      }
    );
  } catch (err) {
    result = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }

  // 5. Validation + artifact
  const validation = validateToolOutcome({
    toolName: mcpMapping ? mcpMapping.toolName : toolName,
    toolInput, toolResult: result, projectDir: ctx.projectDir
  });
  await createVerificationArtifact({
    runId: ctx.runId,
    verificationType: validation.verificationType,
    artifactType: "tool_result",
    verificationResult: validation.ok ? "pass" : validation.severity === "warn" ? "warning" : "fail",
    artifactContent: result.slice(0, 4000),
    checks: validation.checks.map((check) => ({
      check, passed: validation.ok,
      severity: validation.severity === "error" ? "error" : validation.severity === "warn" ? "warn" : "info"
    }))
  });

  // 6. Hook
  await runHook(ctx.runId, "tool_result", {
    turn: ctx.turn, tool: toolName, ok: !result.startsWith("Error:")
  }, ctx.projectConfig?.hooks, ctx.projectDir);

  return { result, durationMs: Date.now() - start };
}

async function executeToolCallsBatch(
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  ctx: ToolExecContext
): Promise<Array<{ id: string; name: string; result: string; durationMs: number }>> {
  const readOnly = toolCalls.filter(tc => READ_ONLY_TOOLS.has(tc.name));
  const mutating = toolCalls.filter(tc => !READ_ONLY_TOOLS.has(tc.name));
  const results: Array<{ id: string; name: string; result: string; durationMs: number }> = [];

  // Read-only: run in parallel
  if (readOnly.length > 0) {
    const parallel = await Promise.all(
      readOnly.map(async tc => {
        const { result, durationMs } = await executeToolWithSafety(tc.name, tc.input, ctx);
        return { id: tc.id, name: tc.name, result, durationMs };
      })
    );
    results.push(...parallel);
  }

  // Mutating: run sequentially
  for (const tc of mutating) {
    const { result, durationMs } = await executeToolWithSafety(tc.name, tc.input, ctx);
    results.push({ id: tc.id, name: tc.name, result, durationMs });
  }

  return results;
}

// --- Core Agentic Execution ---

async function executeRun(
  input: StartRunInput,
  run: { runId: string; [key: string]: unknown },
  options?: { resumeFrom?: PersistedExecutionState }
): Promise<{ run: typeof run; execution: { status: "executed" | "blocked"; reason: string } }> {
  const controller = activeRunControllers.get(run.runId) ?? new AbortController();
  activeRunControllers.set(run.runId, controller);
  const resumeFrom = options?.resumeFrom;

  emitRunStatus(run.runId, lifecycle.transition("executing"), "Analyzing repository...", { type: "info" });
  await requestJson(`/api/runs/${encodeURIComponent(run.runId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "running" })
  });

  try {
    const projectConfig = loadProjectConfig(input.directory);
    appendTrace(run.runId, "execution.project_config", {
      hasConfig: projectConfig !== null,
      toolAllowlist: projectConfig?.toolAllowlist ?? null,
      contextBudgetTokens: projectConfig?.contextBudgetTokens ?? null
    });
    // 1. Build context with hybrid-style selection + telemetry
    const context = buildLiveContext({
      directory: input.directory,
      objective: input.objective,
      changedFiles: []
    });
    appendTrace(run.runId, "context.retrieval", {
      objective: input.objective,
      directory: input.directory,
      telemetry: context.retrievalTelemetry
    });
    emitRunStatus(run.runId, "executing", "Prepared context for execution.", { type: "info" });

    // 1b. Load MCP adapters from project config
    if (projectConfig?.mcpServers && projectConfig.mcpServers.length > 0) {
      await loadMcpAdaptersFromConfig(projectConfig.mcpServers, input.directory, run.runId);
      emitRunStatus(run.runId, "executing", `Loaded ${projectConfig.mcpServers.length} MCP adapter(s).`, { type: "info" });
    }
    const mcpDefs = await collectMcpToolDefinitions();
    const allAnthropicTools = [...ANTHROPIC_TOOLS, ...mcpDefs.anthropicTools];
    const allOpenaiTools = [...OPENAI_TOOLS, ...mcpDefs.openaiTools];

    // 2. Resolve provider + API key
    const provider = (await requestJson(`/api/providers/${encodeURIComponent(input.providerId)}`)) as {
      id: string;
      kind: "openai-compatible" | "anthropic-compatible" | "custom";
      baseUrl: string;
      defaultModel?: string;
    };
    const apiKey = getApiKey(provider.id);
    if (!apiKey) throw new Error("No API key stored for the active provider.");

    const settingsData = (await requestJson("/api/settings")) as {
      maxTokens?: number;
      routingMode?: "balanced" | "latency" | "quality" | "cost";
      egressPolicyMode?: "off" | "audit" | "enforce";
      egressAllowHosts?: string[];
      contextHistoryMaxMessages?: number;
      contextSummaryMaxChars?: number;
    };
    const maxTokens = projectConfig?.maxTokens ?? settingsData.maxTokens ?? 4096;
    const routingMode = settingsData.routingMode ?? "balanced";
    const modelName =
      projectConfig?.preferredModel ??
      (await selectModelByRouting(provider.defaultModel ?? "gpt-4o", routingMode, provider.id));
    const circuit = getCircuit(provider.id);
    const threadId = await ensureRunThread(run.runId, input.threadId);
    await saveExecutionState(requestJson, run.runId, {
      runId: run.runId,
      phase: "running",
      phaseMarker: "planning",
      turn: resumeFrom?.turn ?? 0,
      input,
      stats: resumeFrom?.stats ?? { actionCount: 0, totalInputTokens: 0, totalOutputTokens: 0, retries: 0 }
    });

    // 3. Build initial messages
    const systemPrompt = `You are AutoAgent, an autonomous AI coding agent. You build complete, production-quality software by writing code, creating files, and running commands.

EXECUTION FIRST: Call a tool on your very first response. Never produce planning prose before taking action — the plan lives in your actions. Use agent_notes only AFTER completing a significant step, never to plan what you will do next.

VERIFICATION: After writing a file, read it back to confirm contents. After running a command, interpret the actual exit code and stdout — never claim success without evidence. For GUI apps, verify via syntax-check (python -m py_compile, node --check) rather than claiming a window appeared.

## How You Work

You have tools to read, write, edit files, run commands, and search code. You decide what to do and when. There are no artificial phases — you plan, build, test, and iterate in whatever order makes sense.

**Your workflow for any task:**
1. Understand what's being asked. If the project directory has existing code, use search_code and glob_files to understand the codebase first.
2. Plan your approach internally. Use agent_notes to track your plan for complex tasks.
3. Build incrementally — create files, install dependencies, write code.
4. Test and verify — run the code, check for errors, fix issues.
5. Keep iterating until everything works. Don't stop at the first working version if there are obvious improvements.
6. When truly done, stop calling tools and write a concise summary.

## Quality Standards

Build complete, production-quality output: error handling, input validation, all expected features. Test your work by running it. Don't stop at the first working version.
${mcpDefs.toolMap.size > 0 ? `\nYou have ${mcpDefs.toolMap.size} MCP tool(s) available from external servers — use them when appropriate.\n` : ""}
## Tips
- Batch read-only calls (read_file, search_code, glob_files, list_directory) — they run in parallel
- Use search_code to find things instead of reading every file
- read_file before edit_file to get accurate line numbers; re-read if they shift after edits
- run_command has a 30s timeout — do NOT start long-running servers
- agent_notes survives context compression — use it for plan/progress on long tasks

## Environment
- Working directory: \`${input.directory}\`
- All file paths are relative to the working directory.
- Write files directly here — do NOT create subdirectories with arbitrary project names.`;

    // Build repo map for codebase awareness
    const repoMap = buildRepoMap(input.directory, 2000);

    const userPrompt = `## Task\n${input.objective}\n\n${repoMap}\n\n${context.promptContext ? `## Selected Context\n${context.promptContext}` : "## This is an empty or new directory."}`;

    const historicalMessages = await loadThreadMessages(threadId);
    // Budget-based history window: fill from most-recent backwards up to 24k chars.
    // Adapts automatically — small messages keep more turns, large tool-result turns keep fewer.
    const HISTORY_BUDGET_CHARS = 24_000;
    let historyBudget = HISTORY_BUDGET_CHARS;
    const selectedHistory: typeof historicalMessages = [];
    for (let i = historicalMessages.length - 1; i >= 0; i--) {
      const msg = historicalMessages[i]!;
      if (msg.content.length > historyBudget) break;
      selectedHistory.unshift(msg);
      historyBudget -= msg.content.length;
    }
    const historyTail = selectedHistory.map((msg): AgentMessage => {
      if (msg.role === "assistant") return { role: "assistant", content: msg.content };
      if (msg.role === "system") return { role: "system", content: msg.content };
      return { role: "user", content: msg.content };
    });
    const messages: AgentMessage[] = [{ role: "system", content: systemPrompt }, ...historyTail, { role: "user", content: userPrompt }];


    appendTrace(run.runId, "llm.request", {
      model: modelName,
      promptLength: userPrompt.length,
      maxTokens,
      routingMode: settingsData.routingMode ?? "balanced"
    });
    emitRunStatus(run.runId, "executing", `Starting agent with ${modelName}...`, { type: "info", model: modelName });

    // 4. Canonical agentic loop — the model drives everything
    const allTextResponses: string[] = [];
    appendThreadMessage(threadId, "system", systemPrompt, 0);
    appendThreadMessage(threadId, "user", userPrompt, 0);
    let actionCount = resumeFrom?.stats.actionCount ?? 0;
    let totalInputTokens = resumeFrom?.stats.totalInputTokens ?? 0;
    let totalOutputTokens = resumeFrom?.stats.totalOutputTokens ?? 0;
    const runStartTime = Date.now();
    let retryCount = resumeFrom?.stats.retries ?? 0;
    let safetyViolations = 0;
    let validationFailures = 0;
    const toolCtx: ToolExecContext = {
      projectDir: input.directory,
      runId: run.runId,
      turn: 0,
      signal: controller.signal,
      settingsData: settingsData as Record<string, unknown>,
      projectConfig: projectConfig ?? undefined,
      mcpToolMap: mcpDefs.toolMap
    };

    for (let turn = 1; turn <= MAX_AGENT_TURNS; turn++) {
      if (controller.signal.aborted) throw new Error("Execution aborted by operator.");
      toolCtx.turn = turn;

      // Token-aware context compression
      await compressIfNeeded(messages, provider.kind, provider.baseUrl, apiKey, modelName);

      // Call LLM (provider-agnostic, streaming)
      const turnStart = Date.now();
      const turnResult = await withRetry(
        async () => {
          guardCircuit(circuit, Date.now());
          // Prompt cache disabled — full-message hashing yields <5% hit rate.
          // Saves 2 HTTP round-trips (~100ms) per turn.
          const result = await callProviderStreaming({
            providerKind: provider.kind,
            baseUrl: provider.baseUrl,
            apiKey,
            model: modelName,
            systemPrompt,
            messages,
            maxTokens,
            tools: { anthropic: allAnthropicTools, openai: allOpenaiTools },
            onDelta: (d) => emitRunStatus(run.runId, "executing", d, { type: "llm_delta", turn, detail: d }),
            signal: controller.signal
          });
          recordCircuitSuccess(circuit);
          return result;
        },
        retryPolicyFor("transient", "llm"),
        async (attempt, error) => {
          retryCount++;
          recordCircuitFailure(circuit, Date.now());
          appendTrace(run.runId, "execution.retry", {
            attempt, stage: "llm", error: String(error), errorClass: classifyRetryError(error)
          });
        }
      );
      const turnDuration = Date.now() - turnStart;

      // Track tokens
      totalInputTokens += turnResult.inputTokens;
      totalOutputTokens += turnResult.outputTokens;
      appendTrace(run.runId, "llm.turn", {
        provider: provider.kind, model: modelName, turn,
        durationMs: turnDuration,
        inputTokens: turnResult.inputTokens, outputTokens: turnResult.outputTokens
      });
      emitRunStatus(run.runId, "executing", `Turn ${turn}`, {
        type: "info", turn, model: modelName, duration: turnDuration,
        ...(turnResult.inputTokens ? { tokenUsage: { input: turnResult.inputTokens, output: turnResult.outputTokens } } : {})
      });

      // Process text
      if (turnResult.textContent) {
        allTextResponses.push(turnResult.textContent);
        emitRunStatus(run.runId, "executing", turnResult.textContent.slice(0, 500), { type: "llm_text", turn, detail: turnResult.textContent });
        appendThreadMessage(threadId, "assistant", turnResult.textContent, turn);
        appendTrace(run.runId, "llm.text", { text: turnResult.textContent, turn });
      }

      // Push assistant message to history
      messages.push(turnResult.rawAssistantMessage);

      // No tool calls = model is done
      if (turnResult.toolCalls.length === 0) break;

      // Handle ask_user separately (needs special prompt flow)
      const askUserCalls = turnResult.toolCalls.filter(tc => tc.name === "ask_user");
      const regularCalls = turnResult.toolCalls.filter(tc => tc.name !== "ask_user");

      // Process ask_user calls first
      const askResults: Array<{ id: string; content: string; isError: boolean }> = [];
      for (const tc of askUserCalls) {
        const question = String(tc.input.question ?? "").trim();
        const prompt = await createUserPrompt({
          runId: run.runId, threadId, turnNumber: turn,
          promptText: question || "Please clarify the requirement.",
          context: isRecord(tc.input) ? tc.input : {}
        });
        emitRunStatus(run.runId, "executing", prompt.promptText, { type: "ask_user", turn, promptId: prompt.promptId });
        const answer = await waitForPromptAnswer(prompt.promptId, controller.signal);
        askResults.push({ id: tc.id, content: `Operator answer: ${answer}`, isError: false });
        appendThreadMessage(threadId, "user", `Q: ${prompt.promptText}
A: ${answer}`, turn, { type: "ask_user_answer" });
        appendTrace(run.runId, "ask_user.answered", { promptId: prompt.promptId, turn });
      }

      // Pre-execution: emit tool_call status + fire-and-forget trace writes
      for (const tc of regularCalls) {
        emitRunStatus(run.runId, "executing", describeToolCall(tc.name, tc.input as Record<string, unknown>), {
          type: "tool_call", turn, toolName: tc.name,
          toolInput: describeToolInput(tc.name, tc.input as Record<string, unknown>)
        });
        appendTrace(run.runId, "agent.tool_call", { tool: tc.name, input: tc.input, turn });
      }

      // Execute regular tools (parallel read-only, sequential mutating)
      const toolResults = await executeToolCallsBatch(regularCalls, toolCtx);

      // Post-execution: emit tool_result only (tool_call already emitted above)
      for (const tr of toolResults) {
        actionCount++;
        emitRunStatus(run.runId, "executing",
          tr.result.length > 200 ? tr.result.slice(0, 200) + "..." : tr.result,
          { type: "tool_result", turn, toolName: tr.name, duration: tr.durationMs, detail: tr.result }
        );
        appendTrace(run.runId, "agent.tool_result", { tool: tr.name, result: tr.result.slice(0, 4000), turn, durationMs: tr.durationMs });
      }

      // Build tool result messages in correct format for the provider
      const allResults = [
        ...askResults,
        ...toolResults.map(tr => ({ id: tr.id, content: smartTruncate(tr.result, 15_000), isError: tr.result.startsWith("Error:") }))
      ];
      const resultMessages = buildToolResultMessages(provider.kind, allResults);
      for (const msg of resultMessages) messages.push(msg);

      // Checkpoint — fire-and-forget; next turn doesn't depend on it
      void saveExecutionState(requestJson, run.runId, {
        runId: run.runId, phase: "checkpointed", phaseMarker: "executing",
        turn, input,
        stats: { actionCount, totalInputTokens, totalOutputTokens, retries: retryCount, validationFailures, safetyViolations },
        checkpoint: { at: new Date().toISOString(), reason: "tool_result", messageCount: messages.length },
        replayBoundary: createReplayBoundary(run.runId, turn, "tool_result", messages.length)
      }).catch(() => undefined);
    }

    // 5. Finalize
    const totalDuration = Date.now() - runStartTime;
    const finalResponse = allTextResponses.join("\n\n").trim();
    const estimatedCostUsd = Number((((totalInputTokens / 1_000_000) * 0.2) + ((totalOutputTokens / 1_000_000) * 0.8)).toFixed(6));
    const expectedFragments = input.objective.trim() ? [input.objective.trim().split(/\s+/)[0] as string] : [];
    const evaluation = scoreExecution({
      outputText: finalResponse,
      expectedContains: expectedFragments,
      latencyMs: totalDuration,
      outputTokens: totalOutputTokens,
      maxLatencyMs: 120_000,
      maxTokens,
      safetyViolations
    });
    // Fire all finalization traces in parallel (non-blocking writes)
    const baseline = baselineByRoutingMode.get(routingMode) ?? evaluation.aggregateScore;
    baselineByRoutingMode.set(routingMode, Math.max(baseline, evaluation.aggregateScore));
    const verificationPassRate = Math.max(0, actionCount - validationFailures) / Math.max(1, actionCount);

    appendTrace(run.runId, "llm.response", {
      responseLength: finalResponse.length, actionCount, response: finalResponse,
      totalInputTokens, totalOutputTokens, totalDuration, retries: retryCount, estimatedCostUsd
    });
    appendTrace(run.runId, "eval.score", evaluation as unknown as Record<string, unknown>);
    appendTrace(run.runId, "execution.quality", { safetyViolations, validationFailures });
    appendTrace(run.runId, "eval.optimization", {
      routingMode, baselineScore: baseline,
      candidateScore: evaluation.aggregateScore, improved: evaluation.aggregateScore > baseline
    });

    // These HTTP calls can also run in parallel
    const summary = input.objective.slice(0, 200);
    await Promise.all([
      recordPromotionEvaluation({
        runId: run.runId, criterionId: "default-v1",
        aggregateScore: evaluation.aggregateScore, safetyViolations, verificationPassRate,
        latencyMs: totalDuration, estimatedCostUsd,
        reason: `aggregate=${evaluation.aggregateScore.toFixed(3)} safety=${safetyViolations} verificationPassRate=${verificationPassRate.toFixed(3)}`
      }),
      recordModelPerformance({
        providerId: provider.id, model: modelName, routingMode,
        success: true, latencyMs: totalDuration, estimatedCostUsd,
        aggregateScore: evaluation.aggregateScore
      }),
      requestJson(`/api/runs/${encodeURIComponent(run.runId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed", summary })
      }),
      flushTraces() // drain all pending trace + thread writes
    ]);

    const turnsUsed = Math.max(1, ...allTextResponses.map((_, i) => i + 1));
    const totalTokens = totalInputTokens + totalOutputTokens;
    const completionMessage = actionCount > 0
      ? `Done. ${actionCount} actions, ${turnsUsed} turn${turnsUsed !== 1 ? "s" : ""}, ${formatTokensShort(totalTokens)} tokens.`
      : "Analysis complete.";
    emitRunStatus(run.runId, lifecycle.transition("completed"), completionMessage, {
      detail: finalResponse, type: "info",
      tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
      duration: totalDuration
    });
    emitRunStatus(run.runId, "completed", "Suggested next steps ready.", {
      type: "follow_up",
      followUpActions: buildFollowUpActions(input.objective, [])
    });
    await Promise.all([
      saveExecutionState(requestJson, run.runId, {
        runId: run.runId, phase: "completed", phaseMarker: "finalizing",
        turn: MAX_AGENT_TURNS, input,
        stats: { actionCount, totalInputTokens, totalOutputTokens, retries: retryCount, validationFailures, safetyViolations }
      }),
      clearExecutionState(requestJson, run.runId),
      runHook(run.runId, "on_complete", {
        actionCount, turns: turnsUsed, totalInputTokens, totalOutputTokens, duration: totalDuration
      }, projectConfig?.hooks, input.directory)
    ]);
    lifecycle.transition("idle");
    activeRunControllers.delete(run.runId);
    return { run, execution: { status: "executed", reason: finalResponse } };

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown execution error";
    appendTrace(run.runId, "run.error", { error: message });
    // Parallelize error-path HTTP calls
    const errorWrites: Promise<unknown>[] = [
      requestJson(`/api/runs/${encodeURIComponent(run.runId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "failed", summary: message })
      }),
      saveExecutionState(requestJson, run.runId, {
        runId: run.runId,
        phase: message.includes("aborted") ? "aborted" : "failed",
        phaseMarker: "finalizing",
        turn: 0,
        input,
        stats: {
          actionCount: 0, totalInputTokens: 0, totalOutputTokens: 0,
          retries: 0, validationFailures: 0, safetyViolations: 0
        },
        lastError: message
      }),
      flushTraces()
    ];
    const failedInput = runInputs.get(run.runId);
    if (failedInput?.providerId) {
      const mode = (await requestJson("/api/settings").catch(() => ({ routingMode: "balanced" }))) as { routingMode?: "balanced" | "latency" | "quality" | "cost" };
      errorWrites.push(recordModelPerformance({
        providerId: failedInput.providerId,
        model: "unknown",
        routingMode: mode.routingMode ?? "balanced",
        success: false, latencyMs: 0, estimatedCostUsd: 0, aggregateScore: 0
      }));
    }
    await Promise.all(errorWrites).catch(() => undefined);
    emitRunStatus(run.runId, lifecycle.transition("failed"), message, { type: "error" });
    lifecycle.transition("idle");
    activeRunControllers.delete(run.runId);
    return { run, execution: { status: "blocked", reason: message } };
  }
}

function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "write_file": return `Writing file: ${input.path ?? "unknown"}`;
    case "edit_file": return `Editing file: ${input.path ?? "unknown"}`;
    case "read_file": return `Reading file: ${input.path ?? "unknown"}`;
    case "search_code": return `Searching code: ${input.query ?? ""}`;
    case "glob_files": return `Globbing files: ${input.pattern ?? "*"}`;
    case "agent_notes": return `Notes: ${input.action ?? "read"}`;
    case "run_command": return `Running: ${input.command ?? "unknown"}`;
    case "list_directory": return `Listing: ${input.path ?? "."}`;
    default: return `Calling ${name}`;
  }
}

function formatTokensShort(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

async function selectModelByRouting(
  defaultModel: string,
  mode: "balanced" | "latency" | "quality" | "cost",
  providerId: string
): Promise<string> {
  // For quality and balanced modes, always use the configured model — never downgrade
  if (mode === "quality" || mode === "balanced") return defaultModel;

  // Only for latency/cost modes, consider performance-based alternatives
  const fallback = pickFallbackModel(defaultModel, mode);
  const stats = (await requestJson(`/api/model-performance/${encodeURIComponent(providerId)}/${mode}`).catch(() => [])) as Array<{
    model: string;
    sampleSize: number;
    successRate: number;
    avgLatencyMs: number;
    avgCostUsd: number;
    avgScore: number;
  }>;
  if (stats.length === 0) return fallback;
  const ranked = [...stats].sort((a, b) => rankModel(b, mode) - rankModel(a, mode));
  const top = ranked[0];
  if (!top || top.sampleSize < 3) return fallback;
  return top.model;
}

function pickFallbackModel(defaultModel: string, mode: "balanced" | "latency" | "quality" | "cost"): string {
  if (mode === "quality") {
    return defaultModel.replace("-mini", "");
  }
  if (mode === "latency" || mode === "cost") {
    return defaultModel.includes("mini") ? defaultModel : `${defaultModel}-mini`;
  }
  return defaultModel;
}

function rankModel(
  item: { successRate: number; avgLatencyMs: number; avgCostUsd: number; avgScore: number },
  mode: "balanced" | "latency" | "quality" | "cost"
): number {
  const success = item.successRate * 0.55;
  const quality = item.avgScore * 0.35;
  const latencyPenalty = Math.min(1, item.avgLatencyMs / 60_000) * 0.2;
  const costPenalty = Math.min(1, item.avgCostUsd / 0.1) * 0.2;
  if (mode === "latency") return success + quality - latencyPenalty * 1.5 - costPenalty * 0.25;
  if (mode === "cost") return success + quality - costPenalty * 1.5 - latencyPenalty * 0.25;
  if (mode === "quality") return success + quality * 1.5 - latencyPenalty * 0.2 - costPenalty * 0.2;
  return success + quality - latencyPenalty * 0.6 - costPenalty * 0.6;
}

function hashApprovalContext(
  runId: string,
  turn: number,
  toolName: string,
  input: Record<string, unknown>
): string {
  const raw = `${runId}|${turn}|${toolName}|${stableStringify(input)}`;
  return createHash("sha256").update(raw).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

async function recordModelPerformance(input: {
  providerId: string;
  model: string;
  routingMode: "balanced" | "latency" | "quality" | "cost";
  success: boolean;
  latencyMs: number;
  estimatedCostUsd: number;
  aggregateScore: number;
}): Promise<void> {
  await requestJson("/api/model-performance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }).catch(() => undefined);
}

function describeToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "write_file": return String(input.path ?? "");
    case "edit_file": return String(input.path ?? "");
    case "read_file": return String(input.path ?? "");
    case "search_code": return String(input.query ?? "").slice(0, 120);
    case "glob_files": return String(input.pattern ?? "");
    case "agent_notes": return String(input.action ?? "read");
    case "run_command": return String(input.command ?? "").slice(0, 120);
    case "list_directory": return String(input.path ?? ".");
    default: return JSON.stringify(input).slice(0, 100);
  }
}

interface ProjectAgentConfig {
  toolAllowlist?: string[];
  preferredModel?: string;
  maxTokens?: number;
  contextHistoryMaxMessages?: number;
  contextSummaryMaxChars?: number;
  contextBudgetTokens?: number;
  hooks?: HookConfig;
  mcpServers?: Array<{
    id: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

function loadProjectConfig(projectDir: string): ProjectAgentConfig | null {
  const configPath = path.join(projectDir, ".autoagent.json");
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config: ProjectAgentConfig = {
      ...(Array.isArray(parsed.toolAllowlist)
        ? { toolAllowlist: parsed.toolAllowlist.filter((v): v is string => typeof v === "string") }
        : {}),
      ...(typeof parsed.preferredModel === "string" ? { preferredModel: parsed.preferredModel } : {}),
      ...(typeof parsed.maxTokens === "number" ? { maxTokens: parsed.maxTokens } : {}),
      ...(typeof parsed.contextHistoryMaxMessages === "number"
        ? { contextHistoryMaxMessages: parsed.contextHistoryMaxMessages }
        : {}),
      ...(typeof parsed.contextSummaryMaxChars === "number"
        ? { contextSummaryMaxChars: parsed.contextSummaryMaxChars }
        : {}),
      ...(isRecord(parsed.hooks) ? { hooks: parseHookConfig(parsed.hooks) } : {})
    };
    if (Array.isArray(parsed.mcpServers)) {
      const servers = parseMcpServersConfig(parsed.mcpServers);
      if (servers.length > 0) config.mcpServers = servers;
    }
    return config;
  } catch {
    return null;
  }
}

function parseHookConfig(raw: Record<string, unknown>): HookConfig {
  const config: HookConfig = {};
  for (const key of ["planning", "tool_result", "reflection", "on_complete"] as const) {
    if (typeof raw[key] === "string") config[key] = raw[key] as string;
  }
  return config;
}

function parseMcpServersConfig(raw: unknown[]): NonNullable<ProjectAgentConfig["mcpServers"]> {
  return raw
    .filter(isRecord)
    .filter((entry) => typeof entry.id === "string" && typeof entry.command === "string")
    .map((entry) => ({
      id: String(entry.id),
      command: String(entry.command),
      ...(Array.isArray(entry.args) ? { args: entry.args.filter((a): a is string => typeof a === "string") } : {}),
      ...(isRecord(entry.env)
        ? {
            env: Object.fromEntries(
              Object.entries(entry.env as Record<string, unknown>).filter(([, v]) => typeof v === "string")
            ) as Record<string, string>
          }
        : {})
    }));
}

/**
 * Create a stdio-based MCP adapter from a command config.
 * Spawns the MCP server process and communicates via JSON-RPC over stdin/stdout.
 */
function createStdioMcpAdapter(config: {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}, projectDir: string): RegisteredMcpAdapter {
  let childProcess: ReturnType<typeof spawn> | null = null;
  let requestId = 0;
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  function ensureProcess(): ReturnType<typeof spawn> {
    if (childProcess && !childProcess.killed) return childProcess;
    const args = config.args ?? [];
    childProcess = spawn(config.command, args, {
      cwd: projectDir,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(config.env ?? {}) }
    });
    let buffer = "";
    childProcess.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
          if (msg.id !== undefined) {
            const pending = pendingRequests.get(msg.id);
            if (pending) {
              pendingRequests.delete(msg.id);
              if (msg.error) pending.reject(new Error(msg.error.message ?? "MCP error"));
              else pending.resolve(msg.result);
            }
          }
        } catch { /* ignore non-JSON lines */ }
      }
    });
    childProcess.on("error", () => {
      for (const p of pendingRequests.values()) p.reject(new Error("MCP process error"));
      pendingRequests.clear();
    });
    childProcess.on("close", () => {
      for (const p of pendingRequests.values()) p.reject(new Error("MCP process exited"));
      pendingRequests.clear();
      childProcess = null;
      initialized = false;
      initializePromise = null;
    });
    return childProcess;
  }

  function sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const proc = ensureProcess();
      pendingRequests.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} });
      proc.stdin!.write(msg + "\n");
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error("MCP request timed out"));
        }
      }, 15_000);
    });
  }

  function sendNotification(method: string, params?: Record<string, unknown>): void {
    const proc = ensureProcess();
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} });
    proc.stdin!.write(msg + "\n");
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      await sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "autoagent-desktop", version: "0.1.0" }
      });
      sendNotification("notifications/initialized");
      initialized = true;
    })();
    return initializePromise;
  }

  function killProcess(): void {
    if (childProcess && !childProcess.killed) {
      childProcess.kill("SIGTERM");
      childProcess = null;
    }
    for (const p of pendingRequests.values()) p.reject(new Error("MCP adapter destroyed"));
    pendingRequests.clear();
    initialized = false;
    initializePromise = null;
  }

  return {
    id: config.id,
    async listTools() {
      await ensureInitialized();
      const result = await sendRequest("tools/list") as { tools?: Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }> };
      return (result?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? { type: "object", properties: {} }
      }));
    },
    async invokeTool(name: string, input: Record<string, unknown>) {
      await ensureInitialized();
      const result = await sendRequest("tools/call", { name, arguments: input }) as { content?: Array<{ text?: string }>; isError?: boolean };
      const text = result?.content?.map((c) => c.text ?? "").join("") ?? "";
      return { ok: !result?.isError, output: text };
    },
    destroy: killProcess
  };
}

async function loadMcpAdaptersFromConfig(
  mcpServers: NonNullable<ProjectAgentConfig["mcpServers"]>,
  projectDir: string,
  runId: string
): Promise<void> {
  clearMcpAdapters();
  for (const server of mcpServers) {
    try {
      const adapter = createStdioMcpAdapter(server, projectDir);
      registerMcpAdapter(adapter);
      appendTrace(runId, "mcp.adapter_registered", { id: server.id, command: server.command });
    } catch {
      appendTrace(runId, "mcp.adapter_failed", { id: server.id });
    }
  }
}

async function compressIfNeeded(
  messages: AgentMessage[],
  providerKind: string,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<void> {
  const estimated = estimateTokens(messages);
  // Compress at ~80K estimated tokens (conservative for most 128K+ context models)
  const threshold = 65_000;
  if (estimated < threshold || messages.length < 6) return;

  // Keep system prompt (index 0) and last 4 messages
  const head = messages[0];
  if (!head) return;
  const preserved = messages.slice(-4);
  const toCompress = messages.slice(1, messages.length - 4);
  if (toCompress.length < 2) return;

  const transcript = toCompress
    .map((msg) => {
      if (typeof msg.content === "string") return `[${msg.role}] ${msg.content.slice(0, 800)}`;
      return `[${msg.role}] <structured content>`;
    })
    .join("\n---\n")
    .slice(0, 6000);

  const summaryPrompt = `Summarize this conversation for an AI coding agent. Preserve: key decisions, files created/modified, commands run and outcomes, errors, current progress. Be concise.\n\n${transcript}`;

  let summary: string;
  try {
    if (providerKind === "anthropic-compatible") {
      summary = await runAnthropicChat({ baseUrl, apiKey, model, prompt: summaryPrompt, systemPrompt: "Summarize concisely.", maxTokens: 512 });
    } else {
      summary = await runOpenAiCompatibleChat({ baseUrl, apiKey, model, prompt: summaryPrompt, systemPrompt: "Summarize concisely.", maxTokens: 512 });
    }
  } catch {
    // Fallback: simple truncation
    summary = toCompress
      .map((msg) => {
        if (typeof msg.content === "string") return `[${msg.role}] ${msg.content.slice(0, 200)}`;
        return `[${msg.role}] <complex>`;
      })
      .join("\n")
      .slice(0, 2400);
  }

  messages.splice(0, messages.length, head, { role: "user", content: `[Previous conversation summary]\n${summary}` }, ...preserved);
}



type HookEvent = "planning" | "tool_result" | "reflection" | "on_complete";
type HookConfig = Partial<Record<HookEvent, string>>;

async function runHook(
  runId: string,
  event: HookEvent,
  payload: Record<string, unknown>,
  hookConfig?: HookConfig,
  projectDir?: string
): Promise<void> {
  appendTrace(runId, `hook.${event}`, payload);

  const command = hookConfig?.[event];
  if (!command || !projectDir) return;

  try {
    const child = spawn(command, {
      cwd: projectDir,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const hookPayload = JSON.stringify({ runId, event, timestamp: new Date().toISOString(), ...payload });
    child.stdin.write(hookPayload);
    child.stdin.end();
    const killTimer = setTimeout(() => child.kill("SIGTERM"), 10_000);
    child.on("close", () => clearTimeout(killTimer));
    child.on("error", (err) => {
      clearTimeout(killTimer);
      appendTrace(runId, `hook.${event}.error`, { error: err.message });
    });
  } catch {
    // Hook execution is best-effort
  }
}

function createPromptCacheKey(
  providerKind: "openai-compatible" | "anthropic-compatible" | "custom",
  model: string,
  system: string,
  messages: AgentMessage[],
  maxTokens: number
): string {
  const raw = stableStringify({
    providerKind,
    model,
    system,
    maxTokens,
    messages
  });
  return createHash("sha256").update(raw).digest("hex");
}

async function readPromptCache(key: string): Promise<unknown | null> {
  const result = (await requestJson(`/api/prompt-cache/${encodeURIComponent(key)}`).catch(() => null)) as
    | { hit?: boolean; value?: unknown; createdAt?: string }
    | null;
  if (!result?.hit || !result.createdAt) return null;
  const age = Date.now() - Date.parse(result.createdAt);
  if (age > PROMPT_CACHE_TTL_MS) return null;
  return result.value ?? null;
}

async function writePromptCache(key: string, value: unknown): Promise<void> {
  await requestJson(`/api/prompt-cache/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value })
  }).catch(() => undefined);
}

ipcMain.handle(IPC_CHANNELS.runStart, async (_event, input: StartRunInput) => {
  lifecycle.reset();
  emitRunStatus("pending", lifecycle.transition("creating_run"), "Creating run...");
  const run = (await requestJson("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "local-desktop", objective: input.objective })
  })) as { runId: string; [key: string]: unknown };
  runInputs.set(run.runId, input);

  emitRunStatus(run.runId, lifecycle.transition("approval_required"), "Waiting for execution approval.");
  const approved = await requestExecutionApproval(input.directory);
  if (!approved) {
    emitRunStatus(run.runId, lifecycle.transition("rejected"), "Execution rejected by operator.");
    lifecycle.transition("idle");
    await requestJson(`/api/runs/${encodeURIComponent(run.runId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "cancelled" })
    });
    return { run, execution: { status: "awaiting_approval" as const, reason: "Execution rejected by operator." } };
  }

  emitRunStatus(run.runId, lifecycle.transition("approved"), "Execution approved.");
  return executeRun(input, run);
});

ipcMain.handle(IPC_CHANNELS.runResume, async (_event, input: { runId: string }) => {
  const run = (await requestJson(`/api/runs/${encodeURIComponent(input.runId)}`)) as { runId: string; [key: string]: unknown };
  await ensureNoPendingApprovals(run.runId);
  const persisted = await loadExecutionState(requestJson, input.runId);
  if (!persisted) {
    throw new Error("No persisted execution state available for resume.");
  }
  assertDeterministicResume(persisted, "resume");
  const stateInput = (persisted.input ?? {}) as Partial<StartRunInput>;
  const runInput: StartRunInput = {
    providerId: typeof stateInput.providerId === "string" ? stateInput.providerId : "openai-default",
    directory: typeof stateInput.directory === "string" ? stateInput.directory : process.cwd(),
    objective: typeof stateInput.objective === "string" ? stateInput.objective : "Resume previous run",
    ...(typeof (stateInput as { threadId?: unknown }).threadId === "string"
      ? { threadId: (stateInput as { threadId?: string }).threadId as string }
      : {})
  };
  runInputs.set(run.runId, runInput);
  emitRunStatus(run.runId, lifecycle.transition("executing"), "Resuming from checkpoint...", { type: "info" });
  return executeRun(runInput, run, { resumeFrom: persisted });
});

ipcMain.handle(IPC_CHANNELS.runRetry, async (_event, input: { runId: string }) => {
  const run = (await requestJson(`/api/runs/${encodeURIComponent(input.runId)}`)) as { runId: string; [key: string]: unknown };
  await ensureNoPendingApprovals(run.runId);
  const cachedInput = runInputs.get(input.runId);
  const persisted = await loadExecutionState(requestJson, input.runId);
  if (persisted) {
    assertDeterministicResume(persisted, "retry");
  }
  const stateInput = (persisted?.input ?? {}) as Partial<StartRunInput>;
  const runInput: StartRunInput = cachedInput ?? {
    providerId: typeof stateInput.providerId === "string" ? stateInput.providerId : "openai-default",
    directory: typeof stateInput.directory === "string" ? stateInput.directory : process.cwd(),
    objective: typeof stateInput.objective === "string" ? stateInput.objective : "Retry previous run",
    ...(typeof (stateInput as { threadId?: unknown }).threadId === "string"
      ? { threadId: (stateInput as { threadId?: string }).threadId as string }
      : {})
  };
  emitRunStatus(run.runId, lifecycle.transition("executing"), "Retrying run...", { type: "info" });
  return executeRun(runInput, run);
});

ipcMain.handle(IPC_CHANNELS.runAbort, async (_event, input: { runId: string }) => {
  const controller = activeRunControllers.get(input.runId);
  if (controller) {
    controller.abort();
  }
  await requestJson(`/api/runs/${encodeURIComponent(input.runId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "cancelled", summary: "Aborted by operator." })
  });
  await saveExecutionState(requestJson, input.runId, {
    runId: input.runId,
    phase: "aborted",
    turn: 0,
    input: runInputs.get(input.runId) ?? {},
    stats: {
      actionCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      retries: 0,
      validationFailures: 0,
      safetyViolations: 0
    },
    lastError: "Aborted by operator."
  });
  emitRunStatus(input.runId, "failed", "Run aborted by operator.", { type: "error" });
  return { ok: true };
});

ipcMain.handle(IPC_CHANNELS.runQuickLaunch, async (_event, input: StartRunInput) => {
  lifecycle.reset();
  emitRunStatus("pending", lifecycle.transition("creating_run"), "Creating run...");
  const run = (await requestJson("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "local-desktop", objective: input.objective })
  })) as { runId: string; [key: string]: unknown };
  runInputs.set(run.runId, input);

  // Skip approval — auto-approve for quick launch / test mode
  emitRunStatus(run.runId, lifecycle.transition("approved"), "Auto-approved (quick launch).");
  return executeRun(input, run);
});
ipcMain.handle(IPC_CHANNELS.runChatTrial, async (_event, input: { providerId: string; prompt: string }) => {
  const provider = (await requestJson(`/api/providers/${encodeURIComponent(input.providerId)}`)) as {
    id: string;
    kind: "openai-compatible" | "anthropic-compatible" | "custom";
    baseUrl: string;
    defaultModel?: string;
  };
  const apiKey = getApiKey(provider.id);
  if (!apiKey) {
    throw new Error("No API key found for provider. Save a key first.");
  }
  const settingsData = (await requestJson("/api/settings")) as { maxTokens?: number };
  const chatInput: ChatTrialInput = {
    baseUrl: provider.baseUrl,
    apiKey,
    model: provider.defaultModel ?? "gpt-4o-mini",
    prompt: input.prompt,
    maxTokens: settingsData.maxTokens ?? 4096
  };
  const text = provider.kind === "anthropic-compatible"
    ? await runAnthropicChat(chatInput)
    : await runOpenAiCompatibleChat(chatInput);
  return { text };
});
ipcMain.handle(IPC_CHANNELS.runRepoTrial, async (_event, input: { providerId: string; directory: string; objective: string }) => {
  void input.providerId;
  return {
    text: `Repo trial initialized for ${input.directory}. Use Play to run guarded execution for objective: ${input.objective}`
  };
});
ipcMain.handle(IPC_CHANNELS.fetchThreadByRun, async (_event, runId: string) =>
  requestJson(`/api/threads/by-run/${encodeURIComponent(runId)}`)
);
ipcMain.handle(IPC_CHANNELS.fetchThreadMessages, async (_event, threadId: string) =>
  requestJson(`/api/threads/${encodeURIComponent(threadId)}/messages`)
);
ipcMain.handle(IPC_CHANNELS.fetchUserPrompts, async (_event, runId: string) =>
  requestJson(`/api/prompts/by-run/${encodeURIComponent(runId)}`)
);
ipcMain.handle(IPC_CHANNELS.answerUserPrompt, async (_event, input: { promptId: string; responseText: string }) =>
  requestJson(`/api/prompts/${encodeURIComponent(input.promptId)}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ responseText: input.responseText })
  }).then(() => ({ ok: true }))
);
ipcMain.handle(IPC_CHANNELS.getFollowUpSuggestions, async (_event, input: { runId: string }) => {
  const run = (await requestJson(`/api/runs/${encodeURIComponent(input.runId)}`)) as { summary?: string };
  return buildFollowUpActions(run.summary ?? "Continue the run", []);
});
ipcMain.handle(IPC_CHANNELS.executeFollowUp, async (_event, input: { runId: string; objective: string }) => {
  const base = runInputs.get(input.runId);
  if (!base) {
    throw new Error("Original run input not found for follow-up.");
  }
  const priorThread = (await requestJson(`/api/threads/by-run/${encodeURIComponent(input.runId)}`).catch(() => null)) as
    | { threadId?: string }
    | null;
  lifecycle.reset();
  emitRunStatus("pending", lifecycle.transition("creating_run"), "Creating follow-up run...");
  const run = (await requestJson("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "local-desktop", objective: input.objective })
  })) as { runId: string; [key: string]: unknown };
  const followUpInput: StartRunInput = {
    providerId: base.providerId,
    directory: base.directory,
    objective: input.objective,
    ...(typeof priorThread?.threadId === "string" ? { threadId: priorThread.threadId } : {})
  };
  runInputs.set(run.runId, followUpInput);
  emitRunStatus(run.runId, lifecycle.transition("approved"), "Follow-up run created.");
  return executeRun(followUpInput, run);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

interface ChatTrialInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
}

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out",
  ".cache", ".vscode", ".idea", "__pycache__", "coverage",
  "dist-main", "dist-renderer", ".pnpm"
]);

function scanDirectory(dir: string, maxDepth: number, prefix = ""): string {
  if (maxDepth <= 0) return prefix + "...\n";
  let result = "";
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        result += `${prefix}${entry.name}/\n`;
        result += scanDirectory(path.join(dir, entry.name), maxDepth - 1, prefix + "  ");
      } else {
        result += `${prefix}${entry.name}\n`;
      }
    }
  } catch { /* skip unreadable dirs */ }
  return result;
}

function findKeyFiles(dir: string): string[] {
  const keyNames = [
    "package.json", "README.md", "CLAUDE.md", "tsconfig.json",
    "Cargo.toml", "pyproject.toml", "go.mod", "Makefile",
    "docker-compose.yml", "Dockerfile"
  ];
  const found: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && keyNames.includes(entry.name)) {
        found.push(path.join(dir, entry.name));
      }
    }
    // Also check one level of subdirs for monorepos
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        try {
          const subEntries = readdirSync(path.join(dir, entry.name), { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile() && keyNames.includes(sub.name)) {
              found.push(path.join(dir, entry.name, sub.name));
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return found.slice(0, 15);
}


function buildFollowUpActions(objective: string, reflectionNotes: string[]): FollowUpAction[] {
  const firstNote = reflectionNotes[0] ?? "Address remaining gaps";
  return [
    {
      id: "followup-fix-gaps",
      label: "Fix Remaining Gaps",
      description: "Continue execution to close unfinished items from reflection.",
      objectiveHint: `${objective}\n\nFollow-up: ${firstNote}`
    },
    {
      id: "followup-add-tests",
      label: "Add Verification",
      description: "Add or improve tests/checks for produced code.",
      objectiveHint: `${objective}\n\nFollow-up: add validation, tests, and checks for robustness.`
    },
    {
      id: "followup-optimize",
      label: "Optimize Quality/Performance",
      description: "Refine implementation for quality, latency, and maintainability.",
      objectiveHint: `${objective}\n\nFollow-up: optimize and refactor for production quality.`
    }
  ];
}

async function ensureRunThread(runId: string, preferredThreadId?: string): Promise<string> {
  if (preferredThreadId) return preferredThreadId;
  const existing = (await requestJson(`/api/threads/by-run/${encodeURIComponent(runId)}`).catch(() => null)) as
    | { threadId?: string }
    | null;
  if (existing?.threadId) return existing.threadId;
  const created = (await requestJson("/api/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, title: "Execution Thread" })
  })) as { threadId: string };
  return created.threadId;
}

function appendThreadMessage(
  threadId: string,
  role: "system" | "user" | "assistant" | "tool",
  content: string,
  turnNumber: number,
  metadata?: Record<string, unknown>
): void {
  if (!content.trim()) return;
  const p = requestJson(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, content: content.slice(0, 20_000), turnNumber, metadata })
  }).catch(() => undefined);
  pendingTraces.push(p); // piggyback on trace flush
}

async function loadThreadMessages(threadId: string): Promise<Array<{ role: string; content: string; turnNumber: number }>> {
  return (await requestJson(`/api/threads/${encodeURIComponent(threadId)}/messages`).catch(() => [])) as Array<{
    role: string;
    content: string;
    turnNumber: number;
  }>;
}

async function createUserPrompt(input: {
  runId: string;
  threadId: string;
  turnNumber: number;
  promptText: string;
  context?: Record<string, unknown>;
}): Promise<{ promptId: string; promptText: string }> {
  return (await requestJson("/api/prompts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: input.runId,
      threadId: input.threadId,
      turnNumber: input.turnNumber,
      promptText: input.promptText,
      context: input.context,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
    })
  })) as { promptId: string; promptText: string };
}

async function waitForPromptAnswer(promptId: string, signal: AbortSignal): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15 * 60_000) {
    if (signal.aborted) throw new Error("Execution aborted while waiting for user prompt answer.");
    const direct = (await requestJson(`/api/prompts/${encodeURIComponent(promptId)}`).catch(() => null)) as
      | { status?: string; responseText?: string; promptText?: string }
      | null;
    if (direct?.status === "answered") {
      return direct.responseText ?? "";
    }
    if (direct?.status === "expired" || direct?.status === "cancelled") {
      throw new Error("User prompt expired or was cancelled.");
    }
    await sleep(1000);
  }
  throw new Error("Timed out waiting for user prompt answer.");
}

async function createVerificationArtifact(input: {
  runId: string;
  verificationType: string;
  artifactType: string;
  artifactContent?: string;
  verificationResult: "pass" | "fail" | "warning" | "pending";
  checks?: Array<{ check: string; passed: boolean; severity: "info" | "warn" | "error" }>;
}): Promise<void> {
  await requestJson("/api/artifacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }).catch(() => undefined);
}

async function recordPromotionEvaluation(input: {
  runId: string;
  criterionId: string;
  aggregateScore: number;
  safetyViolations: number;
  verificationPassRate: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
  reason: string;
}): Promise<void> {
  await requestJson("/api/promotions/evaluations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pending trace writes — drained before finalization via flushTraces()
const pendingTraces: Promise<unknown>[] = [];

function appendTrace(runId: string, eventType: string, payload: Record<string, unknown>): void {
  const p = requestJson(`/api/traces/${encodeURIComponent(runId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventType, payload })
  }).catch(() => undefined); // traces are best-effort — never block execution
  pendingTraces.push(p);
}

async function flushTraces(): Promise<void> {
  const batch = pendingTraces.splice(0);
  if (batch.length > 0) await Promise.all(batch);
}

async function ensureNoPendingApprovals(runId: string): Promise<void> {
  const approvals = (await requestJson("/api/approvals").catch(() => [])) as Array<{
    runId: string;
    status: string;
    expiresAt?: string;
    contextHash?: string;
  }>;
  const pending = approvals.filter((approval) => approval.runId === runId && approval.status === "pending");
  const stillValid = pending.filter((approval) => !approval.expiresAt || Date.parse(approval.expiresAt) > Date.now());
  if (stillValid.length > 0) {
    throw new Error("Cannot resume/retry while pending tool approvals exist.");
  }
  const staleApproved = approvals.some(
    (approval) =>
      approval.runId === runId &&
      approval.status === "approved" &&
      Boolean(approval.contextHash) &&
      Boolean(approval.expiresAt) &&
      Date.parse(String(approval.expiresAt)) <= Date.now()
  );
  if (staleApproved) {
    throw new Error("Cannot resume/retry with stale approved actions; request fresh approval.");
  }
}

function assertDeterministicResume(state: PersistedExecutionState, mode: "resume" | "retry"): void {
  if (state.phase === "completed") {
    throw new Error(`Cannot ${mode} a completed run.`);
  }
  if (state.phase === "aborted") {
    throw new Error(`Cannot ${mode} an aborted run. Start a new run instead.`);
  }
  if (mode === "resume" && state.phase !== "checkpointed") {
    throw new Error("Resume requires a checkpointed state.");
  }
  if (state.phase === "checkpointed" && !state.replayBoundary) {
    throw new Error("Checkpoint missing replay boundary; refusing non-deterministic replay.");
  }
}

function createReplayBoundary(
  runId: string,
  turn: number,
  reason: string,
  messageCount: number
): { turn: number; reason: string; contextHash: string; createdAt: string } {
  const createdAt = new Date().toISOString();
  const contextHash = createHash("sha256")
    .update(`${runId}|${turn}|${reason}|${messageCount}`)
    .digest("hex");
  return {
    turn,
    reason,
    contextHash,
    createdAt
  };
}

async function runAnthropicChat(input: ChatTrialInput): Promise<string> {
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens ?? 4096,
    messages: [{ role: "user", content: input.prompt }]
  };
  if (input.systemPrompt) {
    body.system = input.systemPrompt;
  }
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat failed: ${response.status} ${text}`);
  }
  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return payload.content?.find((b) => b.type === "text")?.text ?? "";
}

async function runOpenAiCompatibleChat(input: ChatTrialInput): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  messages.push({ role: "user", content: input.prompt });
  const body: Record<string, unknown> = {
    model: input.model,
    messages,
    temperature: 0.2
  };
  if (input.maxTokens) {
    body.max_tokens = input.maxTokens;
  }
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Chat trial failed: ${response.status} ${body}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content ?? "";
}
