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
