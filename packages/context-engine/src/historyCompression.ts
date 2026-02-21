import { estimateTokens } from "./tokenEstimator.js";
import type { HistoryTurn } from "./types.js";

export function compressHistory(history: HistoryTurn[], maxTokens: number): HistoryTurn[] {
  const sorted = [...history].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const selected: HistoryTurn[] = [];
  let total = 0;
  for (const turn of sorted) {
    const tokens = estimateTokens(turn.content);
    if (total + tokens > maxTokens) continue;
    selected.push(turn);
    total += tokens;
  }
  return selected;
}
