import type { RouteContext, RouteResult } from "./routeTypes.js";
import type { SettingsItem } from "../types.js";

export function handleSettingsRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname === "/api/settings" && method === "GET") {
    return { status: 200, body: ctx.settings.get() };
  }

  if (pathname === "/api/settings" && method === "PUT") {
    const payload = isRecord(body) ? body : {};
    const updates: Partial<SettingsItem> = {};
    if (typeof payload.requireApproval === "boolean") updates.requireApproval = payload.requireApproval;
    if (typeof payload.hasCompletedOnboarding === "boolean") {
      updates.hasCompletedOnboarding = payload.hasCompletedOnboarding;
    }
    if (
      payload.trialTaskCompleted === "chat" ||
      payload.trialTaskCompleted === "repo" ||
      payload.trialTaskCompleted === "both" ||
      payload.trialTaskCompleted === "none"
    ) {
      updates.trialTaskCompleted = payload.trialTaskCompleted;
    }
    if (typeof payload.onboardingCompletedAt === "string") {
      updates.onboardingCompletedAt = payload.onboardingCompletedAt;
    }
    if (typeof payload.maxTokens === "number" && payload.maxTokens > 0) {
      updates.maxTokens = payload.maxTokens;
    }
    if (
      payload.routingMode === "balanced" ||
      payload.routingMode === "latency" ||
      payload.routingMode === "quality" ||
      payload.routingMode === "cost"
    ) {
      updates.routingMode = payload.routingMode;
    }
    if (payload.egressPolicyMode === "off" || payload.egressPolicyMode === "audit" || payload.egressPolicyMode === "enforce") {
      updates.egressPolicyMode = payload.egressPolicyMode;
    }
    if (Array.isArray(payload.egressAllowHosts)) {
      updates.egressAllowHosts = payload.egressAllowHosts.filter((value): value is string => typeof value === "string");
    }
    if (typeof payload.traceRetentionDays === "number" && payload.traceRetentionDays > 0) {
      updates.traceRetentionDays = payload.traceRetentionDays;
    }
    if (typeof payload.artifactRetentionDays === "number" && payload.artifactRetentionDays > 0) {
      updates.artifactRetentionDays = payload.artifactRetentionDays;
    }
    if (typeof payload.promptRetentionDays === "number" && payload.promptRetentionDays > 0) {
      updates.promptRetentionDays = payload.promptRetentionDays;
    }
    if (typeof payload.cleanupIntervalMinutes === "number" && payload.cleanupIntervalMinutes > 0) {
      updates.cleanupIntervalMinutes = payload.cleanupIntervalMinutes;
    }
    return {
      status: 200,
      body: ctx.settings.update(updates)
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
