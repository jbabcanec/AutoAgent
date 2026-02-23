export interface RunItem {
  runId: string;
  projectId: string;
  status: "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  summary?: string;
}

export interface ApprovalItem {
  id: string;
  runId: string;
  reason: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  scope?: "run" | "tool";
  toolName?: string;
  toolInput?: Record<string, unknown>;
  expiresAt?: string;
  contextHash?: string;
}

export interface ProviderItem {
  id: string;
  displayName: string;
  kind: "openai-compatible" | "anthropic-compatible" | "custom";
  baseUrl: string;
  defaultModel?: string;
  apiKeyStored: boolean;
}

export interface DashboardStats {
  totalRuns: number;
  activeRuns: number;
  completedRuns: number;
  failedRuns: number;
  pendingApprovals: number;
}

export interface TraceItem {
  runId: string;
  timestamp: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface ConversationThreadItem {
  threadId: string;
  runId: string;
  parentThreadId?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageItem {
  id: number;
  threadId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  turnNumber: number;
  createdAt: string;
}

export interface UserPromptItem {
  promptId: string;
  runId: string;
  threadId?: string;
  turnNumber: number;
  promptText: string;
  status: "pending" | "answered" | "expired" | "cancelled";
  requestedAt?: string;
  answeredAt?: string;
  responseText?: string;
  expiresAt?: string;
}

export interface SettingsItem {
  requireApproval: boolean;
  hasCompletedOnboarding: boolean;
  trialTaskCompleted: "chat" | "repo" | "both" | "none";
  onboardingCompletedAt?: string;
  maxTokens: number;
  routingMode?: "balanced" | "latency" | "quality" | "cost";
  egressPolicyMode?: "off" | "audit" | "enforce";
  egressAllowHosts?: string[];
}
