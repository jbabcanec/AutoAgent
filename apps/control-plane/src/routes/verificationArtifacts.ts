import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleVerificationArtifactsRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname.startsWith("/api/artifacts/by-run/") && method === "GET") {
    const runId = pathname.replace("/api/artifacts/by-run/", "");
    return { status: 200, body: ctx.verificationArtifacts.listByRun(runId) };
  }

  if (pathname === "/api/artifacts" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    if (
      typeof payload.runId !== "string" ||
      typeof payload.verificationType !== "string" ||
      typeof payload.artifactType !== "string" ||
      typeof payload.verificationResult !== "string"
    ) {
      return { status: 400, body: { error: "runId, verificationType, artifactType, verificationResult are required" } };
    }
    const artifactContent = typeof payload.artifactContent === "string" ? payload.artifactContent : undefined;
    const checks = Array.isArray(payload.checks) ? (payload.checks as Array<{ check: string; passed: boolean; severity: "info" | "warn" | "error" }>) : undefined;
    const artifact = ctx.verificationArtifacts.create({
      runId: payload.runId,
      verificationType: payload.verificationType,
      artifactType: payload.artifactType,
      ...(artifactContent !== undefined ? { artifactContent } : {}),
      verificationResult: normalizeResult(payload.verificationResult),
      ...(checks !== undefined ? { checks } : {})
    });
    return { status: 201, body: artifact };
  }

  return undefined;
}

function normalizeResult(value: string): "pass" | "fail" | "warning" | "pending" {
  if (value === "pass" || value === "fail" || value === "warning" || value === "pending") return value;
  return "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
