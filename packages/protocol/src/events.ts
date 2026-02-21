import type { ISO8601, ModelRequest, RunState, ToolInvocation, ToolResult, UUID } from "./contracts.js";

export type RunEventType =
  | "run.created"
  | "run.started"
  | "run.status.changed"
  | "run.completed"
  | "run.failed"
  | "model.requested"
  | "model.responded"
  | "tool.requested"
  | "tool.completed"
  | "approval.required"
  | "approval.resolved";

export interface RunEvent<TPayload> {
  eventId: UUID;
  runId: UUID;
  eventType: RunEventType;
  timestamp: ISO8601;
  payload: TPayload;
}

export type RunCreatedPayload = Pick<RunState, "runId" | "projectId" | "createdAt">;
export type RunStatusPayload = Pick<RunState, "status" | "updatedAt" | "summary">;
export type ModelRequestedPayload = Pick<ModelRequest, "providerId" | "model" | "metadata">;
export interface ModelRespondedPayload {
  outputTokens: number;
  latencyMs: number;
  finishReason: "stop" | "length" | "tool_use" | "error";
}
export type ToolRequestedPayload = ToolInvocation;
export type ToolCompletedPayload = ToolResult;

export type AnyRunEvent =
  | RunEvent<RunCreatedPayload>
  | RunEvent<RunStatusPayload>
  | RunEvent<ModelRequestedPayload>
  | RunEvent<ModelRespondedPayload>
  | RunEvent<ToolRequestedPayload>
  | RunEvent<ToolCompletedPayload>;
