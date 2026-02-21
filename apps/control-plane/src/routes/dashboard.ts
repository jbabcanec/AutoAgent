import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleDashboardRoute(pathname: string, method: string, ctx: RouteContext): RouteResult | undefined {
  if (pathname !== "/api/dashboard/stats" || method !== "GET") return undefined;

  const runs = ctx.runs.list();
  const approvals = ctx.approvals.list();
  return {
    status: 200,
    body: {
      totalRuns: runs.length,
      activeRuns: runs.filter((run) => run.status === "running" || run.status === "queued").length,
      completedRuns: runs.filter((run) => run.status === "completed").length,
      failedRuns: runs.filter((run) => run.status === "failed").length,
      pendingApprovals: approvals.filter((approval) => approval.status === "pending").length
    }
  };
}
