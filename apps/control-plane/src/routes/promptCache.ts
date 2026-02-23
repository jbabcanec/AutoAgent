import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handlePromptCacheRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (!pathname.startsWith("/api/prompt-cache/")) return undefined;
  const key = pathname.replace("/api/prompt-cache/", "");
  if (!key) return { status: 400, body: { error: "Cache key is required" } };

  if (method === "GET") {
    const entry = ctx.promptCache.get(key);
    if (!entry) return { status: 200, body: { hit: false } };
    return {
      status: 200,
      body: {
        hit: true,
        value: entry.value,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        hitCount: entry.hitCount
      }
    };
  }

  if (method === "POST") {
    const payload = isRecord(body) ? body : {};
    ctx.promptCache.put(key, payload.value ?? null);
    return { status: 201, body: { ok: true } };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
