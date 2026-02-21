export type ProviderKind = "openai-compatible" | "anthropic-compatible" | "custom";

export interface CompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface CompletionRequest {
  providerId: string;
  providerKind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: CompletionMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, string>;
}

export interface CompletionResult {
  text: string;
  finishReason: "stop" | "length" | "tool_use" | "error";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  raw: unknown;
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  complete(input: CompletionRequest): Promise<CompletionResult>;
}
