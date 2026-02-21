import type { ApprovalStore } from "../stores/approvalStore.js";
import type { ProviderStore } from "../stores/providerStore.js";
import type { RunStore } from "../stores/runStore.js";
import type { SettingsStore } from "../stores/settingsStore.js";
import type { TraceStore } from "../stores/traceStore.js";

export interface RouteContext {
  runs: RunStore;
  approvals: ApprovalStore;
  traces: TraceStore;
  providers: ProviderStore;
  settings: SettingsStore;
}

export interface RouteResult {
  status: number;
  body: unknown;
}
