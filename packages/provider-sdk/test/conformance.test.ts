import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRouter } from "../src/providerRouter.js";

type MockResponseInit = {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
};

function setMockFetch(init: MockResponseInit): void {
  globalThis.fetch = (async () =>
    ({
      ok: init.ok,
      status: init.status,
      async json() {
        return init.json;
      },
      async text() {
        return init.text ?? "";
      }
    })) as typeof fetch;
}

test("normalizes openai-compatible response", async () => {
  setMockFetch({
    ok: true,
    status: 200,
    json: {
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 }
    }
  });
  const router = new ProviderRouter();
  const result = await router.complete({
    providerId: "p1",
    providerKind: "openai-compatible",
    baseUrl: "https://api.example.com",
    apiKey: "test",
    model: "gpt-x",
    messages: [{ role: "user", content: "hi" }]
  });
  assert.equal(result.text, "hello");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.inputTokens, 10);
});

test("normalizes anthropic-compatible response", async () => {
  setMockFetch({
    ok: true,
    status: 200,
    json: {
      content: [{ type: "text", text: "world" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 3 }
    }
  });
  const router = new ProviderRouter();
  const result = await router.complete({
    providerId: "p2",
    providerKind: "anthropic-compatible",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "test",
    model: "claude-x",
    messages: [{ role: "user", content: "hi" }]
  });
  assert.equal(result.text, "world");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.outputTokens, 3);
});

test("maps provider errors to normalized failure result", async () => {
  setMockFetch({
    ok: false,
    status: 401,
    text: "unauthorized"
  });
  const router = new ProviderRouter();
  const result = await router.complete({
    providerId: "p3",
    providerKind: "openai-compatible",
    baseUrl: "https://api.example.com",
    apiKey: "bad",
    model: "gpt-x",
    messages: [{ role: "user", content: "hi" }]
  });
  assert.equal(result.finishReason, "error");
  assert.match(result.text, /401/);
});
