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

export interface TraceItem {
  runId: string;
  timestamp: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface ExecutionStateItem {
  runId: string;
  state: Record<string, unknown>;
  updatedAt: string;
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
  traceRetentionDays?: number;
  artifactRetentionDays?: number;
  promptRetentionDays?: number;
  cleanupIntervalMinutes?: number;
  promptCacheRetentionDays?: number;
}

export interface ModelPerformanceItem {
  id: number;
  providerId: string;
  model: string;
  routingMode: "balanced" | "latency" | "quality" | "cost";
  success: boolean;
  latencyMs: number;
  estimatedCostUsd: number;
  aggregateScore: number;
  recordedAt: string;
}

export interface ConversationThreadItem {
  threadId: string;
  runId: string;
  parentThreadId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageItem {
  id: number;
  threadId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  turnNumber: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UserPromptItem {
  promptId: string;
  runId: string;
  threadId?: string;
  turnNumber: number;
  promptText: string;
  context?: Record<string, unknown>;
  status: "pending" | "answered" | "expired" | "cancelled";
  requestedAt: string;
  answeredAt?: string;
  responseText?: string;
  expiresAt?: string;
}

export interface VerificationArtifactItem {
  artifactId: string;
  runId: string;
  verificationType: string;
  artifactType: string;
  artifactContent?: string;
  verificationResult: "pass" | "fail" | "warning" | "pending";
  checks?: Array<{ check: string; passed: boolean; severity: "info" | "warn" | "error" }>;
  verifiedAt: string;
}

export interface PromotionCriterionItem {
  criterionId: string;
  name: string;
  description?: string;
  minAggregateScore: number;
  maxSafetyViolations: number;
  minVerificationPassRate: number;
  maxLatencyMs?: number;
  maxEstimatedCostUsd?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionEvaluationItem {
  evaluationId: string;
  runId: string;
  criterionId: string;
  evaluationResult: "promoted" | "rejected";
  aggregateScore: number;
  safetyViolations: number;
  verificationPassRate: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
  evaluatedAt: string;
  reason: string;
  rejectReasons?: string[];
}

export interface ProviderItem {
  id: string;
  displayName: string;
  kind: "openai-compatible" | "anthropic-compatible" | "custom";
  baseUrl: string;
  defaultModel?: string;
  apiKeyStored: boolean;
}

export interface PromptCacheItem {
  key: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
  hitCount: number;
}
