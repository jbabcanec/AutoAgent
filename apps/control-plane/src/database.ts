import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCHEMA_VERSION = 9;
let instance: Database.Database | undefined;

export function getControlPlaneDatabase(): Database.Database {
  if (instance) return instance;

  const dataDir = process.env.AUTOAGENT_DATA_DIR ?? path.join(os.homedir(), ".autoagent");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.AUTOAGENT_CONTROL_DB_PATH ?? path.join(dataDir, "control-plane.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 1000");
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ok if WAL is empty */ }
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

    CREATE TABLE IF NOT EXISTS conversation_threads (
      thread_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_thread_id TEXT,
      title TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_prompts (
      prompt_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      thread_id TEXT,
      turn_number INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      context_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL,
      answered_at TEXT,
      response_text TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS verification_artifacts (
      artifact_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      verification_type TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      artifact_content TEXT,
      verification_result TEXT NOT NULL,
      checks_json TEXT,
      verified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promotion_criteria (
      criterion_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      min_aggregate_score REAL NOT NULL,
      max_safety_violations INTEGER NOT NULL,
      min_verification_pass_rate REAL NOT NULL,
      max_latency_ms INTEGER,
      max_estimated_cost_usd REAL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promotion_evaluations (
      evaluation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      criterion_id TEXT NOT NULL,
      evaluation_result TEXT NOT NULL,
      aggregate_score REAL NOT NULL,
      safety_violations INTEGER NOT NULL,
      verification_pass_rate REAL NOT NULL,
      latency_ms INTEGER,
      estimated_cost_usd REAL,
      evaluated_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      reject_reasons_json TEXT
    );

    CREATE TABLE IF NOT EXISTS prompt_cache (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_traces_run_id ON traces(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_model_performance_provider_mode ON model_performance(provider_id, routing_mode, id);
    CREATE INDEX IF NOT EXISTS idx_threads_run_id ON conversation_threads(run_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_thread_turn ON conversation_messages(thread_id, turn_number, id);
    CREATE INDEX IF NOT EXISTS idx_prompts_run_status ON user_prompts(run_id, status, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run_verified ON verification_artifacts(run_id, verified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_promotions_run_eval ON promotion_evaluations(run_id, evaluated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prompt_cache_updated ON prompt_cache(updated_at DESC);
  `);

  ensureProvidersColumns(db);
  ensureApprovalColumns(db);
  ensurePromotionColumns(db);
  ensureSettingsRows(db);
  verifySchemaHealth(db);

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
  const traceRetentionDays = db.prepare("SELECT key FROM settings WHERE key = ?").get("traceRetentionDays");
  if (!traceRetentionDays) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("traceRetentionDays", "30");
  }
  const artifactRetentionDays = db.prepare("SELECT key FROM settings WHERE key = ?").get("artifactRetentionDays");
  if (!artifactRetentionDays) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("artifactRetentionDays", "30");
  }
  const promptRetentionDays = db.prepare("SELECT key FROM settings WHERE key = ?").get("promptRetentionDays");
  if (!promptRetentionDays) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("promptRetentionDays", "30");
  }
  const cleanupIntervalMinutes = db.prepare("SELECT key FROM settings WHERE key = ?").get("cleanupIntervalMinutes");
  if (!cleanupIntervalMinutes) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("cleanupIntervalMinutes", "15");
  }
  const promptCacheRetentionDays = db.prepare("SELECT key FROM settings WHERE key = ?").get("promptCacheRetentionDays");
  if (!promptCacheRetentionDays) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("promptCacheRetentionDays", "7");
  }

  const criterion = db.prepare("SELECT criterion_id FROM promotion_criteria WHERE criterion_id = ?").get("default-v1");
  if (!criterion) {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO promotion_criteria (criterion_id, name, description, min_aggregate_score, max_safety_violations, min_verification_pass_rate, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "default-v1",
      "Default Safety-Quality Gate",
      "Promote only when quality and safety pass baseline thresholds.",
      0.75,
      0,
      0.75,
      1,
      now,
      now
    );
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

function ensurePromotionColumns(db: Database.Database): void {
  const criteriaCols = db.prepare("PRAGMA table_info(promotion_criteria)").all() as Array<{ name: string }>;
  const evalCols = db.prepare("PRAGMA table_info(promotion_evaluations)").all() as Array<{ name: string }>;
  addColumnIfMissing(db, "promotion_criteria", criteriaCols, "max_latency_ms INTEGER");
  addColumnIfMissing(db, "promotion_criteria", criteriaCols, "max_estimated_cost_usd REAL");
  addColumnIfMissing(db, "promotion_evaluations", evalCols, "latency_ms INTEGER");
  addColumnIfMissing(db, "promotion_evaluations", evalCols, "estimated_cost_usd REAL");
  addColumnIfMissing(db, "promotion_evaluations", evalCols, "reject_reasons_json TEXT");
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columns: Array<{ name: string }>,
  columnSql: string
): void {
  const columnName = columnSql.split(" ")[0];
  if (columns.some((column) => column.name === columnName)) return;
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
      throw error;
    }
  }
}

function ensureSettingsRows(db: Database.Database): void {
  const requiredSettings: Array<{ key: string; value: string }> = [
    { key: "traceRetentionDays", value: "30" },
    { key: "artifactRetentionDays", value: "30" },
    { key: "promptRetentionDays", value: "30" },
    { key: "cleanupIntervalMinutes", value: "15" }
    , { key: "promptCacheRetentionDays", value: "7" }
  ];
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = COALESCE(settings.value, excluded.value)"
  );
  for (const setting of requiredSettings) {
    upsert.run(setting.key, setting.value);
  }
}

function verifySchemaHealth(db: Database.Database): void {
  const health = db.pragma("integrity_check", { simple: true }) as string;
  if (typeof health === "string" && health.toLowerCase() !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${health}`);
  }
  const expectedTables = [
    "runs",
    "approvals",
    "providers",
    "settings",
    "traces",
    "execution_state",
    "model_performance",
    "conversation_threads",
    "conversation_messages",
    "user_prompts",
    "verification_artifacts",
    "promotion_criteria",
    "promotion_evaluations"
    ,
    "prompt_cache"
  ];
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  for (const table of expectedTables) {
    if (!names.has(table)) {
      throw new Error(`Schema health check failed. Missing table: ${table}`);
    }
  }
}
