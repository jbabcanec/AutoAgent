import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function defaultDataDir(): string {
  return process.env.AUTOAGENT_DATA_DIR ?? path.join(os.homedir(), ".autoagent");
}

function resolveDbPath(): string {
  return process.env.AUTOAGENT_CONTROL_DB_PATH ?? path.join(defaultDataDir(), "control-plane.db");
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

function usage(): never {
  throw new Error("Usage: pnpm --filter @autoagent/control-plane db:backup [targetPath] OR db:restore <backupPath>");
}

function run(): void {
  const command = process.argv[2];
  const argPath = process.argv[3];
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    throw new Error(`Control-plane DB not found: ${dbPath}`);
  }

  if (command === "backup") {
    const target =
      argPath ??
      path.join(defaultDataDir(), "backups", `control-plane-${timestamp()}.db`);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(dbPath, target);
    // eslint-disable-next-line no-console
    console.log(`Backup created: ${target}`);
    return;
  }

  if (command === "restore") {
    if (!argPath) usage();
    if (!existsSync(argPath)) {
      throw new Error(`Backup file not found: ${argPath}`);
    }
    mkdirSync(path.dirname(dbPath), { recursive: true });
    copyFileSync(argPath, dbPath);
    // eslint-disable-next-line no-console
    console.log(`DB restored from: ${argPath}`);
    return;
  }

  usage();
}

run();
