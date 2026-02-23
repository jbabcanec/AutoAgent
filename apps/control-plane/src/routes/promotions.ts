import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handlePromotionsRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname === "/api/promotions/criteria" && method === "GET") {
    return { status: 200, body: ctx.promotions.listCriteria() };
  }

  if (pathname === "/api/promotions/evaluations" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    if (
      typeof payload.runId !== "string" ||
      typeof payload.criterionId !== "string" ||
      typeof payload.aggregateScore !== "number" ||
      typeof payload.safetyViolations !== "number" ||
      typeof payload.verificationPassRate !== "number"
    ) {
      return { status: 400, body: { error: "runId, criterionId, aggregateScore, safetyViolations, verificationPassRate are required" } };
    }
    const latencyMs = typeof payload.latencyMs === "number" ? payload.latencyMs : undefined;
    const estimatedCostUsd = typeof payload.estimatedCostUsd === "number" ? payload.estimatedCostUsd : undefined;
    const evaluation = ctx.promotions.recordEvaluation({
      runId: payload.runId,
      criterionId: payload.criterionId,
      aggregateScore: payload.aggregateScore,
      safetyViolations: payload.safetyViolations,
      verificationPassRate: payload.verificationPassRate,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
      reason: typeof payload.reason === "string" ? payload.reason : "Runtime quality gate evaluation"
    });
    return { status: 201, body: evaluation };
  }

  if (pathname.startsWith("/api/promotions/criteria/") && method === "PUT") {
    const criterionId = pathname.replace("/api/promotions/criteria/", "");
    const payload = isRecord(body) ? body : {};
    const criterionUpdates: Partial<{
      minAggregateScore: number;
      maxSafetyViolations: number;
      minVerificationPassRate: number;
      maxLatencyMs: number;
      maxEstimatedCostUsd: number;
      active: boolean;
    }> = {};
    if (typeof payload.minAggregateScore === "number") criterionUpdates.minAggregateScore = payload.minAggregateScore;
    if (typeof payload.maxSafetyViolations === "number") criterionUpdates.maxSafetyViolations = payload.maxSafetyViolations;
    if (typeof payload.minVerificationPassRate === "number") criterionUpdates.minVerificationPassRate = payload.minVerificationPassRate;
    if (typeof payload.maxLatencyMs === "number") criterionUpdates.maxLatencyMs = payload.maxLatencyMs;
    if (typeof payload.maxEstimatedCostUsd === "number") criterionUpdates.maxEstimatedCostUsd = payload.maxEstimatedCostUsd;
    if (typeof payload.active === "boolean") criterionUpdates.active = payload.active;
    const updated = ctx.promotions.updateCriterion(criterionId, criterionUpdates);
    if (!updated) {
      return { status: 404, body: { error: "Promotion criterion not found" } };
    }
    return { status: 200, body: updated };
  }

  if (pathname.startsWith("/api/runs/") && pathname.endsWith("/promotion-status") && method === "GET") {
    const runId = pathname.replace("/api/runs/", "").replace("/promotion-status", "");
    return { status: 200, body: ctx.promotions.latestByRun(runId) ?? null };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
