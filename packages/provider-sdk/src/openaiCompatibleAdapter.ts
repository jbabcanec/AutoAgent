import type { CompletionRequest, CompletionResult, ProviderAdapter } from "./types.js";

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  public readonly kind = "openai-compatible" as const;

  public async complete(input: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        max_tokens: input.maxOutputTokens,
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

    const raw = (await response.json()) as OpenAIResponse;
    const choice = raw.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      finishReason: normalizeFinishReason(choice?.finish_reason),
      latencyMs: Date.now() - started,
      inputTokens: raw.usage?.prompt_tokens,
      outputTokens: raw.usage?.completion_tokens,
      raw
    };
  }
}

function normalizeFinishReason(value: string | undefined): CompletionResult["finishReason"] {
  if (value === "length") return "length";
  if (value === "tool_calls") return "tool_use";
  if (value === "stop") return "stop";
  return "error";
}
