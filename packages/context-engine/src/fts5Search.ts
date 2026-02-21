import type Database from "better-sqlite3";
import type { DocumentChunk } from "./types.js";

interface FtsRow {
  id: string;
  path: string;
  language: string;
  content: string;
  start_line: number;
  end_line: number;
  tokens_estimate: number;
  rank: number;
}

export function queryFtsChunks(db: Database.Database, query: string, limit: number): Array<{ chunk: DocumentChunk; rank: number }> {
  const rows = db
    .prepare(
      `
      SELECT c.id, c.path, c.language, c.content, c.start_line, c.end_line, c.tokens_estimate,
             bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.id
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `
    )
    .all(query, limit) as FtsRow[];

  return rows.map((row) => ({
    chunk: {
      id: row.id,
      path: row.path,
      language: row.language,
      content: row.content,
      startLine: row.start_line,
      endLine: row.end_line,
      tokensEstimate: row.tokens_estimate
    },
    rank: -row.rank
  }));
}
