import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleRunsRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname === "/api/runs" && method === "GET") {
    return { status: 200, body: { runs: ctx.runs.list() } };
  }

  if (pathname === "/api/runs" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    const projectId = typeof payload.projectId === "string" ? payload.projectId : "local-project";
    const objective = typeof payload.objective === "string" ? payload.objective : "Local test objective";
    const run = ctx.runs.create({ projectId, objective });
    ctx.traces.append(run.runId, "run.created", { projectId, objective });
    return { status: 201, body: run };
  }

  if (pathname.startsWith("/api/runs/") && method === "GET") {
    const runId = pathname.replace("/api/runs/", "");
    const run = ctx.runs.get(runId);
    if (!run) return { status: 404, body: { error: "Run not found" } };
    return { status: 200, body: run };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
