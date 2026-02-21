import test from "node:test";
import assert from "node:assert/strict";
import { handleDashboardRoute } from "../routes/dashboard.js";
import { handleProvidersRoute } from "../routes/providers.js";
import { handleRunsRoute } from "../routes/runs.js";
import { handleSettingsRoute } from "../routes/settings.js";
import type { RouteContext } from "../routes/routeTypes.js";
import { ApprovalStore } from "../stores/approvalStore.js";
import { ProviderStore } from "../stores/providerStore.js";
import { RunStore } from "../stores/runStore.js";
import { SettingsStore } from "../stores/settingsStore.js";
import { TraceStore } from "../stores/traceStore.js";

function createContext(): RouteContext {
  return {
    runs: new RunStore(),
    approvals: new ApprovalStore(),
    traces: new TraceStore(),
    providers: new ProviderStore(),
    settings: new SettingsStore()
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
  const initial = handleSettingsRoute("/api/settings", "GET", undefined, ctx);
  assert.ok(initial);
  assert.equal((initial.body as { requireApproval: boolean }).requireApproval, true);

  const updated = handleSettingsRoute("/api/settings", "PUT", { requireApproval: false }, ctx);
  assert.ok(updated);
  assert.equal((updated.body as { requireApproval: boolean }).requireApproval, false);
});

test("providers route returns defaults", () => {
  const ctx = createContext();
  const result = handleProvidersRoute("/api/providers", "GET", ctx);
  assert.ok(result);
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body));
});
