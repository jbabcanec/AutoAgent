import type { BenchmarkResult, CandidateConfig } from "./types.js";

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

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
