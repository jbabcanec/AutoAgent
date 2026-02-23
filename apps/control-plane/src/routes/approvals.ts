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

  if (pathname === "/api/approvals" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    if (typeof payload.runId !== "string" || typeof payload.reason !== "string") {
      return { status: 400, body: { error: "runId and reason are required" } };
    }
    const toolName = typeof payload.toolName === "string" ? payload.toolName : undefined;
    const toolInput = isRecord(payload.toolInput) ? payload.toolInput : undefined;
    const expiresAt = typeof payload.expiresAt === "string" ? payload.expiresAt : undefined;
    const contextHash = typeof payload.contextHash === "string" ? payload.contextHash : undefined;
    const approval = ctx.approvals.create({
      runId: payload.runId,
      reason: payload.reason,
      scope: payload.scope === "tool" ? "tool" : "run",
      ...(toolName !== undefined ? { toolName } : {}),
      ...(toolInput !== undefined ? { toolInput } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(contextHash !== undefined ? { contextHash } : {})
    });
    ctx.traces.append(approval.runId, "approval.requested", {
      approvalId: approval.id,
      reason: approval.reason,
      scope: approval.scope,
      toolName: approval.toolName ?? null,
      expiresAt: approval.expiresAt ?? null
    });
    return { status: 201, body: approval };
  }

  if (pathname.startsWith("/api/approvals/") && pathname.endsWith("/resolve") && method === "POST") {
    const id = pathname.replace("/api/approvals/", "").replace("/resolve", "");
    const payload = isRecord(body) ? body : {};
    const approved = payload.approved === true;
    const expectedContextHash = typeof payload.expectedContextHash === "string" ? payload.expectedContextHash : undefined;
    const result = ctx.approvals.resolve(id, approved, expectedContextHash);
    if (!result.item) {
      if (result.error === "not_found") return { status: 404, body: { error: "Approval not found" } };
      if (result.error === "already_resolved") return { status: 409, body: { error: "Approval already resolved" } };
      if (result.error === "expired") return { status: 409, body: { error: "Approval expired" } };
      if (result.error === "context_mismatch") return { status: 409, body: { error: "Approval context mismatch" } };
      return { status: 400, body: { error: "Unable to resolve approval" } };
    }
    ctx.traces.append(result.item.runId, "approval.resolved", { approvalId: result.item.id, status: result.item.status });
    return { status: 200, body: result.item };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
