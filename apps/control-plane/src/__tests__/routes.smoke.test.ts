import test from "node:test";
import assert from "node:assert/strict";
import { handleApprovalsRoute } from "../routes/approvals.js";
import { handleDashboardRoute } from "../routes/dashboard.js";
import { handleExecutionStateRoute } from "../routes/executionState.js";
import { handleModelPerformanceRoute } from "../routes/modelPerformance.js";
import { handleProvidersRoute } from "../routes/providers.js";
import { handleRunsRoute } from "../routes/runs.js";
import { handleSettingsRoute } from "../routes/settings.js";
import { handleTracesRoute } from "../routes/traces.js";
import type { RouteContext } from "../routes/routeTypes.js";
import { ApprovalStore } from "../stores/approvalStore.js";
import { ExecutionStateStore } from "../stores/executionStateStore.js";
import { ModelPerformanceStore } from "../stores/modelPerformanceStore.js";
import { ProviderStore } from "../stores/providerStore.js";
import { RunStore } from "../stores/runStore.js";
import { SettingsStore } from "../stores/settingsStore.js";
import { TraceStore } from "../stores/traceStore.js";

function createContext(): RouteContext {
  return {
    runs: new RunStore(),
    approvals: new ApprovalStore(),
    executionState: new ExecutionStateStore(),
    traces: new TraceStore(),
    providers: new ProviderStore(),
    settings: new SettingsStore(),
    modelPerformance: new ModelPerformanceStore()
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
        turn: 2,
        checkpoint: { reason: "tool_result", messageCount: 10 }
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
