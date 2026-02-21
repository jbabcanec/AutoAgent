import type { CompletionRequest, CompletionResult, ProviderAdapter } from "./types.js";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicCompatibleAdapter implements ProviderAdapter {
  public readonly kind = "anthropic-compatible" as const;

  public async complete(input: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages.filter((m) => m.role !== "system"),
        system: input.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n"),
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens ?? 1024,
        metadata: input.metadata
      })
    });

    if (!response.ok) {
      return {
        text: `Provider request failed with status ${response.status}`,
        finishReason: "error",
        latencyMs: Date.now() - started,
        raw: await response.text()
      };
    }

    const raw = (await response.json()) as AnthropicResponse;
    const text = raw.content?.find((item) => item.type === "text")?.text ?? "";
    return {
      text,
      finishReason: normalizeFinishReason(raw.stop_reason),
      latencyMs: Date.now() - started,
      inputTokens: raw.usage?.input_tokens,
      outputTokens: raw.usage?.output_tokens,
      raw
    };
  }
}

function normalizeFinishReason(value: string | undefined): CompletionResult["finishReason"] {
  if (value === "max_tokens") return "length";
  if (value === "tool_use") return "tool_use";
  if (value === "end_turn" || value === "stop_sequence") return "stop";
  return "error";
}
