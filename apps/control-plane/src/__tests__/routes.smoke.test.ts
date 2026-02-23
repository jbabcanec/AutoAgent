import test from "node:test";
import assert from "node:assert/strict";
import { handleApprovalsRoute } from "../routes/approvals.js";
import { handleConversationThreadsRoute } from "../routes/conversationThreads.js";
import { handleDashboardRoute } from "../routes/dashboard.js";
import { handleExecutionStateRoute } from "../routes/executionState.js";
import { handleModelPerformanceRoute } from "../routes/modelPerformance.js";
import { handlePromotionsRoute } from "../routes/promotions.js";
import { handleProvidersRoute } from "../routes/providers.js";
import { handleRunsRoute } from "../routes/runs.js";
import { handleSettingsRoute } from "../routes/settings.js";
import { handleTracesRoute } from "../routes/traces.js";
import { handleUserPromptsRoute } from "../routes/userPrompts.js";
import { handleVerificationArtifactsRoute } from "../routes/verificationArtifacts.js";
import type { RouteContext } from "../routes/routeTypes.js";
import { ApprovalStore } from "../stores/approvalStore.js";
import { ConversationStore } from "../stores/conversationStore.js";
import { ExecutionStateStore } from "../stores/executionStateStore.js";
import { ModelPerformanceStore } from "../stores/modelPerformanceStore.js";
import { PromotionStore } from "../stores/promotionStore.js";
import { ProviderStore } from "../stores/providerStore.js";
import { RunStore } from "../stores/runStore.js";
import { SettingsStore } from "../stores/settingsStore.js";
import { TraceStore } from "../stores/traceStore.js";
import { UserPromptStore } from "../stores/userPromptStore.js";
import { VerificationArtifactStore } from "../stores/verificationArtifactStore.js";

function createContext(): RouteContext {
  return {
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
    promotions: new PromotionStore()
  };
}

test("dashboard stats route returns summary payload", () => {
  const ctx = createContext();
  const result = handleDashboardRoute("/api/dashboard/stats", "GET", ctx);
  assert.ok(result);
  assert.equal(result.status, 200);
  assert.equal(typeof (result.body as { totalRuns: number }).totalRuns, "number");
});

test("runs route creates and lists runs", () => {
  const ctx = createContext();
  const create = handleRunsRoute("/api/runs", "POST", { projectId: "p1", objective: "o1" }, ctx);
  assert.ok(create);
  assert.equal(create.status, 201);

  const list = handleRunsRoute("/api/runs", "GET", undefined, ctx);
  assert.ok(list);
  const runs = (list.body as { runs: Array<{ runId: string }> }).runs;
  assert.ok(runs.length >= 2);
});

test("settings route reads and updates requireApproval", () => {
  const ctx = createContext();
  const updated = handleSettingsRoute("/api/settings", "PUT", { requireApproval: false }, ctx);
  assert.ok(updated);
  assert.equal((updated.body as { requireApproval: boolean }).requireApproval, false);

  const reloaded = handleSettingsRoute("/api/settings", "GET", undefined, ctx);
  assert.ok(reloaded);
  assert.equal((reloaded.body as { requireApproval: boolean }).requireApproval, false);
});

test("providers route returns defaults", () => {
  const ctx = createContext();
  const result = handleProvidersRoute("/api/providers", "GET", undefined, ctx);
  assert.ok(result);
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body));
});

test("providers route supports create update and get with key metadata", () => {
  const ctx = createContext();
  const providerId = `smoke-provider-${Date.now()}`;
  const created = handleProvidersRoute(
    "/api/providers",
    "POST",
    {
      id: providerId,
      displayName: "Smoke Provider",
      kind: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
      apiKeyStored: true
    },
    ctx
  );
  assert.ok(created);
  assert.equal(created.status, 201);
  assert.equal((created.body as { apiKeyStored: boolean }).apiKeyStored, true);

  const updated = handleProvidersRoute(`/api/providers/${providerId}`, "PUT", { defaultModel: "gpt-4.1-mini" }, ctx);
  assert.ok(updated);
  assert.equal(updated.status, 200);

  const fetched = handleProvidersRoute(`/api/providers/${providerId}`, "GET", undefined, ctx);
  assert.ok(fetched);
  assert.equal(fetched.status, 200);
  assert.equal((fetched.body as { defaultModel: string }).defaultModel, "gpt-4.1-mini");
});

test("settings route stores onboarding completion metadata", () => {
  const ctx = createContext();
  const updated = handleSettingsRoute(
    "/api/settings",
    "PUT",
    {
      hasCompletedOnboarding: true,
      trialTaskCompleted: "both",
      onboardingCompletedAt: "2026-02-20T00:00:00.000Z"
    },
    ctx
  );
  assert.ok(updated);
  assert.equal(updated.status, 200);
  const payload = updated.body as { hasCompletedOnboarding: boolean; trialTaskCompleted: string };
  assert.equal(payload.hasCompletedOnboarding, true);
  assert.equal(payload.trialTaskCompleted, "both");
});

test("settings route updates retention and cleanup policy", () => {
  const ctx = createContext();
  const updated = handleSettingsRoute(
    "/api/settings",
    "PUT",
    {
      traceRetentionDays: 14,
      artifactRetentionDays: 21,
      promptRetentionDays: 10,
      cleanupIntervalMinutes: 5
    },
    ctx
  );
  assert.ok(updated);
  assert.equal(updated.status, 200);
  const payload = updated.body as {
    traceRetentionDays: number;
    artifactRetentionDays: number;
    promptRetentionDays: number;
    cleanupIntervalMinutes: number;
  };
  assert.equal(payload.traceRetentionDays, 14);
  assert.equal(payload.artifactRetentionDays, 21);
  assert.equal(payload.promptRetentionDays, 10);
  assert.equal(payload.cleanupIntervalMinutes, 5);
});

test("approval route supports tool-scoped approval lifecycle", () => {
  const ctx = createContext();
  const run = handleRunsRoute("/api/runs", "POST", { projectId: "p1", objective: "needs tool approval" }, ctx);
  assert.ok(run);
  const runId = (run.body as { runId: string }).runId;

  const created = handleApprovalsRoute(
    "/api/approvals",
    "POST",
    {
      runId,
      reason: "High-risk command requires confirmation",
      scope: "tool",
      toolName: "run_command",
      toolInput: { command: "git push origin main" }
    },
    ctx
  );
  assert.ok(created);
  assert.equal(created.status, 201);
  const approvalId = (created.body as { id: string }).id;

  const resolved = handleApprovalsRoute(`/api/approvals/${approvalId}/resolve`, "POST", { approved: true }, ctx);
  assert.ok(resolved);
  assert.equal((resolved.body as { status: string }).status, "approved");
});

test("approval route enforces context hash and expiration", () => {
  const ctx = createContext();
  const run = handleRunsRoute("/api/runs", "POST", { projectId: "p1", objective: "needs tool approval" }, ctx);
  assert.ok(run);
  const runId = (run.body as { runId: string }).runId;

  const created = handleApprovalsRoute(
    "/api/approvals",
    "POST",
    {
      runId,
      reason: "Context-bound approval",
      scope: "tool",
      toolName: "run_command",
      toolInput: { command: "echo ok" },
      contextHash: "abc123",
      expiresAt: new Date(Date.now() + 1_000).toISOString()
    },
    ctx
  );
  assert.ok(created);
  const approvalId = (created.body as { id: string }).id;
  const mismatch = handleApprovalsRoute(
    `/api/approvals/${approvalId}/resolve`,
    "POST",
    { approved: true, expectedContextHash: "different" },
    ctx
  );
  assert.ok(mismatch);
  assert.equal(mismatch.status, 409);
});

test("execution state route persists and clears checkpoints", () => {
  const ctx = createContext();
  const runId = "run-checkpoint-smoke";
  const upserted = handleExecutionStateRoute(
    `/api/execution-state/${runId}`,
    "PUT",
    {
      state: {
        phase: "checkpointed",
        phaseMarker: "executing",
        turn: 2,
        checkpoint: { reason: "tool_result", messageCount: 10 },
        replayBoundary: {
          turn: 2,
          reason: "tool_result",
          contextHash: "hash-1",
          createdAt: new Date().toISOString()
        }
      }
    },
    ctx
  );
  assert.ok(upserted);
  assert.equal(upserted.status, 200);

  const loaded = handleExecutionStateRoute(`/api/execution-state/${runId}`, "GET", undefined, ctx);
  assert.ok(loaded);
  assert.equal((loaded.body as { state: { phase: string } }).state.phase, "checkpointed");

  const cleared = handleExecutionStateRoute(`/api/execution-state/${runId}`, "DELETE", undefined, ctx);
  assert.ok(cleared);
  assert.equal(cleared.status, 200);
});

test("traces route returns aggregated run metrics", () => {
  const ctx = createContext();
  const run = handleRunsRoute("/api/runs", "POST", { projectId: "p2", objective: "metrics" }, ctx);
  assert.ok(run);
  const runId = (run.body as { runId: string }).runId;
  handleTracesRoute(`/api/traces/${runId}`, "POST", { eventType: "llm.turn", payload: { durationMs: 120, inputTokens: 100, outputTokens: 60 } }, ctx);
  handleTracesRoute(`/api/traces/${runId}`, "POST", { eventType: "agent.tool_result", payload: { durationMs: 80 } }, ctx);
  handleTracesRoute(`/api/traces/${runId}`, "POST", { eventType: "execution.retry", payload: { attempt: 1 } }, ctx);
  handleTracesRoute(
    `/api/traces/${runId}`,
    "POST",
    {
      eventType: "llm.response",
      payload: { totalInputTokens: 100, totalOutputTokens: 60, actionCount: 1, totalDuration: 500, estimatedCostUsd: 0.0012 }
    },
    ctx
  );

  const metrics = handleTracesRoute(`/api/traces/${runId}/metrics`, "GET", undefined, ctx);
  assert.ok(metrics);
  assert.equal(metrics.status, 200);
  assert.equal((metrics.body as { retries: number }).retries, 1);
});

test("model performance route records and returns aggregates", () => {
  const ctx = createContext();
  const created = handleModelPerformanceRoute(
    "/api/model-performance",
    "POST",
    {
      providerId: "openai-default",
      model: "gpt-4o-mini",
      routingMode: "balanced",
      success: true,
      latencyMs: 1200,
      estimatedCostUsd: 0.0012,
      aggregateScore: 0.88
    },
    ctx
  );
  assert.ok(created);
  assert.equal(created.status, 201);
  const list = handleModelPerformanceRoute("/api/model-performance/openai-default/balanced", "GET", undefined, ctx);
  assert.ok(list);
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body));
});

test("conversation threads and prompts route lifecycle", () => {
  const ctx = createContext();
  const run = handleRunsRoute("/api/runs", "POST", { projectId: "p3", objective: "threading" }, ctx);
  assert.ok(run);
  const runId = (run.body as { runId: string }).runId;
  const thread = handleConversationThreadsRoute("/api/threads", "POST", { runId, title: "Thread A" }, ctx);
  assert.ok(thread);
  assert.equal(thread.status, 201);
  const threadId = (thread.body as { threadId: string }).threadId;
  const appended = handleConversationThreadsRoute(`/api/threads/${threadId}/messages`, "POST", { role: "user", content: "hello", turnNumber: 1 }, ctx);
  assert.ok(appended);
  assert.equal(appended.status, 201);
  const prompt = handleUserPromptsRoute(
    "/api/prompts",
    "POST",
    { runId, threadId, promptText: "Choose framework?", turnNumber: 1 },
    ctx
  );
  assert.ok(prompt);
  assert.equal(prompt.status, 201);
  const promptId = (prompt.body as { promptId: string }).promptId;
  const answered = handleUserPromptsRoute(`/api/prompts/${promptId}/answer`, "POST", { responseText: "Use React" }, ctx);
  assert.ok(answered);
  assert.equal(answered.status, 200);
});

test("verification artifact and promotion routes", () => {
  const ctx = createContext();
  const run = handleRunsRoute("/api/runs", "POST", { projectId: "p4", objective: "promotion test" }, ctx);
  assert.ok(run);
  const runId = (run.body as { runId: string }).runId;

  const artifact = handleVerificationArtifactsRoute(
    "/api/artifacts",
    "POST",
    {
      runId,
      verificationType: "tool_outcome",
      artifactType: "log",
      verificationResult: "pass",
      artifactContent: "exit 0"
    },
    ctx
  );
  assert.ok(artifact);
  assert.equal(artifact.status, 201);

  const criteria = handlePromotionsRoute("/api/promotions/criteria", "GET", undefined, ctx);
  assert.ok(criteria);
  assert.equal(criteria.status, 200);
  const criterionId = ((criteria.body as Array<{ criterionId: string }>)[0] ?? { criterionId: "default-v1" }).criterionId;

  const evalResult = handlePromotionsRoute(
    "/api/promotions/evaluations",
    "POST",
    {
      runId,
      criterionId,
      aggregateScore: 0.91,
      safetyViolations: 0,
      verificationPassRate: 1,
      reason: "all checks passed"
    },
    ctx
  );
  assert.ok(evalResult);
  assert.equal(evalResult.status, 201);
});

test("promotion route blocks unsafe promotions with reject reasons", () => {
  const ctx = createContext();
  const run = handleRunsRoute("/api/runs", "POST", { projectId: "p5", objective: "promotion reject test" }, ctx);
  assert.ok(run);
  const runId = (run.body as { runId: string }).runId;
  const evalResult = handlePromotionsRoute(
    "/api/promotions/evaluations",
    "POST",
    {
      runId,
      criterionId: "default-v1",
      aggregateScore: 0.2,
      safetyViolations: 2,
      verificationPassRate: 0.1,
      reason: "forced reject"
    },
    ctx
  );
  assert.ok(evalResult);
  assert.equal(evalResult.status, 201);
  const payload = evalResult.body as { evaluationResult: string; rejectReasons?: string[] };
  assert.equal(payload.evaluationResult, "rejected");
  assert.ok(Array.isArray(payload.rejectReasons));
  assert.ok((payload.rejectReasons ?? []).length >= 1);
});

test("retention prune removes stale traces/prompts/artifacts", () => {
  const ctx = createContext();
  const run = handleRunsRoute("/api/runs", "POST", { projectId: "p-retention", objective: "retention" }, ctx);
  assert.ok(run);
  const runId = (run.body as { runId: string }).runId;

  handleTracesRoute(`/api/traces/${runId}`, "POST", { eventType: "llm.turn", payload: { durationMs: 10 } }, ctx);
  handleVerificationArtifactsRoute(
    "/api/artifacts",
    "POST",
    {
      runId,
      verificationType: "tool_outcome",
      artifactType: "log",
      verificationResult: "pass",
      artifactContent: "ok"
    },
    ctx
  );
  const prompt = handleUserPromptsRoute(
    "/api/prompts",
    "POST",
    { runId, turnNumber: 1, promptText: "Need answer?" },
    ctx
  );
  assert.ok(prompt);
  const promptId = (prompt.body as { promptId: string }).promptId;
  handleUserPromptsRoute(`/api/prompts/${promptId}/answer`, "POST", { responseText: "yes" }, ctx);

  const futureNow = Date.now() + 90 * 24 * 60 * 60 * 1000;
  assert.ok(ctx.traces.pruneOlderThan(30, futureNow) >= 1);
  assert.ok(ctx.verificationArtifacts.pruneOlderThan(30, futureNow) >= 1);
  assert.ok(ctx.userPrompts.pruneOlderThan(30, futureNow) >= 1);
});
