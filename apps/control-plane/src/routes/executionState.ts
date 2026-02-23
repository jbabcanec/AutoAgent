import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleExecutionStateRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (!pathname.startsWith("/api/execution-state/")) return undefined;
  const runId = pathname.replace("/api/execution-state/", "");
  if (!runId) return { status: 400, body: { error: "runId is required" } };

  if (method === "GET") {
    const state = ctx.executionState.get(runId);
    if (!state) return { status: 404, body: { error: "Execution state not found" } };
    return { status: 200, body: state };
  }

  if (method === "PUT") {
    const payload = isRecord(body) ? body : {};
    const state = isRecord(payload.state) ? payload.state : payload;
    return { status: 200, body: ctx.executionState.upsert(runId, state) };
  }

  if (method === "DELETE") {
    ctx.executionState.clear(runId);
    return { status: 200, body: { cleared: true } };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
