import { getControlPlaneDatabase } from "../database.js";
import type { ApprovalItem } from "../types.js";

export class ApprovalStore {
  private readonly db = getControlPlaneDatabase();

  public list(): ApprovalItem[] {
    const rows = this.db
      .prepare("SELECT id, run_id, reason, requested_at, status FROM approvals ORDER BY requested_at DESC")
      .all() as Array<{
      id: string;
      run_id: string;
      reason: string;
      requested_at: string;
      status: ApprovalItem["status"];
    }>;
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      reason: row.reason,
      requestedAt: row.requested_at,
      status: row.status
    }));
  }

  public resolve(id: string, approved: boolean): ApprovalItem | undefined {
    this.db.prepare("UPDATE approvals SET status = ? WHERE id = ?").run(approved ? "approved" : "rejected", id);
    const row = this.db.prepare("SELECT id, run_id, reason, requested_at, status FROM approvals WHERE id = ?").get(id) as
      | {
          id: string;
          run_id: string;
          reason: string;
          requested_at: string;
          status: ApprovalItem["status"];
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      runId: row.run_id,
      reason: row.reason,
      requestedAt: row.requested_at,
      status: row.status
    };
  }
}
