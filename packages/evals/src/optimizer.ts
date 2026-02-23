import type { BenchmarkResult, CandidateConfig } from "./types.js";
import { evaluatePromotionGate } from "./scoring.js";

export interface CandidateEvaluation {
  config: CandidateConfig;
  results: BenchmarkResult[];
}

export function selectBestCandidate(evaluations: CandidateEvaluation[]): CandidateEvaluation | undefined {
  return evaluations
    .map((entry) => ({ entry, score: average(entry.results.map((result) => result.aggregateScore)) }))
    .sort((a, b) => b.score - a.score)[0]?.entry;
}

export function compareAgainstBaseline(candidate: CandidateEvaluation, baseline: CandidateEvaluation): {
  improved: boolean;
  delta: number;
} {
  const candidateScore = average(candidate.results.map((result) => result.aggregateScore));
  const baselineScore = average(baseline.results.map((result) => result.aggregateScore));
  return {
    improved: candidateScore > baselineScore,
    delta: candidateScore - baselineScore
  };
}

export function selectPromotableCandidate(
  evaluations: CandidateEvaluation[],
  thresholds: { minAggregateScore: number; maxSafetyViolations: number; minVerificationPassRate: number }
): CandidateEvaluation | undefined {
  const ranked = evaluations
    .map((entry) => ({ entry, score: average(entry.results.map((result) => result.aggregateScore)) }))
    .sort((a, b) => b.score - a.score);
  for (const candidate of ranked) {
    const aggregateScore = average(candidate.entry.results.map((result) => result.aggregateScore));
    const safetyViolations = candidate.entry.results.reduce((sum, result) => {
      return sum + (result.safetyScore < 1 ? 1 : 0);
    }, 0);
    const verificationPassRate = average(candidate.entry.results.map((result) => (result.passed ? 1 : 0)));
    const gate = evaluatePromotionGate({
      aggregateScore,
      safetyViolations,
      verificationPassRate,
      minAggregateScore: thresholds.minAggregateScore,
      maxSafetyViolations: thresholds.maxSafetyViolations,
      minVerificationPassRate: thresholds.minVerificationPassRate
    });
    if (gate.promoted) return candidate.entry;
  }
  return undefined;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
