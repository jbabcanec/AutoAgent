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
    transientRetries: number;
    providerRetries: number;
    toolRetries: number;
    policyRetries: number;
    unknownRetries: number;
    approvalsRequested: number;
    approvalsResolved: number;
    providerLatencyMs: number;
    toolLatencyMs: number;
    executionDurationMs: number;
    estimatedCostUsd: number;
    safetyViolations: number;
    validationFailures: number;
    egressDenied: number;
    verificationPassed: number;
    verificationFailed: number;
    planningEvents: number;
    reflectionEvents: number;
    cacheHits: number;
    cacheMisses: number;
  } {
    const traces = this.listByRun(runId);
    let tokenInput = 0;
    let tokenOutput = 0;
    let actionCount = 0;
    let retries = 0;
    let transientRetries = 0;
    let providerRetries = 0;
    let toolRetries = 0;
    let policyRetries = 0;
    let unknownRetries = 0;
    let approvalsRequested = 0;
    let approvalsResolved = 0;
    let providerLatencyMs = 0;
    let toolLatencyMs = 0;
    let executionDurationMs = 0;
    let estimatedCostUsd = 0;
    let safetyViolations = 0;
    let validationFailures = 0;
    let egressDenied = 0;
    let verificationPassed = 0;
    let verificationFailed = 0;
    let planningEvents = 0;
    let reflectionEvents = 0;
    let cacheHits = 0;
    let cacheMisses = 0;

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
        const errorClass = String(trace.payload.errorClass ?? "unknown");
        if (errorClass === "transient") transientRetries += 1;
        else if (errorClass === "provider") providerRetries += 1;
        else if (errorClass === "tool") toolRetries += 1;
        else if (errorClass === "policy") policyRetries += 1;
        else unknownRetries += 1;
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
      if (trace.eventType === "execution.validation") {
        if (trace.payload.ok === true) verificationPassed += 1;
        if (trace.payload.ok === false) verificationFailed += 1;
      }
      if (trace.eventType === "execution.plan") planningEvents += 1;
      if (trace.eventType === "execution.reflection") reflectionEvents += 1;
      if (trace.eventType === "execution.cache_hit") cacheHits += 1;
      if (trace.eventType === "execution.cache_miss") cacheMisses += 1;
    }

    return {
      runId,
      eventCount: traces.length,
      tokenInput,
      tokenOutput,
      tokenTotal: tokenInput + tokenOutput,
      actionCount,
      retries,
      transientRetries,
      providerRetries,
      toolRetries,
      policyRetries,
      unknownRetries,
      approvalsRequested,
      approvalsResolved,
      providerLatencyMs,
      toolLatencyMs,
      executionDurationMs,
      estimatedCostUsd,
      safetyViolations,
      validationFailures,
      egressDenied,
      verificationPassed,
      verificationFailed,
      planningEvents,
      reflectionEvents,
      cacheHits,
      cacheMisses
    };
  }

  public pruneOlderThan(days: number, nowMs = Date.now()): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare("DELETE FROM traces WHERE timestamp < ?").run(cutoff);
    return result.changes;
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
