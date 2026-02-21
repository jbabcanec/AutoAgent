export type UUID = string;
export type ISO8601 = string;

export type ActionClass = "read" | "write" | "exec" | "external" | "deploy";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalState = "not_required" | "pending" | "approved" | "rejected";

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  kind: "openai-compatible" | "anthropic-compatible" | "custom";
  baseUrl: string;
  defaultModel?: string;
}

export interface ModelRequest {
  providerId: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
  maxOutputTokens?: number;
  temperature?: number;
  metadata?: Record<string, string>;
}

export interface ToolInvocation {
  toolName: string;
  actionClass: ActionClass;
  input: Record<string, unknown>;
  risk: RiskLevel;
}

export interface ApprovalDecision {
  state: ApprovalState;
  reviewerId?: string;
  reason?: string;
  decidedAt?: ISO8601;
}

export interface RunCreateRequest {
  projectId: UUID;
  actorId: UUID;
  objective: string;
  selectedDirectories: string[];
  provider: ProviderDescriptor;
}

export interface RunState {
  runId: UUID;
  projectId: UUID;
  status: "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: ISO8601;
  updatedAt: ISO8601;
  summary?: string;
}

export interface ToolResult {
  invocation: ToolInvocation;
  ok: boolean;
  output: string;
  exitCode?: number;
  approval: ApprovalDecision;
}
