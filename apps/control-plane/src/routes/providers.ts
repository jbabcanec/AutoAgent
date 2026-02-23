import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleProvidersRoute(pathname: string, method: string, body: unknown, ctx: RouteContext): RouteResult | undefined {
  if (pathname === "/api/providers" && method === "GET") {
    return { status: 200, body: ctx.providers.list() };
  }

  if (pathname.startsWith("/api/providers/") && method === "GET") {
    const id = pathname.replace("/api/providers/", "");
    const provider = ctx.providers.get(id);
    if (!provider) return { status: 404, body: { error: "Provider not found" } };
    return { status: 200, body: provider };
  }

  if (pathname === "/api/providers" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    const id = typeof payload.id === "string" && payload.id.trim() ? payload.id : `provider-${Date.now()}`;
    const provider = ctx.providers.create({
      id,
      displayName: typeof payload.displayName === "string" ? payload.displayName : "Custom Provider",
      kind: normalizeKind(payload.kind),
      baseUrl: typeof payload.baseUrl === "string" ? payload.baseUrl : "https://api.openai.com/v1",
      defaultModel: typeof payload.defaultModel === "string" ? payload.defaultModel : undefined,
      apiKeyStored: payload.apiKeyStored === true
    });
    return { status: 201, body: provider };
  }

  if (pathname.startsWith("/api/providers/") && method === "PUT") {
    const id = pathname.replace("/api/providers/", "");
    const payload = isRecord(body) ? body : {};
    const updates: Partial<{
      displayName: string;
      kind: "openai-compatible" | "anthropic-compatible" | "custom";
      baseUrl: string;
      defaultModel: string;
      apiKeyStored: boolean;
    }> = {};
    if (typeof payload.displayName === "string") updates.displayName = payload.displayName;
    if (payload.kind) updates.kind = normalizeKind(payload.kind);
    if (typeof payload.baseUrl === "string") updates.baseUrl = payload.baseUrl;
    if (typeof payload.defaultModel === "string") updates.defaultModel = payload.defaultModel;
    if (typeof payload.apiKeyStored === "boolean") updates.apiKeyStored = payload.apiKeyStored;
    const updated = ctx.providers.update(id, updates);
    if (!updated) return { status: 404, body: { error: "Provider not found" } };
    return { status: 200, body: updated };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeKind(value: unknown): "openai-compatible" | "anthropic-compatible" | "custom" {
  if (value === "anthropic-compatible" || value === "custom") return value;
  return "openai-compatible";
}
