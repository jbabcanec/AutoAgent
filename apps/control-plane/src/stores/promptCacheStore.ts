import { getControlPlaneDatabase } from "../database.js";

export class PromptCacheStore {
  private readonly db = getControlPlaneDatabase();

  public get(key: string): { value: unknown; createdAt: string; updatedAt: string; hitCount: number } | undefined {
    const row = this.db
      .prepare("SELECT value_json, created_at, updated_at, hit_count FROM prompt_cache WHERE key = ?")
      .get(key) as
      | {
          value_json: string;
          created_at: string;
          updated_at: string;
          hit_count: number;
        }
      | undefined;
    if (!row) return undefined;
    this.db.prepare("UPDATE prompt_cache SET hit_count = hit_count + 1, updated_at = ? WHERE key = ?").run(new Date().toISOString(), key);
    return {
      value: parseJson(row.value_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hitCount: row.hit_count + 1
    };
  }

  public put(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO prompt_cache (key, value_json, created_at, updated_at, hit_count) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
      )
      .run(key, JSON.stringify(value), now, now, 0);
  }

  public pruneOlderThan(days: number, nowMs = Date.now()): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
    return this.db.prepare("DELETE FROM prompt_cache WHERE updated_at < ?").run(cutoff).changes;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
