import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleModelPerformanceRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname === "/api/model-performance" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    if (
      typeof payload.providerId !== "string" ||
      typeof payload.model !== "string" ||
      !isRoutingMode(payload.routingMode)
    ) {
      return { status: 400, body: { error: "providerId, model, and routingMode are required." } };
    }
    const item = ctx.modelPerformance.record({
      providerId: payload.providerId,
      model: payload.model,
      routingMode: payload.routingMode,
      success: payload.success === true,
      latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : 0,
      estimatedCostUsd: typeof payload.estimatedCostUsd === "number" ? payload.estimatedCostUsd : 0,
      aggregateScore: typeof payload.aggregateScore === "number" ? payload.aggregateScore : 0
    });
    return { status: 201, body: item };
  }

  if (pathname.startsWith("/api/model-performance/") && method === "GET") {
    const suffix = pathname.replace("/api/model-performance/", "");
    const [providerId, modeRaw] = suffix.split("/");
    if (!providerId || !isRoutingMode(modeRaw)) {
      return { status: 400, body: { error: "Use /api/model-performance/:providerId/:routingMode" } };
    }
    return {
      status: 200,
      body: ctx.modelPerformance.latestByProvider(providerId, modeRaw)
    };
  }

  return undefined;
}

function isRoutingMode(value: unknown): value is "balanced" | "latency" | "quality" | "cost" {
  return value === "balanced" || value === "latency" || value === "quality" || value === "cost";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
