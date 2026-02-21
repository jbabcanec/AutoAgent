import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { getContextDatabase } from "./database.js";
import { estimateTokens } from "./tokenEstimator.js";
import type { RepoDocument } from "./types.js";

const DEFAULT_ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".md", ".json", ".yaml", ".yml"]);

export async function ingestDirectory(root: string, allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS): Promise<RepoDocument[]> {
  const output: RepoDocument[] = [];
  await walk(root, output, allowedExtensions);
  persistDocuments(output);
  return output;
}

async function walk(dir: string, output: RepoDocument[], allowedExtensions: Set<string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, output, allowedExtensions);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      continue;
    }
    const content = await readFile(fullPath, "utf8");
    const stats = await stat(fullPath);
    output.push({
      path: fullPath,
      content,
      language: extension.slice(1),
      tokensEstimate: estimateTokens(content),
      fileMtimeMs: stats.mtimeMs
    });
  }
}

function persistDocuments(documents: RepoDocument[]): void {
  const db = getContextDatabase();
  const upsert = db.prepare(`
    INSERT INTO documents (path, language, content, tokens_estimate, file_mtime_ms, updated_at)
    VALUES (@path, @language, @content, @tokensEstimate, @fileMtimeMs, @updatedAt)
    ON CONFLICT(path) DO UPDATE SET
      language = excluded.language,
      content = excluded.content,
      tokens_estimate = excluded.tokens_estimate,
      file_mtime_ms = excluded.file_mtime_ms,
      updated_at = excluded.updated_at
    WHERE excluded.file_mtime_ms > documents.file_mtime_ms
  `);
  const now = new Date().toISOString();
  const tx = db.transaction((rows: RepoDocument[]) => {
    for (const doc of rows) {
      upsert.run({
        ...doc,
        fileMtimeMs: doc.fileMtimeMs ?? Date.now(),
        updatedAt: now
      });
    }
  });
  tx(documents);
}
