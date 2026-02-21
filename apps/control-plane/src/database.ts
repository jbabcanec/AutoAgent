import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCHEMA_VERSION = 1;
let instance: Database.Database | undefined;

export function getControlPlaneDatabase(): Database.Database {
  if (instance) return instance;

  const dataDir = process.env.AUTOAGENT_DATA_DIR ?? path.join(os.homedir(), ".autoagent");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.AUTOAGENT_CONTROL_DB_PATH ?? path.join(dataDir, "control-plane.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  seedData(db);
  instance = db;
  return db;
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const current = db.prepare("SELECT MAX(version) as version FROM schema_migrations").get() as { version: number | null };
  if ((current.version ?? 0) >= SCHEMA_VERSION) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      default_model TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_traces_run_id ON traces(run_id, id);
  `);

  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
    SCHEMA_VERSION,
    new Date().toISOString()
  );
}

function seedData(db: Database.Database): void {
  const run = db.prepare("SELECT run_id FROM runs WHERE run_id = ?").get("seed-run-1");
  if (!run) {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO runs (run_id, project_id, status, created_at, updated_at, summary) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("seed-run-1", "seed-project", "running", now, now, "Seed run for localhost navigation tests.");
  }

  const approval = db.prepare("SELECT id FROM approvals WHERE id = ?").get("approval-seed-1");
  if (!approval) {
    db.prepare("INSERT INTO approvals (id, run_id, reason, requested_at, status) VALUES (?, ?, ?, ?, ?)").run(
      "approval-seed-1",
      "seed-run-1",
      "External network access requested.",
      new Date().toISOString(),
      "pending"
    );
  }

  const provider = db.prepare("SELECT id FROM providers WHERE id = ?").get("openai-default");
  if (!provider) {
    const insert = db.prepare(
      "INSERT INTO providers (id, display_name, kind, base_url, default_model) VALUES (?, ?, ?, ?, ?)"
    );
    insert.run("openai-default", "OpenAI Local", "openai-compatible", "https://api.openai.com/v1", "gpt-4o-mini");
    insert.run(
      "anthropic-default",
      "Anthropic Local",
      "anthropic-compatible",
      "https://api.anthropic.com/v1",
      "claude-3-5-sonnet-latest"
    );
  }

  const setting = db.prepare("SELECT key FROM settings WHERE key = ?").get("requireApproval");
  if (!setting) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("requireApproval", "true");
  }

  const trace = db.prepare("SELECT id FROM traces WHERE run_id = ? LIMIT 1").get("seed-run-1");
  if (!trace) {
    db.prepare("INSERT INTO traces (run_id, timestamp, event_type, payload_json) VALUES (?, ?, ?, ?)").run(
      "seed-run-1",
      new Date().toISOString(),
      "run.started",
      JSON.stringify({ message: "Seed run started." })
    );
  }
}
