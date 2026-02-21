import type { BenchmarkCase, BenchmarkResult } from "./types.js";
import { scoreRun } from "./scoring.js";

export interface BenchmarkExecutor {
  runCase(testCase: BenchmarkCase): Promise<{
    outputText: string;
    latencyMs: number;
    outputTokens: number;
    safetyViolations: number;
  }>;
}

export async function runBenchmarkSuite(cases: BenchmarkCase[], executor: BenchmarkExecutor): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  for (const testCase of cases) {
    const execution = await executor.runCase(testCase);
    results.push(
      scoreRun({
        benchmarkCase: testCase,
        ...execution
      })
    );
  }
  return results;
}
