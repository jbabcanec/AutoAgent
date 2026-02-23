export interface PersistedExecutionState {
  runId: string;
  phase: "created" | "approved" | "running" | "checkpointed" | "completed" | "failed" | "aborted";
  phaseMarker?: "planning" | "executing" | "awaiting_user" | "reflecting" | "finalizing";
  turn: number;
  input: {
    providerId?: string;
    directory?: string;
    objective?: string;
    threadId?: string;
  };
  stats: {
    actionCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    retries: number;
    validationFailures?: number;
    safetyViolations?: number;
  };
  checkpoint?: {
    at: string;
    reason: string;
    messageCount: number;
  };
  replayBoundary?: {
    turn: number;
    reason: string;
    contextHash: string;
    createdAt: string;
  };
  lastError?: string;
}

export async function loadExecutionState(
  requestJson: (pathname: string, init?: RequestInit) => Promise<unknown>,
  runId: string
): Promise<PersistedExecutionState | undefined> {
  try {
    const response = (await requestJson(`/api/execution-state/${encodeURIComponent(runId)}`)) as {
      runId: string;
      state: PersistedExecutionState;
    };
    return response.state;
  } catch {
    return undefined;
  }
}

export async function saveExecutionState(
  requestJson: (pathname: string, init?: RequestInit) => Promise<unknown>,
  runId: string,
  state: PersistedExecutionState
): Promise<void> {
  await requestJson(`/api/execution-state/${encodeURIComponent(runId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state })
  });
}

export async function clearExecutionState(
  requestJson: (pathname: string, init?: RequestInit) => Promise<unknown>,
  runId: string
): Promise<void> {
  await requestJson(`/api/execution-state/${encodeURIComponent(runId)}`, {
    method: "DELETE"
  });
}
