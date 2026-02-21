import { getContextDatabase } from "./database.js";
import { embedText } from "./embedding.js";
import { estimateTokens } from "./tokenEstimator.js";
import type { DocumentChunk, RepoDocument } from "./types.js";

export function chunkDocuments(documents: RepoDocument[], maxLinesPerChunk = 80): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const doc of documents) {
    const lines = doc.content.split("\n");
    for (let i = 0; i < lines.length; i += maxLinesPerChunk) {
      const segment = lines.slice(i, i + maxLinesPerChunk).join("\n");
      const startLine = i + 1;
      const endLine = Math.min(i + maxLinesPerChunk, lines.length);
      chunks.push({
        id: `${doc.path}:${startLine}-${endLine}`,
        path: doc.path,
        language: doc.language,
        content: segment,
        startLine,
        endLine,
        tokensEstimate: estimateTokens(segment)
      });
    }
  }
  persistChunks(chunks);
  return chunks;
}

function persistChunks(chunks: DocumentChunk[]): void {
  const db = getContextDatabase();
  const upsertChunk = db.prepare(`
    INSERT INTO chunks (id, path, language, content, start_line, end_line, tokens_estimate, embedding, updated_at)
    VALUES (@id, @path, @language, @content, @startLine, @endLine, @tokensEstimate, @embedding, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      path = excluded.path,
      language = excluded.language,
      content = excluded.content,
      start_line = excluded.start_line,
      end_line = excluded.end_line,
      tokens_estimate = excluded.tokens_estimate,
      embedding = excluded.embedding,
      updated_at = excluded.updated_at
  `);
  const deleteFts = db.prepare("DELETE FROM chunks_fts WHERE id = ?");
  const insertFts = db.prepare("INSERT INTO chunks_fts (id, path, content) VALUES (?, ?, ?)");

  const tx = db.transaction((rows: DocumentChunk[]) => {
    const now = new Date().toISOString();
    for (const chunk of rows) {
      upsertChunk.run({
        ...chunk,
        embedding: JSON.stringify(embedText(chunk.content)),
        updatedAt: now
      });
      deleteFts.run(chunk.id);
      insertFts.run(chunk.id, chunk.path, chunk.content);
    }
  });
  tx(chunks);
}
