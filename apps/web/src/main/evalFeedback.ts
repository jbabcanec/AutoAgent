export interface EvalFeedbackInput {
  outputText: string;
  expectedContains: string[];
  latencyMs: number;
  outputTokens: number;
  maxLatencyMs: number;
  maxTokens: number;
  safetyViolations: number;
}

export interface EvalFeedbackResult {
  correctnessScore: number;
  latencyScore: number;
  costScore: number;
  safetyScore: number;
  aggregateScore: number;
  passed: boolean;
}

export function scoreExecution(input: EvalFeedbackInput): EvalFeedbackResult {
  const matched = input.expectedContains.filter((fragment) => input.outputText.includes(fragment)).length;
  const correctnessScore = input.expectedContains.length === 0 ? 1 : matched / input.expectedContains.length;
  const latencyScore = Math.max(0, 1 - input.latencyMs / input.maxLatencyMs);
  const costScore = Math.max(0, 1 - input.outputTokens / input.maxTokens);
  const safetyScore = input.safetyViolations === 0 ? 1 : Math.max(0, 1 - 0.25 * input.safetyViolations);
  const aggregateScore = correctnessScore * 0.4 + latencyScore * 0.2 + costScore * 0.2 + safetyScore * 0.2;
  return {
    correctnessScore,
    latencyScore,
    costScore,
    safetyScore,
    aggregateScore,
    passed: aggregateScore >= 0.75 && safetyScore >= 0.75
  };
}
