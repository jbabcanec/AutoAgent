export type HookEventName = "planning" | "tool_result" | "reflection";

export interface HookEventPayload {
  runId: string;
  event: HookEventName;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpAdapter {
  id: string;
  listTools(): Promise<McpToolDescriptor[]>;
  invokeTool(name: string, input: Record<string, unknown>): Promise<{
    ok: boolean;
    output: string;
  }>;
}

export interface ProjectAgentConfigContract {
  toolAllowlist?: string[];
  preferredModel?: string;
  maxTokens?: number;
  contextHistoryMaxMessages?: number;
  contextSummaryMaxChars?: number;
}
