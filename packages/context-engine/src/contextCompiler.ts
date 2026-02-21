import { estimateTokens } from "./tokenEstimator.js";
import { compressHistory } from "./historyCompression.js";
import { persistHistory } from "./historyStore.js";
import type { ContextCompileInput, ContextCompileOutput, DocumentChunk } from "./types.js";

const SYSTEM_OVERHEAD_TOKENS = 400;
const HISTORY_BUDGET_RATIO = 0.2;

export function compileContext(input: ContextCompileInput): ContextCompileOutput {
  const available = Math.max(0, input.tokenBudget - SYSTEM_OVERHEAD_TOKENS);
  const historyBudget = Math.floor(available * HISTORY_BUDGET_RATIO);
  const chunkBudget = available - historyBudget;

  const selectedHistory = compressHistory(input.history, historyBudget);
  const selectedChunks = fitChunks(input.candidateChunks, chunkBudget);
  persistHistory("default", selectedHistory);

  const prompt = buildPrompt(input.objective, selectedHistory, selectedChunks);
  return {
    selectedChunks,
    selectedHistory,
    prompt,
    tokenEstimate: estimateTokens(prompt)
  };
}

function fitChunks(chunks: DocumentChunk[], budget: number): DocumentChunk[] {
  const selected: DocumentChunk[] = [];
  let total = 0;
  for (const chunk of chunks) {
    if (total + chunk.tokensEstimate > budget) continue;
    selected.push(chunk);
    total += chunk.tokensEstimate;
  }
  return selected;
}

function buildPrompt(objective: string, history: ContextCompileOutput["selectedHistory"], chunks: DocumentChunk[]): string {
  const header = `Objective:\n${objective}\n`;
  const historySection = history
    .map((turn, index) => `History ${index + 1} [${turn.role}]:\n${turn.content}`)
    .join("\n\n");
  const chunkSection = chunks
    .map((chunk, index) => `Chunk ${index + 1} (${chunk.path}:${chunk.startLine}-${chunk.endLine}):\n${chunk.content}`)
    .join("\n\n");
  return [header, "Relevant History:", historySection || "(none)", "Relevant Context:", chunkSection || "(none)"].join("\n\n");
}
