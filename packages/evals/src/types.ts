export interface TraceEvent {
  runId: string;
  timestamp: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface BenchmarkCase {
  id: string;
  prompt: string;
  expectedContains: string[];
  maxLatencyMs: number;
  maxTokens: number;
}

export interface BenchmarkResult {
  caseId: string;
  passed: boolean;
  correctnessScore: number;
  latencyScore: number;
  costScore: number;
  safetyScore: number;
  aggregateScore: number;
  notes: string[];
}

export interface CandidateConfig {
  id: string;
  retrievalTopK: number;
  historyBudgetRatio: number;
  modelRoutingMode: "cost" | "balanced" | "quality";
}
