export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
}

export interface CircuitState {
  failures: number;
  openUntilMs: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
  onRetry: (attempt: number, error: string) => Promise<void>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= options.attempts) break;
      await onRetry(attempt, error instanceof Error ? error.message : "Unknown error");
      await wait(options.baseDelayMs * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operation failed after retries.");
}

export function guardCircuit(circuit: CircuitState, nowMs: number): void {
  if (circuit.openUntilMs > nowMs) {
    const seconds = Math.ceil((circuit.openUntilMs - nowMs) / 1000);
    throw new Error(`Provider circuit is open. Retry in ${seconds}s.`);
  }
}

export function recordCircuitSuccess(circuit: CircuitState): void {
  circuit.failures = 0;
  circuit.openUntilMs = 0;
}

export function recordCircuitFailure(circuit: CircuitState, nowMs: number): void {
  circuit.failures += 1;
  if (circuit.failures >= 3) {
    circuit.openUntilMs = nowMs + 30_000;
    circuit.failures = 0;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
