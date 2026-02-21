import { getContextDatabase } from "./database.js";
import { queryFtsChunks } from "./fts5Search.js";
import type { DocumentChunk } from "./types.js";
import { queryVectorChunks } from "./vectorSearch.js";

export interface RetrievalInput {
  query: string;
  changedFiles: string[];
  chunks: DocumentChunk[];
  limit: number;
}

export function retrieveRelevantChunks(input: RetrievalInput): DocumentChunk[] {
  const db = getContextDatabase();
  const ftsCandidates = queryFtsChunks(db, sanitizeQuery(input.query), Math.max(input.limit * 3, 25));
  const vectorCandidates = queryVectorChunks(db, input.query, Math.max(input.limit * 3, 25));

  const byId = new Map<string, { chunk: DocumentChunk; score: number }>();

  for (const candidate of ftsCandidates) {
    const existing = byId.get(candidate.chunk.id);
    const baseScore = candidate.rank * 0.55 + changedFileBoost(candidate.chunk.path, input.changedFiles);
    byId.set(candidate.chunk.id, {
      chunk: candidate.chunk,
      score: (existing?.score ?? 0) + baseScore
    });
  }

  for (const candidate of vectorCandidates) {
    const existing = byId.get(candidate.chunk.id);
    const baseScore = candidate.similarity * 0.45 + changedFileBoost(candidate.chunk.path, input.changedFiles);
    byId.set(candidate.chunk.id, {
      chunk: candidate.chunk,
      score: (existing?.score ?? 0) + baseScore
    });
  }

  for (const chunk of input.chunks) {
    if (!byId.has(chunk.id)) {
      byId.set(chunk.id, {
        chunk,
        score: changedFileBoost(chunk.path, input.changedFiles)
      });
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((item) => item.chunk);
}

function changedFileBoost(chunkPath: string, changedFiles: string[]): number {
  return changedFiles.includes(chunkPath) ? 2.5 : 0;
}

function sanitizeQuery(value: string): string {
  const terms = value
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length > 2);
  return terms.length === 0 ? "context" : terms.join(" OR ");
}
