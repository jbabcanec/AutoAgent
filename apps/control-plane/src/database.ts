import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCHEMA_VERSION = 5;
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
      status TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'run',
      tool_name TEXT,
      tool_input_json TEXT
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      default_model TEXT,
      api_key_stored INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS execution_state (
      run_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      routing_mode TEXT NOT NULL,
      success INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      estimated_cost_usd REAL NOT NULL,
      aggregate_score REAL NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_traces_run_id ON traces(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_model_performance_provider_mode ON model_performance(provider_id, routing_mode, id);
  `);

  ensureProvidersColumns(db);
  ensureApprovalColumns(db);

  db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
    SCHEMA_VERSION,
    new Date().toISOString()
  );
}

function seedData(db: Database.Database): void {
  const provider = db.prepare("SELECT id FROM providers WHERE id = ?").get("openai-default");
  if (!provider) {
    const insert = db.prepare(
      "INSERT INTO providers (id, display_name, kind, base_url, default_model, api_key_stored) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insert.run("openai-default", "OpenAI", "openai-compatible", "https://api.openai.com/v1", "gpt-4o-mini", 0);
    insert.run(
      "anthropic-default",
      "Anthropic",
      "anthropic-compatible",
      "https://api.anthropic.com/v1",
      "claude-sonnet-4-20250514",
      0
    );
  }

  const setting = db.prepare("SELECT key FROM settings WHERE key = ?").get("requireApproval");
  if (!setting) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("requireApproval", "true");
  }
  const onboarding = db.prepare("SELECT key FROM settings WHERE key = ?").get("hasCompletedOnboarding");
  if (!onboarding) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("hasCompletedOnboarding", "false");
  }
  const trial = db.prepare("SELECT key FROM settings WHERE key = ?").get("trialTaskCompleted");
  if (!trial) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("trialTaskCompleted", "none");
  }
  const onboardingAt = db.prepare("SELECT key FROM settings WHERE key = ?").get("onboardingCompletedAt");
  if (!onboardingAt) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("onboardingCompletedAt", "");
  }
  const maxTokens = db.prepare("SELECT key FROM settings WHERE key = ?").get("maxTokens");
  if (!maxTokens) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("maxTokens", "4096");
  }
  const routingMode = db.prepare("SELECT key FROM settings WHERE key = ?").get("routingMode");
  if (!routingMode) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("routingMode", "balanced");
  }
  const egressMode = db.prepare("SELECT key FROM settings WHERE key = ?").get("egressPolicyMode");
  if (!egressMode) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("egressPolicyMode", "audit");
  }
  const egressAllowHosts = db.prepare("SELECT key FROM settings WHERE key = ?").get("egressAllowHosts");
  if (!egressAllowHosts) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("egressAllowHosts", "[]");
  }
}

function ensureProvidersColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(providers)").all() as Array<{ name: string }>;
  const hasApiKeyStored = columns.some((column) => column.name === "api_key_stored");
  if (!hasApiKeyStored) {
    try {
      db.exec("ALTER TABLE providers ADD COLUMN api_key_stored INTEGER NOT NULL DEFAULT 0");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }
}

function ensureApprovalColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(approvals)").all() as Array<{ name: string }>;
  const hasScope = columns.some((column) => column.name === "scope");
  const hasToolName = columns.some((column) => column.name === "tool_name");
  const hasToolInputJson = columns.some((column) => column.name === "tool_input_json");
  const hasExpiresAt = columns.some((column) => column.name === "expires_at");
  const hasContextHash = columns.some((column) => column.name === "context_hash");

  if (!hasScope) {
    try {
      db.exec("ALTER TABLE approvals ADD COLUMN scope TEXT NOT NULL DEFAULT 'run'");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }
  if (!hasToolName) {
    try {
      db.exec("ALTER TABLE approvals ADD COLUMN tool_name TEXT");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }
  if (!hasToolInputJson) {
    try {
      db.exec("ALTER TABLE approvals ADD COLUMN tool_input_json TEXT");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }
  if (!hasExpiresAt) {
    try {
      db.exec("ALTER TABLE approvals ADD COLUMN expires_at TEXT");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }
  if (!hasContextHash) {
    try {
      db.exec("ALTER TABLE approvals ADD COLUMN context_hash TEXT");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }
}
