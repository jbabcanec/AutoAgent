import type Database from "better-sqlite3";
import { cosineSimilarity, embedText } from "./embedding.js";
import type { DocumentChunk } from "./types.js";

interface ChunkRow {
  id: string;
  path: string;
  language: string;
  content: string;
  start_line: number;
  end_line: number;
  tokens_estimate: number;
  embedding: string;
}

export function queryVectorChunks(
  db: Database.Database,
  queryText: string,
  limit: number
): Array<{ chunk: DocumentChunk; similarity: number }> {
  const queryEmbedding = embedText(queryText);
  const rows = db
    .prepare("SELECT id, path, language, content, start_line, end_line, tokens_estimate, embedding FROM chunks")
    .all() as ChunkRow[];

  return rows
    .map((row) => {
      const vector = parseEmbedding(row.embedding);
      return {
        chunk: {
          id: row.id,
          path: row.path,
          language: row.language,
          content: row.content,
          startLine: row.start_line,
          endLine: row.end_line,
          tokensEstimate: row.tokens_estimate
        },
        similarity: cosineSimilarity(queryEmbedding, vector)
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

function parseEmbedding(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as number[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
