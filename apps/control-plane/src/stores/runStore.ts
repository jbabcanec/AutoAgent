import { getControlPlaneDatabase } from "../database.js";
import type { RunItem } from "../types.js";

export class RunStore {
  private readonly db = getControlPlaneDatabase();

  public list(): RunItem[] {
    const rows = this.db
      .prepare("SELECT run_id, project_id, status, created_at, updated_at, summary FROM runs ORDER BY updated_at DESC")
      .all() as Array<{
      run_id: string;
      project_id: string;
      status: RunItem["status"];
      created_at: string;
      updated_at: string;
      summary: string | null;
    }>;
    return rows.map((row) => ({
      runId: row.run_id,
      projectId: row.project_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      summary: row.summary ?? undefined
    }));
  }

  public get(runId: string): RunItem | undefined {
    const row = this.db
      .prepare("SELECT run_id, project_id, status, created_at, updated_at, summary FROM runs WHERE run_id = ?")
      .get(runId) as
      | {
          run_id: string;
          project_id: string;
          status: RunItem["status"];
          created_at: string;
          updated_at: string;
          summary: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      runId: row.run_id,
      projectId: row.project_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      summary: row.summary ?? undefined
    };
  }

  public create(input: Pick<RunItem, "projectId"> & { objective: string }): RunItem {
    const runId = `run-${Date.now()}`;
    const now = new Date().toISOString();
    const run: RunItem = {
      runId,
      projectId: input.projectId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      summary: input.objective
    };
    this.db
      .prepare("INSERT INTO runs (run_id, project_id, status, created_at, updated_at, summary) VALUES (?, ?, ?, ?, ?, ?)")
      .run(run.runId, run.projectId, run.status, run.createdAt, run.updatedAt, run.summary ?? null);
    return run;
  }
}
