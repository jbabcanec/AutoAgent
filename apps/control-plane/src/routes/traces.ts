import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleTracesRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname.startsWith("/api/traces/") && method === "GET") {
    if (pathname.endsWith("/metrics")) {
      const runId = pathname.replace("/api/traces/", "").replace("/metrics", "");
      return { status: 200, body: ctx.traces.metricsByRun(runId) };
    }
    const runId = pathname.replace("/api/traces/", "");
    return { status: 200, body: ctx.traces.listByRun(runId) };
  }

  if (pathname.startsWith("/api/traces/") && method === "POST") {
    const runId = pathname.replace("/api/traces/", "");
    const payload = isRecord(body) ? body : {};
    const eventType = typeof payload.eventType === "string" ? payload.eventType : "unknown";
    const payloadData = isRecord(payload.payload) ? payload.payload : {};
    ctx.traces.append(runId, eventType, payloadData);
    return { status: 201, body: { ok: true } };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
