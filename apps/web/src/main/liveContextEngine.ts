import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".cache", ".vscode", ".idea", "__pycache__", "coverage"
]);

export interface LiveContextInput {
  directory: string;
  objective: string;
  changedFiles: string[];
}

export interface LiveContextOutput {
  tree: string;
  promptContext: string;
  retrievalTelemetry: {
    candidateCount: number;
    selectedCount: number;
    boostedCount: number;
    budgetChars: number;
    objectiveTokenCount: number;
    usedBudgetChars: number;
    avgSelectionScore: number;
  };
}

export function buildLiveContext(input: LiveContextInput): LiveContextOutput {
  const tree = scanDirectory(input.directory, 3);
  const candidates = collectCandidateFiles(input.directory);
  const objectiveTokens = tokenize(input.objective);
  const scored = candidates
    .map((file) => ({
      ...file,
      score: scoreCandidate(file.relativePath, objectiveTokens, input.changedFiles.includes(file.relativePath))
    }))
    .sort((a, b) => b.score - a.score);
  const boosted = scored.filter((file) => input.changedFiles.includes(file.relativePath));
  const selected = scored.slice(0, 20);

  const budgetChars = 40_000;
  let used = 0;
  const snippets: Array<{ path: string; content: string; score: number }> = [];
  for (const file of selected) {
    const content = safeRead(file.absolutePath, 3500);
    if (!content) continue;
    if (used + content.length > budgetChars) continue;
    snippets.push({ path: file.relativePath, content, score: file.score });
    used += content.length;
  }

  const promptContext = snippets.length
    ? snippets.map((snippet) => `### ${snippet.path}\n\`\`\`\n${snippet.content}\n\`\`\``).join("\n\n")
    : "(no candidate files selected)";

  return {
    tree,
    promptContext,
    retrievalTelemetry: {
      candidateCount: candidates.length,
      selectedCount: snippets.length,
      boostedCount: boosted.length,
      budgetChars,
      objectiveTokenCount: objectiveTokens.length,
      usedBudgetChars: used,
      avgSelectionScore: snippets.length > 0 ? snippets.reduce((sum, s) => sum + s.score, 0) / snippets.length : 0
    }
  };
}

function collectCandidateFiles(directory: string): Array<{ relativePath: string; absolutePath: string }> {
  const queue: Array<{ absolute: string; relative: string; depth: number }> = [{ absolute: directory, relative: ".", depth: 0 }];
  const files: Array<{ relativePath: string; absolutePath: string }> = [];

  while (queue.length > 0 && files.length < 120) {
    const next = queue.shift();
    if (!next) break;
    const entries = safeReadDir(next.absolute);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(next.absolute, entry.name);
      const relativePath = next.relative === "." ? entry.name : `${next.relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || next.depth >= 3) continue;
        queue.push({ absolute: absolutePath, relative: relativePath, depth: next.depth + 1 });
      } else if (isLikelyRelevant(entry.name)) {
        files.push({ relativePath, absolutePath });
      }
    }
  }

  return files;
}

function scanDirectory(dir: string, maxDepth: number, prefix = ""): string {
  if (maxDepth <= 0) return `${prefix}...\n`;
  const entries = safeReadDir(dir);
  let result = "";
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      result += `${prefix}${entry.name}/\n`;
      result += scanDirectory(path.join(dir, entry.name), maxDepth - 1, `${prefix}  `);
    } else {
      result += `${prefix}${entry.name}\n`;
    }
  }
  return result;
}

function safeRead(pathValue: string, limit: number): string {
  try {
    return readFileSync(pathValue, "utf8").slice(0, limit);
  } catch {
    return "";
  }
}

function safeReadDir(pathValue: string): Array<{ name: string; isDirectory: () => boolean }> {
  try {
    return readdirSync(pathValue, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isLikelyRelevant(name: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md|yml|yaml|toml|py|go|rs|java|cs)$/i.test(name) || name === "Dockerfile";
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 3)
    .slice(0, 24);
}

function scoreCandidate(relativePath: string, objectiveTokens: string[], boosted: boolean): number {
  const normalizedPath = relativePath.toLowerCase();
  let score = boosted ? 2.5 : 0;
  for (const token of objectiveTokens) {
    if (normalizedPath.includes(token)) score += 1;
  }
  if (/readme|docs?|design|architecture/.test(normalizedPath)) score += 0.4;
  if (/test|spec/.test(normalizedPath)) score += 0.35;
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|cs)$/.test(normalizedPath)) score += 0.6;
  return score;
}
