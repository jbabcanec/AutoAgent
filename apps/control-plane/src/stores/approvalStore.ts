import { getControlPlaneDatabase } from "../database.js";
import type { ApprovalItem } from "../types.js";

export class ApprovalStore {
  private readonly db = getControlPlaneDatabase();

  public create(input: {
    runId: string;
    reason: string;
    scope?: "run" | "tool";
    toolName?: string;
    toolInput?: Record<string, unknown>;
    expiresAt?: string;
    contextHash?: string;
  }): ApprovalItem {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO approvals (id, run_id, reason, requested_at, status, scope, tool_name, tool_input_json, expires_at, context_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        input.runId,
        input.reason,
        requestedAt,
        "pending",
        input.scope ?? "run",
        input.toolName ?? null,
        input.toolInput ? JSON.stringify(input.toolInput) : null,
        input.expiresAt ?? null,
        input.contextHash ?? null
      );
    return {
      id,
      runId: input.runId,
      reason: input.reason,
      requestedAt,
      status: "pending",
      scope: input.scope ?? "run",
      toolName: input.toolName,
      toolInput: input.toolInput,
      expiresAt: input.expiresAt,
      contextHash: input.contextHash
    };
  }

  public list(): ApprovalItem[] {
    const rows = this.db
      .prepare("SELECT id, run_id, reason, requested_at, status, scope, tool_name, tool_input_json, expires_at, context_hash FROM approvals ORDER BY requested_at DESC")
      .all() as Array<{
      id: string;
      run_id: string;
      reason: string;
      requested_at: string;
      status: ApprovalItem["status"];
      scope: "run" | "tool";
      tool_name: string | null;
      tool_input_json: string | null;
      expires_at: string | null;
      context_hash: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      reason: row.reason,
      requestedAt: row.requested_at,
      status: row.status,
      scope: row.scope,
      toolName: row.tool_name ?? undefined,
      toolInput: row.tool_input_json ? parsePayload(row.tool_input_json) : undefined,
      expiresAt: row.expires_at ?? undefined,
      contextHash: row.context_hash ?? undefined
    }));
  }

  public resolve(
    id: string,
    approved: boolean,
    expectedContextHash?: string
  ): { item?: ApprovalItem; error?: "not_found" | "already_resolved" | "expired" | "context_mismatch" } {
    const row = this.db
      .prepare("SELECT id, run_id, reason, requested_at, status, scope, tool_name, tool_input_json, expires_at, context_hash FROM approvals WHERE id = ?")
      .get(id) as
      | {
          id: string;
          run_id: string;
          reason: string;
          requested_at: string;
          status: ApprovalItem["status"];
          scope: "run" | "tool";
          tool_name: string | null;
          tool_input_json: string | null;
          expires_at: string | null;
          context_hash: string | null;
        }
      | undefined;
    if (!row) return { error: "not_found" };
    if (row.status !== "pending") return { error: "already_resolved" };
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
      this.db.prepare("UPDATE approvals SET status = 'rejected' WHERE id = ?").run(id);
      return { error: "expired" };
    }
    if (expectedContextHash && row.context_hash && expectedContextHash !== row.context_hash) {
      return { error: "context_mismatch" };
    }

    this.db.prepare("UPDATE approvals SET status = ? WHERE id = ?").run(approved ? "approved" : "rejected", id);
    const item: ApprovalItem = {
      id: row.id,
      runId: row.run_id,
      reason: row.reason,
      requestedAt: row.requested_at,
      status: approved ? "approved" : "rejected",
      scope: row.scope,
      toolName: row.tool_name ?? undefined,
      toolInput: row.tool_input_json ? parsePayload(row.tool_input_json) : undefined,
      expiresAt: row.expires_at ?? undefined,
      contextHash: row.context_hash ?? undefined
    };
    return { item };
  }
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}
