export function estimateTokens(text: string): number {
  // A practical approximation for early budgeting. This can later be replaced with model-specific tokenizers.
  return Math.ceil(text.length / 4);
}
