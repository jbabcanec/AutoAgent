import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleApprovalsRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname === "/api/approvals" && method === "GET") {
    return { status: 200, body: ctx.approvals.list() };
  }

  if (pathname.startsWith("/api/approvals/") && pathname.endsWith("/resolve") && method === "POST") {
    const id = pathname.replace("/api/approvals/", "").replace("/resolve", "");
    const payload = isRecord(body) ? body : {};
    const approved = payload.approved === true;
    const updated = ctx.approvals.resolve(id, approved);
    if (!updated) return { status: 404, body: { error: "Approval not found" } };
    ctx.traces.append(updated.runId, "approval.resolved", { approvalId: updated.id, status: updated.status });
    return { status: 200, body: updated };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
