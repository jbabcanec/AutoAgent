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
}

export interface ProviderItem {
  id: string;
  displayName: string;
  kind: "openai-compatible" | "anthropic-compatible" | "custom";
  baseUrl: string;
  defaultModel?: string;
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

export interface SettingsItem {
  requireApproval: boolean;
}
