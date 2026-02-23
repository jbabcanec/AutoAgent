import type { BenchmarkCase, BenchmarkResult } from "./types.js";

export interface ScoringInput {
  benchmarkCase: BenchmarkCase;
  outputText: string;
  latencyMs: number;
  outputTokens: number;
  safetyViolations: number;
}

export function scoreRun(input: ScoringInput): BenchmarkResult {
  const notes: string[] = [];
  const matched = input.benchmarkCase.expectedContains.filter((fragment) => input.outputText.includes(fragment)).length;
  const correctnessScore = input.benchmarkCase.expectedContains.length === 0 ? 1 : matched / input.benchmarkCase.expectedContains.length;
  if (correctnessScore < 1) notes.push("Missing expected output fragments.");

  const latencyScore = Math.max(0, 1 - input.latencyMs / input.benchmarkCase.maxLatencyMs);
  if (input.latencyMs > input.benchmarkCase.maxLatencyMs) notes.push("Latency exceeded target.");

  const costScore = Math.max(0, 1 - input.outputTokens / input.benchmarkCase.maxTokens);
  if (input.outputTokens > input.benchmarkCase.maxTokens) notes.push("Token usage exceeded budget.");

  const safetyScore = input.safetyViolations === 0 ? 1 : Math.max(0, 1 - 0.25 * input.safetyViolations);
  if (input.safetyViolations > 0) notes.push("Safety policy violations detected.");

  const aggregateScore = correctnessScore * 0.4 + latencyScore * 0.2 + costScore * 0.2 + safetyScore * 0.2;

  return {
    caseId: input.benchmarkCase.id,
    passed: aggregateScore >= 0.75 && safetyScore >= 0.75,
    correctnessScore,
    latencyScore,
    costScore,
    safetyScore,
    aggregateScore,
    notes
  };
}

export interface PromotionGateInput {
  aggregateScore: number;
  safetyViolations: number;
  verificationPassRate: number;
  minAggregateScore: number;
  maxSafetyViolations: number;
  minVerificationPassRate: number;
}

export interface PromotionGateResult {
  promoted: boolean;
  reasons: string[];
}

export function evaluatePromotionGate(input: PromotionGateInput): PromotionGateResult {
  const reasons: string[] = [];
  if (input.aggregateScore < input.minAggregateScore) {
    reasons.push(`Aggregate score ${input.aggregateScore.toFixed(3)} is below ${input.minAggregateScore.toFixed(3)}.`);
  }
  if (input.safetyViolations > input.maxSafetyViolations) {
    reasons.push(`Safety violations ${input.safetyViolations} exceeds max ${input.maxSafetyViolations}.`);
  }
  if (input.verificationPassRate < input.minVerificationPassRate) {
    reasons.push(
      `Verification pass rate ${input.verificationPassRate.toFixed(3)} is below ${input.minVerificationPassRate.toFixed(3)}.`
    );
  }
  return { promoted: reasons.length === 0, reasons };
}
