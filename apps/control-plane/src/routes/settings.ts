import type { RouteContext, RouteResult } from "./routeTypes.js";

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
    const requireApproval = payload.requireApproval;
    if (typeof requireApproval !== "boolean") {
      return { status: 400, body: { error: "requireApproval must be boolean" } };
    }
    return { status: 200, body: ctx.settings.update({ requireApproval }) };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
