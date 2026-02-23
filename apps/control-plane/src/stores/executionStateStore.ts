import { getControlPlaneDatabase } from "../database.js";
import type { ExecutionStateItem } from "../types.js";

export class ExecutionStateStore {
  private readonly db = getControlPlaneDatabase();

  public get(runId: string): ExecutionStateItem | undefined {
    const row = this.db
      .prepare("SELECT run_id, state_json, updated_at FROM execution_state WHERE run_id = ?")
      .get(runId) as { run_id: string; state_json: string; updated_at: string } | undefined;
    if (!row) return undefined;
    return {
      runId: row.run_id,
      state: parseState(row.state_json),
      updatedAt: row.updated_at
    };
  }

  public upsert(runId: string, state: Record<string, unknown>): ExecutionStateItem {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO execution_state (run_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at"
      )
      .run(runId, JSON.stringify(state), updatedAt);
    return { runId, state, updatedAt };
  }

  public clear(runId: string): void {
    this.db.prepare("DELETE FROM execution_state WHERE run_id = ?").run(runId);
  }
}

function parseState(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}
