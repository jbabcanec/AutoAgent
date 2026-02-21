import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureSchema } from "./schema.js";

let databaseInstance: Database.Database | undefined;

export function getContextDatabase(): Database.Database {
  if (databaseInstance) return databaseInstance;

  const dataDir = process.env.AUTOAGENT_DATA_DIR ?? path.join(os.homedir(), ".autoagent");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.AUTOAGENT_CONTEXT_DB_PATH ?? path.join(dataDir, "context.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  databaseInstance = db;
  return db;
}
