export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  jitterMs?: number;
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
      await wait(backoffDelayMs(options, attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operation failed after retries.");
}

export type RetryClass = "transient" | "provider" | "tool" | "policy" | "unknown";

export function classifyRetryError(errorMessage: string): RetryClass {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("denied by policy") || normalized.includes("egress")) return "policy";
  if (normalized.includes("api error") || normalized.includes("provider circuit")) return "provider";
  if (normalized.includes("exit ") || normalized.includes("tool")) return "tool";
  if (normalized.includes("timeout") || normalized.includes("network") || normalized.includes("temporarily")) return "transient";
  return "unknown";
}

export function retryPolicyFor(errorClass: RetryClass, stage: "llm" | "tool"): RetryOptions {
  if (stage === "llm") {
    if (errorClass === "transient") return { attempts: 4, baseDelayMs: 250, maxDelayMs: 2500, jitterMs: 80 };
    if (errorClass === "provider") return { attempts: 3, baseDelayMs: 500, maxDelayMs: 4000, jitterMs: 120 };
    if (errorClass === "policy") return { attempts: 1, baseDelayMs: 0 };
    return { attempts: 2, baseDelayMs: 400, maxDelayMs: 3000, jitterMs: 80 };
  }
  if (errorClass === "transient") return { attempts: 3, baseDelayMs: 200, maxDelayMs: 1200, jitterMs: 50 };
  if (errorClass === "tool") return { attempts: 2, baseDelayMs: 250, maxDelayMs: 1000, jitterMs: 50 };
  if (errorClass === "policy") return { attempts: 1, baseDelayMs: 0 };
  return { attempts: 2, baseDelayMs: 220, maxDelayMs: 1000, jitterMs: 40 };
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

function backoffDelayMs(options: RetryOptions, attempt: number): number {
  const maxDelay = options.maxDelayMs ?? options.baseDelayMs * 10;
  const exp = Math.min(maxDelay, options.baseDelayMs * 2 ** (attempt - 1));
  const jitter = options.jitterMs ? Math.floor(Math.random() * options.jitterMs) : 0;
  return exp + jitter;
}
