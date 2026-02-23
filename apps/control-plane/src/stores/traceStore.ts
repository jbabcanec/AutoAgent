import { getControlPlaneDatabase } from "../database.js";
import type { TraceItem } from "../types.js";

export class TraceStore {
  private readonly db = getControlPlaneDatabase();

  public append(runId: string, eventType: string, payload: Record<string, unknown>): void {
    this.db
      .prepare("INSERT INTO traces (run_id, timestamp, event_type, payload_json) VALUES (?, ?, ?, ?)")
      .run(runId, new Date().toISOString(), eventType, JSON.stringify(payload));
  }

  public listByRun(runId: string): TraceItem[] {
    const rows = this.db
      .prepare("SELECT run_id, timestamp, event_type, payload_json FROM traces WHERE run_id = ? ORDER BY id ASC")
      .all(runId) as Array<{
      run_id: string;
      timestamp: string;
      event_type: string;
      payload_json: string;
    }>;
    return rows.map((row) => ({
      runId: row.run_id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      payload: parsePayload(row.payload_json)
    }));
  }

  public metricsByRun(runId: string): {
    runId: string;
    eventCount: number;
    tokenInput: number;
    tokenOutput: number;
    tokenTotal: number;
    actionCount: number;
    retries: number;
    approvalsRequested: number;
    approvalsResolved: number;
    providerLatencyMs: number;
    toolLatencyMs: number;
    executionDurationMs: number;
    estimatedCostUsd: number;
    safetyViolations: number;
    validationFailures: number;
    egressDenied: number;
  } {
    const traces = this.listByRun(runId);
    let tokenInput = 0;
    let tokenOutput = 0;
    let actionCount = 0;
    let retries = 0;
    let approvalsRequested = 0;
    let approvalsResolved = 0;
    let providerLatencyMs = 0;
    let toolLatencyMs = 0;
    let executionDurationMs = 0;
    let estimatedCostUsd = 0;
    let safetyViolations = 0;
    let validationFailures = 0;
    let egressDenied = 0;

    for (const trace of traces) {
      if (trace.eventType === "llm.response") {
        tokenInput += numeric(trace.payload.totalInputTokens);
        tokenOutput += numeric(trace.payload.totalOutputTokens);
        actionCount += numeric(trace.payload.actionCount);
        executionDurationMs = Math.max(executionDurationMs, numeric(trace.payload.totalDuration));
        estimatedCostUsd += numeric(trace.payload.estimatedCostUsd);
      }
      if (trace.eventType === "llm.turn") {
        providerLatencyMs += numeric(trace.payload.durationMs);
        tokenInput += numeric(trace.payload.inputTokens);
        tokenOutput += numeric(trace.payload.outputTokens);
      }
      if (trace.eventType === "agent.tool_result") {
        toolLatencyMs += numeric(trace.payload.durationMs);
      }
      if (trace.eventType === "execution.retry") {
        retries += 1;
      }
      if (trace.eventType === "approval.requested") {
        approvalsRequested += 1;
      }
      if (trace.eventType === "approval.resolved") {
        approvalsResolved += 1;
      }
      if (trace.eventType === "execution.quality") {
        safetyViolations += numeric(trace.payload.safetyViolations);
        validationFailures += numeric(trace.payload.validationFailures);
      }
      if (trace.eventType === "execution.egress_decision" && trace.payload.decision === "deny") {
        egressDenied += 1;
      }
    }

    return {
      runId,
      eventCount: traces.length,
      tokenInput,
      tokenOutput,
      tokenTotal: tokenInput + tokenOutput,
      actionCount,
      retries,
      approvalsRequested,
      approvalsResolved,
      providerLatencyMs,
      toolLatencyMs,
      executionDurationMs,
      estimatedCostUsd,
      safetyViolations,
      validationFailures,
      egressDenied
    };
  }
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
