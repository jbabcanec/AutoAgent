import type { ApprovalStore } from "../stores/approvalStore.js";
import type { ConversationStore } from "../stores/conversationStore.js";
import type { ExecutionStateStore } from "../stores/executionStateStore.js";
import type { ModelPerformanceStore } from "../stores/modelPerformanceStore.js";
import type { PromotionStore } from "../stores/promotionStore.js";
import type { ProviderStore } from "../stores/providerStore.js";
import type { RunStore } from "../stores/runStore.js";
import type { SettingsStore } from "../stores/settingsStore.js";
import type { TraceStore } from "../stores/traceStore.js";
import type { UserPromptStore } from "../stores/userPromptStore.js";
import type { VerificationArtifactStore } from "../stores/verificationArtifactStore.js";

export interface RouteContext {
  runs: RunStore;
  approvals: ApprovalStore;
  executionState: ExecutionStateStore;
  traces: TraceStore;
  providers: ProviderStore;
  settings: SettingsStore;
  modelPerformance: ModelPerformanceStore;
  conversations: ConversationStore;
  userPrompts: UserPromptStore;
  verificationArtifacts: VerificationArtifactStore;
  promotions: PromotionStore;
}

export interface RouteResult {
  status: number;
  body: unknown;
}
