import { getControlPlaneDatabase } from "../database.js";
import type { TraceItem } from "../types.js";

export class TraceStore {
  private readonly db = getControlPlaneDatabase();

  public append(runId: string, eventType: string, payload: Record<string, unknown>): void {
    this.db
      .prepare("INSERT INTO traces (run_id, timestamp, event_type, payload_json) VALUES (?, ?, ?, ?)")
      .run(runId, new Date().toISOString(), eventType, JSON.stringify(payload));
  }

  public listByRun(runId: string): TraceItem[] {
    const rows = this.db
      .prepare("SELECT run_id, timestamp, event_type, payload_json FROM traces WHERE run_id = ? ORDER BY id ASC")
      .all(runId) as Array<{
      run_id: string;
      timestamp: string;
      event_type: string;
      payload_json: string;
    }>;
    return rows.map((row) => ({
      runId: row.run_id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      payload: parsePayload(row.payload_json)
    }));
  }
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}
