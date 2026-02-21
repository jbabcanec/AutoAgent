import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleTracesRoute(pathname: string, method: string, ctx: RouteContext): RouteResult | undefined {
  if (!pathname.startsWith("/api/traces/") || method !== "GET") return undefined;
  const runId = pathname.replace("/api/traces/", "");
  return { status: 200, body: ctx.traces.listByRun(runId) };
}
