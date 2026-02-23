import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS, type RunLifecycleState, type RunStatusEvent, type StartRunInput } from "../shared/ipc.js";
import { RunLifecycleMachine } from "./runLifecycle.js";
import { deleteApiKey, getApiKey, hasApiKey, storeApiKey } from "./keychain.js";
import { ANTHROPIC_TOOLS, OPENAI_TOOLS, executeTool } from "./agentTools.js";
import { buildLiveContext } from "./liveContextEngine.js";
import { evaluateToolPolicy } from "./executionPolicy.js";
import { inspectCommand } from "./commandValidator.js";
import { evaluateEgressPolicy } from "./egressPolicy.js";
import { clearExecutionState, loadExecutionState, saveExecutionState, type PersistedExecutionState } from "./executionState.js";
import { guardCircuit, recordCircuitFailure, recordCircuitSuccess, withRetry, type CircuitState } from "./executionOrchestrator.js";
import { scoreExecution } from "./evalFeedback.js";
import { validateToolOutcome } from "./executionValidator.js";

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
  const response = await fetch(`${CONTROL_PLANE_BASE}${pathname}`, init);
  if (!response.ok) {
    throw new Error(`Request failed ${pathname}: ${response.status}`);
  }
  return (await response.json()) as unknown;
}

function emitRunStatus(
  runId: string,
  state: RunLifecycleState,
  message: string,
  opts?: Partial<Pick<RunStatusEvent, "detail" | "type" | "turn" | "model" | "tokenUsage" | "duration" | "toolName" | "toolInput">>
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

// --- Agentic LLM Callers ---

async function callAnthropicAgent(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: AgentMessage[],
  maxTokens: number,
  signal?: AbortSignal
): Promise<AnthropicResponse> {
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
  return (await response.json()) as AnthropicResponse;
}

async function callOpenAiAgent(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AgentMessage[],
  maxTokens: number,
  signal?: AbortSignal
): Promise<OpenAiResponse> {
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
  return (await response.json()) as OpenAiResponse;
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
    // 1. Build context with hybrid-style selection + telemetry
    const context = buildLiveContext({
      directory: input.directory,
      objective: input.objective,
      changedFiles: []
    });
    await appendTrace(run.runId, "context.retrieval", {
      objective: input.objective,
      telemetry: context.retrievalTelemetry
    });
    emitRunStatus(run.runId, "executing", "Prepared context for execution.", { type: "info" });

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
    };
    const maxTokens = settingsData.maxTokens ?? 4096;
    const routingMode = settingsData.routingMode ?? "balanced";
    const modelName = await selectModelByRouting(provider.defaultModel ?? "gpt-4o", routingMode, provider.id);
    const circuit = getCircuit(provider.id);
    await saveExecutionState(requestJson, run.runId, {
      runId: run.runId,
      phase: "running",
      turn: resumeFrom?.turn ?? 0,
      input,
      stats: resumeFrom?.stats ?? { actionCount: 0, totalInputTokens: 0, totalOutputTokens: 0, retries: 0 }
    });

    // 3. Build initial messages
    const systemPrompt = `You are AutoAgent, a senior AI developer agent that executes tasks by writing real code, creating files, and running commands.

CRITICAL: You MUST use your tools to actually build things. NEVER just describe or explain — ALWAYS execute.

You have these tools:
- write_file: Create/overwrite files (parent dirs created automatically)
- read_file: Read existing file contents
- run_command: Execute shell commands (install deps, run scripts, test, etc.)
- list_directory: List directory contents

Working directory: ${input.directory}
All file paths are relative to this directory. Write files DIRECTLY here — do NOT create a subdirectory with an arbitrary project name.

Execution rules:
1. ALWAYS create complete, production-quality code — not stubs or placeholders
2. Create ALL necessary files: source code, config, package.json, README, etc.
3. Install dependencies with the appropriate package manager
4. After writing code, VERIFY it works by running a test or a quick check command
5. If something fails, read the error, fix it, and retry
6. Create proper project structure with organized directories
7. Add error handling and input validation in your code
8. When done, give a concise 2-3 sentence summary of what you built and how to use it

IMPORTANT constraints:
- NEVER start long-running servers (e.g. node server.js, npm start, pnpm start). They will timeout and kill execution. Instead, verify by running tests or quick checks.
- Commands have a 30-second timeout. Use only short-lived commands.
- Write all files relative to the working directory root. Do NOT nest inside arbitrary subdirectories.

Think step by step. Plan what you need to build, then execute each step using tools. Do NOT stop after just 1-2 actions — keep going until the task is fully complete and verified.`;

    const userPrompt = `## Task
${input.objective}

## Current Directory Structure
${context.tree}

${context.promptContext ? `## Selected Context\n${context.promptContext}` : "## This is an empty or new directory."}`;

    const messages: AgentMessage[] = [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }];

    await appendTrace(run.runId, "llm.request", {
      model: modelName,
      promptLength: userPrompt.length,
      maxTokens,
      routingMode: settingsData.routingMode ?? "balanced"
    });
    emitRunStatus(run.runId, "executing", `Starting agent with ${modelName}...`, { type: "info", model: modelName });

    // 4. Agentic loop with turn tracking
    const allTextResponses: string[] = [];
    let actionCount = resumeFrom?.stats.actionCount ?? 0;
    let totalInputTokens = resumeFrom?.stats.totalInputTokens ?? 0;
    let totalOutputTokens = resumeFrom?.stats.totalOutputTokens ?? 0;
    const runStartTime = Date.now();
    let retryCount = resumeFrom?.stats.retries ?? 0;
    let safetyViolations = 0;
    let validationFailures = 0;

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      if (controller.signal.aborted) {
        throw new Error("Execution aborted by operator.");
      }
      const turnNum = turn + 1;
      const turnStart = Date.now();

      if (provider.kind === "anthropic-compatible") {
        // --- Anthropic agentic turn ---
        const response = await withRetry(
          async () => {
            guardCircuit(circuit, Date.now());
            const value = await callAnthropicAgent(provider.baseUrl, apiKey, modelName, systemPrompt, messages, maxTokens, controller.signal);
            recordCircuitSuccess(circuit);
            return value;
          },
          { attempts: 3, baseDelayMs: 400 },
          async (attempt, error) => {
            retryCount += 1;
            recordCircuitFailure(circuit, Date.now());
            await appendTrace(run.runId, "execution.retry", {
              attempt,
              stage: "llm.anthropic",
              error,
              errorClass: classifyError(error)
            });
          }
        );
        const turnDuration = Date.now() - turnStart;
        const contentBlocks = response.content ?? [];

        // Capture token usage
        const turnTokens = response.usage
          ? { input: response.usage.input_tokens, output: response.usage.output_tokens }
          : undefined;
        if (turnTokens) {
          totalInputTokens += turnTokens.input;
          totalOutputTokens += turnTokens.output;
        }
        await appendTrace(run.runId, "llm.turn", {
          provider: provider.kind,
          model: modelName,
          turn: turnNum,
          durationMs: turnDuration,
          inputTokens: turnTokens?.input ?? 0,
          outputTokens: turnTokens?.output ?? 0
        });

        emitRunStatus(run.runId, "executing", `Turn ${turnNum}`, {
          type: "info", turn: turnNum, model: modelName, duration: turnDuration,
          ...(turnTokens ? { tokenUsage: turnTokens } : {})
        });

        // Process content blocks
        const toolResults: AnthropicContentBlock[] = [];
        for (const block of contentBlocks) {
          if (block.type === "text" && block.text) {
            allTextResponses.push(block.text);
            emitRunStatus(run.runId, "executing", block.text.slice(0, 500), { type: "llm_text", turn: turnNum, detail: block.text });
            await appendTrace(run.runId, "llm.text", { text: block.text, turn: turnNum });
          }
          if (block.type === "tool_use" && block.name && block.id) {
            const toolName = block.name;
            const toolInput = (block.input ?? {}) as Record<string, unknown>;
            const toolInputSummary = describeToolInput(toolName, toolInput);
            emitRunStatus(run.runId, "executing", describeToolCall(toolName, toolInput), {
              type: "tool_call", turn: turnNum, toolName, toolInput: toolInputSummary
            });
            await appendTrace(run.runId, "agent.tool_call", { tool: toolName, input: toolInput, turn: turnNum });

            const toolStart = Date.now();
            let result: string;
            try {
              if (toolName === "run_command") {
                const inspection = inspectCommand(String(toolInput.command ?? ""));
                await appendTrace(run.runId, "execution.command_inspection", {
                  turn: turnNum,
                  command: inspection.normalizedCommand.slice(0, 300),
                  risk: inspection.risk,
                  warnings: inspection.warnings,
                  violations: inspection.violations,
                  externalHosts: inspection.externalHosts
                });
                if (inspection.violations.length > 0 || inspection.risk === "critical") {
                  safetyViolations += 1;
                  throw new Error(`Blocked command by validator: ${inspection.violations.join("; ") || "critical risk detected"}`);
                }
                const egress = evaluateEgressPolicy({
                  hosts: inspection.externalHosts,
                  mode: settingsData.egressPolicyMode ?? "audit",
                  allowHosts: settingsData.egressAllowHosts ?? []
                });
                await appendTrace(run.runId, "execution.egress_decision", {
                  turn: turnNum,
                  tool: toolName,
                  decision: egress.decision,
                  blockedHosts: egress.blockedHosts,
                  reason: egress.reason
                });
                if (egress.decision === "deny") {
                  safetyViolations += 1;
                  throw new Error(`Denied by egress policy: ${egress.reason}`);
                }
                if (egress.decision === "needs_approval") {
                  const contextHash = hashApprovalContext(run.runId, turnNum, toolName, toolInput);
                  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
                  const approved = await requestToolApproval(run.runId, toolName, egress.reason, toolInput, contextHash, expiresAt);
                  if (!approved) {
                    throw new Error(`Egress not approved for tool: ${toolName}`);
                  }
                }
              }
              const policy = evaluateToolPolicy({ toolName, input: toolInput });
              if (policy.decision === "deny") {
                safetyViolations += 1;
                throw new Error(`Denied by policy: ${policy.reason}`);
              }
              if (policy.decision === "needs_approval") {
                const contextHash = hashApprovalContext(run.runId, turnNum, toolName, toolInput);
                const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
                const approved = await requestToolApproval(run.runId, toolName, policy.reason, toolInput, contextHash, expiresAt);
                if (!approved) {
                  throw new Error(`Tool rejected by operator: ${toolName}`);
                }
              }
              result = await withRetry(
                async () => executeTool(toolName, toolInput, input.directory),
                { attempts: 2, baseDelayMs: 250 },
                async (attempt, error) => {
                  retryCount += 1;
                  await appendTrace(run.runId, "execution.retry", {
                    attempt,
                    stage: "tool",
                    tool: toolName,
                    error,
                    errorClass: classifyError(error)
                  });
                }
              );
              const validation = validateToolOutcome({
                toolName,
                toolInput,
                toolResult: result,
                projectDir: input.directory
              });
              await appendTrace(run.runId, "execution.validation", {
                turn: turnNum,
                tool: toolName,
                ok: validation.ok,
                severity: validation.severity,
                checks: validation.checks
              });
              if (!validation.ok) {
                validationFailures += 1;
              }
              actionCount++;
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
            }
            const toolDuration = Date.now() - toolStart;

            emitRunStatus(run.runId, "executing", result.length > 200 ? result.slice(0, 200) + "..." : result, {
              type: "tool_result", turn: turnNum, toolName, duration: toolDuration, detail: result
            });
            await appendTrace(run.runId, "agent.tool_result", {
              tool: toolName,
              result: result.slice(0, 4000),
              turn: turnNum,
              durationMs: toolDuration
            });

            toolResults.push({ type: "tool_result", id: block.id, text: result } as unknown as AnthropicContentBlock);
          }
        }

        messages.push({ role: "assistant", content: contentBlocks });

        if (toolResults.length > 0) {
          messages.push({ role: "user", content: toolResults });
          const checkpointState: PersistedExecutionState = {
            runId: run.runId,
            phase: "checkpointed",
            turn: turnNum,
            input,
            stats: {
              actionCount,
              totalInputTokens,
              totalOutputTokens,
              retries: retryCount,
              validationFailures,
              safetyViolations
            },
            checkpoint: {
              at: new Date().toISOString(),
              reason: "anthropic.tool_result",
              messageCount: messages.length
            }
          };
          await saveExecutionState(requestJson, run.runId, checkpointState);
          await appendTrace(run.runId, "execution.checkpoint", { turn: turnNum, reason: "anthropic.tool_result" });
          continue;
        }

        if (response.stop_reason === "end_turn" || response.stop_reason === "stop" || toolResults.length === 0) {
          break;
        }
      } else {
        // --- OpenAI-compatible agentic turn ---
        const response = await withRetry(
          async () => {
            guardCircuit(circuit, Date.now());
            const value = await callOpenAiAgent(provider.baseUrl, apiKey, modelName, messages, maxTokens, controller.signal);
            recordCircuitSuccess(circuit);
            return value;
          },
          { attempts: 3, baseDelayMs: 400 },
          async (attempt, error) => {
            retryCount += 1;
            recordCircuitFailure(circuit, Date.now());
            await appendTrace(run.runId, "execution.retry", {
              attempt,
              stage: "llm.openai",
              error,
              errorClass: classifyError(error)
            });
          }
        );
        const turnDuration = Date.now() - turnStart;
        const choice = response.choices?.[0];
        const assistantMessage = choice?.message;

        // Capture token usage
        const turnTokens = response.usage
          ? { input: response.usage.prompt_tokens, output: response.usage.completion_tokens }
          : undefined;
        if (turnTokens) {
          totalInputTokens += turnTokens.input;
          totalOutputTokens += turnTokens.output;
        }
        await appendTrace(run.runId, "llm.turn", {
          provider: provider.kind,
          model: modelName,
          turn: turnNum,
          durationMs: turnDuration,
          inputTokens: turnTokens?.input ?? 0,
          outputTokens: turnTokens?.output ?? 0
        });

        emitRunStatus(run.runId, "executing", `Turn ${turnNum}`, {
          type: "info", turn: turnNum, model: modelName, duration: turnDuration,
          ...(turnTokens ? { tokenUsage: turnTokens } : {})
        });

        if (assistantMessage?.content) {
          allTextResponses.push(assistantMessage.content);
          emitRunStatus(run.runId, "executing", assistantMessage.content.slice(0, 500), {
            type: "llm_text", turn: turnNum, detail: assistantMessage.content
          });
          await appendTrace(run.runId, "llm.text", { text: assistantMessage.content, turn: turnNum });
        }

        const toolCalls = assistantMessage?.tool_calls ?? [];

        messages.push({
          role: "assistant",
          content: assistantMessage?.content ?? null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        });

        if (toolCalls.length > 0) {
          for (const tc of toolCalls) {
            let toolInput: Record<string, unknown> = {};
            try {
              toolInput = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch { /* malformed args */ }

            const toolInputSummary = describeToolInput(tc.function.name, toolInput);
            emitRunStatus(run.runId, "executing", describeToolCall(tc.function.name, toolInput), {
              type: "tool_call", turn: turnNum, toolName: tc.function.name, toolInput: toolInputSummary
            });
            await appendTrace(run.runId, "agent.tool_call", { tool: tc.function.name, input: toolInput, turn: turnNum });

            const toolStart = Date.now();
            let result: string;
            try {
              if (tc.function.name === "run_command") {
                const inspection = inspectCommand(String(toolInput.command ?? ""));
                await appendTrace(run.runId, "execution.command_inspection", {
                  turn: turnNum,
                  command: inspection.normalizedCommand.slice(0, 300),
                  risk: inspection.risk,
                  warnings: inspection.warnings,
                  violations: inspection.violations,
                  externalHosts: inspection.externalHosts
                });
                if (inspection.violations.length > 0 || inspection.risk === "critical") {
                  safetyViolations += 1;
                  throw new Error(`Blocked command by validator: ${inspection.violations.join("; ") || "critical risk detected"}`);
                }
                const egress = evaluateEgressPolicy({
                  hosts: inspection.externalHosts,
                  mode: settingsData.egressPolicyMode ?? "audit",
                  allowHosts: settingsData.egressAllowHosts ?? []
                });
                await appendTrace(run.runId, "execution.egress_decision", {
                  turn: turnNum,
                  tool: tc.function.name,
                  decision: egress.decision,
                  blockedHosts: egress.blockedHosts,
                  reason: egress.reason
                });
                if (egress.decision === "deny") {
                  safetyViolations += 1;
                  throw new Error(`Denied by egress policy: ${egress.reason}`);
                }
                if (egress.decision === "needs_approval") {
                  const contextHash = hashApprovalContext(run.runId, turnNum, tc.function.name, toolInput);
                  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
                  const approved = await requestToolApproval(
                    run.runId,
                    tc.function.name,
                    egress.reason,
                    toolInput,
                    contextHash,
                    expiresAt
                  );
                  if (!approved) {
                    throw new Error(`Egress not approved for tool: ${tc.function.name}`);
                  }
                }
              }
              const policy = evaluateToolPolicy({ toolName: tc.function.name, input: toolInput });
              if (policy.decision === "deny") {
                safetyViolations += 1;
                throw new Error(`Denied by policy: ${policy.reason}`);
              }
              if (policy.decision === "needs_approval") {
                const contextHash = hashApprovalContext(run.runId, turnNum, tc.function.name, toolInput);
                const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
                const approved = await requestToolApproval(
                  run.runId,
                  tc.function.name,
                  policy.reason,
                  toolInput,
                  contextHash,
                  expiresAt
                );
                if (!approved) {
                  throw new Error(`Tool rejected by operator: ${tc.function.name}`);
                }
              }
              result = await withRetry(
                async () => executeTool(tc.function.name, toolInput, input.directory),
                { attempts: 2, baseDelayMs: 250 },
                async (attempt, error) => {
                  retryCount += 1;
                  await appendTrace(run.runId, "execution.retry", {
                    attempt,
                    stage: "tool",
                    tool: tc.function.name,
                    error,
                    errorClass: classifyError(error)
                  });
                }
              );
              const validation = validateToolOutcome({
                toolName: tc.function.name,
                toolInput,
                toolResult: result,
                projectDir: input.directory
              });
              await appendTrace(run.runId, "execution.validation", {
                turn: turnNum,
                tool: tc.function.name,
                ok: validation.ok,
                severity: validation.severity,
                checks: validation.checks
              });
              if (!validation.ok) {
                validationFailures += 1;
              }
              actionCount++;
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
            }
            const toolDuration = Date.now() - toolStart;

            emitRunStatus(run.runId, "executing", result.length > 200 ? result.slice(0, 200) + "..." : result, {
              type: "tool_result", turn: turnNum, toolName: tc.function.name, duration: toolDuration, detail: result
            });
            await appendTrace(run.runId, "agent.tool_result", {
              tool: tc.function.name,
              result: result.slice(0, 4000),
              turn: turnNum,
              durationMs: toolDuration
            });

            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          }
          const checkpointState: PersistedExecutionState = {
            runId: run.runId,
            phase: "checkpointed",
            turn: turnNum,
            input,
            stats: {
              actionCount,
              totalInputTokens,
              totalOutputTokens,
              retries: retryCount,
              validationFailures,
              safetyViolations
            },
            checkpoint: {
              at: new Date().toISOString(),
              reason: "openai.tool_result",
              messageCount: messages.length
            }
          };
          await saveExecutionState(requestJson, run.runId, checkpointState);
          await appendTrace(run.runId, "execution.checkpoint", { turn: turnNum, reason: "openai.tool_result" });
          continue;
        }

        if (choice?.finish_reason === "stop" || toolCalls.length === 0) {
          break;
        }
      }
    }

    // 5. Finalize
    const totalDuration = Date.now() - runStartTime;
    const finalResponse = allTextResponses.join("\n\n");
    const estimatedCostUsd = Number((((totalInputTokens / 1_000_000) * 0.2) + ((totalOutputTokens / 1_000_000) * 0.8)).toFixed(6));
    const expectedFragments = input.objective.trim() ? [input.objective.trim().split(/\s+/)[0] as string] : [];
    const evaluation = scoreExecution({
      outputText: finalResponse,
      expectedContains: expectedFragments,
      latencyMs: totalDuration,
      outputTokens: totalOutputTokens,
      maxLatencyMs: 45_000,
      maxTokens,
      safetyViolations
    });
    await appendTrace(run.runId, "llm.response", {
      responseLength: finalResponse.length, actionCount, response: finalResponse,
      totalInputTokens, totalOutputTokens, totalDuration, retries: retryCount, estimatedCostUsd
    });
    await appendTrace(run.runId, "eval.score", evaluation as unknown as Record<string, unknown>);
    await appendTrace(run.runId, "execution.quality", {
      safetyViolations,
      validationFailures
    });
    const baseline = baselineByRoutingMode.get(routingMode) ?? evaluation.aggregateScore;
    baselineByRoutingMode.set(routingMode, Math.max(baseline, evaluation.aggregateScore));
    await appendTrace(run.runId, "eval.optimization", {
      routingMode,
      baselineScore: baseline,
      candidateScore: evaluation.aggregateScore,
      improved: evaluation.aggregateScore > baseline
    });
    await recordModelPerformance({
      providerId: provider.id,
      model: modelName,
      routingMode,
      success: true,
      latencyMs: totalDuration,
      estimatedCostUsd,
      aggregateScore: evaluation.aggregateScore
    });

    const summary = input.objective.slice(0, 200);
    await requestJson(`/api/runs/${encodeURIComponent(run.runId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed", summary })
    });

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
    await saveExecutionState(requestJson, run.runId, {
      runId: run.runId,
      phase: "completed",
      turn: MAX_AGENT_TURNS,
      input,
      stats: {
        actionCount,
        totalInputTokens,
        totalOutputTokens,
        retries: retryCount,
        validationFailures,
        safetyViolations
      }
    });
    await clearExecutionState(requestJson, run.runId);
    lifecycle.transition("idle");
    activeRunControllers.delete(run.runId);
    return { run, execution: { status: "executed", reason: finalResponse } };

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown execution error";
    await appendTrace(run.runId, "run.error", { error: message });
    await requestJson(`/api/runs/${encodeURIComponent(run.runId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "failed", summary: message })
    });
    await saveExecutionState(requestJson, run.runId, {
      runId: run.runId,
      phase: message.includes("aborted") ? "aborted" : "failed",
      turn: 0,
      input,
      stats: {
        actionCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        retries: 0,
        validationFailures: 0,
        safetyViolations: 0
      },
      lastError: message
    });
    const mode = (await requestJson("/api/settings").catch(() => ({ routingMode: "balanced" }))) as { routingMode?: "balanced" | "latency" | "quality" | "cost" };
    const failedInput = runInputs.get(run.runId);
    if (failedInput?.providerId) {
      await recordModelPerformance({
        providerId: failedInput.providerId,
        model: "unknown",
        routingMode: mode.routingMode ?? "balanced",
        success: false,
        latencyMs: 0,
        estimatedCostUsd: 0,
        aggregateScore: 0
      });
    }
    emitRunStatus(run.runId, lifecycle.transition("failed"), message, { type: "error" });
    lifecycle.transition("idle");
    activeRunControllers.delete(run.runId);
    return { run, execution: { status: "blocked", reason: message } };
  }
}

function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "write_file": return `Writing file: ${input.path ?? "unknown"}`;
    case "read_file": return `Reading file: ${input.path ?? "unknown"}`;
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
  const fallback = pickFallbackModel(defaultModel, mode);
  const stats = (await requestJson(`/api/model-performance/${encodeURIComponent(providerId)}/${mode}`).catch(() => [])) as Array<{
    model: string;
    sampleSize: number;
    successRate: number;
    avgLatencyMs: number;
    avgCostUsd: number;
    avgScore: number;
  }>;
  if (stats.length === 0) {
    return fallback;
  }
  const ranked = [...stats].sort((a, b) => rankModel(b, mode) - rankModel(a, mode));
  const top = ranked[0];
  if (!top || top.sampleSize < 3) {
    return fallback;
  }
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

function classifyError(errorMessage: string): "transient" | "policy" | "tool" | "provider" | "unknown" {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("denied by policy") || normalized.includes("egress")) return "policy";
  if (normalized.includes("api error") || normalized.includes("provider circuit")) return "provider";
  if (normalized.includes("exit ") || normalized.includes("tool")) return "tool";
  if (normalized.includes("timeout") || normalized.includes("network") || normalized.includes("temporarily")) return "transient";
  return "unknown";
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
    case "read_file": return String(input.path ?? "");
    case "run_command": return String(input.command ?? "").slice(0, 120);
    case "list_directory": return String(input.path ?? ".");
    default: return JSON.stringify(input).slice(0, 100);
  }
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
  const stateInput = (persisted.input ?? {}) as Partial<StartRunInput>;
  const runInput: StartRunInput = {
    providerId: typeof stateInput.providerId === "string" ? stateInput.providerId : "openai-default",
    directory: typeof stateInput.directory === "string" ? stateInput.directory : process.cwd(),
    objective: typeof stateInput.objective === "string" ? stateInput.objective : "Resume previous run"
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
  const stateInput = (persisted?.input ?? {}) as Partial<StartRunInput>;
  const runInput: StartRunInput = cachedInput ?? {
    providerId: typeof stateInput.providerId === "string" ? stateInput.providerId : "openai-default",
    directory: typeof stateInput.directory === "string" ? stateInput.directory : process.cwd(),
    objective: typeof stateInput.objective === "string" ? stateInput.objective : "Retry previous run"
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

async function appendTrace(runId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await requestJson(`/api/traces/${encodeURIComponent(runId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventType, payload })
  });
}

async function ensureNoPendingApprovals(runId: string): Promise<void> {
  const approvals = (await requestJson("/api/approvals").catch(() => [])) as Array<{
    runId: string;
    status: string;
    expiresAt?: string;
  }>;
  const pending = approvals.filter((approval) => approval.runId === runId && approval.status === "pending");
  const stillValid = pending.filter((approval) => !approval.expiresAt || Date.parse(approval.expiresAt) > Date.now());
  if (stillValid.length > 0) {
    throw new Error("Cannot resume/retry while pending tool approvals exist.");
  }
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
