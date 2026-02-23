import type { RouteContext, RouteResult } from "./routeTypes.js";

export function handleConversationThreadsRoute(
  pathname: string,
  method: string,
  body: unknown,
  ctx: RouteContext
): RouteResult | undefined {
  if (pathname.startsWith("/api/threads/by-run/") && method === "GET") {
    const runId = pathname.replace("/api/threads/by-run/", "");
    const thread = ctx.conversations.getThreadByRun(runId);
    return { status: 200, body: thread ?? null };
  }

  if (pathname === "/api/threads" && method === "POST") {
    const payload = isRecord(body) ? body : {};
    if (typeof payload.runId !== "string") {
      return { status: 400, body: { error: "runId is required" } };
    }
    const parentThreadId = typeof payload.parentThreadId === "string" ? payload.parentThreadId : undefined;
    const title = typeof payload.title === "string" ? payload.title : undefined;
    const metadata = isRecord(payload.metadata) ? payload.metadata : undefined;
    const thread = ctx.conversations.createThread({
      runId: payload.runId,
      ...(parentThreadId !== undefined ? { parentThreadId } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(metadata !== undefined ? { metadata } : {})
    });
    return { status: 201, body: thread };
  }

  if (pathname.startsWith("/api/threads/") && pathname.endsWith("/messages") && method === "GET") {
    const threadId = pathname.replace("/api/threads/", "").replace("/messages", "");
    return { status: 200, body: ctx.conversations.listMessages(threadId) };
  }

  if (pathname.startsWith("/api/threads/") && pathname.endsWith("/messages") && method === "POST") {
    const threadId = pathname.replace("/api/threads/", "").replace("/messages", "");
    const payload = isRecord(body) ? body : {};
    if (typeof payload.role !== "string" || typeof payload.content !== "string") {
      return { status: 400, body: { error: "role and content are required" } };
    }
    const role = payload.role === "system" || payload.role === "assistant" || payload.role === "tool" ? payload.role : "user";
    const msgMetadata = isRecord(payload.metadata) ? payload.metadata : undefined;
    const message = ctx.conversations.appendMessage({
      threadId,
      role,
      content: payload.content,
      turnNumber: typeof payload.turnNumber === "number" ? payload.turnNumber : 0,
      ...(msgMetadata !== undefined ? { metadata: msgMetadata } : {})
    });
    return { status: 201, body: message };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
