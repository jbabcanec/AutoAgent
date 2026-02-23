import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { handleApprovalsRoute } from "./routes/approvals.js";
import { handleConversationThreadsRoute } from "./routes/conversationThreads.js";
import { handleDashboardRoute } from "./routes/dashboard.js";
import { handleExecutionStateRoute } from "./routes/executionState.js";
import { handleModelPerformanceRoute } from "./routes/modelPerformance.js";
import { handlePromotionsRoute } from "./routes/promotions.js";
import { handlePromptCacheRoute } from "./routes/promptCache.js";
import { handleProvidersRoute } from "./routes/providers.js";
import { handleRunsRoute } from "./routes/runs.js";
import { handleSettingsRoute } from "./routes/settings.js";
import { handleTracesRoute } from "./routes/traces.js";
import { handleUserPromptsRoute } from "./routes/userPrompts.js";
import { handleVerificationArtifactsRoute } from "./routes/verificationArtifacts.js";
import type { RouteContext, RouteResult } from "./routes/routeTypes.js";
import { ApprovalStore } from "./stores/approvalStore.js";
import { ConversationStore } from "./stores/conversationStore.js";
import { ExecutionStateStore } from "./stores/executionStateStore.js";
import { ModelPerformanceStore } from "./stores/modelPerformanceStore.js";
import { PromotionStore } from "./stores/promotionStore.js";
import { ProviderStore } from "./stores/providerStore.js";
import { PromptCacheStore } from "./stores/promptCacheStore.js";
import { RunStore } from "./stores/runStore.js";
import { SettingsStore } from "./stores/settingsStore.js";
import { TraceStore } from "./stores/traceStore.js";
import { UserPromptStore } from "./stores/userPromptStore.js";
import { VerificationArtifactStore } from "./stores/verificationArtifactStore.js";

const ctx: RouteContext = {
  runs: new RunStore(),
  approvals: new ApprovalStore(),
  executionState: new ExecutionStateStore(),
  traces: new TraceStore(),
  providers: new ProviderStore(),
  settings: new SettingsStore(),
  modelPerformance: new ModelPerformanceStore(),
  conversations: new ConversationStore(),
  userPrompts: new UserPromptStore(),
  verificationArtifacts: new VerificationArtifactStore(),
  promotions: new PromotionStore(),
  promptCache: new PromptCacheStore()
};

let cleanupTimer: NodeJS.Timeout | undefined;

function runRetentionCleanup(): void {
  const settings = ctx.settings.get();
  const tracesPruned = ctx.traces.pruneOlderThan(settings.traceRetentionDays ?? 30);
  const artifactsPruned = ctx.verificationArtifacts.pruneOlderThan(settings.artifactRetentionDays ?? 30);
  const promptsPruned = ctx.userPrompts.pruneOlderThan(settings.promptRetentionDays ?? 30);
  const cachePruned = ctx.promptCache.pruneOlderThan(settings.promptCacheRetentionDays ?? 7);
  // eslint-disable-next-line no-console
  console.log(
    `[retention] traces=${tracesPruned} artifacts=${artifactsPruned} prompts=${promptsPruned} cache=${cachePruned} ` +
      `(days: ${settings.traceRetentionDays ?? 30}/${settings.artifactRetentionDays ?? 30}/${settings.promptRetentionDays ?? 30}/${settings.promptCacheRetentionDays ?? 7})`
  );
}

function scheduleRetentionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
  runRetentionCleanup();
  const settings = ctx.settings.get();
  const everyMinutes = Math.max(1, settings.cleanupIntervalMinutes ?? 15);
  cleanupTimer = setInterval(runRetentionCleanup, everyMinutes * 60 * 1000);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const value = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function route(pathname: string, method: string, body: unknown): RouteResult | undefined {
  return (
    handleDashboardRoute(pathname, method, ctx) ??
    handleRunsRoute(pathname, method, body, ctx) ??
    handleApprovalsRoute(pathname, method, body, ctx) ??
    handleConversationThreadsRoute(pathname, method, body, ctx) ??
    handleExecutionStateRoute(pathname, method, body, ctx) ??
    handleModelPerformanceRoute(pathname, method, body, ctx) ??
    handleUserPromptsRoute(pathname, method, body, ctx) ??
    handleVerificationArtifactsRoute(pathname, method, body, ctx) ??
    handlePromptCacheRoute(pathname, method, body, ctx) ??
    handlePromotionsRoute(pathname, method, body, ctx) ??
    handleTracesRoute(pathname, method, body, ctx) ??
    handleSettingsRoute(pathname, method, body, ctx) ??
    handleProvidersRoute(pathname, method, body, ctx)
  );
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", "http://localhost:8080");
  const method = req.method ?? "GET";
  const body = await readBody(req);

  const result = route(requestUrl.pathname, method, body);
  if (!result) {
    sendJson(res, 404, { error: "Route not found" });
    return;
  }
  sendJson(res, result.status, result.body);
});

const port = Number(process.env.PORT ?? "8080");
server.listen(port, () => {
  scheduleRetentionCleanup();
  // eslint-disable-next-line no-console
  console.log(`Control-plane listening on http://localhost:${port}`);
});
