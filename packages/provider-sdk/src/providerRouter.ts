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
        estimatedCostUsd: 0,
        selectedModel: request.model,
        raw: null
      };
    }
    const selectedModel = selectModelForRouting(request);
    const result = await adapter.complete({ ...request, model: selectedModel });
    return {
      ...result,
      selectedModel,
      estimatedCostUsd:
        result.estimatedCostUsd ??
        estimateCostUsd(request.providerKind, selectedModel, result.inputTokens ?? 0, result.outputTokens ?? 0)
    };
  }
}

function selectModelForRouting(request: CompletionRequest): string {
  const mode = request.routingMode ?? "balanced";
  const fromHistory = selectModelFromMetadata(request, mode);
  if (fromHistory) return fromHistory;
  if (mode === "latency") return request.model.includes("mini") ? request.model : `${request.model}-mini`;
  if (mode === "quality") return request.model.includes("mini") ? request.model.replace("-mini", "") : request.model;
  if (mode === "cost") return request.model.includes("mini") ? request.model : `${request.model}-mini`;
  return request.model;
}

function selectModelFromMetadata(
  request: CompletionRequest,
  mode: "balanced" | "latency" | "quality" | "cost"
): string | undefined {
  const raw = request.metadata?.modelStatsJson;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Array<{
      model: string;
      successRate: number;
      avgLatencyMs: number;
      avgCostUsd: number;
      avgScore: number;
    }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const ranked = parsed.sort((a, b) => rankByMode(b, mode) - rankByMode(a, mode));
    return ranked[0]?.model;
  } catch {
    return undefined;
  }
}

function rankByMode(
  item: { successRate: number; avgLatencyMs: number; avgCostUsd: number; avgScore: number },
  mode: "balanced" | "latency" | "quality" | "cost"
): number {
  const success = item.successRate * 0.5;
  const quality = item.avgScore * 0.35;
  const latencyPenalty = Math.min(1, item.avgLatencyMs / 60_000) * 0.2;
  const costPenalty = Math.min(1, item.avgCostUsd / 0.1) * 0.2;
  if (mode === "latency") return success + quality - latencyPenalty * 1.5 - costPenalty * 0.25;
  if (mode === "cost") return success + quality - costPenalty * 1.5 - latencyPenalty * 0.25;
  if (mode === "quality") return success + quality * 1.5 - latencyPenalty * 0.2 - costPenalty * 0.2;
  return success + quality - latencyPenalty * 0.6 - costPenalty * 0.6;
}

function estimateCostUsd(providerKind: ProviderKind, model: string, inputTokens: number, outputTokens: number): number {
  const isMini = model.includes("mini");
  const inputRate = providerKind === "openai-compatible" ? (isMini ? 0.15 : 2.5) : isMini ? 0.2 : 3;
  const outputRate = providerKind === "openai-compatible" ? (isMini ? 0.6 : 10) : isMini ? 1 : 15;
  const inputCost = (inputTokens / 1_000_000) * inputRate;
  const outputCost = (outputTokens / 1_000_000) * outputRate;
  return Number((inputCost + outputCost).toFixed(6));
}
