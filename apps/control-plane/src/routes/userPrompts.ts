import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleUserPromptsRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname.startsWith("/api/prompts/by-run/") && method === "GET") {
    const runId = pathname.replace("/api/prompts/by-run/", "");
    return { status: 200, body: ctx.userPrompts.listByRun(runId) };
  }

  if (pathname === "/api/prompts" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    if (typeof payload.runId !== "string" || typeof payload.promptText !== "string") {
      return { status: 400, body: { error: "runId and promptText are required" } };
    }
    const threadId = typeof payload.threadId === "string" ? payload.threadId : undefined;
    const context = isRecord(payload.context) ? payload.context : undefined;
    const expiresAt = typeof payload.expiresAt === "string" ? payload.expiresAt : undefined;
    const prompt = ctx.userPrompts.create({
      runId: payload.runId,
      ...(threadId !== undefined ? { threadId } : {}),
      turnNumber: typeof payload.turnNumber === "number" ? payload.turnNumber : 0,
      promptText: payload.promptText,
      ...(context !== undefined ? { context } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {})
    });
    return { status: 201, body: prompt };
  }

  if (pathname.startsWith("/api/prompts/") && !pathname.endsWith("/answer") && method === "GET") {
    const promptId = pathname.replace("/api/prompts/", "");
    const prompt = ctx.userPrompts.get(promptId);
    if (!prompt) return { status: 404, body: { error: "Prompt not found" } };
    return { status: 200, body: prompt };
  }

  if (pathname.startsWith("/api/prompts/") && pathname.endsWith("/answer") && method === "POST") {
    const promptId = pathname.replace("/api/prompts/", "").replace("/answer", "");
    const payload = isRecord(body) ? body : {};
    if (typeof payload.responseText !== "string") {
      return { status: 400, body: { error: "responseText is required" } };
    }
    const updated = ctx.userPrompts.answer(promptId, payload.responseText);
    if (!updated) return { status: 404, body: { error: "Prompt not found" } };
    return { status: 200, body: updated };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
