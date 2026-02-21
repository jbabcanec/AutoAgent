import { AnthropicCompatibleAdapter } from "./anthropicCompatibleAdapter.js";
import { OpenAICompatibleAdapter } from "./openaiCompatibleAdapter.js";
import type { CompletionRequest, CompletionResult, ProviderAdapter, ProviderKind } from "./types.js";

export class ProviderRouter {
  private readonly adapters: Map<ProviderKind, ProviderAdapter>;

  public constructor() {
    this.adapters = new Map<ProviderKind, ProviderAdapter>([
      ["openai-compatible", new OpenAICompatibleAdapter()],
      ["anthropic-compatible", new AnthropicCompatibleAdapter()]
    ]);
  }

  public register(kind: ProviderKind, adapter: ProviderAdapter): void {
    this.adapters.set(kind, adapter);
  }

  public async complete(request: CompletionRequest): Promise<CompletionResult> {
    const adapter = this.adapters.get(request.providerKind);
    if (!adapter) {
      return {
        text: `No adapter registered for provider kind ${request.providerKind}`,
        finishReason: "error",
        latencyMs: 0,
        raw: null
      };
    }
    return adapter.complete(request);
  }
}
