import type { ApprovalItem, DashboardStats, ProviderItem, RunItem, SettingsItem, TraceItem } from "../lib/types.js";

export type RunLifecycleState =
  | "idle"
  | "creating_run"
  | "approval_required"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

export interface RunStatusEvent {
  runId: string;
  state: RunLifecycleState;
  message: string;
  timestamp: string;
  detail?: string;
  type?: "info" | "tool_call" | "tool_result" | "llm_text" | "error";
  turn?: number;
  model?: string;
  tokenUsage?: { input: number; output: number };
  duration?: number;
  toolName?: string;
  toolInput?: string;
}

export interface StartRunInput {
  providerId: string;
  directory: string;
  objective: string;
}

export interface StartRunResult {
  run: RunItem;
  execution: {
    status: "executed" | "blocked" | "awaiting_approval";
    reason: string;
  };
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface DesktopApi {
  fetchDashboard(): Promise<DashboardStats>;
  fetchRuns(): Promise<RunItem[]>;
  fetchApprovals(): Promise<ApprovalItem[]>;
  fetchProviders(): Promise<ProviderItem[]>;
  fetchProvider(providerId: string): Promise<ProviderItem>;
  createProvider(input: ProviderItem): Promise<ProviderItem>;
  updateProvider(input: { id: string; updates: Partial<ProviderItem> }): Promise<ProviderItem>;
  fetchSettings(): Promise<SettingsItem>;
  updateSettings(input: Partial<SettingsItem>): Promise<SettingsItem>;
  fetchTraces(runId: string): Promise<TraceItem[]>;
  fetchRunMetrics(runId: string): Promise<{
    runId: string;
    eventCount: number;
    tokenInput: number;
    tokenOutput: number;
    tokenTotal: number;
    actionCount: number;
    retries: number;
    approvalsRequested: number;
    approvalsResolved: number;
    providerLatencyMs: number;
    toolLatencyMs: number;
    executionDurationMs: number;
    estimatedCostUsd: number;
    safetyViolations: number;
    validationFailures: number;
    egressDenied: number;
  }>;
  deleteRun(runId: string): Promise<{ deleted: boolean }>;
  startRun(input: StartRunInput): Promise<StartRunResult>;
  resumeRun(input: { runId: string }): Promise<StartRunResult>;
  retryRun(input: { runId: string }): Promise<StartRunResult>;
  abortRun(input: { runId: string }): Promise<{ ok: boolean }>;
  resolveApproval(input: { approvalId: string; approved: boolean }): Promise<ApprovalItem>;
  keychainStoreApiKey(input: { providerId: string; apiKey: string }): Promise<boolean>;
  keychainDeleteApiKey(input: { providerId: string }): Promise<boolean>;
  keychainGetApiKeyStatus(input: { providerId: string }): Promise<{ stored: boolean }>;
  runQuickLaunch(input: StartRunInput): Promise<StartRunResult>;
  runChatTrial(input: { providerId: string; prompt: string }): Promise<{ text: string }>;
  runRepoTrial(input: { providerId: string; directory: string; objective: string }): Promise<{ text: string }>;
  dialogSelectDirectory(): Promise<string | null>;
  fsReadDirectory(dirPath: string): Promise<DirectoryEntry[]>;
  fsReadFile(filePath: string): Promise<{ content: string; truncated: boolean }>;
  onRunStatus(listener: (event: RunStatusEvent) => void): () => void;
}

export const IPC_CHANNELS = {
  fetchDashboard: "data.fetch.dashboard",
  fetchRuns: "data.fetch.runs",
  fetchApprovals: "data.fetch.approvals",
  fetchProviders: "data.fetch.providers",
  fetchProvider: "data.fetch.provider",
  createProvider: "data.create.provider",
  updateProvider: "data.update.provider",
  fetchSettings: "data.fetch.settings",
  updateSettings: "data.update.settings",
  fetchTraces: "data.fetch.traces",
  fetchRunMetrics: "data.fetch.runMetrics",
  deleteRun: "data.delete.run",
  runStart: "run.start",
  runResume: "run.resume",
  runRetry: "run.retry",
  runAbort: "run.abort",
  runQuickLaunch: "run.quickLaunch",
  runChatTrial: "run.trial.chat",
  runRepoTrial: "run.trial.repo",
  runStatus: "run.status",
  approvalResolve: "approval.resolve",
  keychainStoreApiKey: "keychain.store.apiKey",
  keychainDeleteApiKey: "keychain.delete.apiKey",
  keychainGetApiKeyStatus: "keychain.get.apiKeyStatus",
  dialogSelectDirectory: "dialog.selectDirectory",
  fsReadDirectory: "fs.readDirectory",
  fsReadFile: "fs.readFile"
} as const;
